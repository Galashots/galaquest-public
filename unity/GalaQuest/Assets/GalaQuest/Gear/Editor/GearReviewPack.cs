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
            CaptureInternal(false);
        }

        /// <summary>
        /// Capture even though tracked files differ from HEAD. The manifest then records
        /// exactShaClaim=false and lists what was dirty, so nobody reads it as exact-SHA evidence.
        /// </summary>
        public static void CaptureAllowingDirtyTree()
        {
            CaptureInternal(true);
        }

        private static void CaptureInternal(bool allowDirty)
        {
            var repoRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
            var outputDirectory = Path.Combine(repoRoot, OutputRoot.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(outputDirectory);

            var gitSha = RunGit("rev-parse HEAD", repoRoot);
            // Content-level, not `git status`. On a Windows checkout with core.autocrlf=true, status
            // reports files as modified whose CONTENT is identical to HEAD; treating that as a dirty
            // tree would make an exact-SHA capture impossible here for no real reason. What matters is
            // whether tracked content differs, plus any untracked non-ignored file that could have
            // contributed to the render.
            var changed = RunGit("diff --name-only HEAD -- unity docs tools public", repoRoot);
            var untracked = RunGit(
                "ls-files --others --exclude-standard -- unity docs tools public", repoRoot);
            var dirty = string.Join(
                ((char)10).ToString(),
                new[] { changed, untracked }.Where(part => !string.IsNullOrWhiteSpace(part)));
            var isDirty = !string.IsNullOrWhiteSpace(dirty);

            if (isDirty && !allowDirty)
            {
                throw new InvalidOperationException(
                    "Refusing to stamp an exact-SHA review pack from a dirty working tree. " +
                    "Commit first, or call CaptureAllowingDirtyTree to produce clearly-marked " +
                    "non-exact evidence.\nDirty tracked paths:\n" + dirty);
            }

            EditorSceneManager.OpenScene(GearWorkbenchWindow.ScenePath, OpenSceneMode.Single);

            var rig = UnityEngine.Object.FindFirstObjectByType<GearFitProofRig>();
            if (rig == null)
                throw new InvalidOperationException("The workbench scene has no GearFitProofRig.");

            // Deactivate anything mounted whose definition has gone. Such an object cannot be toggled
            // by the per-item pass below and would otherwise photobomb every still.
            foreach (var orphan in rig.MountedItems())
            {
                if (orphan != null && orphan.Definition == null)
                {
                    Debug.LogWarning("Deactivating an orphaned mount with no definition: " + orphan.name);
                    orphan.gameObject.SetActive(false);
                }
            }

            var items = rig.MountedItems().Where(item => item != null && item.Definition != null).ToList();
            if (items.Count == 0)
                throw new InvalidOperationException("The workbench scene has no mounted gear items.");

            // Reapply every fit from its definition before photographing anything.
            //
            // The scene serialises the mount transforms it was built with, so a saved scene can be
            // older than the definitions it was built from -- capture would then show a stale fit while
            // the manifest claimed to describe the current one. Definitions are the authority; the
            // scene is a view.
            ReapplyCurrentFits(rig, items);

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
                    RefreshCoverage();

                    var slug = Slug(item.Definition.SemanticId);
                    var subject = MountedBounds(item);
                    foreach (var view in GearReviewViews.All)
                    {
                        captures.Add(RenderView(camera, rig, view, slug, outputDirectory, subject));
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

                WriteManifest(outputDirectory, items, captures, gitSha, isDirty, dirty);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(cameraObject);
            }

            Debug.Log("Gear review pack captured " + captures.Count + " stills into " + outputDirectory);
        }

        /// <summary>World bounds of one mounted item's renderers, or null when it draws nothing.</summary>
        private static Bounds? MountedBounds(GearMountedItem item)
        {
            var renderers = item.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return null;

            var bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            return bounds;
        }

        private static void ReapplyCurrentFits(GearFitProofRig rig, IEnumerable<GearMountedItem> items)
        {
            foreach (var item in items)
            {
                var socket = GearMounter.ResolveSocket(rig.HeroRoot, item.Definition.SocketId);
                GearMounter.ApplyFit(item.transform, socket, item.Definition);
            }
        }

        /// <summary>Read-only git query. Returns an empty string if git is unavailable.</summary>
        private static string RunGit(string arguments, string workingDirectory)
        {
            try
            {
                var info = new System.Diagnostics.ProcessStartInfo("git", arguments)
                {
                    WorkingDirectory = workingDirectory,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };

                using (var process = System.Diagnostics.Process.Start(info))
                {
                    if (process == null) return string.Empty;
                    var output = process.StandardOutput.ReadToEnd();
                    process.WaitForExit(15000);
                    return output.Trim();
                }
            }
            catch (System.Exception exception)
            {
                Debug.LogWarning("git " + arguments + " failed: " + exception.Message);
                return string.Empty;
            }
        }

        /// <summary>
        /// Show/hide items, then refresh the anatomy coverage preview so the Hero underneath matches
        /// what is actually equipped. Without this the helmet is photographed fighting a hairstyle that
        /// the runtime will hide -- which is how a helmet gets fitted oversized in the first place.
        /// </summary>
        private static void SetAllVisible(IEnumerable<GearMountedItem> items, bool visible)
        {
            foreach (var item in items) item.gameObject.SetActive(visible);
            RefreshCoverage();
        }

        private static void RefreshCoverage()
        {
            var preview = UnityEngine.Object.FindFirstObjectByType<AnatomyCoveragePreview>(
                FindObjectsInactive.Include);
            if (preview == null)
            {
                Debug.LogWarning("ANATOMY: no AnatomyCoveragePreview in the workbench scene.");
                return;
            }

            preview.PreviewCoverage = true;
            if (!preview.IsUsable)
            {
                // Probe once; if the map cannot drive this mesh, leave the Hero intact and say so
                // rather than photographing shredded geometry.
                preview.Apply(new[] { AnatomyRegion.Hair });
                if (!preview.IsUsable)
                {
                    preview.PreviewCoverage = false;
                    preview.Restore();
                    Debug.LogWarning("ANATOMY: coverage preview unavailable - " + preview.ValidationError);
                    return;
                }
            }

            var regions = new List<AnatomyRegion>();
            foreach (var mount in UnityEngine.Object.FindObjectsByType<GearMountedItem>(
                         FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (mount.Definition?.HidesAnatomy == null) continue;
                if (!mount.gameObject.activeInHierarchy) continue;
                regions.AddRange(mount.Definition.HidesAnatomy);
            }

            Debug.Log("ANATOMY: applying coverage for " + regions.Count + " declared region(s).");
            preview.Apply(regions);
        }

        private static string RenderView(
            Camera camera,
            GearFitProofRig rig,
            GearReviewViews.View view,
            string label,
            string outputDirectory,
            Bounds? subject = null)
        {
            var head = GearHeroAuthoring.FindDescendant(rig.HeroRoot, GearSocketIds.HeadBone);
            var target = view == GearReviewViews.View.Gameplay || head == null
                ? rig.HeroRoot.position + Vector3.up * 0.8f
                : head.position;
            var distance = GearReviewViews.DistanceFor(view);

            // Front / three-quarter / side are framed tight on the head. That is right for headgear and
            // useless for anything else -- a shield on the left hand is simply outside the frame, so
            // three of the four review angles showed no shield at all. When one item is under review,
            // aim at THAT item and pull back far enough to contain it. Headgear sits on the head, so
            // its framings are unchanged.
            if (view != GearReviewViews.View.Gameplay &&
                subject.HasValue && subject.Value.size.sqrMagnitude > 0f)
            {
                target = subject.Value.center;
                distance = Mathf.Max(distance, subject.Value.size.magnitude * 1.35f);
            }

            var rotation = GearReviewViews.RotationFor(view);
            camera.fieldOfView = GearReviewViews.FieldOfViewFor(view);
            camera.transform.rotation = rotation;
            camera.transform.position = target - rotation * Vector3.forward * distance;

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
            IEnumerable<string> captures,
            string gitSha,
            bool isDirty,
            string dirtyPaths)
        {
            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            var builder = new StringBuilder();

            builder.AppendLine("{");
            builder.AppendLine("  \"schema\": \"galaquest.unity-gear-review-pack\",");
            builder.AppendLine("  \"schemaVersion\": 1,");
            builder.AppendLine("  \"unityVersion\": \"" + Application.unityVersion + "\",");
            builder.AppendLine("  \"sourceRepository\": \"Galashots/galaquest-public\",");
            builder.AppendLine("  \"gitSha\": \"" + gitSha + "\",");
            builder.AppendLine("  \"exactShaClaim\": " + (isDirty ? "false" : "true") + ",");
            if (isDirty)
            {
                // Character codes rather than escape sequences: this string is assembled by hand into
                // JSON, and the surrounding quoting is fiddly enough without them.
                var flattened = dirtyPaths
                    .Replace((char)92, (char)47)
                    .Replace((char)34, (char)39)
                    .Replace((char)13, (char)32)
                    .Replace((char)10, (char)59);
                builder.AppendLine("  \"dirtyTrackedPaths\": \"" + flattened + "\",");
            }
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
