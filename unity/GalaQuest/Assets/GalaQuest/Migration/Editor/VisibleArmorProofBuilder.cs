using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using GalaQuest.Migration;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace GalaQuest.Editor
{
    /// <summary>Builds one Hero before/after armor proof, not a general equipment pipeline.</summary>
    public static class VisibleArmorProofBuilder
    {
        public const string HeroModelPath = "Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/Hero.fbx";
        public const string HelmetModelPath = "Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/SilverguardHelmet.fbx";
        public const string ManifestPath = VisibleArmorManifest.AssetPath;
        public const string ProvenancePath = "Assets/GalaQuest/Migration/VisibleArmorProvenance.json";
        public const string UnequippedPrefabPath = "Assets/GalaQuest/Migration/VisibleArmor/Prefabs/HeroUnequipped.prefab";
        public const string EquippedPrefabPath = "Assets/GalaQuest/Migration/VisibleArmor/Prefabs/HeroEquippedSilverguardHelmet.prefab";
        public const string ScenePath = "Assets/GalaQuest/Migration/VisibleArmor/Scenes/VisibleArmorProof.unity";

        [MenuItem("GalaQuest/Migration/Build Visible Armor Proof")]
        public static void Build()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var manifest = LoadManifest();
            ConfigureModelImporter(HeroModelPath, true, 1f);
            ConfigureModelImporter(HelmetModelPath, false, 100f);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var heroModel = LoadModel(HeroModelPath);
            var helmetModel = LoadModel(HelmetModelPath);
            EnsurePrefabFolders();
            BuildPrefab(UnequippedPrefabPath, heroModel, helmetModel, manifest, false);
            BuildPrefab(EquippedPrefabPath, heroModel, helmetModel, manifest, true);
            BuildScene(manifest);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            Debug.Log("Visible armor proof built from the current exported Hero and Silverguard fit authority.");
        }

        public static VisibleArmorManifestDocument LoadManifest()
        {
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(ManifestPath);
            if (asset == null) throw new BuildFailedException($"Visible armor manifest missing at {ManifestPath}.");
            try { return VisibleArmorManifest.Parse(asset.text); }
            catch (Exception exception) { throw new BuildFailedException(exception.Message); }
        }

        private static GameObject LoadModel(string path)
        {
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (model == null) throw new BuildFailedException($"Native Unity model import missing {path}.");
            return model;
        }

        private static void ConfigureModelImporter(string path, bool animated, float globalScale)
        {
            var importer = AssetImporter.GetAtPath(path) as ModelImporter;
            if (importer == null) throw new BuildFailedException($"Native ModelImporter missing {path}.");
            var changed = false;
            if (importer.importAnimation != animated) { importer.importAnimation = animated; changed = true; }
            if (animated && importer.animationType != ModelImporterAnimationType.Generic)
            { importer.animationType = ModelImporterAnimationType.Generic; changed = true; }
            if (animated && importer.animationCompression != ModelImporterAnimationCompression.Off)
            { importer.animationCompression = ModelImporterAnimationCompression.Off; changed = true; }
            if (importer.materialImportMode != ModelImporterMaterialImportMode.ImportStandard)
            { importer.materialImportMode = ModelImporterMaterialImportMode.ImportStandard; changed = true; }
            if (!Mathf.Approximately(importer.globalScale, globalScale))
            { importer.globalScale = globalScale; changed = true; }
            if (changed) importer.SaveAndReimport();
        }

        private static void BuildPrefab(string path, GameObject heroModel, GameObject helmetModel, VisibleArmorManifestDocument manifest, bool equipped)
        {
            var root = UnityEngine.Object.Instantiate(heroModel);
            root.name = equipped ? "GalaQuest Hero Equipped Silverguard Helmet" : "GalaQuest Hero Unequipped";
            var proof = root.AddComponent<VisibleArmorHeroProof>();
            GameObject helmet = null;
            if (equipped)
            {
                helmet = UnityEngine.Object.Instantiate(helmetModel);
                VisibleArmorFitPlacement.Attach(root.transform, helmet, manifest.fitAuthority);
            }
            proof.Configure(manifest, helmet, equipped);
            var saved = PrefabUtility.SaveAsPrefabAsset(root, path);
            if (saved == null) throw new BuildFailedException($"Could not save visible armor prefab {path}.");
            UnityEngine.Object.DestroyImmediate(root);
        }

        private static void BuildScene(VisibleArmorManifestDocument manifest)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "VisibleArmorProof";
            RenderSettings.skybox = null;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.28f, 0.31f, 0.36f, 1f);
            RenderSettings.fog = false;

            var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
            floor.name = "Visible Armor Proof Neutral Floor";
            floor.transform.position = new Vector3(0f, -0.02f, 0f);
            floor.transform.localScale = new Vector3(2.5f, 1f, 2.5f);
            var floorRenderer = floor.GetComponent<MeshRenderer>();
            floorRenderer.sharedMaterial = MakeFloorMaterial();

            var unequipped = InstantiatePrefab(UnequippedPrefabPath, "Hero Unequipped (control)", new Vector3(-0.72f, 0f, 0f));
            var equipped = InstantiatePrefab(EquippedPrefabPath, "Hero Equipped Silverguard Helmet", new Vector3(0.72f, 0f, 0f));
            unequipped.transform.rotation = Quaternion.Euler(0f, 8f, 0f);
            equipped.transform.rotation = Quaternion.Euler(0f, -8f, 0f);

            var lightObject = new GameObject("Visible Armor Proof Key Light");
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.25f;
            light.color = new Color(1f, 0.96f, 0.9f, 1f);
            lightObject.transform.rotation = Quaternion.Euler(42f, -32f, 0f);

            CreateCamera("VisibleArmor Gameplay Camera", new Vector3(0f, 0.86f, 3.8f), new Vector3(0f, 0.86f, 0f), 31f);
            CreateCamera("VisibleArmor Equipped ThreeQuarter Camera", new Vector3(2.15f, 1.0f, 3.2f), new Vector3(0.72f, 0.9f, 0f), 24f);
            CreateCamera("VisibleArmor Equipped Side Camera", new Vector3(2.55f, 0.86f, 0.12f), new Vector3(0.72f, 0.9f, 0f), 24f);
            foreach (var camera in UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None))
                camera.enabled = camera.name == "VisibleArmor Gameplay Camera";

            var marker = new GameObject("Visible Armor Proof Authority");
            var identity = marker.AddComponent<VisibleArmorProofMarker>();
            identity.Configure(manifest);
            if (!EditorSceneManager.SaveScene(scene, ScenePath)) throw new BuildFailedException($"Could not save {ScenePath}.");
            AddSceneToBuildSettings(ScenePath);
        }

        private static GameObject InstantiatePrefab(string path, string name, Vector3 position)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) throw new BuildFailedException($"Visible armor prefab missing {path}.");
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            instance.name = name;
            instance.transform.position = position;
            return instance;
        }

        private static Material MakeFloorMaterial()
        {
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) throw new BuildFailedException("URP Lit shader was not found.");
            var material = new Material(shader) { name = "VisibleArmorProofFloor" };
            material.SetColor("_BaseColor", new Color(0.17f, 0.2f, 0.24f, 1f));
            material.SetFloat("_Metallic", 0f);
            material.SetFloat("_Smoothness", 0.35f);
            return material;
        }

        private static Camera CreateCamera(string name, Vector3 position, Vector3 target, float fieldOfView)
        {
            var objectRoot = new GameObject(name);
            var camera = objectRoot.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.045f, 0.055f, 0.075f, 1f);
            camera.fieldOfView = fieldOfView;
            camera.nearClipPlane = 0.03f;
            camera.farClipPlane = 100f;
            camera.allowHDR = false;
            camera.allowMSAA = false;
            objectRoot.transform.position = position;
            objectRoot.transform.LookAt(target, Vector3.up);
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

        private static void EnsurePrefabFolders()
        {
            if (!AssetDatabase.IsValidFolder("Assets/GalaQuest/Migration/VisibleArmor"))
                AssetDatabase.CreateFolder("Assets/GalaQuest/Migration", "VisibleArmor");
            if (!AssetDatabase.IsValidFolder("Assets/GalaQuest/Migration/VisibleArmor/Prefabs"))
                AssetDatabase.CreateFolder("Assets/GalaQuest/Migration/VisibleArmor", "Prefabs");
            if (!AssetDatabase.IsValidFolder("Assets/GalaQuest/Migration/VisibleArmor/Scenes"))
                AssetDatabase.CreateFolder("Assets/GalaQuest/Migration/VisibleArmor", "Scenes");
        }
    }

    public sealed class VisibleArmorProofMarker : MonoBehaviour
    {
        [SerializeField] private string originatingGitSha;
        [SerializeField] private string heroSemanticId;
        [SerializeField] private string gearSemanticId;
        [SerializeField] private string fitAuthoritySourcePath;

        public string OriginatingGitSha => originatingGitSha;
        public string HeroSemanticId => heroSemanticId;
        public string GearSemanticId => gearSemanticId;
        public string FitAuthoritySourcePath => fitAuthoritySourcePath;

        public void Configure(VisibleArmorManifestDocument manifest)
        {
            originatingGitSha = manifest.originatingGitSha;
            heroSemanticId = manifest.hero.semanticId;
            gearSemanticId = manifest.gear.semanticId;
            fitAuthoritySourcePath = manifest.fitAuthority.runtimeSourcePath;
        }
    }
}
