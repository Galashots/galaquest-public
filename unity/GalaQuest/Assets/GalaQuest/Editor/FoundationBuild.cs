using System.IO;
using System.Linq;
using GalaQuest;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace GalaQuest.Editor
{
    public static class FoundationBuild
    {
        [MenuItem("GalaQuest/Validate Foundation")]
        public static void Validate()
        {
            if (Application.unityVersion != FoundationDiagnostics.RequiredUnityVersion)
            {
                throw new BuildFailedException(
                    $"Expected Unity {FoundationDiagnostics.RequiredUnityVersion}, got {Application.unityVersion}.");
            }

            var activeRenderPipeline = GraphicsSettings.currentRenderPipeline;
            if (activeRenderPipeline == null)
            {
                throw new BuildFailedException("The foundation has no active Scriptable Render Pipeline configured.");
            }

            if (!IsUniversalRenderPipeline(activeRenderPipeline))
            {
                throw new BuildFailedException(
                    $"The foundation requires Universal Render Pipeline, got {activeRenderPipeline.GetType().FullName}.");
            }

            if (!EditorBuildSettings.scenes.Any(scene => scene.enabled && !string.IsNullOrEmpty(scene.path)))
            {
                throw new BuildFailedException("The foundation has no enabled build scene.");
            }

            Debug.Log(
                $"GalaQuest foundation validation passed: Unity {Application.unityVersion}, " +
                $"{activeRenderPipeline.GetType().Name}, " +
                $"{EditorBuildSettings.scenes.Count(scene => scene.enabled)} enabled scene(s).");
        }

        public static bool IsUniversalRenderPipeline(RenderPipelineAsset renderPipeline)
        {
            return renderPipeline is UniversalRenderPipelineAsset;
        }

        public static void BuildWindows()
        {
            Build(BuildTarget.StandaloneWindows64, "GalaQuest.exe");
        }

        public static void BuildWebGL()
        {
            Build(BuildTarget.WebGL, "GalaQuestWebGL");
        }

        private static void Build(BuildTarget target, string defaultOutputName)
        {
            var output = GetArgument("-buildOutput");
            if (string.IsNullOrEmpty(output))
            {
                output = Path.Combine("Builds", defaultOutputName);
            }

            var scenes = EditorBuildSettings.scenes
                .Where(scene => scene.enabled && !string.IsNullOrEmpty(scene.path))
                .Select(scene => scene.path)
                .ToArray();
            if (scenes.Length == 0)
            {
                throw new BuildFailedException("The foundation has no enabled build scene.");
            }

            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = output,
                target = target,
                options = BuildOptions.StrictMode
            });

            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new BuildFailedException(
                    $"{target} build failed with result {report.summary.result}: {report.summary.totalErrors} error(s).");
            }

            Debug.Log($"GalaQuest foundation build passed: {target} -> {output}");
        }

        private static string GetArgument(string name)
        {
            var arguments = System.Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length - 1; index++)
            {
                if (arguments[index] == name)
                {
                    return arguments[index + 1];
                }
            }

            return string.Empty;
        }
    }
}
