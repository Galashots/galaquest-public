using System;
using System.Linq;
using UnityEngine;

namespace GalaQuest.Editor
{
    // Cheap geometric evidence, not human legibility or physical-device acceptance.
    public static class InteractionPreflight
    {
        public sealed class Result
        {
            public bool colliderActive;
            public bool insideFrame;
            public bool overlapsHud;
            public int hitRank;
            public string[] orderedHits;
            public Rect viewportBounds;
        }

        // HUD rectangles use bottom-left normalized viewport coordinates.
        // Report ordering rather than assuming that every closer collider blocks
        // a control: the gameplay handler owns its interaction filtering policy.
        public static Result Inspect(Camera camera, Collider control, params Rect[] hud)
        {
            if (camera == null || control == null) throw new ArgumentNullException("camera/control");
            Physics.SyncTransforms();
            var bounds = control.bounds;
            var corners = new Vector3[8];
            for (var i = 0; i < corners.Length; i++)
                corners[i] = camera.WorldToViewportPoint(bounds.center + Vector3.Scale(bounds.extents,
                    new Vector3((i & 1) == 0 ? -1 : 1, (i & 2) == 0 ? -1 : 1, (i & 4) == 0 ? -1 : 1)));
            var rect = Rect.MinMaxRect(corners.Min(p => p.x), corners.Min(p => p.y), corners.Max(p => p.x), corners.Max(p => p.y));
            var hits = Physics.RaycastAll(camera.ViewportPointToRay(camera.WorldToViewportPoint(bounds.center)),
                camera.farClipPlane, camera.cullingMask, QueryTriggerInteraction.Collide).OrderBy(hit => hit.distance).ToArray();
            return new Result
            {
                colliderActive = control.enabled && control.gameObject.activeInHierarchy,
                insideFrame = corners.All(p => p.z >= camera.nearClipPlane && p.z <= camera.farClipPlane)
                    && rect.xMin >= 0 && rect.yMin >= 0 && rect.xMax <= 1 && rect.yMax <= 1,
                overlapsHud = hud.Any(area => area.Overlaps(rect)),
                hitRank = Array.FindIndex(hits, hit => hit.collider == control),
                orderedHits = hits.Select(hit => hit.collider.name).ToArray(),
                viewportBounds = rect
            };
        }
    }
}
