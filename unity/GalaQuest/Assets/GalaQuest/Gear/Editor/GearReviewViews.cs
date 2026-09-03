using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// The fixed inspection framings shared by the workbench camera buttons and the review-pack capture,
    /// so what the Owner looked at while fitting is the same framing the evidence shows.
    ///
    /// Front / three-quarter / side are the head-readability angles the open-face convention is judged
    /// from. Gameplay is the whole-Hero framing that decides whether a piece reads at play distance.
    /// </summary>
    public static class GearReviewViews
    {
        public enum View
        {
            Front = 0,
            ThreeQuarter = 1,
            Side = 2,
            Gameplay = 3,
        }

        public static readonly View[] All =
        {
            View.Front,
            View.ThreeQuarter,
            View.Side,
            View.Gameplay,
        };

        public static string NameFor(View view)
        {
            switch (view)
            {
                case View.Front: return "front";
                case View.ThreeQuarter: return "three-quarter";
                case View.Side: return "side";
                case View.Gameplay: return "gameplay";
                default: return view.ToString().ToLowerInvariant();
            }
        }

        /// <summary>Scene View rotation looking at the Hero from each angle.</summary>
        public static Quaternion RotationFor(View view)
        {
            switch (view)
            {
                case View.Front: return Quaternion.Euler(0f, 180f, 0f);
                case View.ThreeQuarter: return Quaternion.Euler(8f, 215f, 0f);
                case View.Side: return Quaternion.Euler(0f, 270f, 0f);
                case View.Gameplay: return Quaternion.Euler(18f, 200f, 0f);
                default: return Quaternion.identity;
            }
        }

        /// <summary>Scene View orbit size: tight on the head, wide for gameplay framing.</summary>
        public static float SizeFor(View view)
        {
            return view == View.Gameplay ? 1.6f : 0.42f;
        }

        /// <summary>Camera distance used by the review-pack capture for the same framing.</summary>
        public static float DistanceFor(View view)
        {
            return view == View.Gameplay ? 3.6f : 0.95f;
        }

        public static float FieldOfViewFor(View view)
        {
            return view == View.Gameplay ? 45f : 30f;
        }
    }
}
