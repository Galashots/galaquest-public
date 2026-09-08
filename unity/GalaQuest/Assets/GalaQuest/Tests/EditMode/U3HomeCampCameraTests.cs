using System.Linq;
using System.Reflection;
using GalaQuest.Editor;
using NUnit.Framework;
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
    }
}
