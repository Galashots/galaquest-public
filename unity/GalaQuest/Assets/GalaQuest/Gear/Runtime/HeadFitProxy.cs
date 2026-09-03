using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>
    /// The clearance envelope a piece of GQ_HERO_V1 headgear must respect, stored in HEAD-BONE LOCAL
    /// space so it travels with the head through every animation pose.
    ///
    /// Derivation is deliberately split, because the two halves have different authorities:
    ///
    ///   MEASURED from GQ_HERO_V1 anatomy (see GearProxyDerivation):
    ///     - crown, from the rig's own `head_end` helper joint;
    ///     - faceAnchor, from the rig's own `headfront` helper joint;
    ///     - skullRadius, from the Head-bone-weighted vertices of the shipped Hero mesh.
    ///
    ///   AUTHORED, because the Hero's eyes are painted into the atlas and have no geometry to measure:
    ///     - eyeLine and eyeClearanceRadius.
    ///
    /// The proxy is NOT derived from the Silverguard helmet. Silverguard is corrected against this
    /// proxy, never the other way round.
    ///
    /// The proxy describes the FACE the helmet must leave readable, not the hairstyle it must wrap.
    /// Hair and ears are declared coverage (see AnatomyRegion) and may be intersected freely, so
    /// skullRadius is a seat reference rather than a hard keep-out shell.
    /// </summary>
    [CreateAssetMenu(
        fileName = "HeadFitProxy",
        menuName = "GalaQuest/Gear/Head Fit Proxy",
        order = 1)]
    public sealed class HeadFitProxy : ScriptableObject
    {
        [Header("Measured from GQ_HERO_V1 anatomy (head-bone local, metres)")]
        [SerializeField] private Vector3 crown = Vector3.zero;
        [SerializeField] private Vector3 faceAnchor = Vector3.zero;
        [SerializeField] private float skullRadius;

        [Header("Authored visual convention (head-bone local, metres)")]
        [Tooltip("Point on the face at the Hero's eye line. The Hero's eyes are texture, not geometry, " +
                 "so this is set by looking at the Hero in Unity -- it cannot be measured from the mesh.")]
        [SerializeField] private Vector3 eyeLine = Vector3.zero;

        [Tooltip("Radius around the eye line that headgear must leave unoccluded on the face side.")]
        [SerializeField] private float eyeClearanceRadius = 0.08f;

        [Header("Seat tolerance")]
        [Tooltip("How far above the crown an item's top may sit before it reads as floating.")]
        [SerializeField] private float maxCrownGap = 0.03f;

        [Header("Provenance")]
        [SerializeField] private string derivedFromHeroPath = string.Empty;
        [SerializeField] private string derivedFromHeroSha256 = string.Empty;
        [SerializeField] private string derivationNote = string.Empty;

        public Vector3 Crown => crown;
        public Vector3 FaceAnchor => faceAnchor;
        public float SkullRadius => skullRadius;
        public Vector3 EyeLine => eyeLine;
        public float EyeClearanceRadius => eyeClearanceRadius;
        public float MaxCrownGap => maxCrownGap;
        public string DerivedFromHeroPath => derivedFromHeroPath;
        public string DerivedFromHeroSha256 => derivedFromHeroSha256;
        public string DerivationNote => derivationNote;

        /// <summary>Head-local up axis: base of the head bone toward the crown helper.</summary>
        public Vector3 UpAxis => crown.sqrMagnitude > 1e-8f ? crown.normalized : Vector3.up;

        /// <summary>Head-local forward axis: toward the face helper.</summary>
        public Vector3 ForwardAxis => faceAnchor.sqrMagnitude > 1e-8f ? faceAnchor.normalized : Vector3.forward;

        /// <summary>Height of a head-local point along the head axis.</summary>
        public float HeightOf(Vector3 headLocalPoint) => Vector3.Dot(headLocalPoint, UpAxis);

        /// <summary>How far forward of the head axis a head-local point sits.</summary>
        public float ForwardOf(Vector3 headLocalPoint) => Vector3.Dot(headLocalPoint, ForwardAxis);

        public float CrownHeight => HeightOf(crown);
        public float EyeLineHeight => HeightOf(eyeLine);

        public void ConfigureMeasured(
            Vector3 measuredCrown,
            Vector3 measuredFaceAnchor,
            float measuredSkullRadius,
            string heroPath,
            string heroSha256,
            string note)
        {
            crown = measuredCrown;
            faceAnchor = measuredFaceAnchor;
            skullRadius = measuredSkullRadius;
            derivedFromHeroPath = heroPath;
            derivedFromHeroSha256 = heroSha256;
            derivationNote = note;
        }

        public void ConfigureAuthored(Vector3 authoredEyeLine, float clearanceRadius, float crownGap)
        {
            eyeLine = authoredEyeLine;
            eyeClearanceRadius = clearanceRadius;
            maxCrownGap = crownGap;
        }
    }
}
