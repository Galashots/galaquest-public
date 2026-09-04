using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Editor-side machine gate: does a MOUNTED item actually agree with the registration and profile
    /// that claim to describe it?
    ///
    /// This exists because of a specific observed failure. During the intake bake-off a shield was
    /// mounted facing sideways and tilted about 45 degrees -- plainly wrong on screen -- and the runtime
    /// <see cref="GearFitValidator"/> returned zero rejections and zero warnings, because it is a
    /// Head-Fit-Proxy check and knows nothing about fixtures, frames or registrations. A defect that no
    /// gate can express is a defect that ships.
    ///
    /// It is deliberately EDITOR-ONLY and deliberately separate from GearFitValidator. The runtime
    /// validator must not gain a dependency on editor-only registration data; a shipped build has no
    /// GearFitAssetRegistration and should not need one.
    ///
    /// Machine gates REJECT. They never visually accept: running-game pixels remain final appearance
    /// authority, and passing every check below still says nothing about whether the fit looks right.
    /// </summary>
    public static class GearFitSeedConsistency
    {
        public static class Codes
        {
            public const string OrientationMismatch = "seed.orientation-mismatch";
            public const string ScaleMismatch = "seed.scale-mismatch";
            public const string NonUniformScale = "seed.non-uniform-scale";
            public const string LandmarkMisaligned = "seed.landmark-misaligned";
            public const string MissingAssetLandmark = "seed.missing-asset-landmark";
            public const string ExtentsMismatch = "seed.extents-mismatch";
            public const string Unseedable = "seed.unseedable";
        }

        /// <summary>
        /// Check a mounted item. Returns rejections; an empty list means nothing mechanically
        /// detectable is wrong, NOT that the fit is accepted.
        /// </summary>
        public static List<GearFitIssue> Check(
            Transform heroRoot,
            GameObject mounted,
            GearItemDefinition item,
            GearFitFixtureDefinition fixture,
            GearAssetFitProfile profile,
            GearFitAssetRegistration registration)
        {
            var issues = new List<GearFitIssue>();

            if (heroRoot == null || mounted == null || item == null ||
                fixture == null || profile == null || registration == null)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.Unseedable,
                    "seed consistency needs a mounted item plus its fixture, profile and registration"));
                return issues;
            }

            if (!registration.HasFitScale)
            {
                // A NeedsAuthoring item legitimately has no seed to be consistent with. Saying so is
                // the honest outcome; it is not a rejection of the mount.
                return issues;
            }

            GearSocket socket;
            try
            {
                socket = GearMounter.ResolveSocket(heroRoot, item.SocketId);
            }
            catch (System.Exception exception)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.Unseedable, exception.Message));
                return issues;
            }

            if (!GearFitSeedSolver.TryResolveFrame(
                    heroRoot, fixture, socket, out var frame, out var anchor, out var frameError))
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.Unseedable, frameError));
                return issues;
            }

            if (!frame.TryResolveLocalRotation(out var frameLocalRotation, out var basisError))
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.Unseedable, basisError));
                return issues;
            }

            var frameWorldRotation = anchor.rotation * frameLocalRotation;

            // --- SCALE ----------------------------------------------------------------------------
            var scale = item.LocalScale;
            var expected = registration.UniformNormalizationScale;
            if (Mathf.Abs(scale.x - scale.y) > GearFitSeedSolver.ScaleTolerance ||
                Mathf.Abs(scale.x - scale.z) > GearFitSeedSolver.ScaleTolerance)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.NonUniformScale,
                    "fit scale " + Format(scale) + " is not uniform; the contract normalizes with one " +
                    "scalar and an out-of-proportion asset is corrected in the ASSET, never squashed here"));
            }
            else if (Mathf.Abs(scale.x - expected) > GearFitSeedSolver.ScaleTolerance)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.ScaleMismatch,
                    "mounted uniform scale " + scale.x.ToString("F5") + " does not match the " +
                    "registration's " + expected.ToString("F5")));
            }

            // --- ORIENTATION ----------------------------------------------------------------------
            // The mounted object's canonical basis must coincide with the Gear Frame. This is the check
            // that catches a sideways or rolled mount, which no head-proxy gate can see.
            // The gear object's local axes are the asset's RAW axes, so a canonical direction c sits at
            // raw R^-1 * c. Its world orientation is therefore rotation * Inverse(rawToCanonical) --
            // composing the rotation forward here instead would apply it twice and read exactly 180
            // degrees off for a 90-degree raw correction.
            var mountedCanonical = mounted.transform.rotation *
                                   Quaternion.Inverse(profile.RawToCanonicalRotation);
            var offBy = Quaternion.Angle(mountedCanonical, frameWorldRotation);
            if (offBy > GearFitSeedSolver.RotationToleranceDegrees)
            {
                issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.OrientationMismatch,
                    "mounted canonical basis is " + offBy.ToString("F2") + " degrees from " +
                    frame.FrameId + "; the asset is not facing wearer-forward/up as registered " +
                    "(tolerance " + GearFitSeedSolver.RotationToleranceDegrees.ToString("F2") + " deg)"));
            }

            // --- LANDMARK -------------------------------------------------------------------------
            var datumId = registration.FunctionalLandmarkId;
            if (!string.IsNullOrEmpty(datumId) && fixture.TryGetDatum(datumId, out var datum))
            {
                var assetLandmarkId = GearFitSeedSolver.AssetLandmarkIdFor(datumId);
                if (!profile.TryGetLandmark(assetLandmarkId, out var assetLandmark))
                {
                    issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.MissingAssetLandmark,
                        "profile declares no " + assetLandmarkId + ", so the mount cannot be shown to " +
                        "seat on " + datumId));
                }
                else
                {
                    // Where the asset's landmark actually ended up, through its real mounted transform.
                    var rawOffset = Quaternion.Inverse(profile.RawToCanonicalRotation) *
                                    assetLandmark.PositionInCanonical;
                    var landmarkWorld = mounted.transform.TransformPoint(rawOffset);
                    var datumWorld = anchor.TransformPoint(frame.OriginInAnchor) +
                                     frameWorldRotation * datum.LocalCenter;
                    var drift = Vector3.Distance(landmarkWorld, datumWorld);
                    if (drift > GearFitSeedSolver.PositionToleranceMetres)
                    {
                        issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.LandmarkMisaligned,
                            assetLandmarkId + " sits " + (drift * 1000f).ToString("F1") + " mm from " +
                            datumId + " (tolerance " +
                            (GearFitSeedSolver.PositionToleranceMetres * 1000f).ToString("F1") + " mm)"));
                    }
                }
            }

            // --- EXTENTS --------------------------------------------------------------------------
            // The mounted silhouette should be the registered render size scaled by the same scalar.
            // Cheap, and it catches an item whose source model changed underneath its registration.
            var registered = registration.NormalizedRenderSizeInFrame;
            if (registered.sqrMagnitude > 0f)
            {
                var measured = MeasureFrameSpaceExtents(mounted, frameWorldRotation);
                if (measured.sqrMagnitude > 0f)
                {
                    var worst = Mathf.Max(
                        RelativeError(measured.x, registered.x),
                        Mathf.Max(RelativeError(measured.y, registered.y),
                            RelativeError(measured.z, registered.z)));
                    if (worst > 0.05f)
                    {
                        issues.Add(new GearFitIssue(GearFitSeverity.Rejection, Codes.ExtentsMismatch,
                            "mounted frame-space extents " + Format(measured) + " differ from the " +
                            "registered normalized size " + Format(registered) + " by " +
                            (worst * 100f).ToString("F1") + "%"));
                    }
                }
            }

            return issues;
        }

        /// <summary>Bounding size of the mounted renderers measured along the frame's own axes.</summary>
        private static Vector3 MeasureFrameSpaceExtents(GameObject mounted, Quaternion frameWorldRotation)
        {
            var toFrame = Quaternion.Inverse(frameWorldRotation);
            var min = Vector3.one * float.MaxValue;
            var max = Vector3.one * float.MinValue;
            var any = false;

            foreach (var filter in mounted.GetComponentsInChildren<MeshFilter>(true))
            {
                if (filter.sharedMesh == null) continue;
                if (GearAssetFitProbe.IsLocator(filter.transform)) continue;
                foreach (var vertex in filter.sharedMesh.vertices)
                {
                    var inFrame = toFrame * filter.transform.TransformPoint(vertex);
                    min = Vector3.Min(min, inFrame);
                    max = Vector3.Max(max, inFrame);
                    any = true;
                }
            }

            return any ? max - min : Vector3.zero;
        }

        private static float RelativeError(float measured, float expected)
        {
            if (expected <= 1e-6f) return 0f;
            return Mathf.Abs(measured - expected) / expected;
        }

        private static string Format(Vector3 value)
        {
            return "(" + value.x.ToString("F4") + ", " + value.y.ToString("F4") + ", " +
                   value.z.ToString("F4") + ")";
        }
    }
}
