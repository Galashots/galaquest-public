using System;
using System.Collections.Generic;
using System.Linq;
using GalaQuest.Gear;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Builds the five GQ_HERO_V1 slot contracts by MEASURING the Hero, then layering the small number
    /// of clearances a human has to choose on top of the measurements.
    ///
    /// The rule this file exists to enforce: an approximate number typed by a person is never written
    /// into a fixture without an AUTHORED classification next to it, and anything the Hero can answer
    /// for itself is asked of the Hero instead of typed. Rerunning the menu item on the same Hero
    /// reproduces the same assets.
    ///
    /// Authored constants live together at the top of this file rather than being scattered inline, so
    /// a reviewer can see the entire set of human-chosen numbers in one screen.
    /// </summary>
    public static class GearFitFixtureKitAuthoring
    {
        public const string Folder = "Assets/GalaQuest/Gear/Editor/Fixtures/Definitions";

        // ---------------------------------------------------------------------------------------
        // AUTHORED constants. Every one of these is a design decision, not a measurement, and every
        // value derived from one carries GearFitValueProvenance.Authored or .Derived into the asset.
        // ---------------------------------------------------------------------------------------

        /// <summary>Radial gap between the measured head and the inside of a helmet, per side.</summary>
        public const float HelmetRadialClearance = 0.012f;

        /// <summary>How far above the crown decoration (horns, plumes, crests) may reach.</summary>
        public const float HelmetDecorHeadroom = 0.18f;

        /// <summary>Radial gap between the measured deltoid and the inside of a pauldron.</summary>
        public const float ShoulderRadialClearance = 0.015f;

        /// <summary>Gap between the measured torso and the inside of a cuirass.</summary>
        public const float ChestRadialClearance = 0.018f;

        /// <summary>Radial gap between the measured forearm and the inside of a bracer.</summary>
        public const float BracerRadialClearance = 0.010f;

        /// <summary>
        /// Shield height as a fraction of the measured hip-to-neck torso length. A shield has no
        /// anatomy to measure against, so its size is a visual convention -- but anchoring the
        /// convention to the Hero keeps it proportional instead of an unexplained metre value.
        /// </summary>
        public const float ShieldHeightPerTorsoLength = 0.95f;

        /// <summary>Shield width as a fraction of its own height.</summary>
        public const float ShieldWidthPerHeight = 0.66f;

        /// <summary>Shield board thickness, front to back.</summary>
        public const float ShieldThickness = 0.05f;

        /// <summary>Half-extent of the small cube drawn at a single-point landmark such as a joint.</summary>
        public const float PointDatumHalfExtent = 0.015f;

        private static readonly AnatomyRegion[] NoCoverage = new AnatomyRegion[0];

        [MenuItem("GalaQuest/Gear/Create or refresh GQ_HERO_V1 fit fixture kit")]
        public static void CreateOrRefresh()
        {
            var definitions = EnsureDefinitions();
            AssetDatabase.Refresh();
            Debug.Log("Measured " + definitions.Length + " GQ_HERO_V1 fit fixtures into " + Folder + ".");
        }

        /// <summary>Rebuild all five fixtures from the Hero, then return them.</summary>
        public static GearFitFixtureDefinition[] EnsureDefinitions()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            if (prefab == null)
                throw new System.IO.FileNotFoundException(
                    "GQ_HERO_V1 prefab missing: " + GearHeroAuthoring.HeroPrefabPath);

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            try
            {
                var survey = GearHeroDatumSurvey.Measure(hero);
                if (!survey.IsCanonical)
                    throw new InvalidOperationException(
                        "GQ_HERO_V1 does not satisfy the canonical wearer convention, so no fixture may " +
                        "claim it: " + survey.CanonicalSpaceError);

                EnsureFolder();
                foreach (var built in Build(survey)) Write(built);
                AssetDatabase.SaveAssets();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(hero);
            }

            return LoadDefinitions();
        }

        public static GearFitFixtureDefinition[] LoadDefinitions()
        {
            return Enum.GetValues(typeof(GearFitFixtureSlot))
                .Cast<GearFitFixtureSlot>()
                .Select(slot => AssetDatabase.LoadAssetAtPath<GearFitFixtureDefinition>(PathFor(slot)))
                .Where(asset => asset != null)
                .OrderBy(asset => asset.Slot)
                .ToArray();
        }

        public static void AttachOverlay(GameObject hero)
        {
            if (hero == null) return;
            GearFitFixtureOverlay.Configure(hero.transform, LoadDefinitions());
        }

        public static string PathFor(GearFitFixtureSlot slot)
        {
            return Folder + "/GearFitFixture_" + slot + ".asset";
        }

        /// <summary>One built fixture, before it is written to disk.</summary>
        public sealed class Built
        {
            public GearFitFixtureSlot Slot;
            public string DisplayName;
            public GearFitFrame[] Frames;
            public GearFitDatum[] Datums;
            public GearFitPrimaryMeasurement Primary;
            public GearFitProportionCheck[] Proportions;
            public AnatomyRegion[] HideIntent;
        }

        /// <summary>
        /// Build all five contracts from one survey. Public so tests and the review pack can build
        /// against a hero instance without touching the AssetDatabase.
        /// </summary>
        public static Built[] Build(GearHeroDatumSurvey.Survey survey)
        {
            return new[]
            {
                BuildHelmet(survey),
                BuildShoulder(survey),
                BuildChest(survey),
                BuildBracer(survey),
                BuildShield(survey),
            };
        }

        // ---------------------------------------------------------------------------------------
        // Helmet
        // ---------------------------------------------------------------------------------------

        private static Built BuildHelmet(GearHeroDatumSurvey.Survey survey)
        {
            const string frameId = "GQ_HEAD_FRAME";
            var frame = GearHeroDatumSurvey.BuildFrame(
                survey, frameId, GearFitFrameSide.Center, "Head", Vector3.zero,
                "Origin is the Head joint itself, which is the functional seat of headgear.");

            var crown = GearHeroDatumSurvey.ToFrameSpace(survey, frame, survey.LocalJoint("head_end"));
            var face = GearHeroDatumSurvey.ToFrameSpace(survey, frame, survey.LocalJoint("headfront"));
            var headHeight = crown.y;
            var cavityWidth = survey.HeadWidth + 2f * HelmetRadialClearance;
            var cavityDepth = survey.HeadDepth + 2f * HelmetRadialClearance;

            // The brow sits at the Hero's eye line. The eyes are painted into the atlas and have no
            // geometry, so this fraction is the same authored convention the Head Fit Proxy already
            // uses -- see GearHeroAuthoring.DefaultEyeLineFractionOfHead for how it was chosen.
            var browHeight = headHeight * GearHeroAuthoring.DefaultEyeLineFractionOfHead;

            var datums = new[]
            {
                new GearFitDatum(
                    "FIT_CROWN", "Crown", GearFitDatumRole.FunctionalFit, frameId,
                    new Vector3(0f, crown.y, crown.z),
                    new Vector3(survey.HeadWidth, 2f * PointDatumHalfExtent, survey.HeadDepth),
                    GearFitValueProvenance.Measured,
                    new[] { "Head", "head_end" },
                    "The functional top of the HEAD, taken from the rig head_end helper joint. This is " +
                    "NOT the top of a helmet mesh: a helmet may carry horns or a plume above it, which " +
                    "belong to REF_DECOR_HEADROOM."),

                new GearFitDatum(
                    "FIT_HEAD_CAVITY", "Head cavity", GearFitDatumRole.FunctionalFit, frameId,
                    new Vector3(0f, headHeight * 0.5f, 0f),
                    new Vector3(cavityWidth, headHeight, cavityDepth),
                    GearFitValueProvenance.Derived,
                    new[] { "Head", "head_end" },
                    "Measured head width " + F(survey.HeadWidth) + " m and depth " + F(survey.HeadDepth) +
                    " m from Head-dominated vertices at the " + F(GearHeroDatumSurvey.SpanPercentile) +
                    " percentile, plus the authored radial clearance " + F(HelmetRadialClearance) +
                    " m on each side. The percentile rather than the maximum keeps hair spikes out of " +
                    "the functional width."),

                new GearFitDatum(
                    "FIT_BROW", "Brow line", GearFitDatumRole.FunctionalFit, frameId,
                    new Vector3(0f, browHeight, face.z * 0.5f),
                    new Vector3(survey.HeadWidth, 2f * PointDatumHalfExtent, cavityDepth),
                    GearFitValueProvenance.Authored,
                    new string[0],
                    "Authored, not measured: the Hero eyes are painted into the atlas and have no " +
                    "geometry to measure. Placed at " + F(GearHeroAuthoring.DefaultEyeLineFractionOfHead) +
                    " of the measured head height, the same convention HeadFitProxy uses."),

                new GearFitDatum(
                    "KEEP_FACE_OPENING", "Face opening", GearFitDatumRole.KeepClear, frameId,
                    new Vector3(0f, browHeight * 0.75f, face.z),
                    new Vector3(survey.HeadWidth * 0.62f, headHeight * 0.45f, 2f * PointDatumHalfExtent),
                    GearFitValueProvenance.Authored,
                    new string[0],
                    "Authored keep-clear: the face must stay readable. Sized as a fraction of the " +
                    "measured head, positioned at the rig headfront helper depth."),

                new GearFitDatum(
                    "REF_WIDTH_LEFT", "Left width reference", GearFitDatumRole.ReferenceZone, frameId,
                    new Vector3(-0.5f * survey.HeadWidth, headHeight * 0.5f, 0f),
                    new Vector3(2f * PointDatumHalfExtent, headHeight * 0.5f, survey.HeadDepth * 0.5f),
                    GearFitValueProvenance.Measured,
                    new[] { "Head" },
                    "Wearer LEFT edge of the measured head width. Its centre is on -X by construction, " +
                    "which is what makes a left/right reversal detectable rather than invisible."),

                new GearFitDatum(
                    "REF_WIDTH_RIGHT", "Right width reference", GearFitDatumRole.ReferenceZone, frameId,
                    new Vector3(0.5f * survey.HeadWidth, headHeight * 0.5f, 0f),
                    new Vector3(2f * PointDatumHalfExtent, headHeight * 0.5f, survey.HeadDepth * 0.5f),
                    GearFitValueProvenance.Measured,
                    new[] { "Head" },
                    "Wearer RIGHT edge of the measured head width. Its centre is on +X by construction."),

                new GearFitDatum(
                    "REF_DECOR_HEADROOM", "Decoration headroom", GearFitDatumRole.DecorativeExtent, frameId,
                    new Vector3(0f, crown.y + HelmetDecorHeadroom * 0.5f, crown.z),
                    new Vector3(cavityWidth, HelmetDecorHeadroom, cavityDepth),
                    GearFitValueProvenance.Authored,
                    new string[0],
                    "Room above FIT_CROWN where horns, plumes and crests may live. Explicitly NOT a fit " +
                    "reference: geometry in here must never drive normalization or be mistaken for the crown."),
            };

            return new Built
            {
                Slot = GearFitFixtureSlot.Helmet,
                DisplayName = "Helmet fit contract",
                Frames = new[] { frame },
                Datums = datums,
                Primary = new GearFitPrimaryMeasurement(
                    GearFitPrimaryMetric.HeadFunctionalCavityWidth,
                    "FIT_HEAD_CAVITY",
                    GearFitFrameAxis.Right,
                    cavityWidth,
                    GearFitValueProvenance.Derived,
                    "A helmet is uniformly scaled so its wearer-width matches the head cavity width. " +
                    "Width is chosen over height because a helmet may legitimately be tall (crest, " +
                    "plume) but may not be wider than the head it has to sit on."),
                Proportions = new[]
                {
                    new GearFitProportionCheck(
                        "helmet_width_to_height", GearFitFrameAxis.Right, GearFitFrameAxis.Up,
                        0.45f, 0.62f, 1.35f, 1.80f,
                        GearFitValueProvenance.Authored,
                        "After uniform scaling, a helmet much taller than it is wide is a crest that " +
                        "was not declared, and one much wider is a squashed import. Report it; do NOT " +
                        "squash the asset back into range."),
                    new GearFitProportionCheck(
                        "helmet_width_to_depth", GearFitFrameAxis.Right, GearFitFrameAxis.Forward,
                        0.55f, 0.70f, 1.30f, 1.70f,
                        GearFitValueProvenance.Authored,
                        "Guards against a helmet that fits across the head but is flat front-to-back."),
                },
                HideIntent = new[] { AnatomyRegion.Hair, AnatomyRegion.Ears },
            };
        }

        // ---------------------------------------------------------------------------------------
        // Shoulder -- the one paired slot, and therefore the one that can silently mirror wrong.
        // ---------------------------------------------------------------------------------------

        private static Built BuildShoulder(GearHeroDatumSurvey.Survey survey)
        {
            var left = GearHeroDatumSurvey.BuildFrame(
                survey, "GQ_SHOULDER_L_FRAME", GearFitFrameSide.Left, "LeftArm", Vector3.zero,
                "Origin is the LeftArm joint. Side Left means outboard is -X; the axes themselves " +
                "stay canonical, so +X is still wearer right on this frame.");
            var right = GearHeroDatumSurvey.BuildFrame(
                survey, "GQ_SHOULDER_R_FRAME", GearFitFrameSide.Right, "RightArm", Vector3.zero,
                "Origin is the RightArm joint. Side Right means outboard is +X.");

            var cup = survey.ShoulderCupWidth + 2f * ShoulderRadialClearance;
            var torsoHalfWidth = 0.5f * survey.ChestWidth;

            var datums = new List<GearFitDatum>();
            foreach (var frame in new[] { left, right })
            {
                var suffix = frame.Side == GearFitFrameSide.Left ? "_L" : "_R";
                var outboard = frame.OutboardAxis;

                datums.Add(new GearFitDatum(
                    "FIT_SHOULDER_CUP" + suffix, "Shoulder cup " + suffix.Trim('_'),
                    GearFitDatumRole.FunctionalFit, frame.FrameId,
                    outboard * (cup * 0.15f),
                    new Vector3(cup, cup, cup),
                    GearFitValueProvenance.Derived,
                    new[] { frame.AnchorBone },
                    "Measured deltoid diameter " + F(survey.ShoulderCupWidth) + " m -- the " +
                    F(GearHeroDatumSurvey.SpanPercentile) + " percentile radius of " + frame.AnchorBone +
                    "-dominated vertices about the upper-arm axis over the top 35% of the bone -- plus " +
                    "the authored radial clearance " + F(ShoulderRadialClearance) + " m."));

                // The inboard limit is placed from the MEASURED torso, in hero space, then converted
                // into this frame. It is therefore correct for either side without a mirror flag.
                var torsoSide = new Vector3(
                    frame.Side == GearFitFrameSide.Left ? -torsoHalfWidth : torsoHalfWidth,
                    survey.LocalJoint(frame.AnchorBone).y,
                    survey.LocalJoint("Spine02").z);

                datums.Add(new GearFitDatum(
                    "WARN_TORSO_SIDE" + suffix, "Torso side limit " + suffix.Trim('_'),
                    GearFitDatumRole.CollisionWarning, frame.FrameId,
                    GearHeroDatumSurvey.ToFrameSpace(survey, frame, torsoSide),
                    new Vector3(2f * PointDatumHalfExtent, cup, survey.ChestDepth),
                    GearFitValueProvenance.Derived,
                    new[] { "Spine02", frame.AnchorBone },
                    "The wearer-" + (frame.Side == GearFitFrameSide.Left ? "left" : "right") +
                    " flank of the measured torso (" + F(survey.ChestWidth) + " m wide). A pauldron " +
                    "reaching past this intersects the body; that is reported, never auto-corrected."));

                datums.Add(new GearFitDatum(
                    "REF_ARM_SWING" + suffix, "Arm swing room " + suffix.Trim('_'),
                    GearFitDatumRole.ReferenceZone, frame.FrameId,
                    outboard * (cup * 0.2f) + new Vector3(0f, -cup * 0.9f, 0f),
                    new Vector3(cup * 0.9f, cup * 1.6f, cup * 0.9f),
                    GearFitValueProvenance.Authored,
                    new string[0],
                    "Authored context for the eye: roughly where the upper arm travels. Carries no " +
                    "machine authority and is not swept against animation in V0."));
            }

            return new Built
            {
                Slot = GearFitFixtureSlot.Shoulder,
                DisplayName = "Shoulder fit contract",
                Frames = new[] { left, right },
                Datums = datums.ToArray(),
                Primary = new GearFitPrimaryMeasurement(
                    GearFitPrimaryMetric.ShoulderCupWidth,
                    "FIT_SHOULDER_CUP_L",
                    GearFitFrameAxis.Right,
                    cup,
                    GearFitValueProvenance.Derived,
                    "A pauldron is uniformly scaled so its wearer-width matches the shoulder cup. The " +
                    "left cup is the reference and the right frame is its mirror, so a single mesh " +
                    "normalizes identically for both shoulders."),
                Proportions = new[]
                {
                    new GearFitProportionCheck(
                        "shoulder_width_to_height", GearFitFrameAxis.Right, GearFitFrameAxis.Up,
                        0.50f, 0.70f, 2.20f, 3.00f,
                        GearFitValueProvenance.Authored,
                        "A pauldron may legitimately be wide and shallow, so the upper band is generous; " +
                        "an extremely tall one is a spaulder stack that needs a human decision."),
                    new GearFitProportionCheck(
                        "shoulder_width_to_depth", GearFitFrameAxis.Right, GearFitFrameAxis.Forward,
                        0.50f, 0.65f, 1.70f, 2.30f,
                        GearFitValueProvenance.Authored,
                        "Guards against a pauldron that is a flat plate with no front-to-back body."),
                },
                HideIntent = NoCoverage,
            };
        }

        // ---------------------------------------------------------------------------------------
        // Chest
        // ---------------------------------------------------------------------------------------

        private static Built BuildChest(GearHeroDatumSurvey.Survey survey)
        {
            const string frameId = "GQ_CHEST_FRAME";
            var frame = GearHeroDatumSurvey.BuildFrame(
                survey, frameId, GearFitFrameSide.Center, "Spine02", Vector3.zero,
                "Origin is the Spine02 joint, the upper-torso bone a cuirass rides on.");

            // The waist joint is chosen by height, not by name: GQ_HERO_V1 numbers its spine downward,
            // so "Spine" is the top of the chain. Reading it off the name would give a 6 cm cuirass.
            var collar = GearHeroDatumSurvey.ToFrameSpace(
                survey, frame, survey.LocalJoint(survey.CollarJointName));
            var waist = GearHeroDatumSurvey.ToFrameSpace(
                survey, frame, survey.LocalJoint(survey.WaistJointName));
            var shellHeight = Mathf.Max(0.02f, collar.y - waist.y);
            var shellWidth = survey.ChestWidth + 2f * ChestRadialClearance;
            var shellDepth = survey.ChestDepth + 2f * ChestRadialClearance;

            var datums = new[]
            {
                new GearFitDatum(
                    "FIT_CHEST_SHELL", "Chest shell", GearFitDatumRole.FunctionalFit, frameId,
                    new Vector3(0f, 0.5f * (collar.y + waist.y), 0f),
                    new Vector3(shellWidth, shellHeight, shellDepth),
                    GearFitValueProvenance.Derived,
                    new[] { "Spine", "Spine01", "Spine02", "neck" },
                    "Measured torso width " + F(survey.ChestWidth) + " m and depth " + F(survey.ChestDepth) +
                    " m from Spine-dominated vertices at the " + F(GearHeroDatumSurvey.SpanPercentile) +
                    " percentile, spanning the measured collar-to-waist joints, plus the authored " +
                    "clearance " + F(ChestRadialClearance) + " m per side."),

                new GearFitDatum(
                    "FIT_COLLAR", "Collar", GearFitDatumRole.FunctionalFit, frameId,
                    new Vector3(0f, collar.y, collar.z),
                    new Vector3(shellWidth * 0.8f, 2f * PointDatumHalfExtent, shellDepth * 0.8f),
                    GearFitValueProvenance.Measured,
                    new[] { survey.CollarJointName },
                    "The " + survey.CollarJointName + " joint. The top edge of a cuirass seats here; " +
                    "above it belongs to the helmet contract, not this one."),

                new GearFitDatum(
                    "FIT_WAIST", "Waist", GearFitDatumRole.FunctionalFit, frameId,
                    new Vector3(0f, waist.y, waist.z),
                    new Vector3(shellWidth * 0.85f, 2f * PointDatumHalfExtent, shellDepth * 0.85f),
                    GearFitValueProvenance.Measured,
                    new[] { survey.WaistJointName },
                    "The lowest spine joint (" + survey.WaistJointName + " on this rig), found by " +
                    "height rather than by name. A cuirass reaching below this starts fouling the hips."),

                new GearFitDatum(
                    "REF_CHEST_CENTRE", "Chest centre", GearFitDatumRole.ReferenceZone, frameId,
                    new Vector3(0f, 0f, shellDepth * 0.25f),
                    new Vector3(shellWidth * 0.5f, shellHeight * 0.4f, 2f * PointDatumHalfExtent),
                    GearFitValueProvenance.Measured,
                    new[] { "Spine02" },
                    "Where a chest emblem or boss reads best. Context for the eye; no machine authority."),

                new GearFitDatum(
                    "WARN_ARM_CLEARANCE_L", "Arm clearance left", GearFitDatumRole.CollisionWarning, frameId,
                    new Vector3(-0.5f * shellWidth, collar.y * 0.5f, 0f),
                    new Vector3(2f * PointDatumHalfExtent, shellHeight * 0.7f, shellDepth),
                    GearFitValueProvenance.Derived,
                    new[] { "LeftArm" },
                    "Wearer-left flank of the shell. Cuirass geometry past this collides with the arm."),

                new GearFitDatum(
                    "WARN_ARM_CLEARANCE_R", "Arm clearance right", GearFitDatumRole.CollisionWarning, frameId,
                    new Vector3(0.5f * shellWidth, collar.y * 0.5f, 0f),
                    new Vector3(2f * PointDatumHalfExtent, shellHeight * 0.7f, shellDepth),
                    GearFitValueProvenance.Derived,
                    new[] { "RightArm" },
                    "Wearer-right flank of the shell, mirrored from the same measured torso width."),
            };

            return new Built
            {
                Slot = GearFitFixtureSlot.Chest,
                DisplayName = "Chest fit contract",
                Frames = new[] { frame },
                Datums = datums,
                Primary = new GearFitPrimaryMeasurement(
                    GearFitPrimaryMetric.ChestTorsoWidth,
                    "FIT_CHEST_SHELL",
                    GearFitFrameAxis.Right,
                    shellWidth,
                    GearFitValueProvenance.Derived,
                    "A cuirass is uniformly scaled so its wearer-width matches the torso shell width. " +
                    "Width rather than height, because collar-to-waist coverage is a design choice but " +
                    "a cuirass narrower or wider than the torso is simply wrong."),
                Proportions = new[]
                {
                    new GearFitProportionCheck(
                        "chest_width_to_height", GearFitFrameAxis.Right, GearFitFrameAxis.Up,
                        0.55f, 0.75f, 1.60f, 2.10f,
                        GearFitValueProvenance.Authored,
                        "A cuirass that fits across the chest but is far too short or long after uniform " +
                        "scaling is reported for correction rather than stretched vertically."),
                    new GearFitProportionCheck(
                        "chest_width_to_depth", GearFitFrameAxis.Right, GearFitFrameAxis.Forward,
                        0.75f, 0.90f, 2.40f, 3.20f,
                        GearFitValueProvenance.Authored,
                        "GQ_HERO_V1 is a stylized build whose torso is nearly square in plan (measured " +
                        "0.204 m wide by 0.194 m deep), so this band is deliberately wider than a " +
                        "realistic human would need. It still catches a cuirass that is a flat plate " +
                        "or a barrel."),
                },
                HideIntent = NoCoverage,
            };
        }

        // ---------------------------------------------------------------------------------------
        // Bracer
        // ---------------------------------------------------------------------------------------

        private static Built BuildBracer(GearHeroDatumSurvey.Survey survey)
        {
            const string frameId = "GQ_FOREARM_L_FRAME";
            var frame = GearHeroDatumSurvey.BuildFrame(
                survey, frameId, GearFitFrameSide.Left, "LeftForeArm", Vector3.zero,
                "Origin is the LeftForeArm joint, which is the elbow. Side Left fixes outboard to -X; " +
                "the axes remain canonical wearer axes.");

            var elbow = Vector3.zero;
            var wrist = GearHeroDatumSurvey.ToFrameSpace(survey, frame, survey.LocalJoint("LeftHand"));
            var shellDiameter = survey.ForearmDiameter + 2f * BracerRadialClearance;

            // GQ_HERO_V1 binds in an A-pose with the arms carried forward, so the forearm runs along
            // no canonical axis: elbow-to-wrist reads roughly (-0.068, -0.133, -0.079) m. That means
            // the wearer-space EXTENT of the limb is not its length, and normalizing a bracer by an
            // axis extent would silently depend on the bind pose.
            //
            // Diameter is used as the primary instead. It is pose-independent, measured directly from
            // the mesh about the bone axis, and it is the dimension that actually decides whether a
            // bracer fits: a bracer of the wrong length reads as a style choice, one of the wrong bore
            // does not fit the arm at all. Length is still checked, as a secondary proportion.
            var span = ComponentwiseAbs(wrist - elbow);
            var shellSize = new Vector3(
                Mathf.Max(span.x, shellDiameter),
                Mathf.Max(span.y, shellDiameter),
                Mathf.Max(span.z, shellDiameter));
            var lengthAxis = DominantAxis(wrist - elbow);
            var axialExtent = GearFitFrame.Component(shellSize, lengthAxis);

            var datums = new[]
            {
                new GearFitDatum(
                    "FIT_ELBOW", "Elbow", GearFitDatumRole.FunctionalFit, frameId,
                    elbow,
                    new Vector3(shellDiameter, shellDiameter, shellDiameter) * 0.5f,
                    GearFitValueProvenance.Measured,
                    new[] { "LeftForeArm" },
                    "The LeftForeArm joint. The upper limit of a bracer: geometry above it fouls the elbow."),

                new GearFitDatum(
                    "FIT_WRIST", "Wrist", GearFitDatumRole.FunctionalFit, frameId,
                    wrist,
                    new Vector3(shellDiameter, shellDiameter, shellDiameter) * 0.5f,
                    GearFitValueProvenance.Measured,
                    new[] { "LeftHand" },
                    "The LeftHand joint. The lower limit of a bracer."),

                new GearFitDatum(
                    "FIT_FOREARM_SHELL", "Forearm shell", GearFitDatumRole.FunctionalFit, frameId,
                    (elbow + wrist) * 0.5f,
                    shellSize,
                    GearFitValueProvenance.Derived,
                    new[] { "LeftForeArm", "LeftHand" },
                    "Bounds the measured elbow-to-wrist segment (true joint length " +
                    F(survey.ForearmLength) + " m) with a measured forearm diameter of " +
                    F(survey.ForearmDiameter) + " m plus the authored clearance " +
                    F(BracerRadialClearance) + " m per side. The Hero binds in an A-pose, so this box " +
                    "is the wearer-space bound of a limb that runs along no single canonical axis; its " +
                    "longest extent (" + F(axialExtent) + " m along " + lengthAxis + ") is the " +
                    "projection of the limb, not its length."),
            };

            return new Built
            {
                Slot = GearFitFixtureSlot.Bracer,
                DisplayName = "Bracer fit contract",
                Frames = new[] { frame },
                Datums = datums,
                Primary = new GearFitPrimaryMeasurement(
                    GearFitPrimaryMetric.BracerForearmDiameter,
                    "FIT_FOREARM_SHELL",
                    GearFitFrameAxis.Right,
                    shellDiameter,
                    GearFitValueProvenance.Derived,
                    "A bracer is uniformly scaled so its bore matches the forearm. Diameter is chosen " +
                    "over length because the Hero binds in an A-pose: the limb runs along no canonical " +
                    "axis, so any axis-aligned 'length' would depend on the bind pose, while the " +
                    "measured diameter about the bone axis does not. A bracer of the wrong length " +
                    "reads as a style choice; one of the wrong bore does not fit the arm at all."),
                Proportions = new[]
                {
                    new GearFitProportionCheck(
                        "bracer_axial_extent_to_bore",
                        lengthAxis,
                        lengthAxis == GearFitFrameAxis.Right ? GearFitFrameAxis.Up : GearFitFrameAxis.Right,
                        0.40f, 0.80f, 4.50f, 6.50f,
                        GearFitValueProvenance.Authored,
                        "A bracer is a tube, not a disc and not a pipe. The lower bound is loose " +
                        "because the A-pose foreshortens the Hero's own forearm box to roughly 1.07:1; " +
                        "the band still catches a flat plate or a drainpipe. Outside it the asset is " +
                        "reported, never squashed along its length."),
                },
                HideIntent = NoCoverage,
            };
        }

        // ---------------------------------------------------------------------------------------
        // Shield
        // ---------------------------------------------------------------------------------------

        private static Built BuildShield(GearHeroDatumSurvey.Survey survey)
        {
            const string frameId = "GQ_SHIELD_FRAME";
            var frame = GearHeroDatumSurvey.BuildFrame(
                survey, frameId, GearFitFrameSide.Left, "LeftHand", Vector3.zero,
                "Origin is the LeftHand joint, which IS the grip. Side Left fixes outboard to -X.");

            var shieldHeight = survey.TorsoLength * ShieldHeightPerTorsoLength;
            var shieldWidth = shieldHeight * ShieldWidthPerHeight;

            var datums = new[]
            {
                new GearFitDatum(
                    "FIT_GRIP", "Grip", GearFitDatumRole.FunctionalFit, frameId,
                    Vector3.zero,
                    new Vector3(PointDatumHalfExtent * 4f, PointDatumHalfExtent * 6f, PointDatumHalfExtent * 4f),
                    GearFitValueProvenance.Measured,
                    new[] { "LeftHand" },
                    "The LeftHand joint. A shield is registered by putting its own grip landmark here; " +
                    "this is the one datum on this slot that anatomy, not taste, decides."),

                new GearFitDatum(
                    "FIT_SHIELD_BOARD", "Shield board", GearFitDatumRole.FunctionalFit, frameId,
                    new Vector3(0f, 0f, ShieldThickness * 0.5f),
                    new Vector3(shieldWidth, shieldHeight, ShieldThickness),
                    GearFitValueProvenance.Derived,
                    new[] { "Hips", "neck" },
                    "A shield has no anatomy to measure, so its size is an approved visual range rather " +
                    "than a fit measurement. Height is " + F(ShieldHeightPerTorsoLength) +
                    " of the MEASURED hip-to-neck torso length (" + F(survey.TorsoLength) +
                    " m) and width is " + F(ShieldWidthPerHeight) + " of that height, so the convention " +
                    "stays proportional to the Hero instead of being an unexplained constant."),

                new GearFitDatum(
                    "REF_SHIELD_FACE", "Shield face direction", GearFitDatumRole.ReferenceZone, frameId,
                    new Vector3(0f, 0f, ShieldThickness),
                    new Vector3(shieldWidth * 0.6f, shieldHeight * 0.6f, 2f * PointDatumHalfExtent),
                    GearFitValueProvenance.Derived,
                    new string[0],
                    "The outward face of the board sits on +Z, wearer FORWARD, by definition of the " +
                    "canonical frame. A shield whose front points anywhere else is mis-registered."),

                new GearFitDatum(
                    "WARN_FOREARM_CLEARANCE", "Forearm clearance", GearFitDatumRole.CollisionWarning, frameId,
                    new Vector3(0f, 0f, -survey.ForearmDiameter),
                    new Vector3(shieldWidth * 0.5f, shieldHeight * 0.5f, survey.ForearmDiameter),
                    GearFitValueProvenance.Derived,
                    new[] { "LeftForeArm" },
                    "Behind the grip, where the forearm actually is. Uses the measured forearm diameter " +
                    F(survey.ForearmDiameter) + " m. Board geometry reaching back into this intersects the arm."),
            };

            return new Built
            {
                Slot = GearFitFixtureSlot.Shield,
                DisplayName = "Shield fit contract",
                Frames = new[] { frame },
                Datums = datums,
                Primary = new GearFitPrimaryMeasurement(
                    GearFitPrimaryMetric.ShieldGripToRimHeight,
                    "FIT_SHIELD_BOARD",
                    GearFitFrameAxis.Up,
                    shieldHeight,
                    GearFitValueProvenance.Derived,
                    "A shield is uniformly scaled so its board height matches the approved visual range, " +
                    "then positioned by putting its grip landmark on FIT_GRIP. Height rather than width, " +
                    "because a shield reads by how much of the wearer it covers."),
                Proportions = new[]
                {
                    new GearFitProportionCheck(
                        "shield_width_to_height", GearFitFrameAxis.Right, GearFitFrameAxis.Up,
                        0.35f, 0.50f, 1.15f, 1.45f,
                        GearFitValueProvenance.Authored,
                        "Covers kite through round. A board far outside this is a door or a buckler and " +
                        "needs a human decision, not an automatic aspect correction."),
                    new GearFitProportionCheck(
                        "shield_height_to_thickness", GearFitFrameAxis.Up, GearFitFrameAxis.Forward,
                        2.00f, 3.50f, 24.00f, 40.00f,
                        GearFitValueProvenance.Authored,
                        "A board is thin but not a plane. Catches both a slab and a zero-thickness " +
                        "card. The lower bound is loose because stylized GalaQuest shields are chunky."),
                },
                HideIntent = NoCoverage,
            };
        }

        // ---------------------------------------------------------------------------------------

        private static void Write(Built built)
        {
            var path = PathFor(built.Slot);
            var asset = AssetDatabase.LoadAssetAtPath<GearFitFixtureDefinition>(path);
            if (asset == null)
            {
                asset = ScriptableObject.CreateInstance<GearFitFixtureDefinition>();
                AssetDatabase.CreateAsset(asset, path);
            }

            asset.Configure(
                built.Slot,
                built.DisplayName,
                built.Frames,
                built.Datums,
                built.Primary,
                built.Proportions,
                built.HideIntent,
                GearHeroAuthoring.HeroPrefabPath,
                GearHeroAuthoring.HeroSourceRepoPath,
                GearHeroAuthoring.HeroSourceSha256);
            EditorUtility.SetDirty(asset);
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

        private static GearFitFrameAxis DominantAxis(Vector3 value)
        {
            var absolute = ComponentwiseAbs(value);
            if (absolute.x >= absolute.y && absolute.x >= absolute.z) return GearFitFrameAxis.Right;
            if (absolute.y >= absolute.z) return GearFitFrameAxis.Up;
            return GearFitFrameAxis.Forward;
        }

        private static Vector3 ComponentwiseAbs(Vector3 value)
        {
            return new Vector3(Mathf.Abs(value.x), Mathf.Abs(value.y), Mathf.Abs(value.z));
        }

        private static string F(float value)
        {
            return value.ToString("F4", System.Globalization.CultureInfo.InvariantCulture);
        }
    }
}
