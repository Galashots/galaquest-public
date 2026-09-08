using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEditor.SceneManagement;

namespace GalaQuest.Tests
{
    public sealed class U1TraversalCollisionEditModeTests
    {
        [Test]
        public void PredictionPassesTheSameCollisionCasesAsTheServer()
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../../test/fixtures/emberworks-movement-cases.json"));
            var fixtures = JsonUtility.FromJson<FixtureSet>(File.ReadAllText(path));
            Assert.That(fixtures.cases.Length, Is.GreaterThanOrEqualTo(14));
            foreach (var item in fixtures.cases)
            {
                var actual = GalaQuestEmberworksMovementWorld.Move(item.from.Vector, item.to.Vector);
                Assert.That(Vector2.Distance(actual, item.expected.Vector), Is.LessThan(0.0001f), item.name);
            }
        }

        [Test]
        public void MovementSolidsMatchUprightCollidersInTheActualScene()
        {
            var scene = EditorSceneManager.OpenScene("Assets/GalaQuest/Emberworks/Scenes/EmberworksDeep.unity", OpenSceneMode.Additive);
            try
            {
                var colliders = scene.GetRootGameObjects().SelectMany(root => root.GetComponentsInChildren<Collider>(true)).ToArray();
                Physics.SyncTransforms();
                foreach (var solid in GalaQuestEmberworksMovementWorld.Solids)
                {
                    var collider = colliders.Single(item => item.name == solid.Name);
                    var bounds = collider.bounds;
                    Assert.That(bounds.min.x, Is.EqualTo(solid.MinX).Within(0.001f), solid.Name);
                    Assert.That(bounds.max.x, Is.EqualTo(solid.MaxX).Within(0.001f), solid.Name);
                    Assert.That(bounds.min.z, Is.EqualTo(solid.MinZ).Within(0.001f), solid.Name);
                    Assert.That(bounds.max.z, Is.EqualTo(solid.MaxZ).Within(0.001f), solid.Name);
                    Assert.That(bounds.size.y, Is.GreaterThan(1f), solid.Name);
                }
                var margin = GalaQuestEmberworksMovementWorld.HeroClearance;
                var perimeter = colliders.Where(item => item.transform.parent != null &&
                    item.transform.parent.name == "OpeningRouteBoundary").ToArray();
                Assert.That(perimeter.Length, Is.EqualTo(8), "four perimeter walls and their visible metal caps");
                Assert.That(perimeter.Single(item => item.name == "West").bounds.max.x,
                    Is.EqualTo(GalaQuestEmberworksMovementWorld.MinX - margin).Within(0.001f));
                Assert.That(perimeter.Single(item => item.name == "East").bounds.min.x,
                    Is.EqualTo(GalaQuestEmberworksMovementWorld.MaxX + margin).Within(0.001f));
                Assert.That(perimeter.Single(item => item.name == "South").bounds.max.z,
                    Is.EqualTo(GalaQuestEmberworksMovementWorld.MinZ - margin).Within(0.001f));
                Assert.That(perimeter.Single(item => item.name == "North").bounds.min.z,
                    Is.EqualTo(GalaQuestEmberworksMovementWorld.MaxZ + margin).Within(0.001f));
            }
            finally { EditorSceneManager.CloseScene(scene, true); }
        }

        [Test]
        public void PredictedMovementStopsAtVisibleCavernWing()
        {
            var root = new GameObject("Collision test");
            var hero = new GameObject("Hero");
            var movement = root.AddComponent<GalaQuestTraversalController>();
            movement.Configure(null, hero.transform);
            var transport = new FakeTransport();
            using var session = new GalaQuestConnectionSession(transport);
            movement.BindSession(session);
            session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Collision test", "[]"));
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"players\":[{\"id\":\"p1\",\"x\":0,\"z\":4}]}");
            try
            {
                for (var step = 0; step < 101; step++) movement.StepPrediction(Vector2.up, 1f, true, 0.05f);
                Assert.That(movement.PredictedPosition.y, Is.GreaterThan(11f));
                Assert.That(movement.PredictedPosition.y, Is.LessThanOrEqualTo(12.151f),
                    "the actual runtime predictor must stop before the visible wing at z=12.5");
                Assert.That(movement.PredictedMotionSpeed, Is.Zero.Within(0.001f));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(hero);
            }
        }

        private sealed class FakeTransport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public void Connect() { }
            public bool Send(string message) => true;
            public void Close() => Closed?.Invoke("closed");
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
        }

        [Serializable] private sealed class FixtureSet { public Scenario[] cases; }
        [Serializable] private sealed class Scenario { public string name; public Point from, to, expected; }
        [Serializable] private sealed class Point { public float x, z; public Vector2 Vector => new Vector2(x, z); }
    }
}
