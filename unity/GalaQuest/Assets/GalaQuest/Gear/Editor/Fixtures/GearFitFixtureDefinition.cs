using System;
using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    public enum GearFitFixtureSlot
    {
        Helmet,
        Shoulder,
        Chest,
        Bracer,
        Shield,
    }

    /// <summary>
    /// The machine-readable fit contract for one GQ_HERO_V1 gear slot.
    ///
    /// This asset exists so that downstream tooling never has to INFER which way is up, which way the
    /// wearer faces, which side is left, what the units are, which point is the functional anchor, or
    /// which measurement controls normalization. Every one of those is an explicit field, and
    /// <see cref="TryValidateContract"/> refuses to let the asset claim authority when they are wrong.
    ///
    /// The kit is still visualized in the Scene View, and the visualization is still the human-readable
    /// half of the story -- but the numbers here are the authority, not the picture.
    ///
    /// Scope: this is a FIT CONTRACT. It does not deform meshes, cut geometry, shrinkwrap, or import
    /// anything. It describes the target an asset must be registered against.
    /// </summary>
    [CreateAssetMenu(
        fileName = "GearFitFixture",
        menuName = "GalaQuest/Gear/Fit Fixture",
        order = 2)]
    public sealed class GearFitFixtureDefinition : ScriptableObject
    {
        [Header("Contract identity")]
        [SerializeField] private string contractId = GearFitCanonicalSpace.ContractId;
        [SerializeField] private string contractVersion = GearFitCanonicalSpace.ContractVersion;

        [Tooltip("Copied from GearFitCanonicalSpace so the convention travels with the serialized asset.")]
        [SerializeField] private string coordinateConvention = GearFitCanonicalSpace.Description;

        [Tooltip("Explicit units. The contract is metres; a fixture that says otherwise is invalid.")]
        [SerializeField] private float metresPerUnityUnit = GearFitCanonicalSpace.MetresPerUnityUnit;

        [Header("Slot")]
        [SerializeField] private GearFitFixtureSlot slot;
        [SerializeField] private string displayName = string.Empty;

        [Header("Gear frames (canonical wearer basis per anchor)")]
        [SerializeField] private GearFitFrame[] frames = Array.Empty<GearFitFrame>();

        [Header("Datums (frame space, metres)")]
        [SerializeField] private GearFitDatum[] datums = Array.Empty<GearFitDatum>();

        [Header("Normalization")]
        [SerializeField] private GearFitPrimaryMeasurement primaryMeasurement;
        [SerializeField] private GearFitProportionCheck[] secondaryProportionChecks =
            Array.Empty<GearFitProportionCheck>();

        [Header("Anatomy")]
        [SerializeField] private AnatomyRegion[] anatomyHideIntent = Array.Empty<AnatomyRegion>();

        [Header("Provenance of the measured set")]
        [SerializeField] private string measuredFromPrefabPath = string.Empty;
        [SerializeField] private string measuredFromSourceRepoPath = string.Empty;
        [SerializeField] private string measuredFromSourceSha256 = string.Empty;

        public string ContractId => contractId;
        public string ContractVersion => contractVersion;
        public string CoordinateConvention => coordinateConvention;
        public float MetresPerUnityUnit => metresPerUnityUnit;
        public GearFitFixtureSlot Slot => slot;
        public string DisplayName => string.IsNullOrEmpty(displayName) ? name : displayName;
        public GearFitFrame[] Frames => frames ?? Array.Empty<GearFitFrame>();
        public GearFitDatum[] Datums => datums ?? Array.Empty<GearFitDatum>();
        public GearFitPrimaryMeasurement PrimaryMeasurement => primaryMeasurement;

        public GearFitProportionCheck[] SecondaryProportionChecks =>
            secondaryProportionChecks ?? Array.Empty<GearFitProportionCheck>();

        public AnatomyRegion[] AnatomyHideIntent => anatomyHideIntent ?? Array.Empty<AnatomyRegion>();
        public string MeasuredFromPrefabPath => measuredFromPrefabPath;
        public string MeasuredFromSourceRepoPath => measuredFromSourceRepoPath;
        public string MeasuredFromSourceSha256 => measuredFromSourceSha256;

        /// <summary>The frame used when a caller does not name a side.</summary>
        public GearFitFrame PrimaryFrame => Frames.Length == 0 ? default(GearFitFrame) : Frames[0];

        public void Configure(
            GearFitFixtureSlot fixtureSlot,
            string name,
            GearFitFrame[] fixtureFrames,
            GearFitDatum[] fixtureDatums,
            GearFitPrimaryMeasurement primary,
            GearFitProportionCheck[] proportions,
            AnatomyRegion[] hideIntent,
            string prefabPath,
            string sourceRepoPath,
            string sourceSha256)
        {
            contractId = GearFitCanonicalSpace.ContractId;
            contractVersion = GearFitCanonicalSpace.ContractVersion;
            coordinateConvention = GearFitCanonicalSpace.Description;
            metresPerUnityUnit = GearFitCanonicalSpace.MetresPerUnityUnit;
            slot = fixtureSlot;
            displayName = name;
            frames = fixtureFrames ?? Array.Empty<GearFitFrame>();
            datums = fixtureDatums ?? Array.Empty<GearFitDatum>();
            primaryMeasurement = primary;
            secondaryProportionChecks = proportions ?? Array.Empty<GearFitProportionCheck>();
            anatomyHideIntent = hideIntent ?? Array.Empty<AnatomyRegion>();
            measuredFromPrefabPath = prefabPath ?? string.Empty;
            measuredFromSourceRepoPath = sourceRepoPath ?? string.Empty;
            measuredFromSourceSha256 = sourceSha256 ?? string.Empty;
        }

        public bool TryGetFrame(string frameId, out GearFitFrame frame)
        {
            foreach (var candidate in Frames)
            {
                if (candidate.FrameId != frameId) continue;
                frame = candidate;
                return true;
            }

            frame = default(GearFitFrame);
            return false;
        }

        public bool TryGetDatum(string datumId, out GearFitDatum datum)
        {
            foreach (var candidate in Datums)
            {
                if (candidate.DatumId != datumId) continue;
                datum = candidate;
                return true;
            }

            datum = default(GearFitDatum);
            return false;
        }

        /// <summary>The frame for one side of the wearer, when the slot is a mirrored pair.</summary>
        public bool TryGetFrameForSide(GearFitFrameSide side, out GearFitFrame frame)
        {
            foreach (var candidate in Frames)
            {
                if (candidate.Side != side) continue;
                frame = candidate;
                return true;
            }

            frame = default(GearFitFrame);
            return false;
        }

        /// <summary>
        /// Every reason this fixture may not be trusted as a machine contract, in one pass.
        ///
        /// Pass a hero root to additionally prove that every anchor resolves on the real skeleton and
        /// that every measured datum names joints that exist. Pass null to check the data alone.
        /// </summary>
        public bool TryValidateContract(Transform heroRoot, out string error)
        {
            var errors = new List<string>();

            if (contractId != GearFitCanonicalSpace.ContractId)
                errors.Add("contract id is not " + GearFitCanonicalSpace.ContractId);
            if (contractVersion != GearFitCanonicalSpace.ContractVersion)
                errors.Add("contract version is not " + GearFitCanonicalSpace.ContractVersion);
            if (coordinateConvention != GearFitCanonicalSpace.Description)
                errors.Add("serialized coordinate convention does not match GearFitCanonicalSpace");
            if (Mathf.Abs(metresPerUnityUnit - GearFitCanonicalSpace.MetresPerUnityUnit) > 1e-6f)
                errors.Add("units must be metres with 1 Unity unit = 1 metre");

            var frameIds = new HashSet<string>();
            if (Frames.Length == 0) errors.Add("fixture declares no gear frame");

            foreach (var frame in Frames)
            {
                if (!frameIds.Add(frame.FrameId)) errors.Add("duplicate frame id " + frame.FrameId);
                if (!frame.TryValidate(out var frameError)) errors.Add(frameError);

                if (heroRoot != null && FindDescendant(heroRoot, frame.AnchorBone) == null)
                    errors.Add(frame.FrameId + ": anchor cannot resolve on the hero: " + frame.AnchorBone);

                // A Left frame hanging off a Right* bone means the sides were crossed somewhere.
                if (frame.Side == GearFitFrameSide.Left &&
                    frame.AnchorBone.StartsWith("Right", StringComparison.OrdinalIgnoreCase))
                    errors.Add(frame.FrameId + ": declares side Left but anchors to " + frame.AnchorBone);
                if (frame.Side == GearFitFrameSide.Right &&
                    frame.AnchorBone.StartsWith("Left", StringComparison.OrdinalIgnoreCase))
                    errors.Add(frame.FrameId + ": declares side Right but anchors to " + frame.AnchorBone);
            }

            var datumIds = new HashSet<string>();
            var functionalCount = 0;
            foreach (var datum in Datums)
            {
                if (!datumIds.Add(datum.DatumId)) errors.Add("duplicate datum id " + datum.DatumId);
                if (!datum.TryValidate(out var datumError)) errors.Add(datumError);
                if (!frameIds.Contains(datum.FrameId))
                    errors.Add(datum.DatumId + ": references unknown frame " + datum.FrameId);
                if (datum.IsFunctional) functionalCount++;

                if (heroRoot != null)
                {
                    foreach (var joint in datum.SourceJoints)
                    {
                        if (FindDescendant(heroRoot, joint) == null)
                            errors.Add(datum.DatumId + ": source joint cannot resolve on the hero: " + joint);
                    }
                }
            }

            if (functionalCount == 0) errors.Add("fixture declares no FunctionalFit datum");

            if (!primaryMeasurement.TryValidate(out var primaryError))
            {
                errors.Add(primaryError);
            }
            else if (!datumIds.Contains(primaryMeasurement.SourceDatumId))
            {
                errors.Add("primary normalization references unknown datum " + primaryMeasurement.SourceDatumId);
            }
            else if (TryGetDatum(primaryMeasurement.SourceDatumId, out var primaryDatum))
            {
                // Normalization may only be driven by a datum that carries fit authority. A reference
                // zone or a decorative extent must never end up controlling scale.
                if (!primaryDatum.IsFunctional)
                    errors.Add("primary normalization datum " + primaryDatum.DatumId +
                               " is " + primaryDatum.Role + ", not FunctionalFit");

                var extent = primaryDatum.Extent(primaryMeasurement.Axis);
                if (Mathf.Abs(extent - primaryMeasurement.ReferenceValueMetres) > 1e-4f)
                    errors.Add("primary normalization reference " +
                               primaryMeasurement.ReferenceValueMetres.ToString("F4") +
                               " does not match datum " + primaryDatum.DatumId + " extent " +
                               extent.ToString("F4") + " on axis " + primaryMeasurement.Axis);
            }

            var checkIds = new HashSet<string>();
            foreach (var check in SecondaryProportionChecks)
            {
                if (!checkIds.Add(check.CheckId)) errors.Add("duplicate proportion check id " + check.CheckId);
                if (!check.TryValidate(out var checkError)) errors.Add(checkError);
            }

            if (string.IsNullOrEmpty(measuredFromPrefabPath))
                errors.Add("fixture does not record which prefab its measured values came from");

            error = string.Join("; ", errors.ToArray());
            return errors.Count == 0;
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root == null || string.IsNullOrEmpty(name)) return null;
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
