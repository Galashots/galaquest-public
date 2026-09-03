using System.IO;
using GalaQuest.Gear;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Creates the two Checkpoint-A items as ordinary data assets and seeds each with a starting fit.
    ///
    /// This file is authoring convenience for the FIRST two items, not the mounting system. It contains
    /// no mounting logic and no per-item behaviour: it fills in a GearItemDefinition and lets
    /// <see cref="GearMounter"/> and <see cref="GearFitValidator"/> do the rest. A third item does not
    /// need a third entry here -- the Owner can create one from
    /// Assets &gt; Create &gt; GalaQuest &gt; Gear &gt; Gear Item Definition.
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
        /// 45 under an Armature scaled 0.01, on a GLB whose own bounds are 1.0 units across. Seeding from
        /// the shipped size keeps the Unity candidate honest rather than inventing a new shield scale.
        /// </summary>
        public const float ShieldWorldDiameter = 0.45f;

        /// <summary>The Silverguard Shoulder's shipped world height, from docs/foundry/gear/tier3_fit.json.</summary>
        public const float ShoulderWorldHeight = 0.21f;

        [MenuItem("GalaQuest/Gear/Create or reseed starter gear definitions")]
        public static void CreateOrReseed()
        {
            Directory.CreateDirectory(DefinitionsFolder);

            var helmet = EnsureDefinition(
                HelmetPath,
                "gear.helmet.silverguard",
                "Silverguard Helmet",
                HelmetModelPath,
                GearSocketIds.Head,
                GearFitClass.Headgear,
                "public/assets/gear/helmet_silverguard.glb",
                new[] { AnatomyRegion.Hair, AnatomyRegion.Ears });

            var shield = EnsureDefinition(
                ShieldPath,
                "gear.shield.ironwood",
                "Ironwood Shield",
                ShieldModelPath,
                GearSocketIds.LeftHand,
                GearFitClass.Handheld,
                "public/assets/gear/shield_ironwood.glb",
                new AnatomyRegion[0]);

            var shoulderLeft = EnsureDefinition(
                ShoulderLeftPath,
                "gear.shoulder.silverguard.left",
                "Silverguard Shoulder (left)",
                ShoulderModelPath,
                GearSocketIds.LeftShoulder,
                GearFitClass.Shoulder,
                "public/assets/gear/shoulder_silverguard.glb",
                new AnatomyRegion[0]);

            var shoulderRight = EnsureDefinition(
                ShoulderRightPath,
                "gear.shoulder.silverguard.right",
                "Silverguard Shoulder (right)",
                ShoulderModelPath,
                GearSocketIds.RightShoulder,
                GearFitClass.Shoulder,
                "public/assets/gear/shoulder_silverguard.glb",
                new AnatomyRegion[0]);

            if (shoulderRight != null) shoulderRight.SetMirrorX(true);

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            SeedFits(helmet, shield, shoulderLeft, shoulderRight);
        }

        private static GearItemDefinition EnsureDefinition(
            string assetPath,
            string semanticId,
            string displayName,
            string modelPath,
            string socketId,
            GearFitClass fitClass,
            string sourceRepoPath,
            AnatomyRegion[] coverage)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            if (model == null)
            {
                Debug.LogWarning("Gear source model not imported yet, skipping " + semanticId + ": " + modelPath);
                return null;
            }

            var definition = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(assetPath);
            var created = definition == null;
            if (created) definition = ScriptableObject.CreateInstance<GearItemDefinition>();

            definition.Configure(semanticId, displayName, model, socketId, fitClass, sourceRepoPath, coverage);

            if (created) AssetDatabase.CreateAsset(definition, assetPath);
            EditorUtility.SetDirty(definition);
            return definition;
        }

        private static void SeedFits(
            GearItemDefinition helmet,
            GearItemDefinition shield,
            GearItemDefinition shoulderLeft,
            GearItemDefinition shoulderRight)
        {
            var heroPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            if (heroPrefab == null || proxy == null)
            {
                Debug.LogWarning("GQ_HERO_V1 or the Head Fit Proxy is missing; fits were not seeded.");
                return;
            }

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(heroPrefab);
            try
            {
                if (helmet != null && helmet.SourceModel != null)
                {
                    var suggestion = GearAutoSeat.SuggestHeadgearFit(hero, helmet, proxy);
                    helmet.ApplyAuthoredFit(
                        suggestion.LocalPosition, suggestion.LocalEulerAngles, suggestion.LocalScale);
                    EditorUtility.SetDirty(helmet);

                    Debug.Log(
                        "Seeded Silverguard Helmet from the Head Fit Proxy: " +
                        "scale " + suggestion.LocalScale.x.ToString("F4") +
                        " x" + suggestion.LocalScale.y.ToString("F4") +
                        ", widthF " + suggestion.WidthFactor.ToString("F2") +
                        ", verticalF " + suggestion.VerticalFactor.ToString("F2") +
                        ", lift steps " + suggestion.LiftSteps +
                        ", eye line cleared " + suggestion.EyeLineCleared +
                        ", crown gap " + suggestion.CrownGap.ToString("F4") + " m.");
                }

                SeedByWorldSize(hero, shield, ShieldWorldDiameter);
                SeedByWorldSize(hero, shoulderLeft, ShoulderWorldHeight);
                SeedByWorldSize(hero, shoulderRight, ShoulderWorldHeight);
            }
            finally
            {
                Object.DestroyImmediate(hero);
            }

            AssetDatabase.SaveAssets();
        }

        /// <summary>
        /// Seed a non-headgear item at its socket, sized to the world dimension it already ships at.
        /// Orientation stays identity: that is a visual judgement for the Owner in the Scene View, and
        /// this deliberately does not guess it.
        /// </summary>
        private static void SeedByWorldSize(GameObject hero, GearItemDefinition definition, float targetSize)
        {
            if (definition == null || definition.SourceModel == null) return;

            var socket = GearMounter.ResolveSocket(hero.transform, definition.SocketId);
            var body = hero.GetComponentInChildren<SkinnedMeshRenderer>(true);
            var bodyVertices = BakeBodyVertices(body);

            var item = Object.Instantiate(definition.SourceModel);
            try
            {
                var bestOrientation = Vector3.zero;
                var bestScale = 1f;
                var bestProtrusion = float.NegativeInfinity;

                // Orientation is searched, not assumed. Identity is a coin flip after the
                // GLB -> Blender -> FBX -> Unity axis conversion, and a pauldron that arrives facing
                // backwards or inboard reads as the #125 "equipped but invisible" defect.
                foreach (var orientation in GearAutoSeat.OrientationCandidates)
                {
                    item.transform.SetParent(socket.transform, false);
                    item.transform.localPosition = Vector3.zero;
                    item.transform.localRotation = Quaternion.Euler(orientation);
                    item.transform.localScale = Vector3.one;

                    var vertices = GearFitValidator.CollectWorldVertices(item);
                    if (vertices.Count == 0) continue;

                    var bounds = GearFitValidator.BoundsOf(vertices);
                    var widest = Mathf.Max(bounds.size.x, Mathf.Max(bounds.size.y, bounds.size.z));
                    var scale = widest > 1e-5f ? targetSize / widest : 1f;

                    item.transform.localScale = Vector3.one * scale;
                    vertices = GearFitValidator.CollectWorldVertices(item);

                    var protrusion = MaxProtrusion(body, bodyVertices, vertices);
                    if (protrusion > bestProtrusion)
                    {
                        bestProtrusion = protrusion;
                        bestOrientation = orientation;
                        bestScale = scale;
                    }
                }

                definition.ApplyAuthoredFit(Vector3.zero, bestOrientation, Vector3.one * bestScale);
                EditorUtility.SetDirty(definition);

                Debug.Log("Seeded " + definition.SemanticId + " at socket '" + definition.SocketId +
                          "' with scale " + bestScale.ToString("F4") +
                          ", orientation " + bestOrientation +
                          ", stands " + bestProtrusion.ToString("F4") + " m clear of the body" +
                          " for a " + targetSize.ToString("F3") + " m target.");
            }
            finally
            {
                Object.DestroyImmediate(item);
            }
        }

        private static Vector3[] BakeBodyVertices(SkinnedMeshRenderer body)
        {
            if (body == null || body.sharedMesh == null) return new Vector3[0];

            var baked = new Mesh();
            try
            {
                body.BakeMesh(baked, true);
                return baked.vertices;
            }
            finally
            {
                Object.DestroyImmediate(baked);
            }
        }

        private static float MaxProtrusion(
            SkinnedMeshRenderer body,
            Vector3[] bodyVertices,
            System.Collections.Generic.List<Vector3> itemWorldVertices)
        {
            if (body == null || bodyVertices.Length == 0) return 0f;

            var bodyStride = Mathf.Max(1, bodyVertices.Length / 1200);
            var itemStride = Mathf.Max(1, itemWorldVertices.Count / 300);
            var max = 0f;

            for (var i = 0; i < itemWorldVertices.Count; i += itemStride)
            {
                var local = body.transform.InverseTransformPoint(itemWorldVertices[i]);
                var nearest = float.PositiveInfinity;
                for (var b = 0; b < bodyVertices.Length; b += bodyStride)
                {
                    var d = (bodyVertices[b] - local).sqrMagnitude;
                    if (d < nearest) nearest = d;
                }
                var distance = Mathf.Sqrt(nearest);
                if (distance > max) max = distance;
            }

            return max;
        }
    }
}
