using System.Linq;
using GalaQuest.Gear;
using GalaQuest.Gear.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.TestTools.Utils;

namespace GalaQuest.Tests
{
    /// <summary>
    /// Gates on the rigid-gear authoring spine.
    ///
    /// The load-bearing tests here are the ones that would fail if the architecture regressed into
    /// per-item code: <see cref="Every_item_mounts_through_the_same_generic_path"/> and
    /// <see cref="No_gear_specific_MonoBehaviour_exists_per_item"/>.
    /// </summary>
    public sealed class GearSpineEditModeTests
    {
        private static GameObject LoadHeroPrefab()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            Assert.That(prefab, Is.Not.Null,
                "GQ_HERO_V1 prefab missing at " + GearHeroAuthoring.HeroPrefabPath);
            return prefab;
        }

        private static HeadFitProxy LoadProxy()
        {
            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            Assert.That(proxy, Is.Not.Null,
                "Head Fit Proxy missing at " + GearHeroAuthoring.HeadProxyPath);
            return proxy;
        }

        private static GearItemDefinition[] LoadDefinitions()
        {
            return AssetDatabase.FindAssets("t:GearItemDefinition")
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearItemDefinition>)
                .Where(asset => asset != null)
                .OrderBy(asset => asset.SemanticId)
                .ToArray();
        }

        [Test]
        public void Hero_prefab_exposes_every_authored_socket_on_its_expected_bone()
        {
            var hero = Object.Instantiate(LoadHeroPrefab());
            try
            {
                var sockets = GearMounter.CollectSockets(hero.transform);
                foreach (var (socketId, boneName) in GearSocketIds.Authored)
                {
                    Assert.That(sockets.ContainsKey(socketId), Is.True,
                        "GQ_HERO_V1 is missing socket '" + socketId + "'.");

                    var socket = sockets[socketId];
                    Assert.That(socket.transform.parent, Is.Not.Null);
                    Assert.That(socket.transform.parent.name, Is.EqualTo(boneName),
                        "Socket '" + socketId + "' is not parented to " + boneName + ".");
                    Assert.That(socket.BoneName, Is.EqualTo(boneName));
                }
            }
            finally
            {
                Object.DestroyImmediate(hero);
            }
        }

        [Test]
        public void Head_fit_proxy_is_measured_from_hero_anatomy_and_not_from_a_helmet()
        {
            var proxy = LoadProxy();

            Assert.That(proxy.SkullRadius, Is.GreaterThan(0f), "skullRadius was not measured.");
            Assert.That(proxy.CrownHeight, Is.GreaterThan(0f),
                "The crown helper must sit above the head bone.");
            Assert.That(proxy.FaceAnchor.magnitude, Is.GreaterThan(0f),
                "The face helper must be offset from the head bone.");

            // The eye line has to sit inside the head, below the crown, or it is not a face constraint.
            Assert.That(proxy.EyeLineHeight, Is.GreaterThan(0f));
            Assert.That(proxy.EyeLineHeight, Is.LessThan(proxy.CrownHeight),
                "The eye line cannot be above the crown.");
            Assert.That(proxy.EyeClearanceRadius, Is.GreaterThan(0f));

            // Provenance must name the Hero, never a gear asset. This is the rule that keeps Silverguard
            // from defining the standard it is supposed to be corrected against.
            Assert.That(proxy.DerivedFromHeroPath, Does.Contain("hero"),
                "The proxy must record the Hero it was measured from.");
            Assert.That(proxy.DerivedFromHeroPath.ToLowerInvariant(), Does.Not.Contain("helmet"));
            Assert.That(proxy.DerivedFromHeroPath.ToLowerInvariant(), Does.Not.Contain("silverguard"));
            Assert.That(proxy.DerivationNote.ToLowerInvariant(), Does.Not.Contain("silverguard"));
        }

        [Test]
        public void Every_item_mounts_through_the_same_generic_path()
        {
            var definitions = LoadDefinitions();
            Assert.That(definitions.Length, Is.GreaterThanOrEqualTo(2),
                "Checkpoint A needs at least two materially different items.");

            var hero = Object.Instantiate(LoadHeroPrefab());
            try
            {
                foreach (var definition in definitions)
                {
                    if (definition.SourceModel == null) continue;

                    var mounted = GearMounter.Mount(hero.transform, definition);
                    try
                    {
                        Assert.That(mounted, Is.Not.Null);
                        Assert.That(mounted.transform.parent, Is.Not.Null);

                        var socket = mounted.transform.parent.GetComponent<GearSocket>();
                        Assert.That(socket, Is.Not.Null,
                            definition.SemanticId + " was not parented to a GearSocket.");
                        Assert.That(socket.SocketId, Is.EqualTo(definition.SocketId));

                        // The mount applied the item's own authored data, not a hardcoded transform.
                        Assert.That(mounted.transform.localPosition,
                            Is.EqualTo(definition.LocalPosition).Using(Vector3EqualityComparer.Instance));
                        Assert.That(mounted.transform.localScale,
                            Is.EqualTo(definition.EffectiveLocalScale).Using(Vector3EqualityComparer.Instance));
                    }
                    finally
                    {
                        Object.DestroyImmediate(mounted);
                    }
                }
            }
            finally
            {
                Object.DestroyImmediate(hero);
            }
        }

        [Test]
        public void Items_cover_at_least_two_different_sockets_and_fit_classes()
        {
            var definitions = LoadDefinitions().Where(d => d.SourceModel != null).ToArray();

            Assert.That(definitions.Select(d => d.SocketId).Distinct().Count(),
                Is.GreaterThanOrEqualTo(2),
                "Checkpoint A must prove more than one socket.");
            Assert.That(definitions.Select(d => d.FitClass).Distinct().Count(),
                Is.GreaterThanOrEqualTo(2),
                "Checkpoint A must prove more than one fit class.");
        }

        [Test]
        public void No_gear_specific_MonoBehaviour_exists_per_item()
        {
            // If a new helmet needed new code, it would show up as a MonoBehaviour named after an item.
            var itemWords = new[] { "silverguard", "ironwood", "helmet", "shield", "shoulder" };
            var gearScripts = AssetDatabase.FindAssets("t:MonoScript", new[] { "Assets/GalaQuest/Gear" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(System.IO.Path.GetFileNameWithoutExtension)
                .Where(name => itemWords.Any(word => name.ToLowerInvariant().Contains(word)))
                .ToArray();

            Assert.That(gearScripts, Is.Empty,
                "Gear code must stay item-agnostic; found item-named scripts: " +
                string.Join(", ", gearScripts));
        }

        [Test]
        public void Validator_rejects_a_missing_socket()
        {
            var definition = ScriptableObject.CreateInstance<GearItemDefinition>();
            try
            {
                definition.Configure("gear.test.nowhere", "Nowhere Item", null,
                    "socket-that-does-not-exist", GearFitClass.RigidGeneric, "n/a", new AnatomyRegion[0]);

                var hero = Object.Instantiate(LoadHeroPrefab());
                try
                {
                    var issues = GearFitValidator.Validate(hero.transform, null, definition, LoadProxy());
                    Assert.That(issues.Any(i => i.Code == GearFitIssueCodes.MissingSocket), Is.True);
                }
                finally
                {
                    Object.DestroyImmediate(hero);
                }
            }
            finally
            {
                Object.DestroyImmediate(definition);
            }
        }

        [Test]
        public void Validator_rejects_a_zero_scale_fit()
        {
            var definition = ScriptableObject.CreateInstance<GearItemDefinition>();
            try
            {
                definition.Configure("gear.test.flat", "Flat Item", null,
                    GearSocketIds.Head, GearFitClass.RigidGeneric, "n/a", new AnatomyRegion[0]);
                definition.ApplyAuthoredFit(Vector3.zero, Vector3.zero, new Vector3(1f, 0f, 1f));

                var hero = Object.Instantiate(LoadHeroPrefab());
                try
                {
                    var issues = GearFitValidator.Validate(hero.transform, null, definition, LoadProxy());
                    Assert.That(issues.Any(i => i.Code == GearFitIssueCodes.InvalidTransform), Is.True);
                }
                finally
                {
                    Object.DestroyImmediate(hero);
                }
            }
            finally
            {
                Object.DestroyImmediate(definition);
            }
        }

        [Test]
        public void Every_shipped_item_passes_its_own_gates_at_bind_pose()
        {
            var proxy = LoadProxy();
            var hero = Object.Instantiate(LoadHeroPrefab());
            try
            {
                foreach (var definition in LoadDefinitions())
                {
                    if (definition.SourceModel == null) continue;

                    var mounted = GearMounter.Mount(hero.transform, definition);
                    try
                    {
                        var rejections = GearFitValidator
                            .Validate(hero.transform, mounted, definition, proxy)
                            .Where(i => i.Severity == GearFitSeverity.Rejection)
                            .Select(i => i.ToString())
                            .ToArray();

                        Assert.That(rejections, Is.Empty,
                            definition.SemanticId + " was rejected: " + string.Join("; ", rejections));
                    }
                    finally
                    {
                        Object.DestroyImmediate(mounted);
                    }
                }
            }
            finally
            {
                Object.DestroyImmediate(hero);
            }
        }

        /// <summary>
        /// Orientation must be searched, never assumed.
        ///
        /// The Silverguard helmet imports rotated: with an identity rotation its shell faces the Hero's
        /// face and buries both eyes. A clearance gate cannot tell that apart from "the helmet is too
        /// big", so the first version of the seeding tool spent several iterations shrinking and lifting
        /// a helmet that was simply upside down, and produced a shrunken shell hovering over the hair.
        ///
        /// This pins the correction: the authored headgear fit is not identity-rotated.
        /// </summary>
        [Test]
        public void Headgear_fits_record_a_searched_orientation_rather_than_assuming_identity()
        {
            var headgear = LoadDefinitions()
                .Where(d => d.SourceModel != null && d.FitClass == GearFitClass.Headgear)
                .ToArray();

            Assert.That(headgear, Is.Not.Empty, "Checkpoint A needs at least one headgear item.");

            foreach (var definition in headgear)
            {
                Assert.That(definition.LocalEulerAngles, Is.Not.EqualTo(Vector3.zero),
                    definition.SemanticId + " is identity-rotated. If the source art was re-exported " +
                    "upright, re-seed it and update this test with what changed.");
            }
        }
    }
}
