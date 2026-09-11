using System;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace GalaQuest.Editor
{
    public sealed class U2BuildSettingsScope : IDisposable
    {
        private const string ProjectSettingsPath = "ProjectSettings/ProjectSettings.asset";
        private const string EditorBuildSettingsPath = "ProjectSettings/EditorBuildSettings.asset";
        private readonly byte[] originalProjectSettingsBytes;
        private readonly byte[] originalEditorBuildSettingsBytes;
        private readonly EditorBuildSettingsScene[] originalScenes;
        private readonly UnityEngine.Object[] preloaded;
        private readonly WebGLCompressionFormat compression;
#if UNITY_WEBGL
        private readonly UnityEditor.WebGL.WasmCodeOptimization optimization;
#endif
        private bool disposed;

        public U2BuildSettingsScope()
        {
            RequireCleanAssets(false);
            originalProjectSettingsBytes = File.ReadAllBytes(ProjectSettingsPath);
            originalEditorBuildSettingsBytes = File.ReadAllBytes(EditorBuildSettingsPath);
            originalScenes = EditorBuildSettings.scenes;
            preloaded = PlayerSettings.GetPreloadedAssets();
            compression = PlayerSettings.WebGL.compressionFormat;
#if UNITY_WEBGL
            optimization = UnityEditor.WebGL.UserBuildSettings.codeOptimization;
#endif
        }

        public void UseFastReview()
        {
#if UNITY_WEBGL
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            UnityEditor.WebGL.UserBuildSettings.codeOptimization = UnityEditor.WebGL.WasmCodeOptimization.BuildTimes;
#else
            throw new BuildFailedException("Fast browser review requires the WebGL build target");
#endif
        }

        public void Dispose()
        {
            if (disposed) return;

            RestoreInMemory();
            // ProjectSettings is not saved by SaveAssetIfDirty. The supported
            // project save is safe only after restoring the owned scene override
            // and excluding every unrelated dirty persistent asset, both before
            // the operation and after callbacks.
            RequireCleanAssets(true);
            var changedBeforeSave = ChangedSettingsPaths();
            if (!EditorApplication.ExecuteMenuItem("File/Save Project"))
                throw new BuildFailedException("Could not save restored build settings");
            VerifyRestoredDiskSettings(changedBeforeSave);
            disposed = true;
        }

        public void Abort()
        {
            if (disposed) return;
            RestoreInMemory();
            VerifyRestoredDiskSettings(ChangedSettingsPaths());
            disposed = true;
        }

        private static void RequireCleanAssets(bool allowOwnedSettings)
        {
            foreach (var asset in Resources.FindObjectsOfTypeAll<UnityEngine.Object>())
            {
                if (!EditorUtility.IsPersistent(asset) || !EditorUtility.IsDirty(asset)
                    || (asset.hideFlags & HideFlags.NotEditable) != 0) continue;
                var path = AssetDatabase.GetAssetPath(asset);
                if (string.IsNullOrEmpty(path) || (allowOwnedSettings
                    && (path == ProjectSettingsPath || path == EditorBuildSettingsPath))) continue;
                throw new BuildFailedException("Save or revert unsaved asset before build settings save: " + path);
            }
        }

        private void RestoreInMemory()
        {
            if (!SameScenes(EditorBuildSettings.scenes, originalScenes))
                EditorBuildSettings.scenes = originalScenes;
            if (PlayerSettings.WebGL.compressionFormat != compression)
                PlayerSettings.WebGL.compressionFormat = compression;
            if (!SameObjects(PlayerSettings.GetPreloadedAssets(), preloaded))
                PlayerSettings.SetPreloadedAssets(preloaded);
#if UNITY_WEBGL
            if (UnityEditor.WebGL.UserBuildSettings.codeOptimization != optimization)
                UnityEditor.WebGL.UserBuildSettings.codeOptimization = optimization;
#endif
        }

        private string[] ChangedSettingsPaths()
        {
            return new[]
            {
                SameSerializedContent(originalProjectSettingsBytes, File.ReadAllBytes(ProjectSettingsPath))
                    ? null : ProjectSettingsPath,
                SameSerializedContent(originalEditorBuildSettingsBytes, File.ReadAllBytes(EditorBuildSettingsPath))
                    ? null : EditorBuildSettingsPath
            }.Where(path => path != null).ToArray();
        }

        private void VerifyRestoredDiskSettings(string[] changedBeforeSave)
        {
            var changedPaths = ChangedSettingsPaths();
            if (changedPaths.Length == 0) return;
            throw new BuildFailedException("Build changed persistent settings serialized content; preserve and inspect: "
                + string.Join(", ", changedPaths));
        }

        // Build #15 established that UBA may rewrite these files' line endings.
        // This comparison deliberately preserves every serialized character beyond
        // CRLF/CR representation: order, duplicates, values, indentation, intra-line
        // whitespace, BOM, and terminal-newline presence all remain significant.
        private static bool SameSerializedContent(byte[] left, byte[] right)
        {
            return string.Equals(CanonicalSerializedText(left), CanonicalSerializedText(right), StringComparison.Ordinal);
        }

        private static string CanonicalSerializedText(byte[] bytes)
        {
            return new UTF8Encoding(false).GetString(bytes).Replace("\r\n", "\n").Replace('\r', '\n');
        }

        private static bool SameScenes(EditorBuildSettingsScene[] left, EditorBuildSettingsScene[] right)
        {
            if (left == null || right == null) return left == right;
            return left.Length == right.Length && left.Zip(right, (a, b) => a.path == b.path && a.enabled == b.enabled).All(equal => equal);
        }

        private static bool SameObjects(UnityEngine.Object[] left, UnityEngine.Object[] right)
        {
            if (left == null || right == null) return left == right;
            return left.SequenceEqual(right);
        }
    }
}
