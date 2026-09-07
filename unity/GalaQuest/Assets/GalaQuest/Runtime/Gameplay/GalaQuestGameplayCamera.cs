using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

namespace GalaQuest
{
    [DefaultExecutionOrder(-150)]
    public sealed class GalaQuestGameplayCamera : MonoBehaviour
    {
        private static readonly Vector3 LookOffset = new Vector3(0f, 0.6f, 0f);
        private static readonly float DefaultDistance = new Vector3(0f, 2.55f, -9.5f).magnitude;
        private static readonly float DefaultPitch = Mathf.Atan2(2.55f, 9.5f) * Mathf.Rad2Deg;
        private const float MinimumDistance = 4f;
        private const float MaximumDistance = 16f;
        private const float MinimumPitch = 10f;
        private const float MaximumPitch = 65f;
        private const float ReferenceHeight = 600f;
        private const float YawRadiansPerPixel = 0.006f;
        private const float PitchRadiansPerPixel = 0.004f;
        private const float DragDeadzonePixels = 4f;
        private const float WheelZoomPerUnit = 0.0015f;

        [SerializeField] private Transform target;
        private readonly List<int> touchIds = new List<int>(2);
        private readonly Vector2[] touchPositions = new Vector2[2];
        private readonly RaycastHit[] obstructionHits = new RaycastHit[16];
        private float yaw;
        private float pitch = DefaultPitch;
        private float distance = DefaultDistance;
        private int previousTouchCount;
        private int previousDragId = -1;
        private Vector2 previousDragPosition;
        private float previousPinchSeparation;
        private int previousPinchFirstId = -1;
        private int previousPinchSecondId = -1;
        private float dragTravel;
        private bool mouseDragging;
        private Vector2 previousMousePosition;
        private bool inputBlocked;

        public float YawDegrees => yaw;
        public float PitchDegrees => pitch;
        public float Distance => distance;

        public Vector2 ToWorldDirection(Vector2 screenDirection)
        {
            var world = Quaternion.Euler(0f, yaw, 0f) * new Vector3(screenDirection.x, 0f, screenDirection.y);
            return new Vector2(world.x, world.z);
        }

        public void Configure(Transform followTarget)
        {
            target = followTarget;
            FollowNow();
        }

        public void SetInputBlocked(bool blocked)
        {
            inputBlocked = blocked;
            if (blocked) ResetGestures();
        }

        private void Update()
        {
            if (inputBlocked) return;
            var anyTouch = PollTouches(Touchscreen.current);
            if (!anyTouch) PollMouse(Mouse.current);
            else mouseDragging = false;
        }

        private bool PollTouches(Touchscreen touchscreen)
        {
            if (touchscreen == null)
            {
                ResetTouches();
                return false;
            }

            // Ended/lost pointers leave ownership before new pointers can enter.
            for (var index = touchIds.Count - 1; index >= 0; index--)
                if (!TryReadTouch(touchscreen, touchIds[index], out _)) touchIds.RemoveAt(index);

            var anyTouch = false;
            var viewport = new Vector2(Mathf.Max(1, Screen.width), Mathf.Max(1, Screen.height));
            foreach (var touch in touchscreen.touches)
            {
                if (!touch.press.isPressed) continue;
                anyTouch = true;
                var id = touch.touchId.ReadValue();
                if (touchIds.Contains(id) || touchIds.Count >= 2 || !touch.press.wasPressedThisFrame) continue;
                if (GalaQuestFloatingJoystickState.IsInMovementRegion(touch.position.ReadValue(), viewport)) continue;
                touchIds.Add(id);
            }

            for (var index = 0; index < touchIds.Count; index++)
                TryReadTouch(touchscreen, touchIds[index], out touchPositions[index]);

            if (touchIds.Count == 1)
            {
                var id = touchIds[0];
                var position = touchPositions[0];
                if (previousTouchCount == 1 && previousDragId == id)
                    ApplyDrag(position - previousDragPosition);
                else dragTravel = 0f;
                previousDragId = id;
                previousDragPosition = position;
            }
            else if (touchIds.Count == 2)
            {
                var separation = Vector2.Distance(touchPositions[0], touchPositions[1]);
                if (previousTouchCount == 2 && previousPinchFirstId == touchIds[0]
                    && previousPinchSecondId == touchIds[1] && previousPinchSeparation > 0f && separation > 0f)
                    distance = Mathf.Clamp(distance * previousPinchSeparation / separation, MinimumDistance, MaximumDistance);
                previousPinchSeparation = separation;
                previousPinchFirstId = touchIds[0];
                previousPinchSecondId = touchIds[1];
                previousDragId = -1;
                dragTravel = 0f;
            }
            else
            {
                previousDragId = -1;
                dragTravel = 0f;
            }
            previousTouchCount = touchIds.Count;
            return anyTouch;
        }

