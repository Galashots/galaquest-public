using NUnit.Framework;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;

namespace GalaQuest.Tests
{
    public sealed class U1MobileCameraEditModeTests : InputTestFixture
    {
        private GameObject hero;
        private GameObject cameraObject;
        private GalaQuestGameplayCamera camera;
        private Touchscreen touchscreen;

        [SetUp]
        public override void Setup()
        {
            base.Setup();
            touchscreen = InputSystem.AddDevice<Touchscreen>();
            hero = new GameObject("Camera test hero");
            cameraObject = new GameObject("Camera test view");
            cameraObject.AddComponent<Camera>();
            camera = cameraObject.AddComponent<GalaQuestGameplayCamera>();
            camera.Configure(hero.transform);
        }

        [TearDown]
        public override void TearDown()
        {
            Object.DestroyImmediate(cameraObject);
            Object.DestroyImmediate(hero);
            base.TearDown();
        }

        [Test]
        public void DragOnFreeScreenRotatesTheView()
        {
            var origin = ScreenPoint(0.7f, 0.65f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, origin);
            Assert.That(Touchscreen.current, Is.SameAs(touchscreen));
            Assert.That(touchscreen.touches[0].press.isPressed, Is.True,
                "the fixture must deliver the touch before testing the camera response");
            var before = camera.transform.rotation;

            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, origin + new Vector2(80f, 20f));

            Assert.That(Quaternion.Angle(before, camera.transform.rotation), Is.GreaterThan(1f),
                "a real touch drag must rotate the runtime camera");
        }

        [Test]
        public void MovementRegionTouchCannotRotateTheCamera()
        {
            var origin = ScreenPoint(0.2f, 0.2f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, origin);
            var before = camera.transform.rotation;

            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, origin + new Vector2(80f, 20f));

