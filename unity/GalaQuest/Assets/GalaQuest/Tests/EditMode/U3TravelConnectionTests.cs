using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class U3TravelConnectionTests
    {
        [Test]
        public void TravelWaitsForArrivalReleasesControlsAndReconnectsToTheAcknowledgedDestination()
        {
            var transport = new Transport();
            using var session = new GalaQuestConnectionSession(transport);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Aster", "[]"));
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"destinationId\":\"emberworks-deep\"}");
            Assert.That(session.TrySendMovementIntent(Vector2.right, 1, false, 0), Is.True);
            var request = typeof(GalaQuestConnectionSession).GetMethod("RequestTravel");
            Assert.That(request, Is.Not.Null, "The Unity session needs an acknowledged travel operation");
            Assert.That(request.Invoke(session, new object[] { "home-hub" }), Is.True);
            var release = JsonUtility.FromJson<WireMessage>(transport.Sent[transport.Sent.Count - 2]);
            var travel = JsonUtility.FromJson<WireMessage>(transport.Sent.Last());
            Assert.That(release.type, Is.EqualTo("input"));
            Assert.That(release.magnitude, Is.Zero);
            Assert.That(travel.type, Is.EqualTo("travel"));
            Assert.That(travel.worldEpoch, Is.Zero);
            Assert.That(session.TrySendMovementIntent(Vector2.right, 1, false, 1), Is.False);
            Assert.That(session.TrySendAttackIntent(), Is.False);

            var arrivals = 0;
            session.ServerFrameReceived += frame => { if (frame.type == "destination-changed") arrivals++; };
            transport.Receive("{\"v\":4,\"type\":\"destination-changed\",\"id\":\"wrong-player\",\"destinationId\":\"home-hub\",\"worldEpoch\":1}");
            Assert.That(arrivals, Is.Zero);
            transport.Receive("{\"v\":4,\"type\":\"destination-changed\",\"id\":\"p1\",\"destinationId\":\"home-hub\",\"worldEpoch\":1}");
            Assert.That(arrivals, Is.EqualTo(1));
            Assert.That(session.PlayerId, Is.EqualTo("p1"));
            Assert.That(session.TrySendMovementIntent(Vector2.right, 1, false, 2), Is.False,
                "A held stick must be released before it can move in the new scene");
            session.TrySendMovementIntent(Vector2.zero, 0, false, 2);
            Assert.That(session.TrySendMovementIntent(Vector2.right, 1, false, 3), Is.True);
            Assert.That(JsonUtility.FromJson<WireMessage>(transport.Sent.Last()).worldEpoch, Is.EqualTo(1));
            Assert.That(session.TrySendAttackIntent(), Is.True);
            Assert.That(JsonUtility.FromJson<WireMessage>(transport.Sent.Last()).worldEpoch, Is.EqualTo(1));
            transport.Drop(); session.Reconnect(); transport.Open();
            var rejoin = JsonUtility.FromJson<WireMessage>(transport.Sent.Last());
            Assert.That(rejoin.destinationId, Is.EqualTo("home-hub"));
            Assert.That(rejoin.guestId, Is.EqualTo("profile-aaaaaaaa"));
        }

        [Test]
        public void ImmediateArrivalIsNotLostAndLateOldWorldSnapshotsAreIgnored()
        {
            var transport = new Transport();
            using var session = new GalaQuestConnectionSession(transport);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Aster", "[]"));
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");
            transport.OnSend = text =>
            {
                if (JsonUtility.FromJson<WireMessage>(text).type == "travel")
                    transport.Receive("{\"v\":4,\"type\":\"destination-changed\",\"id\":\"p1\",\"destinationId\":\"home-hub\",\"worldEpoch\":1}");
            };
            Assert.That(session.RequestTravel("not-a-world"), Is.False);
            Assert.That(session.RequestTravel("home-hub"), Is.True);
            Assert.That(session.DestinationId, Is.EqualTo("home-hub"));
            Assert.That(session.IsTravelling, Is.False);
            var snapshots = 0;
            session.ServerFrameReceived += frame => snapshots++;
            transport.Receive("{\"v\":4,\"type\":\"snapshot\",\"destinationId\":\"emberworks-deep\"}");
            Assert.That(snapshots, Is.Zero);
            transport.Receive("{\"v\":4,\"type\":\"snapshot\",\"destinationId\":\"home-hub\",\"worldEpoch\":1}");
            Assert.That(snapshots, Is.EqualTo(1));
        }

        [Test]
        public void FailedTravelSendCanBeRetriedAndHubUsesItsOwnMovementBounds()
        {
            var transport = new Transport { FailTravel = true };
            using var session = new GalaQuestConnectionSession(transport);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Aster", "[]"));
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");
            Assert.That(session.RequestTravel("home-hub"), Is.False);
            Assert.That(session.IsTravelling, Is.False);
            Assert.That(session.DestinationId, Is.EqualTo("emberworks-deep"));
            transport.FailTravel = false;
            Assert.That(session.RequestTravel("home-hub"), Is.True);
            Assert.That(GalaQuestDestinationMovementWorld.Move("home-hub", Vector2.zero, new Vector2(99, -99)), Is.EqualTo(new Vector2(9, -7)));
            Assert.That(GalaQuestDestinationMovementWorld.ResolvePosition("home-hub", Vector2.zero), Is.EqualTo(Vector2.zero));
        }

        [Serializable]
        private sealed class WireMessage
        {
            public string type;
            public string destinationId;
            public string guestId;
            public int worldEpoch;
            public float magnitude;
        }

        private sealed class Transport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public readonly List<string> Sent = new List<string>();
            public Action<string> OnSend;
            public bool FailTravel;
            public void Connect() { }
            public bool Send(string text)
            {
                if (FailTravel && JsonUtility.FromJson<WireMessage>(text).type == "travel") return false;
                Sent.Add(text); OnSend?.Invoke(text); return true;
            }
            public void Close() { }
            public void Open() => Opened?.Invoke();
            public void Receive(string text) => MessageReceived?.Invoke(text);
            public void Drop() => Closed?.Invoke("test disconnect");
        }
    }
}
