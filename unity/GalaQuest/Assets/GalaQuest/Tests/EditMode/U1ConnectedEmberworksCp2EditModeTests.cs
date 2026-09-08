using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class U1ConnectedEmberworksCp2EditModeTests
    {
        [TestCase(0f, false, 0f)]
        [TestCase(0.25f, false, 0.6854839f)]
        [TestCase(0.5f, false, 1.3709677f)]
        [TestCase(0.62f, false, 1.7f)]
        [TestCase(1f, false, 1.7f)]
        [TestCase(0.62f, true, 1.7f)]
        [TestCase(0.8f, true, 2.6f)]
        [TestCase(1f, true, 3.6f)]
        public void GroundSpeedMatchesRepresentativeJavaScriptAuthority(float magnitude, bool run, float expected)
        {
            Assert.That(GalaQuestMovementLaw.GroundSpeedForInput(magnitude, run), Is.EqualTo(expected).Within(0.0002f));
        }

        [Test]
        public void PredictionCarriesBoundedBacklogAndDropsStationaryDebt()
        {
            var firstPress = GalaQuestMovementLaw.PredictionStep(0.9f, 0f, true, false);
            Assert.That(firstPress.DeltaSeconds, Is.Zero);
            Assert.That(firstPress.BacklogSeconds, Is.Zero);

            var hitch = GalaQuestMovementLaw.PredictionStep(0.9f, 0f, true, true);
            Assert.That(hitch.DeltaSeconds, Is.EqualTo(0.25f));
            Assert.That(hitch.BacklogSeconds, Is.EqualTo(0.65f).Within(0.0001f));

            var released = GalaQuestMovementLaw.PredictionStep(0.1f, hitch.BacklogSeconds, false, true);
            Assert.That(released.BacklogSeconds, Is.Zero);
        }

        [Test]
        public void ReconciliationNudgesSmallDriftAndSnapsLargeDrift()
        {
            var nudge = GalaQuestMovementLaw.Reconcile(Vector2.zero, new Vector2(0.5f, 0f), 2);
            Assert.That(nudge.Snapped, Is.False);
            Assert.That(nudge.Position.x, Is.EqualTo(0.095f).Within(0.0001f));
            var snap = GalaQuestMovementLaw.Reconcile(Vector2.zero, new Vector2(0.7f, 0f));
            Assert.That(snap.Snapped, Is.True);
            Assert.That(snap.Position, Is.EqualTo(new Vector2(0.7f, 0f)));
        }

        [Test]
        public void IdentityPositionAndHeadingConversionsRoundTrip()
        {
            var server = new Vector2(-3.25f, 18.5f);
            var unity = GalaQuestServerCoordinates.ToUnityPosition(server, 0.25f);
            Assert.That(GalaQuestServerCoordinates.ToServerPosition(unity), Is.EqualTo(server));
            foreach (var heading in new[] { -2.4f, -0.5f, 0f, 0.8f, 2.9f })
            {
                var roundTrip = GalaQuestServerCoordinates.ToServerHeading(
                    GalaQuestServerCoordinates.ToUnityHeading(heading));
                Assert.That(Mathf.DeltaAngle(heading * Mathf.Rad2Deg, roundTrip * Mathf.Rad2Deg), Is.Zero.Within(0.001f));
            }
        }
    }
}
