using UnityEngine;
using UnityEngine.InputSystem;

namespace GalaQuest
{
    /// <summary>
    /// Owns one touch in the same forgiving lower-left region as the accepted browser client.
    /// The first valid touch becomes the transient origin; all other touches remain available.
    /// </summary>
    [DefaultExecutionOrder(-200)]
    public sealed class GalaQuestFloatingJoystick : MonoBehaviour
    {
        private const float BaselineRadiusPixels = 64f;
        private const float RadiusHeightFraction = BaselineRadiusPixels / 600f;
        private const float MaximumRadiusPixels = 112f;
        private const int CircleTextureSize = 128;

        private readonly GalaQuestFloatingJoystickState state = new GalaQuestFloatingJoystickState();
        private Texture2D circleTexture;

        public bool Active => state.Active;
        public Vector2 Value => state.Value;
        public float Magnitude => state.Magnitude;

        private void Awake()
        {
            circleTexture = BuildCircleTexture();
            GalaQuestBrowserInterop.ConfigureTouchSurface();
        }

        private void Update()
        {
            PollTouches(Touchscreen.current);
        }

        private void PollTouches(Touchscreen touchscreen)
        {
            if (touchscreen == null)
            {
                state.Cancel();
                return;
            }

            if (state.Active)
            {
                var foundOwner = false;
                foreach (var touch in touchscreen.touches)
                {
                    if (touch.touchId.ReadValue() != state.PointerId) continue;
                    foundOwner = true;
                    var phase = touch.phase.ReadValue();
                    if (touch.press.wasReleasedThisFrame
                        || !touch.press.isPressed
                        || phase == UnityEngine.InputSystem.TouchPhase.Ended
                        || phase == UnityEngine.InputSystem.TouchPhase.Canceled)
                    {
                        state.End(state.PointerId);
                    }
                    else
                    {
                        state.Move(state.PointerId, touch.position.ReadValue());
                    }
                    break;
                }
                if (!foundOwner) state.Cancel();
            }

            if (state.Active) return;
            foreach (var touch in touchscreen.touches)
            {
                if (!touch.press.wasPressedThisFrame) continue;
                if (state.TryBegin(
                        touch.touchId.ReadValue(),
                        touch.position.ReadValue(),
                        new Vector2(Screen.width, Screen.height),
                        StickRadiusPixels()))
                {
                    break;
                }
            }
        }

        private void OnApplicationFocus(bool hasFocus)
        {
            if (!hasFocus) state.Cancel();
        }

        private void OnApplicationPause(bool paused)
        {
            if (paused) state.Cancel();
        }

        private void OnDisable() => state.Cancel();

        private void OnDestroy()
        {
            if (circleTexture != null) Destroy(circleTexture);
        }

        private void OnGUI()
        {
            if (!state.Active || circleTexture == null) return;
            var radius = state.Radius;
            var origin = ToGuiPoint(state.Origin);
            var handle = ToGuiPoint(state.Handle);

            DrawCircle(origin, radius, new Color(0.035f, 0.05f, 0.08f, 0.52f));
            DrawCircle(origin, radius * 0.82f, new Color(0.24f, 0.29f, 0.37f, 0.38f));
            var handleColor = state.Magnitude >= GalaQuestMovementLaw.RunDeflection
                ? new Color(1f, 0.48f, 0.12f, 0.92f)
                : new Color(0.88f, 0.91f, 0.94f, 0.90f);
            DrawCircle(handle, radius * 0.43f, handleColor);
        }

        private float StickRadiusPixels()
        {
            return Mathf.Clamp(Screen.height * RadiusHeightFraction, BaselineRadiusPixels, MaximumRadiusPixels);
        }

        private static Vector2 ToGuiPoint(Vector2 screenPoint)
        {
            return new Vector2(screenPoint.x, Screen.height - screenPoint.y);
        }

        private void DrawCircle(Vector2 center, float radius, Color color)
        {
            var previous = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(
                new Rect(center.x - radius, center.y - radius, radius * 2f, radius * 2f),
                circleTexture,
                ScaleMode.StretchToFill,
                true);
            GUI.color = previous;
        }

        private static Texture2D BuildCircleTexture()
        {
            var texture = new Texture2D(CircleTextureSize, CircleTextureSize, TextureFormat.RGBA32, false)
            {
                name = "GalaQuest floating joystick circle",
                hideFlags = HideFlags.HideAndDontSave,
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear
            };
            var pixels = new Color32[CircleTextureSize * CircleTextureSize];
            var center = (CircleTextureSize - 1f) * 0.5f;
            var feather = 2f;
            for (var y = 0; y < CircleTextureSize; y++)
            {
                for (var x = 0; x < CircleTextureSize; x++)
                {
                    var distance = Vector2.Distance(new Vector2(x, y), new Vector2(center, center));
                    var alpha = Mathf.Clamp01((center - distance) / feather);
                    pixels[(y * CircleTextureSize) + x] = new Color(1f, 1f, 1f, alpha);
                }
            }
            texture.SetPixels32(pixels);
            texture.Apply(false, true);
            return texture;
        }
    }

    public sealed class GalaQuestFloatingJoystickState
    {
        public const int NoPointer = -1;
        public const float RegionWidthFraction = 0.45f;
        public const float RegionHeightFraction = 0.55f;

        public bool Active { get; private set; }
        public int PointerId { get; private set; } = NoPointer;
        public Vector2 Origin { get; private set; }
        public Vector2 Handle { get; private set; }
        public Vector2 Direction { get; private set; }
        public float Magnitude { get; private set; }
        public float Radius { get; private set; }
        public Vector2 Value => Direction * Magnitude;

        public bool TryBegin(int pointerId, Vector2 position, Vector2 viewport, float radius)
        {
            if (Active || radius <= 0f || !IsInMovementRegion(position, viewport)) return false;
            Active = true;
            PointerId = pointerId;
            Origin = position;
            Handle = position;
            Direction = Vector2.zero;
            Magnitude = 0f;
            Radius = radius;
            return true;
        }

        public bool Move(int pointerId, Vector2 position)
        {
            if (!Active || pointerId != PointerId) return false;
            var delta = position - Origin;
            var distance = delta.magnitude;
            Direction = distance > 0f ? delta / distance : Vector2.zero;
            Magnitude = Mathf.Clamp01(distance / Radius);
            Handle = Origin + Vector2.ClampMagnitude(delta, Radius);
            return true;
        }

        public bool End(int pointerId)
        {
            if (!Active || pointerId != PointerId) return false;
            Cancel();
            return true;
        }

        public void Cancel()
        {
            Active = false;
            PointerId = NoPointer;
            Origin = Vector2.zero;
            Handle = Vector2.zero;
            Direction = Vector2.zero;
            Magnitude = 0f;
            Radius = 0f;
        }

        public static bool IsInMovementRegion(Vector2 position, Vector2 viewport)
        {
            return viewport.x > 0f
                   && viewport.y > 0f
                   && position.x >= 0f
                   && position.y >= 0f
                   && position.x <= viewport.x * RegionWidthFraction
                   && position.y <= viewport.y * RegionHeightFraction;
        }
    }
}
