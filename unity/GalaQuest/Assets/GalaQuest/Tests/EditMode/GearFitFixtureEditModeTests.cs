using System.Collections.Generic;
using System.Linq;
using GalaQuest.Gear;
using GalaQuest.Gear.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class GearFitFixtureEditModeTests
    {
        [Test]
        public void Fixture_kit_has_exactly_the_five_bounded_slots()
        {
            var definitions = GearFitFixtureKitAuthoring.EnsureDefinitions();

            Assert.That(definitions.Select(definition => definition.Slot).Distinct().Count(), Is.EqualTo(5));
            Assert.That(definitions.Select(definition => definition.Slot),
                Is.EquivalentTo(new[]
                {
                    GearFitFixtureSlot.Helmet,
                    GearFitFixtureSlot.Shoulder,
                    GearFitFixtureSlot.Chest,
                    GearFitFixtureSlot.Bracer,
                    GearFitFixtureSlot.Shield,
                }));
            Assert.That(definitions.All(definition => !string.IsNullOrEmpty(definition.AnchorBone)), Is.True);
            Assert.That(definitions.All(definition => definition.Landmarks.Length > 0), Is.True);
        }

        [Test]
        public void Fixture_definitions_carry_slot_specific_clearance_and_intent()
        {
            var definitions = GearFitFixtureKitAuthoring.EnsureDefinitions()
                .ToDictionary(definition => definition.Slot);

            var helmet = definitions[GearFitFixtureSlot.Helmet];
            Assert.That(helmet.Landmarks.Any(landmark => landmark.Label == "crown zone"), Is.True);
            Assert.That(helmet.Landmarks.Any(landmark => landmark.Label == "brow / eye line"), Is.True);
            Assert.That(helmet.AnatomyHideIntent, Is.EquivalentTo(new[] { AnatomyRegion.Hair, AnatomyRegion.Ears }));

            var shoulder = definitions[GearFitFixtureSlot.Shoulder];
            Assert.That(shoulder.MirroredAnchorBone, Is.EqualTo("RightArm"));
            Assert.That(shoulder.Landmarks.Any(landmark => landmark.Kind == GearFitFixtureLandmarkKind.CollisionWarning), Is.True);

            var chest = definitions[GearFitFixtureSlot.Chest];
            Assert.That(chest.Landmarks.Any(landmark => landmark.Label == "waist limit"), Is.True);

            var bracer = definitions[GearFitFixtureSlot.Bracer];
            Assert.That(bracer.Landmarks.Any(landmark => landmark.Label == "wrist bound"), Is.True);
            Assert.That(bracer.Landmarks.Any(landmark => landmark.Label == "elbow bound"), Is.True);

            var shield = definitions[GearFitFixtureSlot.Shield];
            Assert.That(shield.Landmarks.Any(landmark => landmark.Label == "grip anchor"), Is.True);
            Assert.That(shield.Landmarks.Any(landmark => landmark.Label == "front face direction"), Is.True);
        }

        [Test]
        public void Fixture_anchors_resolve_on_GQ_HERO_V1()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            Assert.That(prefab, Is.Not.Null);

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            try
            {
                foreach (var fixture in GearFitFixtureKitAuthoring.EnsureDefinitions())
                {
                    Assert.That(FindDescendant(hero.transform, fixture.AnchorBone), Is.Not.Null,
                        fixture.Slot + " anchor bone is missing: " + fixture.AnchorBone);
                    if (!string.IsNullOrEmpty(fixture.MirroredAnchorBone))
                    {
                        Assert.That(FindDescendant(hero.transform, fixture.MirroredAnchorBone), Is.Not.Null,
                            fixture.Slot + " mirrored anchor bone is missing: " + fixture.MirroredAnchorBone);
                    }
                }
            }
            finally
            {
                Object.DestroyImmediate(hero);
            }
        }

        [Test]
        public void Fixture_overlay_is_editor_only_and_workbench_is_not_a_build_scene()
        {
            var asmdef = AssetDatabase.LoadAssetAtPath<TextAsset>(
                "Assets/GalaQuest/Gear/Editor/GalaQuest.Gear.Editor.asmdef");
            Assert.That(asmdef, Is.Not.Null);
            StringAssert.Contains("\"Editor\"", asmdef.text);

            Assert.That(EditorBuildSettings.scenes.Any(scene =>
                scene.path == GearWorkbenchWindow.ScenePath), Is.False);
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root.name == name) return root;
            foreach (Transform child in root)
            {
                var match = FindDescendant(child, name);
                if (match != null) return match;
            }
            return null;
        }
    }
}
