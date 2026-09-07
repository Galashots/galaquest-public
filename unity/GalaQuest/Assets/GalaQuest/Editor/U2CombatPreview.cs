using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Newtonsoft.Json;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace GalaQuest.Editor
{
    // Builds a local review scene from the committed runtime plus named, hashed
    // custody-tier candidate bytes. It neither edits the canonical scene nor admits
    // the gremlin to production. Temporary assets exist only during this operation.
    public static class U2CombatPreview
    {
        public const string Temporary = "Assets/U2CombatPreviewTemporary";
        public const string HeroSource = "Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/Hero.fbx";
        private const string CandidateSha = "283cf0579fc864a1e599f7c2ccda3e0b4fdd930d566c04225c8dc88b10be77db";
        private static bool ownsTemporary;
        public static string RepoRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "../../.."));
        public static string CandidateDirectory => Path.Combine(RepoRoot, ".local/m2/gremlin-local-rig");

        public static GalaQuestCombatContent Prepare()
        {
            var fbx = Path.Combine(CandidateDirectory, "lava-gremlin-local-v1.fbx");
            if (!File.Exists(fbx) || Hash(fbx) != CandidateSha) throw new BuildFailedException("Expected the measured local gremlin FBX candidate");
            if (Directory.Exists(Temporary)) throw new BuildFailedException("Preserve pre-existing candidate preview assets: " + Temporary);
            AssetDatabase.CreateFolder("Assets", "U2CombatPreviewTemporary");
            ownsTemporary = true;
            File.Copy(fbx, Temporary + "/Gremlin.fbx");
            File.Copy(Path.Combine(CandidateDirectory, "../gremlin-body/texture_0_base_color.png"), Temporary + "/GremlinColor.png");
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var importer = (ModelImporter)AssetImporter.GetAtPath(Temporary + "/Gremlin.fbx");
            importer.animationType = ModelImporterAnimationType.Generic;
            importer.importAnimation = true;
            importer.optimizeGameObjects = false;
            var takes = importer.defaultClipAnimations;
            foreach (var take in takes) take.loopTime = take.name.EndsWith("|idle") || take.name.EndsWith("|walk");
            importer.clipAnimations = takes;
            importer.SaveAndReimport();

            AssetDatabase.CopyAsset(HeroLocomotionAuthoring.ControllerPath, Temporary + "/HeroCombat.controller");
            var heroController = AssetDatabase.LoadAssetAtPath<AnimatorController>(Temporary + "/HeroCombat.controller");
            AddState(heroController, "slash", Clip(HeroSource, "sword_slash"), 1.5f);
            AddState(heroController, "hit", Clip(HeroSource, "hit"));
            AddState(heroController, "death", Clip(HeroSource, "death"), 1.75f);
            var enemyController = AnimatorController.CreateAnimatorControllerAtPath(Temporary + "/Gremlin.controller");
            foreach (var name in new[] { "idle", "walk", "bash", "hit", "death" })
                AddState(enemyController, name, Clip(Temporary + "/Gremlin.fbx", name),
                    name == "bash" ? 1.06f : name == "hit" ? .667f : name == "death" ? 1.75f : 0);

            var material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
            material.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(Temporary + "/GremlinColor.png"));
            material.SetFloat("_Metallic", 0);
            material.SetFloat("_Smoothness", .15f);
            material.EnableKeyword("_EMISSION");
            AssetDatabase.CreateAsset(material, Temporary + "/Gremlin.mat");
            var anchor = new GameObject("Lava gremlin candidate");
            GameObject enemyPrefab;
            try
            {
                var model = Object.Instantiate(AssetDatabase.LoadAssetAtPath<GameObject>(Temporary + "/Gremlin.fbx"), anchor.transform);
                model.name = "Visual";
                var animator = model.GetComponent<Animator>();
                if (animator == null) animator = model.AddComponent<Animator>();
                animator.runtimeAnimatorController = enemyController;
                animator.applyRootMotion = false;
                foreach (var renderer in model.GetComponentsInChildren<Renderer>()) renderer.sharedMaterial = material;
                enemyPrefab = PrefabUtility.SaveAsPrefabAsset(anchor, Temporary + "/Gremlin.prefab");
            }
            finally { Object.DestroyImmediate(anchor); }

            var telegraph = new Material(Shader.Find("Universal Render Pipeline/Unlit"));
            telegraph.SetFloat("_Surface", 1);
            telegraph.SetFloat("_SrcBlend", (int)BlendMode.SrcAlpha);
            telegraph.SetFloat("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
            telegraph.SetFloat("_ZWrite", 0);
            telegraph.SetFloat("_Cull", (int)CullMode.Off);
            telegraph.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            telegraph.renderQueue = (int)RenderQueue.Transparent;
            AssetDatabase.CreateAsset(telegraph, Temporary + "/Telegraph.mat");
            foreach (var name in new[] { "swing", "impact", "hurt", "victory", "windup" }) WriteCue(name);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var content = ScriptableObject.CreateInstance<GalaQuestCombatContent>();
            content.HeroPrefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/GalaQuest/Gear/Prefabs/GQ_HERO_V1.prefab");
            content.HeroController = heroController;
            content.Enemies = new[] { new GalaQuestCombatContent.EnemyPrefab { Kind = "lava-gremlin", Prefab = enemyPrefab } };
            content.TelegraphMaterial = telegraph;
            content.Swing = Cue("swing"); content.Impact = Cue("impact"); content.Hurt = Cue("hurt");
            content.Victory = Cue("victory"); content.Windup = Cue("windup");
            AssetDatabase.CreateAsset(content, Temporary + "/CombatContent.asset");
            AssetDatabase.SaveAssets();
            return content;
        }

        public static string PrepareScene(GalaQuestCombatContent content)
        {
            var scene = EditorSceneManager.OpenScene(EmberworksGreyboxBuild.ScenePath, OpenSceneMode.Single);
            var root = scene.GetRootGameObjects().Single(item => item.name == EmberworksGreyboxBuild.RuntimeRootName);
            var presentation = root.GetComponent<GalaQuestCombatPresentation>();
            if (presentation == null) presentation = root.AddComponent<GalaQuestCombatPresentation>();
            presentation.Configure(content);
            var camera = root.GetComponentsInChildren<Camera>().Single(item => item.CompareTag("MainCamera"));
            if (camera.GetComponent<AudioListener>() == null) camera.gameObject.AddComponent<AudioListener>();
            var path = Temporary + "/EmberworksFightPreview.unity";
            if (!EditorSceneManager.SaveScene(scene, path, true)) throw new BuildFailedException("Could not save candidate preview scene");
            return path;
        }

        public static void Cleanup()
        {
            if (!ownsTemporary) return;
            if (!EditorApplication.isPlaying) EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            AssetDatabase.DeleteAsset(Temporary);
            ownsTemporary = false;
        }

        public static void BuildWebGL()
        {
            var sourceSha = Git("rev-parse HEAD");
            if (!string.IsNullOrWhiteSpace(Git("status --porcelain"))) throw new BuildFailedException("Commit runtime changes before an exact-source candidate build");
            var output = Path.Combine(Application.dataPath, "../Builds/GalaQuestWebGL");
            try
            {
                var content = Prepare();
                var scene = PrepareScene(content);
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { scene }, target = BuildTarget.WebGL,
                    locationPathName = output, options = BuildOptions.StrictMode
                });
                if (report.summary.result != BuildResult.Succeeded) throw new BuildFailedException("Candidate build failed: " + report.summary.result);
                var files = Directory.GetFiles(Path.Combine(output, "Build"))
                    .Select(path => new { name = Path.GetFileName(path), bytes = new FileInfo(path).Length, sha256 = Hash(path) }).ToArray();
                var manifest = new { sourceSha, buildFlavor = "LOCAL_CANDIDATE_REVIEW", candidateFbxSha256 = CandidateSha,
                    candidateTextureSha256 = Hash(Path.Combine(CandidateDirectory, "../gremlin-body/texture_0_base_color.png")),
                    productionPromotion = false, sceneRecipe = "U2CombatPreview", files };
                var evidencePath = Path.Combine(RepoRoot, ".local/m2/preview-build-" + sourceSha.Substring(0, 7) + ".json");
                File.WriteAllText(evidencePath, JsonConvert.SerializeObject(manifest, Formatting.Indented));
                Debug.Log("Candidate review build complete: " + evidencePath);
            }
            finally { Cleanup(); }
        }

        private static AnimationClip Clip(string path, string suffix)
        {
            var clips = AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().Where(clip => !clip.name.StartsWith("__preview__")).ToArray();
            return clips.SingleOrDefault(clip => clip.name == suffix || clip.name.EndsWith("|" + suffix))
                   ?? throw new BuildFailedException("Missing native clip " + suffix + "; available=" + string.Join(",", clips.Select(clip => clip.name)));
        }

        private static void AddState(AnimatorController controller, string name, AnimationClip clip, float duration = 0)
        {
            var machine = controller.layers[0].stateMachine;
            var state = machine.AddState(name);
            state.motion = clip;
            state.speed = duration > 0 ? clip.length / duration : 1;
            EditorUtility.SetDirty(controller);
        }

        private static AudioClip Cue(string name) => AssetDatabase.LoadAssetAtPath<AudioClip>(Temporary + "/" + name + ".wav");

        // Original deterministic synthesis, no sample-library or provider input. Short
        // mono cues keep the review build small; all important cues also have visuals.
        private static void WriteCue(string name)
        {
            const int sampleRate = 22050;
            var duration = name == "victory" ? .72 : name == "windup" ? .52 : name == "hurt" ? .3 : .2;
            var count = (int)(sampleRate * duration);
            var random = new System.Random(41);
            var filteredNoise = 0.0;
            using var writer = new BinaryWriter(File.Create(Temporary + "/" + name + ".wav"));
            writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(36 + count * 2);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16); writer.Write((short)1);
            writer.Write((short)1); writer.Write(sampleRate); writer.Write(sampleRate * 2); writer.Write((short)2); writer.Write((short)16);
            writer.Write(System.Text.Encoding.ASCII.GetBytes("data")); writer.Write(count * 2);
            for (var i = 0; i < count; i++)
            {
                var t = i / (double)sampleRate;
                var u = t / duration;
                var noise = random.NextDouble() * 2 - 1;
                filteredNoise += (noise - filteredNoise) * .15;
                double sample;
                if (name == "victory")
                {
                    sample = 0;
                    var notes = new[] { 523.25, 659.25, 783.99 };
                    for (var note = 0; note < notes.Length; note++)
                    {
                        var elapsed = t - note * .12;
                        if (elapsed >= 0) sample += .18 * Math.Sin(2 * Math.PI * notes[note] * elapsed) * Math.Exp(-elapsed * 7) * Math.Min(1, elapsed * 150);
                    }
                }
                else if (name == "swing") sample = (noise - filteredNoise) * .55 * Math.Sin(Math.PI * u) * (1 - u);
                else if (name == "windup") sample = (.18 * Math.Sin(2 * Math.PI * (80 * t + 120 * t * t)) + filteredNoise * .5) * Math.Sin(Math.PI * u);
                else sample = (Math.Sin(2 * Math.PI * (name == "hurt" ? 110 : 190) * t) * .55 + filteredNoise * .8) * Math.Exp(-u * 8) * Math.Min(1, t * 600);
                sample *= Math.Min(1, (duration - t) * 200); // quiet tail, no cutoff click
                writer.Write((short)(Math.Max(-.9, Math.Min(.9, sample)) * short.MaxValue));
            }
        }

        private static string Hash(string path)
        {
            using var stream = File.OpenRead(path);
            using var sha = SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }

        private static string Git(string arguments)
        {
            using var process = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("git", arguments)
            { WorkingDirectory = RepoRoot, RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true });
            var value = process.StandardOutput.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0) throw new BuildFailedException("Git source check failed");
            return value.Trim();
        }
    }
}
