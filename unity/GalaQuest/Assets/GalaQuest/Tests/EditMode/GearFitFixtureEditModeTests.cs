using System.Collections.Generic;
using System.Linq;
using GalaQuest.Gear;
using GalaQuest.Gear.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Tests
{
    /// <summary>
    /// Tests for the GQ_HERO_V1 gear datum contract.
    ///
    /// These deliberately do NOT restate the fixture numbers. Asserting that the head is 0.19 m wide
    /// would only prove that two files contain the same constant, and would have to be edited every
    /// time the Hero changed. What is asserted instead is that the contract's CLAIMS hold: that the
    /// canonical convention is true of the real skeleton, that a frame really does cancel bone roll,
    /// that an invalid basis is refused, and that left is not right.
    /// </summary>
    public sealed class GearFitFixtureEditModeTests
    {
        private static readonly Dictionary<GearFitFixtureSlot, string[]> RequiredFunctionalDatums =
            new Dictionary<GearFitFixtureSlot, string[]>
            {
                { GearFitFixtureSlot.Helmet, new[] { "FIT_CROWN", "FIT_HEAD_CAVITY", "FIT_BROW" } },
                { GearFitFixtureSlot.Shoulder, new[] { "FIT_SHOULDER_CUP_L", "FIT_SHOULDER_CUP_R" } },
                { GearFitFixtureSlot.Chest, new[] { "FIT_CHEST_SHELL", "FIT_COLLAR", "FIT_WAIST" } },
                { GearFitFixtureSlot.Bracer, new[] { "FIT_ELBOW", "FIT_WRIST", "FIT_FOREARM_SHELL" } },
                { GearFitFixtureSlot.Shield, new[] { "FIT_GRIP", "FIT_SHIELD_BOARD" } },
            };

        // -----------------------------------------------------------------------------------------
        // The canonical convention, checked against the actual rig rather than assumed.
        // -----------------------------------------------------------------------------------------

        [Test]
        public void Hero_satisfies_the_canonical_wearer_convention()
        {
            WithHero(hero =>
            {
                var survey = GearHeroDatumSurvey.Measure(hero);
                Assert.That(survey.CanonicalSpaceError, Is.Empty,
                    "GQ_HERO_V1 does not satisfy +X right / +Y up / +Z forward / metres.");

                // The evidence axes must form a LEFT-handed set, matching Unity. If this flips, every
                // left/right claim in the contract silently reverses.
                var handedness = Vector3.Dot(
                    Vector3.Cross(survey.RightEvidence, survey.UpEvidence), survey.ForwardEvidence);
                Assert.That(handedness, Is.GreaterThan(0f), "hero evidence axes are right-handed");
            });
        }

        [Test]
        public void Hero_right_hand_is_on_the_positive_x_side_of_the_left_hand()
        {
            WithHero(hero =>
            {
                var survey = GearHeroDatumSurvey.Measure(hero);
                Assert.That(survey.LocalJoint("RightHand").x, Is.GreaterThan(survey.LocalJoint("LeftHand").x),
                    "wearer left and right are reversed on GQ_HERO_V1");
            });
        }

        // -----------------------------------------------------------------------------------------
        // Frames
        // -----------------------------------------------------------------------------------------

        [Test]
        public void Every_fixture_validates_as_a_contract_against_the_real_hero()
        {
            var definitions = GearFitFixtureKitAuthoring.EnsureDefinitions();
            Assert.That(definitions.Select(definition => definition.Slot), Is.EquivalentTo(new[]
            {
                GearFitFixtureSlot.Helmet,
                GearFitFixtureSlot.Shoulder,
                GearFitFixtureSlot.Chest,
                GearFitFixtureSlot.Bracer,
                GearFitFixtureSlot.Shield,
            }));

            WithHero(hero =>
            {
                foreach (var fixture in definitions)
                {
                    Assert.That(fixture.TryValidateContract(hero.transform, out var error), Is.True,
                        fixture.Slot + " is not a valid contract: " + error);
                }
            });
        }

        /// <summary>
        /// The load-bearing claim of the whole design: whatever roll the FBX gave an anchor bone, the
        /// frame resolves to canonical WEARER axes. If this fails, gear authored in frame space would
        /// inherit arbitrary bone orientation.
        /// </summary>
        [Test]
        public void Frame_resolution_cancels_raw_bone_roll_and_yields_wearer_axes()
        {
            var definitions = GearFitFixtureKitAuthoring.EnsureDefinitions();

            WithHero(hero =>
            {
                var root = hero.transform;
                foreach (var fixture in definitions)
                {
                    foreach (var frame in fixture.Frames)
                    {
                        var anchor = FindDescendant(root, frame.AnchorBone);
                        Assert.That(anchor, Is.Not.Null, frame.FrameId + " anchor did not resolve");
                        Assert.That(frame.TryResolveWorldRotation(anchor, out var rotation, out var error),
                            Is.True, error);

                        AssertAligned(rotation * Vector3.right, root.TransformDirection(Vector3.right),
                            frame.FrameId + " +X is not wearer right");
                        AssertAligned(rotation * Vector3.up, root.TransformDirection(Vector3.up),
                            frame.FrameId + " +Y is not wearer up");
                        AssertAligned(rotation * Vector3.forward, root.TransformDirection(Vector3.forward),
                            frame.FrameId + " +Z is not wearer forward");
                    }
                }
            });
        }

        [Test]
        public void A_frame_whose_anchor_does_not_exist_fails_to_resolve()
        {
            var fixture = ScriptableObject.CreateInstance<GearFitFixtureDefinition>();
            try
            {
                var frame = new GearFitFrame(
                    "GQ_MISSING_FRAME", GearFitFrameSide.Center, "NoSuchBone", Vector3.zero,
                    Vector3.right, Vector3.up, Vector3.forward,
                    GearFitValueProvenance.Measured, "unit test");
                fixture.Configure(
                    GearFitFixtureSlot.Helmet, "unresolvable", new[] { frame },
                    new[] { ValidDatum("GQ_MISSING_FRAME") },
                    ValidPrimary(), new GearFitProportionCheck[0], new AnatomyRegion[0],
                    "unit-test", "unit-test", "unit-test");

                WithHero(hero =>
                {
                    Assert.That(fixture.TryValidateContract(hero.transform, out var error), Is.False);
                    StringAssert.Contains("anchor cannot resolve", error);
                });
            }
            finally
            {
                Object.DestroyImmediate(fixture);
            }
        }

        [Test]
        public void A_flipped_handed_basis_is_rejected()
        {
            // Negating right turns the left-handed wearer basis into a right-handed one.
            var frame = new GearFitFrame(
                "GQ_FLIPPED", GearFitFrameSide.Center, "Head", Vector3.zero,
                -Vector3.right, Vector3.up, Vector3.forward,
                GearFitValueProvenance.Measured, "unit test");

            Assert.That(frame.TryValidate(out var error), Is.False);
            StringAssert.Contains("handedness", error);
        }

        [Test]
        public void A_right_axis_that_disagrees_with_forward_and_up_is_rejected()
        {
            // Forward and up are a valid pair, and right is unit and orthogonal to neither-nor -- but it
            // is not the axis those two imply. The contract must not silently ignore it.
            var frame = new GearFitFrame(
                "GQ_DISAGREEING", GearFitFrameSide.Center, "Head", Vector3.zero,
                Vector3.right, Vector3.forward, Vector3.up,
                GearFitValueProvenance.Measured, "unit test");

            Assert.That(frame.TryValidate(out var error), Is.False, "an ignored right axis would pass here");
            Assert.That(error, Is.Not.Empty);
        }

        [Test]
        public void Non_unit_and_non_orthogonal_and_degenerate_bases_are_rejected()
        {
            var nonUnit = new GearFitFrame(
                "GQ_NON_UNIT", GearFitFrameSide.Center, "Head", Vector3.zero,
                Vector3.right * 1.4f, Vector3.up, Vector3.forward,
                GearFitValueProvenance.Measured, "unit test");
            Assert.That(nonUnit.TryValidate(out var nonUnitError), Is.False);
            StringAssert.Contains("unit length", nonUnitError);

            var skewed = new GearFitFrame(
                "GQ_SKEWED", GearFitFrameSide.Center, "Head", Vector3.zero,
                new Vector3(1f, 1f, 0f).normalized, Vector3.up, Vector3.forward,
                GearFitValueProvenance.Measured, "unit test");
            Assert.That(skewed.TryValidate(out var skewedError), Is.False);
            StringAssert.Contains("orthogonal", skewedError);

            var degenerate = new GearFitFrame(
                "GQ_DEGENERATE", GearFitFrameSide.Center, "Head", Vector3.zero,
                Vector3.zero, Vector3.up, Vector3.forward,
                GearFitValueProvenance.Measured, "unit test");
            Assert.That(degenerate.TryValidate(out _), Is.False);
        }

        // -----------------------------------------------------------------------------------------
        // Datums
        // -----------------------------------------------------------------------------------------

        [Test]
        public void Every_slot_still_carries_its_required_functional_datums()
        {
            var definitions = GearFitFixtureKitAuthoring.EnsureDefinitions()
                .ToDictionary(definition => definition.Slot);

            foreach (var requirement in RequiredFunctionalDatums)
            {
                var fixture = definitions[requirement.Key];
                foreach (var datumId in requirement.Value)
                {
                    Assert.That(fixture.TryGetDatum(datumId, out var datum), Is.True,
                        requirement.Key + " lost required datum " + datumId);
                    Assert.That(datum.IsFunctional, Is.True,
                        datumId + " is no longer a FunctionalFit datum");
                }
            }
        }

        /// <summary>
        /// The helmet distinguishes the functional crown from the room decoration may occupy above it.
        /// Collapsing the two is exactly the mistake that makes a horned helmet normalize wrongly.
        /// </summary>
        [Test]
        public void Helmet_separates_the_functional_crown_from_decorative_headroom()
        {
            var helmet = GearFitFixtureKitAuthoring.EnsureDefinitions()
                .Single(definition => definition.Slot == GearFitFixtureSlot.Helmet);

            Assert.That(helmet.TryGetDatum("FIT_CROWN", out var crown), Is.True);
            Assert.That(helmet.TryGetDatum("REF_DECOR_HEADROOM", out var decor), Is.True);
            Assert.That(crown.Role, Is.EqualTo(GearFitDatumRole.FunctionalFit));
            Assert.That(decor.Role, Is.EqualTo(GearFitDatumRole.DecorativeExtent));
            Assert.That(decor.LocalCenter.y, Is.GreaterThan(crown.LocalCenter.y),
                "decorative headroom must sit above the functional crown");
        }

        [Test]
        public void A_datum_with_unclassified_provenance_is_refused_machine_authority()
        {
            var datum = new GearFitDatum(
                "FIT_UNCLASSIFIED", "unclassified", GearFitDatumRole.FunctionalFit, "GQ_TEST_FRAME",
                Vector3.zero, Vector3.one * 0.1f,
                GearFitValueProvenance.Unclassified, new[] { "Head" }, "unit test");

            Assert.That(datum.TryValidate(out var error), Is.False);
            StringAssert.Contains("unclassified", error);
        }

        [Test]
        public void A_datum_claiming_MEASURED_must_name_a_hero_joint()
        {
            var datum = new GearFitDatum(
                "FIT_UNSOURCED", "unsourced", GearFitDatumRole.FunctionalFit, "GQ_TEST_FRAME",
                Vector3.zero, Vector3.one * 0.1f,
                GearFitValueProvenance.Measured, new string[0], "unit test");

            Assert.That(datum.TryValidate(out var error), Is.False);
            StringAssert.Contains("MEASURED", error);
        }

        [Test]
        public void Every_measured_datum_names_joints_that_exist_on_the_hero()
        {
            var definitions = GearFitFixtureKitAuthoring.EnsureDefinitions();

            WithHero(hero =>
            {
                foreach (var fixture in definitions)
                {
                    foreach (var datum in fixture.Datums)
                    {
                        foreach (var joint in datum.SourceJoints)
                        {
                            Assert.That(FindDescendant(hero.transform, joint), Is.Not.Null,
                                datum.DatumId + " cites a joint the hero does not have: " + joint);
                        }
                    }
                }
            });
        }

        // -----------------------------------------------------------------------------------------
        // Left / right
        // -----------------------------------------------------------------------------------------

        [Test]
        public void Helmet_width_references_are_not_left_right_reversed()
        {
            var helmet = GearFitFixtureKitAuthoring.EnsureDefinitions()
                .Single(definition => definition.Slot == GearFitFixtureSlot.Helmet);

            Assert.That(helmet.TryGetDatum("REF_WIDTH_LEFT", out var left), Is.True);
            Assert.That(helmet.TryGetDatum("REF_WIDTH_RIGHT", out var right), Is.True);
            Assert.That(left.LocalCenter.x, Is.LessThan(0f), "the LEFT width reference is not on -X");
            Assert.That(right.LocalCenter.x, Is.GreaterThan(0f), "the RIGHT width reference is not on +X");
        }

        /// <summary>
        /// The paired slot is where a mirror error would actually ship. Checked in WORLD space on the
        /// real hero, so it catches a wrong anchor as well as a wrong sign.
        /// </summary>
        [Test]
        public void Shoulder_frames_sit_on_the_side_of_the_body_they_claim()
        {
            var shoulder = GearFitFixtureKitAuthoring.EnsureDefinitions()
                .Single(definition => definition.Slot == GearFitFixtureSlot.Shoulder);

            Assert.That(shoulder.TryGetFrameForSide(GearFitFrameSide.Left, out var left), Is.True);
            Assert.That(shoulder.TryGetFrameForSide(GearFitFrameSide.Right, out var right), Is.True);
            Assert.That(left.OutboardAxis.x, Is.LessThan(0f), "left outboard must point to -X");
            Assert.That(right.OutboardAxis.x, Is.GreaterThan(0f), "right outboard must point to +X");

            WithHero(hero =>
            {
                var root = hero.transform;
                var leftAnchor = FindDescendant(root, left.AnchorBone);
                var rightAnchor = FindDescendant(root, right.AnchorBone);
                Assert.That(leftAnchor, Is.Not.Null);
                Assert.That(rightAnchor, Is.Not.Null);

                var leftX = root.InverseTransformPoint(
                    leftAnchor.TransformPoint(left.OriginInAnchor)).x;
                var rightX = root.InverseTransformPoint(
                    rightAnchor.TransformPoint(right.OriginInAnchor)).x;

                Assert.That(leftX, Is.LessThan(0f), "the wearer-left shoulder frame is not on -X");
                Assert.That(rightX, Is.GreaterThan(0f), "the wearer-right shoulder frame is not on +X");
            });
        }

        [Test]
        public void A_frame_that_claims_a_side_its_bone_contradicts_is_rejected()
        {
            var fixture = ScriptableObject.CreateInstance<GearFitFixtureDefinition>();
            try
            {
                var crossed = new GearFitFrame(
                    "GQ_CROSSED_FRAME", GearFitFrameSide.Left, "RightArm", Vector3.zero,
                    Vector3.right, Vector3.up, Vector3.forward,
                    GearFitValueProvenance.Measured, "unit test");
                fixture.Configure(
                    GearFitFixtureSlot.Shoulder, "crossed", new[] { crossed },
                    new[] { ValidDatum("GQ_CROSSED_FRAME") },
                    ValidPrimary(), new GearFitProportionCheck[0], new AnatomyRegion[0],
                    "unit-test", "unit-test", "unit-test");

                Assert.That(fixture.TryValidateContract(null, out var error), Is.False);
                StringAssert.Contains("declares side Left", error);
            }
            finally
            {
                Object.DestroyImmediate(fixture);
            }
        }

        // -----------------------------------------------------------------------------------------
        // Normalization
        // -----------------------------------------------------------------------------------------

        [Test]
        public void Every_slot_declares_a_usable_primary_normalization_measurement()
        {
            foreach (var fixture in GearFitFixtureKitAuthoring.EnsureDefinitions())
            {
                var primary = fixture.PrimaryMeasurement;
                Assert.That(primary.TryValidate(out var error), Is.True, fixture.Slot + ": " + error);
                Assert.That(primary.Metric, Is.Not.EqualTo(GearFitPrimaryMetric.Unclassified));
                Assert.That(primary.ReferenceValueMetres, Is.GreaterThan(0f));

                Assert.That(fixture.TryGetDatum(primary.SourceDatumId, out var datum), Is.True);
                Assert.That(datum.IsFunctional, Is.True,
                    fixture.Slot + " normalizes against a datum that carries no fit authority");

                Assert.That(primary.TryGetUniformScale(primary.ReferenceValueMetres, out var identity), Is.True);
                Assert.That(identity, Is.EqualTo(1f).Within(1e-4f),
                    "an asset already at the reference size must normalize to scale 1");
            }
        }

        [Test]
        public void A_zero_primary_normalization_dimension_is_rejected()
        {
            var zero = new GearFitPrimaryMeasurement(
                GearFitPrimaryMetric.HeadFunctionalCavityWidth, "FIT_TEST", GearFitFrameAxis.Right,
                0f, GearFitValueProvenance.Measured, "unit test");
            Assert.That(zero.TryValidate(out var error), Is.False);
            StringAssert.Contains("zero", error);
            Assert.That(zero.TryGetUniformScale(0.2f, out _), Is.False);
        }

        [Test]
        public void Primary_normalization_may_not_be_driven_by_a_non_functional_datum()
        {
            var fixture = ScriptableObject.CreateInstance<GearFitFixtureDefinition>();
            try
            {
                var frame = ValidFrame("GQ_TEST_FRAME");
                var reference = new GearFitDatum(
                    "REF_TEST", "reference", GearFitDatumRole.ReferenceZone, "GQ_TEST_FRAME",
                    Vector3.zero, Vector3.one * 0.2f,
                    GearFitValueProvenance.Authored, new string[0], "unit test");
                var primary = new GearFitPrimaryMeasurement(
                    GearFitPrimaryMetric.HeadFunctionalCavityWidth, "REF_TEST", GearFitFrameAxis.Right,
                    0.2f, GearFitValueProvenance.Authored, "unit test");

                fixture.Configure(
                    GearFitFixtureSlot.Helmet, "non functional primary", new[] { frame },
                    new[] { ValidDatum("GQ_TEST_FRAME"), reference },
                    primary, new GearFitProportionCheck[0], new AnatomyRegion[0],
                    "unit-test", "unit-test", "unit-test");

                Assert.That(fixture.TryValidateContract(null, out var error), Is.False);
                StringAssert.Contains("not FunctionalFit", error);
            }
            finally
            {
                Object.DestroyImmediate(fixture);
            }
        }

        [Test]
        public void Rebuilding_the_kit_from_the_same_hero_reproduces_the_same_references()
        {
            var first = GearFitFixtureKitAuthoring.EnsureDefinitions()
                .ToDictionary(f => f.Slot, f => f.PrimaryMeasurement.ReferenceValueMetres);
            var second = GearFitFixtureKitAuthoring.EnsureDefinitions()
                .ToDictionary(f => f.Slot, f => f.PrimaryMeasurement.ReferenceValueMetres);

            foreach (var slot in first.Keys)
            {
                Assert.That(second[slot], Is.EqualTo(first[slot]).Within(1e-6f),
                    slot + " measurement is not reproducible");
            }
        }

        // -----------------------------------------------------------------------------------------
        // Secondary proportion checks
        // -----------------------------------------------------------------------------------------

        [Test]
        public void Proportion_checks_pass_a_nominal_silhouette_and_reject_a_squashed_one()
        {
            foreach (var fixture in GearFitFixtureKitAuthoring.EnsureDefinitions())
            {
                Assert.That(fixture.SecondaryProportionChecks.Length, Is.GreaterThan(0),
                    fixture.Slot + " declares no secondary proportion check");

                // The fixture's own functional datum is by definition a nominal silhouette for its slot.
                Assert.That(fixture.TryGetDatum(fixture.PrimaryMeasurement.SourceDatumId, out var datum),
                    Is.True);

                foreach (var check in fixture.SecondaryProportionChecks)
                {
                    Assert.That(check.TryValidate(out var error), Is.True, error);
                    Assert.That(check.Evaluate(datum.LocalSize, out _),
                        Is.EqualTo(GearFitProportionVerdict.Pass),
                        fixture.Slot + "/" + check.CheckId + " rejects its own slot proportions");

                    // A silhouette squashed to a sliver on the denominator axis must be caught.
                    var squashed = datum.LocalSize;
                    squashed = SetComponent(squashed, check.DenominatorAxis,
                        GearFitFrame.Component(datum.LocalSize, check.DenominatorAxis) * 0.02f);
                    Assert.That(check.Evaluate(squashed, out _),
                        Is.EqualTo(GearFitProportionVerdict.Reject),
                        fixture.Slot + "/" + check.CheckId + " accepts an absurd silhouette");
                }
            }
        }

        // -----------------------------------------------------------------------------------------
        // Registration proof
        // -----------------------------------------------------------------------------------------

        [Test]
        public void The_proof_asset_registers_against_the_helmet_contract_with_one_uniform_scale()
        {
            GearFitFixtureKitAuthoring.EnsureDefinitions();
            var registration = GearFitAssetRegistrationAuthoring.EnsureSilverguardHelmetRegistration();

            Assert.That(registration.TryValidate(out var error), Is.True, error);
            Assert.That(registration.FixtureSlot, Is.EqualTo(GearFitFixtureSlot.Helmet));
            Assert.That(registration.MeasurementProvenance,
                Is.Not.EqualTo(GearFitValueProvenance.Unclassified));
            Assert.That(registration.Status, Is.Not.EqualTo(GearFitRegistrationStatus.Unclassified));

            // The whole point: one scalar, applied to every axis. If the normalized size is not the
            // raw size times that single number, something emitted a per-axis correction.
            var scale = registration.UniformNormalizationScale;
            Assert.That(scale, Is.GreaterThan(0f));
            Assert.That(
                registration.TargetPrimaryDimensionMetres /
                registration.MeasuredPrimaryDimensionMetres,
                Is.EqualTo(scale).Within(1e-4f));
        }

        [Test]
        public void Registering_a_grossly_misproportioned_asset_reports_rather_than_squashes_it()
        {
            var helmet = GearFitFixtureKitAuthoring.EnsureDefinitions()
                .Single(definition => definition.Slot == GearFitFixtureSlot.Helmet);

            // A "helmet" the shape of a plank: correct width, absurd height.
            var absurd = helmet.PrimaryMeasurement.ReferenceValueMetres;
            var size = new Vector3(absurd, absurd * 8f, absurd);

            var rejected = false;
            foreach (var check in helmet.SecondaryProportionChecks)
            {
                if (check.Evaluate(size, out _) == GearFitProportionVerdict.Reject) rejected = true;
            }

            Assert.That(rejected, Is.True,
                "an eight-to-one helmet passed every proportion band, so nothing would stop it shipping");
        }

        // -----------------------------------------------------------------------------------------
        // Packaging
        // -----------------------------------------------------------------------------------------

        [Test]
        public void Fixture_kit_is_editor_only_and_the_workbench_is_not_a_build_scene()
        {
            var asmdef = AssetDatabase.LoadAssetAtPath<TextAsset>(
                "Assets/GalaQuest/Gear/Editor/GalaQuest.Gear.Editor.asmdef");
            Assert.That(asmdef, Is.Not.Null);
            StringAssert.Contains("\"Editor\"", asmdef.text);

            Assert.That(EditorBuildSettings.scenes.Any(scene =>
                scene.path == GearWorkbenchWindow.ScenePath), Is.False);
        }

        // -----------------------------------------------------------------------------------------

        private static void WithHero(System.Action<GameObject> body)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            Assert.That(prefab, Is.Not.Null, "GQ_HERO_V1 prefab is missing");

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            try
            {
                body(hero);
            }
            finally
            {
                Object.DestroyImmediate(hero);
            }
        }

        private static void AssertAligned(Vector3 actual, Vector3 expected, string message)
        {
            Assert.That(Vector3.Dot(actual.normalized, expected.normalized), Is.GreaterThan(0.999f), message);
        }

        private static Vector3 SetComponent(Vector3 value, GearFitFrameAxis axis, float component)
        {
            switch (axis)
            {
                case GearFitFrameAxis.Right: return new Vector3(component, value.y, value.z);
                case GearFitFrameAxis.Up: return new Vector3(value.x, component, value.z);
                default: return new Vector3(value.x, value.y, component);
            }
        }

        private static GearFitFrame ValidFrame(string frameId)
        {
            return new GearFitFrame(
                frameId, GearFitFrameSide.Center, "Head", Vector3.zero,
                Vector3.right, Vector3.up, Vector3.forward,
                GearFitValueProvenance.Measured, "unit test");
        }

        private static GearFitDatum ValidDatum(string frameId)
        {
            return new GearFitDatum(
                "FIT_TEST", "test", GearFitDatumRole.FunctionalFit, frameId,
                Vector3.zero, Vector3.one * 0.2f,
                GearFitValueProvenance.Authored, new string[0], "unit test");
        }

        private static GearFitPrimaryMeasurement ValidPrimary()
        {
            return new GearFitPrimaryMeasurement(
                GearFitPrimaryMetric.HeadFunctionalCavityWidth, "FIT_TEST", GearFitFrameAxis.Right,
                0.2f, GearFitValueProvenance.Authored, "unit test");
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
