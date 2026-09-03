using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using GalaQuest.Gear;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Renders phone-readable stills of every mounted item from the shared inspection framings, plus
    /// motion frames from GQ_HERO_V1's own clips.
    ///
    /// This is EVIDENCE, not acceptance. Editor renders can reject a fit and can show the Owner what to
    /// judge; AGENTS.md keeps running-game pixels as the final appearance authority, and this project has
    /// no Unity gameplay/controller seam yet, so nothing here may be called gameplay evidence.
    /// </summary>
    public static class GearReviewPack
    {
        public const string OutputRoot = ".local/unity/review-pack/gear-v1";

        public const int StillWidth = 1080;
        public const int StillHeight = 1350;

        private static readonly (string State, float Time)[] MotionFrames =
        {
            ("idle", 0f),
            ("running", 0.25f),
            ("running", 0.6f),
            ("sword_slash", 0.35f),
            ("sword_slash", 0.6f),
        };

        [MenuItem("GalaQuest/Gear/Capture gear review pack")]
        public static void Capture()
        {
            var repoRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
            var outputDirectory = Path.Combine(repoRoot, OutputRoot.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(outputDirectory);

            EditorSceneManager.OpenScene(GearWorkbenchWindow.ScenePath, OpenSceneMode.Single);

            var rig = UnityEngine.Object.FindFirstObjectByType<GearFitProofRig>();
            if (rig == null)
                throw new InvalidOperationException("The workbench scene has no GearFitProofRig.");

            var items = rig.MountedItems().Where(item => item != null && item.Definition != null).ToList();
            if (items.Count == 0)
                throw new InvalidOperationException("The workbench scene has no mounted gear items.");

            var cameraObject = new GameObject("GearReviewCamera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.16f, 0.17f, 0.2f, 1f);
            camera.nearClipPlane = 0.01f;
            camera.farClipPlane = 50f;

            var captures = new List<string>();
            try
            {
                // Neutral bind pose, every item visible together: the loadout read.
                SetAllVisible(items, true);
                foreach (var view in GearReviewViews.All)
                {
                    captures.Add(RenderView(camera, rig, view, "loadout", outputDirectory));
                }

                // Then each item alone, so a defect is attributable to one piece.
                foreach (var item in items)
                {
                    SetAllVisible(items, false);
                    item.gameObject.SetActive(true);

                    var slug = Slug(item.Definition.SemanticId);
                    foreach (var view in GearReviewViews.All)
                    {
                        captures.Add(RenderView(camera, rig, view, slug, outputDirectory));
                    }
                }

                // Motion frames: a fit judged at one instant is the failure mode this guards against.
                SetAllVisible(items, true);
                foreach (var (state, time) in MotionFrames)
                {
                    if (!rig.PoseStates.Contains(state)) continue;
                    rig.Sample(state, time);

                    var label = "motion-" + state + "-" +
                                time.ToString("F2", CultureInfo.InvariantCulture).Replace('.', 'p');
                    captures.Add(RenderView(camera, rig, GearReviewViews.View.Gameplay, label, outputDirectory));
                    captures.Add(RenderView(camera, rig, GearReviewViews.View.ThreeQuarter, label, outputDirectory));
                }

                WriteManifest(outputDirectory, items, captures);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(cameraObject);
            }

            Debug.Log("Gear review pack captured " + captures.Count + " stills into " + outputDirectory);
        }

        private static void SetAllVisible(IEnumerable<GearMountedItem> items, bool visible)
        {
            foreach (var item in items) item.gameObject.SetActive(visible);
        }

        private static string RenderView(
            Camera camera,
            GearFitProofRig rig,
            GearReviewViews.View view,
            string label,
            string outputDirectory)
        {
            var head = GearHeroAuthoring.FindDescendant(rig.HeroRoot, GearSocketIds.HeadBone);
            var target = view == GearReviewViews.View.Gameplay || head == null
                ? rig.HeroRoot.position + Vector3.up * 0.8f
                : head.position;

            var rotation = GearReviewViews.RotationFor(view);
            camera.fieldOfView = GearReviewViews.FieldOfViewFor(view);
            camera.transform.rotation = rotation;
            camera.transform.position = target - rotation * Vector3.forward * GearReviewViews.DistanceFor(view);

            var texture = new RenderTexture(StillWidth, StillHeight, 24, RenderTextureFormat.ARGB32);
            var readback = new Texture2D(StillWidth, StillHeight, TextureFormat.RGB24, false);
            var previousActive = RenderTexture.active;

            try
            {
                camera.targetTexture = texture;
                camera.Render();

                RenderTexture.active = texture;
                readback.ReadPixels(new Rect(0, 0, StillWidth, StillHeight), 0, 0);
                readback.Apply();

                var fileName = label + "-" + GearReviewViews.NameFor(view) + ".png";
                var path = Path.Combine(outputDirectory, fileName);
                File.WriteAllBytes(path, readback.EncodeToPNG());
                return fileName;
            }
            finally
            {
                camera.targetTexture = null;
                RenderTexture.active = previousActive;
                UnityEngine.Object.DestroyImmediate(readback);
                texture.Release();
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static void WriteManifest(
            string outputDirectory,
            IEnumerable<GearMountedItem> items,
            IEnumerable<string> captures)
        {
            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            var builder = new StringBuilder();

            builder.AppendLine("{");
            builder.AppendLine("  \"schema\": \"galaquest.unity-gear-review-pack\",");
            builder.AppendLine("  \"schemaVersion\": 1,");
            builder.AppendLine("  \"unityVersion\": \"" + Application.unityVersion + "\",");
            builder.AppendLine("  \"note\": \"Editor renders. Not running-game evidence: this project has no Unity gameplay/controller seam yet.\",");
            builder.AppendLine("  \"headFitProxy\": {");
            if (proxy != null)
            {
                builder.AppendLine("    \"skullRadius\": " + F(proxy.SkullRadius) + ",");
                builder.AppendLine("    \"crownHeight\": " + F(proxy.CrownHeight) + ",");
                builder.AppendLine("    \"eyeLineHeight\": " + F(proxy.EyeLineHeight) + ",");
                builder.AppendLine("    \"eyeClearanceRadius\": " + F(proxy.EyeClearanceRadius) + ",");
                builder.AppendLine("    \"derivedFromHero\": \"" + proxy.DerivedFromHeroPath + "\"");
            }
            builder.AppendLine("  },");

            builder.AppendLine("  \"items\": [");
            var itemLines = items.Select(item =>
                "    { \"semanticId\": \"" + item.Definition.SemanticId +
                "\", \"socketId\": \"" + item.Definition.SocketId +
                "\", \"fitClass\": \"" + item.Definition.FitClass +
                "\", \"sourceRepoPath\": \"" + item.Definition.SourceRepoPath + "\" }").ToArray();
            builder.AppendLine(string.Join(",\n", itemLines));
            builder.AppendLine("  ],");

            builder.AppendLine("  \"captures\": [");
            builder.AppendLine(string.Join(",\n", captures.Select(c => "    \"" + c + "\"")));
            builder.AppendLine("  ]");
            builder.AppendLine("}");

            File.WriteAllText(Path.Combine(outputDirectory, "review-manifest.json"), builder.ToString());
        }

        private static string F(float value) => value.ToString("F5", CultureInfo.InvariantCulture);

        private static string Slug(string semanticId) => semanticId.Replace('.', '-');
    }
}
