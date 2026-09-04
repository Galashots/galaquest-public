using System;
using System.Collections.Generic;
using System.Linq;
using GalaQuest.Gear;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// The minimal proof that an arbitrary rigid asset can be registered against a fixture, run on one
    /// real item: the Silverguard helmet.
    ///
    /// What this demonstrates, end to end and mechanically:
    ///
    ///   1. take a raw imported model nobody authored for this contract;
    ///   2. apply a declared raw-to-canonical rotation, so its axes mean what the contract means;
    ///   3. measure it along the slot's PRIMARY axis;
    ///   4. divide to get ONE uniform scale;
    ///   5. judge the resulting silhouette against the slot's secondary proportion bands;
    ///   6. write all of that down, including which parts were measured and which were authored.
    ///
    /// What it deliberately is NOT: a batch importer, a Meshy intake, or a classifier that guesses
    /// which slot an unknown mesh belongs to. Registering a second item means calling Register with a
    /// second set of arguments, not extending this file.
    ///
    /// The Silverguard helmet is a useful proof precisely because it is known-imperfect: it is the
    /// item whose hand fit has already been the subject of a fit diagnosis, so a contract that quietly
    /// blessed it would be worthless.
    /// </summary>
    public static class GearFitAssetRegistrationAuthoring
    {
        public const string Folder = "Assets/GalaQuest/Gear/Editor/Fixtures/Registrations";

        public const string SilverguardHelmetDefinitionPath =
            "Assets/GalaQuest/Gear/Definitions/Gear_SilverguardHelmet.asset";

        [MenuItem("GalaQuest/Gear/Register proof asset against fit contract")]
        public static void RegisterProofAsset()
        {
            var registration = EnsureSilverguardHelmetRegistration();
            AssetDatabase.Refresh();
            Debug.Log(
                "Registered " + registration.SemanticAssetId + " against the " +
                registration.FixtureSlot + " contract: measured " +
                registration.MeasuredPrimaryDimensionMetres.ToString("F4") + " m, target " +
                registration.TargetPrimaryDimensionMetres.ToString("F4") + " m, uniform scale " +
                registration.UniformNormalizationScale.ToString("F5") + ", status " +
                registration.Status + ".");
        }

        public static string PathFor(string semanticAssetId)
        {
            return Folder + "/GearFitRegistration_" + semanticAssetId.Replace('.', '_') + ".asset";
        }

        public static GearFitAssetRegistration LoadSilverguardHelmetRegistration()
        {
            return AssetDatabase.LoadAssetAtPath<GearFitAssetRegistration>(
                PathFor("gear.helmet.silverguard"));
        }

        /// <summary>
        /// Register the Silverguard helmet against the Helmet fixture, measuring the real mesh.
        /// Idempotent: rerunning on the same inputs rewrites the same values.
        /// </summary>
        public static GearFitAssetRegistration EnsureSilverguardHelmetRegistration()
        {
            var item = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(SilverguardHelmetDefinitionPath);
            if (item == null)
                throw new System.IO.FileNotFoundException(
                    "Proof asset missing: " + SilverguardHelmetDefinitionPath);
            if (item.SourceModel == null)
                throw new MissingReferenceException(
                    item.SemanticId + " has no source model to measure.");

            var fixture = AssetDatabase.LoadAssetAtPath<GearFitFixtureDefinition>(
                GearFitFixtureKitAuthoring.PathFor(GearFitFixtureSlot.Helmet));
            if (fixture == null)
                throw new System.IO.FileNotFoundException(
                    "Helmet fixture missing; create the fit fixture kit first.");

            var result = Register(
                fixture,
                item.SemanticId,
                item.SourceRepoPath,
                item.SourceModel,
                // The raw Silverguard mesh is imported nose-down relative to the head socket. That
                // 180-degree flip is a human observation about the source art, carried over from the
                // Owner-authored fit on the GearItemDefinition rather than guessed here.
                item.LocalEulerAngles,
                "FIT_CROWN",
                "Raw-to-canonical rotation is AUTHORED: it is copied from the Owner-authored fit on " +
                SilverguardHelmetDefinitionPath + ", which is the human statement of how this source " +
                "art is oriented. Everything after that point is MEASURED from the mesh and DERIVED " +
                "by division. This registration does not modify the Owner-authored fit.");

            EnsureFolder();
            var path = PathFor(item.SemanticId);
            var asset = AssetDatabase.LoadAssetAtPath<GearFitAssetRegistration>(path);
            if (asset == null)
            {
                asset = ScriptableObject.CreateInstance<GearFitAssetRegistration>();
                AssetDatabase.CreateAsset(asset, path);
            }

            asset.Configure(
                result.SemanticAssetId,
                result.SourceRepoPath,
                fixture.Slot,
                result.FrameId,
                result.LandmarkId,
                result.RawToCanonicalEuler,
                Vector3.one,
                result.Metric,
                result.Axis,
                result.MeasuredPrimary,
                result.TargetPrimary,
                result.UniformScale,
                GearFitValueProvenance.Measured,
                result.Status,
                result.NormalizedSize,
                result.Findings,
                // The Owner already hand-fitted this helmet. Recording their scale next to the
                // contract's makes the calibration gap a reviewable fact instead of a surprise. It is
                // NOT used to tune the contract: doing that would launder an eyeballed fit into a
                // measurement, which is exactly what this contract exists to stop.
                item.LocalScale.x,
                result.Note + " The Owner-authored uniform scale for this item is " +
                item.LocalScale.x.ToString("F5") + ", so the contract sizes it " +
                (result.UniformScale / item.LocalScale.x).ToString("P1") +
                " of the hand fit. The contract normalizes helmet OUTER width to the head CAVITY " +
                "width, which omits shell thickness, so it is expected to run smaller than a hand fit.");
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
            public GearFitPrimaryMetric Metric;
            public GearFitFrameAxis Axis;
            public float MeasuredPrimary;
            public float TargetPrimary;
            public float UniformScale;
            public Vector3 RawSizeInCanonical;
            public Vector3 NormalizedSize;
            public GearFitRegistrationStatus Status;
            public string[] Findings;
            public string Note;
        }

        /// <summary>
        /// Measure a model against a fixture and compute its uniform normalization. Pure computation
        /// over an instantiated prefab; writes nothing.
        /// </summary>
        public static Result Register(
            GearFitFixtureDefinition fixture,
            string semanticAssetId,
            string sourceRepoPath,
            GameObject sourceModel,
            Vector3 rawToCanonicalEuler,
            string landmarkId,
            string note)
        {
            if (fixture == null) throw new ArgumentNullException("fixture");
            if (sourceModel == null) throw new ArgumentNullException("sourceModel");

            var primary = fixture.PrimaryMeasurement;
            var rawSize = MeasureCanonicalSize(sourceModel, Quaternion.Euler(rawToCanonicalEuler));
            var measured = GearFitFrame.Component(rawSize, primary.Axis);

            if (!primary.TryGetUniformScale(measured, out var uniformScale))
                throw new InvalidOperationException(
                    semanticAssetId + " measures " + measured.ToString("F5") + " m along " +
                    primary.Axis + "; a uniform normalization scale cannot be computed from that.");

            // UNIFORM SCALE FIRST: one scalar on all three axes, then judge what came out.
            var normalized = rawSize * uniformScale;

            var findings = new List<string>();
            var status = GearFitRegistrationStatus.Accepted;
            foreach (var check in fixture.SecondaryProportionChecks)
            {
                var verdict = check.Evaluate(normalized, out var ratio);
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
                Metric = primary.Metric,
                Axis = primary.Axis,
                MeasuredPrimary = measured,
                TargetPrimary = primary.ReferenceValueMetres,
                UniformScale = uniformScale,
                RawSizeInCanonical = rawSize,
                NormalizedSize = normalized,
                Status = status,
                Findings = findings.ToArray(),
                Note = note + " Raw canonical size " + Format(rawSize) + " m; after the single uniform " +
                       "scale " + uniformScale.ToString("F5") + " it is " + Format(normalized) + " m.",
            };
        }

        /// <summary>
        /// Bounding size of a model's renderers, in canonical axes, after the raw-to-canonical rotation.
        /// Uses mesh bounds directly rather than a posed bake: this contract only covers RIGID gear.
        /// </summary>
        public static Vector3 MeasureCanonicalSize(GameObject sourceModel, Quaternion rawToCanonical)
        {
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(sourceModel);
            try
            {
                instance.transform.position = Vector3.zero;
                instance.transform.rotation = rawToCanonical;
                instance.transform.localScale = Vector3.one;

                var filters = instance.GetComponentsInChildren<MeshFilter>(true)
                    .Where(filter => filter.sharedMesh != null)
                    .ToArray();
                if (filters.Length == 0)
                    throw new MissingReferenceException(
                        sourceModel.name + " has no mesh to measure; the contract covers rigid gear only.");

                var min = Vector3.one * float.MaxValue;
                var max = Vector3.one * float.MinValue;
                foreach (var filter in filters)
                {
                    foreach (var vertex in filter.sharedMesh.vertices)
                    {
                        var point = filter.transform.TransformPoint(vertex);
                        min = Vector3.Min(min, point);
                        max = Vector3.Max(max, point);
                    }
                }

                return max - min;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }
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
