using System;
using UnityEngine;

namespace GalaQuest.Migration
{
    [Serializable]
    public sealed class MigrationBridgeDocument
    {
        public string schema;
        public int schemaVersion;
        public string bridgeVersion;
        public string originatingGitSha;
        public string sourceRepository;
        public MigrationCoordinateSystem sourceCoordinateSystem;
        public MigrationCoordinateSystem destinationCoordinateSystem;
        public string unitConvention;
        public MigrationContracts contracts;
        public MigrationAssetRecord[] assets;
        public MigrationTransformFixture coordinateFixture;

        public void Validate()
        {
            Require(schema == MigrationBridgeManifest.Schema, "schema");
            Require(schemaVersion == MigrationBridgeManifest.SchemaVersion, "schemaVersion");
            Require(!string.IsNullOrWhiteSpace(bridgeVersion), "bridgeVersion");
            RequireHex(originatingGitSha, 40, "originatingGitSha");
            Require(sourceRepository == MigrationBridgeManifest.SourceRepository, "sourceRepository");
            ValidateCoordinateSystem(sourceCoordinateSystem, "sourceCoordinateSystem", "Three.js/glTF", "right-handed", "Y", "-Z");
            ValidateCoordinateSystem(destinationCoordinateSystem, "destinationCoordinateSystem", "Unity", "left-handed", "Y", "+Z");
            Require(unitConvention == MigrationBridgeManifest.UnitConvention, "unitConvention");

            Require(contracts != null, "contracts");
            Require(contracts.movement != null, "contracts.movement");
            Require(contracts.movement.semanticId == "movement.speed-law", "contracts.movement.semanticId");
            Require(contracts.movement.sourcePath == "public/src/character/speed.js", "contracts.movement.sourcePath");
            RequireHex(contracts.movement.sourceSha256, 64, "contracts.movement.sourceSha256");
            Require(contracts.movement.values != null, "contracts.movement.values");
            RequireFinitePositive(contracts.movement.values.WALK_SPEED, "WALK_SPEED");
            RequireFinitePositive(contracts.movement.values.RUN_SPEED, "RUN_SPEED");
            RequireFinitePositive(contracts.movement.values.RUN_THRESHOLD, "RUN_THRESHOLD");
            RequireFinite(contracts.movement.values.RUN_DEFLECTION, "RUN_DEFLECTION");
            Require(contracts.movement.values.WALK_SPEED < contracts.movement.values.RUN_SPEED, "speed ordering");

            Require(assets != null && assets.Length == 2, "assets");
            var seenIds = new System.Collections.Generic.HashSet<string>();
            var seenPaths = new System.Collections.Generic.HashSet<string>();
            for (var index = 0; index < assets.Length; index++)
            {
                var asset = assets[index];
                Require(asset != null, $"assets[{index}]");
                Require(!string.IsNullOrWhiteSpace(asset.semanticId), $"assets[{index}].semanticId");
                Require(!asset.semanticId.StartsWith("guid:", StringComparison.OrdinalIgnoreCase), $"assets[{index}].semanticId must be semantic");
                Require(seenIds.Add(asset.semanticId), $"duplicate asset semanticId {asset.semanticId}");
                Require(!string.IsNullOrWhiteSpace(asset.sourcePath), $"assets[{index}].sourcePath");
                Require(seenPaths.Add(asset.sourcePath), $"duplicate asset sourcePath {asset.sourcePath}");
                RequireHex(asset.sourceSha256, 64, $"assets[{index}].sourceSha256");
                Require(asset.sourceSizeBytes > 0, $"assets[{index}].sourceSizeBytes");
                Require(asset.structure != null, $"assets[{index}].structure");
                Require(asset.structure.meshCount >= 0 && asset.structure.primitiveCount >= 0, $"assets[{index}].structure mesh counts");
                Require(asset.structure.materialCount >= 0 && asset.structure.nodeCount >= 0, $"assets[{index}].structure counts");
                Require(asset.structure.skinCount >= 0 && asset.structure.jointCount >= 0, $"assets[{index}].structure skin counts");
                Require(asset.structure.animationClipCount >= 0, $"assets[{index}].structure animationClipCount");
                Require(asset.role == "static-asset" || asset.role == "rigged-animated-character", $"assets[{index}].role");
            }

            Require(coordinateFixture != null, "coordinateFixture");
            ValidateTransform(coordinateFixture.source, "coordinateFixture.source");
            ValidateTransform(coordinateFixture.destination, "coordinateFixture.destination");
        }

