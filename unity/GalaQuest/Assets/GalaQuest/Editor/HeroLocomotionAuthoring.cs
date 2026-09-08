using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Editor
{
    public static class HeroLocomotionAuthoring
    {
        public const string AnimationFolder = "Assets/GalaQuest/Movement/Animation";
        public const string ControllerPath = AnimationFolder + "/HeroLocomotion.controller";
        private const string SourcePath = "Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/Hero.fbx";

        [MenuItem("GalaQuest/Movement/Wire Hero Locomotion")]
        public static void Wire()
        {
            var scene = EditorSceneManager.OpenScene(EmberworksGreyboxBuild.ScenePath, OpenSceneMode.Single);
            var objects = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<Transform>(true)).ToArray();
            var root = objects.Single(item => item.name == EmberworksGreyboxBuild.RuntimeRootName).gameObject;
            var hero = objects.Single(item => item.name == EmberworksGreyboxBuild.RuntimeHeroName).gameObject;
            var traversal = root.GetComponent<GalaQuestTraversalController>();
            if (traversal == null) throw new BuildFailedException("Connected traversal must be wired first.");
            Directory.CreateDirectory(AnimationFolder);
            AssetDatabase.Refresh();
            var controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(ControllerPath);
            if (controller == null) controller = AnimatorController.CreateAnimatorControllerAtPath(ControllerPath);
            var idle = Loop("Armature|idle", "Hero Idle");
            var walk = Loop("Armature|Armature|walking_man|baselayer", "Hero Walk");
            var run = Loop("Armature|Armature|running|baselayer", "Hero Run");
            if (!controller.parameters.Any(parameter => parameter.name == GalaQuestHeroLocomotion.SpeedParameter))
                controller.AddParameter(GalaQuestHeroLocomotion.SpeedParameter, AnimatorControllerParameterType.Float);
            if (controller.layers.Length == 0) controller.AddLayer("Base Layer");
            var machine = controller.layers[0].stateMachine;
            var state = machine.states.FirstOrDefault(item => item.state.name == "Locomotion").state;
            if (state == null) state = machine.AddState("Locomotion");
            var tree = state.motion as BlendTree;
            if (tree == null)
            {
                tree = new BlendTree { name = "Idle Walk Run" };
                AssetDatabase.AddObjectToAsset(tree, controller);
            }
            tree.blendType = BlendTreeType.Simple1D;
            tree.blendParameter = GalaQuestHeroLocomotion.SpeedParameter;
            tree.useAutomaticThresholds = false;
            tree.children = new ChildMotion[0];
            tree.AddChild(idle, 0f);
            tree.AddChild(walk, GalaQuestMovementLaw.WalkSpeed);
            tree.AddChild(run, GalaQuestMovementLaw.RunSpeed);
            state.motion = tree;
            machine.defaultState = state;
            EditorUtility.SetDirty(tree);
            EditorUtility.SetDirty(state);
            EditorUtility.SetDirty(machine);
            EditorUtility.SetDirty(controller);
            AssetDatabase.SaveAssets();
            var animator = hero.GetComponent<Animator>();
            if (animator == null) animator = hero.AddComponent<Animator>();
            // Generic clips bind to the existing transform hierarchy, as in the Gear Workbench.
            // No avatar retargeting, skeleton edits, or source-import changes are performed.
            animator.runtimeAnimatorController = controller;
            var locomotion = root.GetComponent<GalaQuestHeroLocomotion>();
            if (locomotion == null) locomotion = root.AddComponent<GalaQuestHeroLocomotion>();
            locomotion.Configure(traversal, animator);
            EditorUtility.SetDirty(animator);
            EditorUtility.SetDirty(locomotion);
            EditorSceneManager.MarkSceneDirty(scene);
            if (!EditorSceneManager.SaveScene(scene)) throw new BuildFailedException("Could not save locomotion wiring.");
            AssetDatabase.SaveAssets();
            Debug.Log("Connected hero locomotion wired from existing source clips; source FBX and hierarchy preserved.");
        }

        private static AnimationClip Loop(string sourceName, string outputName)
        {
            var path = AnimationFolder + "/" + outputName.Replace(" ", "") + ".anim";
            var existing = AssetDatabase.LoadAssetAtPath<AnimationClip>(path);
            if (existing != null) return existing;
            var source = AssetDatabase.LoadAllAssetsAtPath(SourcePath).OfType<AnimationClip>().Single(clip => clip.name == sourceName);
            var copy = Object.Instantiate(source);
            copy.name = outputName;
            var settings = AnimationUtility.GetAnimationClipSettings(copy);
            settings.loopTime = true;
            AnimationUtility.SetAnimationClipSettings(copy, settings);
            AssetDatabase.CreateAsset(copy, path);
            return copy;
        }
    }
}
