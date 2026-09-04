using System;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>Where an asset's own fit cavity came from.</summary>
    public enum GearAssetCavitySource
    {
        Unclassified = 0,

        /// <summary>
        /// Read from explicit fit locator geometry the asset itself carries (see
        /// <see cref="GearAssetFitProbe.CavityLocatorName"/>). The artist declared the cavity; the
        /// contract measured what they declared. No mesh threshold or inner-surface guess is involved.
        /// </summary>
        MeasuredFromAssetLocator = 1,

        /// <summary>
        /// A virtual cavity a human entered because the source geometry exposes no reliable inner
        /// shell. Legitimate, and legitimately AUTHORED -- it is a stated intent, not a measurement.
        /// </summary>
        AuthoredVirtualCavity = 2,
    }

    /// <summary>A named point on the asset, in canonical asset space, metres.</summary>
    [Serializable]
    public struct GearAssetFitLandmark
    {
        [SerializeField] private string landmarkId;
        [SerializeField] private Vector3 positionInCanonical;
        [SerializeField] private GearFitValueProvenance provenance;
        [SerializeField] private string note;

        public string LandmarkId => landmarkId;
        public Vector3 PositionInCanonical => positionInCanonical;
        public GearFitValueProvenance Provenance => provenance;
        public string Note => note;

        public GearAssetFitLandmark(
            string id, Vector3 position, GearFitValueProvenance valueProvenance, string landmarkNote)
        {
            landmarkId = id;
            positionInCanonical = position;
            provenance = valueProvenance;
            note = landmarkNote ?? string.Empty;
        }

        public bool TryValidate(out string error)
        {
            if (string.IsNullOrEmpty(landmarkId)) return Fail("a landmark has an empty id", out error);
            if (provenance == GearFitValueProvenance.Unclassified)
                return Fail(landmarkId + ": provenance is unclassified", out error);
            if (float.IsNaN(positionInCanonical.x) || float.IsInfinity(positionInCanonical.x) ||
                float.IsNaN(positionInCanonical.y) || float.IsInfinity(positionInCanonical.y) ||
                float.IsNaN(positionInCanonical.z) || float.IsInfinity(positionInCanonical.z))
                return Fail(landmarkId + ": position is not finite", out error);

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
    /// The ASSET side of the fit contract: the negative space a piece of gear intends to WEAR, as
    /// opposed to the space its rendered geometry occupies.
    ///
    /// This exists because the Hero fixture states a required fit cavity, and comparing that to an
    /// asset's outer mesh bounds compares two different quantities. A helmet's outer width includes
    /// its shell thickness, its rivets and its crest; none of that has anything to do with whether the
    /// head fits inside it. Normalizing on outer bounds makes a thicker or more decorated helmet scale
    /// down, which is exactly backwards.
    ///
    /// So: the primary fit measurement is taken from THIS, and render bounds are kept only for
    /// silhouette ratios and absurd-size warnings.
    ///
    /// This is reusable DATA. Registering another helmet means another instance of this asset, not
    /// another branch of C#.
    /// </summary>
    [CreateAssetMenu(
        fileName = "GearAssetFitProfile",
        menuName = "GalaQuest/Gear/Asset Fit Profile",
        order = 4)]
    public sealed class GearAssetFitProfile : ScriptableObject
    {
        [Header("Identity")]
        [Tooltip("Stable GalaQuest semantic id of the asset this profile describes.")]
        [SerializeField] private string semanticAssetId = string.Empty;

        [SerializeField] private GearFitFixtureSlot slot;

        [Header("Raw to canonical")]
        [Tooltip("Rotation taking the asset's raw imported axes into canonical wearer axes. The cavity " +
                 "below is expressed AFTER this rotation.")]
        [SerializeField] private Vector3 rawToCanonicalEuler;

        [Header("Intended fit cavity (canonical asset space, metres)")]
        [SerializeField] private GearAssetCavitySource cavitySource;
        [SerializeField] private Vector3 cavityCenterInCanonical;
        [SerializeField] private Vector3 cavitySizeInCanonical;
        [SerializeField] private GearFitValueProvenance cavityProvenance;
        [SerializeField] private string cavityNote = string.Empty;

        [Header("Functional landmarks (canonical asset space, metres)")]
        [SerializeField] private GearAssetFitLandmark[] landmarks = Array.Empty<GearAssetFitLandmark>();

        public string SemanticAssetId => semanticAssetId;
        public GearFitFixtureSlot Slot => slot;
        public Vector3 RawToCanonicalEuler => rawToCanonicalEuler;
        public Quaternion RawToCanonicalRotation => Quaternion.Euler(rawToCanonicalEuler);
        public GearAssetCavitySource CavitySource => cavitySource;
        public Vector3 CavityCenterInCanonical => cavityCenterInCanonical;
        public Vector3 CavitySizeInCanonical => cavitySizeInCanonical;
        public GearFitValueProvenance CavityProvenance => cavityProvenance;
        public string CavityNote => cavityNote;
        public GearAssetFitLandmark[] Landmarks => landmarks ?? Array.Empty<GearAssetFitLandmark>();

        /// <summary>Does this profile carry a cavity that may drive normalization?</summary>
        public bool HasUsableCavity =>
            cavitySource != GearAssetCavitySource.Unclassified &&
            cavityProvenance != GearFitValueProvenance.Unclassified &&
            IsPositive(cavitySizeInCanonical);

        /// <summary>The asset's own intended fit span along one canonical axis.</summary>
        public float CavitySpan(GearFitFrameAxis axis)
        {
            return GearFitFrame.Component(cavitySizeInCanonical, axis);
        }

        public void Configure(
            string assetId,
            GearFitFixtureSlot fixtureSlot,
            Vector3 rawRotation,
            GearAssetCavitySource source,
            Vector3 cavityCenter,
            Vector3 cavitySize,
            GearFitValueProvenance provenance,
            string note,
            GearAssetFitLandmark[] fitLandmarks)
        {
            semanticAssetId = assetId;
            slot = fixtureSlot;
            rawToCanonicalEuler = rawRotation;
            cavitySource = source;
            cavityCenterInCanonical = cavityCenter;
            cavitySizeInCanonical = cavitySize;
            cavityProvenance = provenance;
            cavityNote = note ?? string.Empty;
            landmarks = fitLandmarks ?? Array.Empty<GearAssetFitLandmark>();
        }

        public bool TryGetLandmark(string landmarkId, out GearAssetFitLandmark landmark)
        {
            foreach (var candidate in Landmarks)
            {
                if (candidate.LandmarkId != landmarkId) continue;
                landmark = candidate;
                return true;
            }

            landmark = default(GearAssetFitLandmark);
            return false;
        }

        public bool TryValidate(out string error)
        {
            if (string.IsNullOrEmpty(semanticAssetId))
                return Fail("semantic asset id is empty", out error);
            if (cavitySource == GearAssetCavitySource.Unclassified)
                return Fail(semanticAssetId + ": cavity source is unclassified", out error);
            if (cavityProvenance == GearFitValueProvenance.Unclassified)
                return Fail(semanticAssetId + ": cavity provenance is unclassified", out error);
            if (!IsPositive(cavitySizeInCanonical))
                return Fail(semanticAssetId + ": cavity size is zero, negative or not finite", out error);
            if (string.IsNullOrEmpty(cavityNote))
                return Fail(semanticAssetId + ": cavity note is empty", out error);

            // The two sources map to exactly one provenance each. A virtual cavity that calls itself
            // MEASURED would be the whole defect this class exists to prevent, wearing a new hat.
            if (cavitySource == GearAssetCavitySource.MeasuredFromAssetLocator &&
                cavityProvenance != GearFitValueProvenance.Measured)
                return Fail(semanticAssetId + ": a cavity read from asset locator geometry must be " +
                            "MEASURED, not " + cavityProvenance, out error);
            if (cavitySource == GearAssetCavitySource.AuthoredVirtualCavity &&
                cavityProvenance != GearFitValueProvenance.Authored)
                return Fail(semanticAssetId + ": a virtual cavity must be AUTHORED, not " +
                            cavityProvenance, out error);

            foreach (var landmark in Landmarks)
            {
                if (!landmark.TryValidate(out var landmarkError))
                    return Fail(semanticAssetId + ": " + landmarkError, out error);
            }

            error = string.Empty;
            return true;
        }

        private static bool IsPositive(Vector3 value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x) && value.x > 0f &&
                   !float.IsNaN(value.y) && !float.IsInfinity(value.y) && value.y > 0f &&
                   !float.IsNaN(value.z) && !float.IsInfinity(value.z) && value.z > 0f;
        }

        private static bool Fail(string message, out string error)
        {
            error = message;
            return false;
        }
    }
}
