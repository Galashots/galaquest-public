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
            var fixture = Fixture(GearFitFixtureSlot.Shield);
            var profile = GearFitAssetRegistrationAuthoring.LoadProfile(ShieldSemanticId);
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
                "gear.test.shield", "Scratch Shield",
                AssetDatabase.LoadAssetAtPath<GameObject>(ShieldModelPath),
                GearSocketIds.LeftHand, GearFitClass.Handheld, ShieldModelPath, new AnatomyRegion[0]);
            return item;
        }

        private static GearFitFixtureDefinition Fixture(GearFitFixtureSlot slot)
        {
            var fixture = GearFitFixtureKitAuthoring.EnsureDefinitions()
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
