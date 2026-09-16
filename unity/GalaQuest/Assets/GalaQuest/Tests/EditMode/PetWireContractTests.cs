using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace GalaQuest.Tests
{
    /// <summary>
    /// Pins the Unity side of the EXISTING server pet contract (net/gameServerCore.mjs:2277-2290,
    /// public/src/net/protocolCore.js:267-284). Every expected value below is an independent
    /// literal transcribed from that server source, never a constant read back out of the class
    /// under test -- a test that restates the implementation cannot catch the implementation
    /// changing.
    /// </summary>
    public sealed class PetWireContractTests
    {
        private const string ProfileId = "profile-aaaaaaaa";
        private const string Welcome =
            "{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"worldEpoch\":0,\"destinationId\":\"home-hub\"}";

        // Exactly what the server emits, transcribed from test/pet-server.test.mjs.
        private const string PetState =
            "{\"v\":4,\"type\":\"pet-state\",\"id\":\"p1\",\"destinationId\":\"home-hub\",\"worldEpoch\":0,"
            + "\"pets\":{\"ownedPetIds\":[\"worm_green\"],\"equippedPetId\":\"worm_green\",\"equipRev\":3},"
            + "\"error\":null,\"profileFacts\":[{\"eventId\":\"pet-owned:profile-aaaaaaaa:worm_green\","
            + "\"type\":\"pet-owned\",\"value\":\"worm_green\"}]}";

        // Red if the outbound type string is ever renamed -- notably to the internal server
        // function name evaluatePetAction, which is NOT a wire type.
        [Test]
        public void OutboundPetActionTypeIsExactlyPetAction()
        {
            var json = GalaQuestProtocolV4.PetAction("befriend", "worm_green", "b1", 1, 0);
            Assert.That(json, Does.Contain("\"type\":\"pet-action\""));
            Assert.That(json, Does.Not.Contain("evaluatePetAction"));
        }

        // Red if any server-injected identity field is ever added to the outbound message. Sending
        // these would let a client assert its own ownership; gameServerCore.mjs:2280-2282 supplies
        // destinationId/x/z and applyPetAction supplies profileId/facts.
        [Test]
        public void OutboundPetActionCarriesOnlyThePermittedFields()
        {
            var json = GalaQuestProtocolV4.PetAction("follow", "worm_red", "f1", 7, 2);
            Assert.That(json, Does.Contain("\"action\":\"follow\""));
            Assert.That(json, Does.Contain("\"petId\":\"worm_red\""));
            Assert.That(json, Does.Contain("\"eventId\":\"f1\""));
            Assert.That(json, Does.Contain("\"rev\":7"));
            foreach (var forbidden in new[] { "profileId", "facts", "destinationId", "\"x\"", "\"z\"" })
            {
                Assert.That(json, Does.Not.Contain(forbidden),
                    "pet-action must never carry " + forbidden + "; the server injects it");
            }
        }

        // Red if pet-action is ever routed through WithEpoch, which omits worldEpoch entirely at 0.
        // protocolCore.js:209-213 rejects a pet-action with no worldEpoch, and 0 is the normal
        // epoch at the pet camp because welcome always arrives at epoch 0.
        [Test]
        public void OutboundPetActionCarriesWorldEpochEvenWhenItIsZero()
        {
            Assert.That(GalaQuestProtocolV4.PetAction("befriend", "worm_green", "b1", 1, 0),
                Does.Contain("\"worldEpoch\":0"));
        }

        [Test]
        public void PetStateParsesItsLiteralOwnershipFields()
        {
            Assert.That(GalaQuestProtocolV4.TryReadServerFrame(PetState, out var frame), Is.True);
            Assert.That(frame.pets.ownedPetIds, Is.EqualTo(new[] { "worm_green" }));
            Assert.That(frame.pets.equippedPetId, Is.EqualTo("worm_green"));
            Assert.That(frame.pets.equipRev, Is.EqualTo(3));
            Assert.That(frame.error, Is.Null);
        }

        [Test]
        public void PetStateCarryingAnErrorStillParsesAndKeepsTheErrorString()
        {
            var json = PetState.Replace("\"error\":null", "\"error\":\"out-of-range\"");
            Assert.That(GalaQuestProtocolV4.TryReadServerFrame(json, out var frame), Is.True);
            Assert.That(frame.error, Is.EqualTo("out-of-range"));
        }

        // Red if the acceptance boundary stops filtering pet-state by player/destination/epoch.
        [Test]
        public void StaleOrMisaddressedPetStateIsRejectedAtTheSessionBoundary()
        {
            var wire = new Wire();
            using var session = new GalaQuestConnectionSession(wire);
            var accepted = new List<string>();
            session.AcceptedServerMessage += accepted.Add;
            session.Begin(new GalaQuestSelectedProfile(ProfileId, "Aster", "[]"));
            wire.Open();
            wire.Receive(Welcome);
            Assert.That(accepted.Count, Is.EqualTo(1));

            // Another player's private state.
            wire.Receive(PetState.Replace("\"id\":\"p1\"", "\"id\":\"p2\""));
            Assert.That(accepted.Count, Is.EqualTo(1), "pet-state addressed to another player must be dropped");

            // A different world.
            wire.Receive(PetState.Replace("\"destinationId\":\"home-hub\"", "\"destinationId\":\"emberworks-deep\""));
            Assert.That(accepted.Count, Is.EqualTo(1), "pet-state for another destination must be dropped");

            session.RequestTravel(GalaQuestProtocolV4.EmberworksDeepDestinationId);
            wire.Receive("{\"v\":4,\"type\":\"destination-changed\",\"id\":\"p1\","
                + "\"destinationId\":\"emberworks-deep\",\"worldEpoch\":1}");
            var travelled = accepted.Count;
            // Epoch 0 is now stale.
            wire.Receive(PetState);
            Assert.That(accepted.Count, Is.EqualTo(travelled), "a stale-epoch pet-state must be dropped");
        }

        // Red if pet-state stops reaching progression -- profileFacts would silently stop
        // refreshing the journal, and the failure would be invisible until a reconnect.
        [Test]
        public void AcceptedPetStateReachesAcceptedServerMessageWithItsProfileFacts()
        {
            var wire = new Wire();
            using var session = new GalaQuestConnectionSession(wire);
            var accepted = new List<string>();
            session.AcceptedServerMessage += accepted.Add;
            session.Begin(new GalaQuestSelectedProfile(ProfileId, "Aster", "[]"));
            wire.Open();
            wire.Receive(Welcome);
            wire.Receive(PetState);
            Assert.That(accepted.Count, Is.EqualTo(2));
            Assert.That(accepted.Last(), Does.Contain("pet-owned:profile-aaaaaaaa:worm_green"));
            Assert.That(session.LatestPetState.equippedPetId, Is.EqualTo("worm_green"));
        }

        // Red if a reconnect or a world change leaves the previous connection's follower on screen.
        [Test]
        public void WelcomeAndDestinationChangeRetireStalePetState()
        {
            var wire = new Wire();
            using var session = new GalaQuestConnectionSession(wire);
            session.Begin(new GalaQuestSelectedProfile(ProfileId, "Aster", "[]"));
            wire.Open();
            wire.Receive(Welcome);
            wire.Receive(PetState);
            Assert.That(session.LatestPetState, Is.Not.Null);

            session.RequestTravel(GalaQuestProtocolV4.EmberworksDeepDestinationId);
            wire.Receive("{\"v\":4,\"type\":\"destination-changed\",\"id\":\"p1\","
                + "\"destinationId\":\"emberworks-deep\",\"worldEpoch\":1}");
            Assert.That(session.LatestPetState, Is.Null, "leaving the camp world must retire pet state");

            session.Reconnect();
            wire.Open();
            wire.Receive(Welcome);
            Assert.That(session.LatestPetState, Is.Null, "a reconnect must not inherit the last connection's follower");
        }

        [Test]
        public void DisconnectAndReconnectRetirePetStateBeforeReplacementWelcome()
        {
            var wire = new Wire();
            using var session = new GalaQuestConnectionSession(wire);
            var clearEvents = 0;
            session.PetStateChanged += (pets, error) => { if (pets == null && error == null) clearEvents += 1; };
            session.Begin(new GalaQuestSelectedProfile(ProfileId, "Aster", "[]"));
            wire.Open();
            wire.Receive(Welcome);
            wire.Receive(PetState);
            Assert.That(session.LatestPetState?.equippedPetId, Is.EqualTo("worm_green"));
            wire.Disconnect("network interruption");
            Assert.That(session.LatestPetState, Is.Null, "disconnect must retire visible pet state immediately");
            Assert.That(clearEvents, Is.EqualTo(1));
            session.Reconnect();
            Assert.That(session.LatestPetState, Is.Null);
            Assert.That(clearEvents, Is.EqualTo(1), "reconnect must not double-notify an already-cleared state");
            wire.Open(); wire.Receive(Welcome);
            Assert.That(clearEvents, Is.EqualTo(1), "replacement welcome must not double-notify an already-cleared state");
        }

        // Red if the sibling aggregate stops parsing -- remote followers depend on reading another
        // player's rewards.pets block, which pet-server.test.mjs:387-389 proves a sibling receives.
        [Test]
        public void SnapshotParsesNestedRewardsPetsForSelfAndSibling()
        {
            const string snapshot =
                "{\"v\":4,\"type\":\"snapshot\",\"worldEpoch\":0,\"encounter\":{\"rewards\":{"
                + "\"p1\":{\"ownedItemIds\":[],\"xp\":10,\"pets\":{\"ownedPetIds\":[\"worm_green\"],"
                + "\"equippedPetId\":\"worm_green\",\"equipRev\":1}},"
                + "\"p2\":{\"ownedItemIds\":[],\"xp\":0,\"pets\":{\"ownedPetIds\":[\"worm_red\"],"
                + "\"equippedPetId\":null,\"equipRev\":-1}}}}}";
            Assert.That(GalaQuestProtocolV4.TryReadServerFrame(snapshot, out var frame), Is.True);
            Assert.That(frame.encounter.rewards["p1"].pets.equippedPetId, Is.EqualTo("worm_green"));
            Assert.That(frame.encounter.rewards["p2"].pets.ownedPetIds, Is.EqualTo(new[] { "worm_red" }));
            Assert.That(frame.encounter.rewards["p2"].pets.equippedPetId, Is.Null,
                "null equippedPetId means resting, and must not decode as the empty string");
            Assert.That(frame.encounter.rewards["p2"].pets.equipRev, Is.EqualTo(-1));
        }

        // Red if anyone adds a second, player-level source of follower identity. The nested
        // rewards.pets block is the only aggregate source; a parallel field would desync.
        [Test]
        public void NoDuplicatePlayerLevelPetStateSourceExists()
        {
            var offenders = typeof(GalaQuestServerPlayer).GetFields()
                .Where(f => f.Name.IndexOf("pet", StringComparison.OrdinalIgnoreCase) >= 0)
                .Select(f => f.Name).ToArray();
            Assert.That(offenders, Is.Empty,
                "follower identity belongs only on encounter.rewards[id].pets, never on the player DTO");
        }

        // Red if the Unity catalog drifts from public/src/progression/pets.js. These literals are
        // transcribed from that file (lines 3-7), not read back out of GalaQuestPetCatalog.
        [Test]
        public void PetCatalogMirrorsTheServerDesignConstants()
        {
            Assert.That(GalaQuestPetCatalog.CampDestinationId, Is.EqualTo("home-hub"));
            Assert.That(GalaQuestPetCatalog.InteractionRadius, Is.EqualTo(3f));
            Assert.That(GalaQuestPetCatalog.Offers.Select(o => o.Id).ToArray(),
                Is.EqualTo(new[] { "worm_green", "worm_red" }));

            var green = GalaQuestPetCatalog.Find("worm_green");
            Assert.That(green.DisplayName, Is.EqualTo("Green Worm"));
            Assert.That(green.CampX, Is.EqualTo(-3f));
            Assert.That(green.CampZ, Is.EqualTo(1f));

            var red = GalaQuestPetCatalog.Find("worm_red");
            Assert.That(red.DisplayName, Is.EqualTo("Red Worm"));
            Assert.That(red.CampX, Is.EqualTo(3f));
            Assert.That(red.CampZ, Is.EqualTo(1f));
        }

        private sealed class Wire : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public readonly List<string> Sent = new List<string>();
            public void Connect() { }
            public void Close() { }
            public bool Send(string message) { Sent.Add(message); return true; }
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
            public void Disconnect(string detail) => Closed?.Invoke(detail);
        }
    }
}
