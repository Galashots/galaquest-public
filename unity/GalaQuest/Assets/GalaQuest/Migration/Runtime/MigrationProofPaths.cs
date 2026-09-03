namespace GalaQuest.Migration
{
    /// <summary>
    /// Stable runtime identities for the bounded migration proof. These are semantic names, not
    /// Unity asset GUIDs and not gameplay contracts.
    /// </summary>
    public static class MigrationProofPaths
    {
        public const string SceneName = "MigrationProof";
        public const string KeeperSemanticId = "world.keeper";
        public const string SwordSemanticId = "gear.sword.ironwood";
        public const string KeeperObjectName = "MigrationProof Lantern Keeper";
        public const string SwordObjectName = "MigrationProof Ironwood Sword";
    }
}
