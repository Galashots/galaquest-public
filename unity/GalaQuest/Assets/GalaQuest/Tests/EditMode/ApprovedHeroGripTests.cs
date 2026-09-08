using System;
using System.IO;
using System.Linq;
using GalaQuest.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class ApprovedHeroGripTests
    {
        [Test]
        public void CommittedPlaytestSceneAndSpawnPrefabUseApprovedMeshWithoutLocalCandidateFiles()
        {
            var approved = HeroGripAuthoring.LoadApproved();
            var approvedBody = approved.GetComponentsInChildren<SkinnedMeshRenderer>().Single();
            Assert.That(approvedBody.sharedMesh.vertexCount, Is.EqualTo(13587));
            Assert.That(approvedBody.sharedMesh.triangles.Length / 3, Is.EqualTo(12140));
            Assert.That(approvedBody.bones.Length, Is.EqualTo(24));
            var original = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/GalaQuest/Gear/Prefabs/GQ_HERO_V1.prefab")
                .GetComponentsInChildren<SkinnedMeshRenderer>().Single();
            Assert.That(original.sharedMesh.vertexCount, Is.EqualTo(8247));
            Assert.That(approvedBody.sharedMesh.bindposes, Is.EqualTo(original.sharedMesh.bindposes));
            Assert.That(approvedBody.bones.Select(bone => bone.name), Is.EqualTo(original.bones.Select(bone => bone.name)));
            using var sha = System.Security.Cryptography.SHA256.Create();
            Assert.That(BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(U2CombatPreview.HeroSource))).Replace("-", "").ToLowerInvariant(),
                Is.EqualTo("23c161a6a7045987f54b2dae370d02c665d169aefa0c8b6377ca5ee82c893351"));
            var setup = EditorSceneManager.GetSceneManagerSetup();
            try
            {
                EditorSceneManager.OpenScene(EmberworksGreyboxBuild.ScenePath, OpenSceneMode.Single);
                var traversal = UnityEngine.Object.FindFirstObjectByType<GalaQuestTraversalController>();
                Assert.That(traversal.Hero.GetComponentsInChildren<SkinnedMeshRenderer>().Single().sharedMesh,
                    Is.SameAs(approvedBody.sharedMesh));
            }
            finally
            {
                if (setup.Any(scene => scene.isLoaded && scene.isActive)) EditorSceneManager.RestoreSceneManagerSetup(setup);
                else EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            }
        }
    }
}
