using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>
    /// Everything that makes one rigid gear item different from another, as an ordinary Unity asset.
    ///
    /// This is the load-bearing claim of the Checkpoint A architecture: a new helmet or shield is a new
    /// instance of THIS asset plus a visual fit. No new MonoBehaviour, no new mounting branch, no new
    /// fit harness. <see cref="GearMounter"/> consumes this and nothing item-specific.
    ///
    /// Transform fields are the item's local placement RELATIVE TO ITS SOCKET, authored with the normal
    /// Unity move/rotate/scale gizmos in the Gear Workbench and saved back here. They are not derived
    /// quaternions and are not intended to be hand-edited as numbers.
    /// </summary>
    [CreateAssetMenu(
        fileName = "GearItem",
        menuName = "GalaQuest/Gear/Gear Item Definition",
        order = 0)]
    public sealed class GearItemDefinition : ScriptableObject
    {
        [Header("Identity")]
        [Tooltip("Stable GalaQuest semantic id, e.g. 'gear.helmet.silverguard'. Never a Unity GUID.")]
        [SerializeField] private string semanticId = string.Empty;

        [Tooltip("Player-facing name used in the workbench and review evidence.")]
        [SerializeField] private string displayName = string.Empty;

        [Header("Source art")]
        [Tooltip("Imported model asset for this item. Referenced, never copied.")]
        [SerializeField] private GameObject sourceModel;

        [Header("Attachment")]
        [Tooltip("GearSocket.SocketId this item mounts to, e.g. 'head'.")]
        [SerializeField] private string socketId = string.Empty;

        [Tooltip("Which shared validation rules apply to this item.")]
        [SerializeField] private GearFitClass fitClass = GearFitClass.RigidGeneric;

        [Header("Fit (socket-local, authored with Scene View gizmos)")]
        [SerializeField] private Vector3 localPosition = Vector3.zero;
        [SerializeField] private Vector3 localEulerAngles = Vector3.zero;
        [SerializeField] private Vector3 localScale = Vector3.one;

        [Tooltip("Mirror this item across its socket's X axis. Lets one mesh serve a symmetric pair " +
                 "(the Silverguard shoulders ship as one mesh worn twice) without a second asset.")]
        [SerializeField] private bool mirrorX;

        [Header("Anatomy coverage")]
        [Tooltip("Anatomy this item covers. Covered anatomy may be intersected or hidden, so the item " +
                 "is never pushed outward to wrap it.")]
        [SerializeField] private AnatomyRegion[] hidesAnatomy = new AnatomyRegion[0];

        [Header("Provenance")]
        [Tooltip("Repository path of the authoritative source art, for exact-SHA review evidence.")]
        [SerializeField] private string sourceRepoPath = string.Empty;

        public string SemanticId => semanticId;
        public string DisplayName => string.IsNullOrEmpty(displayName) ? name : displayName;
        public GameObject SourceModel => sourceModel;
        public string SocketId => socketId;
        public GearFitClass FitClass => fitClass;
        public Vector3 LocalPosition => localPosition;
        public Vector3 LocalEulerAngles => localEulerAngles;
        public Vector3 LocalScale => localScale;
        public bool MirrorX => mirrorX;
        public AnatomyRegion[] HidesAnatomy => hidesAnatomy;
        public string SourceRepoPath => sourceRepoPath;

        public Quaternion LocalRotation => Quaternion.Euler(localEulerAngles);

        /// <summary>Effective local scale, including the mirror flag.</summary>
        public Vector3 EffectiveLocalScale =>
            mirrorX ? new Vector3(-localScale.x, localScale.y, localScale.z) : localScale;

        public bool Covers(AnatomyRegion region)
        {
            if (hidesAnatomy == null) return false;
            for (var i = 0; i < hidesAnatomy.Length; i++)
                if (hidesAnatomy[i] == region) return true;
            return false;
        }

        /// <summary>Write a fit authored in the Scene View back into this asset.</summary>
        public void ApplyAuthoredFit(Vector3 position, Vector3 eulerAngles, Vector3 scale)
        {
            localPosition = position;
            localEulerAngles = eulerAngles;
            localScale = scale;
        }

        /// <summary>Editor/authoring seam used when a definition is generated rather than hand-made.</summary>
        public void Configure(
            string id,
            string display,
            GameObject model,
            string socket,
            GearFitClass gearFitClass,
            string repoPath,
            AnatomyRegion[] coverage)
        {
            semanticId = id;
            displayName = display;
            sourceModel = model;
            socketId = socket;
            fitClass = gearFitClass;
            sourceRepoPath = repoPath;
            hidesAnatomy = coverage ?? new AnatomyRegion[0];
        }

        public void SetMirrorX(bool value) => mirrorX = value;
    }
}
