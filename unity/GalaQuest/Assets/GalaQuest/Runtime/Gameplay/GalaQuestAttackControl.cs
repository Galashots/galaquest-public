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

        public event Action AttackRequested;
        public bool CanPress => !inputBlocked && !GalaQuestRuneForgePresenter.IsInputCaptured
            && session != null && session.ControlsReady && !down;

        // Touch positions use a bottom-left origin. Ownership is chosen on press;
        // an attack finger remains reserved when it moves outside the visible disc.
        public static Rect TouchRect(Vector2 viewport) =>
            GalaQuestCombatHudLayout.ToTouch(new GalaQuestCombatHudLayout(viewport).Attack, viewport);

        public static bool IsInAttackRegion(Vector2 position, Vector2 viewport) => TouchRect(viewport).Contains(position);

        public void BindSession(GalaQuestConnectionSession value)
        {
            if (session != null)
            {
                session.ServerFrameReceived -= ApplyFrame;
                session.Disconnected -= Cancel;
                session.TravelStarted -= Cancel;
            }
            session = value;
            down = false;
            Cancel();
            if (session != null)
            {
                session.ServerFrameReceived += ApplyFrame;
                session.Disconnected += Cancel;
                session.TravelStarted += Cancel;
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
            if (inputBlocked || GalaQuestRuneForgePresenter.IsInputCaptured) { Cancel(); return; }
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
                        || GalaQuestRuneForgePresenter.OwnsTouch(touch.touchId.ReadValue())
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
            if (GalaQuestRuneForgePresenter.IsInputCaptured || Event.current.type != EventType.Repaint) return;
            var rect = new GalaQuestCombatHudLayout(new Vector2(Screen.width, Screen.height)).Attack;
            var pressed = Time.unscaledTime - pressedAt < .14f;
            GalaQuestCombatHudStyle.Disc(rect, CanPress, pressed);
            GalaQuestCombatHudStyle.Sword(new Rect(rect.x + rect.width * .30f, rect.y + rect.height * .19f,
                rect.width * .40f, rect.height * .37f), CanPress ? GalaQuestCombatHudStyle.Ink : Color.gray);
            GalaQuestCombatHudStyle.Text(new Rect(rect.x, rect.y + rect.height * .61f, rect.width, rect.height * .24f),
                "ATTACK", rect.height * .15f, CanPress ? GalaQuestCombatHudStyle.Ink : Color.gray,
                true, TextAnchor.MiddleCenter);
        }

        private void OnDestroy()
        {
            BindSession(null);
        }
    }
}
