using System;
using UnityEngine;
using UnityEngine.InputSystem;

namespace GalaQuest
{
    [DefaultExecutionOrder(-179)]
    public sealed class GalaQuestSpecialControl : MonoBehaviour
    {
        public const int UnlockLevel = 5;
        private GalaQuestConnectionSession session;
        private GalaQuestProfileProgression progression;
        private GalaQuestServerHeroCombat hero;
        private int level;
        private int pointerId = -1;
        private bool inputBlocked;
        private float pressedAt = float.NegativeInfinity;

        public event Action SpecialRequested;
        public bool CanPress => !inputBlocked && !GalaQuestRuneForgePresenter.IsInputCaptured
            && session != null && session.ControlsReady && level >= UnlockLevel
            && hero != null && hero.hp > 0 && hero.downSeconds < 0
            && hero.specialSeconds < 0 && hero.specialCooldown <= 0;

        public static Rect TouchRect(Vector2 viewport) =>
            GalaQuestCombatHudLayout.ToTouch(new GalaQuestCombatHudLayout(viewport).Special, viewport);

        public static bool IsInSpecialRegion(Vector2 position, Vector2 viewport) =>
            TouchRect(viewport).Contains(position);

        public void BindSession(GalaQuestConnectionSession value)
        {
            if (session != null)
            {
                session.ServerFrameReceived -= ApplyFrame;
                session.Disconnected -= ClearState;
                session.TravelStarted -= ClearState;
            }
            session = value;
            ClearState();
            if (session != null)
            {
                session.ServerFrameReceived += ApplyFrame;
                session.Disconnected += ClearState;
                session.TravelStarted += ClearState;
            }
        }

        public void BindProgression(GalaQuestProfileProgression value)
        {
            if (progression != null) progression.Changed -= ApplyProgression;
            progression = value;
            level = progression?.State?.level ?? 0;
            if (progression != null) progression.Changed += ApplyProgression;
        }

        private void ApplyProgression(GalaQuestProgressionView value) => level = value?.level ?? 0;

        private void ApplyFrame(GalaQuestServerFrame frame)
        {
            if (session != null && frame.encounter.heroes.TryGetValue(session.PlayerId, out var value))
                hero = value;
        }

        public bool TrySpecial()
        {
            if (!CanPress || !session.TrySendSpecialIntent()) return false;
            pressedAt = Time.unscaledTime;
            SpecialRequested?.Invoke();
            return true;
        }

        private void Update()
        {
            if (inputBlocked || GalaQuestRuneForgePresenter.IsInputCaptured) { Cancel(); return; }
            var viewport = new Vector2(Screen.width, Screen.height);
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
                        || !IsInSpecialRegion(touch.position.ReadValue(), viewport)) continue;
                    pointerId = touch.touchId.ReadValue();
                    TrySpecial();
                    break;
                }
            if (Keyboard.current != null && Keyboard.current.kKey.wasPressedThisFrame) TrySpecial();
            if (!anyTouch && Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame
                && IsInSpecialRegion(Mouse.current.position.ReadValue(), viewport)) TrySpecial();
        }

        private void ClearState()
        {
            hero = null;
            Cancel();
        }

        private void Cancel() => pointerId = -1;
        private void OnDisable() => Cancel();
        private void OnApplicationFocus(bool focused) { inputBlocked = !focused; if (!focused) Cancel(); }
        private void OnApplicationPause(bool paused) { inputBlocked = paused; if (paused) Cancel(); }

        private void OnGUI()
        {
            if (GalaQuestRuneForgePresenter.IsInputCaptured || Event.current.type != EventType.Repaint) return;
            var rect = new GalaQuestCombatHudLayout(new Vector2(Screen.width, Screen.height)).Special;
            var active = hero != null && hero.specialSeconds >= 0;
            var ready = CanPress;
            GalaQuestCombatHudStyle.Disc(rect, ready, Time.unscaledTime - pressedAt < .14f);
            GalaQuestCombatHudStyle.Text(new Rect(rect.x, rect.y + rect.height * .22f, rect.width, rect.height * .28f),
                "BURST", rect.height * .16f, ready ? GalaQuestCombatHudStyle.Ink : Color.gray,
                true, TextAnchor.MiddleCenter);
            var state = level < UnlockLevel ? "LV 5" : active ? "FIRING" :
                hero != null && hero.specialCooldown > 0 ? $"{Mathf.CeilToInt(hero.specialCooldown)}s" :
                ready ? "READY" : "WAIT";
            GalaQuestCombatHudStyle.Text(new Rect(rect.x, rect.y + rect.height * .56f, rect.width, rect.height * .22f),
                state, rect.height * .13f, ready ? GalaQuestCombatHudStyle.Gold : Color.gray,
                true, TextAnchor.MiddleCenter);
        }

        private void OnDestroy()
        {
            BindProgression(null);
            BindSession(null);
        }
    }
}
