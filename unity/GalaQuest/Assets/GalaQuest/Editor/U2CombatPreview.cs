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
    // the gremlin to production. Receipt-verified local assets survive review builds.
    public static class U2CombatPreview
    {
        public const string Temporary = "Assets/U2CombatPreviewTemporary";
        public const string HeroSource = "Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/Hero.fbx";
        public const string CandidateFbxSha256 = "283cf0579fc864a1e599f7c2ccda3e0b4fdd930d566c04225c8dc88b10be77db";
        public const string CandidateTextureSha256 = "9fb9eb5758673cbc3670ad95d1b2e2b9bf075a0699d68aa119ab334f3847d812";
        private const string CandidateFbxName = "lava-gremlin-local-v1.fbx";
        private const string CandidateTextureName = "texture_0_base_color.png";
        private static EditorBuildSettingsScene[] cloudPreviousScenes;
        private static U2BuildSettingsScope cloudSettings;
        private static string cloudSourceSha;
        public static string RepoRoot => Path.GetFullPath(Path.Combine(Application.dataPath, "../../.."));
        public static string CandidateDirectory => Path.Combine(RepoRoot, ".local/m2/gremlin-local-rig");

        public static void ValidateExternalInputs()
        {
            RequireHashedInput(Path.Combine(CandidateDirectory, CandidateFbxName), CandidateFbxSha256);
            RequireHashedInput(Path.Combine(CandidateDirectory, "../gremlin-body", CandidateTextureName), CandidateTextureSha256);
        }

        public static GalaQuestCombatContent Prepare()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new BuildFailedException("Prepare in Edit Mode");
            RequireNamedScenes();
            var input = U2PreviewReceipt.Fingerprint();
            if (U2PreviewReceipt.Reuse(input))
                return AssetDatabase.LoadAssetAtPath<GalaQuestCombatContent>(Temporary + "/CombatContent.asset")
                    ?? throw new BuildFailedException("Missing imported preview content");
            var previous = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            var scratch = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
            UnityEngine.SceneManagement.SceneManager.SetActiveScene(scratch);
            try
            {
                var content = Generate();
                U2PreviewReceipt.Save(input);
                return content;
            }
            finally
            {
                EditorSceneManager.CloseScene(scratch, true);
                if (previous.IsValid()) UnityEngine.SceneManagement.SceneManager.SetActiveScene(previous);
            }
        }

        private static GalaQuestCombatContent Generate()
        {
            var fbx = Path.Combine(CandidateDirectory, CandidateFbxName);
            RequireHashedInput(fbx, CandidateFbxSha256);
            var texture = Path.Combine(CandidateDirectory, "../gremlin-body", CandidateTextureName);
            RequirePresentInput(texture);
            if (Directory.Exists(Temporary)) throw new BuildFailedException("Preserve pre-existing candidate preview assets: " + Temporary);
            AssetDatabase.CreateFolder("Assets", "U2CombatPreviewTemporary");
            File.Copy(fbx, Temporary + "/Gremlin.fbx");
            File.Copy(texture, Temporary + "/GremlinColor.png");
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
            content.MagmaLordHelmet = RuneForgeAuthoring.LoadHelmet();
            content.Enemies = new[] { new GalaQuestCombatContent.EnemyPrefab { Kind = "lava-gremlin", Prefab = enemyPrefab } };
            content.TelegraphMaterial = telegraph;
            content.Swing = Cue("swing"); content.Impact = Cue("impact"); content.Hurt = Cue("hurt");
            content.Victory = Cue("victory"); content.Windup = Cue("windup");
            AssetDatabase.CreateAsset(content, Temporary + "/CombatContent.asset");
            foreach (var assetPath in AssetDatabase.GetAllAssetPaths().Where(item => item.StartsWith(Temporary + "/", StringComparison.Ordinal)
                && !Directory.Exists(item) && !item.EndsWith(".unity", StringComparison.OrdinalIgnoreCase)))
                foreach (var asset in AssetDatabase.LoadAllAssetsAtPath(assetPath))
                {
                    // Animator authoring records Undo internally. These are owned
                    // generated outputs, not edits to a user's controller. Do not
                    // leave a later Undo/test teardown able to invalidate a receipt.
                    AssetDatabase.SaveAssetIfDirty(asset);
                    Undo.ClearUndo(asset);
                }
            return content;
        }

        public static string PrepareScene(GalaQuestCombatContent content)
        {
            RequireNamedScenes();
            if (content != AssetDatabase.LoadAssetAtPath<GalaQuestCombatContent>(Temporary + "/CombatContent.asset"))
                throw new BuildFailedException("Prepare the current candidate content first");
            U2PreviewReceipt.CheckOwned();
            var path = Temporary + "/EmberworksFightPreview.unity";
            if (File.Exists(path)) return path;
            var previous = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            if (!AssetDatabase.CopyAsset(EmberworksGreyboxBuild.ScenePath, path))
                throw new BuildFailedException("Could not copy the source preview scene");
            var scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Additive);
            UnityEngine.SceneManagement.SceneManager.SetActiveScene(scene);
            try
            {
            var walkable = new[] { "DeepFloor", "GateThreshold", "RouteEntryTurn", "ImmediateActionArena", "RouteActionToExpress" };
            foreach (var surface in scene.GetRootGameObjects().SelectMany(item => item.GetComponentsInChildren<Collider>()))
                if (walkable.Contains(surface.name) && surface.GetComponent<GalaQuestGroundSurface>() == null)
                    surface.gameObject.AddComponent<GalaQuestGroundSurface>();
            // Preserve the cavern's cool field and warm warning accents while making
            // the approved character palette readable at actual fighting distance.
            RenderSettings.ambientLight = new Color(.26f, .30f, .38f);
            var fill = scene.GetRootGameObjects().SelectMany(item => item.GetComponentsInChildren<Light>())
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
            RuneForgeAuthoring.ConfigurePreview(root, content);
            var camera = root.GetComponentsInChildren<Camera>().Single(item => item.CompareTag("MainCamera"));
            if (camera.GetComponent<AudioListener>() == null) camera.gameObject.AddComponent<AudioListener>();
            if (!EditorSceneManager.SaveScene(scene)) throw new BuildFailedException("Could not save candidate preview scene");
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            U2PreviewReceipt.Save(U2PreviewReceipt.Fingerprint());
            return path;
            }
            finally
            {
                EditorSceneManager.CloseScene(scene, true);
                if (previous.IsValid()) UnityEngine.SceneManagement.SceneManager.SetActiveScene(previous);
            }
        }

        public static void Cleanup()
        {
            if (!Directory.Exists(Temporary)) return;
            U2PreviewReceipt.DeleteOwned();
        }

        private static void RequireNamedScenes()
        {
            for (var i = 0; i < UnityEngine.SceneManagement.SceneManager.sceneCount; i++)
                if (!Application.isBatchMode && string.IsNullOrEmpty(UnityEngine.SceneManagement.SceneManager.GetSceneAt(i).path))
                    throw new BuildFailedException("Save or close untitled scenes before preview preparation; no user scene is discarded");
        }

        // Unity Build Automation calls these methods from its Advanced settings.
        // The shell pre-build hook provisions the ignored custody inputs first;
        // this hook then prepares the exact generated scene that UBA exports.
        public static void PreExport()
        {
            var sourceSha = ResolveSourceSha();
            RequireCleanCheckout();
            var content = Prepare();
            var scene = PrepareScene(content);
            cloudPreviousScenes = EditorBuildSettings.scenes;
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(scene, true) };
            cloudSourceSha = sourceSha;
            if (Environment.GetEnvironmentVariable("GQ_FAST_REVIEW_BUILD") == "1")
            {
                cloudSettings = new U2BuildSettingsScope();
                cloudSettings.UseFastReview();
            }
            Debug.Log("Unity Build Automation prepared exact U2 review scene: " + scene);
        }

        public static void PostExport(string exportPath)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(cloudSourceSha))
                    throw new BuildFailedException("Unity Build Automation PostExport ran without PreExport preparation");
                ValidateExternalInputs();
                WriteReviewManifest(exportPath, cloudSourceSha, Environment.GetEnvironmentVariable("GQ_FAST_REVIEW_BUILD") == "1",
                    Path.Combine(exportPath, "candidate-build-manifest.json"));
            }
            finally
            {
                EditorBuildSettings.scenes = cloudPreviousScenes ?? EditorBuildSettings.scenes;
                cloudPreviousScenes = null;
                cloudSourceSha = null;
                if (cloudSettings != null)
                {
                    var settings = cloudSettings;
                    cloudSettings = null;
                    settings.Dispose();
                }
            }
        }

        public static void BuildWebGL()
        {
            var sourceSha = ResolveSourceSha();
            RequireCleanCheckout();
            ValidateExternalInputs();
            var output = Path.Combine(Application.dataPath, "../Builds/GalaQuestWebGL");
            var fastIteration = Environment.GetEnvironmentVariable("GQ_FAST_REVIEW_BUILD") == "1";
            var settings = new U2BuildSettingsScope();
            try
            {
                var content = Prepare();
                var scene = PrepareScene(content);
                if (fastIteration) settings.UseFastReview();
                var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
                {
                    scenes = new[] { scene }, target = BuildTarget.WebGL,
                    locationPathName = output, options = BuildOptions.StrictMode
                });
                if (report.summary.result != BuildResult.Succeeded) throw new BuildFailedException("Candidate build failed: " + report.summary.result);
                var evidencePath = Path.Combine(RepoRoot, ".local/m2/preview-build-" + sourceSha.Substring(0, 7) + (fastIteration ? "-fast" : "") + ".json");
                WriteReviewManifest(output, sourceSha, fastIteration, evidencePath);
                Debug.Log("Candidate review build complete: " + evidencePath);
            }
            finally
            {
                settings.Dispose();
            }
        }

        private static void WriteReviewManifest(string outputRoot, string sourceSha, bool fastIteration, string manifestPath)
        {
            var buildDirectory = Path.Combine(outputRoot, "Build");
            if (!Directory.Exists(buildDirectory)) throw new BuildFailedException("WebGL output is missing its Build directory: " + buildDirectory);
            var files = Directory.GetFiles(buildDirectory)
                .Select(path => new { name = Path.GetFileName(path), bytes = new FileInfo(path).Length, sha256 = Hash(path) }).ToArray();
#if UNITY_WEBGL
            var optimization = UnityEditor.WebGL.UserBuildSettings.codeOptimization.ToString();
#else
            var optimization = "PlatformDefault";
#endif
            var manifest = new { sourceSha, buildFlavor = "LOCAL_CANDIDATE_REVIEW", candidateFbxSha256 = CandidateFbxSha256,
                candidateTextureSha256 = CandidateTextureSha256,
                heroGripCandidateSha256 = U2HeroGripPreview.CandidateSha,
                heroGripOwnerApprovedForPlaytest = true,
                productionPromotion = false, sceneRecipe = "U2CombatPreview", fastIteration,
                optimization, compression = PlayerSettings.WebGL.compressionFormat.ToString(), files };
            Directory.CreateDirectory(Path.GetDirectoryName(manifestPath));
            File.WriteAllText(manifestPath, JsonConvert.SerializeObject(manifest, Formatting.Indented));
        }

        private static void RequireHashedInput(string path, string expectedSha256)
        {
            RequirePresentInput(path);
            var actual = Hash(path);
            if (!string.Equals(actual, expectedSha256, StringComparison.OrdinalIgnoreCase))
                throw new BuildFailedException("Controlled U2 review input hash mismatch: " + path + " expected " + expectedSha256 + " got " + actual);
        }

        private static void RequirePresentInput(string path)
        {
            if (!File.Exists(path)) throw new BuildFailedException("Missing controlled U2 review input; run the cloud provisioning hook: " + path);
        }

        private static void RequireCleanCheckout()
        {
            // UBA injects a bounded set of build metadata, CloudBuild helper files,
            // compiler response files, and the generated manifest before PreExport.
            // Keep this evidence-derived allowlist exact; nothing else is exempt.
            const string statusArguments = "status --porcelain --untracked-files=all -- . "
                + "\":(exclude).build/last/galaquest-webgl-staging/build_stats.json\" "
                + "\":(exclude).build/last/galaquest-webgl-staging/extra_data/editoranalytics_session.json\" "
                + "\":(exclude)build.json\" "
                + "\":(exclude)unity/GalaQuest/build_manifest.json\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Resources.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Resources/UnityCloudBuildManifest.scriptable.asset\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Resources/UnityCloudBuildManifest.scriptable.asset.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Scripts.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor/README.md\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor/README.md.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor/UnityEditor.CloudBuild.dll\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Scripts/Editor/UnityEditor.CloudBuild.dll.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Scripts/UnityEngine.CloudBuild.dll\" "
                + "\":(exclude)unity/GalaQuest/Assets/__UnityCloud__/Scripts/UnityEngine.CloudBuild.dll.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/csc.rsp\" "
                + "\":(exclude)unity/GalaQuest/Assets/csc.rsp.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/gmcs.rsp\" "
                + "\":(exclude)unity/GalaQuest/Assets/gmcs.rsp.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/smcs.rsp\" "
                + "\":(exclude)unity/GalaQuest/Assets/smcs.rsp.meta\" "
                + "\":(exclude)unity/GalaQuest/Assets/us.rsp\" "
                + "\":(exclude)unity/GalaQuest/Assets/us.rsp.meta\"";
            var unexpected = Git(statusArguments);
            if (!string.IsNullOrWhiteSpace(unexpected))
                throw new BuildFailedException("Unexpected dirty paths prevent an exact-source candidate build:\n" + unexpected);
        }

        private static string ResolveSourceSha()
        {
            var sourceSha = Git("rev-parse HEAD");
            foreach (var variable in new[] { "SCM_REVISION", "BUILD_REVISION" })
            {
                var declared = Environment.GetEnvironmentVariable(variable);
                if (!string.IsNullOrWhiteSpace(declared) && !string.Equals(declared.Trim(), sourceSha, StringComparison.OrdinalIgnoreCase))
                    throw new BuildFailedException(variable + " does not match the checked-out Git HEAD: " + declared + " vs " + sourceSha);
            }
            return sourceSha;
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
