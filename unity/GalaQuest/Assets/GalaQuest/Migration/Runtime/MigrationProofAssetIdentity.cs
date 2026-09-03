using UnityEngine;

namespace GalaQuest.Migration
{
    /// <summary>
    /// Audit-only identity attached to migration proof prefabs. It contains no gameplay,
    /// networking, dialogue, or retargeting behavior.
    /// </summary>
    public sealed class MigrationProofAssetIdentity : MonoBehaviour
    {
        [SerializeField] private string semanticId;
        [SerializeField] private string role;
        [SerializeField] private string sourceGitSha;
        [SerializeField] private string sourceRepoPath;
        [SerializeField] private string sourceSha256;
        [SerializeField] private string derivativeRepoPath;
        [SerializeField] private string derivativeSha256;

        public string SemanticId => semanticId;
        public string Role => role;
        public string SourceGitSha => sourceGitSha;
        public string SourceRepoPath => sourceRepoPath;
        public string SourceSha256 => sourceSha256;
        public string DerivativeRepoPath => derivativeRepoPath;
        public string DerivativeSha256 => derivativeSha256;

        public void Apply(MigrationAssetProvenanceRecord record)
        {
            semanticId = record.semanticId;
            role = record.role;
            sourceGitSha = record.sourceGitSha;
            sourceRepoPath = record.sourceRepoPath;
            sourceSha256 = record.sourceSha256;
            derivativeRepoPath = record.derivativeRepoPath;
            derivativeSha256 = record.derivativeSha256;
        }
    }
}
