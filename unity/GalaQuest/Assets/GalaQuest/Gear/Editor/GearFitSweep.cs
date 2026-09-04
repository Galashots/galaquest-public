using System.Collections.Generic;
using System.Globalization;
using System.IO;
using GalaQuest.Gear;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Renders a small grid of candidate fits for one item so a human can pick by eye.
    ///
    /// This is the Workbench's gizmo loop, batched. Dragging a helmet, looking, and dragging again is
    /// the right workflow at a desk; when the only way to see the result is a headless render, a sweep
    /// gets the same information in one pass instead of one Editor launch per nudge.
    ///
    /// It decides nothing. It produces labelled stills; a human picks one and that value is saved to the
    /// definition exactly as the Workbench would save it.
    /// </summary>
    public static class GearFitSweep
    {
        public const string OutputRoot = ".local/unity/review-pack/gear-sweep";

        public static void SweepHelmet()
        {
            var repoRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
            var outputDirectory = Path.Combine(repoRoot, OutputRoot.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(outputDirectory);

            EditorSceneManager.OpenScene(GearWorkbenchWindow.ScenePath, OpenSceneMode.Single);

            var rig = Object.FindFirstObjectByType<GearFitProofRig>();
            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            var definition = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(
                GearStarterDefinitions.HelmetPath);

            GearMountedItem helmet = null;
            foreach (var mount in rig.MountedItems())
            {
                if (mount.Definition == definition) helmet = mount;
                else mount.gameObject.SetActive(false);
            }

            if (helmet == null) throw new System.InvalidOperationException("Helmet is not mounted.");

            var head = GearHeroAuthoring.FindDescendant(rig.HeroRoot, GearSocketIds.HeadBone);
            var socket = GearMounter.ResolveSocket(rig.HeroRoot, definition.SocketId);
            var upAxis = head.TransformDirection(proxy.UpAxis).normalized;
            var forwardAxis = head.TransformDirection(proxy.ForwardAxis).normalized;

            var camera = new GameObject("SweepCamera").AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.16f, 0.17f, 0.2f, 1f);
            camera.nearClipPlane = 0.01f;

            var basePosition = definition.LocalPosition;
            var baseScale = definition.LocalScale;
            var lines = new List<string>();

            try
            {
                // Scale down from the seeded size, and raise the shell so the brow band clears the eyes.
                foreach (var scaleFactor in new[] { 1.00f, 0.90f, 0.82f, 0.74f })
                {
                    foreach (var lift in new[] { 0.00f, 0.03f, 0.06f, 0.09f })
                    {
                        helmet.transform.SetParent(socket.transform, false);
                        helmet.transform.localPosition = basePosition;
                        helmet.transform.localRotation = definition.LocalRotation;
                        helmet.transform.localScale = baseScale * scaleFactor;
                        helmet.transform.position += upAxis * lift;

                        var label = "helmet-s" + scaleFactor.ToString("F2", CultureInfo.InvariantCulture)
                                    + "-up" + lift.ToString("F2", CultureInfo.InvariantCulture);
                        label = label.Replace('.', 'p');

                        Render(camera, head.position, GearReviewViews.View.Front, label, outputDirectory);
                        Render(camera, head.position, GearReviewViews.View.Side, label, outputDirectory);

                        lines.Add(label + " -> localPosition " +
                                  helmet.transform.localPosition.ToString("F5") +
                                  " localScale " + helmet.transform.localScale.ToString("F5"));
                    }
                }

                File.WriteAllLines(Path.Combine(outputDirectory, "candidates.txt"), lines);
            }
            finally
            {
                Object.DestroyImmediate(camera.gameObject);
            }

            Debug.Log("Helmet sweep wrote " + lines.Count + " candidates into " + outputDirectory);
        }

        /// <summary>
        /// Sweep orientations for the shoulder pair.
        ///
        /// Orientation is not auto-solved for this class: an earlier heuristic picked whichever pose
        /// stood furthest clear of the body, which produced flipped pauldrons. This shows the options
        /// instead of guessing, and a human picks.
        /// </summary>
        public static void SweepShoulders()
        {
            var repoRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
            var outputDirectory = Path.Combine(repoRoot, OutputRoot.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(outputDirectory);

            EditorSceneManager.OpenScene(GearWorkbenchWindow.ScenePath, OpenSceneMode.Single);
            var rig = Object.FindFirstObjectByType<GearFitProofRig>();

            var left = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(
                GearStarterDefinitions.ShoulderLeftPath);
            var right = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(
                GearStarterDefinitions.ShoulderRightPath);

            var mounts = new List<GearMountedItem>();
            foreach (var mount in rig.MountedItems())
            {
                var isShoulder = mount.Definition == left || mount.Definition == right;
                mount.gameObject.SetActive(isShoulder);
                if (isShoulder) mounts.Add(mount);
            }

            var camera = new GameObject("SweepCamera").AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.16f, 0.17f, 0.2f, 1f);
            camera.nearClipPlane = 0.01f;

            var target = rig.HeroRoot.position + Vector3.up * 0.9f;
            var lines = new List<string>();

            try
            {
                for (var i = 0; i < GearAutoSeat.OrientationCandidates.Length; i++)
                {
                    var orientation = GearAutoSeat.OrientationCandidates[i];
                    foreach (var mount in mounts)
                    {
                        var socket = GearMounter.ResolveSocket(rig.HeroRoot, mount.Definition.SocketId);
                        mount.transform.SetParent(socket.transform, false);
                        mount.transform.localPosition = mount.Definition.LocalPosition;
                        mount.transform.localRotation = Quaternion.Euler(orientation);
                        mount.transform.localScale = mount.Definition.EffectiveLocalScale;
                    }

                    var label = "shoulders-o" + i;
                    // Gameplay framing: a tight head-height crop hid the fact that a 180-degree yaw
                    // throws this mesh clear of its socket, and a bad orientation was picked from it.
                    Render(camera, target, GearReviewViews.View.Gameplay, label, outputDirectory);
                    Render(camera, target, GearReviewViews.View.ThreeQuarter, label, outputDirectory);
                    lines.Add(label + " -> euler " + orientation);
                }

                File.WriteAllLines(Path.Combine(outputDirectory, "shoulder-candidates.txt"), lines);
            }
            finally
            {
                Object.DestroyImmediate(camera.gameObject);
            }

            Debug.Log("Shoulder sweep wrote " + lines.Count + " orientations into " + outputDirectory);
        }

        private static void Render(
            Camera camera, Vector3 target, GearReviewViews.View view, string label, string directory)
        {
            var rotation = GearReviewViews.RotationFor(view);
            camera.fieldOfView = GearReviewViews.FieldOfViewFor(view);
            camera.transform.rotation = rotation;
            camera.transform.position = target - rotation * Vector3.forward * GearReviewViews.DistanceFor(view);

            var texture = new RenderTexture(720, 900, 24, RenderTextureFormat.ARGB32);
            var readback = new Texture2D(720, 900, TextureFormat.RGB24, false);
            var previous = RenderTexture.active;
            try
            {
                camera.targetTexture = texture;
                camera.Render();
                RenderTexture.active = texture;
                readback.ReadPixels(new Rect(0, 0, 720, 900), 0, 0);
                readback.Apply();
                File.WriteAllBytes(
                    Path.Combine(directory, label + "-" + GearReviewViews.NameFor(view) + ".png"),
                    readback.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = null;
                RenderTexture.active = previous;
                Object.DestroyImmediate(readback);
                texture.Release();
                Object.DestroyImmediate(texture);
            }
        }
    }
}
