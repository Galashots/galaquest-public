using UnityEngine;

namespace GalaQuest
{
    [RequireComponent(typeof(BrowserSelectedProfileSource), typeof(BrowserWebSocketTransport), typeof(GalaQuestTraversalController))]
    public sealed class GalaQuestGameEntry : MonoBehaviour
    {
        [SerializeField] private string initialDestination = GalaQuestProtocolV4.EmberworksDeepDestinationId;
        private const float ReconnectDelaySeconds = 2f;
        private IGalaQuestSelectedProfileSource profileSource;
        private IGalaQuestTransport selectedTransport;
        private GalaQuestConnectionSession session;
        private string profileName = "Waiting for existing GalaQuest profile";
        private string connectionStatus = "Starting Unity Web client...";
        private bool shuttingDown;
        private GalaQuestTraversalController traversal;
        private GalaQuestAttackControl attack;
        private GalaQuestCombatPresentation combat;
        private GalaQuestDestinationPresentation destinations;
        private GalaQuestProfileProgression progression;
        private GalaQuestHeroHud hud;

        public void ConfigureInitialDestination(string destinationId) => initialDestination = destinationId;

        /// <summary>
        /// Resolve only the opt-in Editor adapters. Shipping players always use browser interop.
        /// </summary>
        private T ResolveDevelopmentOverride<T>() where T : class
        {
#if UNITY_EDITOR
            if (!GalaQuestEditorPlaySeam.Enabled) return null;
            if (typeof(T) == typeof(IGalaQuestTransport)) return GetComponent<EditorWebSocketTransport>() as T;
            if (typeof(T) == typeof(IGalaQuestSelectedProfileSource)) return GetComponent<EditorSyntheticProfileSource>() as T;
#endif
            return null;
        }

        private void Awake()
        {
            if (GetComponent<GalaQuestFloatingJoystick>() == null)
                gameObject.AddComponent<GalaQuestFloatingJoystick>();
            attack = GetComponent<GalaQuestAttackControl>();
            if (attack == null) attack = gameObject.AddComponent<GalaQuestAttackControl>();
#if UNITY_EDITOR
            // Editor-only development seam, off unless a developer enables it. It attaches a
            // synthetic profile source and a loopback transport so the Editor can play the real game
            // against a local server. Compiled out of every player, so the browser path below is the
            // only one that can ship.
            if (GalaQuestEditorPlaySeam.Enabled) GalaQuestEditorPlaySeam.Attach(gameObject);
#endif
            profileSource = ResolveDevelopmentOverride<IGalaQuestSelectedProfileSource>()
                ?? GetComponent<BrowserSelectedProfileSource>();
            // Select identity and transport together, before asynchronous profile delivery.
            selectedTransport = ResolveDevelopmentOverride<IGalaQuestTransport>()
                ?? (IGalaQuestTransport)GetComponent<BrowserWebSocketTransport>();
            traversal = GetComponent<GalaQuestTraversalController>();
            combat = GetComponent<GalaQuestCombatPresentation>();
            destinations = GetComponent<GalaQuestDestinationPresentation>();
            progression = GetComponent<GalaQuestProfileProgression>();
            if (progression == null) progression = gameObject.AddComponent<GalaQuestProfileProgression>();
            hud = GetComponent<GalaQuestHeroHud>();
            if (hud == null) hud = gameObject.AddComponent<GalaQuestHeroHud>();
            progression.Changed += hud.PresentReward;
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
            session = new GalaQuestConnectionSession(selectedTransport);
            session.StatusChanged += HandleStatus;
            session.Disconnected += ScheduleReconnect;
            progression.BindSession(session, profile.ProfileId);
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

        private void Update() => session?.AdvanceRecovery(Time.unscaledDeltaTime);

        private void ScheduleReconnect()
        {
            if (!shuttingDown && session.CanReconnect)
            {
                CancelInvoke(nameof(Reconnect));
                Invoke(nameof(Reconnect), ReconnectDelaySeconds);
            }
        }

        private void Reconnect()
        {
            session?.Reconnect();
        }

        private void OnGUI()
        {
            var destination = session?.DestinationId ?? initialDestination;
            var place = destination == GalaQuestProtocolV4.HomeHubDestinationId ? "CAMP" : "EMBERWORKS";
            hud?.Draw(profileName, place, connectionStatus, progression, combat,
                session != null && !string.IsNullOrEmpty(session.PlayerId) && !session.IsTravelling);
        }

        private void OnDestroy()
        {
            shuttingDown = true;
            CancelInvoke();
            if (progression != null && hud != null) progression.Changed -= hud.PresentReward;
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
                if (progression != null) progression.BindSession(null, null);
                session.StatusChanged -= HandleStatus;
                session.Disconnected -= ScheduleReconnect;
                session.Dispose();
            }
        }
    }
}
