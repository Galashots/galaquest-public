using System;
using UnityEngine;

namespace GalaQuest.Migration
{
    [Serializable]
    public sealed class VisibleArmorManifestDocument
    {
        public string schema;
        public int schemaVersion;
        public string originatingGitSha;
        public string sourceRepository;
        public string sourceCoordinateSystem;
        public string destinationCoordinateSystem;
        public string unitConvention;
        public VisibleArmorAsset hero;
        public VisibleArmorAsset gear;
        public VisibleArmorFitAuthority fitAuthority;

        public void Validate()
        {
            Require(schema == VisibleArmorManifest.Schema, "schema");
            Require(schemaVersion == VisibleArmorManifest.SchemaVersion, "schemaVersion");
            RequireHex(originatingGitSha, 40, "originatingGitSha");
            Require(sourceRepository == "Galashots/galaquest-public", "sourceRepository");
            Require(!string.IsNullOrWhiteSpace(sourceCoordinateSystem), "sourceCoordinateSystem");
            Require(!string.IsNullOrWhiteSpace(destinationCoordinateSystem), "destinationCoordinateSystem");
            Require(unitConvention == "metres", "unitConvention");
            ValidateAsset(hero, "hero");
            ValidateAsset(gear, "gear");
            Require(fitAuthority != null, "fitAuthority");
            Require(fitAuthority.runtimeSourcePath == "public/src/character/gear.js", "fitAuthority.runtimeSourcePath");
            RequireHex(fitAuthority.runtimeSourceSha256, 64, "fitAuthority.runtimeSourceSha256");
            Require(fitAuthority.semanticId == gear.semanticId, "fitAuthority.semanticId");
            Require(fitAuthority.boneName == "Head", "fitAuthority.boneName");
            Require(fitAuthority.sourceRigRootName == "Armature", "fitAuthority.sourceRigRootName");
            Require(fitAuthority.sourceRigRootScale != null && fitAuthority.sourceRigRootScale.Length == 3, "fitAuthority.sourceRigRootScale");
            Require(fitAuthority.sourceHeadPosition != null && fitAuthority.sourceHeadPosition.Length == 3, "fitAuthority.sourceHeadPosition");
            Require(fitAuthority.sourceHeadQuaternion != null && fitAuthority.sourceHeadQuaternion.Length == 4, "fitAuthority.sourceHeadQuaternion");
            ValidateTransform(fitAuthority.restRelativeToHeroRoot, "fitAuthority.restRelativeToHeroRoot");
            Require(fitAuthority.foundrySourcePath == "docs/foundry/gear/tier3_fit.json", "fitAuthority.foundrySourcePath");
            RequireHex(fitAuthority.foundrySourceSha256, 64, "fitAuthority.foundrySourceSha256");
            Require(fitAuthority.foundryRecord != null, "fitAuthority.foundryRecord");
            Require(fitAuthority.measuredSourcePath == "docs/foundry/gear/tier3_fit_measured.json", "fitAuthority.measuredSourcePath");
            RequireHex(fitAuthority.measuredSourceSha256, 64, "fitAuthority.measuredSourceSha256");
        }

        private static void ValidateAsset(VisibleArmorAsset asset, string field)
        {
            Require(asset != null, field);
            Require(!string.IsNullOrWhiteSpace(asset.semanticId), $"{field}.semanticId");
            Require(!asset.semanticId.StartsWith("guid:", StringComparison.OrdinalIgnoreCase), $"{field}.semanticId");
            Require(!string.IsNullOrWhiteSpace(asset.sourcePath), $"{field}.sourcePath");
            RequireHex(asset.sourceSha256, 64, $"{field}.sourceSha256");
            Require(asset.sourceSizeBytes > 0, $"{field}.sourceSizeBytes");
        }

        private static void ValidateTransform(VisibleArmorTransform transform, string field)
        {
            Require(transform != null, field);
            Require(transform.position != null && transform.position.Length == 3, $"{field}.position");
            Require(transform.quaternion != null && transform.quaternion.Length == 4, $"{field}.quaternion");
            Require(transform.scale != null && transform.scale.Length == 3, $"{field}.scale");
            foreach (var value in transform.position) RequireFinite(value, field);
            foreach (var value in transform.quaternion) RequireFinite(value, field);
            foreach (var value in transform.scale) RequireFinite(value, field);
        }

        private static void RequireHex(string value, int length, string field)
        {
            Require(value != null && value.Length == length, field);
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                Require(character >= '0' && character <= '9' || character >= 'a' && character <= 'f', field);
            }
        }

        private static void RequireFinite(float value, string field)
        {
            Require(!float.IsNaN(value) && !float.IsInfinity(value), field);
        }

        private static void Require(bool condition, string field)
        {
            if (!condition) throw new VisibleArmorManifestValidationException($"Invalid visible-armor manifest field: {field}.");
        }
    }

    [Serializable]
    public sealed class VisibleArmorAsset
    {
        public string semanticId;
        public string sourcePath;
        public string sourceSha256;
        public long sourceSizeBytes;
    }

    [Serializable]
    public sealed class VisibleArmorFitAuthority
    {
        public string runtimeSourcePath;
        public string runtimeSourceSha256;
        public string semanticId;
        public string boneName;
        public string sourceRigRootName;
        public float[] sourceRigRootScale;
        public float[] sourceHeadPosition;
        public float[] sourceHeadQuaternion;
        public VisibleArmorTransform restRelativeToHeroRoot;
        public string foundrySourcePath;
        public string foundrySourceSha256;
        public VisibleArmorFoundryRecord foundryRecord;
        public string measuredSourcePath;
        public string measuredSourceSha256;
    }

    [Serializable]
    public sealed class VisibleArmorFoundryRecord
    {
        public string name;
        public string glb;
        public string bone;
        public float worldHeight;
        public float[] stretch;
        public float[] offset;
        public string why;
    }

    [Serializable]
    public sealed class VisibleArmorTransform
    {
        public float[] position;
        public float[] quaternion;
        public float[] scale;
    }

    public sealed class VisibleArmorManifestValidationException : Exception
    {
        public VisibleArmorManifestValidationException(string message) : base(message) { }
    }

    public static class VisibleArmorManifest
    {
        public const string Schema = "galaquest.unity-visible-armor-proof";
        public const int SchemaVersion = 1;
        public const string AssetPath = "Assets/GalaQuest/Migration/VisibleArmorManifest.json";

        public static VisibleArmorManifestDocument Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) throw new VisibleArmorManifestValidationException("Visible-armor manifest is empty.");
            VisibleArmorManifestDocument document;
            try { document = JsonUtility.FromJson<VisibleArmorManifestDocument>(json); }
            catch (Exception exception) { throw new VisibleArmorManifestValidationException($"Visible-armor manifest JSON is invalid: {exception.Message}"); }
            if (document == null) throw new VisibleArmorManifestValidationException("Visible-armor manifest JSON did not contain an object.");
            document.Validate();
            return document;
        }
    }
}
