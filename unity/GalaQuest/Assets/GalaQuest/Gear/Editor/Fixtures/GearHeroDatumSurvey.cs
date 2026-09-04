using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Reads GQ_HERO_V1 and answers the handful of anatomical questions the fit contract needs.
    ///
    /// This is the MEASURED half of the contract. It exists so that fixture numbers are derived from
    /// the Hero rather than typed from a screenshot, and so a future worker can rerun it and get the
    /// same values.
    ///
    /// It is deliberately NOT a body scanner. It answers exactly the questions the five fixtures ask:
    /// where a joint is, how wide a set of bone-dominated vertices is, and how thick a limb is. The
    /// vertex technique -- filter to vertices a bone dominates, then take a percentile rather than a
    /// maximum -- is the one already used by GearHeroAuthoring.MeasureSkullRadius, for the same reason:
    /// the maximum is whatever hair spike or seam sticks out furthest.
    /// </summary>
    public static class GearHeroDatumSurvey
    {
        /// <summary>
        /// Percentile used when a span is read off skinned vertices. Trims the hair spikes and stray
        /// seam verts that would otherwise define "how wide the head is".
        /// </summary>
        public const float SpanPercentile = 0.95f;

        /// <summary>A vertex counts as belonging to a bone when that bone holds most of its weight.</summary>
        public const float DominanceThreshold = 0.5f;

        /// <summary>
        /// The measurable facts the fixture kit is built from, all in HERO ROOT space and metres.
        /// Hero root space is canonical wearer space once <see cref="CanonicalSpaceError"/> is empty.
        /// </summary>
        public sealed class Survey
        {
            public Transform Root;
            public string CanonicalSpaceError = string.Empty;

            /// <summary>Evidence for the canonical claim, kept so review can see why it passed.</summary>
            public Vector3 UpEvidence;
            public Vector3 RightEvidence;

            /// <summary>Independent lateral confirmation from the hip joints.</summary>
            public Vector3 HipRightEvidence;

            public Vector3 ForwardEvidence;

            public readonly Dictionary<string, Transform> Joints = new Dictionary<string, Transform>();

            /// <summary>Functional head width: lateral span of Head-dominated vertices at the percentile.</summary>
            public float HeadWidth;

            /// <summary>Head depth, front to back, over the same vertex set.</summary>
            public float HeadDepth;

            /// <summary>Head-bone origin to the crown helper joint, in metres.</summary>
            public float HeadHeight;

            /// <summary>Deltoid diameter measured near the shoulder joint on the upper-arm bone.</summary>
            public float ShoulderCupWidth;

            /// <summary>Lateral span of the spine-dominated torso vertices.</summary>
            public float ChestWidth;

            /// <summary>Front-to-back span of the same torso vertex set.</summary>
            public float ChestDepth;

            /// <summary>Hip joint to neck joint along wearer up.</summary>
            public float TorsoLength;

            /// <summary>Elbow joint to wrist joint. Pure joint distance, no vertices involved.</summary>
            public float ForearmLength;

            /// <summary>Forearm diameter measured about the forearm bone axis.</summary>
            public float ForearmDiameter;

            /// <summary>
            /// The spine joint a cuirass seats its lower edge on, chosen by HEIGHT rather than by name.
            ///
            /// GQ_HERO_V1 numbers its spine chain downward: `Spine` is the TOP of the chain and
            /// `Spine02` the bottom, the opposite of what the names suggest. Picking the lowest joint
            /// mechanically means the contract does not depend on that convention being guessed right.
            /// </summary>
            public string WaistJointName = string.Empty;

            /// <summary>The joint a cuirass seats its upper edge on. Always the neck.</summary>
            public string CollarJointName = "neck";

            public bool IsCanonical => string.IsNullOrEmpty(CanonicalSpaceError);

            public Transform Joint(string boneName)
            {
                return Joints.TryGetValue(boneName, out var joint) ? joint : null;
            }

            /// <summary>A joint position expressed in hero root space.</summary>
            public Vector3 LocalJoint(string boneName)
            {
                var joint = Joint(boneName);
                return joint == null ? Vector3.zero : Root.InverseTransformPoint(joint.position);
            }
        }

        /// <summary>Bones the survey resolves. Missing any of them is a hard failure.</summary>
        public static readonly string[] RequiredJoints =
        {
            "Hips", "Spine", "Spine01", "Spine02", "neck", "Head", "head_end", "headfront",
            "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
            "RightShoulder", "RightArm", "RightForeArm", "RightHand",
            "LeftUpLeg", "RightUpLeg", "LeftFoot", "RightFoot",
        };

        /// <summary>
        /// Measure a hero instance. The instance must be in its bind pose -- a freshly instantiated
        /// GQ_HERO_V1 with no Animator sampling is exactly that.
        /// </summary>
        public static Survey Measure(GameObject heroInstance)
        {
            if (heroInstance == null) throw new ArgumentNullException("heroInstance");

            var survey = new Survey { Root = heroInstance.transform };
            foreach (var bone in RequiredJoints)
            {
                var joint = FindDescendant(heroInstance.transform, bone);
                if (joint == null)
                    throw new MissingReferenceException(
                        "GQ_HERO_V1 has no joint '" + bone + "'; the fit contract cannot be measured.");
                survey.Joints[bone] = joint;
            }

            survey.CanonicalSpaceError = ValidateCanonicalSpace(survey);

            var renderer = FindSkinnedRenderer(heroInstance);
            var vertices = renderer == null ? null : BakeHeroRootVertices(renderer, survey.Root);
            var weights = renderer == null || renderer.sharedMesh == null ? null : renderer.sharedMesh.boneWeights;

            // Lowest spine joint by wearer height. See Survey.WaistJointName for why this is measured
            // rather than read off the bone names.
            survey.WaistJointName = new[] { "Spine", "Spine01", "Spine02" }
                .OrderBy(bone => survey.LocalJoint(bone).y)
                .First();

            survey.HeadHeight = Vector3.Distance(
                survey.LocalJoint("Head"), survey.LocalJoint("head_end"));
            survey.TorsoLength = survey.LocalJoint("neck").y - survey.LocalJoint("Hips").y;
            survey.ForearmLength = Vector3.Distance(
                survey.LocalJoint("LeftForeArm"), survey.LocalJoint("LeftHand"));

            if (vertices != null && weights != null && weights.Length == vertices.Length)
            {
                var boneIndex = BuildBoneIndex(renderer);

                var head = CollectDominated(vertices, weights, boneIndex, new[] { "Head" });
                survey.HeadWidth = PercentileSpan(head, Vector3.right);
                survey.HeadDepth = PercentileSpan(head, Vector3.forward);

                var torso = CollectDominated(vertices, weights, boneIndex,
                    new[] { "Spine", "Spine01", "Spine02" });
                survey.ChestWidth = PercentileSpan(torso, Vector3.right);
                survey.ChestDepth = PercentileSpan(torso, Vector3.forward);

                survey.ShoulderCupWidth = 2f * LimbRadius(
                    CollectDominated(vertices, weights, boneIndex, new[] { "LeftArm" }),
                    survey.LocalJoint("LeftArm"),
                    survey.LocalJoint("LeftForeArm"),
                    0f,
                    0.35f);

                survey.ForearmDiameter = 2f * LimbRadius(
                    CollectDominated(vertices, weights, boneIndex, new[] { "LeftForeArm" }),
                    survey.LocalJoint("LeftForeArm"),
                    survey.LocalJoint("LeftHand"),
                    0.15f,
                    0.85f);
            }

            return survey;
        }

        /// <summary>
        /// Prove -- not assume -- that hero root space is +X wearer right, +Y wearer up, +Z wearer
        /// forward, using only the rig itself:
        ///
        ///   up      : the head is above the feet;
        ///   right   : the RIGHT shoulder is on the +X side of the LEFT shoulder;
        ///   forward : the rig's own `headfront` face helper points away from the Head joint.
        ///
        /// The lateral axis is taken from the SHOULDER joints, not the hands. Shoulders are structural
        /// and symmetric whatever the bind pose is; hands are not. GQ_HERO_V1 ships in an A-pose with
        /// the arms carried forward, so a hand-to-hand vector on this rig reads roughly 42 degrees off
        /// +X and would make an otherwise correct hero look non-canonical.
        ///
        /// Returns an empty string when the hero satisfies the convention.
        /// </summary>
        public static string ValidateCanonicalSpace(Survey survey)
        {
            var errors = new List<string>();
            var root = survey.Root;

            var feet = 0.5f * (survey.LocalJoint("LeftFoot") + survey.LocalJoint("RightFoot"));
            survey.UpEvidence = (survey.LocalJoint("Head") - feet).normalized;
            if (Vector3.Dot(survey.UpEvidence, GearFitCanonicalSpace.Up) < 0.95f)
                errors.Add("hero up axis is not +Y: feet-to-head reads " + Format(survey.UpEvidence));

            survey.RightEvidence =
                (survey.LocalJoint("RightShoulder") - survey.LocalJoint("LeftShoulder")).normalized;
            if (Vector3.Dot(survey.RightEvidence, GearFitCanonicalSpace.Right) < 0.90f)
                errors.Add("hero right axis is not +X: left-shoulder-to-right-shoulder reads " +
                           Format(survey.RightEvidence));

            // Independent confirmation from the legs. If the shoulders and the hips disagree about
            // which way is right, something is mirrored and no left/right claim can be trusted.
            survey.HipRightEvidence =
                (survey.LocalJoint("RightUpLeg") - survey.LocalJoint("LeftUpLeg")).normalized;
            if (Vector3.Dot(survey.HipRightEvidence, survey.RightEvidence) < 0.90f)
                errors.Add("hero shoulders and hips disagree about wearer right: shoulders read " +
                           Format(survey.RightEvidence) + " and hips read " + Format(survey.HipRightEvidence));

            survey.ForwardEvidence = (survey.LocalJoint("headfront") - survey.LocalJoint("Head")).normalized;
            if (Vector3.Dot(survey.ForwardEvidence, GearFitCanonicalSpace.Forward) < 0.70f)
                errors.Add("hero forward axis is not +Z: the headfront face helper reads " +
                           Format(survey.ForwardEvidence));

            // Unity is left-handed. If the three evidence axes do not form a left-handed set, one of
            // them is mirrored and every left/right claim built on them would be reversed.
            var handedness = Vector3.Dot(
                Vector3.Cross(survey.RightEvidence, survey.UpEvidence), survey.ForwardEvidence);
            if (handedness <= 0f)
                errors.Add("hero evidence axes are right-handed (right x up dot forward = " +
                           handedness.ToString("F3") + "); left/right semantics would be reversed");

            if (root != null && Mathf.Abs(root.lossyScale.x - 1f) > 1e-3f)
                errors.Add("hero root is scaled (" + Format(root.lossyScale) +
                           "); 1 Unity unit would not be 1 metre");

            return string.Join("; ", errors.ToArray());
        }

        /// <summary>
        /// Build a gear frame whose stored axes are the CANONICAL wearer axes re-expressed in the
        /// anchor bone local space.
        ///
        /// This is where arbitrary FBX bone roll is isolated. Whatever orientation the exporter gave
        /// the bone, the frame cancels it once, here, at authoring time. Nothing downstream ever reads
        /// the raw bone basis again.
        /// </summary>
        public static GearFitFrame BuildFrame(
            Survey survey,
            string frameId,
            GearFitFrameSide side,
            string anchorBone,
            Vector3 originInAnchor,
            string note)
        {
            var anchor = survey.Joint(anchorBone);
            if (anchor == null)
                throw new MissingReferenceException("Cannot build " + frameId + ": no joint " + anchorBone);

            var root = survey.Root;
            var right = anchor.InverseTransformDirection(
                root.TransformDirection(GearFitCanonicalSpace.Right)).normalized;
            var up = anchor.InverseTransformDirection(
                root.TransformDirection(GearFitCanonicalSpace.Up)).normalized;
            var forward = anchor.InverseTransformDirection(
                root.TransformDirection(GearFitCanonicalSpace.Forward)).normalized;

            return new GearFitFrame(
                frameId, side, anchorBone, originInAnchor, right, up, forward,
                GearFitValueProvenance.Measured,
                "Canonical wearer axes inverse-transformed through the " + anchorBone +
                " bind pose, so the frame is independent of that bone's imported roll. " + note);
        }

        /// <summary>
        /// Convert a hero-root-space point into the frame space of an already-built frame, so a
        /// measured anatomical position can be stored as a datum centre.
        /// </summary>
        public static Vector3 ToFrameSpace(Survey survey, GearFitFrame frame, Vector3 heroRootPoint)
        {
            var anchor = survey.Joint(frame.AnchorBone);
            if (anchor == null)
                throw new MissingReferenceException("Cannot resolve frame anchor " + frame.AnchorBone);
            if (!frame.TryResolveLocalRotation(out var rotation, out var error))
                throw new InvalidOperationException(error);

            var world = survey.Root.TransformPoint(heroRootPoint);
            var inAnchor = anchor.InverseTransformPoint(world);
            return Quaternion.Inverse(rotation) * (inAnchor - frame.OriginInAnchor);
        }

        private static SkinnedMeshRenderer FindSkinnedRenderer(GameObject hero)
        {
            SkinnedMeshRenderer best = null;
            foreach (var candidate in hero.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                if (candidate.sharedMesh == null) continue;
                if (best == null || candidate.sharedMesh.vertexCount > best.sharedMesh.vertexCount)
                    best = candidate;
            }

            return best;
        }

        private static Vector3[] BakeHeroRootVertices(SkinnedMeshRenderer renderer, Transform root)
        {
            var baked = new Mesh();
            try
            {
                renderer.BakeMesh(baked, true);
                var posed = baked.vertices;
                var result = new Vector3[posed.Length];
                for (var i = 0; i < posed.Length; i++)
                    result[i] = root.InverseTransformPoint(renderer.transform.TransformPoint(posed[i]));
                return result;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(baked);
            }
        }

        private static Dictionary<string, int> BuildBoneIndex(SkinnedMeshRenderer renderer)
        {
            var index = new Dictionary<string, int>();
            var bones = renderer.bones;
            for (var i = 0; i < bones.Length; i++)
            {
                if (bones[i] == null) continue;
                index[bones[i].name] = i;
            }

            return index;
        }

        private static List<Vector3> CollectDominated(
            Vector3[] vertices,
            BoneWeight[] weights,
            Dictionary<string, int> boneIndex,
            string[] boneNames)
        {
            var wanted = new HashSet<int>();
            foreach (var bone in boneNames)
            {
                if (boneIndex.TryGetValue(bone, out var index)) wanted.Add(index);
            }

            var result = new List<Vector3>();
            if (wanted.Count == 0) return result;

            for (var i = 0; i < vertices.Length; i++)
            {
                if (Weight(weights[i], wanted) > DominanceThreshold) result.Add(vertices[i]);
            }

            return result;
        }

        private static float Weight(BoneWeight weight, HashSet<int> wanted)
        {
            var total = 0f;
            if (wanted.Contains(weight.boneIndex0)) total += weight.weight0;
            if (wanted.Contains(weight.boneIndex1)) total += weight.weight1;
            if (wanted.Contains(weight.boneIndex2)) total += weight.weight2;
            if (wanted.Contains(weight.boneIndex3)) total += weight.weight3;
            return total;
        }

        /// <summary>
        /// Span of a point cloud along an axis, trimmed symmetrically to the percentile at both ends.
        /// A percentile rather than a min/max, for the same reason the skull radius uses one.
        /// </summary>
        private static float PercentileSpan(List<Vector3> points, Vector3 axis)
        {
            if (points.Count == 0) return 0f;

            var projected = new List<float>(points.Count);
            foreach (var point in points) projected.Add(Vector3.Dot(point, axis));
            projected.Sort();

            var high = projected[PercentileIndex(projected.Count, SpanPercentile)];
            var low = projected[PercentileIndex(projected.Count, 1f - SpanPercentile)];
            return Mathf.Max(0f, high - low);
        }

        /// <summary>
        /// Percentile radius of a limb about its own bone axis, over the slice of the limb between
        /// two fractions of its length. The slice keeps the shoulder measurement on the deltoid and
        /// off the elbow, and the forearm measurement off the wrist taper.
        /// </summary>
        private static float LimbRadius(
            List<Vector3> points,
            Vector3 jointStart,
            Vector3 jointEnd,
            float fromFraction,
            float toFraction)
        {
            var span = jointEnd - jointStart;
            var length = span.magnitude;
            if (points.Count == 0 || length <= 1e-6f) return 0f;

            var axis = span / length;
            var radii = new List<float>();
            foreach (var point in points)
            {
                var offset = point - jointStart;
                var along = Vector3.Dot(offset, axis) / length;
                if (along < fromFraction || along > toFraction) continue;
                radii.Add((offset - axis * (along * length)).magnitude);
            }

            if (radii.Count == 0) return 0f;
            radii.Sort();
            return radii[PercentileIndex(radii.Count, SpanPercentile)];
        }

        private static int PercentileIndex(int count, float percentile)
        {
            return Mathf.Clamp(Mathf.RoundToInt((count - 1) * percentile), 0, count - 1);
        }

        private static string Format(Vector3 value)
        {
            return "(" + value.x.ToString("F3") + ", " + value.y.ToString("F3") + ", " +
                   value.z.ToString("F3") + ")";
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            foreach (var transform in root.GetComponentsInChildren<Transform>(true))
                if (transform.name == name) return transform;
            return null;
        }
    }
}
