using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>
    /// Links a mounted gear instance back to the definition it came from, so tooling and tests can find
    /// what is on the Hero without guessing from object names.
    ///
    /// It carries no fit data of its own: the asset is the authority, the scene object is a manipulable
    /// view of it.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class GearMountedItem : MonoBehaviour
    {
        [SerializeField] private GearItemDefinition definition;

        public GearItemDefinition Definition => definition;

        public void Configure(GearItemDefinition item) => definition = item;
    }
}
