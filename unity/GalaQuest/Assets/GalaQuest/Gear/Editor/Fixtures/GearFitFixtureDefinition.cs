using System;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    public enum GearFitFixtureSlot
    {
        Helmet,
        Shoulder,
        Chest,
        Bracer,
        Shield,
    }

    public enum GearFitFixtureLandmarkKind
    {
        KeepClear,
        CollisionWarning,
        ReferenceZone,
    }

    [Serializable]
    public struct GearFitFixtureLandmark
    {
        [SerializeField] private string label;
        [SerializeField] private GearFitFixtureLandmarkKind kind;
        [SerializeField] private Vector3 localCenter;
        [SerializeField] private Vector3 localSize;

        public string Label => label;
        public GearFitFixtureLandmarkKind Kind => kind;
        public Vector3 LocalCenter => localCenter;
        public Vector3 LocalSize => localSize;

        public GearFitFixtureLandmark(
            string name,
            GearFitFixtureLandmarkKind landmarkKind,
            Vector3 center,
            Vector3 size)
        {
            label = name;
            kind = landmarkKind;
            localCenter = center;
            localSize = size;
        }
    }

    /// <summary>
    /// Small, deliberately approximate reference data for fitting one rigid gear slot on GQ_HERO_V1.
    /// It is an editor calibration aid, not an equipment contract or a collision solver.
    /// </summary>
    [CreateAssetMenu(
        fileName = "GearFitFixture",
        menuName = "GalaQuest/Gear/Fit Fixture",
        order = 2)]
    public sealed class GearFitFixtureDefinition : ScriptableObject
    {
        [SerializeField] private GearFitFixtureSlot slot;
        [SerializeField] private string displayName = string.Empty;
        [SerializeField] private string anchorBone = string.Empty;
        [SerializeField] private string mirroredAnchorBone = string.Empty;
        [SerializeField] private Vector3 anchorOffset;
        [SerializeField] private Vector3 forwardAxis = Vector3.forward;
        [SerializeField] private Vector3 upAxis = Vector3.up;
        [SerializeField] private Vector3 outAxis = Vector3.right;
        [SerializeField] private Vector3 innerClearanceCenter;
        [SerializeField] private Vector3 innerClearanceSize = Vector3.one;
        [SerializeField] private GearFitFixtureLandmark[] landmarks = Array.Empty<GearFitFixtureLandmark>();
        [SerializeField] private AnatomyRegion[] anatomyHideIntent = Array.Empty<AnatomyRegion>();

        public GearFitFixtureSlot Slot => slot;
        public string DisplayName => displayName;
        public string AnchorBone => anchorBone;
        public string MirroredAnchorBone => mirroredAnchorBone;
        public Vector3 AnchorOffset => anchorOffset;
        public Vector3 ForwardAxis => forwardAxis;
        public Vector3 UpAxis => upAxis;
        public Vector3 OutAxis => outAxis;
        public Vector3 InnerClearanceCenter => innerClearanceCenter;
        public Vector3 InnerClearanceSize => innerClearanceSize;
        public GearFitFixtureLandmark[] Landmarks => landmarks ?? Array.Empty<GearFitFixtureLandmark>();
        public AnatomyRegion[] AnatomyHideIntent => anatomyHideIntent ?? Array.Empty<AnatomyRegion>();

        public void Configure(
            GearFitFixtureSlot fixtureSlot,
            string name,
            string bone,
            string mirroredBone,
            Vector3 offset,
            Vector3 forward,
            Vector3 up,
            Vector3 outward,
            Vector3 clearanceCenter,
            Vector3 clearanceSize,
            GearFitFixtureLandmark[] fixtureLandmarks,
            AnatomyRegion[] hideIntent)
        {
            slot = fixtureSlot;
            displayName = name;
            anchorBone = bone;
            mirroredAnchorBone = mirroredBone;
            anchorOffset = offset;
            forwardAxis = forward.normalized;
            upAxis = up.normalized;
            outAxis = outward.normalized;
            innerClearanceCenter = clearanceCenter;
            innerClearanceSize = clearanceSize;
            landmarks = fixtureLandmarks ?? Array.Empty<GearFitFixtureLandmark>();
            anatomyHideIntent = hideIntent ?? Array.Empty<AnatomyRegion>();
        }
    }
}
