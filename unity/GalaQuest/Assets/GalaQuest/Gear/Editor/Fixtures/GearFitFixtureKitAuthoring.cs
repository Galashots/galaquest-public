using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GalaQuest.Gear;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>Creates the five explicit calibration assets and installs their Scene View overlay.</summary>
    public static class GearFitFixtureKitAuthoring
    {
        public const string Folder = "Assets/GalaQuest/Gear/Editor/Fixtures/Definitions";
        public const string OverlayObjectName = "GQ_HERO_V1 Fit Fixture Kit (Editor Only)";

        private static readonly FixtureSpec[] Specs =
        {
            new FixtureSpec(
                GearFitFixtureSlot.Helmet,
                "Helmet fit fixture",
                "Head",
                "",
                Vector3.zero,
                Vector3.forward,
                Vector3.up,
                Vector3.right,
                new Vector3(0f, 0.13f, 0.01f),
                new Vector3(0.40f, 0.28f, 0.34f),
                new[]
                {
                    L("crown zone", GearFitFixtureLandmarkKind.ReferenceZone, new Vector3(0f, 0.27f, 0f), new Vector3(.38f, .10f, .32f)),
                    L("brow / eye line", GearFitFixtureLandmarkKind.KeepClear, new Vector3(0f, .12f, .09f), new Vector3(.30f, .045f, .06f)),
                    L("face opening", GearFitFixtureLandmarkKind.KeepClear, new Vector3(0f, .02f, .12f), new Vector3(.26f, .15f, .04f)),
                },
                new[] { AnatomyRegion.Hair, AnatomyRegion.Ears }),
            new FixtureSpec(
                GearFitFixtureSlot.Shoulder,
                "Shoulder fit fixture",
                "LeftArm",
                "RightArm",
                Vector3.zero,
                Vector3.forward,
                Vector3.up,
                Vector3.right,
                new Vector3(.10f, .01f, .01f),
                new Vector3(.30f, .28f, .30f),
                new[]
                {
                    L("outboard deltoid", GearFitFixtureLandmarkKind.ReferenceZone, new Vector3(.11f, .01f, .01f), new Vector3(.28f, .25f, .30f)),
                    L("arm swing clearance", GearFitFixtureLandmarkKind.KeepClear, new Vector3(.08f, -.17f, .04f), new Vector3(.18f, .52f, .18f)),
                    L("torso collision", GearFitFixtureLandmarkKind.CollisionWarning, new Vector3(-.10f, .01f, .01f), new Vector3(.18f, .35f, .25f)),
                },
                new AnatomyRegion[0]),
            new FixtureSpec(
                GearFitFixtureSlot.Chest,
                "Chest fit fixture",
                "Spine02",
                "",
                Vector3.zero,
                Vector3.forward,
                Vector3.up,
                Vector3.right,
                new Vector3(0f, .12f, .10f),
                new Vector3(.48f, .48f, .22f),
                new[]
                {
                    L("front torso shell", GearFitFixtureLandmarkKind.ReferenceZone, new Vector3(0f, .12f, .12f), new Vector3(.46f, .40f, .20f)),
                    L("collar / shoulder seam", GearFitFixtureLandmarkKind.KeepClear, new Vector3(0f, .34f, .10f), new Vector3(.42f, .10f, .22f)),
                    L("arm swing clearance", GearFitFixtureLandmarkKind.KeepClear, new Vector3(.30f, .08f, .02f), new Vector3(.18f, .40f, .24f)),
                    L("waist limit", GearFitFixtureLandmarkKind.CollisionWarning, new Vector3(0f, -.17f, .10f), new Vector3(.40f, .06f, .20f)),
                },
                new AnatomyRegion[0]),
            new FixtureSpec(
                GearFitFixtureSlot.Bracer,
                "Bracer fit fixture",
                "LeftForeArm",
                "",
                Vector3.zero,
                Vector3.forward,
                Vector3.up,
                Vector3.right,
                new Vector3(0f, 0f, .01f),
                new Vector3(.20f, .48f, .20f),
                new[]
                {
                    L("forearm shell", GearFitFixtureLandmarkKind.ReferenceZone, new Vector3(0f, 0f, .02f), new Vector3(.20f, .42f, .20f)),
                    L("wrist bound", GearFitFixtureLandmarkKind.KeepClear, new Vector3(0f, -.24f, .02f), new Vector3(.18f, .06f, .18f)),
                    L("elbow bound", GearFitFixtureLandmarkKind.KeepClear, new Vector3(0f, .24f, .02f), new Vector3(.20f, .07f, .20f)),
                },
                new AnatomyRegion[0]),
            new FixtureSpec(
                GearFitFixtureSlot.Shield,
                "Shield fit fixture",
                "LeftHand",
                "",
                Vector3.zero,
                Vector3.forward,
                Vector3.up,
                Vector3.right,
                new Vector3(.22f, .02f, .01f),
                new Vector3(.56f, .62f, .18f),
                new[]
                {
                    L("grip anchor", GearFitFixtureLandmarkKind.ReferenceZone, Vector3.zero, new Vector3(.08f, .10f, .08f)),
                    L("front face direction", GearFitFixtureLandmarkKind.ReferenceZone, new Vector3(.34f, .02f, .03f), new Vector3(.10f, .62f, .62f)),
                    L("body / forearm clearance", GearFitFixtureLandmarkKind.KeepClear, new Vector3(.18f, .02f, -.08f), new Vector3(.34f, .56f, .12f)),
                },
                new AnatomyRegion[0]),
        };

        [MenuItem("GalaQuest/Gear/Create or refresh GQ_HERO_V1 fit fixture kit")]
        public static void CreateOrRefresh()
        {
            EnsureDefinitions();
            AssetDatabase.Refresh();
            Debug.Log("Created " + Specs.Length + " GQ_HERO_V1 fit fixture definitions under " + Folder + ".");
        }

        public static GearFitFixtureDefinition[] EnsureDefinitions()
        {
            EnsureFolder();
            foreach (var spec in Specs) CreateOrUpdate(spec);
            AssetDatabase.SaveAssets();
            return LoadDefinitions();
        }

        public static GearFitFixtureDefinition[] LoadDefinitions()
        {
            return Specs
                .Select(spec => AssetDatabase.LoadAssetAtPath<GearFitFixtureDefinition>(PathFor(spec.Slot)))
                .Where(asset => asset != null)
                .OrderBy(asset => asset.Slot)
                .ToArray();
        }

        public static void AttachOverlay(GameObject hero)
        {
            if (hero == null) return;
            GearFitFixtureOverlay.Configure(hero.transform, EnsureDefinitions());
        }

        private static void EnsureFolder()
        {
            var parts = Folder.Split('/');
            var current = parts[0];
            for (var i = 1; i < parts.Length; i++)
            {
                var next = current + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[i]);
                current = next;
            }
        }

        private static void CreateOrUpdate(FixtureSpec spec)
        {
            var path = PathFor(spec.Slot);
            var asset = AssetDatabase.LoadAssetAtPath<GearFitFixtureDefinition>(path);
            if (asset == null)
            {
                asset = ScriptableObject.CreateInstance<GearFitFixtureDefinition>();
                AssetDatabase.CreateAsset(asset, path);
            }

            asset.Configure(
                spec.Slot,
                spec.DisplayName,
                spec.AnchorBone,
                spec.MirroredAnchorBone,
                spec.AnchorOffset,
                spec.ForwardAxis,
                spec.UpAxis,
                spec.OutAxis,
                spec.InnerClearanceCenter,
                spec.InnerClearanceSize,
                spec.Landmarks,
                spec.AnatomyHideIntent);
            EditorUtility.SetDirty(asset);
        }

        private static string PathFor(GearFitFixtureSlot slot)
        {
            return Folder + "/GearFitFixture_" + slot + ".asset";
        }

        private static GearFitFixtureLandmark L(
            string label,
            GearFitFixtureLandmarkKind kind,
            Vector3 center,
            Vector3 size)
        {
            return new GearFitFixtureLandmark(label, kind, center, size);
        }

        private sealed class FixtureSpec
        {
            public readonly GearFitFixtureSlot Slot;
            public readonly string DisplayName;
            public readonly string AnchorBone;
            public readonly string MirroredAnchorBone;
            public readonly Vector3 AnchorOffset;
            public readonly Vector3 ForwardAxis;
            public readonly Vector3 UpAxis;
            public readonly Vector3 OutAxis;
            public readonly Vector3 InnerClearanceCenter;
            public readonly Vector3 InnerClearanceSize;
            public readonly GearFitFixtureLandmark[] Landmarks;
            public readonly AnatomyRegion[] AnatomyHideIntent;

            public FixtureSpec(
                GearFitFixtureSlot slot,
                string name,
                string bone,
                string mirroredBone,
                Vector3 offset,
                Vector3 forward,
                Vector3 up,
                Vector3 outward,
                Vector3 clearanceCenter,
                Vector3 clearanceSize,
                GearFitFixtureLandmark[] fixtureLandmarks,
                AnatomyRegion[] hideIntent)
            {
                Slot = slot;
                DisplayName = name;
                AnchorBone = bone;
                MirroredAnchorBone = mirroredBone;
                AnchorOffset = offset;
                ForwardAxis = forward;
                UpAxis = up;
                OutAxis = outward;
                InnerClearanceCenter = clearanceCenter;
                InnerClearanceSize = clearanceSize;
                Landmarks = fixtureLandmarks;
                AnatomyHideIntent = hideIntent;
            }
        }
    }
}
