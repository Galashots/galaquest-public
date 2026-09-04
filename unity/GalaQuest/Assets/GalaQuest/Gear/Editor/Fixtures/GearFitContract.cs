using System;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// The one wearable-space convention every GQ_HERO_V1 gear frame, datum and measurement is
    /// expressed in. Downstream tooling reads this instead of inferring a convention from geometry.
    /// </summary>
    public static class GearFitCanonicalSpace
    {
        public const string ContractId = "GQ_HERO_V1_GEAR_DATUM";
        public const string ContractVersion = "V0";

        /// <summary>Human-readable statement of the convention, copied into every fixture asset.</summary>
        public const string Description =
            "+X = wearer RIGHT; +Y = wearer UP; +Z = wearer FORWARD; 1 Unity unit = 1 metre; " +
            "Unity left-handed, so Cross(right, up) == forward.";

        public const float MetresPerUnityUnit = 1f;

        /// <summary>
        /// Tolerance for unit length, orthogonality and handedness. Frame axes are produced by
        /// inverse-transforming hero-root axes through a bone, so they carry float error from the
        /// rig matrices; 1e-3 is tight enough to catch a real axis mistake and loose enough to
        /// survive that arithmetic.
        /// </summary>
        public const float BasisTolerance = 1e-3f;

        public static Vector3 Right => Vector3.right;
        public static Vector3 Up => Vector3.up;
        public static Vector3 Forward => Vector3.forward;
    }

    /// <summary>Which canonical axis a scalar measurement or proportion ratio is taken along.</summary>
    public enum GearFitFrameAxis
    {
        /// <summary>Wearer left-right span (+X).</summary>
        Right = 0,

        /// <summary>Wearer vertical span (+Y).</summary>
        Up = 1,

        /// <summary>Wearer front-back span (+Z).</summary>
        Forward = 2,
    }

    /// <summary>Which side of the wearer a frame belongs to. Fixes outboard sign without a second axis field.</summary>
    public enum GearFitFrameSide
    {
        Center = 0,
        Left = 1,
        Right = 2,
    }

    /// <summary>
    /// What a datum is FOR. The distinction that matters for production is
    /// <see cref="FunctionalFit"/> versus <see cref="DecorativeExtent"/>: the highest vertex of a
    /// helmet is a decorative extent -- it may be a horn or a plume -- never the fit crown.
    /// </summary>
    public enum GearFitDatumRole
    {
        Unclassified = 0,

        /// <summary>Load-bearing for fit. An imported asset is registered and normalized against these.</summary>
        FunctionalFit = 1,

        /// <summary>Anatomy that must stay readable and unoccluded.</summary>
        KeepClear = 2,

        /// <summary>Region an oversized asset will visibly intersect. Reported, not auto-corrected.</summary>
        CollisionWarning = 3,

        /// <summary>Context for a human eye. Carries no machine authority.</summary>
        ReferenceZone = 4,

        /// <summary>Silhouette room decoration may occupy. Explicitly NOT a fit reference.</summary>
        DecorativeExtent = 5,
    }

    /// <summary>
    /// Where a contract-critical number came from. <see cref="Unclassified"/> is a hard validation
    /// failure: the contract refuses to claim machine authority for a number nobody has classified.
    /// </summary>
    public enum GearFitValueProvenance
    {
        Unclassified = 0,

        /// <summary>Mechanically derived from GQ_HERO_V1 geometry or skeleton at bind pose.</summary>
        Measured = 1,

        /// <summary>A design clearance or landmark chosen by a human. Approximate on purpose.</summary>
        Authored = 2,

        /// <summary>Calculated from other contract values.</summary>
        Derived = 3,
    }

    /// <summary>The scalar a slot normalizes an incoming asset against. Exactly one per slot.</summary>
    public enum GearFitPrimaryMetric
    {
        Unclassified = 0,
        HeadFunctionalCavityWidth = 1,
        ShoulderCupWidth = 2,
        ChestTorsoWidth = 3,
        BracerForearmDiameter = 4,
        ShieldGripToRimHeight = 5,
    }

    /// <summary>Outcome of a secondary proportion check. Never a licence to scale non-uniformly.</summary>
    public enum GearFitProportionVerdict
    {
        Pass = 0,
        Warn = 1,
        Reject = 2,
    }

    /// <summary>
    /// A canonical wearer-space basis pinned to one anchor bone.
    ///
    /// The axes are stored IN ANCHOR-BONE LOCAL SPACE, but they always MEAN wearer right/up/forward.
    /// That is the whole point: an FBX bone may carry any roll the exporter felt like, and this struct
    /// absorbs it once, at authoring time, so no downstream consumer ever reasons about bone roll.
    /// Resolving the frame gives a rotation whose +X/+Y/+Z are wearer right/up/forward in the pose the
    /// bone currently holds, so gear still rides the skeleton through animation.
    /// </summary>
    [Serializable]
    public struct GearFitFrame
    {
        [SerializeField] private string frameId;
        [SerializeField] private GearFitFrameSide side;
        [SerializeField] private string anchorBone;
        [SerializeField] private Vector3 originInAnchor;
        [SerializeField] private Vector3 rightAxisInAnchor;
        [SerializeField] private Vector3 upAxisInAnchor;
        [SerializeField] private Vector3 forwardAxisInAnchor;
        [SerializeField] private GearFitValueProvenance provenance;
        [SerializeField] private string provenanceNote;

        public string FrameId => frameId;
        public GearFitFrameSide Side => side;
        public string AnchorBone => anchorBone;

        /// <summary>Frame origin in anchor-bone local metres. The functional anchor point for this slot.</summary>
        public Vector3 OriginInAnchor => originInAnchor;

        public Vector3 RightAxisInAnchor => rightAxisInAnchor;
        public Vector3 UpAxisInAnchor => upAxisInAnchor;
        public Vector3 ForwardAxisInAnchor => forwardAxisInAnchor;
        public GearFitValueProvenance Provenance => provenance;
        public string ProvenanceNote => provenanceNote;

        /// <summary>
        /// Which way is away from the body for this frame, in canonical axes. Derived from
        /// <see cref="Side"/> rather than stored, so it cannot drift out of agreement with it.
        /// </summary>
        public Vector3 OutboardAxis
        {
            get
            {
                switch (side)
                {
                    case GearFitFrameSide.Left: return -GearFitCanonicalSpace.Right;
                    case GearFitFrameSide.Right: return GearFitCanonicalSpace.Right;
                    default: return Vector3.zero;
                }
            }
        }

        public GearFitFrame(
            string id,
            GearFitFrameSide frameSide,
            string bone,
            Vector3 origin,
            Vector3 right,
            Vector3 up,
            Vector3 forward,
            GearFitValueProvenance valueProvenance,
            string note)
        {
            frameId = id;
            side = frameSide;
            anchorBone = bone;
            originInAnchor = origin;
            rightAxisInAnchor = right;
            upAxisInAnchor = up;
            forwardAxisInAnchor = forward;
            provenance = valueProvenance;
            provenanceNote = note ?? string.Empty;
        }

        /// <summary>
        /// Mechanically check the stored basis. Rejects degenerate, non-unit, non-orthogonal and
        /// wrong-handed bases, and rejects a right axis that disagrees with forward-and-up -- so the
        /// right axis is load-bearing rather than a decorative field nothing reads.
        /// </summary>
        public bool TryValidate(out string error)
        {
            if (string.IsNullOrEmpty(frameId)) return Fail("a frame has an empty id", out error);
            if (string.IsNullOrEmpty(anchorBone)) return Fail(frameId + ": anchor bone is empty", out error);
            if (provenance == GearFitValueProvenance.Unclassified)
                return Fail(frameId + ": basis provenance is unclassified", out error);

            if (!IsFinite(originInAnchor)) return Fail(frameId + ": origin is not finite", out error);
            if (!IsFinite(rightAxisInAnchor) || !IsFinite(upAxisInAnchor) || !IsFinite(forwardAxisInAnchor))
                return Fail(frameId + ": basis contains a non-finite axis", out error);

            const float tolerance = GearFitCanonicalSpace.BasisTolerance;
            if (Mathf.Abs(rightAxisInAnchor.magnitude - 1f) > tolerance ||
                Mathf.Abs(upAxisInAnchor.magnitude - 1f) > tolerance ||
                Mathf.Abs(forwardAxisInAnchor.magnitude - 1f) > tolerance)
                return Fail(frameId + ": basis axes are not unit length", out error);

            if (Mathf.Abs(Vector3.Dot(rightAxisInAnchor, upAxisInAnchor)) > tolerance ||
                Mathf.Abs(Vector3.Dot(rightAxisInAnchor, forwardAxisInAnchor)) > tolerance ||
                Mathf.Abs(Vector3.Dot(upAxisInAnchor, forwardAxisInAnchor)) > tolerance)
                return Fail(frameId + ": basis axes are not orthogonal", out error);

            // Unity is left-handed: for a correct wearer basis, Cross(right, up) == forward.
            var handedness = Vector3.Dot(Vector3.Cross(rightAxisInAnchor, upAxisInAnchor), forwardAxisInAnchor);
            if (handedness < 1f - tolerance)
                return Fail(frameId + ": basis handedness is flipped (right x up dot forward = " +
                            handedness.ToString("F4") + ")", out error);

            // The rotation is built from forward and up; assert the stored right axis agrees with it,
            // so a wrong right axis fails instead of being silently ignored.
            var rotation = Quaternion.LookRotation(forwardAxisInAnchor, upAxisInAnchor);
            if (Vector3.Dot(rotation * GearFitCanonicalSpace.Right, rightAxisInAnchor) < 1f - tolerance)
                return Fail(frameId + ": stored right axis disagrees with forward and up", out error);

            error = string.Empty;
            return true;
        }

        /// <summary>Rotation taking canonical wearer axes into anchor-bone local space.</summary>
        public bool TryResolveLocalRotation(out Quaternion rotation, out string error)
        {
            if (!TryValidate(out error))
            {
                rotation = Quaternion.identity;
                return false;
            }

            rotation = Quaternion.LookRotation(forwardAxisInAnchor, upAxisInAnchor);
            return true;
        }

        /// <summary>Frame-space point to world, through whatever pose the anchor bone currently holds.</summary>
        public bool TryTransformPoint(Transform anchor, Vector3 framePoint, out Vector3 world, out string error)
        {
            world = Vector3.zero;
            if (anchor == null) return Fail(frameId + ": anchor transform is null", out error);
            if (!TryResolveLocalRotation(out var rotation, out error)) return false;
            world = anchor.TransformPoint(originInAnchor + rotation * framePoint);
            return true;
        }

        /// <summary>Frame-space direction to world.</summary>
        public bool TryTransformDirection(Transform anchor, Vector3 frameDirection, out Vector3 world, out string error)
        {
            world = Vector3.zero;
            if (anchor == null) return Fail(frameId + ": anchor transform is null", out error);
            if (!TryResolveLocalRotation(out var rotation, out error)) return false;
            world = anchor.TransformDirection(rotation * frameDirection);
            return true;
        }

        /// <summary>World rotation of the frame in the current pose of the anchor.</summary>
        public bool TryResolveWorldRotation(Transform anchor, out Quaternion world, out string error)
        {
            world = Quaternion.identity;
            if (anchor == null) return Fail(frameId + ": anchor transform is null", out error);
            if (!TryResolveLocalRotation(out var rotation, out error)) return false;
            world = anchor.rotation * rotation;
            return true;
        }

        public static Vector3 AxisVector(GearFitFrameAxis axis)
        {
            switch (axis)
            {
                case GearFitFrameAxis.Right: return GearFitCanonicalSpace.Right;
                case GearFitFrameAxis.Up: return GearFitCanonicalSpace.Up;
                default: return GearFitCanonicalSpace.Forward;
            }
        }

        public static float Component(Vector3 sizeInFrame, GearFitFrameAxis axis)
        {
            switch (axis)
            {
                case GearFitFrameAxis.Right: return sizeInFrame.x;
                case GearFitFrameAxis.Up: return sizeInFrame.y;
                default: return sizeInFrame.z;
            }
        }

        private static bool Fail(string message, out string error)
        {
            error = message;
            return false;
        }

        private static bool IsFinite(Vector3 value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x) &&
                   !float.IsNaN(value.y) && !float.IsInfinity(value.y) &&
                   !float.IsNaN(value.z) && !float.IsInfinity(value.z);
        }
    }

    /// <summary>
    /// One named anatomical reference for a slot, expressed in FRAME space -- not in raw bone space.
    /// A datum is a labelled box: <see cref="LocalCenter"/> is its centre and <see cref="LocalSize"/>
    /// its full extent along the canonical axes.
    /// </summary>
    [Serializable]
    public struct GearFitDatum
    {
        [SerializeField] private string datumId;
        [SerializeField] private string displayName;
        [SerializeField] private GearFitDatumRole role;
        [SerializeField] private string frameId;
        [SerializeField] private Vector3 localCenter;
        [SerializeField] private Vector3 localSize;
        [SerializeField] private GearFitValueProvenance provenance;
        [SerializeField] private string[] sourceJoints;
        [SerializeField] private string provenanceNote;

        public string DatumId => datumId;
        public string DisplayName => string.IsNullOrEmpty(displayName) ? datumId : displayName;
        public GearFitDatumRole Role => role;
        public string FrameId => frameId;
        public Vector3 LocalCenter => localCenter;
        public Vector3 LocalSize => localSize;
        public GearFitValueProvenance Provenance => provenance;

        /// <summary>GQ_HERO_V1 joints or bones a MEASURED datum was derived from. Empty when authored.</summary>
        public string[] SourceJoints => sourceJoints ?? Array.Empty<string>();

        public string ProvenanceNote => provenanceNote;

        /// <summary>Does this datum carry machine authority over fit, or is it context for a human?</summary>
        public bool IsFunctional => role == GearFitDatumRole.FunctionalFit;

        public GearFitDatum(
            string id,
            string name,
            GearFitDatumRole datumRole,
            string frame,
            Vector3 center,
            Vector3 size,
            GearFitValueProvenance valueProvenance,
            string[] joints,
            string note)
        {
            datumId = id;
            displayName = name;
            role = datumRole;
            frameId = frame;
            localCenter = center;
            localSize = size;
            provenance = valueProvenance;
            sourceJoints = joints ?? Array.Empty<string>();
            provenanceNote = note ?? string.Empty;
        }

        public float Extent(GearFitFrameAxis axis) => GearFitFrame.Component(localSize, axis);

        public bool TryValidate(out string error)
        {
            if (string.IsNullOrEmpty(datumId)) return Fail("a datum has an empty id", out error);
            if (role == GearFitDatumRole.Unclassified) return Fail(datumId + ": role is unclassified", out error);
            if (string.IsNullOrEmpty(frameId)) return Fail(datumId + ": frame id is empty", out error);
            if (provenance == GearFitValueProvenance.Unclassified)
                return Fail(datumId + ": provenance is unclassified", out error);
            if (!IsPositive(localSize)) return Fail(datumId + ": size is zero, negative or not finite", out error);
            if (!IsFiniteVector(localCenter)) return Fail(datumId + ": centre is not finite", out error);

            // A MEASURED value has to say what it was measured from, or the classification is a claim
            // with nothing behind it.
            if (provenance == GearFitValueProvenance.Measured && SourceJoints.Length == 0)
                return Fail(datumId + ": claims MEASURED but names no GQ_HERO_V1 source joint", out error);
            if (string.IsNullOrEmpty(provenanceNote))
                return Fail(datumId + ": provenance note is empty", out error);

            error = string.Empty;
            return true;
        }

        private static bool Fail(string message, out string error)
        {
            error = message;
            return false;
        }

        private static bool IsPositive(Vector3 value)
        {
            return IsFiniteVector(value) && value.x > 0f && value.y > 0f && value.z > 0f;
        }

        private static bool IsFiniteVector(Vector3 value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x) &&
                   !float.IsNaN(value.y) && !float.IsInfinity(value.y) &&
                   !float.IsNaN(value.z) && !float.IsInfinity(value.z);
        }
    }

    /// <summary>
    /// The single scalar a slot normalizes an incoming asset against, and the axis it is taken along.
    ///
    /// This does NOT claim to settle artistic acceptance. It exists so that the uniform scale factor
    /// applied to an imported asset is deterministic and reproducible rather than eyeballed.
    /// </summary>
    [Serializable]
    public struct GearFitPrimaryMeasurement
    {
        [SerializeField] private GearFitPrimaryMetric metric;
        [SerializeField] private string sourceDatumId;
        [SerializeField] private GearFitFrameAxis axis;
        [SerializeField] private float referenceValueMetres;
        [SerializeField] private GearFitValueProvenance provenance;
        [SerializeField] private string provenanceNote;

        public GearFitPrimaryMetric Metric => metric;

        /// <summary>The FunctionalFit datum this measurement is read from.</summary>
        public string SourceDatumId => sourceDatumId;

        public GearFitFrameAxis Axis => axis;

        /// <summary>Target size in metres an imported asset is uniformly scaled to match.</summary>
        public float ReferenceValueMetres => referenceValueMetres;

        public GearFitValueProvenance Provenance => provenance;
        public string ProvenanceNote => provenanceNote;

        public GearFitPrimaryMeasurement(
            GearFitPrimaryMetric primaryMetric,
            string datumId,
            GearFitFrameAxis measurementAxis,
            float referenceValue,
            GearFitValueProvenance valueProvenance,
            string note)
        {
            metric = primaryMetric;
            sourceDatumId = datumId;
            axis = measurementAxis;
            referenceValueMetres = referenceValue;
            provenance = valueProvenance;
            provenanceNote = note ?? string.Empty;
        }

        /// <summary>
        /// The uniform scale that takes a raw asset measurement to the slot reference. Uniform by
        /// construction: one scalar out, never a per-axis vector.
        /// </summary>
        public bool TryGetUniformScale(float rawMeasuredMetres, out float uniformScale)
        {
            uniformScale = 0f;
            if (float.IsNaN(rawMeasuredMetres) || float.IsInfinity(rawMeasuredMetres) || rawMeasuredMetres <= 0f)
                return false;
            if (referenceValueMetres <= 0f) return false;
            uniformScale = referenceValueMetres / rawMeasuredMetres;
            return true;
        }

        public bool TryValidate(out string error)
        {
            if (metric == GearFitPrimaryMetric.Unclassified)
                return Fail("primary normalization metric is unclassified", out error);
            if (string.IsNullOrEmpty(sourceDatumId))
                return Fail("primary normalization names no source datum", out error);
            if (float.IsNaN(referenceValueMetres) || float.IsInfinity(referenceValueMetres) ||
                referenceValueMetres <= 0f)
                return Fail("primary normalization reference is zero, negative or not finite", out error);
            if (provenance == GearFitValueProvenance.Unclassified)
                return Fail("primary normalization provenance is unclassified", out error);
            if (string.IsNullOrEmpty(provenanceNote))
                return Fail("primary normalization provenance note is empty", out error);

            error = string.Empty;
            return true;
        }

        private static bool Fail(string message, out string error)
        {
            error = message;
            return false;
        }
    }

    /// <summary>
    /// A ratio band an asset silhouette must fall inside AFTER uniform normalization.
    ///
    /// Production principle: UNIFORM SCALE FIRST. When a ratio falls outside the accepted band the
    /// verdict is Warn or Reject and the asset goes back for correction. There is deliberately no
    /// per-axis correction factor on this struct, because emitting one is how the Silverguard vertical
    /// squash happened.
    /// </summary>
    [Serializable]
    public struct GearFitProportionCheck
    {
        [SerializeField] private string checkId;
        [SerializeField] private GearFitFrameAxis numeratorAxis;
        [SerializeField] private GearFitFrameAxis denominatorAxis;
        [SerializeField] private float rejectBelow;
        [SerializeField] private float warnBelow;
        [SerializeField] private float warnAbove;
        [SerializeField] private float rejectAbove;
        [SerializeField] private GearFitValueProvenance provenance;
        [SerializeField] private string provenanceNote;

        public string CheckId => checkId;
        public GearFitFrameAxis NumeratorAxis => numeratorAxis;
        public GearFitFrameAxis DenominatorAxis => denominatorAxis;
        public float RejectBelow => rejectBelow;
        public float WarnBelow => warnBelow;
        public float WarnAbove => warnAbove;
        public float RejectAbove => rejectAbove;
        public GearFitValueProvenance Provenance => provenance;
        public string ProvenanceNote => provenanceNote;

        public GearFitProportionCheck(
            string id,
            GearFitFrameAxis numerator,
            GearFitFrameAxis denominator,
            float rejectLow,
            float warnLow,
            float warnHigh,
            float rejectHigh,
            GearFitValueProvenance valueProvenance,
            string note)
        {
            checkId = id;
            numeratorAxis = numerator;
            denominatorAxis = denominator;
            rejectBelow = rejectLow;
            warnBelow = warnLow;
            warnAbove = warnHigh;
            rejectAbove = rejectHigh;
            provenance = valueProvenance;
            provenanceNote = note ?? string.Empty;
        }

        /// <summary>
        /// Judge a candidate silhouette. <paramref name="sizeInFrame"/> is the asset bounding size
        /// expressed along the canonical frame axes, in metres.
        /// </summary>
        public GearFitProportionVerdict Evaluate(Vector3 sizeInFrame, out float ratio)
        {
            var numerator = GearFitFrame.Component(sizeInFrame, numeratorAxis);
            var denominator = GearFitFrame.Component(sizeInFrame, denominatorAxis);
            if (denominator <= 0f || float.IsNaN(denominator) || float.IsInfinity(denominator) ||
                numerator <= 0f || float.IsNaN(numerator) || float.IsInfinity(numerator))
            {
                ratio = 0f;
                return GearFitProportionVerdict.Reject;
            }

            ratio = numerator / denominator;
            if (ratio < rejectBelow || ratio > rejectAbove) return GearFitProportionVerdict.Reject;
            if (ratio < warnBelow || ratio > warnAbove) return GearFitProportionVerdict.Warn;
            return GearFitProportionVerdict.Pass;
        }

        public bool TryValidate(out string error)
        {
            if (string.IsNullOrEmpty(checkId)) return Fail("a proportion check has an empty id", out error);
            if (numeratorAxis == denominatorAxis)
                return Fail(checkId + ": numerator and denominator axes are the same", out error);
            if (provenance == GearFitValueProvenance.Unclassified)
                return Fail(checkId + ": provenance is unclassified", out error);
            if (string.IsNullOrEmpty(provenanceNote))
                return Fail(checkId + ": provenance note is empty", out error);

            foreach (var bound in new[] { rejectBelow, warnBelow, warnAbove, rejectAbove })
            {
                if (float.IsNaN(bound) || float.IsInfinity(bound) || bound <= 0f)
                    return Fail(checkId + ": a ratio bound is zero, negative or not finite", out error);
            }

            if (!(rejectBelow <= warnBelow && warnBelow <= warnAbove && warnAbove <= rejectAbove))
                return Fail(checkId + ": ratio bounds are not ordered reject/warn/warn/reject", out error);

            error = string.Empty;
            return true;
        }

        private static bool Fail(string message, out string error)
        {
            error = message;
            return false;
        }
    }
}
