using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

namespace GalaQuest
{
    [DefaultExecutionOrder(-220)]
    public sealed class GalaQuestRuneForgePresenter : MonoBehaviour
    {
        public const string MagmaLordItemId = "helmet_magmalord";
        private const float InteractionDistance = 4.2f;
        private static readonly HashSet<int> OwnedTouchIds = new HashSet<int>();

        [SerializeField] private Transform hero;
        [SerializeField] private Transform forgeRoot;
        [SerializeField] private GameObject trappedHelmet;
        [SerializeField] private Camera interactionCamera;
        [SerializeField] private AudioClip machineCue;
        [SerializeField] private AudioClip successCue;
        [SerializeField] private AudioClip claimCue;
        private GalaQuestConnectionSession session;
        private GalaQuestRuneForgeState state;
        private GalaQuestRuneForgeInteractable[] interactables = Array.Empty<GalaQuestRuneForgeInteractable>();
        private GalaQuestRuneForgeInteractable selectedRune;
        private AudioSource audioSource;
        private string feedback = string.Empty;
        private float feedbackUntil;
        private bool equipped;

        public GalaQuestRuneForgeState State => state;
        public bool IsNear => session != null && hero != null && forgeRoot != null
            && session.DestinationId == GalaQuestProtocolV4.EmberworksDeepDestinationId
            && Vector3.Distance(hero.position, forgeRoot.position) <= InteractionDistance;
        public static bool OwnsTouch(int touchId) => OwnedTouchIds.Contains(touchId);
        internal Camera InteractionCamera => interactionCamera != null ? interactionCamera
            : interactionCamera = Camera.main ?? FindFirstObjectByType<Camera>();

        public void Configure(Transform heroTransform, Transform forge, GameObject prize,
            AudioClip machine, AudioClip success, AudioClip claim)
        {
            hero = heroTransform;
            forgeRoot = forge;
            trappedHelmet = prize;
            machineCue = machine;
            successCue = success;
            claimCue = claim;
            interactables = forge != null
                ? forge.GetComponentsInChildren<GalaQuestRuneForgeInteractable>(true)
                : Array.Empty<GalaQuestRuneForgeInteractable>();
            PresentWorld();
        }

        public void BindSession(GalaQuestConnectionSession value)
        {
            if (session != null)
            {
                session.ServerFrameReceived -= ApplyFrame;
                session.Disconnected -= ResetPrivateState;
                session.TravelStarted -= ResetPrivateState;
            }
            session = value;
            ResetPrivateState();
            if (session != null)
            {
                session.ServerFrameReceived += ApplyFrame;
                session.Disconnected += ResetPrivateState;
                session.TravelStarted += ResetPrivateState;
            }
        }

        private void Awake()
        {
            audioSource = gameObject.AddComponent<AudioSource>();
            audioSource.spatialBlend = 0f;
            audioSource.volume = .72f;
            // Configure() only runs once, at Editor authoring time, to bake the pocket into the saved
            // scene. interactables is intentionally not [SerializeField] (it must always reflect the
            // live scene graph, not a stale authoring-time snapshot), so a player booting straight from
            // that saved scene never calls Configure() again and this array starts empty. Re-derive it
            // here from the serialized forgeRoot so PresentWorld() and the browser control diagnostics
            // see the real pocket interactables at actual runtime, not just during authoring.
            if (interactables.Length == 0 && forgeRoot != null)
                interactables = forgeRoot.GetComponentsInChildren<GalaQuestRuneForgeInteractable>(true);
        }

        private void ApplyFrame(GalaQuestServerFrame frame)
        {
            if (frame.type == "forge-state")
            {
                state = frame.forge;
                selectedRune = null;
                feedback = ResponseText(state);
                feedbackUntil = Time.unscaledTime + 2.2f;
                if (state.justGranted) Play(claimCue);
                else if (state.response == "retry") Play(machineCue);
                else if (state.response == "independent-success" || state.response == "assisted-success") Play(successCue);
                PresentWorld();
                return;
            }
            if (session == null || frame.encounter?.rewards == null
                || !frame.encounter.rewards.TryGetValue(session.PlayerId, out var reward)) return;
            equipped = reward?.equippedItemIds != null
                && reward.equippedItemIds.TryGetValue("helmet", out var helmet)
                && helmet == MagmaLordItemId;
            PresentWorld();
        }

