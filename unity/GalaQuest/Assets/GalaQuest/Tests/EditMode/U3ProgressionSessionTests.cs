using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace GalaQuest.Tests
{
    public sealed class U3ProgressionSessionTests
    {
        private const string ProfileId = "profile-aaaaaaaa";
        private const string Journal = "[{\"eventId\":\"xp:new\",\"type\":\"xp-earned\",\"value\":\"100\"}]";
        private const string Welcome = "{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"worldEpoch\":0}";

        [Test]
        public void AcceptedWelcomeCanRefreshJournalBeforeRestoreAndThatJournalSurvivesReconnect()
        {
            var wire = new Wire();
            using var session = new GalaQuestConnectionSession(wire);
            session.Begin(new GalaQuestSelectedProfile(ProfileId, "Aster", "[]"));
            session.AcceptedServerMessage += _ => session.RefreshProfileJournal(ProfileId, Journal);
            wire.Open();
            wire.Receive(Welcome);
            Assert.That(wire.Sent.Last(), Does.Contain(Journal));
            session.Reconnect();
            wire.Open();
            wire.Receive(Welcome);
            Assert.That(wire.Sent.Last(), Does.Contain(Journal));
            Assert.Throws<InvalidOperationException>(() => session.RefreshProfileJournal("profile-bbbbbbbb", "[]"));
        }

        [Test]
        public void RejectedOldWorldMessagesNeverReachPersonalProgression()
        {
            var wire = new Wire();
            using var session = new GalaQuestConnectionSession(wire);
            var accepted = new List<string>();
            session.AcceptedServerMessage += accepted.Add;
            session.Begin(new GalaQuestSelectedProfile(ProfileId, "Aster", "[]"));
            wire.Open(); wire.Receive(Welcome);
            Assert.That(accepted.Count, Is.EqualTo(1));
            session.RequestTravel(GalaQuestProtocolV4.HomeHubDestinationId);
            wire.Receive("{\"v\":4,\"type\":\"snapshot\",\"worldEpoch\":0}");
            wire.Receive("{\"v\":4,\"type\":\"destination-changed\",\"id\":\"p2\",\"destinationId\":\"home-hub\",\"worldEpoch\":1}");
            wire.Receive(Welcome);
            Assert.That(accepted.Count, Is.EqualTo(1));
            wire.Receive("{\"v\":4,\"type\":\"destination-changed\",\"id\":\"p1\",\"destinationId\":\"home-hub\",\"worldEpoch\":1}");
            Assert.That(accepted.Count, Is.EqualTo(2));
            wire.Receive("{\"v\":4,\"type\":\"snapshot\",\"worldEpoch\":0}");
            Assert.That(accepted.Count, Is.EqualTo(2));
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
        }
    }
}
