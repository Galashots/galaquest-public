using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Newtonsoft.Json;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace GalaQuest.Editor
{
    // A receipt grants reuse only while every owned output still matches. Unknown
    // or edited files are preserved, including after a failed preparation.
    public static class U2PreviewReceipt
    {
        private sealed class Receipt
        {
            public string input;
            public SortedDictionary<string, string> outputs;
        }

        private static string ReceiptPath => Path.Combine(U2CombatPreview.RepoRoot, ".local/throughput/u2-preview-receipt.json");

        public static string Fingerprint()
        {
            foreach (var asset in Resources.FindObjectsOfTypeAll<UnityEngine.Object>())
                if (EditorUtility.IsPersistent(asset) && EditorUtility.IsDirty(asset)
                    && AssetDatabase.GetAssetPath(asset).StartsWith("Assets/GalaQuest/", StringComparison.Ordinal))
                    throw new BuildFailedException("Save or revert unsaved preview source asset: " + AssetDatabase.GetAssetPath(asset));
            var stage = UnityEditor.SceneManagement.PrefabStageUtility.GetCurrentPrefabStage();
            if (stage != null && stage.scene.isDirty)
                throw new BuildFailedException("Save or close the unsaved prefab stage before preview preparation");
            var files = new SortedDictionary<string, string>(StringComparer.Ordinal);
            void Add(string path)
            {
                if (!File.Exists(path)) throw new BuildFailedException("Missing preview input: " + path);
                files[path] = Hash(path);
            }
            Add(Path.Combine(U2CombatPreview.CandidateDirectory, "lava-gremlin-local-v1.fbx"));
            Add(Path.Combine(U2CombatPreview.CandidateDirectory, "../gremlin-body/texture_0_base_color.png"));
            var review = Environment.GetEnvironmentVariable("GQ_U2_GRIP_REVIEW") == "1";
            if (review) Add(U2HeroGripPreview.CandidatePath);
            // Include generator/runtime code and its serialized input dependencies.
            // This intentionally over-invalidates on code changes; it cannot serve
            // an old recipe after the gameplay writer adds a new authoring call.
            foreach (var path in Directory.GetFiles("Assets/GalaQuest", "*.cs", SearchOption.AllDirectories)) Add(path);
            foreach (var path in Directory.GetFiles("ProjectSettings", "*", SearchOption.TopDirectoryOnly)) Add(path);
            Add("Packages/manifest.json");
            Add("Packages/packages-lock.json");
            foreach (var path in AssetDatabase.GetAllAssetPaths().Where(path => path.StartsWith("Assets/GalaQuest/", StringComparison.Ordinal)))
                if (File.Exists(path))
                {
                    Add(path);
                    Add(path + ".meta");
                    files[path + "#import"] = AssetDatabase.GetAssetDependencyHash(path).ToString();
                }
            files["#environment"] = Application.unityVersion + ":" + EditorUserBuildSettings.activeBuildTarget + ":" + review;
            using var sha = SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(files))));
        }

        public static bool Reuse(string input)
        {
            if (!Directory.Exists(U2CombatPreview.Temporary))
            {
                if (File.Exists(U2CombatPreview.Temporary + ".meta"))
                    throw new BuildFailedException("Preserve orphaned preview folder metadata");
                if (File.Exists(ReceiptPath))
                    throw new BuildFailedException("Preserve preview receipt with missing outputs; inspect before disposal");
                return false;
            }
            var receipt = ValidateOwned();
            if (receipt.input == input) return true;
            DeleteOwned();
            return false;
        }

        public static void Save(string input)
        {
            var receipt = new Receipt { input = input, outputs = Snapshot() };
            Directory.CreateDirectory(Path.GetDirectoryName(ReceiptPath));
            File.WriteAllText(ReceiptPath, JsonConvert.SerializeObject(receipt, Formatting.Indented));
        }

        public static void CheckOwned()
        {
            if (ValidateOwned().input != Fingerprint())
                throw new BuildFailedException("Preview inputs changed; run Prepare again");
        }

        public static void DeleteOwned()
        {
            ValidateOwned();
            if (!AssetDatabase.DeleteAsset(U2CombatPreview.Temporary))
                throw new BuildFailedException("Could not remove verified preview outputs");
            File.Delete(ReceiptPath);
        }

        private static Receipt ValidateOwned()
        {
            if (!File.Exists(ReceiptPath)) throw new BuildFailedException("Preserve unrecognized preview outputs: no receipt");
            var receipt = JsonConvert.DeserializeObject<Receipt>(File.ReadAllText(ReceiptPath));
            var current = Snapshot();
            if (receipt?.outputs == null || receipt.outputs.Count != current.Count
                || current.Any(item => !receipt.outputs.TryGetValue(item.Key, out var hash) || hash != item.Value))
                throw new BuildFailedException("Preserve changed or unrecognized preview outputs");
            foreach (var path in AssetDatabase.GetAllAssetPaths().Where(path => path.StartsWith(U2CombatPreview.Temporary + "/", StringComparison.Ordinal)
                && !path.EndsWith(".unity", StringComparison.OrdinalIgnoreCase) && !Directory.Exists(path)))
                foreach (var asset in AssetDatabase.LoadAllAssetsAtPath(path))
                    if (asset != null && EditorUtility.IsDirty(asset))
                        throw new BuildFailedException("Preserve unsaved preview asset: " + path);
            for (var i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
                if (UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).path.StartsWith(U2CombatPreview.Temporary + "/", StringComparison.Ordinal))
                    throw new BuildFailedException("Close the preview scene before regenerating or reusing its assets");
            return receipt;
        }

        private static SortedDictionary<string, string> Snapshot()
        {
            var files = new SortedDictionary<string, string>(StringComparer.Ordinal);
            foreach (var path in Directory.GetDirectories(U2CombatPreview.Temporary, "*", SearchOption.AllDirectories))
                files[path + "/"] = "directory";
            foreach (var path in Directory.GetFiles(U2CombatPreview.Temporary, "*", SearchOption.AllDirectories)
                .Concat(new[] { U2CombatPreview.Temporary + ".meta" })) files[path] = Hash(path);
            return files;
        }

        private static string Hash(string path)
        {
            using var stream = File.OpenRead(path);
            using var sha = SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
        }
    }
}