        private void Update()
        {
            RecordBrowserControlDiagnostics();
            PollTouches();
            if (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame)
                TryPress(-2, Mouse.current.position.ReadValue());
        }

        private void RecordBrowserControlDiagnostics()
        {
            GalaQuestBrowserInterop.ClearForgeControls();
            var camera = InteractionCamera;
            if (!IsNear || camera == null || interactables == null) return;
            foreach (var item in interactables)
            {
                if (item == null || !item.gameObject.activeInHierarchy) continue;
                var point = camera.WorldToScreenPoint(item.transform.position);
                if (point.z <= 0f) continue;
                GalaQuestBrowserInterop.RecordForgeControl(item.Kind, item.Value, point.x, point.y);
            }
        }

        private void PollTouches()
        {
            var touchscreen = Touchscreen.current;
            if (touchscreen == null) return;
            foreach (var touch in touchscreen.touches)
            {
                var id = touch.touchId.ReadValue();
                if (touch.press.wasPressedThisFrame) TryPress(id, touch.position.ReadValue());
                if (touch.press.wasReleasedThisFrame || !touch.press.isPressed) OwnedTouchIds.Remove(id);
            }
        }

        private bool TryPress(int pointerId, Vector2 screenPoint)
        {
            var camera = InteractionCamera;
            if (!IsNear || session == null || !session.ControlsReady || camera == null) return false;
            var ray = camera.ScreenPointToRay(screenPoint);
            var target = FindInteractable(ray);
            if (target == null) return false;
            if (pointerId >= 0) OwnedTouchIds.Add(pointerId);
            Press(target);
            return true;
        }

        internal static GalaQuestRuneForgeInteractable FindInteractable(Ray ray)
        {
            var hits = Physics.RaycastAll(ray, 100f);
            Array.Sort(hits, (left, right) => left.distance.CompareTo(right.distance));
            foreach (var hit in hits)
            {
                var target = hit.collider.GetComponentInParent<GalaQuestRuneForgeInteractable>();
                if (target != null && target.gameObject.activeInHierarchy) return target;
            }
            return null;
        }

        private void Press(GalaQuestRuneForgeInteractable target)
        {
            Play(machineCue);
            switch (target.Kind)
            {
                case "open": session.TryOpenRuneForge(); break;
                case "pack": session.TrySelectRuneForgePack(target.Value); break;
                case "rune": SelectRune(target); break;
                case "hammer":
                    if (state?.task != null && selectedRune != null)
                        session.TryAnswerRuneForge(state.task.id, selectedRune.Value, state.contentVersion);
                    break;
                case "hint":
                    if (state?.task != null) session.TryRequestRuneForgeHint(state.task.id, state.contentVersion);
                    break;
                case "hear":
                    if (state?.task != null) GalaQuestBrowserInterop.Speak(state.task.spokenPrompt);
                    break;
                case "claim": session.TryClaimRuneForge(); break;
                case "equip": session.TryEquip(MagmaLordItemId); break;
            }
        }

        private void SelectRune(GalaQuestRuneForgeInteractable value)
        {
            selectedRune = value;
            feedback = "Rune set. Strike the hammer!";
            feedbackUntil = Time.unscaledTime + 1.5f;
            PresentWorld();
        }

