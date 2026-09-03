using System.Collections;
using System.Collections.Generic;
using System.Linq;
using GalaQuest.Gear;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    /// <summary>
    /// The animation half of the gate set.
    ///
    /// A fit that only holds in one frozen pose is the failure this project already paid for: the
    /// Wildwood Blade passed Character Studio stills and read as an empty hand in the running game
    /// (public/src/character/gear.js, "RE-SOLVED 2026-08-28 against the RUNNING GAME"). These tests
    /// sweep every GQ_HERO_V1 clip so a pose-dependent defect fails here rather than in a child's hands.
    ///
    /// They still cannot visually accept anything. They reject.
    /// </summary>
    public sealed class GearAnimationSweepPlayModeTests
    {
        private const string SceneName = "GearWorkbench";
        private const int SamplesPerClip = 12;

        /// <summary>
        /// A mount that jumps further than this between adjacent samples is not riding its bone; it is
        /// being rebuilt against the wrong frame. Generous enough for a fast attack swing.
        /// </summary>
        private const float MaxAnchorStepMetres = 0.6f;

        private static GearFitProofRig FindRig()
        {
            var rig = Object.FindFirstObjectByType<GearFitProofRig>();
            Assert.That(rig, Is.Not.Null, "The " + SceneName + " scene has no GearFitProofRig.");
            return rig;
        }

        [UnityTest]
        public IEnumerator Workbench_scene_loads_with_hero_sockets_and_mounted_items()
        {
            var load = SceneManager.LoadSceneAsync(SceneName, LoadSceneMode.Single);
            Assert.That(load, Is.Not.Null, SceneName + " is not in the build scene list.");
            while (!load.isDone) yield return null;
            yield return null;

            var rig = FindRig();
            Assert.That(rig.HeroRoot, Is.Not.Null);
            Assert.That(rig.HeadProxy, Is.Not.Null);
            Assert.That(rig.Animator, Is.Not.Null);

            var sockets = GearMounter.CollectSockets(rig.HeroRoot);
            foreach (var (socketId, _) in GearSocketIds.Authored)
                Assert.That(sockets.ContainsKey(socketId), Is.True, "Missing socket " + socketId);

            Assert.That(rig.MountedItems().Count, Is.GreaterThanOrEqualTo(2),
                "Checkpoint A needs at least two materially different items mounted.");
            Assert.That(rig.PoseStates.Count, Is.GreaterThan(0), "GQ_HERO_V1 exposed no pose states.");
        }

        /// <summary>
        /// Animation must not introduce a rejection that the bind pose did not already have.
        ///
        /// The baseline matters: the Silverguard helmet is a recorded static defect (see
        /// GearSpineEditModeTests.Silverguard_helmet_is_currently_unfittable_by_transform_alone), and
        /// asserting "zero rejections" would either fail permanently or tempt someone to loosen a gate.
        /// Comparing against the bind pose keeps this test sharp about the thing it actually guards:
        /// a fit that only holds while the Hero is standing still.
        /// </summary>
        [UnityTest]
        public IEnumerator Animation_introduces_no_rejection_the_bind_pose_did_not_have()
        {
            var load = SceneManager.LoadSceneAsync(SceneName, LoadSceneMode.Single);
            while (!load.isDone) yield return null;
            yield return null;

            var rig = FindRig();
            var items = rig.MountedItems();

            var baseline = new HashSet<string>();
            foreach (var item in items)
            {
                if (item == null || item.Definition == null) continue;
                foreach (var issue in GearFitValidator
                             .Validate(rig.HeroRoot, item.gameObject, item.Definition, rig.HeadProxy)
                             .Where(i => i.Severity == GearFitSeverity.Rejection))
                {
                    baseline.Add(item.Definition.SemanticId + "|" + issue.Code);
                }
            }

            var regressions = new List<string>();

            foreach (var state in rig.PoseStates)
            {
                for (var sample = 0; sample < SamplesPerClip; sample++)
                {
                    var t = sample / (float)(SamplesPerClip - 1);
                    rig.Sample(state, t);

                    foreach (var item in items)
                    {
                        if (item == null || item.Definition == null) continue;

                        foreach (var issue in GearFitValidator
                                     .Validate(rig.HeroRoot, item.gameObject, item.Definition, rig.HeadProxy)
                                     .Where(i => i.Severity == GearFitSeverity.Rejection))
                        {
                            var key = item.Definition.SemanticId + "|" + issue.Code;
                            if (baseline.Contains(key)) continue;

                            regressions.Add(key + " @ " + state + " t=" + t.ToString("F2") + " -> " + issue);
                        }
                    }
                }

                yield return null;
            }

            Assert.That(regressions, Is.Empty,
                "Animation introduced new gear rejections:\n  " + string.Join("\n  ", regressions));
        }

        [UnityTest]
        public IEnumerator Mounts_do_not_jump_between_adjacent_animation_samples()
        {
            var load = SceneManager.LoadSceneAsync(SceneName, LoadSceneMode.Single);
            while (!load.isDone) yield return null;
            yield return null;

            var rig = FindRig();
            var items = rig.MountedItems();
            var failures = new List<string>();

            foreach (var state in rig.PoseStates)
            {
                var previous = new Dictionary<GearMountedItem, Vector3>();

                for (var sample = 0; sample < SamplesPerClip; sample++)
                {
                    var t = sample / (float)(SamplesPerClip - 1);
                    rig.Sample(state, t);

                    foreach (var item in items)
                    {
                        if (item == null) continue;
                        if (!GearFitProofRig.TryGetSocketPosition(item, out var position)) continue;

                        if (previous.TryGetValue(item, out var last))
                        {
                            var step = Vector3.Distance(last, position);
                            if (step > MaxAnchorStepMetres)
                            {
                                failures.Add(item.Definition.SemanticId + " @ " + state +
                                             " jumped " + step.ToString("F3") + " m at t=" + t.ToString("F2"));
                            }
                        }

                        previous[item] = position;
                    }
                }

                yield return null;
            }

            Assert.That(failures, Is.Empty,
                "Anchor discontinuity detected:\n  " + string.Join("\n  ", failures));
        }
    }
}
