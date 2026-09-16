using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;
namespace GalaQuest.Tests
{
    public sealed class WormMotionPlayModeTests
    {
        [UnityTest]
        public IEnumerator DisablingAndReenablingDoesNotReplayFriendship()
        {
            var mesh = new Mesh();
            mesh.vertices = new[] { Vector3.zero, Vector3.right, Vector3.up };
            mesh.triangles = new[] { 0, 1, 2 };
            mesh.AddBlendShapeFrame(GalaQuestWormMotion.BreatheShape, 100,
                new[] { Vector3.zero, Vector3.zero, Vector3.up * .1f }, null, null);
            mesh.AddBlendShapeFrame(GalaQuestWormMotion.CelebrateShape, 100,
                new[] { Vector3.zero, Vector3.zero, Vector3.up * .2f }, null, null);
            var root = new GameObject("Worm lifecycle test");
            var body = root.AddComponent<SkinnedMeshRenderer>();
            body.sharedMesh = mesh;
            var motion = root.AddComponent<GalaQuestWormMotion>();
            motion.Configure(body, false);
            var celebration = mesh.GetBlendShapeIndex(GalaQuestWormMotion.CelebrateShape);
            try
            {
                yield return null;
                Assert.That(body.GetBlendShapeWeight(celebration), Is.Zero);
                motion.Celebrate();
                motion.Step(.1f);
                Assert.That(body.GetBlendShapeWeight(celebration), Is.GreaterThan(0));
                motion.enabled = false;
                yield return null;
                for (var i = 0; i < mesh.blendShapeCount; i++)
                    Assert.That(body.GetBlendShapeWeight(i), Is.Zero, "Real OnDisable must clear the pose.");
                root.transform.position += Vector3.right * 50;
                motion.enabled = true;
                yield return null;
                Assert.That(body.GetBlendShapeWeight(celebration), Is.Zero,
                    "A new presence must not replay an old friendship ceremony.");
                Assert.That(body.GetBlendShapeWeight(0), Is.GreaterThan(0), "Breathing must resume.");
            }
            finally { Object.Destroy(root); Object.Destroy(mesh); }
        }
    }
}
