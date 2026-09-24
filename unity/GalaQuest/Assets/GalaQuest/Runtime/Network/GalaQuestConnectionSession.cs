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
        private int specialSequence;
        private float lastInputSentAt = float.NegativeInfinity;
        private float lastMagnitude;
        private string pendingDestination;
        private bool requiresNeutralInput;
        private float travelWaitSeconds;
        private bool superseded;
        private bool interrupted;
        private bool acceptingFrames;
        public const float TravelAckTimeoutSeconds = 10f;
        public bool CanReconnect => begun && !superseded;

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
        // Typed private pet state for the Camp presenter. Null until the first accepted pet-state.
        public event Action<GalaQuestServerPetState, string> PetStateChanged;
        public GalaQuestServerPetState LatestPetState { get; private set; }
        public string LastPetError { get; private set; }
        // The CURRENT DESTINATION's forge-lit flag, decoded from encounter.forge; false until an
        // accepted encounter-carrying frame says otherwise, and an absent forge means not lit.
        //
        // Deliberately not called a shared world latch: forgeLitState is per-simulation on the
        // server (gameServerCore.mjs) and a mid-session relight only marks the simulation that
        // handled it, so travelling to a destination whose simulation predates the relight reports
        // dark until that server restarts and reseeds from the durable store. Read this as "is the
        // forge lit where I am standing", never as "has the world's forge ever been lit".
        //
        // No presenter consumes this yet. It is the decode half of the relight path; the UI that
        // needs it is a separate package (see the relight dead-end follow-up on issue #192).
        public bool ForgeLit { get; private set; }

        private void ClearPetState()
        {
            if (LatestPetState == null && LastPetError == null) return;
            LatestPetState = null;
            LastPetError = null;
            PetStateChanged?.Invoke(null, null);
        }
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
            if (!CanReconnect) return;
            interrupted = false;
            acceptingFrames = false;
            PlayerId = string.Empty;
            ClearPetState();
            ForgeLit = false;
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
            if (!CanReconnect) return;
            interrupted = false;
            acceptingFrames = true;
            restoredThisConnection = false;
            PlayerId = string.Empty;
            pendingDestination = null;
            WorldEpoch = 0;
            inputSequence = 0;
            attackSequence = 0;
            specialSequence = 0;
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
            travelWaitSeconds = 0f;
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

        // Called every frame with unscaled time, even while movement is blocked or paused.
        public void AdvanceRecovery(float deltaSeconds)
        {
            if (!IsTravelling) return;
            travelWaitSeconds += Mathf.Max(0f, deltaSeconds);
            if (travelWaitSeconds < TravelAckTimeoutSeconds) return;
            // DestinationId still names the last server-confirmed world. Retire the uncertain
            // socket and use the existing reconnect seam; no arrival is invented locally.
            transport.Close();
            HandleClosed("Travel acknowledgement timed out");
        }

        private void HandleMessage(string message)
        {
            if (!acceptingFrames) return;
            if (!GalaQuestProtocolV4.TryReadServerFrame(message, out var frame)) return;
            if (frame.type == "welcome")
            {
                if (!string.IsNullOrEmpty(PlayerId) || string.IsNullOrEmpty(frame.id) || frame.worldEpoch != 0) return;
                PlayerId = frame.id;
                if (!string.IsNullOrEmpty(frame.destinationId)) DestinationId = frame.destinationId;
                // A welcome is a new connection identity. Pet state is per-connection private
                // state, so carrying the previous connection's block across a reconnect would
                // show a follower this session has not been told about yet.
                ClearPetState();
            }
            else if (frame.type == "destination-changed")
            {
                if (!IsTravelling || frame.id != PlayerId || frame.destinationId != pendingDestination
                    || frame.worldEpoch != WorldEpoch + 1) return;
                WorldEpoch = frame.worldEpoch;
                DestinationId = frame.destinationId;
                // The pet camp lives in one destination (progression/pets.js:7). Leaving it
                // retires the state rather than letting a stale block outlive the world it
                // described; the next accepted pet-state re-establishes it.
                ClearPetState();
                pendingDestination = null;
                lastInputSentAt = float.NegativeInfinity;
                StatusChanged?.Invoke($"Connected · {profile.DisplayName}");
            }
            else if (frame.type == "forge-state")
            {
                if (IsTravelling || string.IsNullOrEmpty(PlayerId) || frame.id != PlayerId
                    || frame.destinationId != DestinationId || frame.worldEpoch != WorldEpoch) return;
            }
            else if (frame.type == "pet-state")
            {
                // Identical boundary to forge-state: pet-state is private addressed state for this
                // connection only (pet-server.test.mjs:409-411), so a frame naming another player,
                // another destination or a stale epoch is discarded rather than applied.
                if (IsTravelling || string.IsNullOrEmpty(PlayerId) || frame.id != PlayerId
                    || frame.destinationId != DestinationId || frame.worldEpoch != WorldEpoch) return;
                LatestPetState = frame.pets;
                LastPetError = frame.error;
                PetStateChanged?.Invoke(frame.pets, frame.error);
            }
            else if (IsTravelling || string.IsNullOrEmpty(PlayerId) || frame.worldEpoch != WorldEpoch) return;

            // The shared Forge-lit latch rides welcome, snapshot and destination-changed
            // (gameServerCore.mjs encounterSnapshotWithRewards). forge-state and pet-state
            // carry no encounter, so they must never clobber it.
            if (frame.type != "forge-state" && frame.type != "pet-state")
                ForgeLit = frame.encounter?.forge?.lit == true;

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

        [Serializable]
        private sealed class CloseDetails { public int code; }

        private void HandleClosed(string detail)
        {
            if (interrupted) return;
            interrupted = true;
            acceptingFrames = false;
            // 4001 is this server's bounded same-profile takeover signal, not a network failure.
            if (!string.IsNullOrEmpty(detail) && detail.StartsWith("{", StringComparison.Ordinal))
            {
                try { superseded = JsonUtility.FromJson<CloseDetails>(detail)?.code == 4001; }
                catch (ArgumentException) { }
            }
            PlayerId = string.Empty;
            ClearPetState();
            ForgeLit = false;
            pendingDestination = null;
            StatusChanged?.Invoke(superseded
                ? "Profile opened elsewhere · continue in the newer session"
                : "Connection interrupted · reconnecting safely");
            Disconnected?.Invoke();
        }

        public void Dispose()
        {
            PlayerId = string.Empty;
            pendingDestination = null;
            begun = false;
            acceptingFrames = false;
            transport.Opened -= HandleOpened;
            transport.MessageReceived -= HandleMessage;
            transport.Closed -= HandleClosed;
            transport.Close();
        }

        public bool TrySendPetAction(string action, string petId, string eventId, int rev) =>
            ControlsReady && DestinationId == GalaQuestProtocolV4.HomeHubDestinationId
            && !string.IsNullOrEmpty(action) && !string.IsNullOrEmpty(petId)
            && !string.IsNullOrEmpty(eventId) && rev >= 0
            && transport.Send(GalaQuestProtocolV4.PetAction(action, petId, eventId, rev, WorldEpoch));

        public bool TrySendAttackIntent()
        {
            if (!ControlsReady) return false;
            return transport.Send(GalaQuestProtocolV4.Attack(++attackSequence, WorldEpoch));
        }

        public bool TrySendSpecialIntent()
        {
            if (!ControlsReady) return false;
            return transport.Send(GalaQuestProtocolV4.Special(++specialSequence, WorldEpoch));
        }

        public bool TryOpenRuneForge() => ControlsReady
            && DestinationId == GalaQuestProtocolV4.EmberworksDeepDestinationId
            && transport.Send(GalaQuestProtocolV4.ForgeOpen(WorldEpoch));

        public bool TrySelectRuneForgePack(string packId) => ControlsReady && !string.IsNullOrEmpty(packId)
            && transport.Send(GalaQuestProtocolV4.ForgeSelectPack(packId, WorldEpoch));

        public bool TryAnswerRuneForge(string taskId, string choiceId, string contentVersion) => ControlsReady
            && !string.IsNullOrEmpty(taskId) && !string.IsNullOrEmpty(choiceId) && !string.IsNullOrEmpty(contentVersion)
            && transport.Send(GalaQuestProtocolV4.ForgeAnswer(taskId, choiceId, contentVersion, WorldEpoch));

        public bool TryRequestRuneForgeHint(string taskId, string contentVersion) => ControlsReady
            && !string.IsNullOrEmpty(taskId) && !string.IsNullOrEmpty(contentVersion)
            && transport.Send(GalaQuestProtocolV4.ForgeHint(taskId, contentVersion, WorldEpoch));

        public bool TryClaimRuneForge() => ControlsReady
            && transport.Send(GalaQuestProtocolV4.ForgeClaim(WorldEpoch));

        public bool TryRelightRuneForge() => ControlsReady
            && transport.Send(GalaQuestProtocolV4.ForgeRelight(WorldEpoch));

        public bool TryEquip(string itemId) => ControlsReady && !string.IsNullOrEmpty(itemId)
            && transport.Send(GalaQuestProtocolV4.Equip(itemId, WorldEpoch));
    }
}
