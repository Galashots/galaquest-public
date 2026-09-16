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
        public IEnumerator OneFrameCanEmitAtMostOneAttackIntent()
        {
            var root = new GameObject("One-frame attack dedupe");
            var attack = root.AddComponent<GalaQuestAttackControl>();
            var transport = new FakeTransport();
            using var session = new GalaQuestConnectionSession(transport);
            attack.BindSession(session);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Younger", "[]"));
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");
            try
            {
                yield return null;
                Assert.That(attack.TryAttack(), Is.True);
                Assert.That(attack.TryAttack(), Is.False,
                    "two physical input sources observed in one Update must collapse to one attack intent");
                Assert.That(transport.AttackCount, Is.EqualTo(1));

                yield return null;
                Assert.That(attack.TryAttack(), Is.True,
                    "frame dedupe must not suppress a later deliberate press");
                Assert.That(transport.AttackCount, Is.EqualTo(2));
            }
            finally
            {
                attack.BindSession(null);
                UnityEngine.Object.Destroy(root);
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

        [UnityTest]
        public IEnumerator ForgePanelCapturesKeyboardUntilAReleasedFreshPress()
        {
            var keyboard = InputSystem.AddDevice<Keyboard>();
            using var rig = new ForgeInputRig();
            yield return null; yield return null;
            rig.Open(); yield return null;
            var before = rig.Movement.PredictedPosition;
            Press(keyboard.dKey, queueEventOnly: true);
            for (var i = 0; i < 4; i++) yield return null;
            Assert.That(Vector2.Distance(before, rig.Movement.PredictedPosition), Is.LessThan(.001f),
                "A focused question owns keyboard movement, not only the touch joystick.");
            rig.Close();
            for (var i = 0; i < 3; i++) yield return null;
            Assert.That(Vector2.Distance(before, rig.Movement.PredictedPosition), Is.LessThan(.001f),
                "Dismissing cannot turn a held movement key into a fresh gameplay gesture.");
            Release(keyboard.dKey, queueEventOnly: true); yield return null;
            Press(keyboard.dKey, queueEventOnly: true);
            for (var i = 0; i < 4; i++) yield return null;
            Assert.That(Vector2.Distance(before, rig.Movement.PredictedPosition), Is.GreaterThan(.005f));
            Release(keyboard.dKey, queueEventOnly: true);
        }

        [UnityTest]
        public IEnumerator ForgeDismissConsumesTheFrameBeforeGameplayRearms()
        {
            using var rig = new ForgeInputRig();
            yield return null; rig.Open(); yield return null;
            rig.Close();
            Assert.That(rig.Presenter.IsQuestionPanelOpen, Is.False);
            Assert.That(GalaQuestRuneForgePresenter.IsInputCaptured, Is.True,
                "CLOSE consumed this frame; later consumers cannot reuse its mouse press.");
            Assert.That(rig.Attack.TryAttack(), Is.False);
            Assert.That(rig.Wire.AttackCount, Is.Zero);
            yield return null; yield return null;
            Assert.That(GalaQuestRuneForgePresenter.IsInputCaptured, Is.False);
            Assert.That(rig.Attack.TryAttack(), Is.True, "A later deliberate attack must still work.");
        }

        [UnityTest]
        public IEnumerator ForgeClosedStateHasOneOpenTargetAndLateReplyCannotReopenIt()
        {
            using var rig = new ForgeInputRig();
            yield return null; rig.Open(); yield return null; rig.Close();
            Assert.That(rig.OpenControl.gameObject.activeSelf, Is.True);
            Assert.That(rig.RuneControl.gameObject.activeSelf, Is.False,
                "The old answer collider must not compete with OPEN at the same position.");
            Physics.SyncTransforms();
            var finder = typeof(GalaQuestRuneForgePresenter).GetMethod("FindInteractable",
                System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
            var ray = new Ray(rig.OpenControl.transform.position - Vector3.forward * 3, Vector3.forward);
            Assert.That(finder.Invoke(null, new object[] { ray }), Is.SameAs(rig.OpenControl));
            rig.Wire.Receive(ForgeInputRig.ForgeState.Replace("pack-selected", "hint"));
            Assert.That(rig.Presenter.IsQuestionPanelOpen, Is.False,
                "A reply already in flight may hydrate progress but must respect UI dismissal.");
            Assert.That(rig.Presenter.State.selectedPackId, Is.EqualTo("grapheme-er-family"));
            yield return null; rig.Open();
            Assert.That(rig.Presenter.IsQuestionPanelOpen, Is.True);
        }

        [UnityTest]
        public IEnumerator ForgeLeavingRangeDoesNotLeaveAnInvisibleOpenPanel()
        {
            using var rig = new ForgeInputRig();
            yield return null; rig.Open(); yield return null;
            var position = rig.Hero.transform.position;
            rig.Hero.transform.position += Vector3.right * 100;
            // The fixture disables movement only for this displacement check.
            rig.Movement.enabled = false;
            yield return null;
            Assert.That(rig.Presenter.IsQuestionPanelOpen, Is.False);
            rig.Hero.transform.position = position;
            yield return null;
            Assert.That(rig.Presenter.IsQuestionPanelOpen, Is.False,
                "Returning into range must not resurrect the invisible panel.");
            Assert.That(rig.OpenControl.gameObject.activeSelf, Is.True);
            rig.Open(); Assert.That(rig.Presenter.IsQuestionPanelOpen, Is.True);
        }

        private sealed class ForgeInputRig : IDisposable
        {
            public readonly GameObject Root, Hero, Pocket;
            public readonly GalaQuestRuneForgePresenter Presenter;
            public readonly GalaQuestTraversalController Movement;
            public readonly GalaQuestAttackControl Attack;
            public readonly GalaQuestRuneForgeInteractable OpenControl, RuneControl;
            public readonly FakeTransport Wire = new FakeTransport();
            private readonly InputActionAsset actions;
            private readonly GalaQuestConnectionSession session;
            public const string ForgeState = "{\"v\":4,\"type\":\"forge-state\",\"id\":\"p1\",\"destinationId\":\"emberworks-deep\",\"worldEpoch\":0,\"forge\":{\"status\":\"active\",\"selectedPackId\":\"grapheme-er-family\",\"contentVersion\":\"fixture\",\"completedCount\":0,\"requiredSuccesses\":2,\"response\":\"pack-selected\",\"task\":{\"id\":\"fixture-task\",\"displayPrompt\":\"Choose a rune\",\"choices\":[{\"id\":\"a\",\"label\":\"A\"}]}}}";
            public ForgeInputRig()
            {
                Root = new GameObject("Forge input fixture");
                Hero = new GameObject("Fixture hero"); Hero.transform.position = new Vector3(5, 0, 15);
                Pocket = new GameObject("Fixture pocket"); Pocket.transform.position = new Vector3(7.2f, 0, 17.2f);
                OpenControl = Control("open"); RuneControl = Control("rune");
                actions = ScriptableObject.CreateInstance<InputActionAsset>();
                var map = new InputActionMap("Player");
                map.AddAction("Move", InputActionType.Value).AddCompositeBinding("2DVector")
                    .With("Up", "<Keyboard>/w").With("Down", "<Keyboard>/s")
                    .With("Left", "<Keyboard>/a").With("Right", "<Keyboard>/d");
                actions.AddActionMap(map);
                Root.AddComponent<GalaQuestFloatingJoystick>();
                Movement = Root.AddComponent<GalaQuestTraversalController>();
                Movement.Configure(actions, Hero.transform); actions.Enable();
                Attack = Root.AddComponent<GalaQuestAttackControl>();
                Presenter = Root.AddComponent<GalaQuestRuneForgePresenter>();
                Presenter.Configure(Hero.transform, Pocket.transform, null, null, null, null);
                session = new GalaQuestConnectionSession(Wire);
                Movement.BindSession(session); Attack.BindSession(session); Presenter.BindSession(session);
                session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Fixture", "[]")); Wire.Open();
                Wire.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"destinationId\":\"emberworks-deep\",\"worldEpoch\":0,\"players\":[{\"id\":\"p1\",\"x\":5,\"z\":15}]}");
            }
            private GalaQuestRuneForgeInteractable Control(string kind)
            {
                var item = GameObject.CreatePrimitive(PrimitiveType.Cube);
                item.transform.SetParent(Pocket.transform, false);
                var control = item.AddComponent<GalaQuestRuneForgeInteractable>(); control.Configure(kind, "a");
                return control;
            }
            public void Open()
            {
                Invoke("Press", OpenControl);
                Wire.Receive(ForgeState);
                Assert.That(Presenter.IsQuestionPanelOpen, Is.True, "Fixture open must reach the real presenter.");
            }
            public void Close()
            {
                var viewport = new Vector2(Screen.width, Screen.height);
                var point = GalaQuestRuneForgePresenter.QuestionCloseRect(viewport).center;
                Invoke("HandlePanelPointer", -2, new Vector2(point.x, viewport.y - point.y));
            }
            private object Invoke(string method, params object[] args) =>
                typeof(GalaQuestRuneForgePresenter).GetMethod(method,
                    System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                    .Invoke(Presenter, args);
            public void Dispose()
            {
                Presenter.BindSession(null); Movement.BindSession(null); Attack.BindSession(null);
                session.Dispose(); actions.Disable();
                UnityEngine.Object.DestroyImmediate(Root); UnityEngine.Object.DestroyImmediate(Pocket);
                UnityEngine.Object.DestroyImmediate(Hero); UnityEngine.Object.DestroyImmediate(actions);
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
