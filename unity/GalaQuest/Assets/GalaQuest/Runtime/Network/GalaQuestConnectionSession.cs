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
        private int attackSequence;
        private float lastInputSentAt = float.NegativeInfinity;
        private float lastMagnitude;
        private string pendingDestination;
        private bool requiresNeutralInput;

        public GalaQuestConnectionSession(IGalaQuestTransport transport)
        {
            this.transport = transport ?? throw new ArgumentNullException(nameof(transport));
            transport.Opened += HandleOpened;
            transport.MessageReceived += HandleMessage;
            transport.Closed += HandleClosed;
        }

        public event Action<string> StatusChanged;
        public event Action Disconnected;
        public event Action TravelStarted;
        public event Action<string> AcceptedServerMessage;
        public event Action<GalaQuestServerFrame> ServerFrameReceived;
        public string PlayerId { get; private set; } = string.Empty;
        public string DestinationId { get; private set; } = GalaQuestProtocolV4.EmberworksDeepDestinationId;
        public int WorldEpoch { get; private set; }
        public bool IsTravelling => pendingDestination != null;
        public bool ControlsReady => !string.IsNullOrEmpty(PlayerId) && !IsTravelling && !requiresNeutralInput;

        public void Begin(GalaQuestSelectedProfile selectedProfile,
            string destinationId = GalaQuestProtocolV4.EmberworksDeepDestinationId)
        {
            if (begun) throw new InvalidOperationException("This connection session already has a selected profile.");
            if (string.IsNullOrEmpty(destinationId)) throw new ArgumentException("A starting destination is required.");
            profile = selectedProfile;
            DestinationId = destinationId;
            begun = true;
            StatusChanged?.Invoke($"Connecting as {profile.DisplayName}...");
            transport.Connect();
        }

        public void Reconnect()
        {
            if (!begun) return;
            PlayerId = string.Empty;
            pendingDestination = null;
            StatusChanged?.Invoke($"Reconnecting as {profile.DisplayName}...");
            transport.Connect();
        }

        public void RefreshProfileJournal(string profileId, string factsJson)
        {
            if (!begun || profileId != profile.ProfileId)
                throw new InvalidOperationException("A journal cannot replace another child's selected profile.");
            var journal = factsJson?.Trim();
            if (string.IsNullOrEmpty(journal) || !journal.StartsWith("[", StringComparison.Ordinal)
                || !journal.EndsWith("]", StringComparison.Ordinal))
                throw new ArgumentException("The refreshed profile journal must be a fact array.");
            profile = new GalaQuestSelectedProfile(profile.ProfileId, profile.DisplayName, journal);
        }

        private void HandleOpened()
        {
            restoredThisConnection = false;
            PlayerId = string.Empty;
            pendingDestination = null;
            WorldEpoch = 0;
            inputSequence = 0;
            attackSequence = 0;
            lastInputSentAt = float.NegativeInfinity;
            lastMagnitude = 0f;
            if (!transport.Send(GalaQuestProtocolV4.Join(profile, DestinationId)))
            {
                StatusChanged?.Invoke("Connected, but the profile join could not be sent.");
                return;
            }
            StatusChanged?.Invoke($"Joining as {profile.DisplayName}...");
        }

        public bool RequestTravel(string destinationId)
        {
            if (string.IsNullOrEmpty(PlayerId) || IsTravelling || string.IsNullOrEmpty(destinationId)
                || destinationId == DestinationId || (destinationId != GalaQuestProtocolV4.HomeHubDestinationId
                    && destinationId != GalaQuestProtocolV4.EmberworksDeepDestinationId)) return false;
            if (!transport.Send(GalaQuestProtocolV4.Input(++inputSequence, 0, 0, 0, false, WorldEpoch))) return false;
            lastMagnitude = 0;
            pendingDestination = destinationId;
            requiresNeutralInput = true;
            TravelStarted?.Invoke();
            StatusChanged?.Invoke("Travelling...");
            if (!transport.Send(GalaQuestProtocolV4.Travel(destinationId, WorldEpoch)))
            {
                pendingDestination = null;
                StatusChanged?.Invoke("Travel could not be sent. Please try again.");
                return false;
            }
            return true;
        }

        private void HandleMessage(string message)
        {
            if (!GalaQuestProtocolV4.TryReadServerFrame(message, out var frame)) return;
            if (frame.type == "welcome")
            {
                if (!string.IsNullOrEmpty(PlayerId) || string.IsNullOrEmpty(frame.id) || frame.worldEpoch != 0) return;
                PlayerId = frame.id;
                if (!string.IsNullOrEmpty(frame.destinationId)) DestinationId = frame.destinationId;
            }
            else if (frame.type == "destination-changed")
            {
                if (!IsTravelling || frame.id != PlayerId || frame.destinationId != pendingDestination
                    || frame.worldEpoch != WorldEpoch + 1) return;
                WorldEpoch = frame.worldEpoch;
                DestinationId = frame.destinationId;
                pendingDestination = null;
                lastInputSentAt = float.NegativeInfinity;
                StatusChanged?.Invoke($"Connected · {profile.DisplayName}");
            }
            else if (IsTravelling || string.IsNullOrEmpty(PlayerId) || frame.worldEpoch != WorldEpoch) return;

            // Only messages accepted by the player/destination/epoch checks reach personal
            // progression. Its synchronous browser write refreshes the journal before restore.
            AcceptedServerMessage?.Invoke(message);
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
            if (string.IsNullOrEmpty(PlayerId) || IsTravelling) return false;
            magnitude = Mathf.Clamp01(magnitude);
            var moving = magnitude > 0f && direction.sqrMagnitude > 0f;
            direction = moving ? direction.normalized : Vector2.zero;
            if (!moving) magnitude = 0f;
            if (requiresNeutralInput)
            {
                if (magnitude == 0) requiresNeutralInput = false;
                return false;
            }
            var released = lastMagnitude > 0f && magnitude == 0f;
            var interval = 1f / GalaQuestMovementLaw.InputSendHz;
            if (!released && (magnitude == 0f || nowSeconds - lastInputSentAt < interval)) return false;
            var sent = transport.Send(GalaQuestProtocolV4.Input(
                ++inputSequence, direction.x, direction.y, magnitude, run, WorldEpoch));
            if (!sent) return false;
            lastInputSentAt = nowSeconds;
            lastMagnitude = magnitude;
            return true;
        }

        private void HandleClosed(string detail)
        {
            PlayerId = string.Empty;
            pendingDestination = null;
            StatusChanged?.Invoke("Connection interrupted · reconnecting safely");
            Disconnected?.Invoke();
        }

        public void Dispose()
        {
            PlayerId = string.Empty;
            pendingDestination = null;
            begun = false;
            transport.Opened -= HandleOpened;
            transport.MessageReceived -= HandleMessage;
            transport.Closed -= HandleClosed;
            transport.Close();
        }

        public bool TrySendAttackIntent()
        {
            if (!ControlsReady) return false;
            return transport.Send(GalaQuestProtocolV4.Attack(++attackSequence, WorldEpoch));
        }
    }
}
