using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using GalaQuest.Migration;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Editor
{
    /// <summary>Captures the bounded Hero before/after proof from fixed Unity cameras.</summary>
    public static class VisibleArmorReviewPack
    {
        private const int Width = 960;
        private const int Height = 540;
        private const string GameplayCamera = "VisibleArmor Gameplay Camera";
        private const string ThreeQuarterCamera = "VisibleArmor Equipped ThreeQuarter Camera";
        private const string SideCamera = "VisibleArmor Equipped Side Camera";
        private const string EquippedObject = "Hero Equipped Silverguard Helmet";

        [MenuItem("GalaQuest/Migration/Capture Visible Armor Review Pack")]
        public static void Capture()
        {
            var manifest = VisibleArmorProofBuilder.LoadManifest();
            EditorSceneManager.OpenScene(VisibleArmorProofBuilder.ScenePath, OpenSceneMode.Single);
            var repositoryRoot = new DirectoryInfo(Application.dataPath).Parent.Parent.Parent.FullName;
            var outputRoot = Path.Combine(repositoryRoot, ".local", "unity", "visible-armor-review-pack");
            Directory.CreateDirectory(outputRoot);

            var captures = new List<VisibleArmorReviewCapture>();
            var equipped = GameObject.Find(EquippedObject);
            if (equipped == null) throw new BuildFailedException("Visible armor equipped Hero was not found in proof scene.");
            var gameplay = GameObject.Find(GameplayCamera).GetComponent<Camera>();

            equipped.SetActive(false);
            Aim(gameplay, new Vector3(-0.72f, 0.92f, 4.2f), new Vector3(-0.72f, 0.92f, 0f));
            captures.Add(CaptureCamera(outputRoot, GameplayCamera, "01_hero-unequipped-gameplay.png", "unequipped-gameplay"));
            equipped.SetActive(true);
            Aim(gameplay, new Vector3(0.72f, 0.92f, 4.2f), new Vector3(0.72f, 0.92f, 0f));
            captures.Add(CaptureCamera(outputRoot, GameplayCamera, "02_hero-equipped-gameplay.png", "equipped-gameplay"));
            captures.Add(CaptureCamera(outputRoot, ThreeQuarterCamera, "03_hero-equipped-three-quarter.png", "equipped-three-quarter"));
            captures.Add(CaptureCamera(outputRoot, SideCamera, "04_hero-equipped-side.png", "equipped-side"));

            var output = new VisibleArmorReviewManifest
            {
                schema = "galaquest.unity-visible-armor-review-pack",
                schemaVersion = 1,
                gitSha = ReadGitSha(repositoryRoot),
                unityVersion = Application.unityVersion,
                platform = Application.platform.ToString(),
                scene = VisibleArmorProofBuilder.ScenePath,
                captureState = "fixed-camera-editor-render;native-fbx-import;Hero-before-after;no-gameplay",
                captureTimestamp = DateTime.UtcNow.ToString("O"),
                decisionRequested = "Owner visual review of the existing Silverguard Helmet fit on the GalaQuest Hero.",
                strongestKnownDefect = "The accepted source fit currently occludes more of the Hero face in native Unity than its open-face source intent; Owner review is required.",
                unknownSurfaces = new[] { "Owner visual acceptance", "running-game camera equivalence" },
                hero = new VisibleArmorReviewIdentity { semanticId = manifest.hero.semanticId, sourcePath = manifest.hero.sourcePath, sourceSha256 = manifest.hero.sourceSha256 },
                gear = new VisibleArmorReviewIdentity { semanticId = manifest.gear.semanticId, sourcePath = manifest.gear.sourcePath, sourceSha256 = manifest.gear.sourceSha256 },
                fitAuthoritySourcePath = manifest.fitAuthority.runtimeSourcePath,
                captures = captures.ToArray(),
            };
            File.WriteAllText(Path.Combine(outputRoot, "review-manifest.json"), JsonUtility.ToJson(output, true) + "\n");
            AssetDatabase.Refresh();
            UnityEngine.Debug.Log($"Visible armor review pack captured at {outputRoot} for {output.gitSha}.");
        }

        private static VisibleArmorReviewCapture CaptureCamera(string outputRoot, string cameraName, string filename, string state)
        {
            var camera = GameObject.Find(cameraName)?.GetComponent<Camera>();
            if (camera == null) throw new BuildFailedException($"Visible armor review camera not found: {cameraName}");
            foreach (var other in UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None)) other.enabled = other == camera;

            var renderTexture = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 1 };
            var previousActive = RenderTexture.active;
            var previousTarget = camera.targetTexture;
            try
            {
                camera.targetTexture = renderTexture;
                RenderTexture.active = renderTexture;
                camera.Render();
                var image = new Texture2D(Width, Height, TextureFormat.RGBA32, false);
                image.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
                image.Apply(false, false);
                File.WriteAllBytes(Path.Combine(outputRoot, filename), image.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(image);
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                UnityEngine.Object.DestroyImmediate(renderTexture);
            }
            return new VisibleArmorReviewCapture { filename = filename, camera = cameraName, state = state };
        }

        private static void Aim(Camera camera, Vector3 position, Vector3 target)
        {
            camera.transform.position = position;
            camera.transform.LookAt(target, Vector3.up);
        }

        private static string ReadGitSha(string repositoryRoot)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "git",
                Arguments = "rev-parse HEAD",
                WorkingDirectory = repositoryRoot,
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using (var process = Process.Start(startInfo))
            {
                process.WaitForExit();
                if (process.ExitCode != 0) throw new BuildFailedException(process.StandardError.ReadToEnd());
                var sha = process.StandardOutput.ReadToEnd().Trim();
                if (sha.Length != 40) throw new BuildFailedException($"Git HEAD was not a full SHA: {sha}");
                return sha;
            }
        }
    }

    [Serializable]
    public sealed class VisibleArmorReviewManifest
    {
        public string schema;
        public int schemaVersion;
        public string gitSha;
        public string unityVersion;
        public string platform;
        public string scene;
        public string captureState;
        public string captureTimestamp;
        public string decisionRequested;
        public string strongestKnownDefect;
        public string[] unknownSurfaces;
        public VisibleArmorReviewIdentity hero;
        public VisibleArmorReviewIdentity gear;
        public string fitAuthoritySourcePath;
        public VisibleArmorReviewCapture[] captures;
    }

    [Serializable]
    public sealed class VisibleArmorReviewIdentity
    {
        public string semanticId;
        public string sourcePath;
        public string sourceSha256;
    }

    [Serializable]
    public sealed class VisibleArmorReviewCapture
    {
        public string filename;
        public string camera;
        public string state;
    }
}
