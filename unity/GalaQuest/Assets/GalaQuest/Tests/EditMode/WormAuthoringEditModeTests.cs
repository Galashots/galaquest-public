using System;
using System.Linq;
using GalaQuest.Editor;
using NUnit.Framework;
using UnityEngine;
using UnityEditor;
using Object = UnityEngine.Object;
namespace GalaQuest.Tests
{
    public sealed class WormAuthoringEditModeTests
    {
        private static Mesh Source()
        {
            var m = new Mesh();
            m.vertices = new[] { new Vector3(-1,0,-2), new Vector3(1,0,-2),
                new Vector3(0,2,1), new Vector3(0,.4f,2) };
            m.triangles = new[] {0,2,1, 0,1,3, 1,2,3, 2,0,3};
            m.uv = new[] { Vector2.zero, Vector2.right, Vector2.up, Vector2.one };
            m.RecalculateNormals(); m.RecalculateBounds(); return m;
        }
        [Test] public void AuthoringPreservesSourceAndTopologyWithGroundedNeutralPose()
        {
            var source = Source(); Mesh result = null;
            var vertices = source.vertices; var triangles = source.triangles; var uv = source.uv;
            try
            {
                result = WormCompanionAuthoring.CreateMotionMesh(source, Matrix4x4.identity, .64f);
                CollectionAssert.AreEqual(vertices, source.vertices);
                CollectionAssert.AreEqual(triangles, result.triangles);
                CollectionAssert.AreEqual(uv, result.uv);
                Assert.That(result.bounds.min.y, Is.EqualTo(0).Within(1e-6));
                Assert.That(Mathf.Max(result.bounds.size.x, result.bounds.size.y, result.bounds.size.z), Is.EqualTo(.64f).Within(1e-6));
                Assert.That(result.blendShapeCount, Is.EqualTo(4));
                Assert.That(source.blendShapeCount, Is.Zero);
            }
            finally { Object.DestroyImmediate(source); if (result != null) Object.DestroyImmediate(result); }
        }
        [Test] public void CrawlMovesLowerBodyWithoutMovingHeadOrGroundContact()
        {
            var source = Source(); var result = WormCompanionAuthoring.CreateMotionMesh(source, Matrix4x4.identity, 1);
            try
            {
                var dv = new Vector3[result.vertexCount]; var dn = new Vector3[dv.Length];
                var index = result.GetBlendShapeIndex(GalaQuestWormMotion.CrawlCosShape);
                result.GetBlendShapeFrameVertices(index, result.GetBlendShapeFrameCount(index)-1, dv, dn, null);
                Assert.That(dv[2].magnitude, Is.LessThan(1e-6), "Top/head must remain readable.");
                Assert.That(dv[0].magnitude, Is.GreaterThan(.01), "A frozen body must fail.");
                foreach (var delta in dv) Assert.That(delta.y, Is.Zero);
                for(var i=0;i<dn.Length;i++) Assert.That((result.normals[i]+dn[i]).magnitude, Is.EqualTo(1).Within(.0001));
                Assert.That(result.GetBlendShapeFrameWeight(index,0), Is.EqualTo(-100));
                Assert.That(result.GetBlendShapeFrameWeight(index,result.GetBlendShapeFrameCount(index)-1), Is.EqualTo(100));
            }
            finally { Object.DestroyImmediate(source); Object.DestroyImmediate(result); }
        }
        [Test] public void InvalidAuthoringInputFailsInsteadOfCreatingAnAsset()
        {
            Assert.Throws<ArgumentException>(() => WormCompanionAuthoring.CreateMotionMesh(null, Matrix4x4.identity, 1));
            var source=Source();
            try { Assert.Throws<ArgumentException>(() => WormCompanionAuthoring.CreateMotionMesh(source, Matrix4x4.identity, float.NaN)); }
            finally { Object.DestroyImmediate(source); }
        }
        [Test] public void NativePrefabRoundtripRetainsMotionBinding()
        {
            var folder="Assets/U2CombatPreviewTemporary/WormBindingTest-"+Guid.NewGuid().ToString("N");
            System.IO.Directory.CreateDirectory(folder); AssetDatabase.Refresh();
            var source=Source(); var mesh=WormCompanionAuthoring.CreateMotionMesh(source,Matrix4x4.identity,1);
            var root=new GameObject("authored"); GameObject clone=null;
            try
            {
                AssetDatabase.CreateAsset(mesh,folder+"/mesh.asset");
                var renderer=root.AddComponent<SkinnedMeshRenderer>(); renderer.sharedMesh=mesh;
                root.AddComponent<GalaQuestWormMotion>().Configure(renderer,true);
                PrefabUtility.SaveAsPrefabAsset(root,folder+"/worm.prefab");
                clone=Object.Instantiate(AssetDatabase.LoadAssetAtPath<GameObject>(folder+"/worm.prefab"));
                var body=clone.GetComponent<SkinnedMeshRenderer>();
                for(var i=0;i<mesh.blendShapeCount;i++)body.SetBlendShapeWeight(i,0);
                clone.GetComponent<GalaQuestWormMotion>().Step(.05f);
                Assert.That(body.GetBlendShapeWeight(mesh.GetBlendShapeIndex(GalaQuestWormMotion.BreatheShape)),Is.GreaterThan(0),"Prefab must work without a runtime Configure call.");
            }
            finally { if(clone!=null)Object.DestroyImmediate(clone);Object.DestroyImmediate(root);Object.DestroyImmediate(source);AssetDatabase.DeleteAsset(folder); }
        }
        [Test] public void CatalogNeedsExplicitReferencesAndDoesNotMapUnknownIds()
        {
            var host=new GameObject("catalog"); var green=new GameObject("green"); var red=new GameObject("red");
            GameObject instance=null;
            try
            {
                var catalog=host.AddComponent<GalaQuestPetAppearanceCatalog>();
                Assert.That(catalog.Create("unassigned","worm_green",Vector3.zero,Quaternion.identity),Is.Null);
                catalog.Configure(green,red);
                Assert.That(catalog.Create("unknown","another_pet",Vector3.zero,Quaternion.identity),Is.Null);
                instance=catalog.Create("follower","worm_red",new Vector3(4,.18f,5),Quaternion.identity);
                Assert.That(instance,Is.Not.Null); Assert.That(instance.name,Is.EqualTo("follower"));
                Assert.That(instance.transform.position,Is.EqualTo(new Vector3(4,0,5)));
                Assert.That(green.transform.position,Is.EqualTo(Vector3.zero));
            }
            finally
            { Object.DestroyImmediate(host); Object.DestroyImmediate(green); Object.DestroyImmediate(red); if(instance!=null)Object.DestroyImmediate(instance); }
        }

