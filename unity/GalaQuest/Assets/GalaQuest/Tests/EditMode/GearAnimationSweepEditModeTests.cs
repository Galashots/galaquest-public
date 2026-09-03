using System.Collections.Generic;
using System.Linq;
using GalaQuest.Gear;
using GalaQuest.Gear.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Tests
{
    /// <summary>
    /// Sweeps every GQ_HERO_V1 clip and runs the geometry gates at each sample.
    ///
    /// This is the machine half of not repeating the Wildwood Blade failure, where a fit passed a single
    /// Character Studio still and read as an empty hand in the running game
    /// (public/src/character/gear.js, "RE-SOLVED 2026-08-28 against the RUNNING GAME").
    ///
    /// It lives in EditMode because the gates measure mesh vertices, and gear models import with
    /// Read/Write disabled -- correct for a tablet target, fatal for mesh.vertices at runtime. Unity's
    /// AnimationMode samples the same clips here, against readable meshes, with no Animator needed.
    ///
    /// These still only REJECT. Visual acceptance stays with Unity and running-game inspection.
    /// </summary>
    public sealed class GearAnimationSweepEditModeTests
    {
        private const int SamplesPerClip = 8;

        private static AnimationClip[] LoadClips()
        {
            return AssetDatabase.LoadAllAssetsAtPath(GearHeroAuthoring.HeroModelPath)
                .OfType<AnimationClip>()
                .Where(clip => !clip.name.StartsWith("__preview__"))
                .OrderBy(clip => clip.name)
                .ToArray();
        }

        [Test]
        public void Animation_introduces_no_rejection_the_bind_pose_did_not_have()
        {
            var heroPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            Assert.That(heroPrefab, Is.Not.Null);
            Assert.That(proxy, Is.Not.Null);

            var definitions = AssetDatabase.FindAssets("t:GearItemDefinition")
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearItemDefinition>)
                .Where(asset => asset != null && asset.SourceModel != null)
                .OrderBy(asset => asset.SemanticId)
                .ToArray();

            Assert.That(definitions, Is.Not.Empty);

            var clips = LoadClips();
            Assert.That(clips, Is.Not.Empty, "GQ_HERO_V1 exposed no animation clips to sweep.");

            var hero = Object.Instantiate(heroPrefab);
            var mounted = new List<(GearItemDefinition Definition, GameObject Instance)>();

            try
            {
                foreach (var definition in definitions)
                    mounted.Add((definition, GearMounter.Mount(hero.transform, definition)));

                // Baseline at bind pose. Anything already rejected standing still is a static defect and
                // is reported by GearSpineEditModeTests; this test is about what MOTION breaks.
                var baseline = new HashSet<string>();
                foreach (var (definition, instance) in mounted)
                {
                    foreach (var issue in GearFitValidator
                                 .Validate(hero.transform, instance, definition, proxy)
                                 .Where(i => i.Severity == GearFitSeverity.Rejection))
                    {
                        baseline.Add(definition.SemanticId + "|" + issue.Code);
                    }
                }

                var regressions = new List<string>();

                AnimationMode.StartAnimationMode();
                try
                {
                    foreach (var clip in clips)
                    {
                        for (var sample = 0; sample < SamplesPerClip; sample++)
                        {
                            var t = sample / (float)(SamplesPerClip - 1);

                            AnimationMode.BeginSampling();
                            AnimationMode.SampleAnimationClip(hero, clip, t * clip.length);
                            AnimationMode.EndSampling();

                            foreach (var (definition, instance) in mounted)
                            {
                                foreach (var issue in GearFitValidator
                                             .Validate(hero.transform, instance, definition, proxy)
                                             .Where(i => i.Severity == GearFitSeverity.Rejection))
                                {
                                    var key = definition.SemanticId + "|" + issue.Code;
                                    if (baseline.Contains(key)) continue;

                                    regressions.Add(key + " @ " + clip.name +
                                                    " t=" + t.ToString("F2") + " -> " + issue);
                                }
                            }
                        }
                    }
                }
                finally
                {
                    AnimationMode.StopAnimationMode();
                }

                Assert.That(regressions, Is.Empty,
                    "Animation introduced new gear rejections:\n  " + string.Join("\n  ", regressions));
            }
            finally
            {
                foreach (var (_, instance) in mounted)
                    if (instance != null) Object.DestroyImmediate(instance);
                Object.DestroyImmediate(hero);
            }
        }
    }
}
