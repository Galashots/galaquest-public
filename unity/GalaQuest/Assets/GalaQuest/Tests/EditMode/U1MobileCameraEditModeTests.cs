using NUnit.Framework;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;

namespace GalaQuest.Tests
{
    public sealed class U1MobileCameraEditModeTests
    {
        private GameObject hero;
        private GameObject cameraObject;
        private GalaQuestGameplayCamera camera;
        private Touchscreen touchscreen;

        [SetUp]
        public void SetUp()
        {
            touchscreen = InputSystem.AddDevice<Touchscreen>();
            hero = new GameObject("Camera test hero");
            cameraObject = new GameObject("Camera test view");
            cameraObject.AddComponent<Camera>();
            camera = cameraObject.AddComponent<GalaQuestGameplayCamera>();
            camera.Configure(hero.transform);
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(cameraObject);
            Object.DestroyImmediate(hero);
            InputSystem.RemoveDevice(touchscreen);
        }

        [Test]
        public void DragOnFreeScreenRotatesTheView()
        {
            var origin = ScreenPoint(0.7f, 0.65f);
            Touch(1, UnityEngine.InputSystem.TouchPhase.Began, origin);
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

        private void Touch(int id, UnityEngine.InputSystem.TouchPhase phase, Vector2 position)
        {
            InputSystem.QueueStateEvent(touchscreen, new TouchState
            {
                touchId = id,
                phase = phase,
                position = position
            });
            InputSystem.Update();
            camera.SendMessage("Update", SendMessageOptions.DontRequireReceiver);
            camera.FollowNow();
        }

        private static Vector2 ScreenPoint(float x, float y)
        {
            return new Vector2(Mathf.Max(1, Screen.width) * x, Mathf.Max(1, Screen.height) * y);
        }
    }
}
