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
        private static GalaQuestRuneForgePresenter activePresenter;

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
        private string selectedChoiceId;
        private AudioSource audioSource;
        private string feedback = string.Empty;
        private float feedbackUntil;
        private bool equipped;
        private bool questionPanelOpen;

        public GalaQuestRuneForgeState State => state;
        public bool IsQuestionPanelOpen => questionPanelOpen && IsNear;
        public static bool IsInputCaptured => activePresenter != null && activePresenter.IsQuestionPanelOpen;
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
            activePresenter = this;
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
                selectedChoiceId = null;
                feedback = ResponseText(state);
                feedbackUntil = Time.unscaledTime + 2.2f;
                questionPanelOpen = state != null;
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
            if (questionPanelOpen)
            {
                PollPanelTouches();
                if (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame)
                    HandlePanelPointer(-2, Mouse.current.position.ReadValue());
                return;
            }
            PollTouches();
            if (Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame)
                TryPress(-2, Mouse.current.position.ReadValue());
        }

        private void RecordBrowserControlDiagnostics()
        {
            GalaQuestBrowserInterop.ClearForgeControls();
            if (!IsNear) return;
            if (questionPanelOpen)
            {
                RecordPanelControls();
                return;
            }
            var camera = InteractionCamera;
            if (camera == null || interactables == null) return;
            foreach (var item in interactables)
            {
                if (item == null || !item.gameObject.activeInHierarchy) continue;
                var point = camera.WorldToScreenPoint(item.transform.position);
                if (point.z <= 0f) continue;
                GalaQuestBrowserInterop.RecordForgeControl(item.Kind, item.Value, point.x, point.y);
            }
        }

        private void RecordPanelControls()
        {
            var viewport = new Vector2(Screen.width, Screen.height);
            if (state?.status == "choose-pack")
            {
                for (var index = 0; index < (state.packs?.Length ?? 0); index++)
                {
                    var pack = state.packs[index];
                    RecordPanelControl("pack", pack.id, PackRect(viewport, index, state.packs.Length));
                }
            }
            else if (state?.status == "active")
            {
                for (var index = 0; index < (state.task?.choices?.Length ?? 0); index++)
                    RecordPanelControl("rune", state.task.choices[index].id,
                        QuestionChoiceRect(viewport, index, state.task.choices.Length));
                RecordPanelControl("hear", string.Empty, QuestionActionRect(viewport, 0, 3));
                RecordPanelControl("hint", string.Empty, QuestionActionRect(viewport, 1, 3));
                RecordPanelControl("hammer", string.Empty, QuestionActionRect(viewport, 2, 3));
            }
            else if (state?.status == "ready-to-claim")
                RecordPanelControl("claim", string.Empty, QuestionActionRect(viewport, 0, 1));
            else if (state?.status == "owned" && !equipped)
                RecordPanelControl("equip", string.Empty, QuestionActionRect(viewport, 0, 1));
            RecordPanelControl("close", string.Empty, QuestionCloseRect(viewport));
        }

        private static void RecordPanelControl(string kind, string value, Rect rect)
        {
            GalaQuestBrowserInterop.RecordForgeControl(kind, value, rect.center.x, Screen.height - rect.center.y);
        }

        // Secondary overhead bars yield when they would cover a real Forge control.
        // This changes visibility only; damage, health state and interaction stay intact.
        public bool CoversActiveControl(Rect screenRect) => IsNear
            && OverlapsControlProjection(screenRect, InteractionCamera, interactables, Screen.height);

        public static bool OverlapsControlProjection(Rect screenRect, Camera camera,
            IEnumerable<GalaQuestRuneForgeInteractable> controls, float viewportHeight)
        {
            if (camera == null || controls == null) return false;
            foreach (var control in controls)
            {
                if (control == null || !control.gameObject.activeInHierarchy) continue;
                foreach (var renderer in control.GetComponentsInChildren<Renderer>())
                {
                    if (!renderer.enabled) continue;
                    var bounds = renderer.bounds;
                    var min = new Vector2(float.PositiveInfinity, float.PositiveInfinity);
                    var max = new Vector2(float.NegativeInfinity, float.NegativeInfinity);
                    for (var corner = 0; corner < 8; corner++)
                    {
                        var world = bounds.center + Vector3.Scale(bounds.extents, new Vector3(
                            (corner & 1) == 0 ? -1 : 1, (corner & 2) == 0 ? -1 : 1, (corner & 4) == 0 ? -1 : 1));
                        var point = camera.WorldToScreenPoint(world);
                        if (point.z <= 0) continue;
                        var gui = new Vector2(point.x, viewportHeight - point.y);
                        min = Vector2.Min(min, gui); max = Vector2.Max(max, gui);
                    }
                    if (min.x <= max.x && screenRect.Overlaps(Rect.MinMaxRect(min.x - 3, min.y - 3, max.x + 3, max.y + 3)))
                        return true;
                }
            }
            return false;
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

        private void PollPanelTouches()
        {
            var touchscreen = Touchscreen.current;
            if (touchscreen == null) return;
            foreach (var touch in touchscreen.touches)
            {
                var id = touch.touchId.ReadValue();
                if (touch.press.wasPressedThisFrame) HandlePanelPointer(id, touch.position.ReadValue());
                if (touch.press.wasReleasedThisFrame || !touch.press.isPressed) OwnedTouchIds.Remove(id);
            }
        }

        private bool HandlePanelPointer(int pointerId, Vector2 screenPoint)
        {
            if (!IsQuestionPanelOpen) return false;
            if (pointerId >= 0) OwnedTouchIds.Add(pointerId);
            var viewport = new Vector2(Screen.width, Screen.height);
            var guiPoint = new Vector2(screenPoint.x, viewport.y - screenPoint.y);
            if (!QuestionPanelRect(viewport).Contains(guiPoint)) return true;
            if (QuestionCloseRect(viewport).Contains(guiPoint))
            {
                questionPanelOpen = false;
                selectedChoiceId = null;
                PresentWorld();
                return true;
            }
            if (state?.status == "choose-pack")
            {
                for (var index = 0; index < (state.packs?.Length ?? 0); index++)
                    if (PackRect(viewport, index, state.packs.Length).Contains(guiPoint))
                    {
                        session.TrySelectRuneForgePack(state.packs[index].id);
                        return true;
                    }
            }
            else if (state?.status == "active")
            {
                for (var index = 0; index < (state.task?.choices?.Length ?? 0); index++)
                    if (QuestionChoiceRect(viewport, index, state.task.choices.Length).Contains(guiPoint))
                    {
                        selectedChoiceId = state.task.choices[index].id;
                        feedback = "Selected. Touch STRIKE to check it.";
                        feedbackUntil = Time.unscaledTime + 4f;
                        return true;
                    }
                for (var index = 0; index < 3; index++)
                    if (QuestionActionRect(viewport, index, 3).Contains(guiPoint))
                    {
                        PanelAction(index);
                        return true;
                    }
            }
            else if ((state?.status == "ready-to-claim" || (state?.status == "owned" && !equipped))
                && QuestionActionRect(viewport, 0, 1).Contains(guiPoint))
            {
                PanelAction(0);
                return true;
            }
            return true;
        }

        private void PanelAction(int index)
        {
            if (state?.status == "active")
            {
                if (index == 0 && state.task != null) GalaQuestBrowserInterop.Speak(state.task.spokenPrompt);
                else if (index == 1 && state.task != null)
                    session.TryRequestRuneForgeHint(state.task.id, state.contentVersion);
                else if (index == 2 && state.task != null && !string.IsNullOrEmpty(selectedChoiceId))
                    session.TryAnswerRuneForge(state.task.id, selectedChoiceId, state.contentVersion);
                return;
            }
            if (state?.status == "ready-to-claim") session.TryClaimRuneForge();
            else if (state?.status == "owned" && !equipped) session.TryEquip(MagmaLordItemId);
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
                var active = item.Kind == "open" ? !questionPanelOpen
                    : item.Kind == "pack" ? status == "choose-pack" && !questionPanelOpen
                    : item.Kind == "rune" || item.Kind == "hammer" || item.Kind == "hint" || item.Kind == "hear"
                        ? status == "active" && !questionPanelOpen
                    : item.Kind == "claim" ? status == "ready-to-claim" && !questionPanelOpen
                    : item.Kind == "equip" ? status == "owned" && !equipped && !questionPanelOpen
                    : false;
                item.gameObject.SetActive(active);
                item.SetGlow(active, item == selectedRune || (item.Kind == "hammer" && selectedRune != null));
                if (item.Kind == "open") item.SetLabel(state == null ? "WAKE" : "OPEN FORGE");
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
            selectedChoiceId = null;
            equipped = false;
            questionPanelOpen = false;
            feedback = string.Empty;
            OwnedTouchIds.Clear();
            PresentWorld();
        }

        public static Rect PromptRect(Vector2 viewport)
        {
            var hud = new GalaQuestCombatHudLayout(viewport);
            var panel = hud.Objective;
            panel.height = 128 * hud.Scale;
            // A full-width portrait question above the actor also covers the prize,
            // even after an ordinary orbit. Use the clear band above travel instead.
            if (hud.Narrow) panel.y = hud.Travel.y - panel.height - 8 * hud.Scale;
            return panel;
        }

        public static Rect QuestionPanelRect(Vector2 viewport)
        {
            var hud = new GalaQuestCombatHudLayout(viewport);
            var s = hud.Scale;
            var width = Mathf.Min(viewport.x - 24 * s, hud.Narrow ? 372 * s : 640 * s);
            var compact = viewport.y < 600;
            var height = Mathf.Min(viewport.y - 20 * s, (hud.Narrow ? (compact ? 460 : 660) : 520) * s);
            return new Rect((viewport.x - width) * .5f, (viewport.y - height) * .5f, width, height);
        }

        public static Rect QuestionChoiceRect(Vector2 viewport, int index, int count)
        {
            var panel = QuestionPanelRect(viewport);
            var s = new GalaQuestCombatHudLayout(viewport).Scale;
            var compact = viewport.y < 600;
            var top = panel.y + (compact ? 92 : 122) * s;
            var height = (compact ? 38 : 58) * s;
            var gap = 6 * s;
            var width = panel.width - 32 * s;
            return new Rect(panel.x + 16 * s, top + index * (height + gap), width, height);
        }

        public static Rect PackRect(Vector2 viewport, int index, int count)
        {
            var panel = QuestionPanelRect(viewport);
            var s = new GalaQuestCombatHudLayout(viewport).Scale;
            var compact = viewport.y < 600;
            var top = panel.y + (compact ? 82 : 106) * s;
            // One height everywhere. A track button carries a title AND a description, and the
            // old compact 48*s left no room for both: the centred title was drawn straight
            // through the description strip at every landscape phone size.
            var height = 70 * s;
            var gap = 8 * s;
            return new Rect(panel.x + 16 * s, top + index * (height + gap), panel.width - 32 * s, height);
        }

        // Title and description own separate, non-touching bands of the same button, so
        // neither can be drawn over the other at any viewport.
        public static Rect PackTitleRect(Vector2 viewport, int index, int count)
        {
            var rect = PackRect(viewport, index, count);
            var s = new GalaQuestCombatHudLayout(viewport).Scale;
            return new Rect(rect.x + 8 * s, rect.y + 8 * s, rect.width - 16 * s, rect.height - 38 * s);
        }

        public static Rect PackDescriptionRect(Vector2 viewport, int index, int count)
        {
            var rect = PackRect(viewport, index, count);
            var s = new GalaQuestCombatHudLayout(viewport).Scale;
            return new Rect(rect.x + 10 * s, rect.yMax - 30 * s, rect.width - 20 * s, 24 * s);
        }

        public static Rect QuestionActionRect(Vector2 viewport, int index, int count)
        {
            var panel = QuestionPanelRect(viewport);
            var s = new GalaQuestCombatHudLayout(viewport).Scale;
            var compact = viewport.y < 600;
            var height = (compact ? 34 : 48) * s;
            var gap = 6 * s;
            var bottom = panel.yMax - (compact ? 70 : 88) * s;
            var width = (panel.width - 32 * s - (count - 1) * gap) / count;
            return new Rect(panel.x + 16 * s + index * (width + gap), bottom, width, height);
        }

        public static Rect QuestionCloseRect(Vector2 viewport)
        {
            var panel = QuestionPanelRect(viewport);
            var s = new GalaQuestCombatHudLayout(viewport).Scale;
            var compact = viewport.y < 600;
            var height = (compact ? 30 : 40) * s;
            // Keep CLOSE below every visible action row. The panel owns input while
            // open, so an overlapping strip would make the earlier CLOSE check win.
            return new Rect(panel.x + 16 * s, panel.yMax - (compact ? 30 : 40) * s,
                panel.width - 32 * s, height);
        }

        private void OnGUI()
        {
            if (!IsNear) return;
            var viewport = new Vector2(Screen.width, Screen.height);
            if (!IsQuestionPanelOpen)
            {
                DrawNearbyPrompt(viewport);
                return;
            }
            var layout = new GalaQuestCombatHudLayout(viewport);
            var panel = QuestionPanelRect(viewport);
            var s = layout.Scale;
            GalaQuestCombatHudStyle.Fill(new Rect(0, 0, viewport.x, viewport.y), new Color(0f, 0f, 0f, .32f));
            GalaQuestCombatHudStyle.Panel(panel, paper: true);
            var ink = new Color(.14f, .085f, .025f);
            var title = state?.status == "active" ? "RUNE FORGE  /  " + state.completedCount + " OF " + state.requiredSuccesses
                : state?.status == "choose-pack" ? "CHOOSE YOUR LEARNING TRACK" : "RUNE FORGE";
            GalaQuestCombatHudStyle.Text(new Rect(panel.x + 16*s, panel.y + 8*s, panel.width - 32*s, 28*s),
                title, (viewport.y < 600 ? 14 : 17)*s, ink, true, TextAnchor.MiddleCenter);
            if (state?.status == "choose-pack") DrawPackPanel(panel, s, ink);
            else if (state?.status == "active") DrawQuestionPanel(panel, s, ink);
            else
            {
                GalaQuestCombatHudStyle.Text(new Rect(panel.x + 16*s, panel.y + 48*s, panel.width - 32*s, 54*s),
                    CurrentPrompt(state, equipped), 18*s, ink, true, TextAnchor.MiddleCenter, true);
                if (state?.status == "ready-to-claim") DrawPanelButton(QuestionActionRect(viewport, 0, 1), "CLAIM", true, true, s);
                else if (state?.status == "owned" && !equipped) DrawPanelButton(QuestionActionRect(viewport, 0, 1), "EQUIP", true, true, s);
            }
            DrawPanelButton(QuestionCloseRect(viewport), "CLOSE", true, false, s);
        }

        private void DrawNearbyPrompt(Vector2 viewport)
        {
            var panel = PromptRect(viewport);
            var scale = new GalaQuestCombatHudLayout(viewport).Scale;
            GalaQuestCombatHudStyle.Panel(panel, paper: true);
            GalaQuestCombatHudStyle.Text(new Rect(panel.x + 12*scale, panel.y + 8*scale,
                panel.width - 24*scale, 24*scale), state == null ? "FORGE / READY" : "FORGE / CONTINUE",
                15*scale, new Color(.25f, .15f, .06f), true, TextAnchor.MiddleCenter);
            GalaQuestCombatHudStyle.Text(new Rect(panel.x + 14*scale, panel.y + 36*scale,
                panel.width - 28*scale, panel.height - 46*scale), CurrentPrompt(state, equipped),
                17*scale, new Color(.14f, .085f, .025f), true, TextAnchor.MiddleCenter, true);
        }

        private void DrawPackPanel(Rect panel, float s, Color ink)
        {
            GalaQuestCombatHudStyle.Text(new Rect(panel.x + 18*s, panel.y + 43*s, panel.width - 36*s, 36*s),
                "Pick one. This selection is saved with your Forge progress.", 14*s, ink, false, TextAnchor.MiddleCenter, true);
            for (var index = 0; index < (state.packs?.Length ?? 0); index++)
            {
                var pack = state.packs[index];
                var viewport = new Vector2(Screen.width, Screen.height);
                var count = state.packs.Length;
                DrawPanelButton(PackRect(viewport, index, count), TrackTitle(pack.id), true, false, s,
                    PackTitleRect(viewport, index, count));
                GalaQuestCombatHudStyle.Text(PackDescriptionRect(viewport, index, count),
                    TrackDescription(pack.id), 11*s, GalaQuestCombatHudStyle.Ink, false, TextAnchor.MiddleCenter, true);
            }
        }

        private void DrawQuestionPanel(Rect panel, float s, Color ink)
        {
            var compact = Screen.height < 600;
            GalaQuestCombatHudStyle.Text(new Rect(panel.x + 16*s, panel.y + 43*s, panel.width - 32*s, (compact ? 38 : 58)*s),
                CurrentPrompt(state, equipped), (compact ? 15 : 18)*s, ink, true, TextAnchor.MiddleCenter, true);
            for (var index = 0; index < (state.task?.choices?.Length ?? 0); index++)
            {
                var choice = state.task.choices[index];
                DrawPanelButton(QuestionChoiceRect(new Vector2(Screen.width, Screen.height), index, state.task.choices.Length),
                    choice.label, choice.id == selectedChoiceId, choice.id == selectedChoiceId, s);
            }
            var action = !string.IsNullOrEmpty(feedback) ? feedback : "Choose an answer, then tap STRIKE.";
            GalaQuestCombatHudStyle.Text(new Rect(panel.x + 16*s, panel.yMax - (compact ? 122 : 154)*s,
                panel.width - 32*s, (compact ? 42 : 56)*s), action, 13*s, ink, false, TextAnchor.MiddleCenter, true);
            DrawPanelButton(QuestionActionRect(new Vector2(Screen.width, Screen.height), 0, 3), "HEAR", true, false, s);
            DrawPanelButton(QuestionActionRect(new Vector2(Screen.width, Screen.height), 1, 3), "HINT", true, false, s);
            DrawPanelButton(QuestionActionRect(new Vector2(Screen.width, Screen.height), 2, 3), "STRIKE",
                !string.IsNullOrEmpty(selectedChoiceId), !string.IsNullOrEmpty(selectedChoiceId), s);
        }

        private static void DrawPanelButton(Rect rect, string label, bool enabled, bool selected,
            float scale, Rect? labelRect = null)
        {
            GalaQuestCombatHudStyle.Panel(rect, lit: enabled && selected);
            GalaQuestCombatHudStyle.Fill(GalaQuestCombatHudStyle.Inset(rect, 7*scale),
                enabled ? (selected ? new Color(.88f, .65f, .31f, .42f) : new Color(.03f, .04f, .035f, .78f))
                    : new Color(.2f, .2f, .2f, .42f));
            GalaQuestCombatHudStyle.Text(labelRect ?? GalaQuestCombatHudStyle.Inset(rect, 8*scale), label,
                Mathf.Max(11, 16*scale), enabled ? GalaQuestCombatHudStyle.Ink : Color.gray, true, TextAnchor.MiddleCenter, true);
        }

        private static string TrackTitle(string id) => id == "grapheme-er-family" ? "SOUND" : id == "place-value-rounding" ? "NUMBER" : id;
        private static string TrackDescription(string id) => id == "grapheme-er-family"
            ? "Hear a word. Choose the letters that make its sound." : id == "place-value-rounding"
                ? "Build numbers with place value and rounding." : "Choose this learning track.";

        // Transient feedback has its own line; it must never replace the current
        // server question (including after a successful strike advances the task).
        public static string CurrentPrompt(GalaQuestRuneForgeState state, bool equipped) =>
            state == null ? "MagmaLord Helmet waiting — tap WAKE at the Forge."
                : state.status == "choose-pack" ? "Choose SOUND or NUMBER."
                : state.status == "active" ? state.task?.displayPrompt
                : state.status == "ready-to-claim" ? "The cage is open — tap CLAIM."
                : equipped ? "MagmaLord Helmet equipped · 20% damage reduction"
                : "You own the helmet — tap EQUIP to wear it.";

        private void OnDestroy()
        {
            if (activePresenter == this) activePresenter = null;
            BindSession(null);
        }
    }

}
