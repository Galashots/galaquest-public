using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>
    /// A named attachment point authored as an ordinary Transform under the GQ_HERO_V1 hierarchy.
    ///
    /// A socket answers WHERE a category of gear attaches. It deliberately carries no per-item data:
    /// item placement lives in <see cref="GearItemDefinition"/> so that a new item is new DATA rather
    /// than new code. Adding a socket is authoring a child GameObject and typing an id -- it is not a
    /// C# change either.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class GearSocket : MonoBehaviour
    {
        [Tooltip("Stable identifier referenced by GearItemDefinition.socketId, e.g. 'head'.")]
        [SerializeField] private string socketId = string.Empty;

        [Tooltip("Bone this socket is parented to. Recorded for validation and review evidence only.")]
        [SerializeField] private string boneName = string.Empty;

        public string SocketId => socketId;
        public string BoneName => boneName;

        public void Configure(string id, string bone)
        {
            socketId = id;
            boneName = bone;
        }
    }
}
