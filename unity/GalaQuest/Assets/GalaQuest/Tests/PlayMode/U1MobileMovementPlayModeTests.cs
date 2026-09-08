using System;
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class U1MobileMovementPlayModeTests : InputTestFixture
    {
        [UnityTest]
        public IEnumerator RotatedViewDrivesBothNetworkIntentAndLocalPrediction()
        {
            var touchscreen = InputSystem.AddDevice<Touchscreen>();
            var keyboard = InputSystem.AddDevice<Keyboard>();
            var root = new GameObject("M1 input test root");
            root.SetActive(false);
            var hero = new GameObject("M1 input test hero");
            hero.transform.position = new Vector3(0f, 0.25f, 12f);
            var cameraObject = new GameObject("M1 input test camera");
            cameraObject.tag = "MainCamera";
            cameraObject.AddComponent<Camera>();
            var camera = cameraObject.AddComponent<GalaQuestGameplayCamera>();
            camera.Configure(hero.transform);
            var actions = ScriptableObject.CreateInstance<InputActionAsset>();
            var map = actions.AddActionMap("Player");
            map.AddAction("Move", InputActionType.Value).AddCompositeBinding("2DVector")
                .With("Up", "<Keyboard>/w");
            map.AddAction("Sprint", InputActionType.Button, "<Keyboard>/leftShift");
            var traversal = root.AddComponent<GalaQuestTraversalController>();
            traversal.Configure(actions, hero.transform);
            var transport = new FakeTransport();
            var session = new GalaQuestConnectionSession(transport);
            traversal.BindSession(session);
            try
            {
                session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Camera test", "[]"));
                transport.Open();
                transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"players\":[{\"id\":\"p1\",\"x\":0,\"z\":12}]}");
                root.SetActive(true);
                // Let the new objects receive their initial focus/enable callbacks before input begins.
                yield return null;
                yield return null;
                var touchOrigin = new Vector2(Screen.width * 0.7f, Screen.height * 0.7f);
                BeginTouch(1, touchOrigin, screen: touchscreen, queueEventOnly: true);
                yield return null;
                Assert.That(touchscreen.touches[0].press.isPressed, Is.True, "the player loop must receive the press");
                MoveTouch(1, touchOrigin + Vector2.right * Screen.height * 0.15f,
                    screen: touchscreen, queueEventOnly: true);
                yield return null;
                yield return null;
                var forward = camera.transform.forward;
                var expected = new Vector2(forward.x, forward.z).normalized;
                Assert.That(Mathf.Abs(expected.x), Is.GreaterThan(0.2f), "the camera must actually rotate");
                var start = traversal.PredictedPosition;
                InputSystem.QueueStateEvent(keyboard, new KeyboardState(Key.W));
                // A headless player can render hundreds of frames before 50 ms elapse.
                // Wait for displacement with a wall-clock deadline, not a frame-rate assumption.
                var deadline = Time.realtimeSinceStartup + 2f;
                while ((traversal.PredictedPosition - start).magnitude < 0.05f && Time.realtimeSinceStartup < deadline)
                    yield return null;
                var displacement = traversal.PredictedPosition - start;
                Assert.That(displacement.magnitude, Is.GreaterThanOrEqualTo(0.05f));
                Assert.That(Vector2.Dot(displacement.normalized, expected), Is.GreaterThan(0.999f),
                    "the actual traversal Update must predict movement in the rotated view direction");
                var wire = JsonUtility.FromJson<InputPacket>(transport.Sent.FindLast(IsInput));
                Assert.That(Vector2.Distance(new Vector2(wire.dirX, wire.dirZ), expected), Is.LessThan(0.001f),
                    "the actual session must send the same direction that local prediction used");
                InputSystem.QueueStateEvent(keyboard, new KeyboardState());
                yield return null;
                wire = JsonUtility.FromJson<InputPacket>(transport.Sent.FindLast(IsInput));
                Assert.That(wire.magnitude, Is.Zero, "release must still reach the server immediately");
            }
            finally
            {
                session.Dispose();
                UnityEngine.Object.Destroy(root);
                UnityEngine.Object.Destroy(hero);
                UnityEngine.Object.Destroy(cameraObject);
                UnityEngine.Object.Destroy(actions);
            }
        }

        private static bool IsInput(string value) => value.Contains("\"type\":\"input\"");
        [Serializable] private sealed class InputPacket { public float dirX; public float dirZ; public float magnitude; }
        private sealed class FakeTransport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public readonly List<string> Sent = new List<string>();
            public void Connect() { }
            public bool Send(string message) { Sent.Add(message); return true; }
            public void Close() => Closed?.Invoke("closed");
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
        }
    }
}
