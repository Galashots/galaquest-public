using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GalaQuest.Migration;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace GalaQuest.Editor
{
    /// <summary>
    /// Editor-only construction of the bounded two-asset migration proof. Unity's native ModelImporter
    /// is the only importer used here; this class does not alter source GLBs or add gameplay behavior.
    /// </summary>
    public static class MigrationAssetIntake
    {
        public const string SwordModelPath = "Assets/GalaQuest/Migration/SourceAssets/Deterministic/IronwoodSword.fbx";
        public const string KeeperModelPath = "Assets/GalaQuest/Migration/SourceAssets/Deterministic/LanternKeeper.fbx";
        public const string ProvenancePath = "Assets/GalaQuest/Migration/Provenance/asset-provenance.json";
        public const string SwordPrefabPath = "Assets/GalaQuest/Migration/Prefabs/IronwoodSword.prefab";
        public const string KeeperPrefabPath = "Assets/GalaQuest/Migration/Prefabs/LanternKeeper.prefab";
        public const string ControllerPath = "Assets/GalaQuest/Migration/Generated/LanternKeeperProof.controller";
        public const string FloorMaterialPath = "Assets/GalaQuest/Migration/Generated/MigrationProofFloor.mat";
        public const string ScenePath = "Assets/GalaQuest/Migration/Scenes/MigrationProof.unity";

        private const string SwordSemanticId = "gear.sword.ironwood";
        private const string KeeperSemanticId = "world.keeper";
        private static int keeperClipImportRetries;

        [MenuItem("GalaQuest/Migration/Build Asset Intake Proof")]
        public static void BuildAssetIntakeProof()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var provenance = ReadAndValidateProvenance();
            ConfigureNativeModelImporters();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var keeperClips = GetActualKeeperClips();
            if (keeperClips.Length == 0)
            {
                if (keeperClipImportRetries++ < 8)
                {
                    // Native FBX import can publish preview takes before final AnimationClip
                    // subassets. Let the editor process one update before inspecting again.
                    EditorApplication.delayCall += BuildAssetIntakeProof;
                    return;
                }
                throw new BuildFailedException("Keeper FBX imported no source animation clips; no fallback animation is permitted.");
            }
            keeperClipImportRetries = 0;

            var controller = EnsureKeeperController(keeperClips);
            var swordRecord = FindRecord(provenance, SwordSemanticId);
            var keeperRecord = FindRecord(provenance, KeeperSemanticId);
            EnsureProofPrefab(SwordPrefabPath, SwordModelPath, swordRecord, null);
            EnsureProofPrefab(KeeperPrefabPath, KeeperModelPath, keeperRecord, controller);
            EnsureFloorMaterial();
            BuildProofScene();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            Debug.Log($"GalaQuest migration asset intake proof built: Keeper clips={string.Join(", ", keeperClips.Select(clip => clip.name))}");
        }

        public static MigrationAssetProvenanceDocument ReadAndValidateProvenance()
        {
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(ProvenancePath);
            if (asset == null)
            {
                throw new BuildFailedException($"Migration provenance not found at {ProvenancePath}.");
            }

            MigrationAssetProvenanceDocument document;
            try
            {
                document = JsonUtility.FromJson<MigrationAssetProvenanceDocument>(asset.text);
            }
            catch (Exception exception)
            {
                throw new BuildFailedException($"Migration provenance JSON is invalid: {exception.Message}");
            }

            if (document == null || document.schema != "galaquest.unity-migration-asset-provenance" || document.schemaVersion != 1)
            {
                throw new BuildFailedException("Migration provenance schema is missing or incompatible.");
            }
            if (document.records == null || document.records.Length != 2)
            {
                throw new BuildFailedException("Migration provenance must contain exactly two records.");
            }
            foreach (var record in document.records)
            {
                if (record == null || string.IsNullOrWhiteSpace(record.semanticId) ||
                    string.IsNullOrWhiteSpace(record.sourceRepoPath) || string.IsNullOrWhiteSpace(record.sourceSha256) ||
                    string.IsNullOrWhiteSpace(record.derivativeRepoPath) || string.IsNullOrWhiteSpace(record.derivativeSha256) ||
                    record.conversionOptions == null || record.conversionTool != "Blender" ||
                    record.conversionToolVersion != "4.5.13 LTS")
                {
                    throw new BuildFailedException("Migration provenance contains an incomplete or incompatible record.");
                }
                if (record.conversionOptions.retarget || record.conversionOptions.materialRepair)
                {
                    throw new BuildFailedException($"Migration provenance for {record.semanticId} claims a forbidden repair or retarget.");
                }
            }
            return document;
        }

        public static void ConfigureNativeModelImporters()
        {
            ConfigureModelImporter(SwordModelPath, false);
            ConfigureModelImporter(KeeperModelPath, true);
        }

        public static AnimationClip[] GetActualKeeperClips()
        {
            var imported = AssetDatabase.LoadAllAssetsAtPath(KeeperModelPath);
            var importedClipNames = imported
                .OfType<AnimationClip>()
                .Select(clip => clip.name)
                .OrderBy(name => name, StringComparer.Ordinal)
                .ToArray();
            Debug.Log($"Migration Keeper animation assets: all={imported.Length}, clips={string.Join(", ", importedClipNames)}");
            var clips = imported
                .OfType<AnimationClip>()
                .Where(clip => !clip.name.Contains("__preview__", StringComparison.OrdinalIgnoreCase))
                .OrderBy(clip => clip.name, StringComparer.Ordinal)
                .ToArray();
            if (clips.Length > 0)
            {
                return clips;
            }
            // Unity may expose the native preview take before publishing the final subasset. These
            // are still clips from the FBX importer, never generated motions or a fallback pose;
            // retain their source take suffix honestly until the final subasset is available.
            return imported
                .OfType<AnimationClip>()
                .Where(clip => clip.name.Contains("|", StringComparison.Ordinal))
                .OrderBy(clip => clip.name, StringComparer.Ordinal)
                .ToArray();
        }

        public static MigrationAssetProvenanceRecord FindRecord(MigrationAssetProvenanceDocument document, string semanticId)
        {
            var record = document.records.SingleOrDefault(candidate => candidate.semanticId == semanticId);
            if (record == null)
            {
                throw new BuildFailedException($"Migration provenance has no record for {semanticId}.");
            }
            return record;
        }

        private static void ConfigureModelImporter(string path, bool animated)
        {
            var importer = AssetImporter.GetAtPath(path) as ModelImporter;
            if (importer == null)
            {
                throw new BuildFailedException($"Native ModelImporter did not load {path}.");
            }

            var changed = false;
            if (importer.importAnimation != animated)
            {
                importer.importAnimation = animated;
                changed = true;
            }
            if (animated && importer.animationType != ModelImporterAnimationType.Generic)
            {
                importer.animationType = ModelImporterAnimationType.Generic;
                changed = true;
            }
            if (animated && importer.animationCompression != ModelImporterAnimationCompression.Off)
            {
                importer.animationCompression = ModelImporterAnimationCompression.Off;
                changed = true;
            }
            if (animated && importer.clipAnimations.Length == 0 && importer.defaultClipAnimations.Length > 0)
            {
                // Copy Unity's discovered takes, preserving names and ranges from the FBX. No
                // historical clip names are supplied by this package.
                importer.clipAnimations = importer.defaultClipAnimations;
                changed = true;
            }
            if (importer.materialImportMode != ModelImporterMaterialImportMode.ImportStandard)
            {
                importer.materialImportMode = ModelImporterMaterialImportMode.ImportStandard;
                changed = true;
            }
            if (changed)
            {
                importer.SaveAndReimport();
            }
            if (animated)
            {
                Debug.Log($"Migration ModelImporter animation settings: path={path} importAnimation={importer.importAnimation} " +
                    $"defaultClips={importer.defaultClipAnimations.Length} configuredClips={importer.clipAnimations.Length}");
            }
        }

        private static AnimatorController EnsureKeeperController(AnimationClip[] clips)
        {
            EnsureFolder("Assets/GalaQuest/Migration/Generated");
            var controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(ControllerPath);
            if (controller == null)
            {
                controller = AnimatorController.CreateAnimatorControllerAtPath(ControllerPath);
            }
            if (controller.layers.Length == 0)
            {
                controller.AddLayer("Base Layer");
            }

            var stateMachine = controller.layers[0].stateMachine;
            var statesByName = stateMachine.states.ToDictionary(state => state.state.name, state => state.state, StringComparer.Ordinal);
            foreach (var clip in clips)
            {
                if (!statesByName.TryGetValue(clip.name, out var state))
                {
                    state = stateMachine.AddState(clip.name);
                    statesByName.Add(clip.name, state);
                }
                state.motion = clip;
            }

            var defaultClip = clips.FirstOrDefault(clip => clip.name.EndsWith("idle", StringComparison.OrdinalIgnoreCase)) ?? clips[0];
            stateMachine.defaultState = statesByName[defaultClip.name];
            EditorUtility.SetDirty(controller);
            return controller;
        }

        private static void EnsureProofPrefab(
            string prefabPath,
            string modelPath,
            MigrationAssetProvenanceRecord record,
            RuntimeAnimatorController controller)
        {
            EnsureFolder("Assets/GalaQuest/Migration/Prefabs");
            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            GameObject root;
            if (existing == null)
            {
                var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
                if (model == null)
                {
                    throw new BuildFailedException($"Imported model root not found at {modelPath}.");
                }
                root = (GameObject)PrefabUtility.InstantiatePrefab(model);
                root.name = record.displayName + " Migration Proof";
            }
            else
            {
                root = PrefabUtility.LoadPrefabContents(prefabPath);
            }

            var identity = root.GetComponent<MigrationProofAssetIdentity>() ?? root.AddComponent<MigrationProofAssetIdentity>();
            identity.Apply(record);
            if (controller != null)
            {
                var animator = root.GetComponent<Animator>();
                if (animator == null)
                {
                    animator = root.AddComponent<Animator>();
                }
                animator.runtimeAnimatorController = controller;
                animator.applyRootMotion = false;
            }

            var saved = PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
            if (saved == null)
            {
                throw new BuildFailedException($"Could not save migration proof prefab {prefabPath}.");
            }
            if (existing == null)
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
            else
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static Material EnsureFloorMaterial()
        {
            EnsureFolder("Assets/GalaQuest/Migration/Generated");
            var material = AssetDatabase.LoadAssetAtPath<Material>(FloorMaterialPath);
            if (material == null)
            {
                var shader = Shader.Find("Universal Render Pipeline/Lit");
                if (shader == null)
                {
                    throw new BuildFailedException("Universal Render Pipeline/Lit shader was not found.");
                }
                material = new Material(shader) { name = "MigrationProofFloor" };
                material.SetColor("_BaseColor", new Color(0.16f, 0.19f, 0.22f, 1f));
                material.SetFloat("_Metallic", 0f);
                material.SetFloat("_Smoothness", 0.35f);
                AssetDatabase.CreateAsset(material, FloorMaterialPath);
            }
            return material;
        }

        private static void BuildProofScene()
        {
            EnsureFolder("Assets/GalaQuest/Migration/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "MigrationProof";
            RenderSettings.skybox = null;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.18f, 0.2f, 0.24f, 1f);
            RenderSettings.fog = false;

            var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
            floor.name = "MigrationProof Neutral Floor";
            floor.transform.position = new Vector3(0f, -0.01f, 0f);
            floor.transform.localScale = new Vector3(1.2f, 1f, 1.2f);
            floor.GetComponent<MeshRenderer>().sharedMaterial = AssetDatabase.LoadAssetAtPath<Material>(FloorMaterialPath);

            var swordPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(SwordPrefabPath);
            var keeperPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(KeeperPrefabPath);
            if (swordPrefab == null || keeperPrefab == null)
            {
                throw new BuildFailedException("Migration proof prefabs were not available while constructing the scene.");
            }

            var sword = (GameObject)PrefabUtility.InstantiatePrefab(swordPrefab);
            sword.name = "MigrationProof Ironwood Sword";
            sword.transform.position = new Vector3(-1.4f, 0.5f, 0f);
            sword.transform.rotation = Quaternion.Euler(0f, 22f, 0f);

            var keeper = (GameObject)PrefabUtility.InstantiatePrefab(keeperPrefab);
            keeper.name = "MigrationProof Lantern Keeper";
            keeper.transform.position = new Vector3(0.65f, 0f, 0f);
            keeper.transform.rotation = Quaternion.Euler(0f, -12f, 0f);

            var lightObject = new GameObject("MigrationProof Key Light");
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.1f;
            light.color = new Color(1f, 0.94f, 0.84f, 1f);
            lightObject.transform.rotation = Quaternion.Euler(46f, -28f, 0f);

            CreateCamera("MigrationProof Sword 3Q Camera", new Vector3(-1.4f, 0.82f, 3.1f), new Vector3(-1.4f, 0.5f, 0f), 34f);
            CreateCamera("MigrationProof Keeper Front Camera", new Vector3(0.65f, 0.9f, 3.3f), new Vector3(0.65f, 0.82f, 0f), 32f);
            CreateCamera("MigrationProof Keeper 3Q Camera", new Vector3(3.15f, 1.15f, 2.7f), new Vector3(0.65f, 0.82f, 0f), 34f);
            CreateCamera("MigrationProof Keeper Side Camera", new Vector3(3.6f, 0.88f, 0.05f), new Vector3(0.65f, 0.82f, 0f), 34f);

            var cameras = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None);
            foreach (var camera in cameras)
            {
                camera.enabled = camera.name == "MigrationProof Keeper 3Q Camera";
            }
            SceneView.lastActiveSceneView?.FrameSelected();
            if (!EditorSceneManager.SaveScene(scene, ScenePath))
            {
                throw new BuildFailedException($"Could not save migration proof scene {ScenePath}.");
            }
            AddSceneToBuildSettings(ScenePath);
        }

        private static Camera CreateCamera(string name, Vector3 position, Vector3 target, float fieldOfView)
        {
            var cameraObject = new GameObject(name);
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.035f, 0.045f, 0.06f, 1f);
            camera.fieldOfView = fieldOfView;
            camera.nearClipPlane = 0.03f;
            camera.farClipPlane = 100f;
            camera.allowHDR = false;
            camera.allowMSAA = false;
            cameraObject.transform.position = position;
            cameraObject.transform.LookAt(target, Vector3.up);
            return camera;
        }

        private static void AddSceneToBuildSettings(string scenePath)
        {
            var scenes = EditorBuildSettings.scenes.ToList();
            if (!scenes.Any(scene => scene.path == scenePath))
            {
                scenes.Add(new EditorBuildSettingsScene(scenePath, true));
                EditorBuildSettings.scenes = scenes.ToArray();
            }
        }

        private static void EnsureFolder(string path)
        {
            var parts = path.Split('/');
            var current = parts[0];
            for (var index = 1; index < parts.Length; index++)
            {
                var next = $"{current}/{parts[index]}";
                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(current, parts[index]);
                }
                current = next;
            }
        }
    }
}
