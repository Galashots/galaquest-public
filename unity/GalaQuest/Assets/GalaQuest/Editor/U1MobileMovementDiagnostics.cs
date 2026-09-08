using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Editor
{
    /// <summary>Read-only scene/clip evidence for the connected movement milestone.</summary>
    public static class U1MobileMovementDiagnostics
    {
        public static void Inspect()
        {
            var scene = EditorSceneManager.OpenScene(EmberworksGreyboxBuild.ScenePath, OpenSceneMode.Single);
            var hero = Object.FindObjectsByType<Transform>(FindObjectsSortMode.None)
                .First(item => item.name == EmberworksGreyboxBuild.RuntimeHeroName);
            var report = new StringBuilder();
            report.AppendLine($"Scene: {scene.path}");
            report.AppendLine($"Hero: {hero.name}; position={hero.position}; scale={hero.lossyScale}");
            foreach (var animator in hero.GetComponentsInChildren<Animator>(true))
                report.AppendLine($"Animator: {animator.name}; enabled={animator.enabled}; controller=" +
                    $"{(animator.runtimeAnimatorController == null ? "NONE" : animator.runtimeAnimatorController.name)}; " +
                    $"avatar={(animator.avatar == null ? "NONE" : animator.avatar.name)}; rootMotion={animator.applyRootMotion}");
            foreach (var renderer in hero.GetComponentsInChildren<Renderer>(true))
                report.AppendLine($"Hero renderer: {renderer.name}; bounds={renderer.bounds}");
            const string model = "Assets/GalaQuest/Migration/SourceAssets/VisibleArmor/Hero.fbx";
            foreach (var clip in AssetDatabase.LoadAllAssetsAtPath(model).OfType<AnimationClip>()
                .Where(item => !item.name.StartsWith("__preview__")))
            {
                var bindings = AnimationUtility.GetCurveBindings(clip);
                var varying = bindings.Count(binding =>
                {
                    var keys = AnimationUtility.GetEditorCurve(clip, binding).keys;
                    return keys.Length > 1 && keys.Max(key => key.value) - keys.Min(key => key.value) > 0.0001f;
                });
                report.AppendLine($"Clip: {clip.name}; duration={clip.length}; loop={clip.isLooping}; " +
                    $"curves={bindings.Length}; varyingCurves={varying}; averageSpeed={clip.averageSpeed}");
            }
            foreach (var collider in Object.FindObjectsByType<Collider>(FindObjectsSortMode.None))
                report.AppendLine($"Collider: {collider.name}; trigger={collider.isTrigger}; bounds={collider.bounds}");
            Directory.CreateDirectory("Logs");
            File.WriteAllText("Logs/m1-scene-diagnostic.txt", report.ToString());
            Debug.Log(report.ToString());
        }

        public static void BuildWebGL()
        {
            Inspect();
            FoundationBuild.BuildWebGL();
        }
    }
}
