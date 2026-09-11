using System;
using System.IO;
using System.Linq;
using System.Reflection;
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

        [Test]
        public void DisposesAfterBuildSceneOverrideAndRestoresProjectSettings()
        {
            var originalScenes = EditorBuildSettings.scenes;
            var originalScenePaths = originalScenes.Select(scene => scene.path).ToArray();
            var originalEditorBuildSettings = File.ReadAllBytes("ProjectSettings/EditorBuildSettings.asset");
            var originalProjectSettings = File.ReadAllBytes("ProjectSettings/ProjectSettings.asset");
            try
            {
                using (var scope = new U2BuildSettingsScope())
                {
                    EditorBuildSettings.scenes = new[]
                    {
                        new EditorBuildSettingsScene("Assets/GalaQuest/Emberworks/Scenes/EmberworksDeep.unity", true)
                    };
                    Assert.DoesNotThrow(() => scope.Dispose(),
                        "A temporary UBA scene-list override must not block fast-review settings cleanup");
                }

                Assert.That(EditorBuildSettings.scenes.Select(scene => scene.path), Is.EqualTo(originalScenePaths),
                    "Disposal must restore the original UBA scene list");
                Assert.That(File.ReadAllBytes("ProjectSettings/EditorBuildSettings.asset"), Is.EqualTo(originalEditorBuildSettings));
                Assert.That(File.ReadAllBytes("ProjectSettings/ProjectSettings.asset"), Is.EqualTo(originalProjectSettings));
            }
            finally
            {
                EditorBuildSettings.scenes = originalScenes;
                EditorApplication.ExecuteMenuItem("File/Save Project");
            }
        }

        [Test]
        public void PreparationFailureDoesNotSavePartialGeneratedAssets()
        {
            var path = "Assets/U2PartialPreparationTest-" + Guid.NewGuid().ToString("N") + ".asset";
            var scope = new U2BuildSettingsScope();
            try
            {
                var fixture = new TextAsset("Partial generated output");
                AssetDatabase.CreateAsset(fixture, path);
                EditorUtility.SetDirty(fixture);
                Assert.DoesNotThrow(() => scope.Abort(),
                    "A preparation failure must restore untouched settings without saving partial generated assets");
                Assert.That(EditorUtility.IsDirty(fixture), Is.True);
            }
            finally
            {
                scope.Abort();
                AssetDatabase.DeleteAsset(path);
            }
        }

        [Test]
        public void PostExportFailureRestoresBuildSceneAndProjectSettings()
        {
            var settingsField = typeof(U2CombatPreview).GetField("cloudSettings",
                BindingFlags.NonPublic | BindingFlags.Static);
            var sourceField = typeof(U2CombatPreview).GetField("cloudSourceSha",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(settingsField, Is.Not.Null);
            Assert.That(sourceField, Is.Not.Null);

            var originalScenes = EditorBuildSettings.scenes;
            var originalScenePaths = originalScenes.Select(scene => scene.path).ToArray();
            var originalEditorBuildSettings = File.ReadAllBytes("ProjectSettings/EditorBuildSettings.asset");
            var originalProjectSettings = File.ReadAllBytes("ProjectSettings/ProjectSettings.asset");
            try
            {
                settingsField.SetValue(null, new U2BuildSettingsScope());
                sourceField.SetValue(null, "test-source");
                EditorBuildSettings.scenes = new[]
                {
                    new EditorBuildSettingsScene("Assets/GalaQuest/Emberworks/Scenes/EmberworksDeep.unity", true)
                };

                Assert.Throws<BuildFailedException>(() => U2CombatPreview.PostExport(
                    Path.Combine(U2CombatPreview.RepoRoot, ".local/throughput/missing-export")));
                Assert.That(EditorBuildSettings.scenes.Select(scene => scene.path), Is.EqualTo(originalScenePaths));
                Assert.That(File.ReadAllBytes("ProjectSettings/EditorBuildSettings.asset"), Is.EqualTo(originalEditorBuildSettings));
                Assert.That(File.ReadAllBytes("ProjectSettings/ProjectSettings.asset"), Is.EqualTo(originalProjectSettings));
            }
            finally
            {
                settingsField.SetValue(null, null);
                sourceField.SetValue(null, null);
                EditorBuildSettings.scenes = originalScenes;
                EditorApplication.ExecuteMenuItem("File/Save Project");
            }
        }
    }
}
