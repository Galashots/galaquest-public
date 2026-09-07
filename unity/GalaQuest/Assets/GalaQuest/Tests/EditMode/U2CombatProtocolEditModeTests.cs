using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class U2CombatProtocolEditModeTests
    {
        [Test]
        public void ActualNodeSnapshotPreservesBothHeroRecordsEnemyIdentityAndSwingEvent()
        {
            // Captured from createSimulation + protocolCore.snapshotMessage at aed8401.
            var json = File.ReadAllText("Assets/GalaQuest/Tests/Fixtures/U2CombatSnapshot.json");
            Assert.That(GalaQuestProtocolV4.TryReadServerFrame(json, out var frame), Is.True);
            Assert.That(frame.destinationId, Is.EqualTo("emberworks-deep"));
            Assert.That(frame.players.Length, Is.EqualTo(2));
            Assert.That(frame.encounter.heroes.Keys, Is.EquivalentTo(new[] { "p1", "p2" }));
            Assert.That(frame.encounter.heroes["p1"].swingSeconds, Is.EqualTo(.1f));
            Assert.That(frame.encounter.heroes["p2"].swingSeconds, Is.EqualTo(-1f));
            Assert.That(frame.encounter.heroes["p1"].maxHp, Is.EqualTo(30));
            var enemy = frame.encounter.enemies.Single();
            Assert.That(enemy.enemyId, Is.EqualTo("emberworks-gremlin-1"));
            Assert.That(enemy.kind, Is.EqualTo("lava-gremlin"));
            Assert.That(enemy.mode, Is.EqualTo("walk"));
            Assert.That(enemy.hp, Is.EqualTo(30));
            Assert.That(frame.events.Single().type, Is.EqualTo("swing"));
            Assert.That(frame.events.Single().heroId, Is.EqualTo("p1"));
        }

        [TestCase("not-json")]
        [TestCase("null")]
        [TestCase("[]")]
        [TestCase("{\"v\":3,\"type\":\"snapshot\"}")]
        [TestCase("{\"v\":4,\"type\":\"snapshot\",\"encounter\":{\"heroes\":[]}}")]
        [TestCase("{\"v\":4,\"type\":\"snapshot\"} trailing")]
        public void MalformedOrWrongVersionFramesAreRejected(string json)
        {
            Assert.That(GalaQuestProtocolV4.TryReadServerFrame(json, out _), Is.False);
        }

        [Test]
        public void OlderMinimalWelcomeStillHasSafeEmptyCollections()
        {
            Assert.That(GalaQuestProtocolV4.TryReadServerFrame("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}", out var frame), Is.True);
            Assert.That(frame.players, Is.Empty);
            Assert.That(frame.encounter.enemies, Is.Empty);
            Assert.That(frame.encounter.heroes, Is.Empty);
            Assert.That(frame.events, Is.Empty);
        }

        [Test]
        public void AttackIsIndependentOfMovementAndWaitsForFreshWelcomeAfterDisconnect()
        {
            var transport = new FakeTransport();
            using var session = new GalaQuestConnectionSession(transport);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Younger", "[]"));
            Assert.That(session.TrySendAttackIntent(), Is.False);
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");
            Assert.That(session.TrySendMovementIntent(Vector2.up, 1f, false, 0), Is.True);
            Assert.That(session.TrySendAttackIntent(), Is.True);
            Assert.That(session.TrySendMovementIntent(Vector2.zero, 0f, false, .01f), Is.True, "Attack cannot delay the movement release");
            Assert.That(session.TrySendAttackIntent(), Is.True);
            var attacks = transport.Sent.Where(packet => packet.Contains("\"type\":\"attack\"")).ToArray();
            Assert.That(attacks, Is.EqualTo(new[] { "{\"v\":4,\"type\":\"attack\",\"seq\":1}", "{\"v\":4,\"type\":\"attack\",\"seq\":2}" }));
            transport.Close();
            Assert.That(session.PlayerId, Is.Empty);
            Assert.That(session.TrySendAttackIntent(), Is.False);
            Assert.That(session.TrySendMovementIntent(Vector2.up, 1f, false, 1), Is.False);
            session.Reconnect();
            transport.Open();
            Assert.That(session.TrySendAttackIntent(), Is.False);
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p2\"}");
            Assert.That(session.TrySendAttackIntent(), Is.True);
            Assert.That(transport.Sent.Last(), Is.EqualTo(attacks[0]));
        }

        private sealed class FakeTransport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public readonly List<string> Sent = new List<string>();
            public void Connect() { }
            public bool Send(string message) { Sent.Add(message); return true; }
            public void Close() => Closed?.Invoke("interrupted");
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
        }
    }
}
