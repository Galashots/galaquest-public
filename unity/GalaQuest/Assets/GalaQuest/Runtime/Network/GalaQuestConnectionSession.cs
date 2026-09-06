using System;
using UnityEngine;

namespace GalaQuest
{
    public sealed class GalaQuestConnectionSession : IDisposable
    {
        private readonly IGalaQuestTransport transport;
        private GalaQuestSelectedProfile profile;
        private bool begun;
        private bool restoredThisConnection;
        private int inputSequence;
        private float lastInputSentAt = float.NegativeInfinity;
        private float lastMagnitude;

        public GalaQuestConnectionSession(IGalaQuestTransport transport)
        {
            this.transport = transport ?? throw new ArgumentNullException(nameof(transport));
            transport.Opened += HandleOpened;
            transport.MessageReceived += HandleMessage;
            transport.Closed += HandleClosed;
        }

        public event Action<string> StatusChanged;
        public event Action Disconnected;
        public event Action<GalaQuestServerFrame> ServerFrameReceived;
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
            inputSequence = 0;
            lastInputSentAt = float.NegativeInfinity;
            lastMagnitude = 0f;
            if (!transport.Send(GalaQuestProtocolV4.Join(profile)))
            {
                StatusChanged?.Invoke("Connected, but the profile join could not be sent.");
                return;
            }
            StatusChanged?.Invoke($"Joining as {profile.DisplayName}...");
        }

        private void HandleMessage(string message)
        {
            if (!GalaQuestProtocolV4.TryReadServerFrame(message, out var frame)) return;
            if (frame.type == "welcome" && !string.IsNullOrEmpty(frame.id)) PlayerId = frame.id;
            ServerFrameReceived?.Invoke(frame);
            if (restoredThisConnection || frame.type != "welcome" || string.IsNullOrEmpty(PlayerId)) return;
            if (!transport.Send(GalaQuestProtocolV4.RestoreProfile(profile)))
            {
                StatusChanged?.Invoke("Joined, but the selected profile journal could not be restored.");
                return;
            }
            restoredThisConnection = true;
            StatusChanged?.Invoke($"Connected · {profile.DisplayName}");
        }

        public bool TrySendMovementIntent(Vector2 direction, float magnitude, bool run, float nowSeconds)
        {
            if (string.IsNullOrEmpty(PlayerId)) return false;
            magnitude = Mathf.Clamp01(magnitude);
            var moving = magnitude > 0f && direction.sqrMagnitude > 0f;
            direction = moving ? direction.normalized : Vector2.zero;
            if (!moving) magnitude = 0f;

            var released = lastMagnitude > 0f && magnitude == 0f;
            var interval = 1f / GalaQuestMovementLaw.InputSendHz;
            if (!released && (magnitude == 0f || nowSeconds - lastInputSentAt < interval)) return false;

            var sent = transport.Send(GalaQuestProtocolV4.Input(
                ++inputSequence,
                direction.x,
                direction.y,
                magnitude,
                run));
            if (!sent) return false;
            lastInputSentAt = nowSeconds;
            lastMagnitude = magnitude;
            return true;
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
