using System;
using System.Collections.Generic;
using UnityEngine;
#if UNITY_EDITOR
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
#endif

namespace GalaQuest.Gear
{
    /// <summary>
    /// Previews mounted gear coverage on a temporary mesh copy, preserving the source Hero and fits.
    /// Requires a unique, complete UV-triangle correspondence with the supervised source region map.
    /// This Workbench preview is not the runtime equip system.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class AnatomyCoveragePreview : MonoBehaviour
    {
        [SerializeField] private SkinnedMeshRenderer body;
        [SerializeField] private TextAsset regionMap;
        // Default to coverage, including older scenes. Showing covered anatomy is diagnostic.
        [SerializeField] private bool showCoveredAnatomy;
        [NonSerialized] private int appliedMask = -1;

        [NonSerialized] private Mesh originalMesh;
        [NonSerialized] private SkinnedMeshRenderer originalBody;
        [NonSerialized] private Mesh previewMesh;
        [NonSerialized] private int[] originalTriangles;
        [NonSerialized] private Dictionary<string, int[]> regions;
        [NonSerialized] private string validationError;
        [NonSerialized] private SkinnedMeshRenderer cachedBody;
        [NonSerialized] private TextAsset cachedRegionMap;
        [NonSerialized] private string cachedRegionMapText;
#if UNITY_EDITOR
        [NonSerialized] private bool reapplyAfterSceneSave;
#endif

        public bool PreviewCoverage
        {
            get => !showCoveredAnatomy;
            set { showCoveredAnatomy = !value; appliedMask = -1; }
        }

        public string ValidationError => validationError;
        public bool IsUsable => string.IsNullOrEmpty(validationError) && regions != null;

        public void Configure(SkinnedMeshRenderer skinnedMesh, TextAsset map)
        {
            Release();
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
            public int schemaVersion;
            public int uvQuantization;
            public string[] sourceTriangleUvKeys;
            public int triangleCount;
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

            if (!body.sharedMesh.isReadable)
                return Reject("Hero mesh is not CPU-readable. Coverage requires Read/Write on the qualified Hero importer.");

            if (regionMap == null)
            {
                validationError = "No anatomy region map assigned. Run " +
                                  "tools/unity-migration/export-hero-anatomy-regions.mjs.";
                return false;
            }

            RegionFile parsed;
            try { parsed = JsonUtility.FromJson<RegionFile>(regionMap.text); }
            catch (ArgumentException) { return Reject("The anatomy region map could not be parsed."); }
            if (parsed == null || parsed.schemaVersion != 2 || parsed.triangleCount <= 0 ||
                parsed.sourceTriangleUvKeys?.Length != parsed.triangleCount)
                return Reject("Anatomy coverage requires the version 2 source UV map. Run the anatomy exporter.");
            originalBody = body;
            originalMesh = body.sharedMesh;
            if (originalMesh.subMeshCount != 1)
                return Reject("Coverage requires the qualified single-submesh Hero.");
            originalTriangles = originalMesh.triangles;
            if (!AnatomyTriangleCorrespondence.TryResolve(originalMesh.uv, originalTriangles,
                    parsed.sourceTriangleUvKeys, parsed.uvQuantization, out var mapping, out var error))
                return Reject(error);
            if (!MapRegion(parsed.regions?.hair, mapping, out var hair) ||
                !MapRegion(parsed.regions?.ears, mapping, out var ears))
                return Reject("Anatomy map requires valid, non-empty supervised hair and ear regions.");
            if (new HashSet<int>(hair).Overlaps(ears))
                return Reject("Supervised hair and ear regions must be disjoint.");
            regions = new Dictionary<string, int[]>(StringComparer.OrdinalIgnoreCase)
            {
                ["hair"] = hair, ["ears"] = ears
            };
            return true;
        }

        private bool Reject(string reason)
        {
            validationError = reason;
            regions = null;
            Restore();
            return false;
        }

        private static bool MapRegion(RegionEntry entry, int[] mapping, out int[] faces)
        {
            faces = null;
            if (entry?.faces == null || entry.faceCount <= 0 || entry.faceCount != entry.faces.Length) return false;
            var seen = new HashSet<int>();
            faces = new int[entry.faces.Length];
            for (var i = 0; i < faces.Length; i++)
            {
                var face = entry.faces[i];
                if (face < 0 || face >= mapping.Length || !seen.Add(face)) return false;
                faces[i] = mapping[face];
            }
            return true;
        }

        public void ApplyMountedCoverage()
        {
            var hidden = new HashSet<AnatomyRegion>();
            foreach (var mount in GetComponentsInChildren<GearMountedItem>())
                if (mount.isActiveAndEnabled && mount.Definition?.HidesAnatomy != null)
                    foreach (var region in mount.Definition.HidesAnatomy) hidden.Add(region);
            Apply(hidden);
        }

        /// <summary>Hide the named regions, or restore the Hero when the list is empty.</summary>
        public void Apply(IEnumerable<AnatomyRegion> hidden)
        {
            var currentMapText = regionMap == null ? null : regionMap.text;
            if (body != cachedBody || regionMap != cachedRegionMap ||
                !string.Equals(currentMapText, cachedRegionMapText, StringComparison.Ordinal))
                Release();

            if (originalMesh != null && (originalBody != body ||
                (body != null && body.sharedMesh != originalMesh && body.sharedMesh != previewMesh)))
                Release(); // A replaced renderer or imported mesh must establish correspondence again.

            cachedBody = body;
            cachedRegionMap = regionMap;
            cachedRegionMapText = currentMapText;

            var mask = 0;
            if (hidden != null && PreviewCoverage)
                foreach (var region in hidden)
                {
                    if (region != AnatomyRegion.Hair && region != AnatomyRegion.Ears)
                    {
                        Reject("No supervised Unity map for declared anatomy region " + region + ".");
                        return;
                    }
                    mask |= 1 << (int)region;
                }
            if (mask == 0) { Restore(); return; }
            if (mask == appliedMask && body != null && body.sharedMesh == previewMesh) return;
            if (!EnsureLoaded()) return;

            var hide = new HashSet<int>();
            if ((mask & (1 << (int)AnatomyRegion.Hair)) != 0) hide.UnionWith(regions["hair"]);
            if ((mask & (1 << (int)AnatomyRegion.Ears)) != 0) hide.UnionWith(regions["ears"]);

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
                previewMesh.hideFlags = HideFlags.HideAndDontSave;
            }

            previewMesh.triangles = kept.ToArray();
            // Preserve source bounds, vertex, skin and UV buffers; only the copied indices change.
            body.sharedMesh = previewMesh;

            appliedMask = mask;
        }

