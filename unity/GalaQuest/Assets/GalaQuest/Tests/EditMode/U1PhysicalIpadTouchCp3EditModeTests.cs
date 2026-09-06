using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.InputSystem;

namespace GalaQuest.Tests
{
    public sealed class U1PhysicalIpadTouchCp3EditModeTests
    {
        private static readonly Vector2 Viewport = new Vector2(1000f, 600f);

        [Test]
        public void TouchInsideLowerLeftRegionActivatesAtThumbWithZeroInitialMotion()
        {
            var state = new GalaQuestFloatingJoystickState();

            Assert.That(state.TryBegin(7, new Vector2(200f, 100f), Viewport, 64f), Is.True);
            Assert.That(state.Active, Is.True);
            Assert.That(state.PointerId, Is.EqualTo(7));
            Assert.That(state.Origin, Is.EqualTo(new Vector2(200f, 100f)));
            Assert.That(state.Direction, Is.EqualTo(Vector2.zero));
            Assert.That(state.Magnitude, Is.Zero);
        }

        [Test]
        public void DragProducesUnitDirectionAndMagnitudeBoundedByRadius()
        {
            var state = ActiveState();

            Assert.That(state.Move(7, new Vector2(232f, 132f)), Is.True);
            Assert.That(state.Direction.magnitude, Is.EqualTo(1f).Within(0.0001f));
            Assert.That(state.Magnitude, Is.EqualTo(Mathf.Sqrt(0.5f)).Within(0.0001f));

            Assert.That(state.Move(7, new Vector2(400f, 100f)), Is.True);
            Assert.That(state.Direction, Is.EqualTo(Vector2.right));
            Assert.That(state.Magnitude, Is.EqualTo(1f));
            Assert.That(Vector2.Distance(state.Origin, state.Handle), Is.EqualTo(64f).Within(0.0001f));
        }

        [Test]
        public void ReleaseOutsideRadiusImmediatelyClearsAndHidesStick()
        {
            var state = ActiveState();
            state.Move(7, new Vector2(900f, 500f));

            Assert.That(state.End(7), Is.True);
            Assert.That(state.Active, Is.False);
            Assert.That(state.Direction, Is.EqualTo(Vector2.zero));
            Assert.That(state.Magnitude, Is.Zero);
            Assert.That(state.PointerId, Is.EqualTo(GalaQuestFloatingJoystickState.NoPointer));
        }

        [Test]
        public void CancelledOrInterruptedTouchResolvesSafelyToZero()
        {
            var state = ActiveState();
            state.Move(7, new Vector2(264f, 100f));

            state.Cancel();

            Assert.That(state.Active, Is.False);
            Assert.That(state.Value, Is.EqualTo(Vector2.zero));
        }

        [Test]
        public void ReleasedStickCanBeReacquiredAtANewThumbPosition()
        {
            var state = ActiveState();
            state.End(7);

            Assert.That(state.TryBegin(12, new Vector2(410f, 290f), Viewport, 64f), Is.True);
            Assert.That(state.PointerId, Is.EqualTo(12));
            Assert.That(state.Origin, Is.EqualTo(new Vector2(410f, 290f)));
            Assert.That(state.Magnitude, Is.Zero);
        }

        [TestCase(451f, 100f)]
        [TestCase(100f, 331f)]
        [TestCase(-1f, 100f)]
        [TestCase(100f, -1f)]
        public void TouchOutsideMovementRegionDoesNotMoveHero(float x, float y)
        {
            var state = new GalaQuestFloatingJoystickState();

            Assert.That(state.TryBegin(3, new Vector2(x, y), Viewport, 64f), Is.False);
            Assert.That(state.Active, Is.False);
            Assert.That(state.Value, Is.EqualTo(Vector2.zero));
        }

        [Test]
        public void UnrelatedTouchCannotStealOrReleaseMovementOwnership()
        {
            var state = ActiveState();
            state.Move(7, new Vector2(264f, 100f));

            Assert.That(state.TryBegin(8, new Vector2(300f, 100f), Viewport, 64f), Is.False);
            Assert.That(state.End(8), Is.False);
            Assert.That(state.Active, Is.True);
            Assert.That(state.PointerId, Is.EqualTo(7));
            Assert.That(state.Magnitude, Is.EqualTo(1f));
        }

        [Test]
        public void ExistingActionInputRemainsTheFallbackAndTouchPreservesRunConvention()
        {
            var keyboardOrGamepad = GalaQuestTraversalController.ResolveInput(
                new Vector2(0.3f, 0.4f),
                true,
                false,
                Vector2.zero);
            Assert.That(keyboardOrGamepad.Direction, Is.EqualTo(new Vector2(0.6f, 0.8f)));
            Assert.That(keyboardOrGamepad.Magnitude, Is.EqualTo(0.5f));
            Assert.That(keyboardOrGamepad.Run, Is.True);

            var touch = GalaQuestTraversalController.ResolveInput(
                Vector2.left,
                false,
                true,
                Vector2.up * GalaQuestMovementLaw.RunDeflection);
            Assert.That(touch.Direction, Is.EqualTo(Vector2.up));
            Assert.That(touch.Magnitude, Is.EqualTo(GalaQuestMovementLaw.RunDeflection));
            Assert.That(touch.Run, Is.True, "touch run begins at the established browser deflection");
        }

        [Test]
        public void Cp2InputAssetStillCarriesKeyboardAndGamepadMovementBindings()
        {
            var actions = AssetDatabase.LoadAssetAtPath<InputActionAsset>("Assets/InputSystem_Actions.inputactions");
            var move = actions.FindActionMap("Player", true).FindAction("Move", true);
            var paths = move.bindings.Select(binding => binding.path).ToArray();

            Assert.That(paths, Does.Contain("<Gamepad>/leftStick"));
            Assert.That(paths, Does.Contain("<Keyboard>/w"));
            Assert.That(paths, Does.Contain("<Keyboard>/a"));
            Assert.That(paths, Does.Contain("<Keyboard>/s"));
            Assert.That(paths, Does.Contain("<Keyboard>/d"));
        }

        private static GalaQuestFloatingJoystickState ActiveState()
        {
            var state = new GalaQuestFloatingJoystickState();
            Assert.That(state.TryBegin(7, new Vector2(200f, 100f), Viewport, 64f), Is.True);
            return state;
        }
    }
}
