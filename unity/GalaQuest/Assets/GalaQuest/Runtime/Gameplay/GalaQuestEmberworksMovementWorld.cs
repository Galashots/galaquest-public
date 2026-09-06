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

        public static Vector2 Clamp(Vector2 position) => new Vector2(
            Mathf.Clamp(position.x, MinX, MaxX),
            Mathf.Clamp(position.y, MinZ, MaxZ));
    }
}
