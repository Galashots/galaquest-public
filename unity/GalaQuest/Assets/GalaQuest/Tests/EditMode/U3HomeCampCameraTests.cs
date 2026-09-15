using System.Linq;
using System.Reflection;
using GalaQuest.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class U3HomeCampCameraTests
    {
        [Test]
        public void ActualCampTreeCannotSitBetweenTheOrbitCameraAndHero()
        {
            var scene = EditorSceneManager.OpenScene(EmberworksGreyboxBuild.ScenePath, OpenSceneMode.Additive);
            try
            {
                var roots = scene.GetRootGameObjects();
                roots.Single(root => root.name == "EmberworksDeep").SetActive(false);
                var home = roots.Single(root => root.name == HomeHubAuthoring.RootName);
                home.SetActive(true);
                var runtime = roots.Single(root => root.name == EmberworksGreyboxBuild.RuntimeRootName);
                var hero = runtime.GetComponent<GalaQuestTraversalController>().Hero;
                hero.position = new Vector3(8.5f, hero.position.y, 2f);
                var camera = runtime.GetComponentInChildren<GalaQuestGameplayCamera>(true);
                typeof(GalaQuestGameplayCamera).GetField("yaw", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(camera, 270f);
                Physics.SyncTransforms();
                camera.Configure(hero);
                var center = hero.position + new Vector3(0, .6f, 0);
                Assert.That(Vector3.Distance(camera.transform.position, center), Is.LessThan(7f),
                    "The default long orbit places the camp tree directly in front of the hero");
                Assert.That(home.GetComponentsInChildren<Collider>().Any(c => c.name.StartsWith("TreeCrown")), Is.True);
                Assert.That(home.GetComponentsInChildren<Collider>().Any(c => c.name == "MeetingCircle" || c.name == "ArrivalLight"), Is.False);
            }
            finally { EditorSceneManager.CloseScene(scene, true); }
        }
        [TestCase("HeroIdle", 0f)]
        [TestCase("HeroIdle", .25f)]
        [TestCase("HeroIdle", .5f)]
        [TestCase("HeroIdle", .75f)]
        [TestCase("HeroWalk", 0f)]
        [TestCase("HeroWalk", .25f)]
        [TestCase("HeroWalk", .5f)]
        [TestCase("HeroWalk", .75f)]
        [TestCase("HeroRun", 0f)]
        [TestCase("HeroRun", .25f)]
        [TestCase("HeroRun", .5f)]
        [TestCase("HeroRun", .75f)]
        public void ActualCampHeroFeetStayWithinGroundContactTolerance(string clipName, float fraction)
        {
            var scene = EditorSceneManager.OpenScene(EmberworksGreyboxBuild.ScenePath, OpenSceneMode.Additive);
            Mesh baked = null;
            try
            {
                var roots = scene.GetRootGameObjects();
                roots.Single(root => root.name == "EmberworksDeep").SetActive(false);
                var home = roots.Single(root => root.name == HomeHubAuthoring.RootName);
                home.SetActive(true);
                var runtime = roots.Single(root => root.name == EmberworksGreyboxBuild.RuntimeRootName);
                var hero = runtime.GetComponent<GalaQuestTraversalController>().Hero;
                Assert.That(hero.position.y, Is.EqualTo(EmberworksGreyboxBuild.RuntimeHeroGroundClearance).Within(.001f));
                var idle = AssetDatabase.LoadAssetAtPath<AnimationClip>(
                    HeroLocomotionAuthoring.AnimationFolder + "/" + clipName + ".anim");
                Assert.That(idle, Is.Not.Null);
                idle.SampleAnimation(hero.gameObject, idle.length * fraction);
                var body = hero.GetComponentsInChildren<SkinnedMeshRenderer>(true).Single();
                baked = new Mesh();
                body.BakeMesh(baked);
                var lowest = baked.vertices.Min(vertex => body.transform.TransformPoint(vertex).y);
                var floor = home.GetComponentsInChildren<Renderer>(true)
                    .Single(renderer => renderer.name == "MeetingCircle").bounds.max.y;
                var gap = lowest - floor;
                Assert.That(gap, Is.InRange(-.05f, .075f),
                    $"Camp fallback should keep the approved Hero visually grounded; measured foot/ground gap={gap:0.000}m");
            }
            finally
            {
                if (baked != null) Object.DestroyImmediate(baked);
                EditorSceneManager.CloseScene(scene, true);
            }
        }
    }
}
