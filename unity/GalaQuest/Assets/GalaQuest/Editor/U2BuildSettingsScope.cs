using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace GalaQuest.Editor
{
    public sealed class U2BuildSettingsScope : IDisposable
    {
        private const string Path = "ProjectSettings/ProjectSettings.asset";
        private readonly byte[] originalBytes;
        private readonly UnityEngine.Object[] preloaded;
        private readonly WebGLCompressionFormat compression;
#if UNITY_WEBGL
        private readonly UnityEditor.WebGL.WasmCodeOptimization optimization;
#endif
        private bool disposed;

        public U2BuildSettingsScope()
        {
            RequireCleanAssets(false);
            originalBytes = File.ReadAllBytes(Path);
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
            disposed = true;
            PlayerSettings.WebGL.compressionFormat = compression;
            PlayerSettings.SetPreloadedAssets(preloaded);
#if UNITY_WEBGL
            UnityEditor.WebGL.UserBuildSettings.codeOptimization = optimization;
#endif
            // ProjectSettings is not saved by SaveAssetIfDirty. The supported
            // project save is safe only after excluding every unrelated dirty
            // persistent asset, both before the operation and after callbacks.
            RequireCleanAssets(true);
            if (!EditorApplication.ExecuteMenuItem("File/Save Project"))
                throw new BuildFailedException("Could not save restored build settings");
            if (!originalBytes.SequenceEqual(File.ReadAllBytes(Path)))
                throw new BuildFailedException("Build changed additional PlayerSettings; preserve and inspect the difference");
        }

        private static void RequireCleanAssets(bool allowOwnedSettings)
        {
            foreach (var asset in Resources.FindObjectsOfTypeAll<UnityEngine.Object>())
            {
                if (!EditorUtility.IsPersistent(asset) || !EditorUtility.IsDirty(asset)
                    || (asset.hideFlags & HideFlags.NotEditable) != 0) continue;
                var path = AssetDatabase.GetAssetPath(asset);
                if (string.IsNullOrEmpty(path) || (allowOwnedSettings && path == Path)) continue;
                throw new BuildFailedException("Save or revert unsaved asset before build settings save: " + path);
            }
        }
    }
}
