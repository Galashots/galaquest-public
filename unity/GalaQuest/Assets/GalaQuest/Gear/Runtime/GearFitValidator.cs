using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>
    /// Shared machine gates for mounted rigid gear.
    ///
    /// These REJECT bad states. They cannot visually accept a fit: a helmet that passes every check here
    /// may still look wrong, and Unity/running-game human inspection remains the acceptance authority
    /// (AGENTS.md, "Visual and product acceptance").
    ///
    /// Every check is class-driven, never item-driven, so a new helmet inherits the whole gate set with
    /// no new code.
    /// </summary>
    public static class GearFitValidator
    {
        /// <summary>Item geometry closer to the body than this reads as swallowed rather than worn.</summary>
        public const float MinimumProtrusionMetres = 0.005f;

        /// <summary>An item wider than this multiple of the head diameter is an import/scale accident.</summary>
        public const float MaxHeadDiameterMultiple = 3f;

        public static List<GearFitIssue> Validate(
            Transform heroRoot,
            GameObject mounted,
            GearItemDefinition definition,
            HeadFitProxy headProxy)
        {
            var issues = new List<GearFitIssue>();

            if (definition == null)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                    GearFitIssueCodes.MissingDefinition, "No gear item definition supplied."));
                return issues;
            }

            if (definition.SourceModel == null)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                    GearFitIssueCodes.MissingModel,
                    definition.DisplayName + " has no source model assigned."));
            }

            GearSocket socket = null;
            if (heroRoot != null)
            {
                var sockets = GearMounter.CollectSockets(heroRoot);
                if (!sockets.TryGetValue(definition.SocketId ?? string.Empty, out socket))
                {
                    issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                        GearFitIssueCodes.MissingSocket,
                        definition.DisplayName + " wants socket '" + definition.SocketId +
                        "', which GQ_HERO_V1 does not have."));
                }
            }

            var scale = definition.LocalScale;
            if (!IsFinite(definition.LocalPosition) || !IsFinite(scale) || !IsFinite(definition.LocalEulerAngles))
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                    GearFitIssueCodes.InvalidTransform,
                    definition.DisplayName + " has a non-finite authored transform."));
            }
            else if (Mathf.Approximately(scale.x, 0f) || Mathf.Approximately(scale.y, 0f) ||
                     Mathf.Approximately(scale.z, 0f))
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                    GearFitIssueCodes.InvalidTransform,
                    definition.DisplayName + " has a zero component in its authored scale."));
            }

            var geometryError = MountedGeometryError(mounted);
            if (geometryError != null)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection, GearFitIssueCodes.InvalidGeometry, geometryError));
                return issues;
            }
            if (socket == null) return issues;

            var itemVertices = CollectWorldVertices(mounted);
            if (itemVertices.Count == 0)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection, GearFitIssueCodes.InvalidGeometry,
                    "Mounted item has no measurable vertices"));
                return issues;
            }

            if (definition.FitClass == GearFitClass.Headgear)
            {
                if (headProxy == null)
                {
                    issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                        GearFitIssueCodes.MissingProxy,
                        definition.DisplayName + " is Headgear but no Head Fit Proxy was supplied."));
                }
                else
                {
                    ValidateHeadgear(socket, itemVertices, definition, headProxy, issues);
                }
            }

            ValidateReadsOnBody(heroRoot, itemVertices, definition, issues);
            return issues;
        }

        private static void ValidateHeadgear(
            GearSocket socket,
            List<Vector3> worldVertices,
            GearItemDefinition definition,
            HeadFitProxy proxy,
            List<GearFitIssue> issues)
        {
            // The proxy is authored in head-BONE local space; the socket is a child of that bone, so the
            // bone transform is the socket's parent.
            var headBone = socket.transform.parent != null ? socket.transform.parent : socket.transform;

            var eyeHeight = proxy.EyeLineHeight;
            var crownHeight = proxy.CrownHeight;

            var occluding = 0;
            var topHeight = float.NegativeInfinity;

            for (var i = 0; i < worldVertices.Count; i++)
            {
                var local = headBone.InverseTransformPoint(worldVertices[i]);
                var height = proxy.HeightOf(local);
                var forward = proxy.ForwardOf(local);

                if (height > topHeight) topHeight = height;

                // Lateral distance from the head's own axis, so cheek guards that sweep wide are not
                // confused with a visor hanging in front of the eyes.
                var axial = proxy.UpAxis * height;
                var lateral = Vector3.ProjectOnPlane(local - axial, proxy.ForwardAxis).magnitude;

                // Anything on the FACE SIDE of the head axis and at or below the eye line blocks the
                // eyes. An earlier version of this test only counted geometry further forward than the
                // eye point itself, which let a helmet rim resting on the brow pass while visibly
                // covering both eyes -- caught by looking at the render, not by the gate.
                var onFaceSide = forward > 0f;
                var atOrBelowEyes = height <= eyeHeight;
                var withinFaceWindow = lateral <= proxy.EyeClearanceRadius;

                if (onFaceSide && atOrBelowEyes && withinFaceWindow) occluding++;
            }

            if (occluding > 0)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                    GearFitIssueCodes.EyeLineOccluded,
                    definition.DisplayName + " puts " + occluding +
                    " vertices in front of the face at or below the eye line. " +
                    "An open-faced helm must leave the eye line readable."));
            }

            var gap = topHeight - crownHeight;
            if (gap > proxy.MaxCrownGap)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                    GearFitIssueCodes.FloatsAboveCrown,
                    definition.DisplayName + " tops out " + gap.ToString("F3") +
                    " m above the crown (limit " + proxy.MaxCrownGap.ToString("F3") +
                    " m); it reads as floating."));
            }

            var bounds = BoundsOf(worldVertices);
            var headDiameter = Mathf.Max(proxy.SkullRadius * 2f, 0.001f);
            var widest = Mathf.Max(bounds.size.x, Mathf.Max(bounds.size.y, bounds.size.z));
            if (widest > headDiameter * MaxHeadDiameterMultiple)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                    GearFitIssueCodes.AbsurdScale,
                    definition.DisplayName + " is " + widest.ToString("F3") +
                    " m across against a " + headDiameter.ToString("F3") + " m head."));
            }
        }

        /// <summary>
        /// The Silverguard Shoulders defect (#125) in machine form: an item mounted inside the body
        /// silhouette is technically equipped and visually absent. Subsampled on both sides; this is a
        /// rejection gate, not a precise geometric measurement.
        /// </summary>
        private static void ValidateReadsOnBody(
            Transform heroRoot,
            List<Vector3> itemVertices,
            GearItemDefinition definition,
            List<GearFitIssue> issues)
        {
            if (heroRoot == null) return;

            var body = heroRoot.GetComponentInChildren<SkinnedMeshRenderer>(true);
            if (body == null || body.sharedMesh == null) return;

            var baked = new Mesh();
            try
            {
                body.BakeMesh(baked, true);
                var bodyVertices = baked.vertices;
                if (bodyVertices.Length == 0) return;

                var bodyStride = Mathf.Max(1, bodyVertices.Length / 1500);
                var itemStride = Mathf.Max(1, itemVertices.Count / 400);

                var maxProtrusion = 0f;
                for (var i = 0; i < itemVertices.Count; i += itemStride)
                {
                    var local = body.transform.InverseTransformPoint(itemVertices[i]);
                    var nearest = float.PositiveInfinity;
                    for (var b = 0; b < bodyVertices.Length; b += bodyStride)
                    {
                        var d = (bodyVertices[b] - local).sqrMagnitude;
                        if (d < nearest) nearest = d;
                    }
                    var distance = Mathf.Sqrt(nearest);
                    if (distance > maxProtrusion) maxProtrusion = distance;
                }

                if (maxProtrusion < MinimumProtrusionMetres)
                {
                    issues.Add(new GearFitIssue(GearFitSeverity.Rejection,
                        GearFitIssueCodes.DoesNotRead,
                        definition.DisplayName + " never stands more than " +
                        maxProtrusion.ToString("F4") +
                        " m clear of the body; equipped but not visible."));
                }
            }
            finally
            {
                if (Application.isPlaying) Object.Destroy(baked);
                else Object.DestroyImmediate(baked);
            }
        }

        /// <summary>Rigid production gates require visible triangle geometry they can actually measure.</summary>
        public static string MountedGeometryError(GameObject mounted)
        {
            if (mounted == null) return "No mounted item to validate";
            var found = false;
            foreach (var renderer in mounted.GetComponentsInChildren<Renderer>(true))
            {
                if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                if (!(renderer is MeshRenderer))
                    return "Mounted item has an unsupported renderer; rigid fit checks require MeshRenderer geometry";
                var filter = renderer.GetComponent<MeshFilter>();
                var mesh = filter == null ? null : filter.sharedMesh;
                if (mesh == null || mesh.vertexCount == 0 || mesh.subMeshCount == 0)
                    return "Mounted renderer has missing or empty mesh geometry";
                var triangles = false;
                for (var i = 0; i < mesh.subMeshCount; i++)
                    triangles |= mesh.GetTopology(i) == MeshTopology.Triangles && mesh.GetIndexCount(i) >= 3;
                if (!triangles) return "Mounted renderer has no supported triangles";
                found = true;
            }
            return found ? null : "Mounted item has no active, enabled rigid mesh renderer";
        }

        public static List<Vector3> CollectWorldVertices(GameObject root)
        {
            var result = new List<Vector3>();
            foreach (var filter in root.GetComponentsInChildren<MeshFilter>(true))
            {
                var mesh = filter.sharedMesh;
                if (mesh == null) continue;
                var vertices = mesh.vertices;
                for (var i = 0; i < vertices.Length; i++)
                    result.Add(filter.transform.TransformPoint(vertices[i]));
            }
            return result;
        }

        public static Bounds BoundsOf(List<Vector3> points)
        {
            var bounds = new Bounds(points[0], Vector3.zero);
            for (var i = 1; i < points.Count; i++) bounds.Encapsulate(points[i]);
            return bounds;
        }

        private static bool IsFinite(Vector3 v)
        {
            return !(float.IsNaN(v.x) || float.IsNaN(v.y) || float.IsNaN(v.z) ||
                     float.IsInfinity(v.x) || float.IsInfinity(v.y) || float.IsInfinity(v.z));
        }
    }
}
