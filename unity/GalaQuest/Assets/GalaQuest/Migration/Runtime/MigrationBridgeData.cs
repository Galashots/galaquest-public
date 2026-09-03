using System;
using UnityEngine;

namespace GalaQuest.Migration
{
    /// <summary>
    /// Unity-owned, imported representation of the versioned bridge. It contains no
    /// gameplay behaviour and retains the originating source identity for auditability.
    /// </summary>
    public sealed class MigrationBridgeData : ScriptableObject
    {
        [SerializeField] private string schema;
        [SerializeField] private int schemaVersion;
        [SerializeField] private string bridgeVersion;
        [SerializeField] private string originatingGitSha;
        [SerializeField] private string sourceRepository;
        [SerializeField] private string unitConvention;
        [SerializeField] private MigrationImportedMovement movement;
        [SerializeField] private MigrationImportedAsset[] assets;

        public string Schema => schema;
        public int SchemaVersion => schemaVersion;
        public string BridgeVersion => bridgeVersion;
        public string OriginatingGitSha => originatingGitSha;
        public string SourceRepository => sourceRepository;
        public string UnitConvention => unitConvention;
        public MigrationImportedMovement Movement => movement;
        public MigrationImportedAsset[] Assets => assets;

        public void Apply(MigrationBridgeDocument document)
        {
            document.Validate();
            schema = document.schema;
            schemaVersion = document.schemaVersion;
            bridgeVersion = document.bridgeVersion;
            originatingGitSha = document.originatingGitSha;
            sourceRepository = document.sourceRepository;
            unitConvention = document.unitConvention;
            movement = new MigrationImportedMovement
            {
                SemanticId = document.contracts.movement.semanticId,
                SourcePath = document.contracts.movement.sourcePath,
                SourceSha256 = document.contracts.movement.sourceSha256,
                WalkSpeed = document.contracts.movement.values.WALK_SPEED,
                RunSpeed = document.contracts.movement.values.RUN_SPEED,
                RunThreshold = document.contracts.movement.values.RUN_THRESHOLD,
                RunDeflection = document.contracts.movement.values.RUN_DEFLECTION
            };

            assets = new MigrationImportedAsset[document.assets.Length];
            for (var index = 0; index < document.assets.Length; index++)
            {
                var source = document.assets[index];
                assets[index] = new MigrationImportedAsset
                {
                    SemanticId = source.semanticId,
                    DisplayName = source.displayName,
                    Role = source.role,
                    SourcePath = source.sourcePath,
                    SourceSha256 = source.sourceSha256,
                    SourceSizeBytes = source.sourceSizeBytes,
                    MeshCount = source.structure.meshCount,
                    PrimitiveCount = source.structure.primitiveCount,
                    MaterialCount = source.structure.materialCount,
                    NodeCount = source.structure.nodeCount,
                    SkinCount = source.structure.skinCount,
                    JointCount = source.structure.jointCount,
                    AnimationClipCount = source.structure.animationClipCount,
                    HasSkin = source.structure.hasSkin,
                    HasAnimation = source.structure.hasAnimation
                };
            }
        }
    }

    [Serializable]
    public sealed class MigrationImportedMovement
    {
        [SerializeField] private string semanticId;
        [SerializeField] private string sourcePath;
        [SerializeField] private string sourceSha256;
        [SerializeField] private float walkSpeed;
        [SerializeField] private float runSpeed;
        [SerializeField] private float runThreshold;
        [SerializeField] private float runDeflection;

        public string SemanticId { get => semanticId; set => semanticId = value; }
        public string SourcePath { get => sourcePath; set => sourcePath = value; }
        public string SourceSha256 { get => sourceSha256; set => sourceSha256 = value; }
        public float WalkSpeed { get => walkSpeed; set => walkSpeed = value; }
        public float RunSpeed { get => runSpeed; set => runSpeed = value; }
        public float RunThreshold { get => runThreshold; set => runThreshold = value; }
        public float RunDeflection { get => runDeflection; set => runDeflection = value; }
    }

    [Serializable]
    public sealed class MigrationImportedAsset
    {
        [SerializeField] private string semanticId;
        [SerializeField] private string displayName;
        [SerializeField] private string role;
        [SerializeField] private string sourcePath;
        [SerializeField] private string sourceSha256;
        [SerializeField] private long sourceSizeBytes;
        [SerializeField] private int meshCount;
        [SerializeField] private int primitiveCount;
        [SerializeField] private int materialCount;
        [SerializeField] private int nodeCount;
        [SerializeField] private int skinCount;
        [SerializeField] private int jointCount;
        [SerializeField] private int animationClipCount;
        [SerializeField] private bool hasSkin;
        [SerializeField] private bool hasAnimation;

        public string SemanticId { get => semanticId; set => semanticId = value; }
        public string DisplayName { get => displayName; set => displayName = value; }
        public string Role { get => role; set => role = value; }
        public string SourcePath { get => sourcePath; set => sourcePath = value; }
        public string SourceSha256 { get => sourceSha256; set => sourceSha256 = value; }
        public long SourceSizeBytes { get => sourceSizeBytes; set => sourceSizeBytes = value; }
        public int MeshCount { get => meshCount; set => meshCount = value; }
        public int PrimitiveCount { get => primitiveCount; set => primitiveCount = value; }
        public int MaterialCount { get => materialCount; set => materialCount = value; }
        public int NodeCount { get => nodeCount; set => nodeCount = value; }
        public int SkinCount { get => skinCount; set => skinCount = value; }
        public int JointCount { get => jointCount; set => jointCount = value; }
        public int AnimationClipCount { get => animationClipCount; set => animationClipCount = value; }
        public bool HasSkin { get => hasSkin; set => hasSkin = value; }
        public bool HasAnimation { get => hasAnimation; set => hasAnimation = value; }
    }
}
