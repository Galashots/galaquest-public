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
