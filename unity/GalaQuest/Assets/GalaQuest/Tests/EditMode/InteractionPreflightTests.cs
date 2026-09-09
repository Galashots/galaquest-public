using GalaQuest.Editor;
using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class InteractionPreflightTests
    {
        [Test]
        public void ReportsColliderOrderingFrameAndHudOverlap()
        {
            var cameraObject = new GameObject("Preflight camera");
            var target = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var foreground = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                var camera = cameraObject.AddComponent<Camera>();
                cameraObject.transform.position = new Vector3(1000, 0, -10);
                target.transform.position = new Vector3(1000, 0, 0);
                foreground.transform.position = new Vector3(1000, 0, -2);
                var collider = target.GetComponent<Collider>();
                var report = InteractionPreflight.Inspect(camera, collider, new Rect(0, 0, 1, 1));
                Assert.That(report.colliderActive && report.insideFrame && report.overlapsHud, Is.True);
                Assert.That(report.hitRank, Is.EqualTo(1));
                collider.enabled = false;
                report = InteractionPreflight.Inspect(camera, collider);
                Assert.That(report.colliderActive, Is.False);
                Assert.That(report.hitRank, Is.EqualTo(-1));
                collider.enabled = true;
                target.transform.position = new Vector3(1000, 0, -20);
                Assert.That(InteractionPreflight.Inspect(camera, collider).insideFrame, Is.False);
            }
            finally
            {
                Object.DestroyImmediate(foreground);
                Object.DestroyImmediate(target);
                Object.DestroyImmediate(cameraObject);
            }
        }
    }
}
