using System;
using System.IO;
using GalaQuest.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class U2BuildSettingsScopeTests
    {
        [Test]
        public void RestoresDiskSettingsAndRejectsUnrelatedUnsavedAssets()
        {
            var path = "Assets/U2SettingsTest-" + Guid.NewGuid().ToString("N") + ".asset";
            var fixture = new TextAsset("Owned preload fixture");
            AssetDatabase.CreateAsset(fixture, path);
            AssetDatabase.SaveAssetIfDirty(fixture);
            var before = File.ReadAllBytes("ProjectSettings/ProjectSettings.asset");
            var originalPreloads = PlayerSettings.GetPreloadedAssets();
            var originalCompression = PlayerSettings.WebGL.compressionFormat;
            try
            {
                using (var scope = new U2BuildSettingsScope())
                {
                    scope.UseFastReview();
                    PlayerSettings.SetPreloadedAssets(new UnityEngine.Object[] { fixture });
                    Assert.That(EditorApplication.ExecuteMenuItem("File/Save Project"), Is.True);
                    Assert.That(File.ReadAllBytes("ProjectSettings/ProjectSettings.asset"), Is.Not.EqualTo(before),
                        "The probe must reproduce the build-produced settings write");
                }
                Assert.That(File.ReadAllBytes("ProjectSettings/ProjectSettings.asset"), Is.EqualTo(before));
                Assert.That(PlayerSettings.GetPreloadedAssets(), Is.EqualTo(originalPreloads));
                Assert.That(PlayerSettings.WebGL.compressionFormat, Is.EqualTo(originalCompression));

                EditorUtility.SetDirty(fixture);
                var timestamp = File.GetLastWriteTimeUtc(path);
                Assert.Throws<BuildFailedException>(() => new U2BuildSettingsScope());
                Assert.That(EditorUtility.IsDirty(fixture), Is.True, "Do not silently save unrelated dirty assets");
                Assert.That(File.GetLastWriteTimeUtc(path), Is.EqualTo(timestamp));
            }
            finally { AssetDatabase.DeleteAsset(path); }
        }
    }
}
