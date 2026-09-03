using System.IO;
using GalaQuest.Migration;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Editor
{
    public static class MigrationBridgeAssetImporter
    {
        public const string ManifestAssetPath = "Assets/GalaQuest/Migration/BridgeManifest.json";
        public const string ImportedDataAssetPath = "Assets/GalaQuest/Migration/Generated/MigrationBridgeData.asset";

        [MenuItem("GalaQuest/Migration/Import Bridge Manifest")]
        private static void ImportBridgeManifest()
        {
            ImportManifestAsset();
        }

        public static MigrationBridgeData ImportManifestAsset()
        {
            var manifestAsset = AssetDatabase.LoadAssetAtPath<TextAsset>(ManifestAssetPath);
            if (manifestAsset == null)
            {
                throw new UnityException($"Migration Bridge manifest not found at {ManifestAssetPath}.");
            }

            var document = MigrationBridgeManifest.Parse(manifestAsset.text);
            EnsureGeneratedDirectory();

            var importedData = AssetDatabase.LoadAssetAtPath<MigrationBridgeData>(ImportedDataAssetPath);
            if (importedData == null)
            {
                importedData = ScriptableObject.CreateInstance<MigrationBridgeData>();
                AssetDatabase.CreateAsset(importedData, ImportedDataAssetPath);
            }

            importedData.Apply(document);
            EditorUtility.SetDirty(importedData);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            return AssetDatabase.LoadAssetAtPath<MigrationBridgeData>(ImportedDataAssetPath);
        }

        private static void EnsureGeneratedDirectory()
        {
            var projectRoot = Directory.GetParent(Application.dataPath).FullName;
            var absoluteDirectory = Path.Combine(projectRoot, "Assets/GalaQuest/Migration/Generated");
            if (!Directory.Exists(absoluteDirectory))
            {
                Directory.CreateDirectory(absoluteDirectory);
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            }
        }
    }
}