            Assert.That(Quaternion.Angle(before, camera.transform.rotation), Is.LessThan(0.001f));
        }

        [Test]
        public void SpreadingTwoFreeTouchesZoomsTowardTheHero()
        {
            var left = ScreenPoint(0.55f, 0.7f);
            var right = ScreenPoint(0.75f, 0.7f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, left);
            Touch(2, UnityEngine.InputSystem.TouchPhase.Began, right);
            var before = Vector3.Distance(camera.transform.position, hero.transform.position);

            Touch(2, UnityEngine.InputSystem.TouchPhase.Moved, right + new Vector2(80f, 0f));

            Assert.That(Vector3.Distance(camera.transform.position, hero.transform.position),
                Is.LessThan(before - 0.05f), "pinch spread must zoom the runtime camera in");
        }

        [Test]
        public void CameraDragRetainsOwnershipWhenItCrossesTheMovementRegion()
        {
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, ScreenPoint(0.7f, 0.65f));
            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, ScreenPoint(0.2f, 0.2f));
            var before = camera.transform.rotation;

            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, ScreenPoint(0.25f, 0.2f));

            Assert.That(Quaternion.Angle(before, camera.transform.rotation), Is.GreaterThan(0.1f));
        }

        [Test]
        public void AddingAndRemovingPinchFingerDoesNotJumpTheView()
        {
            var first = ScreenPoint(0.6f, 0.7f);
            var second = ScreenPoint(0.8f, 0.7f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, first);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, first + Vector2.right * 30f);
            var rotation = camera.transform.rotation;
            var distance = camera.Distance;

            Touch(2, UnityEngine.InputSystem.TouchPhase.Began, second);
            Assert.That(Quaternion.Angle(rotation, camera.transform.rotation), Is.LessThan(0.001f));
            Assert.That(camera.Distance, Is.EqualTo(distance).Within(0.001f));
            Touch(2, UnityEngine.InputSystem.TouchPhase.Ended, second);
            Assert.That(Quaternion.Angle(rotation, camera.transform.rotation), Is.LessThan(0.001f));
            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, first + Vector2.right * 60f);
            Assert.That(Quaternion.Angle(rotation, camera.transform.rotation), Is.GreaterThan(0.1f));
        }

        [Test]
        public void ReplacingAPinchFingerRebasesSeparation()
        {
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, ScreenPoint(0.55f, 0.7f));
            Touch(2, UnityEngine.InputSystem.TouchPhase.Began, ScreenPoint(0.75f, 0.7f));
            var before = camera.Distance;

            QueueTouch(1, UnityEngine.InputSystem.TouchPhase.Ended, ScreenPoint(0.55f, 0.7f));
            QueueTouch(3, UnityEngine.InputSystem.TouchPhase.Began, ScreenPoint(0.9f, 0.9f));
            StepInput();

            Assert.That(camera.Distance, Is.EqualTo(before).Within(0.001f),
                "a new pointer pair must not inherit the previous pair's separation");
        }

        [Test]
        public void MovementThumbAndCameraFingerRemainIndependent()
        {
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, ScreenPoint(0.2f, 0.2f));
            var cameraFinger = ScreenPoint(0.7f, 0.7f);
            Touch(2, UnityEngine.InputSystem.TouchPhase.Began, cameraFinger);
            var rotation = camera.transform.rotation;
            var distance = camera.Distance;

            Touch(2, UnityEngine.InputSystem.TouchPhase.Moved, cameraFinger + Vector2.right * 40f);

            Assert.That(Quaternion.Angle(rotation, camera.transform.rotation), Is.GreaterThan(0.1f));
            Assert.That(camera.Distance, Is.EqualTo(distance).Within(0.001f),
                "the movement thumb must not become a pinch finger");
        }

        [Test]
        public void CancelledTouchAndFreshPressDoNotCarryOldDragDelta()
        {
            var first = ScreenPoint(0.7f, 0.7f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, first);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, first + Vector2.right * 40f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Canceled, first + Vector2.right * 40f);
            var rotation = camera.transform.rotation;

            Touch(2, UnityEngine.InputSystem.TouchPhase.Began, ScreenPoint(0.55f, 0.9f));

            Assert.That(Quaternion.Angle(rotation, camera.transform.rotation), Is.LessThan(0.001f));
        }

        [Test]
        public void BlockingInputRequiresAFreshPressBeforeCameraControlResumes()
        {
            var first = ScreenPoint(0.7f, 0.7f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, first);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, first + Vector2.right * 40f);
            var rotation = camera.transform.rotation;
            camera.SetInputBlocked(true);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, first + Vector2.right * 60f);
            camera.SetInputBlocked(false);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, first + Vector2.right * 80f);

            Assert.That(Quaternion.Angle(rotation, camera.transform.rotation), Is.LessThan(0.001f));
        }

        [Test]
        public void MovementBasisFollowsTheRotatedViewAndPreservesInputMagnitude()
        {
            var first = ScreenPoint(0.7f, 0.7f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, first);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, first + new Vector2(80f, -30f));
            var forward = camera.transform.forward;
            var expected = new Vector2(forward.x, forward.z).normalized;

            Assert.That(Vector2.Distance(camera.ToWorldDirection(Vector2.up), expected), Is.LessThan(0.001f));
            Assert.That(camera.ToWorldDirection(new Vector2(0.3f, 0.4f)).magnitude,
                Is.EqualTo(0.5f).Within(0.001f));
            Assert.That(camera.ToWorldDirection(Vector2.zero), Is.EqualTo(Vector2.zero));
        }

        [Test]
        public void ObstructionPullsCameraForwardAndRemovingItRestoresRequestedZoom()
        {
            var requested = camera.Distance;
            var center = hero.transform.position + new Vector3(0f, 0.6f, 0f);
            var obstruction = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                obstruction.transform.position = Vector3.Lerp(center, camera.transform.position, 0.5f);
                obstruction.transform.localScale = Vector3.one * 2f;
                Physics.SyncTransforms();
                camera.FollowNow();
                Assert.That(Vector3.Distance(center, camera.transform.position), Is.LessThan(requested - 1f));
                Assert.That(obstruction.GetComponent<Collider>().bounds.Contains(camera.transform.position), Is.False);
                Assert.That(camera.Distance, Is.EqualTo(requested), "obstruction must not overwrite the player's zoom choice");
                obstruction.SetActive(false);
                Physics.SyncTransforms();
                camera.FollowNow();
                Assert.That(Vector3.Distance(center, camera.transform.position), Is.EqualTo(requested).Within(0.001f));
            }
            finally { Object.DestroyImmediate(obstruction); }
        }

        [Test]
        public void ExtremeVerticalDragCannotFlipViewUnderGroundOrOverTheHero()
        {
            var origin = ScreenPoint(0.7f, 0.7f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, origin);
            foreach (var offset in new[] { 100000f, -100000f })
            {
                Touch(1, UnityEngine.InputSystem.TouchPhase.Moved, origin + Vector2.up * offset);
                Assert.That(camera.transform.forward.y, Is.LessThan(0f), "camera must look down toward the hero");
                Assert.That(Vector3.Dot(camera.transform.up, Vector3.up), Is.GreaterThan(0.1f), "view must remain upright");
                Assert.That(camera.transform.position.y, Is.GreaterThan(hero.transform.position.y));
            }
        }

        private void Touch(int id, UnityEngine.InputSystem.TouchPhase phase, Vector2 position)
        {
            QueueTouch(id, phase, position);
            StepInput();
        }

        private void QueueTouch(int id, UnityEngine.InputSystem.TouchPhase phase, Vector2 position)
        {
            InputSystem.QueueStateEvent(touchscreen, new TouchState
            {
                touchId = id,
                phase = phase,
                position = position
            });
        }

        private void StepInput()
        {
            InputSystem.Update();
            // SendMessage refuses MonoBehaviour updates outside Play Mode. Invoke
            // the real input callback directly while keeping the input devices real.
            typeof(GalaQuestGameplayCamera).GetMethod("Update",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                ?.Invoke(camera, null);
            camera.FollowNow();
        }

        private static Vector2 ScreenPoint(float x, float y)
        {
            return new Vector2(Mathf.Max(1, Screen.width) * x, Mathf.Max(1, Screen.height) * y);
        }
    }
}
