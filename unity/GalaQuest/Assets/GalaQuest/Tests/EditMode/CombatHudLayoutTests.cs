using System.Linq;
// The Forge geometry assertions intentionally remain independent of gameplay state.
using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class CombatHudLayoutTests
    {
        [Test]
        public void PortraitForgePromptClearsObservedApproachHead()
        {
            // Connected main 4c99811, ordinary approach (5,15), 390x844: the visible
            // head occupies y=320..363. The old parchment extends through y=357.
            // This reproduction does not claim the separate offscreen Forge is fixed.
            var prompt = GalaQuestRuneForgePresenter.PromptRect(new Vector2(390, 844));
            Assert.That(prompt.Overlaps(new Rect(173, 320, 48, 43)), Is.False);
            Assert.That(prompt.Overlaps(new Rect(155, 320, 84, 166)), Is.False, "The whole visible Hero remains clear.");
            Assert.That(prompt.Overlaps(new Rect(60, 180, 260, 130)), Is.False,
                "The current prize is visible after an ordinary orbit toward the station.");
            var hud = new GalaQuestCombatHudLayout(new Vector2(390, 844));
            foreach (var control in new[] { hud.Travel, hud.Attack, hud.Movement, hud.Mute })
                Assert.That(prompt.Overlaps(control), Is.False);
        }

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

        [TestCase(390, 844)]
        [TestCase(844, 390)]
        [TestCase(1024, 768)]
        public void ForgeQuestionPanelIsCentredAndOwnsItsChoiceActions(int width, int height)
        {
            var viewport = new Vector2(width, height);
            var panel = GalaQuestRuneForgePresenter.QuestionPanelRect(viewport);
            Assert.That(panel.center.x, Is.EqualTo(width * .5f).Within(1));
            Assert.That(panel.center.y, Is.EqualTo(height * .5f).Within(1));
            Assert.That(panel.xMin, Is.GreaterThanOrEqualTo(0));
            Assert.That(panel.yMin, Is.GreaterThanOrEqualTo(0));
            Assert.That(panel.xMax, Is.LessThanOrEqualTo(width));
            Assert.That(panel.yMax, Is.LessThanOrEqualTo(height));

            var choices = Enumerable.Range(0, 3)
                .Select(index => GalaQuestRuneForgePresenter.QuestionChoiceRect(viewport, index, 3)).ToArray();
            for (var index = 0; index < choices.Length; index++)
            {
                Assert.That(panel.Contains(choices[index].center), Is.True);
                for (var other = index + 1; other < choices.Length; other++)
                    Assert.That(choices[index].Overlaps(choices[other]), Is.False);
            }
            var close = GalaQuestRuneForgePresenter.QuestionCloseRect(viewport);
            Assert.That(panel.Contains(close.center), Is.True);
            Assert.That(choices.Any(choice => choice.Overlaps(close)), Is.False);

            var activeActions = Enumerable.Range(0, 3)
                .Select(index => GalaQuestRuneForgePresenter.QuestionActionRect(viewport, index, 3)).ToArray();
            for (var index = 0; index < activeActions.Length; index++)
                Assert.That(activeActions[index].Overlaps(close), Is.False,
                    $"Active action {index} must not overlap CLOSE at {width}x{height}.");

            var claim = GalaQuestRuneForgePresenter.QuestionActionRect(viewport, 0, 1);
            Assert.That(claim.Overlaps(close), Is.False, $"CLAIM must not overlap CLOSE at {width}x{height}.");
            var equip = GalaQuestRuneForgePresenter.QuestionActionRect(viewport, 0, 1);
            Assert.That(equip.Overlaps(close), Is.False, $"EQUIP must not overlap CLOSE at {width}x{height}.");
        }

        [TestCase(390, 844)]
        [TestCase(844, 390)]
        [TestCase(1024, 768)]
        [TestCase(768, 1024)]
        [TestCase(1100, 505)]
        public void ForgeTrackButtonKeepsItsTitleClearOfItsDescription(int width, int height)
        {
            var viewport = new Vector2(width, height);
            var panel = GalaQuestRuneForgePresenter.QuestionPanelRect(viewport);
            var close = GalaQuestRuneForgePresenter.QuestionCloseRect(viewport);
            const int count = 2;
            var packs = new Rect[count];
            for (var index = 0; index < count; index++)
            {
                var pack = GalaQuestRuneForgePresenter.PackRect(viewport, index, count);
                var title = GalaQuestRuneForgePresenter.PackTitleRect(viewport, index, count);
                var description = GalaQuestRuneForgePresenter.PackDescriptionRect(viewport, index, count);
                packs[index] = pack;

                Assert.That(title.Overlaps(description), Is.False,
                    $"Track {index} title must not overlap its description at {width}x{height}.");
                Assert.That(pack.Contains(title.min) && pack.Contains(title.max), Is.True,
                    $"Track {index} title must stay inside its button at {width}x{height}.");
                Assert.That(pack.Contains(description.min) && pack.Contains(description.max), Is.True,
                    $"Track {index} description must stay inside its button at {width}x{height}.");
                Assert.That(title.height, Is.GreaterThan(0), $"Track {index} title band collapsed at {width}x{height}.");
                Assert.That(panel.Contains(pack.center), Is.True,
                    $"Track {index} must stay inside the panel at {width}x{height}.");
                Assert.That(pack.Overlaps(close), Is.False,
                    $"Track {index} must not overlap CLOSE at {width}x{height}.");
            }
            Assert.That(packs[0].Overlaps(packs[1]), Is.False,
                $"Track buttons must not overlap each other at {width}x{height}.");
        }
    }
}
