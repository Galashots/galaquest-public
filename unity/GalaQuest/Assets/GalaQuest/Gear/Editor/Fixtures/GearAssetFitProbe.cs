using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Reads the two DIFFERENT quantities a gear asset can offer, and keeps them apart.
    ///
    ///   1. the intended fit cavity -- the negative space the asset means to wear;
    ///   2. the render bounds -- every triangle the asset draws, crest and rivets included.
    ///
    /// Only (1) may drive normalization. (2) exists for silhouette ratios and absurd-size warnings.
    ///
    /// The cavity is NOT inferred. There is no inner-surface detection, no wall-thickness heuristic and
    /// no vertex threshold, because all of those quietly turn a guess into a measurement. The asset
    /// either carries an explicit fit locator that DECLARES its cavity, or it does not -- and when it
    /// does not, the honest answer is that the cavity needs authoring.
    /// </summary>
    public static class GearAssetFitProbe
    {
        /// <summary>
        /// Object name a gear asset uses to declare its own fit cavity. Its bounds are the cavity.
        /// A locator is authoring metadata: it is excluded from render bounds and is never rendered
        /// in game, because gear is mounted from the source model's renderers, not from this.
        /// </summary>
        public const string CavityLocatorName = "GQ_FIT_CAVITY";

        /// <summary>Prefix marking any fit locator, cavity or landmark. Excluded from render bounds.</summary>
        public const string LocatorPrefix = GearFitValidator.FitLocatorPrefix;

        /// <summary>
        /// Measure the asset-declared cavity, in canonical asset space.
        /// Returns false when the asset declares none -- which is a legitimate state, not an error.
        /// </summary>
        public static bool TryMeasureDeclaredCavity(
            GameObject instance,
            Quaternion rawToCanonical,
            out Bounds cavity,
            out string error)
        {
            cavity = default(Bounds);
            if (instance == null)
            {
                error = "no asset instance to probe";
                return false;
            }

            var locators = new List<Transform>();
            foreach (var transform in instance.GetComponentsInChildren<Transform>(true))
            {
                if (transform.name == CavityLocatorName) locators.Add(transform);
            }

            if (locators.Count == 0)
            {
                error = "asset declares no " + CavityLocatorName + " fit locator";
                return false;
            }

            if (!TryMeasure(instance.transform, locators, rawToCanonical, out cavity))
            {
                error = CavityLocatorName + " carries no mesh to measure";
                return false;
            }

            error = string.Empty;
            return true;
        }

        /// <summary>
        /// Bounding size of everything the asset RENDERS, in canonical asset space, with fit locators
        /// excluded. Secondary analysis only -- this must never reach a normalization scale.
        /// </summary>
        public static Vector3 MeasureRenderBounds(GameObject instance, Quaternion rawToCanonical)
        {
            var bounds = default(Bounds);
            var any = false;
            // Measure each eligible filter once; do not recursively reintroduce hidden children.
            foreach (var filter in GearFitValidator.VisibleRigidMeshFilters(instance))
            {
                foreach (var vertex in filter.sharedMesh.vertices)
                {
                    var canonical = rawToCanonical * instance.transform.InverseTransformPoint(
                        filter.transform.TransformPoint(vertex));
                    if (!any) bounds = new Bounds(canonical, Vector3.zero);
                    else bounds.Encapsulate(canonical);
                    any = true;
                }
            }

            if (!any)
                throw new MissingReferenceException(
                    instance.name + " has no renderable mesh; the contract covers rigid gear only.");

            return bounds.size;
        }

        /// <summary>Is this transform, or any ancestor, a fit locator rather than rendered gear?</summary>
        public static bool IsLocator(Transform transform) => GearFitValidator.IsFitLocator(transform);

        /// <summary>
        /// Named fit landmarks the asset declares, e.g. GQ_FIT_CROWN, in canonical asset space.
        /// The cavity locator itself is not a landmark.
        /// </summary>
        public static GearAssetFitLandmark[] ReadDeclaredLandmarks(
            GameObject instance, Quaternion rawToCanonical)
        {
            var found = new List<GearAssetFitLandmark>();
            foreach (var transform in instance.GetComponentsInChildren<Transform>(true))
            {
                if (transform.name == CavityLocatorName) continue;
                if (!transform.name.StartsWith(LocatorPrefix, System.StringComparison.Ordinal)) continue;

                var local = instance.transform.InverseTransformPoint(transform.position);
                found.Add(new GearAssetFitLandmark(
                    "ASSET_" + transform.name.Substring(LocatorPrefix.Length),
                    rawToCanonical * local,
                    GearFitValueProvenance.Measured,
                    "Read from the " + transform.name + " locator the asset itself carries."));
            }

            return found.ToArray();
        }

        /// <summary>
        /// Bounds of a set of transforms' meshes, expressed in canonical asset space. Vertices are
        /// taken in the instance's own local space and then rotated, so the result does not depend on
        /// where the instance happens to sit in the scene.
        /// </summary>
        private static bool TryMeasure(
            Transform root, List<Transform> transforms, Quaternion rawToCanonical, out Bounds bounds)
        {
            bounds = default(Bounds);
            var any = false;
            var min = Vector3.one * float.MaxValue;
            var max = Vector3.one * float.MinValue;

            foreach (var transform in transforms)
            {
                foreach (var filter in transform.GetComponentsInChildren<MeshFilter>(true))
                {
                    if (filter.sharedMesh == null) continue;
                    foreach (var vertex in filter.sharedMesh.vertices)
                    {
                        var world = filter.transform.TransformPoint(vertex);
                        var canonical = rawToCanonical * root.InverseTransformPoint(world);
                        min = Vector3.Min(min, canonical);
                        max = Vector3.Max(max, canonical);
                        any = true;
                    }
                }
            }

            if (!any) return false;
            bounds = new Bounds(0.5f * (min + max), max - min);
            return true;
        }
    }
}
