using System;
using System.IO;
using System.Linq;
using GalaQuest.Editor;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class U2GripPreviewSceneTests
    {
        [Test]
        public void ActualPreviewSceneUsesTheSameHandCandidateForSelfAndRemote()
        {
            if (Environment.GetEnvironmentVariable("GQ_U2_GRIP_REVIEW") != "1")
                Assert.Ignore("Optional custody-tier hand review scene");
            var originalScene = File.ReadAllBytes(EmberworksGreyboxBuild.ScenePath);
            try
            {
                var content = U2CombatPreview.Prepare();
                var scenePath = U2CombatPreview.PrepareScene(content);
                EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
                var traversal = UnityEngine.Object.FindFirstObjectByType<GalaQuestTraversalController>();
                Assert.That(traversal, Is.Not.Null);
                var self = traversal.Hero.GetComponentsInChildren<SkinnedMeshRenderer>().Single();
                var remote = content.HeroPrefab.GetComponentsInChildren<SkinnedMeshRenderer>().Single();
                Assert.That(self.sharedMesh, Is.SameAs(remote.sharedMesh),
                    "The connected scene's local hero must use the same repaired hand as the remote spawn prefab");
                Assert.That(self.bones.Select(b => b.name), Is.EqualTo(remote.bones.Select(b => b.name)));
                Assert.That(File.ReadAllBytes(EmberworksGreyboxBuild.ScenePath), Is.EqualTo(originalScene),
                    "Preparing a candidate scene must not overwrite the canonical Emberworks scene");
            }
            finally { U2CombatPreview.Cleanup(); }
        }
    }
}