        private void PresentWorld()
        {
            if (interactables == null || interactables.Length == 0) return;
            var status = state?.status ?? "dormant";
            foreach (var item in interactables)
            {
                var active = item.Kind == "open" ? state == null
                    : item.Kind == "pack" ? status == "choose-pack"
                    : item.Kind == "rune" || item.Kind == "hammer" || item.Kind == "hint" || item.Kind == "hear"
                        ? status == "active"
                    : item.Kind == "claim" ? status == "ready-to-claim"
                    : item.Kind == "equip" ? status == "owned" && !equipped
                    : false;
                item.gameObject.SetActive(active);
                item.SetGlow(active, item == selectedRune || (item.Kind == "hammer" && selectedRune != null));
            }
            if (status == "active" && state.task?.choices != null)
            {
                var runeIndex = 0;
                foreach (var item in interactables)
                {
                    if (item.Kind != "rune") continue;
                    if (runeIndex < state.task.choices.Length)
                    {
                        item.Value = state.task.choices[runeIndex].id;
                        item.SetLabel(state.task.choices[runeIndex].label);
                    }
                    runeIndex++;
                }
            }
            if (trappedHelmet != null) trappedHelmet.SetActive(status != "owned");
        }

        private static string ResponseText(GalaQuestRuneForgeState value)
        {
            if (value == null) return string.Empty;
            return value.response switch
            {
                "retry" => "The forge answers: try another rune.",
                "hint" => value.hint,
                "assisted-success" => "The rune holds with help.",
                "independent-success" => "The rune locks in!",
                "claimed" => "MagmaLord Helmet claimed! Choose EQUIP.",
                _ => string.Empty,
            };
        }

        private void Play(AudioClip cue)
        {
            if (cue != null && audioSource != null) audioSource.PlayOneShot(cue);
        }

        private void ResetPrivateState()
        {
            state = null;
            selectedRune = null;
            equipped = false;
            feedback = string.Empty;
            OwnedTouchIds.Clear();
            PresentWorld();
        }

        public static Rect PromptRect(Vector2 viewport)
        {
            var hud = new GalaQuestCombatHudLayout(viewport);
            var panel = hud.Objective;
            panel.height = 128 * hud.Scale;
            return panel;
        }

        private void OnGUI()
        {
            if (!IsNear) return;
            var viewport = new Vector2(Screen.width, Screen.height);
            var panel = PromptRect(viewport);
            var s = new GalaQuestCombatHudLayout(viewport).Scale;
            GalaQuestCombatHudStyle.Panel(panel, paper: true);
            var title = state?.status == "active" ? "RUNE FORGE  /  " + state.completedCount + " OF " + state.requiredSuccesses : "RUNE FORGE";
            GalaQuestCombatHudStyle.Text(new Rect(panel.x + 12*s, panel.y + 6*s, panel.width - 24*s, 24*s),
                title, 15*s, new Color(.25f, .15f, .06f), true);
            var prompt = CurrentPrompt(state, equipped);
            GalaQuestCombatHudStyle.Text(new Rect(panel.x + 12*s, panel.y + 32*s, panel.width - 24*s, 47*s),
                prompt, 18*s, new Color(.14f, .085f, .025f), true, TextAnchor.UpperLeft, true);
            var action = Time.unscaledTime < feedbackUntil && !string.IsNullOrEmpty(feedback) ? feedback
                : state?.status == "active" ? (selectedRune != null ? "Rune selected. Touch STRIKE." : "Choose a rune, then touch STRIKE.") : string.Empty;
            GalaQuestCombatHudStyle.Text(new Rect(panel.x + 12*s, panel.y + 83*s, panel.width - 24*s, panel.height - 90*s),
                action, 14*s, new Color(.25f, .15f, .06f), false, TextAnchor.UpperLeft, true);
        }

        // Transient feedback has its own line; it must never replace the current
        // server question (including after a successful strike advances the task).
        public static string CurrentPrompt(GalaQuestRuneForgeState state, bool equipped) =>
            state == null ? "MagmaLord Helmet trapped — touch WAKE below."
                : state.status == "choose-pack" ? "Choose a rune anvil."
                : state.status == "active" ? state.task?.displayPrompt
                : state.status == "ready-to-claim" ? "The cage is open. Touch CLAIM."
                : equipped ? "MagmaLord Helmet equipped · 20% damage reduction"
                : "You own the helmet. Touch EQUIP to wear it.";

        private void OnDestroy() => BindSession(null);
    }

}
