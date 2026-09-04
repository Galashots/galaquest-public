using System;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    public enum GearFitRegistrationStatus
    {
        Unclassified = 0,

        /// <summary>Registered and inside every proportion band. Ready for a human to look at.</summary>
        Accepted = 1,

        /// <summary>Registered, but a proportion check warned. A human should look before it ships.</summary>
        Warned = 2,

        /// <summary>A proportion check rejected the silhouette. The ASSET is corrected, not the scale.</summary>
        Rejected = 3,
    }

    /// <summary>
    /// How one arbitrary rigid asset enters the GQ_HERO_V1 fit contract.
    ///
    /// This is the V0 shape of a registration, proved on one real item, not a mass-import pipeline.
    /// It is deliberately DESCRIPTIVE: it records what an asset was measured to be and what uniform
    /// scale follows from that, and it does not import, classify, deform, cut or shrinkwrap anything.
    ///
    /// The load-bearing property is that <see cref="UniformNormalizationScale"/> is a SCALAR. There is
    /// nowhere on this record to store a per-axis correction, because storing one is how an asset ends
    /// up vertically squashed to force a fit instead of being sent back for correction.
    /// </summary>
    [CreateAssetMenu(
        fileName = "GearFitAssetRegistration",
        menuName = "GalaQuest/Gear/Fit Asset Registration",
        order = 3)]
    public sealed class GearFitAssetRegistration : ScriptableObject
    {
        [Header("Identity")]
        [Tooltip("Stable GalaQuest semantic id, e.g. gear.helmet.silverguard. Never a Unity GUID.")]
        [SerializeField] private string semanticAssetId = string.Empty;

        [SerializeField] private string sourceRepoPath = string.Empty;

        [Header("Target")]
        [SerializeField] private GearFitFixtureSlot fixtureSlot;

        [Tooltip("Which gear frame of that fixture the asset is registered into.")]
        [SerializeField] private string gearFrameId = string.Empty;

        [Tooltip("The FunctionalFit datum the asset's own landmark is aligned to.")]
        [SerializeField] private string functionalLandmarkId = string.Empty;

        [Header("Raw to canonical")]
        [Tooltip("Rotation taking the asset's raw imported axes into canonical wearer axes.")]
        [SerializeField] private Vector3 rawToCanonicalEuler;

        [Tooltip("Axis flips or unit conversion applied before measuring. Uniform unless the source " +
                 "genuinely used mixed units.")]
        [SerializeField] private Vector3 rawToCanonicalScale = Vector3.one;

        [Header("Measurement and normalization")]
        [SerializeField] private GearFitPrimaryMetric primaryMetric;
        [SerializeField] private GearFitFrameAxis primaryAxis;

        [Tooltip("The asset's own size along the primary axis, after raw-to-canonical, before scaling.")]
        [SerializeField] private float measuredPrimaryDimensionMetres;

        [Tooltip("The slot reference the asset is normalized to.")]
        [SerializeField] private float targetPrimaryDimensionMetres;

        [Tooltip("One scalar. Deliberately not a Vector3.")]
        [SerializeField] private float uniformNormalizationScale;

        [SerializeField] private GearFitValueProvenance measurementProvenance;

        [Header("Verdict")]
        [SerializeField] private GearFitRegistrationStatus status;

        [Tooltip("Canonical-space bounding size after uniform normalization, used by the proportion checks.")]
        [SerializeField] private Vector3 normalizedSizeInFrame;

        [SerializeField] private string[] proportionFindings = Array.Empty<string>();

        [Header("Calibration against existing human work")]
        [Tooltip("Uniform scale a human already authored for this item, when one exists. Recorded for " +
                 "comparison ONLY: the contract is never tuned backwards to reproduce it, because that " +
                 "would turn one person's eyeballed fit into a measurement.")]
        [SerializeField] private float ownerAuthoredScaleForComparison;

        [SerializeField] private string provenanceNote = string.Empty;

        public string SemanticAssetId => semanticAssetId;
        public string SourceRepoPath => sourceRepoPath;
        public GearFitFixtureSlot FixtureSlot => fixtureSlot;
        public string GearFrameId => gearFrameId;
        public string FunctionalLandmarkId => functionalLandmarkId;
        public Vector3 RawToCanonicalEuler => rawToCanonicalEuler;
        public Quaternion RawToCanonicalRotation => Quaternion.Euler(rawToCanonicalEuler);
        public Vector3 RawToCanonicalScale => rawToCanonicalScale;
        public GearFitPrimaryMetric PrimaryMetric => primaryMetric;
        public GearFitFrameAxis PrimaryAxis => primaryAxis;
        public float MeasuredPrimaryDimensionMetres => measuredPrimaryDimensionMetres;
        public float TargetPrimaryDimensionMetres => targetPrimaryDimensionMetres;
        public float UniformNormalizationScale => uniformNormalizationScale;
        public GearFitValueProvenance MeasurementProvenance => measurementProvenance;
        public GearFitRegistrationStatus Status => status;
        public Vector3 NormalizedSizeInFrame => normalizedSizeInFrame;
        public string[] ProportionFindings => proportionFindings ?? Array.Empty<string>();

        /// <summary>Zero when no human fit exists to compare against.</summary>
        public float OwnerAuthoredScaleForComparison => ownerAuthoredScaleForComparison;
        public string ProvenanceNote => provenanceNote;

        public void Configure(
            string assetId,
            string repoPath,
            GearFitFixtureSlot slot,
            string frameId,
            string landmarkId,
            Vector3 rawRotation,
            Vector3 rawScale,
            GearFitPrimaryMetric metric,
            GearFitFrameAxis axis,
            float measuredDimension,
            float targetDimension,
            float normalizationScale,
            GearFitValueProvenance provenance,
            GearFitRegistrationStatus registrationStatus,
            Vector3 normalizedSize,
            string[] findings,
            float ownerScaleForComparison,
            string note)
        {
            semanticAssetId = assetId;
            sourceRepoPath = repoPath ?? string.Empty;
            fixtureSlot = slot;
            gearFrameId = frameId;
            functionalLandmarkId = landmarkId;
            rawToCanonicalEuler = rawRotation;
            rawToCanonicalScale = rawScale;
            primaryMetric = metric;
            primaryAxis = axis;
            measuredPrimaryDimensionMetres = measuredDimension;
            targetPrimaryDimensionMetres = targetDimension;
            uniformNormalizationScale = normalizationScale;
            measurementProvenance = provenance;
            status = registrationStatus;
            normalizedSizeInFrame = normalizedSize;
            proportionFindings = findings ?? Array.Empty<string>();
            ownerAuthoredScaleForComparison = ownerScaleForComparison;
            provenanceNote = note ?? string.Empty;
        }

        /// <summary>
        /// Everything that would make this record untrustworthy. A Rejected registration is still a
        /// VALID record -- it correctly records that an asset failed -- so rejection is not an error here.
        /// </summary>
        public bool TryValidate(out string error)
        {
            if (string.IsNullOrEmpty(semanticAssetId)) return Fail("semantic asset id is empty", out error);
            if (string.IsNullOrEmpty(gearFrameId)) return Fail("gear frame id is empty", out error);
            if (string.IsNullOrEmpty(functionalLandmarkId))
                return Fail("functional landmark id is empty", out error);
            if (primaryMetric == GearFitPrimaryMetric.Unclassified)
                return Fail("primary metric is unclassified", out error);
            if (measurementProvenance == GearFitValueProvenance.Unclassified)
                return Fail("measurement provenance is unclassified", out error);
            if (status == GearFitRegistrationStatus.Unclassified)
                return Fail("registration status is unclassified", out error);
            if (!IsPositive(measuredPrimaryDimensionMetres))
                return Fail("measured primary dimension is zero, negative or not finite", out error);
            if (!IsPositive(targetPrimaryDimensionMetres))
                return Fail("target primary dimension is zero, negative or not finite", out error);
            if (!IsPositive(uniformNormalizationScale))
                return Fail("uniform normalization scale is zero, negative or not finite", out error);
            if (!IsPositive(rawToCanonicalScale.x) || !IsPositive(rawToCanonicalScale.y) ||
                !IsPositive(rawToCanonicalScale.z))
                return Fail("raw-to-canonical scale is invalid", out error);
            if (string.IsNullOrEmpty(provenanceNote))
                return Fail("provenance note is empty", out error);

            // The scale must be exactly the quotient it claims to be, or the record is decorative.
            var expected = targetPrimaryDimensionMetres / measuredPrimaryDimensionMetres;
            if (Mathf.Abs(expected - uniformNormalizationScale) > 1e-4f)
                return Fail("uniform scale " + uniformNormalizationScale.ToString("F5") +
                            " is not target/measured (" + expected.ToString("F5") + ")", out error);

            error = string.Empty;
            return true;
        }

        private static bool IsPositive(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value) && value > 0f;
        }

        private static bool Fail(string message, out string error)
        {
            error = message;
            return false;
        }
    }
}
