using System.Collections.Generic;
using System.Linq;
using System.Text;
using GalaQuest.Gear;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Batch entry points for the gear spine, so CI and a headless Editor can do exactly what the menu
    /// items do. Every method here throws on failure: a green command with a Safe Mode Editor is not a pass.
    /// </summary>
    public static class GearBuild
    {
        /// <summary>Regenerate GQ_HERO_V1, the Head Fit Proxy and the workbench scene, and report measurements.</summary>
        public static void Author()
        {
            GearHeroAuthoring.RebuildAll();
            GearStarterDefinitions.CreateOrReseed();
            GearWorkbenchSceneBuilder.Build();
            ReportProxy();
            ReportItems();
        }

        /// <summary>Author everything and capture the review pack in one Editor session.</summary>
        public static void AuthorAndCapture()
        {
            Author();
            GearReviewPack.Capture();
        }

        public static void ReportItems()
        {
            var definitions = AssetDatabase.FindAssets("t:GearItemDefinition")
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearItemDefinition>)
                .Where(asset => asset != null)
                .OrderBy(asset => asset.SemanticId)
                .ToArray();

            var report = new StringBuilder();
            report.AppendLine("GalaQuest gear item definitions: " + definitions.Length);
            foreach (var definition in definitions)
            {
                report.AppendLine("  " + definition.SemanticId +
                                  " socket=" + definition.SocketId +
                                  " class=" + definition.FitClass +
                                  " model=" + (definition.SourceModel == null ? "MISSING" : definition.SourceModel.name) +
                                  " pos=" + definition.LocalPosition.ToString("F4") +
                                  " scale=" + definition.LocalScale.ToString("F4") +
                                  " mirrorX=" + definition.MirrorX);
            }
            Debug.Log(report.ToString());
        }

        public static void ReportProxy()
        {
            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            if (proxy == null)
                throw new BuildFailedException("Head Fit Proxy missing at " + GearHeroAuthoring.HeadProxyPath);

            var report = new StringBuilder();
            report.AppendLine("GQ_HERO_V1 Head Fit Proxy (head-bone local metres)");
            report.AppendLine("  crown            = " + proxy.Crown.ToString("F4"));
            report.AppendLine("  faceAnchor       = " + proxy.FaceAnchor.ToString("F4"));
            report.AppendLine("  skullRadius      = " + proxy.SkullRadius.ToString("F4"));
            report.AppendLine("  crownHeight      = " + proxy.CrownHeight.ToString("F4"));
            report.AppendLine("  eyeLine          = " + proxy.EyeLine.ToString("F4"));
            report.AppendLine("  eyeLineHeight    = " + proxy.EyeLineHeight.ToString("F4"));
            report.AppendLine("  eyeClearanceR    = " + proxy.EyeClearanceRadius.ToString("F4"));
            report.AppendLine("  maxCrownGap      = " + proxy.MaxCrownGap.ToString("F4"));
            report.AppendLine("  derivedFrom      = " + proxy.DerivedFromHeroPath);
            Debug.Log(report.ToString());
        }

        /// <summary>
        /// Mount every GearItemDefinition in the project onto GQ_HERO_V1 at bind pose and fail on any
        /// rejection. This is the gate that a new item passes or fails without any new code.
        /// </summary>
        public static void ValidateAllItems()
        {
            var heroPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            if (heroPrefab == null)
                throw new BuildFailedException("GQ_HERO_V1 prefab missing: " + GearHeroAuthoring.HeroPrefabPath);

            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            var definitions = AssetDatabase.FindAssets("t:GearItemDefinition")
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearItemDefinition>)
                .Where(asset => asset != null)
                .OrderBy(asset => asset.SemanticId)
                .ToArray();

            if (definitions.Length == 0)
                throw new BuildFailedException("No GearItemDefinition assets found to validate.");

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(heroPrefab);
            var rejections = new List<string>();
            try
            {
                foreach (var definition in definitions)
                {
                    GameObject mounted = null;
                    try
                    {
                        mounted = GearMounter.Mount(hero.transform, definition);
                        var issues = GearFitValidator.Validate(hero.transform, mounted, definition, proxy);
                        foreach (var issue in issues)
                        {
                            var line = definition.SemanticId + " -> " + issue;
                            if (issue.Severity == GearFitSeverity.Rejection) rejections.Add(line);
                            else Debug.LogWarning(line);
                        }

                        Debug.Log("Validated " + definition.SemanticId + " on socket '" +
                                  definition.SocketId + "': " + issues.Count + " finding(s).");
                    }
                    catch (GearMounter.MountFailure failure)
                    {
                        rejections.Add(definition.SemanticId + " -> mount failed: " + failure.Message);
                    }
                    finally
                    {
                        if (mounted != null) Object.DestroyImmediate(mounted);
                    }
                }
            }
            finally
            {
                Object.DestroyImmediate(hero);
            }

            if (rejections.Count > 0)
            {
                throw new BuildFailedException(
                    "Gear fit validation rejected " + rejections.Count + " state(s):\n  " +
                    string.Join("\n  ", rejections));
            }

            Debug.Log("Gear fit validation passed for " + definitions.Length + " item(s).");
        }
    }
}
