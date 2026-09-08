using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class U1HeroLocomotionPlayModeTests
    {
        [UnityTest]
        public IEnumerator ExistingHeroBonesAnimateAcrossLoopsWithoutMovingItsRoot()
        {
#if UNITY_EDITOR
            var prefab = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>("Assets/GalaQuest/Gear/Prefabs/GQ_HERO_V1.prefab");
            var controller = UnityEditor.AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(
                "Assets/GalaQuest/Movement/Animation/HeroLocomotion.controller");
            Assert.That(controller, Is.Not.Null);
            var hero = UnityEngine.Object.Instantiate(prefab);
            var animator = hero.GetComponent<Animator>();
            if (animator == null) animator = hero.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            animator.applyRootMotion = false;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            var root = new GameObject("Locomotion integration root");
            var movement = root.AddComponent<GalaQuestTraversalController>();
            movement.Configure(null, hero.transform);
            movement.enabled = false; // This test supplies deterministic prediction steps.
            var transport = new FakeTransport();
            var session = new GalaQuestConnectionSession(transport);
            movement.BindSession(session);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Animation test", "[]"));
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"players\":[{\"id\":\"p1\",\"x\":-3,\"z\":12}]}");
            var presenter = root.AddComponent<GalaQuestHeroLocomotion>();
            presenter.Configure(movement, animator);
            try
            {
                yield return null;
                var bones = hero.GetComponentsInChildren<SkinnedMeshRenderer>().SelectMany(renderer => renderer.bones).Distinct().ToArray();
                Assert.That(bones.Length, Is.GreaterThan(10), "exercise the actual canonical skin, not a proxy skeleton");
                foreach (var speed in new[] { 0f, GalaQuestMovementLaw.WalkSpeed, GalaQuestMovementLaw.RunSpeed })
                {
                    var direction = speed > 0f ? Vector2.up : Vector2.zero;
                    var magnitude = speed > 0f ? 1f : 0f;
                    var run = speed > GalaQuestMovementLaw.WalkSpeed;
                    movement.StepPrediction(direction, magnitude, run, 0.1f);
                    movement.StepPrediction(direction, magnitude, run, 0.1f);
                    for (var frame = 0; frame < 45; frame++) presenter.PresentNow(1f / 60f);
                    Assert.That(animator.GetFloat(GalaQuestHeroLocomotion.SpeedParameter), Is.EqualTo(speed).Within(0.01f),
                        "actual prediction speed must reach the Animator through the runtime presenter");
                    var rootPosition = hero.transform.position;
                    var rootRotation = hero.transform.rotation;
                    // Sampling after several cycles catches non-looping clips that stop at their final pose.
                    animator.Play("Locomotion", 0, 3.1f);
                    animator.Update(0f);
                    var before = bones.Select(bone => bone.localRotation).ToArray();
                    animator.Update(0.25f);
                    var largestChange = bones.Select((bone, index) => Quaternion.Angle(before[index], bone.localRotation)).Max();
                    Assert.That(largestChange, Is.GreaterThan(0.5f), $"bones must keep moving at speed {speed} after several loops");
                    Assert.That(Vector3.Distance(rootPosition, hero.transform.position), Is.LessThan(0.001f));
                    Assert.That(Quaternion.Angle(rootRotation, hero.transform.rotation), Is.LessThan(0.01f));
                }
                movement.StepPrediction(Vector2.zero, 0f, false, 0.1f);
                for (var frame = 0; frame < 45; frame++) presenter.PresentNow(1f / 60f);
                Assert.That(animator.GetFloat(GalaQuestHeroLocomotion.SpeedParameter), Is.Zero.Within(0.01f));
            }
            finally
            {
                session.Dispose();
                UnityEngine.Object.Destroy(root);
                UnityEngine.Object.Destroy(hero);
            }
#else
            Assert.Ignore("Canonical imported source assets are available to the Editor play-mode runner.");
            yield break;
#endif
        }

        private sealed class FakeTransport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public void Connect() { }
            public bool Send(string message) => true;
            public void Close() => Closed?.Invoke("closed");
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
        }
    }
}
