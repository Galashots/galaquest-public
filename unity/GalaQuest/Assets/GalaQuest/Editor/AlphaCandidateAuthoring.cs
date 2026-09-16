using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.Build;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GalaQuest.Editor
{
    // Native Alpha (wolf) candidate authoring. Custody-tier only: the FBX and its
    // texture sidecars under .local/m2/alpha-native are verified against receipt.json
    // before use, and the outputs below live only under the preview temporary root.
    // Verification is not a licence grant and never promotes the candidate.
    public static class AlphaCandidateAuthoring
    {
        public const string EnemyKind = "alpha-wolf";

        // Exact existing source this candidate must come from. Lowercase hex.
        public const string SourceSha256 = "1f0e0504de4b540693727ba9fd50cdb02cd96b26c38a1eb5f7dcf6f8b647f13f";
        public const string SourceRepoPath = "public/assets/enemies/wolf.glb";

        public const string CandidateDirName = ".local/m2/alpha-native";
        public const string FbxFileName = "Alpha.fbx";
        public const string ReceiptFileName = "receipt.json";
        public const string RecipePath = "tools/blender/convert_glb_to_fbx.py";
        public const string ConverterPath = "tools/unity-migration/convert-alpha-candidate.mjs";

        // Body framing grounded in the retained web reader public/src/enemies/wolf.js:
        // WOLF_SCALE 0.78 times enemyKindPresentation Alpha multiplier 1.3. The
        // imported source transform is left unchanged; the authored candidate scale
        // sits on the prefab root. Astra inspects and corrects the candidate if the
        // visual differs. No protected Hero asset is touched.
        public const float AuthoredScale = 0.78f * 1.3f;

        // Authored bite retime mapping. The source exports at 24 fps with every clip
        // beginning at frame 1 except walk at frame 0. The heavy attack profile
        // (public/src/combat/encounter.js: contactSeconds 0.95, durationSeconds 1.75,
        // shared STAGGER_SECONDS 0.667 / DEATH_SECONDS 1.75) needs the source bite
        // CONTACT at frames 9-10. AUTHORED mapping: frame 10 minus first frame 1 =
        // 9 frames at 24 fps = 0.375 s of clip-relative time -> 0.95 s, and the
        // imported clip length -> 1.75 s. Piecewise-linear, no global motion edits.
        // This mapping needs actual native pose review; it is not proof of good motion.
        public const float BiteContactSourceSeconds = 9f / 24f;
        public const float BiteContactAuthoredSeconds = 0.95f;
        public const float BiteAuthoredDuration = 1.75f;
        public const float HitAuthoredDuration = 0.667f;
        public const float DeathAuthoredDuration = 1.75f;

        public static string CandidateDirectory(string candidateDir = null) =>
            candidateDir ?? Path.Combine(U2CombatPreview.RepoRoot, CandidateDirName);

        public static bool IsCandidatePresent(string candidateDir = null)
        {
            var dir = CandidateDirectory(candidateDir);
            return File.Exists(Path.Combine(dir, ReceiptFileName)) && File.Exists(Path.Combine(dir, FbxFileName));
        }

        public static IReadOnlyList<string> DeclaredCandidatePaths(string candidateDir = null)
        {
            var dir = CandidateDirectory(candidateDir);
            var receiptPath = Path.Combine(dir, ReceiptFileName);
            if (!File.Exists(receiptPath)) throw new BuildFailedException("Missing alpha-native receipt: " + receiptPath);
            var receipt = ParseReceipt(File.ReadAllText(receiptPath), receiptPath);
            var paths = new List<string>
            {
                Path.Combine(U2CombatPreview.RepoRoot, SourceRepoPath),
                receiptPath,
                Path.Combine(U2CombatPreview.RepoRoot, RecipePath),
                Path.Combine(U2CombatPreview.RepoRoot, ConverterPath),
            };
            foreach (var file in receipt.Files) paths.Add(Path.Combine(dir, file.Name));
            return paths;
        }

        public static void ValidateCandidate(string candidateDir = null)
        {
            var dir = CandidateDirectory(candidateDir);
            var receiptPath = Path.Combine(dir, ReceiptFileName);
            if (!File.Exists(receiptPath))
                throw new BuildFailedException("Missing alpha-native receipt: " + receiptPath + "; the Astra conversion has not been delivered");
            var receipt = ParseReceipt(File.ReadAllText(receiptPath), receiptPath);
            if (receipt.BlenderVersion != "4.5.13"
                || receipt.RecipeSha256 != Hash(Path.Combine(U2CombatPreview.RepoRoot, RecipePath))
                || receipt.ConverterSha256 != Hash(Path.Combine(U2CombatPreview.RepoRoot, ConverterPath)))
                throw new BuildFailedException("Alpha conversion recipe/version changed; produce a fresh qualified candidate");
            var sourcePath = Path.Combine(U2CombatPreview.RepoRoot, SourceRepoPath);
            if (!File.Exists(sourcePath)) throw new BuildFailedException("Missing alpha source: " + sourcePath);
            if (!string.Equals(Hash(sourcePath), receipt.SourceSha256, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(receipt.SourceSha256, SourceSha256, StringComparison.OrdinalIgnoreCase))
                throw new BuildFailedException("Alpha source hash mismatch; expected the exact wolf.glb " + SourceSha256);
            var fbxEntry = receipt.Files.SingleOrDefault(file =>
                string.Equals(file.Name, FbxFileName, StringComparison.Ordinal));
            if (fbxEntry == null) throw new BuildFailedException("Alpha receipt declares no " + FbxFileName);
            if (!string.Equals(fbxEntry.Sha256, receipt.FbxSha256, StringComparison.OrdinalIgnoreCase))
                throw new BuildFailedException("Alpha receipt fbxSha256 does not match its files entry for " + FbxFileName);
            foreach (var file in receipt.Files)
            {
                if (file.Name != Path.GetFileName(file.Name) || string.IsNullOrEmpty(file.Name))
                    throw new BuildFailedException("Alpha receipt declares an unsafe file name: " + file.Name);
                var path = Path.Combine(dir, file.Name);
                if (!File.Exists(path)) throw new BuildFailedException("Missing declared alpha candidate file: " + path);
                if (new FileInfo(path).Length != file.Bytes)
                    throw new BuildFailedException("Alpha candidate byte size mismatch: " + path);
                if (!string.Equals(Hash(path), file.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new BuildFailedException("Alpha candidate hash mismatch: " + path);
            }
            if (!receipt.Files.Any(file => file.Name.StartsWith("Alpha.texture-", StringComparison.Ordinal)))
                throw new BuildFailedException("Alpha receipt declares no texture sidecar (Alpha.texture-*)");
        }

        public static GameObject Prepare(string temporaryRoot)
        {
            ValidateCandidate();
            var dir = temporaryRoot + "/Alpha";
            if (Directory.Exists(dir) || File.Exists(dir + ".meta"))
                throw new BuildFailedException("Preserve pre-existing alpha preview assets: " + dir);
            AssetDatabase.CreateFolder(temporaryRoot, "Alpha");
            var candidateDir = CandidateDirectory();
            var receipt = ParseReceipt(File.ReadAllText(Path.Combine(candidateDir, ReceiptFileName)), ReceiptFileName);
            File.Copy(Path.Combine(candidateDir, FbxFileName), dir + "/" + FbxFileName);
            var sidecars = receipt.Files
                .Where(file => file.Name.StartsWith("Alpha.texture-", StringComparison.Ordinal))
                .OrderBy(file => file.Name, StringComparer.Ordinal).ToArray();
            foreach (var sidecar in sidecars) File.Copy(Path.Combine(candidateDir, sidecar.Name), dir + "/" + sidecar.Name);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

            var importer = (ModelImporter)AssetImporter.GetAtPath(dir + "/" + FbxFileName);
            importer.animationType = ModelImporterAnimationType.Generic;
            importer.importAnimation = true;
            importer.optimizeGameObjects = false;
            var takes = importer.defaultClipAnimations;
            foreach (var take in takes) take.loopTime = IsClip(take.name, "idle") || IsClip(take.name, "walk");
            importer.clipAnimations = takes;
            importer.SaveAndReimport();

            if (sidecars.Length != 1) throw new BuildFailedException("This source requires exactly one base-colour texture");
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(dir + "/" + sidecars[0].Name);
            if (texture == null) throw new BuildFailedException("Missing imported Alpha base texture");
            var material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            material.SetTexture("_BaseMap", texture);
            material.SetFloat("_Metallic", 0);
            material.SetFloat("_Smoothness", .15f);
            AssetDatabase.CreateAsset(material, dir + "/Alpha.mat");

            var bite = Clip(dir + "/" + FbxFileName, "bite");
            var retimedBite = RetimeBiteClip(bite);
            AssetDatabase.CreateAsset(retimedBite, dir + "/AlphaBiteRetimed.anim");
            var controller = AnimatorController.CreateAnimatorControllerAtPath(dir + "/Alpha.controller");
            AddState(controller, "idle", Clip(dir + "/" + FbxFileName, "idle"));
            AddState(controller, "walk", Clip(dir + "/" + FbxFileName, "walk"));
            AddState(controller, "bash", retimedBite, BiteAuthoredDuration);
            AddState(controller, "hit", Clip(dir + "/" + FbxFileName, "hit"), HitAuthoredDuration);
            AddState(controller, "death", Clip(dir + "/" + FbxFileName, "death"), DeathAuthoredDuration);

            var anchor = new GameObject("Alpha candidate");
            GameObject prefab;
            try
            {
                var model = Object.Instantiate(AssetDatabase.LoadAssetAtPath<GameObject>(dir + "/" + FbxFileName), anchor.transform);
                model.name = "Visual";
                var animator = model.GetComponent<Animator>();
                if (animator == null) animator = model.AddComponent<Animator>();
                animator.runtimeAnimatorController = controller;
                animator.applyRootMotion = false;
                foreach (var renderer in model.GetComponentsInChildren<Renderer>()) renderer.sharedMaterial = material;
                // Keep actor/telegraph coordinates in metres; scale only the visible body.
                model.transform.localScale *= AuthoredScale;
                prefab = PrefabUtility.SaveAsPrefabAsset(anchor, dir + "/Alpha.prefab");
            }
            finally { Object.DestroyImmediate(anchor); }
            return prefab;
        }

        public static GalaQuestCombatContent.EnemyPrefab NewEnemyEntry(GameObject prefab) =>
            new GalaQuestCombatContent.EnemyPrefab { Kind = EnemyKind, Prefab = prefab };

        public static void AddState(AnimatorController controller, string name, AnimationClip clip, float duration = 0)
        {
            var state = controller.layers[0].stateMachine.AddState(name);
            state.motion = clip;
            state.speed = duration > 0 ? clip.length / duration : 1;
            EditorUtility.SetDirty(controller);
        }

        public static float RetimeBiteTime(float sourceTime, float sourceLength)
        {
            if (sourceTime <= 0) return 0;
            if (sourceTime >= sourceLength) return BiteAuthoredDuration;
            if (sourceTime <= BiteContactSourceSeconds)
                return sourceTime / BiteContactSourceSeconds * BiteContactAuthoredSeconds;
            var sourceSpan = sourceLength - BiteContactSourceSeconds;
            if (sourceSpan <= 0) return BiteContactAuthoredSeconds;
            return BiteContactAuthoredSeconds
                + (sourceTime - BiteContactSourceSeconds) / sourceSpan * (BiteAuthoredDuration - BiteContactAuthoredSeconds);
        }

        public static AnimationClip RetimeBiteClip(AnimationClip source)
        {
            if (source == null || source.length <= BiteContactSourceSeconds)
                throw new BuildFailedException("A native bite longer than the declared contact frame is required");
            var retimed = new AnimationClip { frameRate = source.frameRate, legacy = source.legacy };
            retimed.wrapMode = source.wrapMode;
            foreach (var binding in AnimationUtility.GetCurveBindings(source))
            {
                var curve = AnimationUtility.GetEditorCurve(source, binding);
                if (curve == null) continue;
                var keys = curve.keys;
                var sourceKeys = (Keyframe[])keys.Clone();
                for (var i = 0; i < keys.Length; i++)
                {
                    var key = keys[i];
                    var inScale = SlopeScale(sourceKeys, i, false, source.length);
                    var outScale = SlopeScale(sourceKeys, i, true, source.length);
                    key.time = RetimeBiteTime(key.time, source.length);
                    key.inTangent *= inScale;
                    key.outTangent *= outScale;
                    keys[i] = key;
                }
                curve.keys = keys;
                AnimationUtility.SetEditorCurve(retimed, binding, curve);
            }
            foreach (var binding in AnimationUtility.GetObjectReferenceCurveBindings(source))
            {
                var keys = AnimationUtility.GetObjectReferenceCurve(source, binding);
                for (var i = 0; i < keys.Length; i++)
                    keys[i].time = RetimeBiteTime(keys[i].time, source.length);
                AnimationUtility.SetObjectReferenceCurve(retimed, binding, keys);
            }
            var events = AnimationUtility.GetAnimationEvents(source);
            foreach (var item in events) item.time = RetimeBiteTime(item.time, source.length);
            AnimationUtility.SetAnimationEvents(retimed, events);
            retimed.EnsureQuaternionContinuity();
            return retimed;
        }

        // Tangent slopes are values-per-second, so a key's tangents scale by the
        // inverse segment time scale (old duration / new duration). The contact key
        // uses its incoming segment for inTangent and its outgoing segment for
        // outTangent. Curve values and object paths are untouched, so quaternion
        // continuity and wrap modes carry over unchanged.
        private static float SlopeScale(Keyframe[] keys, int index, bool outgoing, float sourceLength)
        {
            float oldSpan, newSpan;
            if (!outgoing && index > 0)
            {
                oldSpan = keys[index].time - keys[index - 1].time;
                newSpan = RetimeBiteTime(keys[index].time, sourceLength) - RetimeBiteTime(keys[index - 1].time, sourceLength);
            }
            else if (outgoing && index < keys.Length - 1)
            {
                oldSpan = keys[index + 1].time - keys[index].time;
                newSpan = RetimeBiteTime(keys[index + 1].time, sourceLength) - RetimeBiteTime(keys[index].time, sourceLength);
            }
            else if (index > 0)
            {
                oldSpan = keys[index].time - keys[index - 1].time;
                newSpan = RetimeBiteTime(keys[index].time, sourceLength) - RetimeBiteTime(keys[index - 1].time, sourceLength);
            }
            else if (index < keys.Length - 1)
            {
                oldSpan = keys[index + 1].time - keys[index].time;
                newSpan = RetimeBiteTime(keys[index + 1].time, sourceLength) - RetimeBiteTime(keys[index].time, sourceLength);
            }
            else return 1;
            if (oldSpan <= 0 || newSpan <= 0) return 1;
            return oldSpan / newSpan;
        }

        private static AnimationClip Clip(string path, string suffix)
        {
            var clips = AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().Where(clip => !clip.name.StartsWith("__preview__")).ToArray();
            return clips.SingleOrDefault(clip => IsClip(clip.name, suffix))
                ?? throw new BuildFailedException("Missing native clip " + suffix + "; available=" + string.Join(",", clips.Select(clip => clip.name)));
        }

        private static bool IsClip(string clipName, string suffix) =>
            clipName == suffix || clipName.EndsWith("|" + suffix, StringComparison.Ordinal);

        private sealed class ReceiptFile
        {
            public string Name;
            public string Sha256;
            public long Bytes;
        }

        private sealed class ReceiptModel
        {
            public string SourceSha256;
            public string FbxSha256;
            public string RecipeSha256, ConverterSha256, BlenderVersion;
            public List<ReceiptFile> Files = new List<ReceiptFile>();
        }

        private static ReceiptModel ParseReceipt(string json, string receiptPath)
        {
            var model = new ReceiptModel();
            JObject root;
            try { root = JObject.Parse(json); }
            catch (Exception exception) { throw new BuildFailedException("Alpha receipt is not valid JSON: " + receiptPath + " (" + exception.Message + ")"); }
            model.SourceSha256 = (string)root["sourceSha256"];
            model.FbxSha256 = (string)root["fbxSha256"];
            model.RecipeSha256 = (string)root["recipeSha256"];
            model.ConverterSha256 = (string)root["converterSha256"];
            model.BlenderVersion = (string)root["blenderVersion"];
            if (string.IsNullOrEmpty(model.SourceSha256) || string.IsNullOrEmpty(model.FbxSha256)
                || string.IsNullOrEmpty(model.RecipeSha256) || string.IsNullOrEmpty(model.ConverterSha256) || string.IsNullOrEmpty(model.BlenderVersion))
                throw new BuildFailedException("Alpha receipt is missing required provenance fields: " + receiptPath);
            var files = root["files"] as JArray;
            if (files == null || files.Count == 0) throw new BuildFailedException("Alpha receipt declares no files: " + receiptPath);
            foreach (var item in files)
            {
                var name = (string)item["name"];
                var sha = (string)item["sha256"];
                var bytes = (long?)item["bytes"];
                if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(sha) || bytes == null || bytes < 0)
                    throw new BuildFailedException("Alpha receipt has a malformed file entry: " + receiptPath);
                model.Files.Add(new ReceiptFile { Name = name, Sha256 = sha, Bytes = bytes.Value });
            }
            return model;
        }

        private static string Hash(string path)
        {
            using var stream = File.OpenRead(path);
            using var sha = SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }
    }
}
