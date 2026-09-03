using System;
using System.Collections;
using System.Linq;
using GalaQuest.Migration;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class MigrationProofPlayModeTests
    {
        [UnityTest]
        public IEnumerator Proof_scene_loads_with_keeper_skeleton_mesh_and_source_clips()
        {
            var load = SceneManager.LoadSceneAsync(MigrationProofPaths.SceneName, LoadSceneMode.Single);
            Assert.That(load, Is.Not.Null);
            while (!load.isDone)
            {
                yield return null;
            }

            var keeper = GameObject.Find(MigrationProofPaths.KeeperObjectName);
            Assert.That(keeper, Is.Not.Null);
            var identity = keeper.GetComponent<MigrationProofAssetIdentity>();
            Assert.That(identity, Is.Not.Null);
            Assert.That(identity.SemanticId, Is.EqualTo(MigrationProofPaths.KeeperSemanticId));

            var skeleton = keeper.GetComponentsInChildren<Transform>(true)
                .SingleOrDefault(transform => transform.name == "Hips");
            Assert.That(skeleton, Is.Not.Null, "the imported Keeper skeleton must contain Hips");

            var skinnedMeshes = keeper.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            Assert.That(skinnedMeshes, Has.Length.GreaterThanOrEqualTo(1));
            Assert.That(skinnedMeshes.All(renderer => renderer.sharedMesh != null), Is.True);
            Assert.That(skinnedMeshes.All(renderer => renderer.sharedMaterials.Length >= 1), Is.True);
            Assert.That(skinnedMeshes.Sum(renderer => renderer.localBounds.size.magnitude), Is.GreaterThan(0.01f));
            Assert.That(skinnedMeshes.Sum(renderer => renderer.localBounds.size.magnitude), Is.LessThan(100f));

            var animator = keeper.GetComponent<Animator>();
            Assert.That(animator, Is.Not.Null);
            Assert.That(animator.runtimeAnimatorController, Is.Not.Null);
            var clips = animator.runtimeAnimatorController.animationClips
                .Where(clip => clip != null)
                .GroupBy(clip => clip.name, StringComparer.Ordinal)
                .Select(group => group.First())
                .ToArray();
            Assert.That(clips, Has.Length.EqualTo(3));
            Assert.That(clips.Select(ClipIdentity).ToHashSet(StringComparer.Ordinal), Is.EquivalentTo(new[] { "idle", "talk", "wave" }));
        }

        [UnityTest]
        public IEnumerator Keeper_source_animation_advances_in_play_mode()
        {
            var load = SceneManager.LoadSceneAsync(MigrationProofPaths.SceneName, LoadSceneMode.Single);
            Assert.That(load, Is.Not.Null);
            while (!load.isDone)
            {
                yield return null;
            }

            var keeper = GameObject.Find(MigrationProofPaths.KeeperObjectName);
            var animator = keeper.GetComponent<Animator>();
            var clip = animator.runtimeAnimatorController.animationClips
                .FirstOrDefault(candidate => candidate != null && ClipIdentity(candidate) == "wave");
            Assert.That(clip, Is.Not.Null, "the actual source wave take must be imported");

            animator.Play(clip.name, 0, 0f);
            animator.Update(0f);
            var before = animator.GetCurrentAnimatorStateInfo(0).normalizedTime;
            animator.Update(0.15f);
            var after = animator.GetCurrentAnimatorStateInfo(0).normalizedTime;

            Assert.That(after, Is.GreaterThan(before), "the imported source animation did not advance");
        }

        private static string ClipIdentity(UnityEngine.Object clip)
        {
            var separator = clip.name.LastIndexOf('|');
            return separator >= 0 ? clip.name.Substring(separator + 1) : clip.name;
        }
    }
}
