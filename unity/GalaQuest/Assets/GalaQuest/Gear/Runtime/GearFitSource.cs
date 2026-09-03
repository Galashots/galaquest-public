namespace GalaQuest.Gear
{
    /// <summary>
    /// Where an item's current fit came from.
    ///
    /// This exists to keep one promise the Gear Workbench makes: a fit the Owner saved is not thrown
    /// away by a routine rebuild. Before this, GearBuild.Author -> CreateOrReseed -> SeedFits could
    /// overwrite an authored transform, and AuthorAndCapture would then photograph the machine's guess
    /// while reporting it as the current fit.
    /// </summary>
    public enum GearFitSource
    {
        /// <summary>Newly created; no fit has been established yet.</summary>
        Unseeded = 0,

        /// <summary>A machine-suggested starting fit. Safe to replace automatically.</summary>
        Seeded = 1,

        /// <summary>Saved by a human in the Workbench. Never overwritten by an automatic operation.</summary>
        OwnerAuthored = 2,
    }
}
