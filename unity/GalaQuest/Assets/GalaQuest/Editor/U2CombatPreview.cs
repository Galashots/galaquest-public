using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Newtonsoft.Json;
using GalaQuest.Gear;
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
            content.HeroPrefab = HeroGripAuthoring.LoadApproved();
            if (Environment.GetEnvironmentVariable("GQ_U2_GRIP_REVIEW") == "1")
                content.HeroPrefab = U2HeroGripPreview.Prepare(AssetDatabase.LoadAssetAtPath<GameObject>(
                    "Assets/GalaQuest/Gear/Prefabs/GQ_HERO_V1.prefab"), Temporary);
            content.HeroController = heroController;
            content.StarterWeapon = PrepareStarterWeapon(content.HeroPrefab);
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
            var walkable = new[] { "DeepFloor", "GateThreshold", "RouteEntryTurn", "ImmediateActionArena", "RouteActionToExpress" };
            foreach (var surface in Object.FindObjectsByType<Collider>(FindObjectsSortMode.None))
                if (walkable.Contains(surface.name) && surface.GetComponent<GalaQuestGroundSurface>() == null)
                    surface.gameObject.AddComponent<GalaQuestGroundSurface>();
            // Preserve the cavern's cool field and warm warning accents while making
            // the approved character palette readable at actual fighting distance.
            RenderSettings.ambientLight = new Color(.26f, .30f, .38f);
            var fill = Object.FindObjectsByType<Light>(FindObjectsSortMode.None)
                .Single(light => light.name == "UndergroundFillLight");
            fill.color = new Color(.72f, .80f, 1f);
            fill.intensity = 1.2f;
            var root = scene.GetRootGameObjects().Single(item => item.name == EmberworksGreyboxBuild.RuntimeRootName);
            if (content.HeroPrefab.GetComponentsInChildren<Transform>().Any(item => item.name == U2HeroGripPreview.MarkerName))
            {
                var localHero = root.GetComponent<GalaQuestTraversalController>().Hero;
                var localBody = localHero.GetComponentsInChildren<SkinnedMeshRenderer>().Single();
                var candidateBody = content.HeroPrefab.GetComponentsInChildren<SkinnedMeshRenderer>().Single();
                if (!localBody.bones.Select(bone => bone.name).SequenceEqual(candidateBody.bones.Select(bone => bone.name))
                    || !localBody.sharedMesh.bindposes.SequenceEqual(candidateBody.sharedMesh.bindposes)
                    || !localBody.sharedMesh.vertices.SequenceEqual(candidateBody.sharedMesh.vertices.Take(localBody.sharedMesh.vertexCount)))
                    throw new BuildFailedException("The scene hero differs from the source used to author the hand candidate");
                // Retain the local hero object and all camera/traversal bindings.
                // Only this temporary scene receives the candidate mesh.
                localBody.sharedMesh = candidateBody.sharedMesh;
                localBody.localBounds = candidateBody.localBounds;
            }
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
                    heroGripCandidateSha256 = U2HeroGripPreview.CandidateSha,
                    heroGripOwnerApprovedForPlaytest = true,
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

        private static GearItemDefinition PrepareStarterWeapon(GameObject heroPrefab)
        {
            // Candidate carry, using the existing imported Ironwood asset. Reference
            // convention: grip inside the palm, guard beyond the fist, blade separate
            // from the leg. See Nintendo's Link/Toon Link/Hero reference sheets and
            // the accepted GalaQuest carry explanation in public/src/character/gear.js.
            const string modelPath = "Assets/GalaQuest/Migration/Prefabs/IronwoodSword.prefab";
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            if (model == null) throw new BuildFailedException("Missing imported Ironwood sword");
            var hero = Object.Instantiate(heroPrefab);
            var sword = Object.Instantiate(model);
            try
            {
                hero.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                Clip(HeroSource, "idle").SampleAnimation(hero, 0);
                var socket = GearMounter.ResolveSocket(hero.transform, GearSocketIds.RightHand);
                var forearm = hero.GetComponentsInChildren<Transform>().Single(bone => bone.name == "RightForeArm");
                sword.transform.position = Vector3.zero;
                var renderers = sword.GetComponentsInChildren<Renderer>();
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers.Skip(1)) bounds.Encapsulate(renderer.bounds);
                if (bounds.size.y < .9f || bounds.size.y > 1.1f) throw new BuildFailedException("Unexpected imported sword axis or metre scale: " + bounds.size);
                // The documented source handle point is y=-.43 on the one-metre mesh.
                // The imported proof prefab restores that mesh's upright orientation.
                var authoredGrip = hero.GetComponentsInChildren<Transform>().SingleOrDefault(item => item.name == U2HeroGripPreview.MarkerName);
                var grip = sword.transform.InverseTransformPoint(new Vector3(bounds.center.x,
                    bounds.min.y + bounds.size.y * (authoredGrip != null ? .125f : .07f), bounds.center.z));
                var modelBladeAxis = sword.transform.InverseTransformDirection(Vector3.up);
                var wrist = socket.transform.position;
                var palm = wrist + (wrist - forearm.position).normalized * .055f;
                var side = Mathf.Sign(wrist.x);
                var pitch = 70f * Mathf.Deg2Rad;
                var outboard = 22f * Mathf.Deg2Rad;
                var blade = new Vector3(side * Mathf.Sin(outboard) * Mathf.Cos(pitch), -Mathf.Sin(pitch), Mathf.Cos(outboard) * Mathf.Cos(pitch));
                sword.transform.rotation = Quaternion.FromToRotation(Vector3.up, blade) * sword.transform.rotation;
                sword.transform.localScale *= .47f / bounds.size.y;
                sword.transform.position += palm - sword.transform.TransformPoint(grip);
                if (authoredGrip != null)
                {
                    var longitudinalAxis = Enumerable.Range(0, 3).OrderByDescending(i => Mathf.Abs(modelBladeAxis[i])).First();
                    if (Mathf.Abs(modelBladeAxis[longitudinalAxis]) < .999f) throw new BuildFailedException("Unqualified sword longitudinal axis");
                    var fittedScale = sword.transform.localScale;
                    fittedScale[longitudinalAxis] *= 1.45f;
                    sword.transform.localScale = fittedScale;
                    // The model's authored axis is world-up before the carry
                    // rotation; its prefab root has an independent import rotation.
                    sword.transform.rotation = Quaternion.FromToRotation(blade, authoredGrip.up) * sword.transform.rotation;
                    sword.transform.position += authoredGrip.position - sword.transform.TransformPoint(grip);
                }
                sword.transform.SetParent(socket.transform, true);
                var definition = ScriptableObject.CreateInstance<GearItemDefinition>();
                definition.Configure("gear.sword.ironwood", "Ironwood sword (starter review)", model,
                    GearSocketIds.RightHand, GearFitClass.Handheld, "public/assets/gear/sword_ironwood.glb", Array.Empty<AnatomyRegion>());
                definition.TryApplySeedFit(sword.transform.localPosition, sword.transform.localEulerAngles, sword.transform.localScale);
                AssetDatabase.CreateAsset(definition, Temporary + "/StarterWeapon.asset");
                return definition;
            }
            finally { Object.DestroyImmediate(sword); Object.DestroyImmediate(hero); }
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