        private static bool TryReadTouch(Touchscreen touchscreen, int id, out Vector2 position)
        {
            foreach (var touch in touchscreen.touches)
            {
                if (touch.touchId.ReadValue() != id || !touch.press.isPressed) continue;
                var phase = touch.phase.ReadValue();
                if (phase == UnityEngine.InputSystem.TouchPhase.Ended || phase == UnityEngine.InputSystem.TouchPhase.Canceled) continue;
                position = touch.position.ReadValue();
                return true;
            }
            position = Vector2.zero;
            return false;
        }

        private void PollMouse(Mouse mouse)
        {
            if (mouse == null) return;
            var position = mouse.position.ReadValue();
            if (mouse.rightButton.wasPressedThisFrame)
            {
                mouseDragging = true;
                previousMousePosition = position;
                dragTravel = 0f;
            }
            if (!mouse.rightButton.isPressed) mouseDragging = false;
            if (mouseDragging) ApplyDrag(position - previousMousePosition);
            previousMousePosition = position;

            var scroll = mouse.scroll.ReadValue().y;
            if (scroll != 0f)
                distance = Mathf.Clamp(distance * Mathf.Exp(-scroll * WheelZoomPerUnit), MinimumDistance, MaximumDistance);
        }

        private void ApplyDrag(Vector2 pixelDelta)
        {
            var normalizedDelta = pixelDelta * (ReferenceHeight / Mathf.Max(1, Screen.height));
            dragTravel += normalizedDelta.magnitude;
            if (dragTravel < DragDeadzonePixels) return;
            // Match the accepted browser direction; Unity touch Y increases upward.
            yaw = Mathf.Repeat(yaw - normalizedDelta.x * YawRadiansPerPixel * Mathf.Rad2Deg, 360f);
            pitch = Mathf.Clamp(pitch - normalizedDelta.y * PitchRadiansPerPixel * Mathf.Rad2Deg,
                MinimumPitch, MaximumPitch);
        }

        private void LateUpdate() => FollowNow();

        public void FollowNow()
        {
            if (target == null) return;
            var center = target.position + LookOffset;
            var rotation = Quaternion.Euler(pitch, yaw, 0f);
            var outward = -(rotation * Vector3.forward);
            var visibleDistance = distance;
            var count = Physics.SphereCastNonAlloc(center, 0.2f, outward, obstructionHits,
                distance, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);
            for (var index = 0; index < count; index++)
            {
                var hit = obstructionHits[index];
                if (hit.transform == target || hit.transform.IsChildOf(target)) continue;
                visibleDistance = Mathf.Min(visibleDistance, Mathf.Max(0.35f, hit.distance - 0.08f));
            }
            transform.SetPositionAndRotation(center + outward * visibleDistance, rotation);
        }

        private void ResetTouches()
        {
            touchIds.Clear();
            previousTouchCount = 0;
            previousDragId = -1;
            previousPinchSeparation = 0f;
            previousPinchFirstId = -1;
            previousPinchSecondId = -1;
            dragTravel = 0f;
        }

        private void ResetGestures()
        {
            ResetTouches();
            mouseDragging = false;
        }

        private void OnApplicationFocus(bool hasFocus) { if (!hasFocus) ResetGestures(); }
        private void OnApplicationPause(bool paused) { if (paused) ResetGestures(); }
        private void OnDisable() => ResetGestures();
    }
}
