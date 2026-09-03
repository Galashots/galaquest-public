using System;

namespace GalaQuest.Migration
{
    [Serializable]
    public sealed class MigrationAssetProvenanceDocument
    {
        public string schema;
        public int schemaVersion;
        public string sourceRepository;
        public string sourceGitSha;
        public string conversionTool;
        public string conversionToolVersion;
        public MigrationAssetProvenanceRecord[] records;
    }

    [Serializable]
    public sealed class MigrationAssetProvenanceRecord
    {
        public string semanticId;
        public string displayName;
        public string role;
        public string sourceGitSha;
        public string sourceRepoPath;
        public string sourceSha256;
        public long sourceSizeBytes;
        public string conversionTool;
        public string conversionToolVersion;
        public string conversionScript;
        public string[] conversionCommand;
        public MigrationAssetConversionOptions conversionOptions;
        public MigrationSourceInspection sourceInspection;
        public string derivativeRepoPath;
        public string derivativeSha256;
        public long derivativeSizeBytes;
        public MigrationAssetDerivativeFile[] derivativeFiles;
        public string conversionDate;
    }

    [Serializable]
    public sealed class MigrationAssetDerivativeFile
    {
        public string path;
        public string kind;
        public string sha256;
        public long sizeBytes;
    }

    [Serializable]
    public sealed class MigrationAssetConversionOptions
    {
        public string axisForward;
        public string axisUp;
        public bool applyUnitScale;
        public bool bakeAnimations;
        public bool embedTextures;
        public string pathMode;
        public string stableMediaRoot;
        public bool retarget;
        public bool materialRepair;
    }

    [Serializable]
    public sealed class MigrationSourceInspection
    {
        public int nodeCount;
        public int meshCount;
        public int primitiveCount;
        public int materialCount;
        public int imageCount;
        public string[] imageMimeTypes;
        public int skinCount;
        public int jointCount;
        public MigrationSourceBounds bounds;
        public MigrationSourceAnimation[] animations;
        public MigrationSourceMaterialInput[] materialInputs;
    }

    [Serializable]
    public sealed class MigrationSourceBounds
    {
        public float[] min;
        public float[] max;
        public float[] size;
    }

    [Serializable]
    public sealed class MigrationSourceAnimation
    {
        public string name;
        public float duration;
        public int channelCount;
        public int drivenNodeCount;
    }

    [Serializable]
    public sealed class MigrationSourceMaterialInput
    {
        public string name;
        public float[] baseColorFactor;
        public int baseColorTextureIndex;
        public int baseColorImageIndex;
        public bool hasMetallicFactor;
        public float metallicFactor;
        public bool hasRoughnessFactor;
        public float roughnessFactor;
        public int metallicRoughnessTextureIndex;
        public int normalTextureIndex;
        public float[] emissiveFactor;
        public int emissiveTextureIndex;
        public int emissiveImageIndex;
        public string alphaMode;
    }
}
