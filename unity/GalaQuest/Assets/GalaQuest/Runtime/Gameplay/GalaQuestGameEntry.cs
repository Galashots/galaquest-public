using UnityEngine;

namespace GalaQuest
{
    [RequireComponent(typeof(BrowserSelectedProfileSource), typeof(BrowserWebSocketTransport))]
    public sealed class GalaQuestGameEntry : MonoBehaviour
    {
        private const float ReconnectDelaySeconds = 2f;
        private IGalaQuestSelectedProfileSource profileSource;
        private GalaQuestConnectionSession session;
        private string profileName = "Waiting for existing GalaQuest profile";
        private string connectionStatus = "Starting Unity Web client...";
        private bool shuttingDown;

        private void Awake()
        {
            profileSource = GetComponent<BrowserSelectedProfileSource>();
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
            var width = Mathf.Min(460f, Screen.width - 32f);
            var rect = new Rect(16f, 16f, width, 112f);
            GUI.Box(rect, string.Empty);
            GUI.Label(new Rect(32f, 28f, width - 32f, 24f), "EMBERWORKS DEEP · UNITY WEB CP1");
            GUI.Label(new Rect(32f, 55f, width - 32f, 22f), $"Hero: {profileName}");
            GUI.Label(new Rect(32f, 79f, width - 32f, 38f), connectionStatus);
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
                session.StatusChanged -= HandleStatus;
                session.Disconnected -= ScheduleReconnect;
                session.Dispose();
            }
        }
    }
}