        private static void ValidateCoordinateSystem(
            MigrationCoordinateSystem coordinateSystem,
            string field,
            string expectedName,
            string expectedHandedness,
            string expectedUpAxis,
            string expectedForwardAxis)
        {
            Require(coordinateSystem != null, field);
            Require(coordinateSystem.name == expectedName, $"{field}.name");
            Require(coordinateSystem.handedness == expectedHandedness, $"{field}.handedness");
            Require(coordinateSystem.upAxis == expectedUpAxis, $"{field}.upAxis");
            Require(coordinateSystem.forwardAxis == expectedForwardAxis, $"{field}.forwardAxis");
            Require(coordinateSystem.units == "meters", $"{field}.units");
        }

        private static void ValidateTransform(MigrationTransform transform, string field)
        {
            Require(transform != null, field);
            Require(transform.position != null && transform.position.Length == 3, $"{field}.position");
            Require(transform.rotationQuaternion != null && transform.rotationQuaternion.Length == 4, $"{field}.rotationQuaternion");
            Require(transform.scale != null && transform.scale.Length == 3, $"{field}.scale");
            for (var index = 0; index < transform.position.Length; index++)
            {
                RequireFinite(transform.position[index], $"{field}.position[{index}]");
                RequireFinite(transform.scale[index], $"{field}.scale[{index}]");
            }
            for (var index = 0; index < transform.rotationQuaternion.Length; index++)
            {
                RequireFinite(transform.rotationQuaternion[index], $"{field}.rotationQuaternion[{index}]");
            }
        }

        private static void RequireHex(string value, int length, string field)
        {
            Require(value != null && value.Length == length, field);
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                Require((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f'), field);
            }
        }

        private static void RequireFinite(float value, string field)
        {
            Require(!float.IsNaN(value) && !float.IsInfinity(value), field);
        }

        private static void RequireFinitePositive(float value, string field)
        {
            RequireFinite(value, field);
            Require(value > 0, field);
        }

        private static void Require(bool condition, string field)
        {
            if (!condition)
            {
                throw new MigrationManifestValidationException($"Invalid Migration Bridge manifest field: {field}.");
            }
        }
    }

    [Serializable]
    public sealed class MigrationCoordinateSystem
    {
        public string name;
        public string handedness;
        public string upAxis;
        public string forwardAxis;
        public string units;
    }

    [Serializable]
    public sealed class MigrationContracts
    {
        public MigrationMovementContract movement;
    }

    [Serializable]
    public sealed class MigrationMovementContract
    {
        public string semanticId;
        public string sourcePath;
        public string sourceSha256;
        public MigrationMovementValues values;
    }

    [Serializable]
    public sealed class MigrationMovementValues
    {
        public float WALK_SPEED;
        public float RUN_SPEED;
        public float RUN_THRESHOLD;
        public float RUN_DEFLECTION;
    }

    [Serializable]
    public sealed class MigrationAssetRecord
    {
        public string semanticId;
        public string displayName;
        public string role;
        public string sourcePath;
        public string sourceSha256;
        public long sourceSizeBytes;
        public MigrationAssetStructure structure;
        public string registryAuthority;
    }

    [Serializable]
    public sealed class MigrationAssetStructure
    {
        public int meshCount;
        public int primitiveCount;
        public int materialCount;
        public int nodeCount;
        public int skinCount;
        public int jointCount;
        public int animationClipCount;
        public bool hasSkin;
        public bool hasAnimation;
    }

    [Serializable]
    public sealed class MigrationTransformFixture
    {
        public MigrationTransform source;
        public MigrationTransform destination;
    }

    [Serializable]
    public sealed class MigrationTransform
    {
        public float[] position;
        public float[] rotationQuaternion;
        public float[] scale;
    }

    public sealed class MigrationManifestValidationException : Exception
    {
        public MigrationManifestValidationException(string message) : base(message)
        {
        }
    }

    public static class MigrationBridgeManifest
    {
        public const string Schema = "galaquest.unity-migration-bridge";
        public const int SchemaVersion = 1;
        public const string SourceRepository = "Galashots/galaquest-public";
        public const string UnitConvention = "1 meter in Three.js/glTF becomes 1 Unity unit";

        public static MigrationBridgeDocument Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                throw new MigrationManifestValidationException("Migration Bridge manifest is empty.");
            }

            MigrationBridgeDocument document;
            try
            {
                document = JsonUtility.FromJson<MigrationBridgeDocument>(json);
            }
            catch (Exception exception)
            {
                throw new MigrationManifestValidationException($"Migration Bridge manifest JSON is invalid: {exception.Message}");
            }

            if (document == null)
            {
                throw new MigrationManifestValidationException("Migration Bridge manifest JSON did not contain an object.");
            }

            document.Validate();
            return document;
        }
    }
}
