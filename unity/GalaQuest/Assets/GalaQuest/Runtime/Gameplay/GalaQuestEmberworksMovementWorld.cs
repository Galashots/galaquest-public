using UnityEngine;

namespace GalaQuest
{
    public static class GalaQuestEmberworksMovementWorld
    {
        public const float SpawnX = 0f;
        public const float SpawnZ = 4f;
        public static readonly Vector2 Spawn = new Vector2(SpawnX, SpawnZ);
        public const float MinX = -10f;
        public const float MaxX = 10f;
        public const float MinZ = 3f;
        public const float MaxZ = 22f;
        public const float HeroClearance = 0.35f;

        // Measured upright collider bounds. Node parity and actual-scene tests guard this seam.
        public static readonly SolidRectangle[] Solids = {
            new SolidRectangle("GatePillarLeft", -8.25f, -5.75f, 1.75f, 4.25f),
            new SolidRectangle("GatePillarRight", 5.75f, 8.25f, 1.75f, 4.25f),
            new SolidRectangle("ImmediateActionCavernBack", -15f, 1f, 18.9f, 20.1f),
            new SolidRectangle("ImmediateActionCavernWingL", -14.7f, -13.3f, 12.5f, 19.5f),
            new SolidRectangle("ImmediateActionCavernWingR", -0.7f, 0.7f, 12.5f, 19.5f),
        };

        public static Vector2 Clamp(Vector2 position) => new Vector2(
            Mathf.Clamp(position.x, MinX, MaxX),
            Mathf.Clamp(position.y, MinZ, MaxZ));

        public static Vector2 ResolvePosition(Vector2 position)
        {
            var p = Clamp(position);
            for (var pass = 0; pass < 4; pass++)
            {
                var changed = false;
                foreach (var solid in Solids)
                {
                    var r = solid.Expanded(HeroClearance);
                    if (!(p.x > r.MinX && p.x < r.MaxX && p.y > r.MinZ && p.y < r.MaxZ)) continue;
                    var distance = p.x - r.MinX;
                    var side = 0;
                    if (r.MaxX - p.x < distance) { distance = r.MaxX - p.x; side = 1; }
                    if (p.y - r.MinZ < distance) { distance = p.y - r.MinZ; side = 2; }
                    if (r.MaxZ - p.y < distance) side = 3;
                    if (side == 0) p.x = r.MinX;
                    else if (side == 1) p.x = r.MaxX;
                    else if (side == 2) p.y = r.MinZ;
                    else p.y = r.MaxZ;
                    changed = true;
                }
                if (!changed) break;
            }
            return p;
        }

        // Sweep the full displacement, then spend its remaining tangent component sliding.
        public static Vector2 Move(Vector2 from, Vector2 to)
        {
            var p = ResolvePosition(from);
            var delta = to - from;
            for (var contact = 0; contact < 3 && delta.sqrMagnitude > 0f; contact++)
            {
                var found = false;
                var first = new Contact();
                foreach (var solid in Solids)
                {
                    if (!Sweep(p, delta, solid.Expanded(HeroClearance), out var hit)) continue;
                    if (!found || hit.Time < first.Time) { first = hit; found = true; }
                }
                if (!found) { p += delta; break; }
                p += delta * first.Time;
                if (first.BlockX) p.x = first.FaceX;
                if (first.BlockZ) p.y = first.FaceZ;
                delta = new Vector2(first.BlockX ? 0f : delta.x * (1f - first.Time),
                    first.BlockZ ? 0f : delta.y * (1f - first.Time));
            }
            return ResolvePosition(p);
        }

        private static bool Sweep(Vector2 p, Vector2 d, SolidRectangle r, out Contact hit)
        {
            hit = new Contact();
            if (d.x == 0f && (p.x <= r.MinX || p.x >= r.MaxX)) return false;
            if (d.y == 0f && (p.y <= r.MinZ || p.y >= r.MaxZ)) return false;
            var x1 = d.x == 0f ? float.NegativeInfinity : ((d.x > 0f ? r.MinX : r.MaxX) - p.x) / d.x;
            var x2 = d.x == 0f ? float.PositiveInfinity : ((d.x > 0f ? r.MaxX : r.MinX) - p.x) / d.x;
            var z1 = d.y == 0f ? float.NegativeInfinity : ((d.y > 0f ? r.MinZ : r.MaxZ) - p.y) / d.y;
            var z2 = d.y == 0f ? float.PositiveInfinity : ((d.y > 0f ? r.MaxZ : r.MinZ) - p.y) / d.y;
            var time = Mathf.Max(x1, z1);
            if (time < 0f || time > 1f || Mathf.Min(x2, z2) <= time) return false;
            hit = new Contact { Time = time, BlockX = x1 >= z1, BlockZ = z1 >= x1,
                FaceX = d.x > 0f ? r.MinX : r.MaxX, FaceZ = d.y > 0f ? r.MinZ : r.MaxZ };
            return true;
        }

        private struct Contact
        {
            public float Time, FaceX, FaceZ;
            public bool BlockX, BlockZ;
        }

        public readonly struct SolidRectangle
        {
            public readonly string Name;
            public readonly float MinX, MaxX, MinZ, MaxZ;
            public SolidRectangle(string name, float minX, float maxX, float minZ, float maxZ)
            { Name = name; MinX = minX; MaxX = maxX; MinZ = minZ; MaxZ = maxZ; }
            public SolidRectangle Expanded(float clearance) => new SolidRectangle(Name,
                MinX - clearance, MaxX + clearance, MinZ - clearance, MaxZ + clearance);
        }
    }
}
