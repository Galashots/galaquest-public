using System;
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class U1ConnectedEmberworksCp2PlayModeTests
    {
        [UnityTest]
        public IEnumerator ConnectedPredictionReconcilesAndFollowCameraKeepsHeroFramed()
        {
            var root = new GameObject("CP2 test root");
            var hero = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            var cameraObject = new GameObject("CP2 test camera");
            var camera = cameraObject.AddComponent<Camera>();
            var follow = cameraObject.AddComponent<GalaQuestGameplayCamera>();
            var controller = root.AddComponent<GalaQuestTraversalController>();
            var transport = new FakeTransport();
            var session = new GalaQuestConnectionSession(transport);
            try
            {
                hero.transform.position = new Vector3(0f, 0.25f, 4f);
                controller.Configure(null, hero.transform);
                controller.BindSession(session);
                follow.Configure(hero.transform);
                session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Aster", "[]"));
                transport.Open();
                transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"players\":[{\"id\":\"p1\",\"x\":0,\"z\":4}]}");

                controller.StepPrediction(Vector2.up, 1f, false, 0.1f);
                controller.StepPrediction(Vector2.up, 1f, false, 0.1f);
                Assert.That(controller.PredictedPosition.y, Is.GreaterThan(4f), "local presentation moves before another snapshot");

                transport.Receive("{\"v\":4,\"type\":\"snapshot\",\"tick\":2,\"players\":[{\"id\":\"p1\",\"x\":2,\"z\":4.1}]}");
                var reconciliation = controller.ApplyPendingReconciliation();
                Assert.That(reconciliation.Snapped, Is.True, "forced drift above the established threshold must snap");
                Assert.That(controller.PredictedPosition, Is.EqualTo(new Vector2(2f, 4.1f)));

                follow.FollowNow();
                yield return null;
                var planes = GeometryUtility.CalculateFrustumPlanes(camera);
                Assert.That(GeometryUtility.TestPlanesAABB(planes, hero.GetComponent<Renderer>().bounds), Is.True);
            }
            finally
            {
                session.Dispose();
                UnityEngine.Object.Destroy(root);
                UnityEngine.Object.Destroy(hero);
                UnityEngine.Object.Destroy(cameraObject);
            }
        }

        private sealed class FakeTransport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public readonly List<string> Sent = new List<string>();
            public void Connect() { }
            public bool Send(string message) { Sent.Add(message); return true; }
            public void Close() => Closed?.Invoke("closed");
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
        }
    }
}
