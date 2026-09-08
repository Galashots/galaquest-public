using UnityEngine;

namespace GalaQuest
{
    public static class GalaQuestDestinationMovementWorld
    {
        // Mirrors homeHub.js. The hub has no obstacles inside this open rectangle.
        public static Vector2 ResolvePosition(string destinationId, Vector2 position) =>
            destinationId == GalaQuestProtocolV4.HomeHubDestinationId
                ? new Vector2(Mathf.Clamp(position.x, -9, 9), Mathf.Clamp(position.y, -7, 9))
                : GalaQuestEmberworksMovementWorld.ResolvePosition(position);

        public static Vector2 Move(string destinationId, Vector2 from, Vector2 to) =>
            destinationId == GalaQuestProtocolV4.HomeHubDestinationId
                ? ResolvePosition(destinationId, to)
                : GalaQuestEmberworksMovementWorld.Move(from, to);
    }
}
