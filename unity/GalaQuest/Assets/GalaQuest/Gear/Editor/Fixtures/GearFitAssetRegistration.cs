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

        /// <summary>
        /// The asset exposes no trustworthy fit cavity, so no fit scale is claimed. This is an honest
        /// terminal state, not a failure: it says a human must declare the cavity before this asset can
        /// be normalized. Inventing a shell-thickness constant to avoid it is the thing we refuse to do.
        /// </summary>
        NeedsAuthoring = 4,
    }

    /// <summary>
    /// Which quantity a registration's primary measurement was taken from.
    ///
    /// Only <see cref="AssetFitCavity"/> may drive normalization. <see cref="RenderBounds"/> exists so
    /// that a record which mistakenly used outer geometry is REPRESENTABLE and therefore REJECTABLE by
    /// validation, rather than indistinguishable from a correct one.
    /// </summary>
    public enum GearFitMeasurementSource
    {
        Unclassified = 0,

        /// <summary>The asset's declared or authored intended fit cavity. The only valid fit source.</summary>
        AssetFitCavity = 1,

        /// <summary>Outer render bounds. Secondary proportion analysis only. Never a fit measurement.</summary>
        RenderBounds = 2,
    }

    /// <summary>
    /// How one arbitrary rigid asset enters the GQ_HERO_V1 fit contract.
    ///
    /// This is the V0 shape of a registration, not a mass-import pipeline. It is deliberately
    /// DESCRIPTIVE: it records what an asset was measured to be and what uniform scale follows from
    /// that, and it does not import, classify, deform, cut or shrinkwrap anything.
    ///
    /// Two load-bearing properties:
    ///
    ///   1. <see cref="UniformNormalizationScale"/> is a SCALAR. There is nowhere here to store a
    ///      per-axis correction, because storing one is how an asset ends up vertically squashed to
    ///      force a fit instead of being sent back for correction.
    ///
    ///   2. the scale is derived from the asset's intended fit CAVITY, never from its outer geometry.
    ///      Hero fixtures state required negative space; an asset's outer bounds include shell
    ///      thickness and decoration. Comparing the two would make a thicker or more decorated helmet
    ///      normalize SMALLER, which is backwards. <see cref="PrimaryMeasurementSource"/> is validated
    ///      to prove which quantity was actually used.
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

        [Tooltip("Axis flips or unit conversion applied before measuring.")]
        [SerializeField] private Vector3 rawToCanonicalScale = Vector3.one;

        [Header("Fit measurement (cavity to cavity)")]
        [Tooltip("Which quantity the primary measurement came from. Only AssetFitCavity is valid.")]
        [SerializeField] private GearFitMeasurementSource primaryMeasurementSource;

        [SerializeField] private GearAssetCavitySource assetCavitySource;
        [SerializeField] private GearFitPrimaryMetric primaryMetric;
        [SerializeField] private GearFitFrameAxis primaryAxis;

        [Tooltip("The asset's own intended fit cavity span along the primary axis, before scaling.")]
        [SerializeField] private float measuredPrimaryDimensionMetres;

        [Tooltip("The Hero's required fit cavity along the same axis.")]
        [SerializeField] private float targetPrimaryDimensionMetres;

        [Tooltip("One scalar. Deliberately not a Vector3.")]
        [SerializeField] private float uniformNormalizationScale;

        [SerializeField] private GearFitValueProvenance measurementProvenance;

        [Header("Silhouette (secondary analysis only)")]
        [Tooltip("Outer render bounds after uniform normalization. Feeds proportion checks and " +
                 "absurd-size warnings. Never feeds the fit scale.")]
        [SerializeField] private Vector3 normalizedRenderSizeInFrame;

        [SerializeField] private string[] proportionFindings = Array.Empty<string>();

        [Header("Verdict")]
        [SerializeField] private GearFitRegistrationStatus status;

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
        public GearFitMeasurementSource PrimaryMeasurementSource => primaryMeasurementSource;
        public GearAssetCavitySource AssetCavitySource => assetCavitySource;
        public GearFitPrimaryMetric PrimaryMetric => primaryMetric;
        public GearFitFrameAxis PrimaryAxis => primaryAxis;
        public float MeasuredPrimaryDimensionMetres => measuredPrimaryDimensionMetres;
        public float TargetPrimaryDimensionMetres => targetPrimaryDimensionMetres;
        public float UniformNormalizationScale => uniformNormalizationScale;
        public GearFitValueProvenance MeasurementProvenance => measurementProvenance;
        public Vector3 NormalizedRenderSizeInFrame => normalizedRenderSizeInFrame;
        public string[] ProportionFindings => proportionFindings ?? Array.Empty<string>();
        public GearFitRegistrationStatus Status => status;

        /// <summary>Zero when no human fit exists to compare against.</summary>
        public float OwnerAuthoredScaleForComparison => ownerAuthoredScaleForComparison;

        public string ProvenanceNote => provenanceNote;

        /// <summary>Did this registration produce a usable fit scale?</summary>
        public bool HasFitScale => status != GearFitRegistrationStatus.NeedsAuthoring &&
                                   status != GearFitRegistrationStatus.Unclassified;

        public void Configure(
            string assetId,
            string repoPath,
            GearFitFixtureSlot slot,
            string frameId,
            string landmarkId,
            Vector3 rawRotation,
            Vector3 rawScale,
            GearFitMeasurementSource measurementSource,
            GearAssetCavitySource cavitySource,
            GearFitPrimaryMetric metric,
            GearFitFrameAxis axis,
            float measuredDimension,
            float targetDimension,
            float normalizationScale,
            GearFitValueProvenance provenance,
            GearFitRegistrationStatus registrationStatus,
            Vector3 normalizedRenderSize,
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
            primaryMeasurementSource = measurementSource;
            assetCavitySource = cavitySource;
            primaryMetric = metric;
            primaryAxis = axis;
            measuredPrimaryDimensionMetres = measuredDimension;
            targetPrimaryDimensionMetres = targetDimension;
            uniformNormalizationScale = normalizationScale;
            measurementProvenance = provenance;
            status = registrationStatus;
            normalizedRenderSizeInFrame = normalizedRenderSize;
            proportionFindings = findings ?? Array.Empty<string>();
            ownerAuthoredScaleForComparison = ownerScaleForComparison;
            provenanceNote = note ?? string.Empty;
        }

        /// <summary>
        /// Everything that would make this record untrustworthy.
        ///
        /// A Rejected registration is still VALID -- it correctly records that an asset failed its
        /// proportion checks. A NeedsAuthoring registration is also valid, and is held to a lighter
        /// standard precisely because it claims no fit scale at all.
        /// </summary>
        public bool TryValidate(out string error)
        {
            if (string.IsNullOrEmpty(semanticAssetId)) return Fail("semantic asset id is empty", out error);
            if (string.IsNullOrEmpty(gearFrameId)) return Fail("gear frame id is empty", out error);
            if (status == GearFitRegistrationStatus.Unclassified)
                return Fail("registration status is unclassified", out error);
            if (string.IsNullOrEmpty(provenanceNote))
                return Fail("provenance note is empty", out error);
            if (!IsPositive(rawToCanonicalScale.x) || !IsPositive(rawToCanonicalScale.y) ||
                !IsPositive(rawToCanonicalScale.z))
                return Fail("raw-to-canonical scale is invalid", out error);

            if (status == GearFitRegistrationStatus.NeedsAuthoring)
            {
                // It must not be quietly carrying a scale it is not entitled to.
                if (uniformNormalizationScale != 0f)
                    return Fail("a NeedsAuthoring registration must claim no fit scale, but carries " +
                                uniformNormalizationScale.ToString("F5"), out error);
                error = string.Empty;
                return true;
            }

            if (string.IsNullOrEmpty(functionalLandmarkId))
                return Fail("functional landmark id is empty", out error);
            if (primaryMetric == GearFitPrimaryMetric.Unclassified)
                return Fail("primary metric is unclassified", out error);
            if (measurementProvenance == GearFitValueProvenance.Unclassified)
                return Fail("measurement provenance is unclassified", out error);

            // The defect this guard exists for: outer render geometry must never set the fit scale.
            if (primaryMeasurementSource != GearFitMeasurementSource.AssetFitCavity)
                return Fail("primary fit measurement came from " + primaryMeasurementSource +
                            "; only AssetFitCavity may drive normalization", out error);
            if (assetCavitySource == GearAssetCavitySource.Unclassified)
                return Fail("asset cavity source is unclassified", out error);

            // A declared cavity is MEASURED; a virtual one is AUTHORED. Nothing else is coherent.
            if (assetCavitySource == GearAssetCavitySource.MeasuredFromAssetLocator &&
                measurementProvenance != GearFitValueProvenance.Measured)
                return Fail("a cavity read from asset locator geometry must be MEASURED, not " +
                            measurementProvenance, out error);
            if (assetCavitySource == GearAssetCavitySource.AuthoredVirtualCavity &&
                measurementProvenance != GearFitValueProvenance.Authored)
                return Fail("a virtual cavity must be AUTHORED, not " + measurementProvenance, out error);

            if (!IsPositive(measuredPrimaryDimensionMetres))
                return Fail("measured primary dimension is zero, negative or not finite", out error);
            if (!IsPositive(targetPrimaryDimensionMetres))
                return Fail("target primary dimension is zero, negative or not finite", out error);
            if (!IsPositive(uniformNormalizationScale))
                return Fail("uniform normalization scale is zero, negative or not finite", out error);

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
