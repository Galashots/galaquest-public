using UnityEngine;

namespace GalaQuest
{
    /// <summary>
    /// The one Unity/server coordinate boundary. Emberworks was authored directly in Unity, so its
    /// planar server x/z convention is deliberately identical to Unity world x/z.
    /// </summary>
    public static class GalaQuestServerCoordinates
    {
        public static Vector3 ToUnityPosition(Vector2 serverPosition, float unityY) =>
            new Vector3(serverPosition.x, unityY, serverPosition.y);

        public static Vector2 ToServerPosition(Vector3 unityPosition) =>
            new Vector2(unityPosition.x, unityPosition.z);

        public static Quaternion ToUnityHeading(float serverHeadingRadians) =>
            Quaternion.Euler(0f, serverHeadingRadians * Mathf.Rad2Deg, 0f);

        public static float ToServerHeading(Quaternion unityRotation)
        {
            var forward = unityRotation * Vector3.forward;
            return Mathf.Atan2(forward.x, forward.z);
        }
    }
}
