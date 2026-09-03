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
using UnityEngine.SceneManagement;

namespace GalaQuest.Editor
{
    /// <summary>
    /// Captures the bounded migration scene from fixed cameras. This writes only ignored local review
    /// evidence and does not become a runtime or deployment dependency.
    /// </summary>
    public static class MigrationReviewPack
    {
        private const int CaptureWidth = 960;
        private const int CaptureHeight = 540;
        private const string SwordCameraName = "MigrationProof Sword 3Q Camera";
        private const string KeeperFrontCameraName = "MigrationProof Keeper Front Camera";
        private const string KeeperThreeQuarterCameraName = "MigrationProof Keeper 3Q Camera";
        private const string KeeperSideCameraName = "MigrationProof Keeper Side Camera";

        [MenuItem("GalaQuest/Migration/Capture Review Pack")]
        public static void Capture()
        {
            var provenance = MigrationAssetIntake.ReadAndValidateProvenance();
            var scene = EditorSceneManager.OpenScene(MigrationAssetIntake.ScenePath, OpenSceneMode.Single);
            var repositoryRoot = new DirectoryInfo(Application.dataPath).Parent.Parent.Parent.FullName;
            var outputRoot = Path.Combine(repositoryRoot, ".local", "unity", "review-pack");
            Directory.CreateDirectory(outputRoot);

            var captures = new List<MigrationReviewCapture>();
            captures.Add(CaptureCamera(outputRoot, SwordCameraName, "ironwood-sword-3q.png", "sword-3q", null));
            captures.Add(CaptureCamera(outputRoot, KeeperFrontCameraName, "keeper-front.png", "keeper-front", null));
            captures.Add(CaptureCamera(outputRoot, KeeperThreeQuarterCameraName, "keeper-3q.png", "keeper-3q", null));
            captures.Add(CaptureCamera(outputRoot, KeeperSideCameraName, "keeper-side.png", "keeper-side", null));

            var keeper = GameObject.Find(MigrationProofPaths.KeeperObjectName);
            var animator = keeper == null ? null : keeper.GetComponent<Animator>();
            var wave = animator == null || animator.runtimeAnimatorController == null
                ? null
                : animator.runtimeAnimatorController.animationClips.FirstOrDefault(clip => ClipIdentity(clip) == "wave");
            if (wave == null)
            {
                throw new BuildFailedException("The review pack requires the actual imported Keeper wave clip.");
            }
            animator.Play(wave.name, 0, 0.5f);
            animator.Update(0f);
            captures.Add(CaptureCamera(outputRoot, KeeperThreeQuarterCameraName, "keeper-animation-wave-mid.png", "keeper-3q", wave.name));

            var manifest = new MigrationReviewPackManifest
            {
                schema = "galaquest.unity-migration-review-pack",
                schemaVersion = 1,
                gitSha = ReadGitSha(repositoryRoot),
                unityVersion = Application.unityVersion,
                platform = Application.platform.ToString(),
                buildTarget = EditorUserBuildSettings.activeBuildTarget.ToString(),
                scene = MigrationAssetIntake.ScenePath,
                captureState = "fixed-camera-editor-render;native-fbx-import;no-gameplay",
                captureTimestamp = DateTime.UtcNow.ToString("O"),
                sourceAssetIdentities = provenance.records.Select(record => new MigrationReviewAssetIdentity
                {
                    semanticId = record.semanticId,
                    role = record.role,
                    sourceRepoPath = record.sourceRepoPath,
                    sourceSha256 = record.sourceSha256,
                    derivativeRepoPath = record.derivativeRepoPath,
                    derivativeSha256 = record.derivativeSha256,
                }).ToArray(),
                captures = captures.ToArray(),
            };
            File.WriteAllText(Path.Combine(outputRoot, "review-manifest.json"), JsonUtility.ToJson(manifest, true) + "\n");
            AssetDatabase.Refresh();
            UnityEngine.Debug.Log($"GalaQuest migration review pack captured: {outputRoot} ({captures.Count} screenshots)");
        }

        private static MigrationReviewCapture CaptureCamera(
            string outputRoot,
            string cameraName,
            string filename,
            string view,
            string animationClip)
        {
            var camera = GameObject.Find(cameraName)?.GetComponent<Camera>();
            if (camera == null)
            {
                throw new BuildFailedException($"Review camera not found: {cameraName}");
            }
            foreach (var other in UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None))
            {
                other.enabled = other == camera;
            }

            var renderTexture = new RenderTexture(CaptureWidth, CaptureHeight, 24, RenderTextureFormat.ARGB32)
            {
                name = "MigrationReviewPackRenderTexture",
                antiAliasing = 1,
            };
            var previousActive = RenderTexture.active;
            var previousTarget = camera.targetTexture;
            try
            {
                camera.targetTexture = renderTexture;
                RenderTexture.active = renderTexture;
                camera.Render();
                var image = new Texture2D(CaptureWidth, CaptureHeight, TextureFormat.RGBA32, false);
                image.ReadPixels(new Rect(0, 0, CaptureWidth, CaptureHeight), 0, 0);
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

            return new MigrationReviewCapture
            {
                filename = filename,
                camera = cameraName,
                view = view,
                animationClip = animationClip ?? string.Empty,
            };
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
                if (process.ExitCode != 0)
                {
                    throw new BuildFailedException($"Could not read Git HEAD: {process.StandardError.ReadToEnd()}");
                }
                var sha = process.StandardOutput.ReadToEnd().Trim();
                if (sha.Length != 40)
                {
                    throw new BuildFailedException($"Git HEAD was not a full SHA: {sha}");
                }
                return sha;
            }
        }

        private static string ClipIdentity(AnimationClip clip)
        {
            if (clip == null)
            {
                return string.Empty;
            }
            var separator = clip.name.LastIndexOf('|');
            return separator >= 0 ? clip.name.Substring(separator + 1) : clip.name;
        }
    }

    [Serializable]
    public sealed class MigrationReviewPackManifest
    {
        public string schema;
        public int schemaVersion;
        public string gitSha;
        public string unityVersion;
        public string platform;
        public string buildTarget;
        public string scene;
        public string captureState;
        public string captureTimestamp;
        public MigrationReviewAssetIdentity[] sourceAssetIdentities;
        public MigrationReviewCapture[] captures;
    }

    [Serializable]
    public sealed class MigrationReviewAssetIdentity
    {
        public string semanticId;
        public string role;
        public string sourceRepoPath;
        public string sourceSha256;
        public string derivativeRepoPath;
        public string derivativeSha256;
    }

    [Serializable]
    public sealed class MigrationReviewCapture
    {
        public string filename;
        public string camera;
        public string view;
        public string animationClip;
    }
}
