using System;
using UnityEngine;
using UnityEngine.InputSystem;

namespace GalaQuest
{
    [DefaultExecutionOrder(-180)]
    public sealed class GalaQuestAttackControl : MonoBehaviour
    {
        private GalaQuestConnectionSession session;
        private int pointerId = -1;
        private bool down;
        private bool inputBlocked;
        private float pressedAt = float.NegativeInfinity;
        private Texture2D circle;
        private GUIStyle label;

        public event Action AttackRequested;
        public bool CanPress => !inputBlocked && session != null && !string.IsNullOrEmpty(session.PlayerId) && !down;

        // Touch positions use a bottom-left origin. Ownership is chosen on press;
        // an attack finger remains reserved when it moves outside the visible disc.
        public static Rect TouchRect(Vector2 viewport)
        {
            var size = Mathf.Clamp(viewport.y * .14f, 72f, 120f);
            var margin = Mathf.Max(18f, viewport.y * .035f);
            return new Rect(viewport.x - size - margin, margin, size, size);
        }

        public static bool IsInAttackRegion(Vector2 position, Vector2 viewport) => TouchRect(viewport).Contains(position);

        public void BindSession(GalaQuestConnectionSession value)
        {
            if (session != null)
            {
                session.ServerFrameReceived -= ApplyFrame;
                session.Disconnected -= Cancel;
            }
            session = value;
            down = false;
            Cancel();
            if (session != null)
            {
                session.ServerFrameReceived += ApplyFrame;
                session.Disconnected += Cancel;
            }
        }

        private void ApplyFrame(GalaQuestServerFrame frame)
        {
            if (session != null && frame.encounter.heroes.TryGetValue(session.PlayerId, out var hero) && hero != null)
                down = hero.hp <= 0 || hero.downSeconds >= 0;
        }

        public bool TryAttack()
        {
            if (!CanPress || !session.TrySendAttackIntent()) return false;
            pressedAt = Time.unscaledTime;
            AttackRequested?.Invoke();
            return true;
        }

        private void Update()
        {
            if (inputBlocked) return;
            var touchscreen = Touchscreen.current;
            var anyTouch = false;
            var ownerPresent = false;
            if (touchscreen != null)
                foreach (var touch in touchscreen.touches)
                    if (touch.press.isPressed)
                    {
                        anyTouch = true;
                        if (touch.touchId.ReadValue() == pointerId) ownerPresent = true;
                    }
            if (!ownerPresent) pointerId = -1;
            if (touchscreen != null && pointerId < 0)
                foreach (var touch in touchscreen.touches)
                {
                    if (!touch.press.wasPressedThisFrame || !touch.press.isPressed
                        || !IsInAttackRegion(touch.position.ReadValue(), new Vector2(Screen.width, Screen.height))) continue;
                    pointerId = touch.touchId.ReadValue();
                    TryAttack();
                    break;
                }
            if (Keyboard.current != null && Keyboard.current.spaceKey.wasPressedThisFrame) TryAttack();
            if (!anyTouch && Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame
                && IsInAttackRegion(Mouse.current.position.ReadValue(), new Vector2(Screen.width, Screen.height))) TryAttack();
        }

        private void Cancel() => pointerId = -1;
        private void OnDisable() => Cancel();
        private void OnApplicationFocus(bool focused) { inputBlocked = !focused; if (!focused) Cancel(); }
        private void OnApplicationPause(bool paused) { inputBlocked = paused; if (paused) Cancel(); }

        private void OnGUI()
        {
            if (circle == null)
            {
                circle = new Texture2D(64, 64, TextureFormat.RGBA32, false);
                for (var y = 0; y < 64; y++)
                    for (var x = 0; x < 64; x++)
                        circle.SetPixel(x, y, new Color(1, 1, 1, Mathf.Clamp01(32 - Vector2.Distance(new Vector2(x + .5f, y + .5f), new Vector2(32, 32)))));
                circle.Apply();
            }
            label ??= new GUIStyle(GUI.skin.label) { alignment = TextAnchor.MiddleCenter, fontStyle = FontStyle.Bold };
            var rect = TouchRect(new Vector2(Screen.width, Screen.height));
            rect.y = Screen.height - rect.yMax;
            label.fontSize = Mathf.RoundToInt(rect.height * .20f);
            var previousColor = GUI.color;
            GUI.color = CanPress ? new Color(.95f, .65f, .24f) : new Color(.4f, .4f, .42f);
            GUI.DrawTexture(rect, circle);
            var inner = new Rect(rect.x + 4, rect.y + 4, rect.width - 8, rect.height - 8);
            GUI.color = Time.unscaledTime - pressedAt < .14f ? new Color(.95f, .62f, .25f) : new Color(.35f, .16f, .08f);
            GUI.DrawTexture(inner, circle);
            GUI.color = Color.white;
            GUI.Label(rect, "Attack", label);
            GUI.color = previousColor;
        }

        private void OnDestroy()
        {
            BindSession(null);
            if (circle != null) Destroy(circle);
        }
    }
}
