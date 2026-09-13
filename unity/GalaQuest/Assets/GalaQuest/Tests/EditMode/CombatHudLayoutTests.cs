using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class CombatHudLayoutTests
    {
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
