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
        private GUIStyle titleStyle;
        private GUIStyle promptStyle;
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
            if (!Physics.Raycast(ray, out var hit, 100f)) return false;
            var target = hit.collider.GetComponentInParent<GalaQuestRuneForgeInteractable>();
            if (target == null || !target.gameObject.activeInHierarchy) return false;
            if (pointerId >= 0) OwnedTouchIds.Add(pointerId);
            Press(target);
            return true;
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
                item.SetGlow(active, item == selectedRune);
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

        private void OnGUI()
        {
            if (!IsNear) return;
            titleStyle ??= new GUIStyle(GUI.skin.label)
            { alignment = TextAnchor.MiddleCenter, fontStyle = FontStyle.Bold, normal = { textColor = new Color(1f, .72f, .25f) } };
            promptStyle ??= new GUIStyle(GUI.skin.label)
            { alignment = TextAnchor.MiddleCenter, wordWrap = true, normal = { textColor = Color.white } };
            titleStyle.fontSize = Mathf.Clamp(Mathf.RoundToInt(Screen.height / 32f), 17, 28);
            promptStyle.fontSize = Mathf.Clamp(Mathf.RoundToInt(Screen.height / 42f), 14, 22);
            var width = Mathf.Min(480f, Screen.width * .50f);
            var panelX = Mathf.Min(Screen.width - width - 14f,
                Mathf.Max(Screen.width * .35f, (Screen.width - width) / 2f));
            var panel = new Rect(panelX, Screen.height * .075f, width, 94f);
            var old = GUI.color;
            GUI.color = new Color(.035f, .018f, .012f, .86f);
            GUI.DrawTexture(panel, Texture2D.whiteTexture);
            GUI.color = Color.white;
            GUI.Label(new Rect(panel.x + 12, panel.y + 5, panel.width - 24, 31), "RUNE FORGE", titleStyle);
            var prompt = state == null ? "MagmaLord Helmet trapped — touch WAKE below."
                : state.status == "choose-pack" ? "Choose a rune anvil."
                : state.status == "active" ? state.task?.displayPrompt
                : state.status == "ready-to-claim" ? "The cage is open. Touch CLAIM."
                : equipped ? "MagmaLord Helmet equipped · 20% damage reduction"
                : "You own the helmet. Touch EQUIP to wear it.";
            if (Time.unscaledTime < feedbackUntil && !string.IsNullOrEmpty(feedback)) prompt = feedback;
            GUI.Label(new Rect(panel.x + 14, panel.y + 39, panel.width - 28, 55), prompt, promptStyle);
            GUI.color = old;
        }

        private void OnDestroy() => BindSession(null);
    }

}