        [Test] public void BakedCrawlIncludesNegativeNeutralAndPositiveFrames()
        {
            var source=Source(); var mesh=WormCompanionAuthoring.CreateMotionMesh(source,Matrix4x4.identity,1);
            var root=new GameObject("morph polarity"); var baked=new Mesh();
            try {
                var body=root.AddComponent<SkinnedMeshRenderer>(); body.sharedMesh=mesh;
                var index=mesh.GetBlendShapeIndex(GalaQuestWormMotion.CrawlCosShape);
                var delta=new Vector3[mesh.vertexCount]; var original=mesh.vertices;
                for(var frame=0;frame<mesh.GetBlendShapeFrameCount(index);frame++) {
                    var weight=mesh.GetBlendShapeFrameWeight(index,frame);
                    mesh.GetBlendShapeFrameVertices(index,frame,delta,null,null);
                    body.SetBlendShapeWeight(index,weight); body.BakeMesh(baked);
                    var actual=baked.vertices;
                    for(var i=0;i<actual.Length;i++) Assert.That(Vector3.Distance(actual[i],original[i]+delta[i]),Is.LessThan(.0001f),"Native interpolation at "+weight);
                }
            } finally { Object.DestroyImmediate(root);Object.DestroyImmediate(baked);Object.DestroyImmediate(mesh);Object.DestroyImmediate(source); }
        }
    }
}
