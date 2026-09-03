using System.Collections.Generic;
using GalaQuest.Gear;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Suggests a starting fit for headgear from the Head Fit Proxy.
    ///
    /// This is a STARTING POINT, not an auto-fitter. It does the part that is arithmetic -- size the
    /// piece to the skull, seat it on the head, and raise it until it stops covering the eye line --
    /// and then hands the result to the Owner to judge and adjust with the normal gizmos. Nothing here
    /// visually accepts anything.
    ///
    /// It exists because the alternative is what this project did before: derive a transform in a
    /// headless harness, bake it, and discover in the running game that the piece sits wrong
    /// (public/src/character/gear.js, the Wildwood Blade and the twice-rejected sword).
    /// </summary>
    public static class GearAutoSeat
    {
        /// <summary>How much wider than the skull a helmet shell sits. Slightly proud, not a bucket.</summary>
        public const float HelmetWidthFactor = 1.12f;

        /// <summary>Step used when lifting a helmet clear of the eye line.</summary>
        public const float LiftStepMetres = 0.004f;

        public const int MaxLiftSteps = 60;

        /// <summary>Smallest shell width searched, as a multiple of skull width.</summary>
        public const float MinWidthFactor = 0.80f;

        public const float WidthFactorStep = 0.04f;

        /// <summary>Most vertical compression searched. Below this a helmet stops reading as a helmet.</summary>
        public const float MinVerticalFactor = 0.72f;

        public const float VerticalFactorStep = 0.04f;

        /// <summary>
        /// Axis-aligned orientations searched before anything else.
        ///
        /// Identity is NOT a safe default. The GLB -> Blender -> FBX -> Unity path applies its own axis
        /// conversion, and a dome that arrives rotated 180 degrees presents its solid shell to the face
        /// instead of its opening. That failure looks exactly like an oversized helmet to a clearance
        /// gate -- the first pass of this tool shrank and lifted the Silverguard helmet off the head for
        /// several iterations before the Owner pointed out it was simply upside down.
        /// </summary>
        public static readonly Vector3[] OrientationCandidates =
        {
            new Vector3(0f, 0f, 0f),
            new Vector3(180f, 0f, 0f),
            new Vector3(0f, 0f, 180f),
            new Vector3(0f, 180f, 0f),
            new Vector3(90f, 0f, 0f),
            new Vector3(-90f, 0f, 0f),
            new Vector3(180f, 180f, 0f),
        };

        public struct Suggestion
        {
            public Vector3 LocalPosition;
            public Vector3 LocalEulerAngles;
            public Vector3 LocalScale;
            public int LiftSteps;
            public bool EyeLineCleared;
            public float CrownGap;
            public float WidthFactor;
            public float VerticalFactor;
        }

        private static bool Better(Suggestion candidate, Suggestion best, bool haveBest)
        {
            if (!haveBest) return true;
            if (candidate.EyeLineCleared != best.EyeLineCleared) return candidate.EyeLineCleared;

            var gapDelta = Mathf.Abs(candidate.CrownGap) - Mathf.Abs(best.CrownGap);
            if (gapDelta < -0.0005f) return true;
            if (gapDelta > 0.0005f) return false;

            // Same read, same seat: prefer the least distorted and then the largest shell.
            if (candidate.VerticalFactor != best.VerticalFactor)
                return candidate.VerticalFactor > best.VerticalFactor;
            return candidate.WidthFactor > best.WidthFactor;
        }

        public static Suggestion SuggestHeadgearFit(
            GameObject heroInstance,
            GearItemDefinition definition,
            HeadFitProxy proxy)
        {
            var socket = GearMounter.ResolveSocket(heroInstance.transform, definition.SocketId);
            var headBone = socket.transform.parent != null ? socket.transform.parent : socket.transform;

            var item = Object.Instantiate(definition.SourceModel);
            try
            {
                item.transform.SetParent(socket.transform, false);
                item.transform.localPosition = Vector3.zero;
                item.transform.localRotation = Quaternion.identity;
                item.transform.localScale = Vector3.one;

                var best = default(Suggestion);
                var haveBest = false;

                foreach (var orientation in OrientationCandidates)
                {
                    item.transform.localPosition = Vector3.zero;
                    item.transform.localRotation = Quaternion.Euler(orientation);
                    item.transform.localScale = Vector3.one;
                    var lateral = LateralExtent(item, headBone, proxy);

                    for (var width = HelmetWidthFactor; width >= MinWidthFactor; width -= WidthFactorStep)
                    {
                        for (var vertical = 1f; vertical >= MinVerticalFactor; vertical -= VerticalFactorStep)
                        {
                            var targetWidth = proxy.SkullRadius * 2f * width;
                            var scale = lateral > 1e-5f ? targetWidth / lateral : 1f;

                            item.transform.localPosition = Vector3.zero;
                            item.transform.localRotation = Quaternion.Euler(orientation);
                            item.transform.localScale = new Vector3(scale, scale * vertical, scale);

                            MoveAlongHeadAxis(item, headBone, proxy,
                                proxy.CrownHeight - TopHeight(item, headBone, proxy));

                            var steps = 0;
                            var cleared = !OccludesEyeLine(item, headBone, proxy);
                            while (!cleared && steps < MaxLiftSteps)
                            {
                                MoveAlongHeadAxis(item, headBone, proxy, LiftStepMetres);
                                steps++;
                                cleared = !OccludesEyeLine(item, headBone, proxy);
                            }

                            var suggestion = new Suggestion
                            {
                                LocalPosition = item.transform.localPosition,
                                LocalEulerAngles = orientation,
                                LocalScale = item.transform.localScale,
                                LiftSteps = steps,
                                EyeLineCleared = cleared,
                                CrownGap = TopHeight(item, headBone, proxy) - proxy.CrownHeight,
                                WidthFactor = width,
                                VerticalFactor = vertical,
                            };

                            if (Better(suggestion, best, haveBest))
                            {
                                best = suggestion;
                                haveBest = true;
                            }
                        }
                    }
                }

                return best;
            }
            finally
            {
                Object.DestroyImmediate(item);
            }
        }

        private static void MoveAlongHeadAxis(
            GameObject item, Transform headBone, HeadFitProxy proxy, float distance)
        {
            var worldAxis = headBone.TransformDirection(proxy.UpAxis).normalized;
            item.transform.position += worldAxis * distance;
        }

        private static List<Vector3> HeadLocalVertices(
            GameObject item, Transform headBone)
        {
            var world = GearFitValidator.CollectWorldVertices(item);
            var local = new List<Vector3>(world.Count);
            for (var i = 0; i < world.Count; i++) local.Add(headBone.InverseTransformPoint(world[i]));
            return local;
        }

        private static float LateralExtent(GameObject item, Transform headBone, HeadFitProxy proxy)
        {
            var local = HeadLocalVertices(item, headBone);
            var max = 0f;
            for (var i = 0; i < local.Count; i++)
            {
                var height = proxy.HeightOf(local[i]);
                var radius = (local[i] - proxy.UpAxis * height).magnitude;
                if (radius > max) max = radius;
            }
            return max * 2f;
        }

        private static float TopHeight(GameObject item, Transform headBone, HeadFitProxy proxy)
        {
            var local = HeadLocalVertices(item, headBone);
            var top = float.NegativeInfinity;
            for (var i = 0; i < local.Count; i++)
            {
                var height = proxy.HeightOf(local[i]);
                if (height > top) top = height;
            }
            return top;
        }

        private static bool OccludesEyeLine(GameObject item, Transform headBone, HeadFitProxy proxy)
        {
            var local = HeadLocalVertices(item, headBone);
            var eyeHeight = proxy.EyeLineHeight;

            for (var i = 0; i < local.Count; i++)
            {
                var height = proxy.HeightOf(local[i]);
                if (height > eyeHeight) continue;

                // Face side of the head axis, matching GearFitValidator exactly.
                var forward = proxy.ForwardOf(local[i]);
                if (forward <= 0f) continue;

                var lateral = Vector3.ProjectOnPlane(local[i] - proxy.UpAxis * height, proxy.ForwardAxis).magnitude;
                if (lateral <= proxy.EyeClearanceRadius) return true;
            }

            return false;
        }
    }
}
