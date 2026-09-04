using System.Linq;
using GalaQuest.Gear;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Runs the ordinary registration and seeding path over every gear item, for headless evidence
    /// capture and CI. It is the same code the two Inspector menu commands call, driven in a loop.
    ///
    /// This is NOT a batch importer: it registers items that already exist and already carry authored
    /// fit data, and it refuses anything that does not. Nothing here classifies, imports or generates.
    /// </summary>
    public static class GearFitSeedBatch
    {
        [MenuItem("GalaQuest/Gear/Register and seed all gear items")]
        public static void RegisterAndSeedAll()
        {
            GearFitFixtureKitAuthoring.EnsureDefinitions();

            var items = AssetDatabase.FindAssets("t:GearItemDefinition",
                    new[] { "Assets/GalaQuest/Gear/Definitions" })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearItemDefinition>)
                .Where(item => item != null && item.SourceModel != null)
                .OrderBy(item => item.SemanticId)
                .ToArray();

            foreach (var item in items)
            {
                var registration = GearFitAssetRegistrationAuthoring.EnsureRegistration(item);
                if (!registration.HasFitScale)
                {
                    Debug.LogWarning(item.SemanticId + " -> " + registration.Status + ": " +
                                     string.Join(" | ", registration.ProportionFindings));
                    continue;
                }

                var seed = GearFitAssetRegistrationAuthoring.SolveSeedFor(item, out var error);
                if (!seed.IsComplete)
                {
                    Debug.LogWarning(item.SemanticId + " registered but not seedable: " +
                                     (string.IsNullOrEmpty(seed.Error) ? error : seed.Error));
                    continue;
                }

                if (!item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale))
                {
                    Debug.Log(item.SemanticId + " keeps its Owner-authored fit; derived seed not applied.");
                    continue;
                }

                EditorUtility.SetDirty(item);
                Debug.Log(item.SemanticId + " seeded: position " + seed.LocalPosition.ToString("F4") +
                          ", euler " + seed.LocalEulerAngles.ToString("F3") +
                          ", uniform scale " + seed.LocalScale.x.ToString("F5") +
                          " (" + seed.AssetLandmarkId + " -> " + seed.DatumId + ")");
            }

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
        }

        /// <summary>Register, seed, then capture the shared review framings in one Editor start.</summary>
        public static void RegisterSeedAndCapture()
        {
            RegisterAndSeedAll();
            GearReviewPack.CaptureAllowingDirtyTree();
        }
    }
}
