using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class CombatHudLayoutTests
    {
        [Test]
        public void EngagedNameplateStaysReadableBesideTheObjective()
        {
            var viewport = new Vector2(1024, 768);
            var layout = new GalaQuestCombatHudLayout(viewport);
            var observed = new Rect(322, 170, 184, 60);
            var placed = layout.PlaceEngagedNameplate(observed, viewport);
            Assert.That(layout.CoversStatus(placed), Is.False);
            Assert.That(placed.xMax, Is.LessThanOrEqualTo(viewport.x));
            Assert.That(placed.yMax, Is.LessThanOrEqualTo(viewport.y));
            Assert.That(Vector2.Distance(placed.center, observed.center), Is.LessThan(70));
        }

        [TestCase(1024, 768)]
        [TestCase(1366, 768)]
        [TestCase(390, 844)]
        [TestCase(844, 390)]
        [TestCase(640, 360)]
        public void SupportedViewportsKeepControlsSeparateAndOnScreen(int width, int height)
        {
            var viewport = new Vector2(width, height);
            var layout = new GalaQuestCombatHudLayout(viewport);
            var controls = new[] { layout.Attack, layout.Movement, layout.Travel, layout.Mute };
            for (var i = 0; i < controls.Length; i++)
            {
                Assert.That(controls[i].xMin, Is.GreaterThanOrEqualTo(0));
                Assert.That(controls[i].yMin, Is.GreaterThanOrEqualTo(0));
                Assert.That(controls[i].xMax, Is.LessThanOrEqualTo(width));
                Assert.That(controls[i].yMax, Is.LessThanOrEqualTo(height));
                for (var j = i + 1; j < controls.Length; j++)
                    Assert.That(controls[i].Overlaps(controls[j]), Is.False, $"Controls {i} and {j}");
            }
            var attack = GalaQuestCombatHudLayout.ToTouch(layout.Attack, viewport).center;
            var travel = GalaQuestCombatHudLayout.ToTouch(layout.Travel, viewport).center;
            var mute = GalaQuestCombatHudLayout.ToTouch(layout.Mute, viewport).center;
            Assert.That(GalaQuestAttackControl.IsInAttackRegion(attack, viewport), Is.True);
            Assert.That(GalaQuestDestinationPresentation.IsInTravelRegion(travel, viewport), Is.True);
            Assert.That(GalaQuestCombatAudio.IsInMuteRegion(mute, viewport), Is.True);
            Assert.That(GalaQuestAttackControl.IsInAttackRegion(travel, viewport), Is.False);
            Assert.That(GalaQuestDestinationPresentation.IsInTravelRegion(mute, viewport), Is.False);
        }

        [Test]
        public void LandscapeAttackHasProminentTouchTarget()
        {
            var rect = GalaQuestAttackControl.TouchRect(new Vector2(1024, 768));
            Assert.That(rect.width, Is.GreaterThanOrEqualTo(128));
            Assert.That(rect.height, Is.EqualTo(rect.width));
        }

        [Test]
        public void NarrowTravelDoesNotCoverAttack()
        {
            var viewport = new Vector2(390, 844);
            var attack = GalaQuestAttackControl.TouchRect(viewport);
            attack.y = viewport.y - attack.yMax;
            var travel = GalaQuestDestinationPresentation.TravelButtonRect(viewport);
            Assert.That(travel.Overlaps(attack), Is.False);
            Assert.That(travel.xMin, Is.GreaterThanOrEqualTo(0));
            Assert.That(travel.xMax, Is.LessThanOrEqualTo(viewport.x));
        }
    }
}
