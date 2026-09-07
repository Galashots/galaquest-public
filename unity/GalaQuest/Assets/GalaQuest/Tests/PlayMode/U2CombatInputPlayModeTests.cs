using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class U2CombatInputPlayModeTests : InputTestFixture
    {
        [UnityTest]
        public IEnumerator AttackFingerCannotStealMovementOrOrbitAndDoesNotRepeatWhileHeld()
        {
            var touchscreen = InputSystem.AddDevice<Touchscreen>();
            var root = new GameObject("Three-finger combat input");
            var joystick = root.AddComponent<GalaQuestFloatingJoystick>();
            var attack = root.AddComponent<GalaQuestAttackControl>();
            var cameraObject = new GameObject("Combat input camera");
            cameraObject.AddComponent<Camera>();
            var camera = cameraObject.AddComponent<GalaQuestGameplayCamera>();
            camera.Configure(root.transform);
            var transport = new FakeTransport();
            using var session = new GalaQuestConnectionSession(transport);
            attack.BindSession(session);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Younger", "[]"));
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");
            try
            {
                yield return null;
                yield return null;
                var movement = new Vector2(Screen.width * .2f, Screen.height * .25f);
                var button = GalaQuestAttackControl.TouchRect(new Vector2(Screen.width, Screen.height)).center;
                var orbit = new Vector2(Screen.width * .65f, Screen.height * .7f);
                BeginTouch(1, movement, screen: touchscreen, queueEventOnly: true);
                yield return null;
                MoveTouch(1, movement + Vector2.up * 50f, screen: touchscreen, queueEventOnly: true);
                BeginTouch(2, button, screen: touchscreen, queueEventOnly: true);
                yield return null;
                Assert.That(joystick.Magnitude, Is.GreaterThan(.2f));
                Assert.That(transport.AttackCount, Is.EqualTo(1));
                var initialYaw = camera.YawDegrees;
                MoveTouch(2, button + Vector2.up * 140f, screen: touchscreen, queueEventOnly: true);
                yield return null;
                Assert.That(camera.YawDegrees, Is.EqualTo(initialYaw).Within(.001f));
                Assert.That(transport.AttackCount, Is.EqualTo(1), "Holding or dragging is not repeated attacking");
                BeginTouch(3, orbit, screen: touchscreen, queueEventOnly: true);
                yield return null;
                MoveTouch(3, orbit + Vector2.right * 70f, screen: touchscreen, queueEventOnly: true);
                yield return null;
                Assert.That(Mathf.Abs(Mathf.DeltaAngle(initialYaw, camera.YawDegrees)), Is.GreaterThan(1));
                Assert.That(joystick.Magnitude, Is.GreaterThan(.2f));
                EndTouch(2, button, screen: touchscreen, queueEventOnly: true);
                yield return null;
                BeginTouch(2, button, screen: touchscreen, queueEventOnly: true);
                yield return null;
                Assert.That(transport.AttackCount, Is.EqualTo(2));
                transport.Close();
                Assert.That(attack.TryAttack(), Is.False);
                EndTouch(1, movement, screen: touchscreen, queueEventOnly: true);
                yield return null;
                Assert.That(joystick.Active, Is.False);
            }
            finally
            {
                attack.BindSession(null);
                UnityEngine.Object.Destroy(root);
                UnityEngine.Object.Destroy(cameraObject);
            }
        }

        [UnityTest]
        public IEnumerator RecoveryRequiresReleasingTheHeldMovementThumb()
        {
            var touchscreen = InputSystem.AddDevice<Touchscreen>();
            var root = new GameObject("Recovery input");
            var hero = new GameObject("Recovery hero");
            hero.transform.position = new Vector3(0, .25f, 8);
            root.AddComponent<GalaQuestFloatingJoystick>();
            var movement = root.AddComponent<GalaQuestTraversalController>();
            movement.Configure(null, hero.transform);
            var transport = new FakeTransport();
            using var session = new GalaQuestConnectionSession(transport);
            movement.BindSession(session);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Younger", "[]"));
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"players\":[{\"id\":\"p1\",\"x\":0,\"z\":8}]}");
            try
            {
                yield return null; yield return null;
                var origin = new Vector2(Screen.width * .2f, Screen.height * .25f);
                BeginTouch(1, origin, screen: touchscreen, queueEventOnly: true);
                yield return null;
                MoveTouch(1, origin + Vector2.up * 60, screen: touchscreen, queueEventOnly: true);
                var deadline = Time.realtimeSinceStartup + 2;
                while (movement.PredictedPosition.y < 8.05f && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(movement.PredictedPosition.y, Is.GreaterThan(8.04f));
                transport.Receive("{\"v\":4,\"type\":\"snapshot\",\"players\":[{\"id\":\"p1\",\"x\":0,\"z\":8}],\"encounter\":{\"heroes\":{\"p1\":{\"hp\":0,\"downSeconds\":0.1}}}}");
                yield return null;
                Assert.That(movement.PredictedMotionSpeed, Is.Zero);
                transport.Receive("{\"v\":4,\"type\":\"snapshot\",\"players\":[{\"id\":\"p1\",\"x\":0,\"z\":4}],\"encounter\":{\"heroes\":{\"p1\":{\"hp\":30,\"downSeconds\":-1}}}}");
                yield return null; yield return null;
                Assert.That(movement.PredictedPosition, Is.EqualTo(new Vector2(0, 4)), "held input must not leave the recovery point");
                EndTouch(1, origin, screen: touchscreen, queueEventOnly: true);
                yield return null;
                BeginTouch(1, origin, screen: touchscreen, queueEventOnly: true);
                yield return null;
                MoveTouch(1, origin + Vector2.up * 60, screen: touchscreen, queueEventOnly: true);
                deadline = Time.realtimeSinceStartup + 2;
                while (movement.PredictedPosition.y < 4.05f && Time.realtimeSinceStartup < deadline) yield return null;
                Assert.That(movement.PredictedPosition.y, Is.GreaterThan(4.04f));
            }
            finally
            {
                UnityEngine.Object.Destroy(root);
                UnityEngine.Object.Destroy(hero);
            }
        }

        private sealed class FakeTransport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            private readonly List<string> sent = new List<string>();
            public int AttackCount => sent.Count(packet => packet.Contains("\"type\":\"attack\""));
            public void Connect() { }
            public bool Send(string message) { sent.Add(message); return true; }
            public void Close() => Closed?.Invoke("interrupted");
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
        }
    }
}
