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
        private GUIStyle buttonStyle;

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
            new Rect((viewport.x - 260f) * .5f, viewport.y - 84f, 260f, 58f);

        public static bool IsInTravelRegion(Vector2 position, Vector2 viewport) =>
            TravelButtonRect(viewport).Contains(new Vector2(position.x, viewport.y - position.y));

        private void OnGUI()
        {
            if (session == null || string.IsNullOrEmpty(session.PlayerId)) return;
            var home = session.DestinationId == GalaQuestProtocolV4.HomeHubDestinationId;
            var nearGate = !home || (traversal != null &&
                Vector2.Distance(traversal.PredictedPosition, new Vector2(0, 7)) <= 3f);
            var rect = TravelButtonRect(new Vector2(Screen.width, Screen.height));
            buttonStyle ??= new GUIStyle(GUI.skin.button)
            { fontSize = 20, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
            var oldEnabled = GUI.enabled;
            GUI.enabled = nearGate && !session.IsTravelling;
            var label = session.IsTravelling ? "Travelling..." : home
                ? (nearGate ? "Enter Emberworks" : "Walk to the glowing gate") : "Return to camp";
            if (GUI.Button(rect, label, buttonStyle))
                session.RequestTravel(home ? GalaQuestProtocolV4.EmberworksDeepDestinationId : GalaQuestProtocolV4.HomeHubDestinationId);
            GUI.enabled = oldEnabled;
        }

        private void OnDestroy() => BindSession(null);
    }
}
