using NUnit.Framework;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GalaQuest.Tests
{
    // EditMode coverage for GalaQuestWormMotion using tiny synthetic meshes.
    // Every assertion drives the same public Step path the game uses and reads
    // back actual SkinnedMeshRenderer weights; no artistic constants are baked
    // in, so red/green are compared relationally, never by exact value.
    public sealed class WormMotionEditModeTests
    {
        const float Dt = 1f / 60f;

        sealed class Rig
        {
            public GameObject Root;
            public GameObject Child;
            public SkinnedMeshRenderer Body;
            public GalaQuestWormMotion Motion;
            public Mesh Mesh;
            public Vector3[] BaseVertices;
        }

        static Mesh CreateWormMesh(bool full)
        {
            var mesh = new Mesh();
            mesh.vertices = new[] { Vector3.zero, Vector3.right, Vector3.up };
            mesh.triangles = new[] { 0, 1, 2 };
            mesh.normals = new[] { Vector3.back, Vector3.back, Vector3.back };
            AddFrame(mesh, GalaQuestWormMotion.BreatheShape, 100f, new Vector3(0f, .1f, 0f));
            if (full)
            {
                AddFrame(mesh, GalaQuestWormMotion.CrawlSinShape, -100f, new Vector3(.1f, 0f, 0f));
                AddFrame(mesh, GalaQuestWormMotion.CrawlSinShape, 100f, new Vector3(-.1f, 0f, 0f));
                AddFrame(mesh, GalaQuestWormMotion.CrawlCosShape, -100f, new Vector3(0f, 0f, .1f));
                AddFrame(mesh, GalaQuestWormMotion.CrawlCosShape, 100f, new Vector3(0f, 0f, -.1f));
                AddFrame(mesh, GalaQuestWormMotion.CelebrateShape, 100f, new Vector3(0f, .2f, 0f));
            }
            return mesh;
        }

        static void AddFrame(Mesh mesh, string shape, float weight, Vector3 delta)
        {
            var count = mesh.vertexCount;
            var verts = new Vector3[count];
            var normals = new Vector3[count];
            var tangents = new Vector3[count];
            for (var i = 0; i < count; i++)
                verts[i] = delta;
            mesh.AddBlendShapeFrame(shape, weight, verts, normals, tangents);
        }

        static Rig Build(bool fullMesh, bool red)
        {
            var root = new GameObject("Scratch worm") { hideFlags = HideFlags.HideAndDontSave };
            var child = new GameObject("Scratch worm child") { hideFlags = HideFlags.HideAndDontSave };
            child.transform.SetParent(root.transform, false);
            var mesh = CreateWormMesh(fullMesh);
            var body = root.AddComponent<SkinnedMeshRenderer>();
            body.sharedMesh = mesh;
            var motion = root.AddComponent<GalaQuestWormMotion>();
            motion.Configure(body, red);
            return new Rig
            {
                Root = root,
                Child = child,
                Body = body,
                Motion = motion,
                Mesh = mesh,
                BaseVertices = mesh.vertices,
            };
        }

        static void TearDown(Rig rig)
        {
            if (rig == null)
                return;
            Object.DestroyImmediate(rig.Root);
            Object.DestroyImmediate(rig.Mesh);
        }

        static float Weight(Rig rig, string shape)
        {
            var index = rig.Mesh.GetBlendShapeIndex(shape);
            Assert.That(index, Is.GreaterThanOrEqualTo(0), "synthetic mesh missing " + shape);
            return rig.Body.GetBlendShapeWeight(index);
        }

        static float CrawlEnergy(Rig rig)
        {
            return Mathf.Abs(Weight(rig, GalaQuestWormMotion.CrawlSinShape)) +
                Mathf.Abs(Weight(rig, GalaQuestWormMotion.CrawlCosShape));
        }

        static void StepMoving(Rig rig, float perStep)
        {
            rig.Root.transform.position += new Vector3(perStep, 0f, 0f);
            rig.Motion.Step(Dt);
        }

        static void StepIdle(Rig rig)
        {
            rig.Motion.Step(Dt);
        }

        static bool Finite(float v)
        {
            return !float.IsNaN(v) && !float.IsInfinity(v);
        }

        [Test]
        public void MotionDiffersFromIdleAcrossMeaningfulTime([Values(false, true)] bool red)
        {
            var rig = Build(true, red);
            try
            {
                for (var i = 0; i < 30; i++)
                    StepIdle(rig);
                var idleEnergy = 0f;
                for (var i = 0; i < 60; i++)
                {
                    StepIdle(rig);
                    idleEnergy += CrawlEnergy(rig);
                }
                idleEnergy /= 60f;

                for (var i = 0; i < 120; i++)
                    StepMoving(rig, .03f); // ~1.8 m/s planar
                var moveEnergy = 0f;
                for (var i = 0; i < 60; i++)
                {
                    StepMoving(rig, .03f);
                    moveEnergy += CrawlEnergy(rig);
                }
                moveEnergy /= 60f;

                Assert.That(idleEnergy, Is.LessThan(5f), "idle crawl did not relax, red=" + red);
                Assert.That(moveEnergy, Is.GreaterThan(idleEnergy + 20f),
                    "moving crawl not stronger than idle, red=" + red);
                Assert.That(Weight(rig, GalaQuestWormMotion.BreatheShape), Is.InRange(0f, 100f));
            }
            finally { TearDown(rig); }
        }

        [Test]
        public void SettlesWhenStationary([Values(false, true)] bool red)
        {
            var rig = Build(true, red);
            try
            {
                for (var i = 0; i < 120; i++)
                    StepMoving(rig, .03f);
                for (var i = 0; i < 600; i++)
                    StepIdle(rig);
                Assert.That(CrawlEnergy(rig), Is.LessThan(2f), "crawl did not settle, red=" + red);
                Assert.That(Weight(rig, GalaQuestWormMotion.BreatheShape), Is.InRange(0f, 100f));
                Assert.That(Weight(rig, GalaQuestWormMotion.CelebrateShape), Is.EqualTo(0f).Within(1e-3f));
            }
            finally { TearDown(rig); }
        }

        [Test]
        public void BreathingStaysSoftAndAliveAtRest()
        {
            var rig = Build(true, false);
            try
            {
                var min = float.MaxValue;
                var max = float.MinValue;
                for (var i = 0; i < 240; i++) // ~4s of rest
                {
                    StepIdle(rig);
                    var w = Weight(rig, GalaQuestWormMotion.BreatheShape);
                    Assert.That(w, Is.InRange(0f, 100f));
                    if (w < min) min = w;
                    if (w > max) max = w;
                }
                Assert.That(max - min, Is.GreaterThan(1f), "rest breathing looks frozen");
                Assert.That(max - min, Is.LessThan(60f), "rest breathing too hot");
            }
            finally { TearDown(rig); }
        }

        [Test]
        public void CelebrationFiresOnlyOnExplicitCallAndReturnsToZero()
        {
            var rig = Build(true, false);
            try
            {
                for (var i = 0; i < 180; i++)
                    StepIdle(rig);
                Assert.That(Weight(rig, GalaQuestWormMotion.CelebrateShape),
                    Is.EqualTo(0f).Within(1e-3f), "celebration fired without Celebrate()");

                // Spawn-like churn must not celebrate either.
                rig.Motion.Configure(rig.Body, false);
                for (var i = 0; i < 60; i++)
                    StepIdle(rig);
                Assert.That(Weight(rig, GalaQuestWormMotion.CelebrateShape),
                    Is.EqualTo(0f).Within(1e-3f), "reconfigure celebrated on its own");

                rig.Motion.Celebrate();
                var peak = 0f;
                for (var i = 0; i < 30; i++)
                {
                    StepIdle(rig);
                    var w = Weight(rig, GalaQuestWormMotion.CelebrateShape);
                    if (w > peak) peak = w;
                }
                Assert.That(peak, Is.GreaterThan(10f), "celebration pulse never rose");
                for (var i = 0; i < 300; i++)
                    StepIdle(rig);
                Assert.That(Weight(rig, GalaQuestWormMotion.CelebrateShape),
                    Is.EqualTo(0f).Within(1e-3f), "celebration did not return to zero");
            }
            finally { TearDown(rig); }
        }

        // Enable/disable is exercised with real callbacks in WormMotionPlayModeTests.

        [Test]
        public void MissingShapesAndNullRendererAreHarmless()
        {
            var rig = Build(false, false); // breathe only
            try
            {
                Assert.DoesNotThrow(() =>
                {
                    for (var i = 0; i < 60; i++)
                        StepMoving(rig, .03f);
                    rig.Motion.Celebrate();
                    for (var i = 0; i < 120; i++)
                        StepIdle(rig);
                });
                Assert.That(Weight(rig, GalaQuestWormMotion.BreatheShape), Is.InRange(0f, 100f));
                Assert.That(rig.Mesh.GetBlendShapeIndex(GalaQuestWormMotion.CrawlSinShape), Is.LessThan(0));
            }
            finally { TearDown(rig); }

            var bare = new GameObject("Scratch bare worm") { hideFlags = HideFlags.HideAndDontSave };
            try
            {
                var motion = bare.AddComponent<GalaQuestWormMotion>();
                Assert.DoesNotThrow(() =>
                {
                    motion.Configure(null, true);
                    motion.Step(Dt);
                    motion.Celebrate();
                    motion.Step(Dt);
                    motion.Step(0f);
                });
            }
            finally { Object.DestroyImmediate(bare); }
        }

        [Test]
        public void BadInputsAndTeleportStayFiniteAndRecover()
        {
            var rig = Build(true, true);
            try
            {
                for (var i = 0; i < 60; i++)
                    StepMoving(rig, .03f);
                Assert.DoesNotThrow(() =>
                {
                    rig.Motion.Step(float.NaN);
                    rig.Motion.Step(float.PositiveInfinity);
                    rig.Motion.Step(-1f);
                    rig.Root.transform.position += new Vector3(30f, 0f, 0f);
                    rig.Motion.Step(Dt);
                });
                foreach (var shape in new[]
                    {
                        GalaQuestWormMotion.BreatheShape, GalaQuestWormMotion.CrawlSinShape,
                        GalaQuestWormMotion.CrawlCosShape, GalaQuestWormMotion.CelebrateShape
                    })
                    Assert.That(Finite(Weight(rig, shape)), Is.True, shape + " non-finite");
                Assert.That(CrawlEnergy(rig), Is.LessThan(5f), "teleport latched crawl on");
                for (var i = 0; i < 120; i++)
                    StepMoving(rig, .03f);
                Assert.That(CrawlEnergy(rig), Is.GreaterThan(20f), "finite future frames stopped responding");
                Assert.That(Weight(rig, GalaQuestWormMotion.CelebrateShape), Is.EqualTo(0f).Within(1e-3f));
            }
            finally { TearDown(rig); }
        }

        [Test]
        public void PauseDoesNotAdvanceAnimation()
        {
            var rig = Build(true, false);
            try
            {
                for (var i = 0; i < 60; i++)
                    StepMoving(rig, .03f);
                var sin0 = Weight(rig, GalaQuestWormMotion.CrawlSinShape);
                var cos0 = Weight(rig, GalaQuestWormMotion.CrawlCosShape);
                var breathe0 = Weight(rig, GalaQuestWormMotion.BreatheShape);
                for (var i = 0; i < 30; i++)
                    rig.Motion.Step(0f);
                Assert.That(Weight(rig, GalaQuestWormMotion.CrawlSinShape), Is.EqualTo(sin0));
                Assert.That(Weight(rig, GalaQuestWormMotion.CrawlCosShape), Is.EqualTo(cos0));
                Assert.That(Weight(rig, GalaQuestWormMotion.BreatheShape), Is.EqualTo(breathe0));
            }
            finally { TearDown(rig); }
        }

        [Test]
        public void RootChildAndVerticesAreNeverTouched()
        {
            var rig = Build(true, false);
            try
            {
                var rootPos = rig.Root.transform.position;
                var rootRot = rig.Root.transform.rotation;
                var rootScale = rig.Root.transform.localScale;
                var childPos = rig.Child.transform.localPosition;
                var childRot = rig.Child.transform.localRotation;
                var childScale = rig.Child.transform.localScale;
                for (var i = 0; i < 60; i++)
                {
                    rig.Root.transform.position += new Vector3(.03f, 0f, .01f);
                    rig.Motion.Step(Dt);
                }
                rig.Motion.Celebrate();
                for (var i = 0; i < 120; i++)
                {
                    rig.Root.transform.position += new Vector3(.03f, 0f, .01f);
                    rig.Motion.Step(Dt);
                }
                var moved = rig.Root.transform.position - rootPos;
                Assert.That(moved.magnitude, Is.GreaterThan(1f), "test moved nothing");
                Assert.That(rig.Root.transform.rotation, Is.EqualTo(rootRot));
                Assert.That(rig.Root.transform.localScale, Is.EqualTo(rootScale));
                Assert.That(rig.Child.transform.localPosition, Is.EqualTo(childPos));
                Assert.That(rig.Child.transform.localRotation, Is.EqualTo(childRot));
                Assert.That(rig.Child.transform.localScale, Is.EqualTo(childScale));
                Assert.That(rig.Mesh.vertices, Is.EqualTo(rig.BaseVertices));
            }
            finally { TearDown(rig); }
        }

        [Test]
        public void RedAndGreenStayInFamilyButDifferInPhase()
        {
            var green = Build(true, false);
            var red = Build(true, true);
            try
            {
                var differed = false;
                float greenMove = 0f, redMove = 0f;
                for (var i = 0; i < 180; i++)
                {
                    green.Root.transform.position += new Vector3(.03f, 0f, 0f);
                    red.Root.transform.position += new Vector3(.03f, 0f, 0f);
                    green.Motion.Step(Dt);
                    red.Motion.Step(Dt);
                    greenMove += CrawlEnergy(green);
                    redMove += CrawlEnergy(red);
                    if (Mathf.Abs(Weight(green, GalaQuestWormMotion.CrawlSinShape) -
                        Weight(red, GalaQuestWormMotion.CrawlSinShape)) > 1e-3f)
                        differed = true;
                    foreach (var rig in new[] { green, red })
                        foreach (var shape in new[]
                            {
                                GalaQuestWormMotion.BreatheShape, GalaQuestWormMotion.CrawlSinShape,
                                GalaQuestWormMotion.CrawlCosShape, GalaQuestWormMotion.CelebrateShape
                            })
                        {
                            var w = Weight(rig, shape);
                            Assert.That(Finite(w), Is.True);
                            Assert.That(Mathf.Abs(w), Is.LessThanOrEqualTo(100f + 1e-3f));
                        }
                }
                Assert.That(greenMove, Is.GreaterThan(20f * 180f / 60f));
                Assert.That(redMove, Is.GreaterThan(20f * 180f / 60f));
                Assert.That(differed, Is.True, "red/green phase identical across whole run");
            }
            finally
            {
                TearDown(green);
                TearDown(red);
            }
        }

        [Test] public void TeleportAloneClearsExistingCrawl()
        {
            var rig=Build(true,false);
            try {
                for(var i=0;i<120;i++) StepMoving(rig,.03f);
                Assert.That(CrawlEnergy(rig),Is.GreaterThan(20));
                rig.Root.transform.position+=Vector3.right*30; rig.Motion.Step(Dt);
                Assert.That(CrawlEnergy(rig),Is.LessThan(5),"Do not let invalid-input setup hide a teleport bug.");
            } finally { TearDown(rig); }
        }
        [Test] public void SlowFramesDoNotStretchFriendshipCeremony()
        {
            var rig=Build(true,false);
            try { rig.Motion.Celebrate(); for(var i=0;i<10;i++)rig.Motion.Step(.2f);
                Assert.That(Weight(rig,GalaQuestWormMotion.CelebrateShape),Is.Zero,
                    "A two-second observation at five frames/sec must finish a short ceremony.");
            } finally { TearDown(rig); }
        }
    }
}
