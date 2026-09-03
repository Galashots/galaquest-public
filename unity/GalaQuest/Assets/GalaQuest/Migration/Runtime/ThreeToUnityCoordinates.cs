using UnityEngine;

namespace GalaQuest.Migration
{
    /// <summary>
    /// The single Three.js/glTF to Unity coordinate conversion seam.
    /// Three.js/glTF is right-handed, Y-up, and looks down -Z. Unity is left-handed,
    /// Y-up, and looks down +Z. Reflecting Z gives the position/vector mapping; the
    /// equivalent quaternion mapping is (x, y, -z, -w). Both systems use metres here.
    /// </summary>
    public static class ThreeToUnityCoordinates
    {
        public static Vector3 ConvertPosition(Vector3 threePosition)
        {
            return new Vector3(threePosition.x, threePosition.y, -threePosition.z);
        }

        public static Vector3 ConvertVector(Vector3 threeVector)
        {
            return ConvertPosition(threeVector);
        }

        public static Vector3 ConvertScale(Vector3 threeScale)
        {
            return threeScale;
        }

        public static Quaternion ConvertRotation(Quaternion threeRotation)
        {
            return new Quaternion(
                threeRotation.x,
                threeRotation.y,
                -threeRotation.z,
                -threeRotation.w).normalized;
        }
    }
}
