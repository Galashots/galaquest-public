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
    /// Tests for the registration -> socket-local seed bridge.
    ///
    /// The defect these exist for was found by running real gear through the landed contract: a shield
    /// was mounted facing sideways and tilted about 45 degrees, and every gate stayed green, because
    /// the runtime validator is a head-proxy check and cannot express "this asset is not facing the way
    /// its registration says it is".
    ///
    /// So the load-bearing test here is a COUNTEREXAMPLE: it reproduces that wrong mount, asserts the
    /// runtime validator still finds nothing, and asserts the new editor gate rejects it. If the seed
    /// bridge regresses, that test goes red rather than the defect going quiet again.
    ///
    /// Nothing here mutates a production asset: every fit is applied to a scratch GearItemDefinition.
    /// </summary>
    public sealed class GearFitSeedEditModeTests
    {
        private const string ShieldModelPath =
            "Assets/GalaQuest/Gear/SourceAssets/IronwoodShield.fbx";

        private const string ShieldSemanticId = "gear.shield.ironwood";

        // -------------------------------------------------------------------------------------------
        // The counterexample: naive socket-local orientation.
        // -------------------------------------------------------------------------------------------

        [Test]
        public void Naive_canonical_euler_written_socket_local_mounts_wrong_and_runtime_validator_misses_it()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                // THE BUG: write the canonical raw-to-canonical rotation straight onto the item. It is
                // a canonical-space value being consumed as a socket-local one, so the bone's own roll
                // is never cancelled.
                Assert.That(item.TryApplySeedFit(
                    Vector3.zero,
                    profile.RawToCanonicalEuler,
                    Vector3.one * registration.UniformNormalizationScale), Is.True);

                var mounted = GearMounter.Mount(hero.transform, item);
                try
                {
                    var runtimeIssues = GearFitValidator.Validate(
                        hero.transform, mounted, item, LoadProxy());
                    Assert.That(runtimeIssues.Count(i => i.Severity == GearFitSeverity.Rejection),
                        Is.EqualTo(0),
                        "this test is only meaningful while the runtime validator cannot see the defect");

                    var seedIssues = GearFitSeedConsistency.Check(
                        hero.transform, mounted, item, fixture, profile, registration);

                    Assert.That(seedIssues.Any(i => i.Code == GearFitSeedConsistency.Codes.OrientationMismatch),
                        Is.True,
                        "the seed consistency gate did not reject a mount whose canonical basis " +
                        "disagrees with its Gear Frame: " + Describe(seedIssues));
                }
                finally
                {
                    Object.DestroyImmediate(mounted);
                }
            });
        }

        [Test]
        public void A_seeded_shield_agrees_with_its_frame_and_passes_the_consistency_gate()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                Assert.That(seed.IsComplete, Is.True, seed.Error);
                Assert.That(item.TryApplySeedFit(
                    seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale), Is.True);

                var mounted = GearMounter.Mount(hero.transform, item);
                try
                {
                    var issues = GearFitSeedConsistency.Check(
                        hero.transform, mounted, item, fixture, profile, registration);
                    Assert.That(issues, Is.Empty, Describe(issues));
                }
                finally
                {
                    Object.DestroyImmediate(mounted);
                }
            });
        }

        [Test]
        public void The_derived_seed_uses_exactly_the_registration_uniform_scalar()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                Assert.That(seed.IsComplete, Is.True, seed.Error);

                var scale = registration.UniformNormalizationScale;
                Assert.That(seed.LocalScale.x, Is.EqualTo(scale).Within(1e-5f));
                Assert.That(seed.LocalScale.y, Is.EqualTo(scale).Within(1e-5f));
                Assert.That(seed.LocalScale.z, Is.EqualTo(scale).Within(1e-5f));
            });
        }

        // -------------------------------------------------------------------------------------------
        // Landmark alignment
        // -------------------------------------------------------------------------------------------

        [Test]
        public void A_seeded_shield_seats_its_grip_on_the_fixture_grip_datum()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                Assert.That(seed.IsComplete, Is.True, seed.Error);
                Assert.That(seed.DatumId, Is.EqualTo("FIT_GRIP"));
                Assert.That(seed.AssetLandmarkId, Is.EqualTo("ASSET_FIT_GRIP"));

                item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale);
                var mounted = GearMounter.Mount(hero.transform, item);
                try
                {
                    var issues = GearFitSeedConsistency.Check(
                        hero.transform, mounted, item, fixture, profile, registration);
                    Assert.That(issues.Any(i => i.Code == GearFitSeedConsistency.Codes.LandmarkMisaligned),
                        Is.False, Describe(issues));
                }
                finally
                {
                    Object.DestroyImmediate(mounted);
                }
            });
        }

        [Test]
        public void A_displaced_grip_fails_landmark_alignment()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                Assert.That(seed.IsComplete, Is.True, seed.Error);

                // Correct rotation and scale, but shoved 12 cm off the grip: exactly the "rides high"
                // class of defect, which orientation checks alone would not catch.
                item.TryApplySeedFit(
                    seed.LocalPosition + new Vector3(0f, 0.12f, 0f),
                    seed.LocalEulerAngles,
                    seed.LocalScale);

                var mounted = GearMounter.Mount(hero.transform, item);
                try
                {
                    var issues = GearFitSeedConsistency.Check(
                        hero.transform, mounted, item, fixture, profile, registration);
                    Assert.That(issues.Any(i => i.Code == GearFitSeedConsistency.Codes.LandmarkMisaligned),
                        Is.True, "a 12 cm grip displacement was accepted: " + Describe(issues));
                }
                finally
                {
                    Object.DestroyImmediate(mounted);
                }
            });
        }

        // -------------------------------------------------------------------------------------------
        // Scale
        // -------------------------------------------------------------------------------------------

        [Test]
        public void A_non_uniform_scale_is_rejected()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                Assert.That(seed.IsComplete, Is.True, seed.Error);

                var squashed = seed.LocalScale;
                squashed.y *= 0.7f;
                item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, squashed);

                var mounted = GearMounter.Mount(hero.transform, item);
                try
                {
                    var issues = GearFitSeedConsistency.Check(
                        hero.transform, mounted, item, fixture, profile, registration);
                    Assert.That(issues.Any(i => i.Code == GearFitSeedConsistency.Codes.NonUniformScale),
                        Is.True, "a vertical squash was accepted: " + Describe(issues));
                }
                finally
                {
                    Object.DestroyImmediate(mounted);
                }
            });
        }

        [Test]
        public void A_scale_that_disagrees_with_the_registration_is_rejected()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale * 1.4f);

                var mounted = GearMounter.Mount(hero.transform, item);
                try
                {
                    var issues = GearFitSeedConsistency.Check(
                        hero.transform, mounted, item, fixture, profile, registration);
                    Assert.That(issues.Any(i => i.Code == GearFitSeedConsistency.Codes.ScaleMismatch ||
                                                i.Code == GearFitSeedConsistency.Codes.ExtentsMismatch),
                        Is.True, Describe(issues));
                }
                finally
                {
                    Object.DestroyImmediate(mounted);
                }
            });
        }

        // -------------------------------------------------------------------------------------------
        // Honest refusals
        // -------------------------------------------------------------------------------------------

        [Test]
        public void An_owner_authored_fit_is_not_silently_overwritten_by_a_seed()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var owner = new Vector3(0.11f, 0.22f, 0.33f);
                item.ApplyAuthoredFit(owner, new Vector3(10f, 20f, 30f), Vector3.one * 3f);
                Assert.That(item.IsOwnerAuthored, Is.True);

                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                Assert.That(seed.IsComplete, Is.True, seed.Error);

                Assert.That(item.TryApplySeedFit(
                    seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale), Is.False,
                    "a derived seed overwrote Owner-authored fit work");
                Assert.That(item.LocalPosition, Is.EqualTo(owner));
                Assert.That(item.LocalScale, Is.EqualTo(Vector3.one * 3f));
            });
        }

        [Test]
        public void A_needs_authoring_registration_yields_no_seed_and_claims_no_scale()
        {
            var registration = ScriptableObject.CreateInstance<GearFitAssetRegistration>();
            try
            {
                registration.Configure(
                    "gear.test.unregistered", string.Empty, GearFitFixtureSlot.Shield, "unassigned",
                    string.Empty, Vector3.zero, Vector3.one,
                    GearFitMeasurementSource.Unclassified, GearAssetCavitySource.Unclassified,
                    GearFitPrimaryMetric.Unclassified, GearFitFrameAxis.Right,
                    0f, 0f, 0f, GearFitValueProvenance.Unclassified,
                    GearFitRegistrationStatus.NeedsAuthoring, Vector3.zero, new string[0], 0f,
                    "no cavity authored");

                Assert.That(registration.HasFitScale, Is.False);
                Assert.That(registration.UniformNormalizationScale, Is.EqualTo(0f));
                Assert.That(registration.TryValidate(out var error), Is.True, error);

                WithHero(hero =>
                {
                    var fixture = Fixture(GearFitFixtureSlot.Shield);
                    var profile = GearFitAssetRegistrationAuthoring.LoadProfile(ShieldSemanticId);
                    var item = ScratchItem();
                    try
                    {
                        var seed = GearFitSeedSolver.Solve(
                            hero.transform, item, fixture, profile, registration);
                        Assert.That(seed.IsComplete, Is.False);
                        StringAssert.Contains("NeedsAuthoring", seed.Error);
                    }
                    finally
                    {
                        Object.DestroyImmediate(item);
                    }
                });
            }
            finally
            {
                Object.DestroyImmediate(registration);
            }
        }

        [Test]
        public void A_profile_without_the_required_landmark_refuses_to_claim_a_complete_seed()
        {
            WithShield((hero, fixture, sourceProfile, registration, item) =>
            {
                var stripped = ScriptableObject.CreateInstance<GearAssetFitProfile>();
                try
                {
                    // Same cavity, no ASSET_FIT_GRIP. Scale and rotation are still derivable, but the
                    // seat is not, and a partial seed must not be presented as a complete one.
                    stripped.Configure(
                        sourceProfile.SemanticAssetId, sourceProfile.Slot,
                        sourceProfile.RawToCanonicalEuler, sourceProfile.CavitySource,
                        sourceProfile.CavityCenterInCanonical, sourceProfile.CavitySizeInCanonical,
                        sourceProfile.CavityProvenance, sourceProfile.CavityNote,
                        new GearAssetFitLandmark[0]);

                    stripped.ConfigureOrientation(sourceProfile.RawToCanonicalEuler,
                        sourceProfile.OrientationProvenance, sourceProfile.OrientationNote);
                    var seed = GearFitSeedSolver.Solve(
                        hero.transform, item, fixture, stripped, registration);
                    Assert.That(seed.IsComplete, Is.False);
                    StringAssert.Contains("ASSET_FIT_GRIP", seed.Error);
                }
                finally
                {
                    Object.DestroyImmediate(stripped);
                }
            });
        }

        [Test]
        public void The_silverguard_helmet_has_no_asset_fit_profile_and_stays_unseedable()
        {
            // Adversarial regression. The helmet's source art predates the contract, exposes no inner
            // shell and declares no cavity. It must stay honest rather than acquire an invented one.
            var profile = GearFitAssetRegistrationAuthoring.LoadProfile("gear.helmet.silverguard");
            Assert.That(profile, Is.Null,
                "a fit profile appeared for the Silverguard helmet; a cavity must not be invented for " +
                "enclosing gear from its exterior bounds");

            var item = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(
                "Assets/GalaQuest/Gear/Definitions/Gear_SilverguardHelmet.asset");
            Assert.That(item, Is.Not.Null);
            Assert.That(item.IsOwnerAuthored, Is.True,
                "the Owner-authored Silverguard fit must survive this package untouched");
        }

        [Test]
        public void Cross_record_identity_and_orientation_must_reject()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var copy = Object.Instantiate(profile);
                try
                {
                    var data = new SerializedObject(copy);
                    data.FindProperty("semanticAssetId").stringValue = "gear.test.wrong";
                    data.ApplyModifiedPropertiesWithoutUndo();
                    Assert.That(GearFitSeedSolver.Solve(hero.transform, item, fixture, copy, registration).IsComplete,
                        Is.False, "mismatched profile identity was accepted");
                    data.FindProperty("semanticAssetId").stringValue = profile.SemanticAssetId;
                    data.FindProperty("rawToCanonicalEuler").vector3Value = new Vector3(0, 90, 0);
                    data.ApplyModifiedPropertiesWithoutUndo();
                    Assert.That(GearFitSeedSolver.Solve(hero.transform, item, fixture, copy, registration).IsComplete,
                        Is.False, "stale registration orientation was accepted");
                }
                finally { Object.DestroyImmediate(copy); }
            });
        }

        [TestCase("leftShoulder", "GQ_SHOULDER_L_FRAME", "FIT_SHOULDER_CUP_L")]
        [TestCase("rightShoulder", "GQ_SHOULDER_R_FRAME", "FIT_SHOULDER_CUP_R")]
        public void Paired_socket_resolves_exact_frame_and_seat(string socketId, string frameId, string seatId)
        {
            WithShield((hero, ignored, profile, registration, item) =>
            {
                var fixture = Fixture(GearFitFixtureSlot.Shoulder);
                Assert.That(fixture.TryResolveSeat(socketId, out var frame, out var seat, out var error), Is.True, error);
                Assert.That(frame.FrameId, Is.EqualTo(frameId));
                Assert.That(seat.DatumId, Is.EqualTo(seatId));
                item.Configure(ShieldSemanticId, "Scratch right/left proof", item.SourceModel,
                    socketId, GearFitClass.Shoulder, ShieldModelPath, new AnatomyRegion[0]);
                profile.Configure(ShieldSemanticId, fixture.Slot, Vector3.zero,
                    GearAssetCavitySource.AuthoredVirtualCavity, Vector3.zero, Vector3.one,
                    GearFitValueProvenance.Authored, "Synthetic test envelope, not shoulder production",
                    new[] { new GearAssetFitLandmark("ASSET_" + seatId, Vector3.zero,
                        GearFitValueProvenance.Authored, "Synthetic origin seat") });
                profile.ConfigureOrientation(Vector3.zero, GearFitValueProvenance.Authored, "Synthetic axes");
                var primary = fixture.PrimaryMeasurement;
                registration.Configure(ShieldSemanticId, "", fixture.Slot, frameId, seatId,
                    Vector3.zero, Vector3.one, GearFitMeasurementSource.AssetFitCavity,
                    GearAssetCavitySource.AuthoredVirtualCavity, primary.Metric, primary.Axis,
                    1f, primary.ReferenceValueMetres, primary.ReferenceValueMetres,
                    GearFitValueProvenance.Authored, GearFitRegistrationStatus.Accepted,
                    Vector3.zero, new string[0], 0f, "Synthetic test record");
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                Assert.That(seed.IsComplete, Is.True, seed.Error);
                Assert.That(seed.DatumId, Is.EqualTo(seatId));
                item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale);
                var mounted = GearMounter.Mount(hero.transform, item);
                Assert.That(GearFitSeedConsistency.Check(hero.transform, mounted, item, fixture, profile, registration), Is.Empty);
            });
        }

        [Test]
        public void Incompatible_ambiguous_and_cross_frame_bindings_fail_closed()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                fixture.ConfigureSeatBindings(new GearFitSeatBinding("leftHand", "missing", "FIT_GRIP"));
                Assert.That(GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration).IsComplete, Is.False);
                var valid = new GearFitSeatBinding("leftHand", "GQ_SHIELD_FRAME", "FIT_GRIP");
                fixture.ConfigureSeatBindings(valid, valid);
                Assert.That(GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration).IsComplete, Is.False);
                fixture.ConfigureSeatBindings(valid);
                GearMounter.ResolveSocket(hero.transform, "leftHand").Configure("leftHand", "RightHand");
                Assert.That(GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration).IsComplete, Is.False);
            });
        }

        [TestCase("semanticAssetId")]
        [TestCase("gearFrameId")]
        [TestCase("functionalLandmarkId")]
        public void Stale_registration_identity_frame_or_seat_rejects(string field)
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var data = new SerializedObject(registration);
                data.FindProperty(field).stringValue = "wrong";
                data.ApplyModifiedPropertiesWithoutUndo();
                Assert.That(GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration).IsComplete, Is.False);
                var mounted = GearMounter.Mount(hero.transform, item);
                Assert.That(GearFitSeedConsistency.Check(hero.transform, mounted, item, fixture, profile, registration), Is.Not.Empty);
            });
        }

        [Test]
        public void Stale_slot_rejects()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var data = new SerializedObject(registration);
                data.FindProperty("fixtureSlot").enumValueIndex = (int)GearFitFixtureSlot.Shoulder;
                data.ApplyModifiedPropertiesWithoutUndo();
                Assert.That(GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration).IsComplete, Is.False);
            });
        }

        [Test]
        public void A_seat_on_the_other_side_cannot_answer_the_right_socket()
        {
            var fixture = Object.Instantiate(Fixture(GearFitFixtureSlot.Shoulder));
            try
            {
                fixture.ConfigureSeatBindings(new GearFitSeatBinding("rightShoulder",
                    "GQ_SHOULDER_R_FRAME", "FIT_SHOULDER_CUP_L"));
                Assert.That(fixture.TryResolveSeat("rightShoulder", out _, out _, out _), Is.False);
            }
            finally { Object.DestroyImmediate(fixture); }
        }

        [Test]
        public void Real_shield_source_supports_the_recorded_board_axis_observation()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var source = (GameObject)PrefabUtility.InstantiatePrefab(item.SourceModel);
                try
                {
                    var raw = GearAssetFitProbe.MeasureRenderBounds(source, Quaternion.identity);
                    Assert.That(raw.y, Is.LessThan(raw.x * 0.25f));
                    Assert.That(raw.y, Is.LessThan(raw.z * 0.25f));
                    Assert.That(GearAssetFitProbe.TryMeasureDeclaredCavity(source, Quaternion.identity, out _, out _), Is.False);
                    Assert.That(profile.OrientationProvenance, Is.EqualTo(GearFitValueProvenance.Authored));
                    Assert.That(profile.CavitySource, Is.EqualTo(GearAssetCavitySource.AuthoredVirtualCavity));
                    TestContext.WriteLine("Raw imported Shield bounds: " + raw.ToString("F8"));
                }
                finally { Object.DestroyImmediate(source); }
            });
        }

        [Test]
        public void Orientation_requires_classification_finite_rotation_and_note()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                profile.ConfigureOrientation(Vector3.zero, GearFitValueProvenance.Unclassified, "note");
                Assert.That(profile.TryValidate(out _), Is.False);
                profile.ConfigureOrientation(new Vector3(float.NaN, 0, 0), GearFitValueProvenance.Authored, "note");
                Assert.That(profile.TryValidate(out _), Is.False);
                profile.ConfigureOrientation(new Vector3(0, float.PositiveInfinity, 0), GearFitValueProvenance.Authored, "note");
                Assert.That(profile.TryValidate(out _), Is.False);
                profile.ConfigureOrientation(Vector3.zero, GearFitValueProvenance.Authored, " ");
                Assert.That(profile.TryValidate(out _), Is.False);
            });
        }

        [Test]
        public void Mounted_scale_is_checked_even_when_definition_is_correct()
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale);
                var mounted = GearMounter.Mount(hero.transform, item);
                mounted.transform.localScale = Vector3.Scale(seed.LocalScale, new Vector3(1, 0.7f, 1));
                Assert.That(GearFitSeedConsistency.Check(hero.transform, mounted, item, fixture, profile, registration)
                    .Any(i => i.Code == GearFitSeedConsistency.Codes.NonUniformScale), Is.True);
            });
        }

        [Test]
        public void Neutral_review_pose_restores_source_bones_without_changing_socket_fit()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            var hero = Object.Instantiate(prefab);
            try
            {
                var bone = GearHeroAuthoring.FindDescendant(hero.transform, GearSocketIds.HeadBone);
                var expected = bone.localRotation;
                var socket = GearMounter.ResolveSocket(hero.transform, "leftHand");
                socket.transform.localPosition = new Vector3(0.01f, 0.02f, 0.03f);
                bone.localRotation = Quaternion.Euler(20f, 30f, 40f);
                GearReviewPack.ResetToSourcePose(hero.transform);
                Assert.That(Quaternion.Angle(expected, bone.localRotation), Is.LessThan(0.01f));
                Assert.That(socket.transform.localPosition, Is.EqualTo(new Vector3(0.01f, 0.02f, 0.03f)));
            }
            finally { Object.DestroyImmediate(hero); }
        }

        [Test]
        public void Review_pose_names_resolve_from_the_real_controller_and_refuse_ambiguity()
        {
            var controller = AssetDatabase.LoadAssetAtPath<UnityEditor.Animations.AnimatorController>(
                GearWorkbenchSceneBuilder.ControllerPath);
            var names = controller.layers[0].stateMachine.states.Select(s => s.state.name).ToArray();
            foreach (var alias in new[] { "idle", "running", "sword_slash", "combat_stance", "shield_push" })
                Assert.That(names, Does.Contain(GearReviewPack.ResolvePose(names, alias)));
            Assert.Throws<System.InvalidOperationException>(() => GearReviewPack.ResolvePose(names, "missing"));
            Assert.Throws<System.InvalidOperationException>(() =>
                GearReviewPack.ResolvePose(new[] { "A|idle", "B|idle" }, "idle"));
        }

        [Test]
        public void One_item_operation_is_bounded_refreshes_and_protects_owner_fit()
        {
            using var production = new GearTestProductionSnapshot();
            const string id = "gear.test.single";
            const string path = "Assets/GalaQuest/Gear/Definitions/__SingleOperation.asset";
            var item = ScratchItem();
            item.Configure(id, "Scratch", item.SourceModel, GearSocketIds.LeftHand, GearFitClass.Handheld,
                ShieldModelPath, new AnatomyRegion[0]);
            AssetDatabase.CreateAsset(item, path);
            var profile = Object.Instantiate(GearFitAssetRegistrationAuthoring.LoadProfile(ShieldSemanticId));
            var data = new SerializedObject(profile);
            data.FindProperty("semanticAssetId").stringValue = id;
            data.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.CreateAsset(profile, GearFitAssetRegistrationAuthoring.ProfilePathFor(id));
            var before = GearTestProductionSnapshot.ReadFiles();
            var report = GearFitSeedBatch.ProcessOne(id);
            Assert.That(report.status, Is.EqualTo("PASS"), string.Join("; ", report.findings));
            Assert.That(report.seedApplied, Is.True);
            profile.ConfigureOrientation(new Vector3(90, 0, 10), GearFitValueProvenance.Authored, "Edited test intent");
            GearFitSeedBatch.ProcessOne(id);
            Assert.That(Quaternion.Angle(profile.RawToCanonicalRotation,
                GearFitAssetRegistrationAuthoring.LoadRegistration(id).RawToCanonicalRotation), Is.LessThan(0.01f));
            item.ApplyAuthoredFit(Vector3.one, Vector3.zero, Vector3.one);
            report = GearFitSeedBatch.ProcessOne(id);
            Assert.That(report.ownerFitProtected, Is.True);
            Assert.That(report.seedApplied, Is.False);
            Assert.That(item.LocalPosition, Is.EqualTo(Vector3.one));
            var after = GearTestProductionSnapshot.ReadFiles();
            foreach (var pair in before)
            {
                if (pair.Key == path || pair.Key == GearFitAssetRegistrationAuthoring.ProfilePathFor(id)) continue;
                Assert.That(after[pair.Key], Is.EqualTo(pair.Value), "unrelated file changed: " + pair.Key);
            }
            var additions = after.Keys.Except(before.Keys).ToArray();
            Assert.That(additions.All(p => p == GearFitAssetRegistrationAuthoring.PathFor(id) ||
                p == GearFitAssetRegistrationAuthoring.PathFor(id) + ".meta"), Is.True, string.Join(",", additions));
            Assert.Throws<System.InvalidOperationException>(() => GearFitSeedBatch.ResolveOne("gear.test.missing"));
            var duplicate = Object.Instantiate(item);
            AssetDatabase.CreateAsset(duplicate, "Assets/GalaQuest/Gear/Definitions/__SingleDuplicate.asset");
            Assert.Throws<System.InvalidOperationException>(() => GearFitSeedBatch.ProcessOne(id));
        }

        [TestCase(false)]
        [TestCase(true)]
        public void Missing_or_empty_mounted_mesh_rejects_in_both_gates(bool emptyMesh)
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale);
                var mounted = GearMounter.Mount(hero.transform, item);
                var empty = new Mesh();
                try
                {
                    foreach (var filter in mounted.GetComponentsInChildren<MeshFilter>(true))
                        filter.sharedMesh = emptyMesh ? empty : null;
                    var runtime = GearFitValidator.Validate(hero.transform, mounted, item, LoadProxy());
                    var consistency = GearFitSeedConsistency.Check(hero.transform, mounted, item, fixture, profile, registration);
                    Assert.That(runtime.Any(i => i.Severity == GearFitSeverity.Rejection), Is.True, "runtime accepted no geometry");
                    Assert.That(consistency.Any(i => i.Severity == GearFitSeverity.Rejection), Is.True, "consistency accepted no geometry");
                }
                finally { Object.DestroyImmediate(empty); }
            });
        }

        [Test]
        public void Registration_proportion_warning_survives_one_item_report()
        {
            using var production = new GearTestProductionSnapshot();
            var fixture = Fixture(GearFitFixtureSlot.Shield);
            var serialized = new SerializedObject(fixture);
            serialized.FindProperty("secondaryProportionChecks").GetArrayElementAtIndex(0)
                .FindPropertyRelative("warnAbove").floatValue = 0.9f;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            var report = GearFitSeedBatch.ProcessOne(ShieldSemanticId);
            var registration = GearFitAssetRegistrationAuthoring.LoadRegistration(ShieldSemanticId);
            Assert.That(registration.Status, Is.EqualTo(GearFitRegistrationStatus.Warned));
            Assert.That(report.status, Is.EqualTo("WARN"), "headless report lost registration warning");
            Assert.That(report.findings.Any(f => f.Contains("shield_width_to_height")), Is.True);
        }

        [TestCase(false)]
        [TestCase(true)]
        public void Invisible_or_unsupported_mounted_geometry_rejects(bool unsupported)
        {
            WithShield((hero, fixture, profile, registration, item) =>
            {
                var seed = GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
                item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale);
                var mounted = GearMounter.Mount(hero.transform, item);
                if (unsupported) mounted.AddComponent<SkinnedMeshRenderer>();
                else foreach (var renderer in mounted.GetComponentsInChildren<Renderer>()) renderer.enabled = false;
                Assert.That(GearFitValidator.MountedGeometryError(mounted), Is.Not.Null);
                Assert.That(GearFitSeedConsistency.Check(hero.transform, mounted, item, fixture, profile, registration)
                    .Any(i => i.Severity == GearFitSeverity.Rejection), Is.True);
            });
        }

        [TestCase("missing")]
        [TestCase("empty")]
        [TestCase("duplicate")]
        [TestCase("unknown")]
        public void Bad_item_arguments_replace_old_success_report(string failure)
        {
            var output = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "gq-args-" + System.Guid.NewGuid() + ".json");
            try
            {
                System.IO.File.WriteAllText(output, "{\"status\":\"PASS\",\"runId\":\"old\"}");
                var args = new List<string> { "-gqGearReport", output };
                if (failure != "missing") args.Add("-gqGearItem");
                if (failure == "duplicate") args.AddRange(new[] { ShieldSemanticId, "-gqGearItem", ShieldSemanticId });
                if (failure == "unknown") args.Add("gear.test.absent");
                var result = GearFitSeedBatch.RunArguments(args.ToArray());
                var saved = JsonUtility.FromJson<GearFitSeedBatch.Report>(System.IO.File.ReadAllText(output));
                Assert.That(result.status, Is.EqualTo("FAIL"));
                Assert.That(saved.status, Is.EqualTo("FAIL"));
                Assert.That(saved.runId, Is.EqualTo(result.runId).And.Not.EqualTo("old"));
                Assert.That(saved.startedUtc, Is.Not.Empty);
                Assert.That(saved.findings, Is.Not.Empty);
                Assert.That(saved.reportPath, Is.EqualTo(System.IO.Path.GetFullPath(output)));
            }
            finally { System.IO.File.Delete(output); }
        }

        // -------------------------------------------------------------------------------------------
        // Packaging
        // -------------------------------------------------------------------------------------------

        [Test]
        public void The_seed_bridge_introduces_no_item_specific_scripts()
        {
            var itemWords = new[] { "silverguard", "ironwood", "helmet", "shield", "shoulder", "sword" };
            var offenders = AssetDatabase.FindAssets("t:MonoScript", new[] { "Assets/GalaQuest/Gear" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(System.IO.Path.GetFileNameWithoutExtension)
                .Where(name => itemWords.Any(word => name.ToLowerInvariant().Contains(word)))
                .ToArray();

            Assert.That(offenders, Is.Empty,
                "gear code must stay item-agnostic; found: " + string.Join(", ", offenders));
        }

        // -------------------------------------------------------------------------------------------

        private static void WithShield(
            System.Action<GameObject, GearFitFixtureDefinition, GearAssetFitProfile,
                GearFitAssetRegistration, GearItemDefinition> body)
        {
            var fixture = Object.Instantiate(Fixture(GearFitFixtureSlot.Shield));
            var profile = Object.Instantiate(GearFitAssetRegistrationAuthoring.LoadProfile(ShieldSemanticId));
            Assert.That(profile, Is.Not.Null,
                "the Ironwood Shield asset fit profile is missing at " +
                GearFitAssetRegistrationAuthoring.ProfilePathFor(ShieldSemanticId));

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(ShieldModelPath);
            Assert.That(model, Is.Not.Null, "missing " + ShieldModelPath);

            var registration = BuildRegistration(fixture, profile, model);
            var item = ScratchItem();
            WithHero(hero =>
            {
                try
                {
                    body(hero, fixture, profile, registration, item);
                }
                finally
                {
                    Object.DestroyImmediate(item);
                    Object.DestroyImmediate(registration);
                    Object.DestroyImmediate(fixture);
                    Object.DestroyImmediate(profile);
                }
            });
        }

        /// <summary>An in-memory registration, so tests never write or mutate production records.</summary>
        private static GearFitAssetRegistration BuildRegistration(
            GearFitFixtureDefinition fixture, GearAssetFitProfile profile, GameObject model)
        {
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(model);
            GearFitAssetRegistrationAuthoring.Result result;
            try
            {
                instance.transform.position = Vector3.zero;
                instance.transform.rotation = Quaternion.identity;
                instance.transform.localScale = Vector3.one;
                result = GearFitAssetRegistrationAuthoring.Register(
                    fixture, ShieldSemanticId, string.Empty, instance, profile,
                    profile.RawToCanonicalEuler, "FIT_GRIP", "edit-mode test");
            }
            finally
            {
                Object.DestroyImmediate(instance);
            }

            var registration = ScriptableObject.CreateInstance<GearFitAssetRegistration>();
            registration.Configure(
                result.SemanticAssetId, result.SourceRepoPath, fixture.Slot, result.FrameId,
                result.LandmarkId, result.RawToCanonicalEuler, Vector3.one,
                result.MeasurementSource, result.CavitySource, result.Metric, result.Axis,
                result.MeasuredPrimary, result.TargetPrimary, result.UniformScale,
                result.MeasurementProvenance, result.Status, result.NormalizedRenderSize,
                result.Findings, 0f, result.Note);
            return registration;
        }

        private static GearItemDefinition ScratchItem()
        {
            var item = ScriptableObject.CreateInstance<GearItemDefinition>();
            item.Configure(
                ShieldSemanticId, "Scratch Shield",
                AssetDatabase.LoadAssetAtPath<GameObject>(ShieldModelPath),
                GearSocketIds.LeftHand, GearFitClass.Handheld, ShieldModelPath, new AnatomyRegion[0]);
            return item;
        }

        private static GearFitFixtureDefinition Fixture(GearFitFixtureSlot slot)
        {
            var fixture = GearFitFixtureKitAuthoring.LoadDefinitions()
                .FirstOrDefault(definition => definition.Slot == slot);
            Assert.That(fixture, Is.Not.Null, slot + " fixture is missing");
            return fixture;
        }

        private static HeadFitProxy LoadProxy()
        {
            return AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
        }

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

        private static string Describe(List<GearFitIssue> issues)
        {
            return issues.Count == 0 ? "(no findings)" : string.Join("; ", issues.Select(i => i.ToString()));
        }
    }
}

namespace GalaQuest.Tests
{
    internal sealed class GearTestProductionSnapshot : System.IDisposable
    {
        private readonly Dictionary<string, byte[]> original = ReadFiles();
        private readonly byte[] buildSettings = System.IO.File.ReadAllBytes("ProjectSettings/EditorBuildSettings.asset");
        internal static Dictionary<string, byte[]> ReadFiles() =>
            System.IO.Directory.GetFiles("Assets/GalaQuest/Gear", "*", System.IO.SearchOption.AllDirectories)
                .ToDictionary(p => p.Replace('\\', '/'), System.IO.File.ReadAllBytes);
        public void Dispose()
        {
            UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);
            AssetDatabase.SaveAssets();
            foreach (var path in ReadFiles().Keys)
                if (!original.ContainsKey(path)) System.IO.File.Delete(path);
            foreach (var pair in original)
                if (!System.IO.File.Exists(pair.Key) || !System.IO.File.ReadAllBytes(pair.Key).SequenceEqual(pair.Value))
                    System.IO.File.WriteAllBytes(pair.Key, pair.Value);
            System.IO.File.WriteAllBytes("ProjectSettings/EditorBuildSettings.asset", buildSettings);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }
    }
}
