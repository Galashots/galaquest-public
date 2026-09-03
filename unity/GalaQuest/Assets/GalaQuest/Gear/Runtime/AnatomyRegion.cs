namespace GalaQuest.Gear
{
    /// <summary>
    /// Semantic anatomy a gear item declares that it covers, carried forward from the Three.js
    /// anatomy-occlusion vocabulary in docs/pipeline/character-armoring.md.
    ///
    /// Declaring coverage means the covered anatomy MAY be hidden or intersected, so the item is not
    /// pushed outward to wrap it. Checkpoint A stores and validates the declaration; it does not
    /// re-implement index-buffer occlusion, and it does not split the Hero into extra renderers.
    /// </summary>
    public enum AnatomyRegion
    {
        Hair = 0,
        Ears = 1,
        Beard = 2,
        Torso = 3,
        UpperArms = 4,
        LowerArms = 5,
        Hands = 6,
        HipsLegs = 7,
        Feet = 8,
    }
}