        public void Restore()
        {
            var targetBody = originalBody != null ? originalBody : body;
            if (targetBody != null && originalMesh != null && targetBody.sharedMesh == previewMesh)
                targetBody.sharedMesh = originalMesh;
            appliedMask = -1;
        }

        private void Release()
        {
            Restore();
            if (previewMesh != null)
            {
                if (Application.isPlaying) Destroy(previewMesh);
                else DestroyImmediate(previewMesh);
            }
            previewMesh = null;
            originalBody = null;
            originalMesh = null;
            originalTriangles = null;
            regions = null;
            validationError = null;
            cachedBody = null;
            cachedRegionMap = null;
            cachedRegionMapText = null;
        }
#if UNITY_EDITOR
        private void OnEnable()
        {
            EditorSceneManager.sceneSaving += OnSceneSaving;
            EditorSceneManager.sceneSaved += OnSceneSaved;
        }

        private void OnSceneSaving(Scene scene, string path)
        {
            if (gameObject.scene != scene || body == null || previewMesh == null ||
                originalMesh == null || body.sharedMesh != previewMesh) return;

            reapplyAfterSceneSave = PreviewCoverage;
            body.sharedMesh = originalMesh;
        }

        private void OnSceneSaved(Scene scene)
        {
            if (gameObject.scene != scene || !reapplyAfterSceneSave) return;

            reapplyAfterSceneSave = false;
            if (isActiveAndEnabled && PreviewCoverage) ApplyMountedCoverage();
        }
#endif
        private void Update() => ApplyMountedCoverage();
        private void OnDisable()
        {
#if UNITY_EDITOR
            EditorSceneManager.sceneSaving -= OnSceneSaving;
            EditorSceneManager.sceneSaved -= OnSceneSaved;
#endif
            Release();
        }
        private void OnDestroy() => Release();
    }
}
