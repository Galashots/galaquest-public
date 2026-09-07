using UnityEngine;

namespace GalaQuest
{
    [RequireComponent(typeof(BrowserSelectedProfileSource), typeof(BrowserWebSocketTransport), typeof(GalaQuestTraversalController))]
    public sealed class GalaQuestGameEntry : MonoBehaviour
    {
        private const float ReconnectDelaySeconds = 2f;
        private IGalaQuestSelectedProfileSource profileSource;
        private GalaQuestConnectionSession session;
        private string profileName = "Waiting for existing GalaQuest profile";
        private string connectionStatus = "Starting Unity Web client...";
        private bool shuttingDown;
        private GalaQuestTraversalController traversal;

        private void Awake()
        {
            if (GetComponent<GalaQuestFloatingJoystick>() == null)
                gameObject.AddComponent<GalaQuestFloatingJoystick>();
            profileSource = GetComponent<BrowserSelectedProfileSource>();
            traversal = GetComponent<GalaQuestTraversalController>();
            profileSource.Selected += HandleSelected;
            profileSource.Failed += HandleProfileFailure;
        }

        private void Start()
        {
            profileSource.ReadSelected();
        }

        private void HandleSelected(GalaQuestSelectedProfile profile)
        {
            profileName = profile.DisplayName;
            session = new GalaQuestConnectionSession(GetComponent<BrowserWebSocketTransport>());
            session.StatusChanged += HandleStatus;
            session.Disconnected += ScheduleReconnect;
            traversal.BindSession(session);
            session.Begin(profile);
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
            GUI.Label(new Rect(30f, 24f, width - 28f, 22f), $"EMBERWORKS · {profileName}");
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
                session.StatusChanged -= HandleStatus;
                session.Disconnected -= ScheduleReconnect;
                session.Dispose();
            }
        }
    }
}
