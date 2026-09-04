using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>Production entry point: one explicit semantic item, never an all-items fallback.</summary>
    public static class GearFitSeedBatch
    {
        [Serializable]
        public sealed class Report
        {
            public string semanticId;
            public string status = "FAIL";
            public bool seedApplied;
            public bool ownerFitProtected;
            public string frameId;
            public string seatingDatumId;
            public Vector3 localPosition, localEulerAngles, localScale;
            public Vector3 rawSourceRenderSize;
            public bool sourceDeclaresCavity;
            public string[] findings = Array.Empty<string>();
            public string evidence = "Machine rejection only; visual acceptance UNKNOWN";
        }

        public static GearItemDefinition ResolveOne(string id)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("-gqGearItem is required");
            var matches = AssetDatabase.FindAssets("t:GearItemDefinition")
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearItemDefinition>)
                .Where(item => item != null && item.SemanticId == id).ToArray();
            if (matches.Length != 1)
                throw new InvalidOperationException(id + " resolved " + matches.Length + " definitions; expected exactly one");
            return matches[0];
        }

        public static Report ProcessOne(string id)
        {
            var report = new Report { semanticId = id };
            var item = ResolveOne(id);
            // SolveSeedFor refreshes only this item's registration immediately before solving.
            var seed = GearFitAssetRegistrationAuthoring.SolveSeedFor(item, out var error);
            if (!seed.IsComplete)
            {
                var registration = GearFitAssetRegistrationAuthoring.LoadRegistration(id);
                report.status = registration != null && registration.Status == GearFitRegistrationStatus.NeedsAuthoring
                    ? "NeedsAuthoring" : "FAIL";
                report.findings = new[] { string.IsNullOrEmpty(seed.Error) ? error : seed.Error };
                return report;
            }
            report.frameId = seed.FrameId;
            report.seatingDatumId = seed.DatumId;
            report.ownerFitProtected = item.IsOwnerAuthored;
            report.seedApplied = item.TryApplySeedFit(seed.LocalPosition, seed.LocalEulerAngles, seed.LocalScale);
            if (report.seedApplied)
            {
                EditorUtility.SetDirty(item);
                AssetDatabase.SaveAssetIfDirty(item);
            }
            report.localPosition = item.LocalPosition;
            report.localEulerAngles = item.LocalEulerAngles;
            report.localScale = item.LocalScale;
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            if (prefab == null) throw new InvalidOperationException("Hero prefab missing");
            var hero = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            try
            {
                var mount = GearMounter.Mount(hero.transform, item);
                report.rawSourceRenderSize = GearAssetFitProbe.MeasureRenderBounds(mount, Quaternion.identity);
                report.sourceDeclaresCavity = GearAssetFitProbe.TryMeasureDeclaredCavity(mount,
                    Quaternion.identity, out _, out _);
                var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
                var issues = GearFitValidator.Validate(hero.transform, mount, item, proxy);
                issues.AddRange(GearFitSeedConsistency.CheckCurrent(hero.transform, mount, item));
                report.findings = issues.Select(issue => issue.ToString()).ToArray();
                report.status = issues.Any(issue => issue.Severity == GearFitSeverity.Rejection) ? "FAIL" :
                    issues.Count > 0 ? "WARN" : "PASS";
            }
            finally { UnityEngine.Object.DestroyImmediate(hero); }
            return report;
        }

        public static void RunOne()
        {
            var args = Environment.GetCommandLineArgs();
            var id = Argument(args, "-gqGearItem", true);
            var output = Argument(args, "-gqGearReport", false) ??
                Path.GetFullPath(Path.Combine(Application.dataPath, "../../../.local/unity/gear-item-report.json"));
            var report = new Report { semanticId = id };
            try
            {
                report = ProcessOne(id);
                if (args.Contains("-gqGearCapture"))
                {
                    if (report.status != "PASS" && report.status != "WARN")
                        throw new InvalidOperationException("capture refused: item failed machine gates");
                    GearReviewPack.CaptureItem(ResolveOne(id));
                }
            }
            catch (Exception ex)
            {
                report.status = "FAIL";
                report.findings = report.findings.Concat(new[] { ex.Message }).ToArray();
            }
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output)));
            File.WriteAllText(output, JsonUtility.ToJson(report, true));
            Debug.Log(JsonUtility.ToJson(report));
            if (Application.isBatchMode) EditorApplication.Exit(report.status == "PASS" || report.status == "WARN" ? 0 : 1);
        }

        private static string Argument(string[] args, string key, bool required)
        {
            var indices = Enumerable.Range(0, args.Length).Where(i => args[i] == key).ToArray();
            if (indices.Length == 0 && !required) return null;
            if (indices.Length != 1 || indices[0] + 1 >= args.Length || args[indices[0] + 1].StartsWith("-"))
                throw new ArgumentException(key + " requires exactly one value");
            return args[indices[0] + 1];
        }
    }
}
