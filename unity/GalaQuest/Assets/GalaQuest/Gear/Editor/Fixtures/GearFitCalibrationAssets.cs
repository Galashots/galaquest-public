using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Editor-only calibration geometry for the one invariant that matters most in this contract:
    ///
    ///     DECORATION MUST NOT CHANGE FIT SCALE.
    ///
    /// Two helmets are built with the SAME functional cavity and deliberately different exteriors.
    /// Helmet A is a plain shell. Helmet B has a materially thicker shell and an exaggerated crest.
    /// A correct contract gives them the SAME uniform normalization scale; their outer bounds and
    /// their silhouette verdicts may differ freely.
    ///
    /// Under the outer-bounds algorithm this replaces, B normalizes noticeably SMALLER than A purely
    /// because it is more decorated -- which is the defect these fixtures exist to catch.
    ///
    /// The geometry is generated in memory rather than committed as art, so there is no new binary in
    /// the repository and no source asset to drift.
    /// </summary>
    public static class GearFitCalibrationAssets
    {
        /// <summary>The functional cavity BOTH calibration helmets declare. Metres, canonical axes.</summary>
        public static readonly Vector3 SharedCavitySize = new Vector3(0.300f, 0.280f, 0.300f);

        /// <summary>Plain helmet: a thin shell around the shared cavity.</summary>
        public static readonly Vector3 PlainShellSize = new Vector3(0.340f, 0.320f, 0.340f);

        /// <summary>Decorated helmet: a much thicker shell around the SAME cavity.</summary>
        public static readonly Vector3 DecoratedShellSize = new Vector3(0.460f, 0.430f, 0.470f);

        /// <summary>Crest sitting on top of the decorated helmet. Pure decoration.</summary>
        public static readonly Vector3 CrestSize = new Vector3(0.060f, 0.300f, 0.320f);

        /// <summary>Helmet A: known cavity, plain exterior.</summary>
        public static GameObject BuildPlainHelmet()
        {
            var root = new GameObject("CAL_HELMET_A_PLAIN");
            AddBox(root, "Shell", PlainShellSize, Vector3.zero);
            AddBox(root, GearAssetFitProbe.CavityLocatorName, SharedCavitySize, Vector3.zero);
            return root;
        }

        /// <summary>
        /// Helmet B: the SAME cavity, a thicker shell and a tall crest. Everything that differs from
        /// A is exterior styling, so its fit scale must be identical to A's.
        /// </summary>
        public static GameObject BuildDecoratedHelmet()
        {
            var root = new GameObject("CAL_HELMET_B_DECORATED");
            AddBox(root, "Shell", DecoratedShellSize, Vector3.zero);
            AddBox(root, "Crest", CrestSize,
                new Vector3(0f, 0.5f * (DecoratedShellSize.y + CrestSize.y), 0f));
            AddBox(root, GearAssetFitProbe.CavityLocatorName, SharedCavitySize, Vector3.zero);
            return root;
        }

        /// <summary>
        /// A helmet that declares no cavity at all, standing in for generated art that arrives with no
        /// usable inner shell. Registering it must yield NeedsAuthoring, not an invented number.
        /// </summary>
        public static GameObject BuildHelmetWithoutCavity()
        {
            var root = new GameObject("CAL_HELMET_C_NO_CAVITY");
            AddBox(root, "Shell", PlainShellSize, Vector3.zero);
            return root;
        }

        /// <summary>Destroy a calibration helmet and the meshes it generated.</summary>
        public static void Destroy(GameObject helmet)
        {
            if (helmet == null) return;
            foreach (var filter in helmet.GetComponentsInChildren<MeshFilter>(true))
            {
                if (filter.sharedMesh != null) Object.DestroyImmediate(filter.sharedMesh);
            }

            Object.DestroyImmediate(helmet);
        }

        private static void AddBox(GameObject parent, string name, Vector3 size, Vector3 center)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent.transform, false);
            child.transform.localPosition = center;
            child.AddComponent<MeshFilter>().sharedMesh = BuildBoxMesh(size);
        }

        private static Mesh BuildBoxMesh(Vector3 size)
        {
            var half = size * 0.5f;
            var vertices = new Vector3[8];
            for (var i = 0; i < 8; i++)
            {
                vertices[i] = new Vector3(
                    (i & 1) == 0 ? -half.x : half.x,
                    (i & 2) == 0 ? -half.y : half.y,
                    (i & 4) == 0 ? -half.z : half.z);
            }

            var triangles = new List<int>();
            AddQuad(triangles, 0, 2, 3, 1);
            AddQuad(triangles, 4, 5, 7, 6);
            AddQuad(triangles, 0, 1, 5, 4);
            AddQuad(triangles, 2, 6, 7, 3);
            AddQuad(triangles, 0, 4, 6, 2);
            AddQuad(triangles, 1, 3, 7, 5);

            var mesh = new Mesh { name = "CalibrationBox" };
            mesh.hideFlags = HideFlags.HideAndDontSave;
            mesh.vertices = vertices;
            mesh.triangles = triangles.ToArray();
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void AddQuad(List<int> triangles, int a, int b, int c, int d)
        {
            triangles.Add(a); triangles.Add(b); triangles.Add(c);
            triangles.Add(a); triangles.Add(c); triangles.Add(d);
        }
    }
}
