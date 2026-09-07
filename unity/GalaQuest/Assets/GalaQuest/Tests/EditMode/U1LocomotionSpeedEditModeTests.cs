using System;
using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class U1LocomotionSpeedEditModeTests
    {
        private GameObject root;
        private GameObject hero;
        private GalaQuestTraversalController movement;
        private GalaQuestConnectionSession session;
        private FakeTransport transport;

        [SetUp] public void SetUp()
        {
            root = new GameObject("Locomotion speed root");
            hero = new GameObject("Locomotion speed hero");
            movement = root.AddComponent<GalaQuestTraversalController>();
            movement.Configure(null, hero.transform);
            transport = new FakeTransport();
            session = new GalaQuestConnectionSession(transport);
            movement.BindSession(session);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Motion test", "[]"));
            transport.Open();
            Place(-3f, 12f);
        }

        [TearDown] public void TearDown()
        {
            session.Dispose();
            UnityEngine.Object.DestroyImmediate(root);
            UnityEngine.Object.DestroyImmediate(hero);
        }

        [TestCase(false, 1.7f)]
        [TestCase(true, 3.6f)]
        public void PresentedSpeedMatchesActualPredictedAdvance(bool run, float expected)
        {
            movement.StepPrediction(Vector2.up, 1f, run, 0.1f);
            Assert.That(movement.PredictedMotionSpeed, Is.Zero, "the first input does not spend prior idle time");
            var start = movement.PredictedPosition;
            movement.StepPrediction(Vector2.up, 1f, run, 0.1f);
            Assert.That(movement.PredictedMotionSpeed, Is.EqualTo(expected).Within(0.001f));
            Assert.That(movement.PredictedMotionSpeed,
                Is.EqualTo(Vector2.Distance(start, movement.PredictedPosition) / 0.1f).Within(0.001f));
        }

        [Test] public void ReleaseReconciliationAndDisconnectCannotProduceWalking()
        {
            movement.StepPrediction(Vector2.up, 1f, true, 0.1f);
            movement.StepPrediction(Vector2.up, 1f, true, 0.1f);
            movement.StepPrediction(Vector2.zero, 0f, false, 0.1f);
            Assert.That(movement.PredictedMotionSpeed, Is.Zero);
            transport.Receive("{\"v\":4,\"type\":\"snapshot\",\"players\":[{\"id\":\"p1\",\"x\":3,\"z\":14}]}");
            movement.ApplyPendingReconciliation();
            Assert.That(movement.PredictedPosition.x, Is.EqualTo(3f));
            Assert.That(movement.PredictedMotionSpeed, Is.Zero, "a server correction is not a walking stride");
            movement.BindSession(null);
            movement.StepPrediction(Vector2.up, 1f, true, 0.1f);
            Assert.That(movement.PredictedMotionSpeed, Is.Zero);
        }

        [Test] public void BlockedInputStaysIdleAndSlidingUsesActualDistance()
        {
            Place(4f, GalaQuestEmberworksMovementWorld.MaxZ);
            movement.StepPrediction(Vector2.up, 1f, true, 0.1f);
            movement.StepPrediction(Vector2.up, 1f, true, 0.1f);
            Assert.That(movement.PredictedMotionSpeed, Is.Zero);
            var start = movement.PredictedPosition;
            movement.StepPrediction(new Vector2(1f, 1f), 1f, true, 0.1f);
            Assert.That(movement.PredictedMotionSpeed, Is.GreaterThan(0f).And.LessThan(GalaQuestMovementLaw.RunSpeed));
            Assert.That(movement.PredictedMotionSpeed,
                Is.EqualTo(Vector2.Distance(start, movement.PredictedPosition) / 0.1f).Within(0.001f));
        }

        private void Place(float x, float z) => transport.Receive(
            "{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"players\":[{\"id\":\"p1\",\"x\":" +
            x.ToString(System.Globalization.CultureInfo.InvariantCulture) + ",\"z\":" +
            z.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}]}");

        private sealed class FakeTransport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public void Connect() { }
            public bool Send(string message) => true;
            public void Close() => Closed?.Invoke("closed");
            public void Open() => Opened?.Invoke();
            public void Receive(string value) => MessageReceived?.Invoke(value);
        }
    }
}
