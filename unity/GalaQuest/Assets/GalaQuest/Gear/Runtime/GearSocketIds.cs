namespace GalaQuest.Gear
{
    /// <summary>
    /// The socket ids authored on GQ_HERO_V1 for this package, and the GQ_HERO_V1 bones they hang from.
    ///
    /// These are conveniences for tests and tooling, not a closed set: <see cref="GearSocket"/> stores a
    /// free string, so a future socket is authored in the prefab without editing this file.
    ///
    /// Bone choices mirror the shipped Three.js mounts in public/src/character/gear.js so that a Unity
    /// fit and a Three.js fit describe the same physical attachment.
    /// </summary>
    public static class GearSocketIds
    {
        public const string Head = "head";
        public const string RightHand = "rightHand";
        public const string LeftHand = "leftHand";
        public const string LeftShoulder = "leftShoulder";
        public const string RightShoulder = "rightShoulder";

        public const string HeadBone = "Head";
        public const string RightHandBone = "RightHand";
        public const string LeftHandBone = "LeftHand";
        public const string LeftShoulderBone = "LeftArm";
        public const string RightShoulderBone = "RightArm";

        /// <summary>Rig helper joints the Head Fit Proxy is measured from.</summary>
        public const string CrownHelperBone = "head_end";
        public const string FaceHelperBone = "headfront";

        public static readonly (string SocketId, string BoneName)[] Authored =
        {
            (Head, HeadBone),
            (RightHand, RightHandBone),
            (LeftHand, LeftHandBone),
            (LeftShoulder, LeftShoulderBone),
            (RightShoulder, RightShoulderBone),
        };
    }
}
