using System;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Converts an honest registration into a socket-local seed transform the ordinary
    /// <see cref="GearMounter"/> can consume.
    ///
    /// This is the seam the intake bake-off found missing. The datum contract reasons in CANONICAL
    /// WEARER space (+X right, +Y up, +Z forward); the mounter applies SOCKET-LOCAL TRS and the socket
    /// inherits whatever roll its bone was exported with. Those are different quantities, and writing a
    /// canonical rotation straight onto a GearItemDefinition silently means something else -- which is
    /// how a shield ended up mounted sideways and tilted while every gate stayed green.
    ///
    /// The conversion belongs HERE, in editor authoring, not in the runtime mounter. The mounter is
    /// correctly a generic consumer of socket-local TRS and knows nothing about fixtures, registrations
    /// or canonical space; keeping it that way means a shipped build carries no editor-only concepts.
    ///
    ///     asset raw space --(profile raw-to-canonical)--> canonical
    ///                     --(fixture Gear Frame)--------> anchor bone
    ///                     --(socket inverse)------------> socket-local seed TRS
    ///
    /// Nothing here is item-specific. A second shield is another GearItemDefinition plus another
    /// GearAssetFitProfile; it is not another branch in this file.
    /// </summary>
    public static class GearFitSeedSolver
    {
        /// <summary>How far a mounted canonical basis may sit from its frame before it is wrong.</summary>
        public const float RotationToleranceDegrees = 0.5f;

        /// <summary>How far a functional landmark may sit from its datum before it is wrong.</summary>
        public const float PositionToleranceMetres = 0.002f;

        /// <summary>Uniform-scale agreement tolerance between item and registration.</summary>
        public const float ScaleTolerance = 1e-4f;

        /// <summary>
        /// The asset-side landmark that corresponds to a fixture FunctionalFit datum.
        /// Fixture <c>FIT_GRIP</c> is answered by asset <c>ASSET_FIT_GRIP</c>. One naming rule, no table.
        /// </summary>
        public const string AssetLandmarkPrefix = "ASSET_";

        public static string AssetLandmarkIdFor(string fixtureDatumId)
        {
            return AssetLandmarkPrefix + fixtureDatumId;
        }

        /// <summary>A derived socket-local seed, or an explanation of what is missing.</summary>
        public struct Seed
        {
            /// <summary>True only when scale, rotation AND position were all derived.</summary>
            public bool IsComplete;

            public Vector3 LocalPosition;
            public Vector3 LocalEulerAngles;
            public Vector3 LocalScale;

            /// <summary>Fixture datum the asset landmark was aligned to.</summary>
            public string DatumId;

            /// <summary>Asset landmark that was aligned.</summary>
            public string AssetLandmarkId;

            public string FrameId;
            public string SocketId;

            /// <summary>Why the seed is incomplete. Empty when complete.</summary>
            public string Error;

            public string Note;
        }

        /// <summary>
        /// Derive the seed. Pure geometry over a live hero instance; touches no assets and writes
        /// nothing, so tests can drive it directly.
        /// </summary>
        public static Seed Solve(
            Transform heroRoot,
            GearItemDefinition item,
            GearFitFixtureDefinition fixture,
            GearAssetFitProfile profile,
            GearFitAssetRegistration registration)
        {
            var seed = new Seed();

            if (heroRoot == null) return Fail(seed, "no hero instance to solve against");
            if (item == null) return Fail(seed, "no gear item definition");
            if (fixture == null) return Fail(seed, "no fixture for this slot");
            if (profile == null)
                return Fail(seed, "no GearAssetFitProfile; the asset-side fit data needs authoring");
            if (registration == null) return Fail(seed, "no registration record");

            if (!registration.HasFitScale)
            {
                return Fail(seed,
                    "registration is " + registration.Status + ", so it claims no uniform fit scale. " +
                    "Author a fit cavity for this asset before seeding it.");
            }

            if (!profile.TryValidate(out var profileError))
                return Fail(seed, "asset fit profile is invalid: " + profileError);

            if (registration.Status == GearFitRegistrationStatus.Rejected)
                return Fail(seed, "registration rejected the asset proportions");
            if (!registration.TryValidate(out var recordError)) return Fail(seed, recordError);
            if (!fixture.TryValidateContract(heroRoot, out var fixtureError)) return Fail(seed, fixtureError);
            if (registration.RawToCanonicalScale != Vector3.one)
                return Fail(seed, "registration raw scale must be identity; source reflection belongs to the item");
            if (registration.PrimaryMetric != fixture.PrimaryMeasurement.Metric ||
                registration.PrimaryAxis != fixture.PrimaryMeasurement.Axis)
                return Fail(seed, "stale registration primary metric/axis");
            if (item.SemanticId != profile.SemanticAssetId || item.SemanticId != registration.SemanticAssetId)
                return Fail(seed, "item/profile/registration identity mismatch");
            if (profile.Slot != fixture.Slot || profile.Slot != registration.FixtureSlot)
                return Fail(seed, "profile/fixture/registration slot mismatch");
            if (!GearAssetFitProfile.IsFinite(registration.RawToCanonicalEuler) ||
                Quaternion.Angle(profile.RawToCanonicalRotation, registration.RawToCanonicalRotation) > 0.01f)
                return Fail(seed, "stale registration orientation");
            if (!fixture.TryResolveSeat(item.SocketId, out var boundFrame, out var boundSeat, out var bindingError))
                return Fail(seed, bindingError);
            if (registration.GearFrameId != boundFrame.FrameId || registration.FunctionalLandmarkId != boundSeat.DatumId)
                return Fail(seed, "registration frame/seat mismatch");
            if (!Mathf.Approximately(registration.TargetPrimaryDimensionMetres, fixture.PrimaryMeasurement.ReferenceValueMetres) ||
                (profile.CavitySource == GearAssetCavitySource.AuthoredVirtualCavity &&
                 !Mathf.Approximately(registration.MeasuredPrimaryDimensionMetres, profile.CavitySpan(fixture.PrimaryMeasurement.Axis))))
                return Fail(seed, "stale registration primary measurement");

            seed.SocketId = item.SocketId;
            GearSocket socket;
            try
            {
                socket = GearMounter.ResolveSocket(heroRoot, item.SocketId);
            }
            catch (Exception exception)
            {
                return Fail(seed, exception.Message);
            }

            if (!TryResolveFrame(heroRoot, fixture, socket, out var frame, out var anchor, out var frameError))
                return Fail(seed, frameError);

            seed.FrameId = frame.FrameId;

            if (!frame.TryResolveLocalRotation(out var frameLocalRotation, out var basisError))
                return Fail(seed, basisError);

            // --- SCALE: exactly the registration's single scalar. No per-axis correction exists here. ---
            var scale = registration.UniformNormalizationScale;
            seed.LocalScale = new Vector3(scale, scale, scale);

            // --- ROTATION -------------------------------------------------------------------------
            // Place the asset so its CANONICAL axes coincide with the Gear Frame's world axes. Solving
            // it as a relationship is what makes arbitrary bone/socket roll cancel instead of leaking
            // into an authored Euler nobody can sanity-check.
            var frameWorldRotation = anchor.rotation * frameLocalRotation;
            var rawToCanonical = profile.RawToCanonicalRotation;
            var desiredWorldRotation = frameWorldRotation * rawToCanonical;
            var socketLocalRotation = Quaternion.Inverse(socket.transform.rotation) * desiredWorldRotation;
            seed.LocalEulerAngles = socketLocalRotation.eulerAngles;

            // --- POSITION -------------------------------------------------------------------------
            // Align the asset's own functional landmark onto the fixture datum it answers. Refuse
            // rather than guess: an invented landmark is an invented fit.
            var datumId = registration.FunctionalLandmarkId;
            if (string.IsNullOrEmpty(datumId))
                return Fail(seed, "registration names no functional landmark to align");
            if (!fixture.TryGetDatum(datumId, out var datum))
                return Fail(seed, "fixture has no datum " + datumId);
            if (!datum.IsFunctional)
                return Fail(seed, datumId + " is " + datum.Role + ", not FunctionalFit, so it cannot seat an asset");
            if (datum.FrameId != frame.FrameId)
                return Fail(seed, datumId + " belongs to frame " + datum.FrameId + ", not " + frame.FrameId);

            seed.DatumId = datumId;
            var assetLandmarkId = AssetLandmarkIdFor(datumId);
            seed.AssetLandmarkId = assetLandmarkId;

            if (!profile.TryGetLandmark(assetLandmarkId, out var assetLandmark))
            {
                return Fail(seed,
                    "asset fit profile declares no " + assetLandmarkId + " landmark, so this asset " +
                    "cannot be seated against " + datumId + ". Author that landmark on the profile; " +
                    "it will not be invented here.");
            }

            // A canonical-space offset scales by the uniform scalar and rotates by the frame, because
            // the asset was just oriented so its canonical axes ARE the frame axes.
            var datumWorld = anchor.TransformPoint(frame.OriginInAnchor) +
                             frameWorldRotation * datum.LocalCenter;
            var landmarkRaw = Quaternion.Inverse(rawToCanonical) * assetLandmark.PositionInCanonical;
            if (item.MirrorX) landmarkRaw.x = -landmarkRaw.x;
            var landmarkOffsetWorld = desiredWorldRotation * (landmarkRaw * scale);
            var gearWorldPosition = datumWorld - landmarkOffsetWorld;
            seed.LocalPosition = socket.transform.InverseTransformPoint(gearWorldPosition);

            seed.IsComplete = true;
            seed.Error = string.Empty;
            seed.Note =
                "Seed derived from " + frame.FrameId + " on socket '" + item.SocketId + "'. Uniform " +
                "scale " + scale.ToString("F5") + " from the registration; socket-local rotation " +
                "derived by composing the Gear Frame with the profile raw-to-canonical rotation (never " +
                "hand-authored); position derived by aligning " + assetLandmarkId + " (" +
                assetLandmark.Provenance + ") onto fixture " + datumId + ".";
            return seed;
        }

        /// <summary>
        /// Resolve only the fixture's explicit socket binding and verify its real bone parent.
        /// </summary>
        public static bool TryResolveFrame(
            Transform heroRoot,
            GearFitFixtureDefinition fixture,
            GearSocket socket,
            out GearFitFrame frame,
            out Transform anchor,
            out string error)
        {
            frame = default(GearFitFrame);
            anchor = null;
            error = string.Empty;

            if (fixture == null || socket == null)
            { error = "missing fixture/socket"; return false; }
            if (!fixture.TryResolveSeat(socket.SocketId, out frame, out _, out error)) return false;
            if (frame.AnchorBone != socket.BoneName)
            { error = "socket bone is incompatible with explicit frame"; return false; }
            var matches = 0;
            foreach (var candidate in heroRoot.GetComponentsInChildren<Transform>(true))
                if (candidate.name == frame.AnchorBone) { anchor = candidate; matches++; }
            if (matches != 1 || socket.transform.parent != anchor)
            { error = "socket must be parented to the unique frame anchor"; return false; }

            return true;
        }

        private static Seed Fail(Seed seed, string error)
        {
            seed.IsComplete = false;
            seed.Error = error;
            return seed;
        }

        public static Transform FindDescendant(Transform root, string name)
        {
            if (root == null || string.IsNullOrEmpty(name)) return null;
            foreach (var transform in root.GetComponentsInChildren<Transform>(true))
                if (transform.name == name) return transform;
            return null;
        }
    }
}
