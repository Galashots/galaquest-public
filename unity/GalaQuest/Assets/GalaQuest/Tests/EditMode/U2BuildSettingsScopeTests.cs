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
        public void LogicalSettingsComparisonAllowsOnlyLineEndingEncodingDrift()
        {
            var compare = typeof(U2BuildSettingsScope).GetMethod("SameSerializedContent",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(compare, Is.Not.Null, "The settings invariant must remain order-sensitive and testable");
            bool Same(string left, string right) => (bool)compare.Invoke(null, new object[]
            {
                new System.Text.UTF8Encoding(false).GetBytes(left),
                new System.Text.UTF8Encoding(false).GetBytes(right)
            });

            const string canonical = "first: 1\nlist:\n  - duplicate\n  - duplicate\nlast: true\n";
            Assert.That(Same(canonical, canonical.Replace("\n", "\r\n")), Is.True,
                "Build #15 established CRLF encoding churn only");
            Assert.That(Same(canonical, canonical.Replace("\n", "\r")), Is.True,
                "CR-only line endings are also canonicalized to LF");

            Assert.That(Same(canonical, canonical.Replace("last: true", "last: false")), Is.False,
                "a serialized value change must fail");
            Assert.That(Same(canonical, "first: 1\nlist:\n  - duplicate\nlast: true\n"), Is.False,
                "a duplicate-line change must fail");
            Assert.That(Same(canonical, "first: 1\n  - duplicate\nlist:\n  - duplicate\nlast: true\n"), Is.False,
                "a reordered serialized line must fail");
            Assert.That(Same(canonical, canonical.Replace("last: true\n", "added: false\nlast: true\n")), Is.False,
                "an added serialized line must fail");
            Assert.That(Same(canonical, canonical.Replace("  - duplicate", "   - duplicate")), Is.False,
                "meaningful intra-line whitespace must fail");
            Assert.That(Same(canonical, canonical.TrimEnd('\n')), Is.False,
                "the observed evidence did not authorize terminal-newline normalization");
        }

        [Test]
        public void RejectsUnrelatedPlayerSettingsMutationAndUnsavedAssets()
        {
            var path = "Assets/U2SettingsTest-" + Guid.NewGuid().ToString("N") + ".asset";
            var fixture = new TextAsset("Owned preload fixture");
            AssetDatabase.CreateAsset(fixture, path);
            AssetDatabase.SaveAssetIfDirty(fixture);
            var before = File.ReadAllBytes("ProjectSettings/ProjectSettings.asset");
            var originalPreloads = PlayerSettings.GetPreloadedAssets();
            var originalCompression = PlayerSettings.WebGL.compressionFormat;
            var originalProductName = PlayerSettings.productName;
            try
            {
                var scope = new U2BuildSettingsScope();
                try
                {
                    scope.UseFastReview();
                    PlayerSettings.SetPreloadedAssets(new UnityEngine.Object[] { fixture });
                    PlayerSettings.productName = originalProductName + " U2 Scope Probe";
                    Assert.That(EditorApplication.ExecuteMenuItem("File/Save Project"), Is.True);
                    Assert.That(File.ReadAllBytes("ProjectSettings/ProjectSettings.asset"), Is.Not.EqualTo(before),
                        "The probe must reproduce the build-produced settings write");

                    var error = Assert.Throws<BuildFailedException>(() => scope.Dispose());
                    Assert.That(error.Message, Does.Contain("ProjectSettings/ProjectSettings.asset"));
                }
                finally
                {
                    PlayerSettings.productName = originalProductName;
                    Assert.That(EditorApplication.ExecuteMenuItem("File/Save Project"), Is.True);
                    scope.Abort();
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
            finally
            {
                PlayerSettings.productName = originalProductName;
                EditorApplication.ExecuteMenuItem("File/Save Project");
                AssetDatabase.DeleteAsset(path);
            }
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

        [Test]
        public void CleanupFailureCannotLeaveACandidateSuccessManifest()
        {
            var settingsField = typeof(U2CombatPreview).GetField("cloudSettings",
                BindingFlags.NonPublic | BindingFlags.Static);
            var sourceField = typeof(U2CombatPreview).GetField("cloudSourceSha",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.That(settingsField, Is.Not.Null);
            Assert.That(sourceField, Is.Not.Null);

            var dirtyPath = "Assets/U2CleanupFailure-" + Guid.NewGuid().ToString("N") + ".asset";
            var output = Path.Combine(U2CombatPreview.RepoRoot, ".local/throughput/cleanup-failure-" + Guid.NewGuid().ToString("N"));
            var finalManifest = Path.Combine(output, "candidate-build-manifest.json");
            Directory.CreateDirectory(output);
            File.WriteAllText(finalManifest, "stale manifest must not survive cleanup failure");
            var fixture = new TextAsset("Dirty persistent asset blocks scope disposal");
            AssetDatabase.CreateAsset(fixture, dirtyPath);
            AssetDatabase.SaveAssetIfDirty(fixture);
            try
            {
                settingsField.SetValue(null, new U2BuildSettingsScope());
                sourceField.SetValue(null, "test-source");
                EditorUtility.SetDirty(fixture);

                Assert.Throws<AggregateException>(() => U2CombatPreview.PostExport(output),
                    "a validation failure plus failed cleanup must preserve both failures");
                Assert.That(File.Exists(finalManifest), Is.False,
                    "a stale receipt cannot masquerade as a successful candidate after cleanup fails");
                Assert.That(settingsField.GetValue(null), Is.Null,
                    "failed disposal relinquishes static cloud ownership before Editor shutdown");
                Assert.That(sourceField.GetValue(null), Is.Null);
            }
            finally
            {
                settingsField.SetValue(null, null);
                sourceField.SetValue(null, null);
                AssetDatabase.DeleteAsset(dirtyPath);
                if (Directory.Exists(output)) Directory.Delete(output, true);
            }
        }
    }
}
