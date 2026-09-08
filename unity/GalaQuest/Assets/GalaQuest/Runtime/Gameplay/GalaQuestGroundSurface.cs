using UnityEngine;

namespace GalaQuest
{
    // Explicitly marked walkable art surfaces affect presentation height only.
    // The authoritative movement and collision law remains planar.
    [RequireComponent(typeof(Collider))]
    public sealed class GalaQuestGroundSurface : MonoBehaviour
    {
        private static readonly RaycastHit[] Hits = new RaycastHit[24];

        public static Vector3 Project(Vector3 position, float clearance)
        {
            var count = Physics.RaycastNonAlloc(position + Vector3.up * 2f, Vector3.down,
                Hits, 4f, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore);
            var nearest = float.PositiveInfinity;
            for (var i = 0; i < count; i++)
            {
                var hit = Hits[i];
                if (hit.normal.y < .9f || hit.distance >= nearest
                    || hit.collider.GetComponent<GalaQuestGroundSurface>() == null) continue;
                nearest = hit.distance;
                position.y = hit.point.y + clearance;
            }
            return position;
        }
    }
}
