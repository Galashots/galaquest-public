using UnityEngine;

namespace GalaQuest
{
    public sealed class GalaQuestDestinationPresentation : MonoBehaviour
    {
        [SerializeField] private GameObject homeRoot;
        [SerializeField] private GameObject emberworksRoot;
        private GalaQuestConnectionSession session;
        private GalaQuestTraversalController traversal;
        private bool capturedLighting;
        private bool emberFog;
        private Color emberAmbient;
        private Color emberBackground;
        private bool travelPointerHeld;
        private bool travelPointerInside;

        public string VisibleDestination { get; private set; }
        public void Configure(GameObject home, GameObject emberworks)
        { homeRoot = home; emberworksRoot = emberworks; }

        public void BindSession(GalaQuestConnectionSession value)
        {
            if (session != null) session.ServerFrameReceived -= ApplyFrame;
            session = value;
            traversal = GetComponent<GalaQuestTraversalController>();
            if (session != null) session.ServerFrameReceived += ApplyFrame;
        }

        private void ApplyFrame(GalaQuestServerFrame frame)
        {
            if (frame.type == "welcome" || frame.type == "destination-changed")
                ShowDestination(session.DestinationId);
        }

        public void ShowDestination(string destinationId)
        {
            var view = Camera.main;
            if (!capturedLighting)
            {
                emberFog = RenderSettings.fog;
                emberAmbient = RenderSettings.ambientLight;
                emberBackground = view != null ? view.backgroundColor : Color.black;
                capturedLighting = true;
            }
            var home = destinationId == GalaQuestProtocolV4.HomeHubDestinationId;
            if (homeRoot != null) homeRoot.SetActive(home);
            if (emberworksRoot != null) emberworksRoot.SetActive(!home);
            RenderSettings.fog = !home && emberFog;
            RenderSettings.ambientLight = home ? new Color(.48f, .54f, .56f) : emberAmbient;
            if (view != null) view.backgroundColor = home ? new Color(.32f, .48f, .56f) : emberBackground;
            VisibleDestination = destinationId;
        }

        public static Rect TravelButtonRect(Vector2 viewport) =>
            new GalaQuestCombatHudLayout(viewport).Travel;

        public static bool IsInTravelRegion(Vector2 position, Vector2 viewport) =>
            TravelButtonRect(viewport).Contains(new Vector2(position.x, viewport.y - position.y));

        private void OnGUI()
        {
            if (session == null || string.IsNullOrEmpty(session.PlayerId)) return;
            if (GalaQuestRuneForgePresenter.IsInputCaptured) return;
            var home = session.DestinationId == GalaQuestProtocolV4.HomeHubDestinationId;
            var nearGate = !home || (traversal != null &&
                Vector2.Distance(traversal.PredictedPosition, new Vector2(0, 7)) <= 3f);
            var layout = new GalaQuestCombatHudLayout(new Vector2(Screen.width, Screen.height));
            var rect = layout.Travel;
            var oldEnabled = GUI.enabled;
            var travelEnabled = session.ControlsReady && nearGate && !session.IsTravelling;
            GUI.enabled = travelEnabled;
            if (!travelEnabled || Event.current.rawType == EventType.MouseUp) travelPointerHeld = false;
            else if (Event.current.type == EventType.MouseDown && Event.current.button == 0
                && rect.Contains(Event.current.mousePosition))
            { travelPointerHeld = true; travelPointerInside = true; }
            else if (travelPointerHeld && (Event.current.type == EventType.MouseDrag
                || Event.current.type == EventType.MouseMove))
                travelPointerInside = rect.Contains(Event.current.mousePosition);
            var label = session.IsTravelling ? "Travelling..." : home
                ? (nearGate ? "TAP TO ENTER EMBERWORKS" : "WALK TO THE GATE") : "TAP TO RETURN TO CAMP";
            if (GUI.Button(rect, GUIContent.none, GUIStyle.none))
                session.RequestTravel(home ? GalaQuestProtocolV4.EmberworksDeepDestinationId : GalaQuestProtocolV4.HomeHubDestinationId);
            GUI.enabled = oldEnabled;
            if (Event.current.type == EventType.Repaint)
            {
                GalaQuestCombatHudStyle.Panel(rect, lit: travelEnabled);
                if (travelPointerHeld && travelPointerInside)
                    GalaQuestCombatHudStyle.Fill(GalaQuestCombatHudStyle.Inset(rect, 7), new Color(.88f, .65f, .31f, .22f));
                GalaQuestCombatHudStyle.Text(GalaQuestCombatHudStyle.Inset(rect, 8 * layout.Scale), label, 18 * layout.Scale,
                    travelEnabled ? GalaQuestCombatHudStyle.Ink : Color.gray, true, TextAnchor.MiddleCenter);
                if (GetComponent<GalaQuestRuneForgePresenter>()?.IsNear != true)
                {
                GalaQuestCombatHudStyle.Panel(layout.Objective, paper: true);
                var objective = home
                    ? (nearGate ? "At the gate — tap ENTER EMBERWORKS" : "Walk to the gate, then tap ENTER EMBERWORKS")
                    : "Find the Forge station, then tap WAKE";
                var content = GalaQuestCombatHudStyle.Inset(layout.Objective, 12 * layout.Scale);
                GalaQuestCombatHudStyle.Text(new Rect(content.x, content.y - 4 * layout.Scale, content.width, 18 * layout.Scale),
                    home ? "CAMP  /  NEXT STEP" : "EMBERWORKS  /  NEXT STEP", 11 * layout.Scale, new Color(.25f, .15f, .06f), true);
                content.y += 14 * layout.Scale; content.height -= 10 * layout.Scale;
                GalaQuestCombatHudStyle.Text(content, objective, 18 * layout.Scale, new Color(.14f, .085f, .025f), true);
                }
            }
            GUI.enabled = oldEnabled;
        }

        private void OnApplicationFocus(bool focused) { if (!focused) travelPointerHeld = false; }
        private void OnDisable() => travelPointerHeld = false;

        private void OnDestroy() => BindSession(null);
    }
}
