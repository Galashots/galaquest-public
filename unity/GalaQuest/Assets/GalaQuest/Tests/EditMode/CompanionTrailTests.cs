using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class CompanionTrailTests
    {
        const float Eps = 1e-3f;

        static void Drive(GalaQuestCompanionTrail t, Vector3 owner, int steps, float dt)
        {
            for (var i = 0; i < steps; i++) t.Step(owner, dt);
        }

        [Test]
        public void ResetPlacesFollowerBehindOwnerAndFacesForward()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            Assert.That(t.Position.x, Is.EqualTo(0f).Within(1e-4f));
            Assert.That(t.Position.z, Is.EqualTo(-1f).Within(1e-4f));
            Assert.That(t.Facing.normalized.z, Is.EqualTo(1f).Within(1e-4f));
            Assert.That(t.NeedsReset, Is.False);
            Assert.That(t.Moving, Is.False);
        }

        [Test]
        public void FollowerTurnsOnlyAfterReachingTheBend()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            t.Step(new Vector3(0f, 0f, 2f), .01f);
            t.Step(new Vector3(2f, 0f, 2f), .01f); // owner bent east

            var turned = false;
            // Inspect EVERY step while catching up: x must stay 0 while z < 2 - eps.
            for (var i = 0; i < 400; i++)
            {
                t.Step(new Vector3(2f, 0f, 2f), .01f);
                if (t.Position.z < 2f - Eps)
                {
                    Assert.That(t.Position.x, Is.EqualTo(0f).Within(Eps),
                        "premature planar drift before corner at step " + i);
                    Assert.That(t.Facing.normalized.z, Is.GreaterThan(0.9f));
                }
                if (Mathf.Abs(t.Position.x) > Eps) turned = true;
            }

            // Through the corner the follower turns east and settles 1m behind owner.
            Assert.That(turned, Is.True, "follower never observed turning east");
            Assert.That(t.Position.x, Is.EqualTo(1f).Within(Eps));
            Assert.That(t.Position.z, Is.EqualTo(2f).Within(Eps));
            Assert.That(t.Position.y, Is.EqualTo(0f).Within(Eps));
            Assert.That(t.Facing.normalized.x, Is.GreaterThan(0.9f));
            Assert.That(t.Moving, Is.False);
        }

        [Test]
        public void IdleOwnerLeavesQueueAndFacingStable()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            var owner = new Vector3(0f, 0f, 3f);
            t.Step(owner, .05f);
            // Let catch-up settle first.
            Drive(t, owner, 200, .05f);

            var count = t.SampleCount;
            var facing = t.Facing;
            var pos = t.Position;
            for (var i = 0; i < 50; i++) t.Step(owner, .05f);

            Assert.That(t.SampleCount, Is.EqualTo(count));
            Assert.That(Vector3.Angle(facing, t.Facing), Is.EqualTo(0f).Within(Eps));
            Assert.That((t.Position - pos).magnitude, Is.EqualTo(0f).Within(Eps));

            // Rotating ownerForward with a stationary owner must not move the follower.
            var fwd0 = t.Facing;
            for (var i = 0; i < 30; i++)
            {
                var fwd = Quaternion.Euler(0f, i * 10f, 0f) * Vector3.forward;
                t.Step(owner, fwd, .05f);
                Assert.That((t.Position - pos).magnitude, Is.EqualTo(0f).Within(Eps));
            }
            Assert.That(Vector3.Angle(fwd0, t.Facing), Is.EqualTo(0f).Within(Eps));
        }

        [Test]
        public void StraightWalkStaysBehindOwnerWithinFollowDistance()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            var owner = Vector3.zero;
            for (var i = 0; i < 200; i++)
            {
                owner += new Vector3(0f, 0f, 0.05f);
                t.Step(owner, 1f / 60f);
            }
            var gap = (t.Position - owner).magnitude;
            Assert.That(gap, Is.GreaterThan(0.5f));
            Assert.That(gap, Is.LessThan(2f));
        }

        [Test]
        public void DisplacementNeverExceedsMaxSpeedTimesDtAndDtIsCapped()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            var owner = new Vector3(0f, 0f, 5f);
            t.Step(owner, .01f);
            var before = t.Position;
            t.Step(owner, 10f); // dt cap .1
            var moved = (t.Position - before).magnitude;
            Assert.That(moved, Is.LessThanOrEqualTo(GalaQuestCompanionTrail.MaxSpeed * GalaQuestCompanionTrail.MaxDt + 1e-3f));
        }

        [Test]
        public void NonFiniteInputIsRejectedWithoutMutation()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            t.Step(new Vector3(0f, 0f, 2f), .05f);
            var pos = t.Position;
            var facing = t.Facing;
            var count = t.SampleCount;

            Assert.That(t.Step(new Vector3(float.NaN, 0f, 0f), .05f), Is.EqualTo(pos));
            Assert.That(t.Step(new Vector3(0f, 0f, 2f), float.PositiveInfinity), Is.EqualTo(pos));
            Assert.That(t.Step(new Vector3(0f, 0f, 2f), new Vector3(float.NaN, 0f, 0f), .05f), Is.EqualTo(pos));

            Assert.That(t.Position, Is.EqualTo(pos));
            Assert.That(t.Facing, Is.EqualTo(facing));
            Assert.That(t.SampleCount, Is.EqualTo(count));
        }

        [Test]
        public void InvalidConstructionAndResetLeaveFiniteQuietState()
        {
            var bad = new GalaQuestCompanionTrail(new Vector3(float.NaN, 0f, 0f), Vector3.forward);
            AssertFiniteQuiet(bad);

            var good = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            good.Step(new Vector3(0f, 0f, 2f), .05f);
            var pos = good.Position;
            good.Reset(new Vector3(float.PositiveInfinity, 0f, 0f), Vector3.forward);
            Assert.That(good.Position, Is.EqualTo(pos), "invalid reset after init must be a no-op");
            Assert.That(good.NeedsReset, Is.False);
        }

        static void AssertFiniteQuiet(GalaQuestCompanionTrail t)
        {
            Assert.That(IsFinite(t.Position), Is.True);
            Assert.That(IsFinite(t.Facing), Is.True);
            Assert.That(t.SampleCount, Is.EqualTo(0));
            Assert.That(t.NeedsReset, Is.False);
            Assert.That(t.Moving, Is.False);
        }

        static bool IsFinite(Vector3 v) =>
            !float.IsNaN(v.x) && !float.IsInfinity(v.x) &&
            !float.IsNaN(v.y) && !float.IsInfinity(v.y) &&
            !float.IsNaN(v.z) && !float.IsInfinity(v.z);

        [Test]
        public void NearOwnerButTeleportFromPreviousOwnerTriggersReset()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            t.Step(new Vector3(0f, 0f, .5f), .05f);
            var before = t.SampleCount;
            t.Step(new Vector3(0f, 0f, 20f), .05f); // > TeleportDistance from previous owner
            Assert.That(t.SampleCount, Is.EqualTo(1));
            Assert.That(t.Position.z, Is.EqualTo(19f).Within(1e-3f));
            Assert.That(before, Is.GreaterThan(0));
        }

        [Test]
        public void DistantFollowerWithSmallOwnerMoveDoesNotReset()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            // Genuinely create lag: move owner in small steps, no follower time to catch up.
            var owner = Vector3.zero;
            for (var i = 0; i < 300; i++)
            {
                owner += new Vector3(0f, 0f, 0.1f);
                t.Step(owner, 0f);
            }
            // Follower distance from owner exceeds TeleportDistance; must not reset.
            Assert.That((t.Position - owner).magnitude, Is.GreaterThan(GalaQuestCompanionTrail.TeleportDistance));
            Assert.That(t.NeedsReset, Is.False);
            Assert.That(t.SampleCount, Is.GreaterThan(0));
        }

        [Test]
        public void OwnerYMotionOnIdleNeverCausesPlanarDrift()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            var owner = new Vector3(0f, 0f, 3f);
            t.Step(owner, .05f);
            Drive(t, owner, 200, .05f); // settle

            var planar = new Vector2(t.Position.x, t.Position.z);
            for (var i = 0; i < 50; i++)
            {
                owner = new Vector3(0f, 3f, 3f); // idle in plane, lifted in Y
                t.Step(owner, .05f);
                Assert.That(t.Position.x, Is.EqualTo(planar.x).Within(Eps));
                Assert.That(t.Position.z, Is.EqualTo(planar.y).Within(Eps));
                Assert.That(t.Position.y, Is.EqualTo(3f).Within(Eps));
            }
            Assert.That(t.Moving, Is.False);
        }

        [Test]
        public void MovingFalseAfterSettlingAndWithZeroDt()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            var owner = new Vector3(2f, 0f, 2f);
            Drive(t, owner, 400, .05f);
            Assert.That(t.Moving, Is.False);

            t.Step(owner, 0f);
            Assert.That(t.Moving, Is.False);
            Assert.That(t.NeedsReset, Is.False);
        }

        [Test]
        public void ThreeArgumentStepTeleportsToCurrentOwnerForward()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            t.Step(new Vector3(0f, 0f, .5f), .05f);
            var fwd = new Vector3(1f, 0f, 0f);
            // Big jump triggers reset using the supplied current owner forward.
            t.Step(new Vector3(20f, 0f, 0f), fwd, .05f);

            Assert.That(t.Position.x, Is.EqualTo(19f).Within(1e-3f));
            Assert.That(t.Position.z, Is.EqualTo(0f).Within(1e-3f));
            Assert.That(t.Facing.normalized.x, Is.EqualTo(1f).Within(1e-3f));
        }

        [Test]
        public void CollinearLongMarchMergesAndStaysBounded()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            var owner = Vector3.zero;
            for (var i = 0; i < 500; i++)
            {
                owner += new Vector3(0f, 0f, 0.02f);
                t.Step(owner, .5f);
            }
            Assert.That(t.SampleCount, Is.LessThanOrEqualTo(GalaQuestCompanionTrail.MaxSamples));
            Assert.That(t.NeedsReset, Is.False);
            Assert.That(t.SampleCount, Is.LessThan(50));
        }

        [Test]
        public void OverflowHoldsAndExplicitResetRecovers()
        {
            var t = new GalaQuestCompanionTrail(Vector3.zero, Vector3.forward);
            // Force many meaningful corners faster than follower can consume.
            var owner = Vector3.zero;
            var angle = 0f;
            for (var i = 0; i < 4000 && !t.NeedsReset; i++)
            {
                angle += 0.4f;
                owner += new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)) * 0.02f;
                t.Step(owner, .0001f);
            }
            Assert.That(t.NeedsReset, Is.True);
            // Holds safely: position finite.
            Assert.That(IsFinite(t.Position), Is.True);
            var held = t.Position;
            t.Step(owner, .01f);
            Assert.That(t.Position, Is.EqualTo(held));

            t.Reset(owner, Vector3.forward);
            Assert.That(t.NeedsReset, Is.False);
            Assert.That(t.SampleCount, Is.EqualTo(1));
        }
    }
}
