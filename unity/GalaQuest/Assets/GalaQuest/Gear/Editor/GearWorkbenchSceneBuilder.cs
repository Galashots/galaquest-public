using System.Collections.Generic;
using System.IO;
using System.Linq;
using GalaQuest.Gear;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Creates the workbench scene: GQ_HERO_V1, neutral lighting, the Head Fit Proxy visualizer, every
    /// GearItemDefinition mounted through the ordinary <see cref="GearMounter"/>, and an Animator wired
    /// to GQ_HERO_V1's own clips.
    ///
    /// The same scene is the Owner's fitting surface in Edit Mode and the PlayMode animation-sweep
    /// fixture, so the pose the Owner accepted is the pose the gates actually swept.
    ///
    /// Deterministic and regenerable -- the scene is a view, not authority. Item fits live in
    /// GearItemDefinition assets, so deleting and rebuilding this scene loses nothing.
    /// </summary>
    public static class GearWorkbenchSceneBuilder
    {
        public const string ControllerPath = "Assets/GalaQuest/Gear/Definitions/GQ_HERO_V1_Poses.controller";

        [MenuItem("GalaQuest/Gear/Rebuild Gear Workbench scene")]
        public static void Build()
        {
            var heroPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            if (heroPrefab == null)
            {
                GearHeroAuthoring.RebuildAll();
                heroPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            }

            if (heroPrefab == null)
                throw new FileNotFoundException("GQ_HERO_V1 prefab missing: " + GearHeroAuthoring.HeroPrefabPath);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var key = new GameObject("Workbench Key Light");
            var keyLight = key.AddComponent<Light>();
            keyLight.type = LightType.Directional;
            keyLight.intensity = 1.1f;
            keyLight.shadows = LightShadows.Soft;
            key.transform.rotation = Quaternion.Euler(35f, 150f, 0f);

            var fill = new GameObject("Workbench Fill Light");
            var fillLight = fill.AddComponent<Light>();
            fillLight.type = LightType.Directional;
            fillLight.intensity = 0.35f;
            fillLight.shadows = LightShadows.None;
            fill.transform.rotation = Quaternion.Euler(15f, -40f, 0f);

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(heroPrefab);
            hero.transform.position = Vector3.zero;
            hero.transform.rotation = Quaternion.identity;

            var proxy = AssetDatabase.LoadAssetAtPath<HeadFitProxy>(GearHeroAuthoring.HeadProxyPath);
            var head = GearHeroAuthoring.FindDescendant(hero.transform, GearSocketIds.HeadBone);
            if (proxy != null && head != null)
            {
                hero.AddComponent<HeadFitProxyVisualizer>().Configure(proxy, head);
            }

            var controller = BuildPoseController(out var stateNames);
            var animator = hero.GetComponent<Animator>();
            if (animator == null) animator = hero.AddComponent<Animator>();
            animator.runtimeAnimatorController = controller;
            animator.applyRootMotion = false;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;

            HideBakedAtlasGear(hero);
            MountAllDefinitions(hero);

            var rig = hero.AddComponent<GearFitProofRig>();
            rig.Configure(hero.transform, proxy, animator, stateNames);

            Directory.CreateDirectory(Path.GetDirectoryName(GearWorkbenchWindow.ScenePath));
            EditorSceneManager.SaveScene(scene, GearWorkbenchWindow.ScenePath);
            RegisterBuildScene(GearWorkbenchWindow.ScenePath);
            AssetDatabase.Refresh();
            Debug.Log("GalaQuest gear workbench scene rebuilt at " + GearWorkbenchWindow.ScenePath + ".");
        }

        /// <summary>
        /// The shipped Hero atlas has the Tier 2 sword and shield baked into it as their own mesh nodes,
        /// because public/src/character/gear.js re-parents those merged nodes rather than loading files.
        /// In the workbench they would render alongside the item being fitted, so the scene hides them.
        ///
        /// This is a VIEW decision in a regenerable scene. The GQ_HERO_V1 prefab and the shipped atlas are
        /// untouched -- nothing here changes what the Hero is.
        /// </summary>
        private static void HideBakedAtlasGear(GameObject hero)
        {
            foreach (var bakedName in new[] { "shield_ironwood", "sword_ironwood" })
            {
                var baked = GearHeroAuthoring.FindDescendant(hero.transform, bakedName);
                if (baked == null) continue;
                baked.gameObject.SetActive(false);
                Debug.Log("Workbench scene hid the baked atlas node '" + bakedName +
                          "' so the mounted item is judged alone.");
            }
        }

        private static void MountAllDefinitions(GameObject hero)
        {
            var definitions = AssetDatabase.FindAssets("t:GearItemDefinition")
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearItemDefinition>)
                .Where(asset => asset != null && asset.SourceModel != null)
                .OrderBy(asset => asset.SemanticId);

            foreach (var definition in definitions)
            {
                try
                {
                    var mounted = GearMounter.Mount(hero.transform, definition);
                    mounted.AddComponent<GearMountedItem>().Configure(definition);
                }
                catch (GearMounter.MountFailure failure)
                {
                    Debug.LogWarning("Skipped " + definition.SemanticId + " in the workbench scene: " +
                                     failure.Message);
                }
            }
        }

        private static AnimatorController BuildPoseController(out string[] stateNames)
        {
            var clips = AssetDatabase.LoadAllAssetsAtPath(GearHeroAuthoring.HeroModelPath)
                .OfType<AnimationClip>()
                .Where(clip => !clip.name.StartsWith("__preview__"))
                .OrderBy(clip => clip.name)
                .ToArray();

            Directory.CreateDirectory(Path.GetDirectoryName(ControllerPath));
            if (File.Exists(ControllerPath)) AssetDatabase.DeleteAsset(ControllerPath);

            var controller = AnimatorController.CreateAnimatorControllerAtPath(ControllerPath);
            var stateMachine = controller.layers[0].stateMachine;

            var names = new List<string>();
            foreach (var clip in clips)
            {
                var state = stateMachine.AddState(clip.name);
                state.motion = clip;
                state.writeDefaultValues = true;
                names.Add(clip.name);
            }

            if (clips.Length > 0)
            {
                stateMachine.defaultState = stateMachine.states[0].state;
            }

            EditorUtility.SetDirty(controller);
            stateNames = names.ToArray();
            return controller;
        }

        private static void RegisterBuildScene(string scenePath)
        {
            var scenes = EditorBuildSettings.scenes.ToList();
            if (scenes.Any(scene => scene.path == scenePath)) return;
            scenes.Add(new EditorBuildSettingsScene(scenePath, true));
            EditorBuildSettings.scenes = scenes.ToArray();
        }
    }
}
