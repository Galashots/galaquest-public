using System.IO;
using System.Linq;
using GalaQuest.Gear;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Creates the Checkpoint-A items as ordinary data assets and gives a brand-new item a starting fit.
    ///
    /// The split here is load-bearing:
    ///
    ///   <see cref="EnsureDefinitions"/> is NON-DESTRUCTIVE. It creates what is missing, refreshes
    ///   metadata, and seeds a fit only for an item that has never had one. It is what every automatic
    ///   author/rebuild/capture path calls, so a fit the Owner saved in the Workbench survives them all.
    ///
    ///   <see cref="ReseedAllFitsDiscardingOwnerWork"/> is DESTRUCTIVE and says so. It is the only thing
    ///   that overwrites an Owner-authored transform, nothing automatic calls it, and interactively it
    ///   asks first.
    ///
    /// This file is authoring convenience for the first items, not the mounting system. It contains no
    /// mounting logic and no per-item behaviour; a third helmet does not need an entry here.
    /// </summary>
    public static class GearStarterDefinitions
    {
        public const string DefinitionsFolder = "Assets/GalaQuest/Gear/Definitions";

        public const string HelmetPath = DefinitionsFolder + "/Gear_SilverguardHelmet.asset";
        public const string ShieldPath = DefinitionsFolder + "/Gear_IronwoodShield.asset";
        public const string ShoulderLeftPath = DefinitionsFolder + "/Gear_SilverguardShoulderLeft.asset";
        public const string ShoulderRightPath = DefinitionsFolder + "/Gear_SilverguardShoulderRight.asset";

        public const string HelmetModelPath =
            "Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/SilverguardHelmet.fbx";

        public const string ShieldModelPath =
            "Assets/GalaQuest/Gear/SourceAssets/IronwoodShield.fbx";

        public const string ShoulderModelPath =
            "Assets/GalaQuest/Gear/SourceAssets/SilverguardShoulder.fbx";

        /// <summary>
        /// The Ironwood Shield's shipped world diameter: public/src/character/gear.js mounts it at scale
        /// 45 under an Armature scaled 0.01, on a GLB whose own bounds are 1.0 units across.
        /// </summary>
        public const float ShieldWorldDiameter = 0.45f;

        /// <summary>The Silverguard Shoulder's shipped world height, from docs/foundry/gear/tier3_fit.json.</summary>
        public const float ShoulderWorldHeight = 0.21f;

        private struct Spec
        {
            public string AssetPath;
            public string SemanticId;
            public string DisplayName;
            public string ModelPath;
            public string SocketId;
            public GearFitClass FitClass;
            public string SourceRepoPath;
            public AnatomyRegion[] Coverage;
            public bool MirrorX;
            public float TargetWorldSize;
        }

        private static Spec[] Specs()
        {
            return new[]
            {
                new Spec
                {
                    AssetPath = HelmetPath, SemanticId = "gear.helmet.silverguard",
                    DisplayName = "Silverguard Helmet", ModelPath = HelmetModelPath,
                    SocketId = GearSocketIds.Head, FitClass = GearFitClass.Headgear,
                    SourceRepoPath = "public/assets/gear/helmet_silverguard.glb",
                    Coverage = new[] { AnatomyRegion.Hair, AnatomyRegion.Ears },
                    MirrorX = false, TargetWorldSize = 0f,
                },
                new Spec
                {
                    AssetPath = ShieldPath, SemanticId = "gear.shield.ironwood",
                    DisplayName = "Ironwood Shield", ModelPath = ShieldModelPath,
                    SocketId = GearSocketIds.LeftHand, FitClass = GearFitClass.Handheld,
                    SourceRepoPath = "public/assets/gear/shield_ironwood.glb",
                    Coverage = new AnatomyRegion[0],
                    MirrorX = false, TargetWorldSize = ShieldWorldDiameter,
                },
                new Spec
                {
                    AssetPath = ShoulderLeftPath, SemanticId = "gear.shoulder.silverguard.left",
                    DisplayName = "Silverguard Shoulder (left)", ModelPath = ShoulderModelPath,
                    SocketId = GearSocketIds.LeftShoulder, FitClass = GearFitClass.Shoulder,
                    SourceRepoPath = "public/assets/gear/shoulder_silverguard.glb",
                    Coverage = new AnatomyRegion[0],
                    MirrorX = false, TargetWorldSize = ShoulderWorldHeight,
                },
                new Spec
                {
                    AssetPath = ShoulderRightPath, SemanticId = "gear.shoulder.silverguard.right",
                    DisplayName = "Silverguard Shoulder (right)", ModelPath = ShoulderModelPath,
                    SocketId = GearSocketIds.RightShoulder, FitClass = GearFitClass.Shoulder,
                    SourceRepoPath = "public/assets/gear/shoulder_silverguard.glb",
                    Coverage = new AnatomyRegion[0],
                    MirrorX = true, TargetWorldSize = ShoulderWorldHeight,
                },
            };
        }

        /// <summary>
        /// Safe path: create missing definitions, refresh metadata, and seed a fit only where none has
        /// ever been established. Never touches an Owner-authored transform.
        /// </summary>
        [MenuItem("GalaQuest/Gear/Ensure gear definitions (safe, keeps saved fits)")]
        public static void EnsureDefinitions()
        {
            Ensure(false);
        }

        /// <summary>
        /// Destructive path: throw away every fit, including Owner-authored ones, and reseed from the
        /// machine suggestion. Nothing automatic calls this.
        /// </summary>
        [MenuItem("GalaQuest/Gear/DANGER - Discard ALL gear fits and reseed")]
        public static void ReseedAllFitsDiscardingOwnerWork()
        {
            var authored = LoadAll().Count(definition => definition.IsOwnerAuthored);
            var proceed = Application.isBatchMode || EditorUtility.DisplayDialog(
                "Discard all gear fits?",
                "This permanently discards every saved gear fit, including " + authored +
                " Owner-authored fit(s), and replaces them with machine suggestions.\n\n" +
                "There is no undo.",
                "Discard and reseed",
                "Cancel");

            if (!proceed)
            {
                Debug.Log("Gear reseed cancelled; no fits were changed.");
                return;
            }

            Ensure(true);
            Debug.LogWarning("DESTRUCTIVE reseed complete: all gear fits were discarded and regenerated.");
        }

        private static GearItemDefinition[] LoadAll()
        {
            return AssetDatabase.FindAssets("t:GearItemDefinition")
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearItemDefinition>)
                .Where(asset => asset != null)
                .ToArray();
        }

        private static void Ensure(bool destructive)
        {
            Directory.CreateDirectory(DefinitionsFolder);

            var specs = Specs();
            var definitions = new GearItemDefinition[specs.Length];

            for (var i = 0; i < specs.Length; i++)
                definitions[i] = EnsureDefinition(specs[i]);

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            SeedFits(specs, definitions, destructive);
        }

        private static GearItemDefinition EnsureDefinition(Spec spec)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(spec.ModelPath);
            if (model == null)
            {
                Debug.LogWarning("Gear source model not imported, skipping " + spec.SemanticId +
                                 ": " + spec.ModelPath);
                return null;
            }

            var definition = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(spec.AssetPath);
            var created = definition == null;
            if (created) definition = ScriptableObject.CreateInstance<GearItemDefinition>();

            // Configure refreshes identity/metadata only. It does not touch the fit or its provenance.
            definition.Configure(spec.SemanticId, spec.DisplayName, model, spec.SocketId,
                spec.FitClass, spec.SourceRepoPath, spec.Coverage);
            definition.SetMirrorX(spec.MirrorX);

            if (created) AssetDatabase.CreateAsset(definition, spec.AssetPath);
            EditorUtility.SetDirty(definition);
            return definition;
        }

        private static void SeedFits(Spec[] specs, GearItemDefinition[] definitions, bool destructive)
        {
            var heroPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            if (heroPrefab == null || proxy == null)
            {
                Debug.LogWarning("GQ_HERO_V1 or the Head Fit Proxy is missing; no fits were seeded.");
                return;
            }

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(heroPrefab);
            try
            {
                for (var i = 0; i < specs.Length; i++)
                {
                    var definition = definitions[i];
                    if (definition == null || definition.SourceModel == null) continue;

                    if (!destructive && definition.FitSource != GearFitSource.Unseeded)
                    {
                        Debug.Log("Kept the existing " + definition.FitSource + " fit for " +
                                  definition.SemanticId + "; nothing was reseeded.");
                        continue;
                    }

                    if (definition.FitClass == GearFitClass.Headgear)
                        SeedHeadgear(hero, definition, proxy, destructive);
                    else
                        SeedByWorldSize(hero, definition, specs[i].TargetWorldSize, destructive);
                }
            }
            finally
            {
                Object.DestroyImmediate(hero);
            }

            AssetDatabase.SaveAssets();
        }

        private static void SeedHeadgear(
            GameObject hero, GearItemDefinition definition, HeadFitProxy proxy, bool destructive)
        {
            var suggestion = GearAutoSeat.SuggestHeadgearFit(hero, definition, proxy);

            if (destructive)
                definition.ForceReseedFit(
                    suggestion.LocalPosition, suggestion.LocalEulerAngles, suggestion.LocalScale);
            else if (!definition.TryApplySeedFit(
                         suggestion.LocalPosition, suggestion.LocalEulerAngles, suggestion.LocalScale))
                return;

            EditorUtility.SetDirty(definition);

            Debug.Log("Seeded " + definition.SemanticId + " from the Head Fit Proxy: " +
                      "scale " + suggestion.LocalScale.x.ToString("F4") +
                      " x" + suggestion.LocalScale.y.ToString("F4") +
                      ", orientation " + suggestion.LocalEulerAngles +
                      ", widthF " + suggestion.WidthFactor.ToString("F2") +
                      ", verticalF " + suggestion.VerticalFactor.ToString("F2") +
                      ", lift steps " + suggestion.LiftSteps +
                      ", eye line cleared " + suggestion.EyeLineCleared +
                      ", crown gap " + suggestion.CrownGap.ToString("F4") + " m.");
        }

        /// <summary>
        /// Seed a non-headgear item at its socket, sized to the world dimension it already ships at,
        /// with an IDENTITY rotation.
        ///
        /// Orientation is deliberately NOT guessed here. An earlier revision picked whichever orientation
        /// stood furthest clear of the body, which sounds reasonable for a pauldron and was simply wrong:
        /// it produced flipped shoulders the Owner rejected on sight. Maximum protrusion is not a
        /// statement about which way a piece of armour faces.
        ///
        /// An honest unsolved starting pose beats a confident wrong one. Orientation for these classes is
        /// an explicit visual authoring step in the Workbench.
        /// </summary>
        private static void SeedByWorldSize(
            GameObject hero, GearItemDefinition definition, float targetSize, bool destructive)
        {
            var socket = GearMounter.ResolveSocket(hero.transform, definition.SocketId);
            var item = Object.Instantiate(definition.SourceModel);
            try
            {
                item.transform.SetParent(socket.transform, false);
                item.transform.localPosition = Vector3.zero;
                item.transform.localRotation = Quaternion.identity;
                item.transform.localScale = Vector3.one;

                var vertices = GearFitValidator.CollectWorldVertices(item);
                if (vertices.Count == 0) return;

                var bounds = GearFitValidator.BoundsOf(vertices);
                var widest = Mathf.Max(bounds.size.x, Mathf.Max(bounds.size.y, bounds.size.z));
                var scale = widest > 1e-5f && targetSize > 0f ? targetSize / widest : 1f;

                if (destructive)
                    definition.ForceReseedFit(Vector3.zero, Vector3.zero, Vector3.one * scale);
                else if (!definition.TryApplySeedFit(Vector3.zero, Vector3.zero, Vector3.one * scale))
                    return;

                EditorUtility.SetDirty(definition);

                Debug.Log("Seeded " + definition.SemanticId + " at socket '" + definition.SocketId +
                          "' with scale " + scale.ToString("F4") + " for a " +
                          targetSize.ToString("F3") + " m target, identity rotation " +
                          "(orientation is an explicit authoring step for this class).");
            }
            finally
            {
                Object.DestroyImmediate(item);
            }
        }
    }
}
