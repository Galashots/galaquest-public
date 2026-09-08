using UnityEngine;

namespace GalaQuest
{
    [RequireComponent(typeof(BrowserSelectedProfileSource), typeof(BrowserWebSocketTransport), typeof(GalaQuestTraversalController))]
    public sealed class GalaQuestGameEntry : MonoBehaviour
    {
        [SerializeField] private string initialDestination = GalaQuestProtocolV4.EmberworksDeepDestinationId;
        private const float ReconnectDelaySeconds = 2f;
        private IGalaQuestSelectedProfileSource profileSource;
        private GalaQuestConnectionSession session;
        private string profileName = "Waiting for existing GalaQuest profile";
        private string connectionStatus = "Starting Unity Web client...";
        private bool shuttingDown;
        private GalaQuestTraversalController traversal;
        private GalaQuestAttackControl attack;
        private GalaQuestCombatPresentation combat;
        private GalaQuestDestinationPresentation destinations;

        public void ConfigureInitialDestination(string destinationId) => initialDestination = destinationId;

        private void Awake()
        {
            if (GetComponent<GalaQuestFloatingJoystick>() == null)
                gameObject.AddComponent<GalaQuestFloatingJoystick>();
            attack = GetComponent<GalaQuestAttackControl>();
            if (attack == null) attack = gameObject.AddComponent<GalaQuestAttackControl>();
            profileSource = GetComponent<BrowserSelectedProfileSource>();
            traversal = GetComponent<GalaQuestTraversalController>();
            combat = GetComponent<GalaQuestCombatPresentation>();
            destinations = GetComponent<GalaQuestDestinationPresentation>();
            profileSource.Selected += HandleSelected;
            profileSource.Failed += HandleProfileFailure;
        }

        private void Start()
        {
            if (destinations != null) destinations.ShowDestination(initialDestination);
            profileSource.ReadSelected();
        }

        private void HandleSelected(GalaQuestSelectedProfile profile)
        {
            profileName = profile.DisplayName;
            session = new GalaQuestConnectionSession(GetComponent<BrowserWebSocketTransport>());
            session.StatusChanged += HandleStatus;
            session.Disconnected += ScheduleReconnect;
            if (destinations != null) destinations.BindSession(session);
            traversal.BindSession(session);
            attack.BindSession(session);
            if (combat != null) combat.BindSession(session);
            session.Begin(profile, initialDestination);
        }

        private void HandleProfileFailure(string error)
        {
            connectionStatus = error;
            Debug.LogError($"[GQ-U1] {error}");
        }

        private void HandleStatus(string status)
        {
            connectionStatus = status;
            Debug.Log($"[GQ-U1] {status}");
        }

        private void ScheduleReconnect()
        {
            if (!shuttingDown) Invoke(nameof(Reconnect), ReconnectDelaySeconds);
        }

        private void Reconnect()
        {
            session?.Reconnect();
        }

        private void OnGUI()
        {
            var width = Mathf.Min(360f, Screen.width - 32f);
            var rect = new Rect(16f, 16f, width, 66f);
            GUI.Box(rect, string.Empty);
            var destination = session?.DestinationId ?? initialDestination;
            var place = destination == GalaQuestProtocolV4.HomeHubDestinationId ? "CAMP" : "EMBERWORKS";
            GUI.Label(new Rect(30f, 24f, width - 28f, 22f), $"{place} · {profileName}");
            GUI.Label(new Rect(30f, 48f, width - 28f, 22f), connectionStatus);
        }

        private void OnDestroy()
        {
            shuttingDown = true;
            CancelInvoke();
            if (profileSource != null)
            {
                profileSource.Selected -= HandleSelected;
                profileSource.Failed -= HandleProfileFailure;
            }
            if (session != null)
            {
                traversal?.BindSession(null);
                if (attack != null) attack.BindSession(null);
                if (combat != null) combat.BindSession(null);
                if (destinations != null) destinations.BindSession(null);
                session.StatusChanged -= HandleStatus;
                session.Disconnected -= ScheduleReconnect;
                session.Dispose();
            }
        }
    }
}
