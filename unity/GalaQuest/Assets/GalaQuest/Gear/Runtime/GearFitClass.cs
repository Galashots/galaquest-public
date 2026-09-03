namespace GalaQuest.Gear
{
    /// <summary>
    /// Selects which shared validation rules apply to an item. This is a CLASS of gear, not an item:
    /// every helmet is Headgear, so adding another helmet selects an existing value rather than adding one.
    /// </summary>
    public enum GearFitClass
    {
        /// <summary>Rigid gear with no class-specific envelope beyond generic sanity checks.</summary>
        RigidGeneric = 0,

        /// <summary>Head-worn rigid gear validated against the Head Fit Proxy.</summary>
        Headgear = 1,

        /// <summary>Gear carried on an arm/hand socket.</summary>
        Handheld = 2,

        /// <summary>Gear seated on a shoulder socket.</summary>
        Shoulder = 3,
    }
}
