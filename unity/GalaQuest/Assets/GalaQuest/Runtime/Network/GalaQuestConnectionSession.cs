using System;

namespace GalaQuest
{
    public sealed class GalaQuestConnectionSession : IDisposable
    {
        private readonly IGalaQuestTransport transport;
        private GalaQuestSelectedProfile profile;
        private bool begun;
        private bool restoredThisConnection;

        public GalaQuestConnectionSession(IGalaQuestTransport transport)
        {
            this.transport = transport ?? throw new ArgumentNullException(nameof(transport));
            transport.Opened += HandleOpened;
            transport.MessageReceived += HandleMessage;
            transport.Closed += HandleClosed;
        }

        public event Action<string> StatusChanged;
        public event Action Disconnected;
        public string PlayerId { get; private set; } = string.Empty;

        public void Begin(GalaQuestSelectedProfile selectedProfile)
        {
            if (begun) throw new InvalidOperationException("This connection session already has a selected profile.");
            profile = selectedProfile;
            begun = true;
            StatusChanged?.Invoke($"Connecting as {profile.DisplayName}...");
            transport.Connect();
        }

        public void Reconnect()
        {
            if (!begun) return;
            StatusChanged?.Invoke($"Reconnecting as {profile.DisplayName}...");
            transport.Connect();
        }

        private void HandleOpened()
        {
            restoredThisConnection = false;
            PlayerId = string.Empty;
            if (!transport.Send(GalaQuestProtocolV4.Join(profile)))
            {
                StatusChanged?.Invoke("Connected, but the profile join could not be sent.");
                return;
            }
            StatusChanged?.Invoke($"Joining as {profile.DisplayName}...");
        }

        private void HandleMessage(string message)
        {
            if (restoredThisConnection || !GalaQuestProtocolV4.TryReadWelcome(message, out var playerId)) return;
            PlayerId = playerId;
            if (!transport.Send(GalaQuestProtocolV4.RestoreProfile(profile)))
            {
                StatusChanged?.Invoke("Joined, but the selected profile journal could not be restored.");
                return;
            }
            restoredThisConnection = true;
            StatusChanged?.Invoke($"Connected · {profile.DisplayName}");
        }

        private void HandleClosed(string detail)
        {
            StatusChanged?.Invoke("Connection interrupted · reconnecting safely");
            Disconnected?.Invoke();
        }

        public void Dispose()
        {
            transport.Opened -= HandleOpened;
            transport.MessageReceived -= HandleMessage;
            transport.Closed -= HandleClosed;
            transport.Close();
        }
    }
}
