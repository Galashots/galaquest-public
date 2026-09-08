using System.Linq;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class U1HeroLocomotionEditModeTests
    {
        [Test]
        public void ConnectedHeroHasLoopingLocomotionWithoutRootMotion()
        {
            var scene = EditorSceneManager.OpenScene(GalaQuest.Editor.EmberworksGreyboxBuild.ScenePath,
                OpenSceneMode.Additive);
            try
            {
                var hero = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<Transform>(true))
                    .Single(item => item.name == GalaQuest.Editor.EmberworksGreyboxBuild.RuntimeHeroName);
                var animator = hero.GetComponent<Animator>();
                Assert.That(animator, Is.Not.Null, "the connected hero is frozen because no Animator drives its existing rig");
                Assert.That(animator.runtimeAnimatorController, Is.Not.Null);
                Assert.That(animator.applyRootMotion, Is.False, "animation must not move the server-directed hero root");
                var clips = animator.runtimeAnimatorController.animationClips;
                Assert.That(clips.Select(clip => clip.name), Is.EquivalentTo(new[] { "HeroIdle", "HeroWalk", "HeroRun" }));
                Assert.That(clips.All(clip => clip.isLooping && clip.length > 0.5f), Is.True);
            }
            finally { EditorSceneManager.CloseScene(scene, true); }
        }
    }
}
