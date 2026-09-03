using System.Collections;
using System.Collections.Generic;
using GalaQuest.Gear;
using NUnit.Framework;
using UnityEngine;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    /// <summary>
    /// PlayMode half of the gear gates: the things that need a running Animator.
    ///
    /// The geometry gates deliberately live in EditMode (GearAnimationSweepEditModeTests) instead.
    /// Gear meshes import with Read/Write disabled, which is correct for a tablet target -- readable
    /// meshes keep a second CPU copy alive -- so mesh.vertices throws at runtime. Enabling Read/Write
    /// across the gear bank to satisfy a test would spend real memory on a validation convenience.
    /// EditMode has the same clips and readable meshes, so the sweep runs there and this file keeps the
    /// checks that only a live Animator can make.
    /// </summary>
    public sealed class GearAnimationSweepPlayModeTests
    {
        /// <summary>
        /// Loaded BY PATH, not by build-settings name.
        ///
        /// The Gear Workbench is Editor authoring infrastructure, not a player destination. An earlier
        /// revision registered it as an enabled build scene purely so this test could load it, which
        /// shipped the authoring scene, the Hero prefab and every gear model into the Windows and WebGL
        /// players. EditorSceneManager.LoadSceneInPlayMode loads a scene that is not in Build Settings,
        /// which is why this assembly is Editor-only.
        /// </summary>
        private const string ScenePath = "Assets/GalaQuest/Gear/Scenes/GearWorkbench.unity";
        private const int SamplesPerClip = 12;

        private static GearFitProofRig FindRig()
        {
            var rig = Object.FindFirstObjectByType<GearFitProofRig>();
            Assert.That(rig, Is.Not.Null, "The workbench scene has no GearFitProofRig.");
            return rig;
        }

        [UnityTest]
        public IEnumerator Workbench_scene_loads_with_hero_sockets_and_mounted_items()
        {
            var load = EditorSceneManager.LoadSceneAsyncInPlayMode(
                ScenePath, new LoadSceneParameters(LoadSceneMode.Single));
            Assert.That(load, Is.Not.Null, ScenePath + " could not be loaded.");
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
        /// Every mounted item must keep exactly the fit its definition authored, in every pose of every
        /// clip.
        ///
        /// This is the runtime form of the Wildwood Blade failure: a mount that is rebuilt against a
        /// live (mid-animation) bone frame instead of a stable one drifts once the Hero starts moving,
        /// and the hand reads as empty in the running game. Because sockets are real child Transforms,
        /// a correct mount's LOCAL transform is invariant under animation -- so any drift here is a
        /// mounting bug, not choreography.
        ///
        /// An earlier version of this test compared WORLD positions between samples, which measured how
        /// far the animation moved the Hero rather than anything about the mount, and duly "failed" on
        /// the death and shield_push clips.
        /// </summary>
        [UnityTest]
        public IEnumerator Mounted_fits_never_drift_from_their_authored_values_under_animation()
        {
            var load = EditorSceneManager.LoadSceneAsyncInPlayMode(
                ScenePath, new LoadSceneParameters(LoadSceneMode.Single));
            while (!load.isDone) yield return null;
            yield return null;

            var rig = FindRig();
            var items = rig.MountedItems();
            var failures = new List<string>();

            foreach (var state in rig.PoseStates)
            {
                for (var sample = 0; sample < SamplesPerClip; sample++)
                {
                    var t = sample / (float)(SamplesPerClip - 1);
                    rig.Sample(state, t);

                    foreach (var item in items)
                    {
                        if (item == null || item.Definition == null) continue;

                        var local = item.transform;
                        var definition = item.Definition;

                        var positionDrift = Vector3.Distance(local.localPosition, definition.LocalPosition);
                        var scaleDrift = Vector3.Distance(local.localScale, definition.EffectiveLocalScale);
                        var rotationDrift = Quaternion.Angle(local.localRotation, definition.LocalRotation);

                        if (positionDrift > 1e-4f || scaleDrift > 1e-4f || rotationDrift > 0.05f)
                        {
                            failures.Add(definition.SemanticId + " @ " + state + " t=" + t.ToString("F2") +
                                         " drifted: position " + positionDrift.ToString("F5") +
                                         ", scale " + scaleDrift.ToString("F5") +
                                         ", rotation " + rotationDrift.ToString("F3") + " deg");
                        }

                        // A socket-parented item and its socket are the same point by construction.
                        // If they ever separate, something reparented the mount.
                        if (local.parent != null)
                        {
                            var socket = local.parent.GetComponent<GearSocket>();
                            if (socket == null)
                            {
                                failures.Add(definition.SemanticId + " @ " + state +
                                             " is no longer parented to a GearSocket.");
                            }
                        }
                    }
                }

                yield return null;
            }

            Assert.That(failures, Is.Empty,
                "Gear drifted from its authored fit under animation:\n  " + string.Join("\n  ", failures));
        }
    }
}
