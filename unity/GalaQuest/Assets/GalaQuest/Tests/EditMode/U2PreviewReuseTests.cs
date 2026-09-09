using System;
using System.IO;
using System.Linq;
using GalaQuest.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace GalaQuest.Tests
{
    public sealed class U2PreviewReuseTests
    {
        [Test]
        public void PreparationReusesOutputsAndPreservesUnsavedScene()
        {
            if (!File.Exists(Path.Combine(U2CombatPreview.CandidateDirectory, "lava-gremlin-local-v1.fbx")))
                Assert.Ignore("Requires the exact custody-tier gremlin input");
            var previous = SceneManager.GetActiveScene();
            // Unity Test Framework supplies an untitled default scene. Name this
            // runner-owned scene so Unity permits additive preservation fixtures.
            if (string.IsNullOrEmpty(previous.path))
                Assert.That(EditorSceneManager.SaveScene(previous, Path.Combine(U2CombatPreview.RepoRoot,
                    ".local/throughput/test-runner-" + Guid.NewGuid().ToString("N") + ".unity")), Is.True);
            var userScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
            var userScenePath = "Assets/U2ReuseTest-" + Guid.NewGuid().ToString("N") + ".unity";
            Assert.That(EditorSceneManager.SaveScene(userScene, userScenePath), Is.True);
            SceneManager.SetActiveScene(userScene);
            var marker = new GameObject("Unsaved owner work");
            EditorSceneManager.MarkSceneDirty(userScene);
            try
            {
                var watch = System.Diagnostics.Stopwatch.StartNew();
                var content = U2CombatPreview.Prepare();
                var scene = U2CombatPreview.PrepareScene(content);
                var firstSeconds = watch.Elapsed.TotalSeconds;
                var paths = Directory.GetFiles(U2CombatPreview.Temporary, "*", SearchOption.AllDirectories)
                    .Concat(new[] { U2CombatPreview.Temporary + ".meta" }).OrderBy(path => path).ToArray();
                var bytes = paths.Select(File.ReadAllBytes).ToArray();
                var times = paths.Select(File.GetLastWriteTimeUtc).ToArray();
                watch.Restart();
                Assert.That(U2CombatPreview.Prepare(), Is.SameAs(content));
                Assert.That(U2CombatPreview.PrepareScene(content), Is.EqualTo(scene));
                var repeatSeconds = watch.Elapsed.TotalSeconds;
                Assert.That(paths.Select(File.GetLastWriteTimeUtc), Is.EqualTo(times));
                for (var i = 0; i < paths.Length; i++) Assert.That(File.ReadAllBytes(paths[i]), Is.EqualTo(bytes[i]), paths[i]);
                Assert.That(userScene.isLoaded && userScene.isDirty, Is.True);
                Assert.That(marker != null && marker.scene == userScene, Is.True);
                Assert.That(SceneManager.GetActiveScene(), Is.EqualTo(userScene));
                File.WriteAllText(Path.Combine(U2CombatPreview.RepoRoot, ".local/throughput/b-preparation-timing.txt"),
                    FormattableString.Invariant($"firstSeconds={firstSeconds}\nrepeatSeconds={repeatSeconds}\nfiles={paths.Length}\nunity={Application.unityVersion}"));

                // A foreign addition must block reuse without being removed.
                var foreign = U2CombatPreview.Temporary + "/owner-note.txt";
                File.WriteAllText(foreign, "retain me");
                try
                {
                    Assert.Throws<BuildFailedException>(() => U2CombatPreview.Prepare());
                    Assert.That(File.ReadAllText(foreign), Is.EqualTo("retain me"));
                }
                finally
                {
                    File.Delete(foreign);
                    if (File.Exists(foreign + ".meta")) File.Delete(foreign + ".meta");
                }

                var texture = Path.Combine(U2CombatPreview.CandidateDirectory, "../gremlin-body/texture_0_base_color.png");
                var originalTexture = File.ReadAllBytes(texture);
                try
                {
                    // PNG permits trailing bytes. Change the actual custody input
                    // without requiring a replacement candidate or changing art.
                    File.WriteAllBytes(texture, originalTexture.Concat(new byte[] { 0 }).ToArray());
                    var regenerated = U2CombatPreview.Prepare();
                    Assert.That(regenerated, Is.Not.Null);
                    Assert.That(File.ReadAllBytes(U2CombatPreview.Temporary + "/GremlinColor.png"),
                        Is.EqualTo(File.ReadAllBytes(texture)), "Changed input must reach the generated source");
                    Assert.That(File.Exists(scene), Is.False, "An old generated scene must not survive invalidation");
                    U2CombatPreview.PrepareScene(regenerated);
                }
                finally
                {
                    File.WriteAllBytes(texture, originalTexture);
                }
            }
            finally
            {
                EditorSceneManager.CloseScene(userScene, true);
                AssetDatabase.DeleteAsset(userScenePath);
                if (previous.IsValid()) SceneManager.SetActiveScene(previous);
            }
        }
    }
}
