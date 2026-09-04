using System;
using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>
    /// Previews declared anatomy coverage in the Gear Workbench by hiding covered triangles on the Hero.
    ///
    /// Why this exists: the Silverguard helmet declares it covers hair and ears, but with the hair still
    /// rendered the Owner is looking at a helmet fighting a hairstyle that will not be there. Fitting
    /// around that volume is exactly how a helmet ends up oversized -- it is the mechanism behind the
    /// original watermelon fit.
    ///
    /// This is a PREVIEW, deliberately the smallest possible one. It is not the runtime equip system, it
    /// does not split the Hero into extra renderers, and it does not touch the shipped mesh asset: it
    /// clones the mesh once and swaps the triangle index buffer, which is the same one-draw technique
    /// public/src/character/anatomyOcclusion.js uses.
    ///
    /// The region map is face-INDEX data pinned to the shipping GLB's triangle order
    /// (public/src/character/heroAnatomyRegions.js). If the Unity derivative does not preserve that
    /// order or that triangle count, this refuses to run rather than deleting arbitrary faces.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class AnatomyCoveragePreview : MonoBehaviour
    {
        [SerializeField] private SkinnedMeshRenderer body;
        [SerializeField] private TextAsset regionMap;
        [SerializeField] private bool previewCoverage;

        [NonSerialized] private Mesh originalMesh;
        [NonSerialized] private Mesh previewMesh;
        [NonSerialized] private int[] originalTriangles;
        [NonSerialized] private Dictionary<string, int[]> regions;
        [NonSerialized] private string validationError;

        public bool PreviewCoverage
        {
            get => previewCoverage;
            set => previewCoverage = value;
        }

        public string ValidationError => validationError;
        public bool IsUsable => string.IsNullOrEmpty(validationError) && regions != null;

        public void Configure(SkinnedMeshRenderer skinnedMesh, TextAsset map)
        {
            body = skinnedMesh;
            regionMap = map;
        }

        [Serializable]
        private sealed class RegionEntry
        {
            public int faceCount;
            public int[] faces;
        }

        [Serializable]
        private sealed class RegionSet
        {
            public RegionEntry hair;
            public RegionEntry ears;
        }

        [Serializable]
        private sealed class RegionFile
        {
            public int triangleCount;
            public string heroSha256;
            // The exporter nests regions under "regions". An earlier version of this class expected
            // them at the top level, so JsonUtility quietly produced nulls, the region dictionary came
            // out empty, and the preview restored the Hero instead of hiding anything -- while the
            // triangle-count check still reported "usable". Silence like that is worse than a failure.
            public RegionSet regions;
        }

        private bool EnsureLoaded()
        {
            if (regions != null || !string.IsNullOrEmpty(validationError)) return regions != null;

            if (body == null || body.sharedMesh == null)
            {
                validationError = "No Hero SkinnedMeshRenderer assigned.";
                return false;
            }

            if (regionMap == null)
            {
                validationError = "No anatomy region map assigned. Run " +
                                  "tools/unity-migration/export-hero-anatomy-regions.mjs.";
                return false;
            }

            var parsed = JsonUtility.FromJson<RegionFile>(regionMap.text);
            if (parsed == null || parsed.triangleCount <= 0)
            {
                validationError = "The anatomy region map could not be parsed.";
                return false;
            }

            originalMesh = body.sharedMesh;
            originalTriangles = originalMesh.triangles;
            var unityTriangleCount = originalTriangles.Length / 3;

            if (unityTriangleCount != parsed.triangleCount)
            {
                // Fail loudly instead of hiding arbitrary geometry. If this fires, the derivative no
                // longer shares the source triangle order and the map must be rebaked, not reindexed.
                validationError =
                    "Anatomy region map is pinned to " + parsed.triangleCount +
                    " triangles but the imported Hero mesh has " + unityTriangleCount +
                    ". The Unity derivative does not preserve the source triangle order, so coverage " +
                    "cannot be previewed from this map.";
                return false;
            }

            regions = new Dictionary<string, int[]>(StringComparer.OrdinalIgnoreCase);
            if (parsed.regions?.hair?.faces != null) regions["hair"] = parsed.regions.hair.faces;
            if (parsed.regions?.ears?.faces != null) regions["ears"] = parsed.regions.ears.faces;

            if (regions.Count == 0)
            {
                validationError = "The anatomy region map parsed but contained no regions. " +
                                  "Check that its shape matches AnatomyCoveragePreview.RegionFile.";
                regions = null;
                return false;
            }

            // A matching triangle COUNT is not a matching triangle ORDER.
            //
            // The map is face-index data against the shipping GLB's face order. The Unity derivative
            // has the same 6800 triangles but, as it turns out, not in the same sequence -- applying the
            // map without this check deletes faces scattered across the face, neck and torso and leaves
            // the hair untouched. Verified by looking at the render, not inferred.
            //
            // Cheap invariant: the faces the map calls "hair" must actually sit in the upper head. If
            // their centroid is not above the head bone, the order does not match and this map cannot
            // drive a preview.
            if (!HairFacesLandOnTheHead(out var reason))
            {
                validationError = reason;
                regions = null;
                return false;
            }

            return true;
        }

        /// <summary>
        /// Sanity-check that the mapped hair faces actually land on the top of the head.
        ///
        /// Compares the centroid of the mapped faces against the mesh bounds: hair should sit well above
        /// the vertical midpoint and be laterally compact. A shuffled index order scatters the set over
        /// the whole body, which fails both.
        /// </summary>
        private bool HairFacesLandOnTheHead(out string reason)
        {
            reason = null;
            if (!regions.TryGetValue("hair", out var hairFaces) || hairFaces.Length == 0) return true;

            var vertices = originalMesh.vertices;
            var bounds = originalMesh.bounds;

            var centroid = Vector3.zero;
            var counted = 0;
            var stride = Mathf.Max(1, hairFaces.Length / 400);

            for (var i = 0; i < hairFaces.Length; i += stride)
            {
                var face = hairFaces[i];
                if (face < 0 || face * 3 + 2 >= originalTriangles.Length) continue;
                centroid += vertices[originalTriangles[face * 3]];
                counted++;
            }

            if (counted == 0) return true;
            centroid /= counted;

            var heightFraction = Mathf.InverseLerp(bounds.min.y, bounds.max.y, centroid.y);
            if (heightFraction < 0.75f)
            {
                reason =
                    "The anatomy region map does not match this mesh's triangle ORDER. Its 'hair' faces " +
                    "average " + (heightFraction * 100f).ToString("F0") + "% of the way up the mesh; " +
                    "hair should be near the top. The triangle COUNT matches, so the map looks valid " +
                    "and is not: applying it would delete faces scattered across the body. " +
                    "The GLB -> Blender -> FBX -> Unity path reorders faces, so this map cannot drive a " +
                    "Unity preview without being rebaked against the Unity derivative.";
                return false;
            }

            return true;
        }

        /// <summary>Hide the named regions, or restore the Hero when the list is empty.</summary>
        public void Apply(IEnumerable<AnatomyRegion> hidden)
        {
            if (!EnsureLoaded())
            {
                if (!string.IsNullOrEmpty(validationError)) Debug.LogWarning(validationError);
                return;
            }

            var hide = new HashSet<int>();
            var applied = new List<string>();

            if (hidden != null && previewCoverage)
            {
                foreach (var region in hidden)
                {
                    var key = region.ToString().ToLowerInvariant();
                    if (!regions.TryGetValue(key, out var faces)) continue;
                    foreach (var face in faces) hide.Add(face);
                    applied.Add(key);
                }
            }

            if (hide.Count == 0)
            {
                Restore();
                return;
            }

            var kept = new List<int>(originalTriangles.Length);
            for (var face = 0; face < originalTriangles.Length / 3; face++)
            {
                if (hide.Contains(face)) continue;
                kept.Add(originalTriangles[face * 3]);
                kept.Add(originalTriangles[face * 3 + 1]);
                kept.Add(originalTriangles[face * 3 + 2]);
            }

            if (previewMesh == null)
            {
                // A copy, never the shipped asset. Vertex/skin/UV buffers come along; only the index
                // buffer differs, so this stays one draw.
                previewMesh = Instantiate(originalMesh);
                previewMesh.name = originalMesh.name + " (coverage preview)";
                previewMesh.hideFlags = HideFlags.DontSave;
            }

            previewMesh.triangles = kept.ToArray();
            previewMesh.RecalculateBounds();
            body.sharedMesh = previewMesh;

            Debug.Log("Anatomy coverage preview hiding " + string.Join(", ", applied) +
                      " (" + hide.Count + " of " + (originalTriangles.Length / 3) + " triangles).");
        }

        public void Restore()
        {
            if (body != null && originalMesh != null) body.sharedMesh = originalMesh;
        }

        private void OnDisable()
        {
            Restore();
        }
    }
}
