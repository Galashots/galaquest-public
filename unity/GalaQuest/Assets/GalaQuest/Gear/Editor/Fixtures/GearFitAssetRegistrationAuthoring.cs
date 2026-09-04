using System;
using System.Collections.Generic;
using System.Linq;
using GalaQuest.Gear;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Registers one arbitrary rigid asset against a fixture, comparing LIKE WITH LIKE:
    ///
    ///     HERO required fit cavity   <->   ASSET intended fit cavity
    ///
    /// not the Hero's required cavity against the asset's outer shell. Outer render bounds are still
    /// measured, but only to judge silhouette and catch absurd sizes; they cannot reach the fit scale.
    ///
    /// What this demonstrates, end to end and mechanically:
    ///
    ///   1. take a raw imported model nobody authored for this contract;
    ///   2. apply a declared raw-to-canonical rotation, so its axes mean what the contract means;
    ///   3. resolve its INTENDED FIT CAVITY -- measured from a locator the asset declares, or
    ///      authored as a virtual cavity when the geometry cannot supply one honestly;
    ///   4. divide cavity by cavity to get ONE uniform scale;
    ///   5. judge the resulting silhouette against the slot's secondary proportion bands;
    ///   6. write all of that down, including which parts were measured and which were authored.
    ///
    /// What it deliberately is NOT: a batch importer, a Meshy intake, or a classifier that guesses
    /// which slot an unknown mesh belongs to. Registering a second item means calling Register with a
    /// second set of arguments and a second data asset, not extending this file.
    /// </summary>
    public static class GearFitAssetRegistrationAuthoring
    {
        public const string Folder = "Assets/GalaQuest/Gear/Editor/Fixtures/Registrations";

        public static string PathFor(string semanticAssetId)
        {
            return Folder + "/GearFitRegistration_" + semanticAssetId.Replace('.', '_') + ".asset";
        }

        /// <summary>Where an item's asset-side fit profile lives. An ordinary asset; edit it in the Inspector.</summary>
        public static string ProfilePathFor(string semanticAssetId)
        {
            return Folder + "/GearAssetFitProfile_" + semanticAssetId.Replace('.', '_') + ".asset";
        }

        public static GearFitAssetRegistration LoadRegistration(string semanticAssetId)
        {
            return AssetDatabase.LoadAssetAtPath<GearFitAssetRegistration>(PathFor(semanticAssetId));
        }

        public static GearAssetFitProfile LoadProfile(string semanticAssetId)
        {
            return AssetDatabase.LoadAssetAtPath<GearAssetFitProfile>(ProfilePathFor(semanticAssetId));
        }

        /// <summary>
        /// A registration for review evidence: the first that actually claims a fit scale, else any
        /// record at all, else null. Deliberately not tied to a named item.
        /// </summary>
        public static GearFitAssetRegistration LoadRegistrationForProof()
        {
            var all = AssetDatabase.FindAssets("t:GearFitAssetRegistration", new[] { Folder })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearFitAssetRegistration>)
                .Where(registration => registration != null)
                .OrderBy(registration => registration.SemanticAssetId)
                .ToArray();

            foreach (var registration in all)
                if (registration.HasFitScale) return registration;
            return all.FirstOrDefault();
        }

        [MenuItem("GalaQuest/Gear/Register selected gear item against fit contract")]
        public static void RegisterSelectedItem()
        {
            var item = Selection.activeObject as GearItemDefinition;
            if (item == null)
            {
                Debug.LogWarning("Select a GearItemDefinition asset first.");
                return;
            }

            var registration = EnsureRegistration(item);
            AssetDatabase.Refresh();

            if (registration.Status == GearFitRegistrationStatus.NeedsAuthoring)
            {
                Debug.LogWarning(
                    registration.SemanticAssetId + " -> NEEDS AUTHORING. " + registration.ProvenanceNote);
                return;
            }

            Debug.Log(
                "Registered " + registration.SemanticAssetId + " against the " +
                registration.FixtureSlot + " contract from its " + registration.AssetCavitySource +
                ": cavity " + registration.MeasuredPrimaryDimensionMetres.ToString("F4") +
                " m, target " + registration.TargetPrimaryDimensionMetres.ToString("F4") +
                " m, uniform scale " + registration.UniformNormalizationScale.ToString("F5") +
                ", status " + registration.Status + ".");
        }

        /// <summary>
        /// Register any gear item against the fixture its PROFILE names.
        ///
        /// The slot comes from <see cref="GearAssetFitProfile.Slot"/> and is never inferred from
        /// <see cref="GearFitClass"/>: a sword and a shield are both Handheld and obey entirely
        /// different fit semantics, so guessing from the class would quietly judge one against the
        /// other's contract. No profile means no declared slot, and that is NeedsAuthoring.
        ///
        /// Idempotent: rerunning on unchanged inputs rewrites the same record.
        /// </summary>
        public static GearFitAssetRegistration EnsureRegistration(GearItemDefinition item)
        {
            if (item == null) throw new ArgumentNullException("item");
            if (item.SourceModel == null)
                throw new MissingReferenceException(item.SemanticId + " has no source model to measure.");

            EnsureFolder();
            var profile = LoadProfile(item.SemanticId);

            if (profile == null)
            {
                return WriteUnseedable(
                    item,
                    "No GearAssetFitProfile exists at " + ProfilePathFor(item.SemanticId) + ", so this " +
                    "asset declares no fit slot, no raw-to-canonical orientation and no fit cavity. " +
                    "Create that profile and author its fit data. Nothing is inferred from the item's " +
                    "GearFitClass, because different Handheld items obey different fit semantics.");
            }

            var fixture = AssetDatabase.LoadAssetAtPath<GearFitFixtureDefinition>(
                GearFitFixtureKitAuthoring.PathFor(profile.Slot));
            if (fixture == null)
                throw new System.IO.FileNotFoundException(
                    profile.Slot + " fixture missing; create the fit fixture kit first.");

            var instance = (GameObject)PrefabUtility.InstantiatePrefab(item.SourceModel);
            Result result;
            try
            {
                instance.transform.position = Vector3.zero;
                instance.transform.rotation = Quaternion.identity;
                instance.transform.localScale = Vector3.one;

                result = Register(
                    fixture,
                    item.SemanticId,
                    item.SourceRepoPath,
                    instance,
                    profile,
                    // Raw-to-canonical comes from the PROFILE, which states how the source art is
                    // oriented. It is deliberately NOT read from the item's localEulerAngles: that is a
                    // socket-local value and means a different thing.
                    profile.RawToCanonicalEuler,
                    PrimaryLandmarkFor(fixture),
                    "Registered against " + fixture.Slot + " as declared by " +
                    ProfilePathFor(item.SemanticId) + ".");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }

            return Write(PathFor(item.SemanticId), fixture.Slot, result, item.LocalScale.x);
        }

        [MenuItem("GalaQuest/Gear/Seed selected gear item from its registration")]
        public static void SeedSelectedItem()
        {
            var item = Selection.activeObject as GearItemDefinition;
            if (item == null)
            {
                Debug.LogWarning("Select a GearItemDefinition asset first.");
                return;
            }

            var seed = SolveSeedFor(item, out var error);
            if (!seed.IsComplete)
            {
                Debug.LogWarning(item.SemanticId + " cannot be seeded: " +
                                 (string.IsNullOrEmpty(seed.Error) ? error : seed.Error));
                return;
            }

            if (!item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale))
            {
                Debug.Log(item.SemanticId + " keeps its Owner-authored fit; the derived seed was not " +
                          "applied. Use the explicit destructive reseed command if you truly intend to " +
                          "discard Owner work.");
                return;
            }

            EditorUtility.SetDirty(item);
            AssetDatabase.SaveAssets();
            Debug.Log(item.SemanticId + " seeded. " + seed.Note);
        }

        /// <summary>
        /// Derive the socket-local seed for an item against a throwaway hero instance. Headless-safe,
        /// so tests and batch commands can use the same path the menu does.
        /// </summary>
        public static GearFitSeedSolver.Seed SolveSeedFor(GearItemDefinition item, out string error)
        {
            error = string.Empty;
            var registration = LoadRegistration(item.SemanticId);
            var profile = LoadProfile(item.SemanticId);
            if (registration == null)
            {
                error = "no registration; register the item first";
                return default(GearFitSeedSolver.Seed);
            }

            var fixture = profile == null
                ? null
                : AssetDatabase.LoadAssetAtPath<GearFitFixtureDefinition>(
                    GearFitFixtureKitAuthoring.PathFor(profile.Slot));

            var heroPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            if (heroPrefab == null)
            {
                error = "GQ_HERO_V1 prefab missing";
                return default(GearFitSeedSolver.Seed);
            }

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(heroPrefab);
            try
            {
                return GearFitSeedSolver.Solve(hero.transform, item, fixture, profile, registration);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(hero);
            }
        }

        /// <summary>Record an item that cannot be registered at all, without claiming a scale.</summary>
        private static GearFitAssetRegistration WriteUnseedable(GearItemDefinition item, string why)
        {
            var path = PathFor(item.SemanticId);
            var asset = AssetDatabase.LoadAssetAtPath<GearFitAssetRegistration>(path);
            if (asset == null)
            {
                asset = ScriptableObject.CreateInstance<GearFitAssetRegistration>();
                AssetDatabase.CreateAsset(asset, path);
            }

            asset.Configure(
                item.SemanticId, item.SourceRepoPath, default(GearFitFixtureSlot), "unassigned",
                string.Empty, Vector3.zero, Vector3.one,
                GearFitMeasurementSource.Unclassified, GearAssetCavitySource.Unclassified,
                GearFitPrimaryMetric.Unclassified, GearFitFrameAxis.Right,
                0f, 0f, 0f, GearFitValueProvenance.Unclassified,
                GearFitRegistrationStatus.NeedsAuthoring, Vector3.zero, new[] { why },
                item.LocalScale.x, "NO FIT SCALE IS CLAIMED. " + why);
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
            return asset;
        }

        /// <summary>
        /// The FunctionalFit datum an incoming asset of this slot seats against.
        ///
        /// A slot sizes an asset by its primary measurement but does not necessarily SEAT it there: a
        /// shield is sized by board height and positioned by its grip. Where a fixture declares an
        /// explicit seating datum, that wins; otherwise the primary datum is also the seat.
        /// </summary>
        private static string PrimaryLandmarkFor(GearFitFixtureDefinition fixture)
        {
            foreach (var datum in fixture.Datums)
            {
                if (datum.Role != GearFitDatumRole.FunctionalFit) continue;
                if (!datum.DatumId.EndsWith("_GRIP", StringComparison.Ordinal)) continue;
                return datum.DatumId;
            }

            return fixture.PrimaryMeasurement.SourceDatumId;
        }

        /// <summary>Persist a computed registration. Public so calibration work can reuse it.</summary>
        public static GearFitAssetRegistration Write(
            string path, GearFitFixtureSlot slot, Result result, float ownerScaleForComparison)
        {
            var asset = AssetDatabase.LoadAssetAtPath<GearFitAssetRegistration>(path);
            if (asset == null)
            {
                asset = ScriptableObject.CreateInstance<GearFitAssetRegistration>();
                AssetDatabase.CreateAsset(asset, path);
            }

            var note = result.Note;
            if (ownerScaleForComparison > 0f && result.Status != GearFitRegistrationStatus.NeedsAuthoring)
            {
                // Recorded next to the contract's own number so the gap is reviewable. NOT used to
                // tune the contract: doing that would launder an eyeballed fit into a measurement.
                note += " The Owner-authored uniform scale for this item is " +
                        ownerScaleForComparison.ToString("F5") + "; the contract computes " +
                        (result.UniformScale / ownerScaleForComparison).ToString("P1") + " of it.";
            }

            asset.Configure(
                result.SemanticAssetId,
                result.SourceRepoPath,
                slot,
                result.FrameId,
                result.LandmarkId,
                result.RawToCanonicalEuler,
                Vector3.one,
                result.MeasurementSource,
                result.CavitySource,
                result.Metric,
                result.Axis,
                result.MeasuredPrimary,
                result.TargetPrimary,
                result.UniformScale,
                result.MeasurementProvenance,
                result.Status,
                result.NormalizedRenderSize,
                result.Findings,
                ownerScaleForComparison,
                note);
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
            return asset;
        }

        /// <summary>The computed registration, before it is written to an asset.</summary>
        public sealed class Result
        {
            public string SemanticAssetId;
            public string SourceRepoPath;
            public string FrameId;
            public string LandmarkId;
            public Vector3 RawToCanonicalEuler;
            public GearFitMeasurementSource MeasurementSource;
            public GearAssetCavitySource CavitySource;
            public GearFitValueProvenance MeasurementProvenance;
            public GearFitPrimaryMetric Metric;
            public GearFitFrameAxis Axis;

            /// <summary>The asset's intended fit cavity along the primary axis. Drives the scale.</summary>
            public float MeasuredPrimary;

            public float TargetPrimary;
            public float UniformScale;

            /// <summary>Outer render bounds. Silhouette analysis only.</summary>
            public Vector3 RawRenderSize;

            public Vector3 NormalizedRenderSize;
            public GearFitRegistrationStatus Status;
            public string[] Findings;
            public string Note;
        }

        /// <summary>
        /// Measure an instantiated asset against a fixture and compute its uniform normalization.
        /// Pure computation over a live instance the caller owns; writes nothing.
        /// </summary>
        public static Result Register(
            GearFitFixtureDefinition fixture,
            string semanticAssetId,
            string sourceRepoPath,
            GameObject instance,
            GearAssetFitProfile profile,
            Vector3 rawToCanonicalEuler,
            string landmarkId,
            string note)
        {
            if (fixture == null) throw new ArgumentNullException("fixture");
            if (instance == null) throw new ArgumentNullException("instance");

            var primary = fixture.PrimaryMeasurement;
            var rawToCanonical = Quaternion.Euler(rawToCanonicalEuler);

            // Outer bounds are measured FIRST and then deliberately set aside. They describe the
            // silhouette, and nothing below is allowed to derive a fit scale from them.
            var renderSize = GearAssetFitProbe.MeasureRenderBounds(instance, rawToCanonical);

            var resolved = ResolveCavity(instance, profile, rawToCanonical, semanticAssetId);
            if (!resolved.Found)
            {
                return new Result
                {
                    SemanticAssetId = semanticAssetId,
                    SourceRepoPath = sourceRepoPath,
                    FrameId = fixture.PrimaryFrame.FrameId,
                    LandmarkId = landmarkId,
                    RawToCanonicalEuler = rawToCanonicalEuler,
                    MeasurementSource = GearFitMeasurementSource.Unclassified,
                    CavitySource = GearAssetCavitySource.Unclassified,
                    MeasurementProvenance = GearFitValueProvenance.Unclassified,
                    Metric = primary.Metric,
                    Axis = primary.Axis,
                    MeasuredPrimary = 0f,
                    TargetPrimary = primary.ReferenceValueMetres,
                    UniformScale = 0f,
                    RawRenderSize = renderSize,
                    NormalizedRenderSize = Vector3.zero,
                    Status = GearFitRegistrationStatus.NeedsAuthoring,
                    Findings = new[] { resolved.Error },
                    Note = note + " NO FIT SCALE IS CLAIMED. " + resolved.Error +
                           " Outer render bounds are " + Format(renderSize) + " m, but normalizing on " +
                           "those would compare the Hero's required cavity to this asset's shell and " +
                           "decoration, so no scale is derived from them. Declare a " +
                           GearAssetFitProbe.CavityLocatorName + " locator on the source art, or " +
                           "author a virtual cavity profile, to register this asset.",
                };
            }

            var measured = GearFitFrame.Component(resolved.Size, primary.Axis);
            if (!primary.TryGetUniformScale(measured, out var uniformScale))
                throw new InvalidOperationException(
                    semanticAssetId + " has a fit cavity of " + measured.ToString("F5") + " m along " +
                    primary.Axis + "; a uniform normalization scale cannot be computed from that.");

            // UNIFORM SCALE FIRST: one scalar, derived from cavity-to-cavity, applied to everything.
            var normalizedRender = renderSize * uniformScale;

            var findings = new List<string>();
            var status = GearFitRegistrationStatus.Accepted;
            foreach (var check in fixture.SecondaryProportionChecks)
            {
                // Silhouette checks run on the RENDER bounds: that is the shape a player sees, and it
                // is the right thing to judge for absurdity. It is simply not the right thing to scale by.
                var verdict = check.Evaluate(normalizedRender, out var ratio);
                if (verdict == GearFitProportionVerdict.Pass) continue;

                findings.Add(check.CheckId + " " + verdict.ToString().ToUpperInvariant() + ": " +
                             check.NumeratorAxis + "/" + check.DenominatorAxis + " = " +
                             ratio.ToString("F3") + ", accepted band [" +
                             check.WarnBelow.ToString("F2") + ", " + check.WarnAbove.ToString("F2") +
                             "], rejection outside [" + check.RejectBelow.ToString("F2") + ", " +
                             check.RejectAbove.ToString("F2") + "]");

                if (verdict == GearFitProportionVerdict.Reject)
                    status = GearFitRegistrationStatus.Rejected;
                else if (status == GearFitRegistrationStatus.Accepted)
                    status = GearFitRegistrationStatus.Warned;
            }

            if (status == GearFitRegistrationStatus.Rejected)
            {
                findings.Add(
                    "Rejected silhouettes are corrected in the ASSET. The contract will not emit a " +
                    "per-axis scale to force this into the slot.");
            }

            return new Result
            {
                SemanticAssetId = semanticAssetId,
                SourceRepoPath = sourceRepoPath,
                FrameId = fixture.PrimaryFrame.FrameId,
                LandmarkId = landmarkId,
                RawToCanonicalEuler = rawToCanonicalEuler,
                MeasurementSource = GearFitMeasurementSource.AssetFitCavity,
                CavitySource = resolved.Source,
                MeasurementProvenance = resolved.Provenance,
                Metric = primary.Metric,
                Axis = primary.Axis,
                MeasuredPrimary = measured,
                TargetPrimary = primary.ReferenceValueMetres,
                UniformScale = uniformScale,
                RawRenderSize = renderSize,
                NormalizedRenderSize = normalizedRender,
                Status = status,
                Findings = findings.ToArray(),
                Note = note + " " + resolved.Note + " Fit cavity " + Format(resolved.Size) +
                       " m gives " + measured.ToString("F4") + " m along " + primary.Axis +
                       "; the Hero requires " + primary.ReferenceValueMetres.ToString("F4") +
                       " m, so the single uniform scale is " + uniformScale.ToString("F5") +
                       ". Outer render bounds " + Format(renderSize) + " m -> " +
                       Format(normalizedRender) + " m are used for silhouette checks only.",
            };
        }

        private struct ResolvedCavity
        {
            public bool Found;
            public Vector3 Size;
            public GearAssetCavitySource Source;
            public GearFitValueProvenance Provenance;
            public string Note;
            public string Error;
        }

        /// <summary>
        /// Geometry the asset itself declares wins; an authored virtual cavity is the fallback for art
        /// that cannot supply one. Nothing is inferred from wall thickness or vertex thresholds.
        /// </summary>
        private static ResolvedCavity ResolveCavity(
            GameObject instance,
            GearAssetFitProfile profile,
            Quaternion rawToCanonical,
            string semanticAssetId)
        {
            if (GearAssetFitProbe.TryMeasureDeclaredCavity(
                    instance, rawToCanonical, out var declared, out var probeError))
            {
                return new ResolvedCavity
                {
                    Found = true,
                    Size = declared.size,
                    Source = GearAssetCavitySource.MeasuredFromAssetLocator,
                    Provenance = GearFitValueProvenance.Measured,
                    Note = "Cavity MEASURED from the " + GearAssetFitProbe.CavityLocatorName +
                           " locator the source art declares.",
                };
            }

            if (profile != null && profile.HasUsableCavity)
            {
                if (!profile.TryValidate(out var profileError))
                {
                    return new ResolvedCavity
                    {
                        Found = false,
                        Error = "asset fit profile is invalid: " + profileError,
                    };
                }

                return new ResolvedCavity
                {
                    Found = true,
                    Size = profile.CavitySizeInCanonical,
                    Source = profile.CavitySource,
                    Provenance = profile.CavityProvenance,
                    Note = "Cavity taken from the authored fit profile for " + semanticAssetId +
                           " (" + profile.CavitySource + "): " + profile.CavityNote,
                };
            }

            return new ResolvedCavity
            {
                Found = false,
                Error = semanticAssetId + " exposes no trustworthy fit cavity (" + probeError +
                        ") and no authored virtual cavity profile exists for it.",
            };
        }

        private static void EnsureFolder()
        {
            var parts = Folder.Split('/');
            var current = parts[0];
            for (var i = 1; i < parts.Length; i++)
            {
                var next = current + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[i]);
                current = next;
            }
        }

        private static string Format(Vector3 value)
        {
            return "(" + value.x.ToString("F4") + ", " + value.y.ToString("F4") + ", " +
                   value.z.ToString("F4") + ")";
        }
    }
}
