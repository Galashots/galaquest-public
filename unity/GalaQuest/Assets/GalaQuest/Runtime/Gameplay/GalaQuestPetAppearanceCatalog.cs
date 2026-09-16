using UnityEngine;

namespace GalaQuest
{
    // Explicit scene references, not an asset-loader or ownership registry. Unassigned
    // references preserve the existing temporary bodies until art is promoted.
    public sealed class GalaQuestPetAppearanceCatalog : MonoBehaviour
    {
        [SerializeField] private GameObject greenWorm;
        [SerializeField] private GameObject redWorm;

        public void Configure(GameObject green, GameObject red)
        { greenWorm = green; redWorm = red; }

        public GameObject Create(string objectName, string petId, Vector3 position, Quaternion rotation)
        {
            var prefab = petId == "worm_green" ? greenWorm : petId == "worm_red" ? redWorm : null;
            if (prefab == null) return null;
            var body = Instantiate(prefab, Floor(position), rotation);
            body.name = objectName;
            return body;
        }

        // Authored worm prefabs have a floor pivot. The legacy sphere's center
        // clearance is deliberately not part of this representation.
        public static Vector3 Floor(Vector3 position) =>
            GalaQuestGroundSurface.Project(new Vector3(position.x, 0, position.z), 0);
    }
}
