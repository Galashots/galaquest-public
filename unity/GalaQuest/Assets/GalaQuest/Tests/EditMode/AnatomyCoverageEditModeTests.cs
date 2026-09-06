using System;
using System.IO;
using System.Linq;
using GalaQuest.Gear;
using GalaQuest.Gear.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace GalaQuest.Tests
{
    public sealed class AnatomyCoverageEditModeTests
    {
        private static readonly Vector2[] Uv =
        {
            new Vector2(.1f, .1f), new Vector2(.2f, .1f), new Vector2(.1f, .2f),
            new Vector2(.3f, .1f), new Vector2(.4f, .1f), new Vector2(.3f, .2f)
        };
        private static readonly string[] Keys =
        {
            "10000,10000;10000,20000;20000,10000", "30000,10000;30000,20000;40000,10000"
        };

        [TestCase(false)]
        [TestCase(true)]
        public void ReorderedFacesAndReversedWindingTransferExactly(bool flipV)
        {
            var uv = Uv.Select(p => new Vector2(p.x, flipV ? 1 - p.y : p.y)).ToArray();
            Assert.That(AnatomyTriangleCorrespondence.TryResolve(uv, new[] { 5, 4, 3, 2, 1, 0 }, Keys,
                100000, out var map, out var error), Is.True, error);
            Assert.That(map, Is.EqualTo(new[] { 1, 0 }));
        }

        [TestCase("missing")]
        [TestCase("duplicate-source")]
        [TestCase("duplicate-target")]
        [TestCase("nan")]
        [TestCase("infinity")]
        public void UnsafeCorrespondenceRejects(string sabotage)
        {
            var uv = (Vector2[])Uv.Clone();
            var keys = (string[])Keys.Clone();
            var triangles = new[] { 0, 1, 2, 3, 4, 5 };
            if (sabotage == "missing") uv[0] = Vector2.zero;
            if (sabotage == "duplicate-source") keys[1] = keys[0];
            if (sabotage == "duplicate-target") triangles = new[] { 0, 1, 2, 0, 1, 2 };
            if (sabotage == "nan") uv[0].x = float.NaN;
            if (sabotage == "infinity") uv[0].y = float.PositiveInfinity;
            Assert.That(AnatomyTriangleCorrespondence.TryResolve(uv, triangles, keys, 100000,
                out var map, out var error), Is.False);
            Assert.That(map, Is.Null);
            Assert.That(error, Is.Not.Empty);
        }

        [Test]
        public void UnreadableMeshRejectsWithoutThrowingOrReplacingIt()
        {
            var root = new GameObject("Scratch unreadable coverage") { hideFlags = HideFlags.HideAndDontSave };
            var mesh = new Mesh();
            try
            {
                mesh.vertices = new[] { Vector3.zero, Vector3.right, Vector3.up };
                mesh.triangles = new[] { 0, 1, 2 };
                mesh.UploadMeshData(true);
                var body = root.AddComponent<SkinnedMeshRenderer>();
                body.sharedMesh = mesh;
                var coverage = root.AddComponent<AnatomyCoveragePreview>();
                coverage.Configure(body, null);
                Assert.DoesNotThrow(() => coverage.Apply(new[] { AnatomyRegion.Hair }));
                Assert.That(coverage.IsUsable, Is.False);
                Assert.That(coverage.ValidationError, Does.Contain("CPU-readable"));
                Assert.That(body.sharedMesh, Is.SameAs(mesh));
            }
            finally { Object.DestroyImmediate(root); Object.DestroyImmediate(mesh); }
        }

        [Test]
        public void ChangedMapAuthorityInvalidatesBeforeSameMaskReturnAndRecovers()
        {
            var mesh = CreateScratchMesh();
            var validMap = new TextAsset(MapJson("0", "1"));
            var invalidMap = new TextAsset("{\"schemaVersion\":1}");
            var correctedMap = new TextAsset(MapJson("1", "0"));
            var root = new GameObject("Scratch changed map coverage") { hideFlags = HideFlags.HideAndDontSave };
            try
            {
                var body = root.AddComponent<SkinnedMeshRenderer>();
                body.sharedMesh = mesh;
                var coverage = root.AddComponent<AnatomyCoveragePreview>();
                coverage.Configure(body, validMap);

                coverage.Apply(new[] { AnatomyRegion.Hair });
                Assert.That(coverage.IsUsable, Is.True, coverage.ValidationError);
                Assert.That(body.sharedMesh, Is.Not.SameAs(mesh));

                AssignSerializedReference(coverage, "regionMap", invalidMap);
                coverage.Apply(new[] { AnatomyRegion.Hair });
                Assert.That(coverage.IsUsable, Is.False);
                Assert.That(coverage.ValidationError, Does.Contain("version 2"));
                Assert.That(body.sharedMesh, Is.SameAs(mesh));

                AssignSerializedReference(coverage, "regionMap", correctedMap);
                coverage.Apply(new[] { AnatomyRegion.Hair });
                Assert.That(coverage.IsUsable, Is.True, coverage.ValidationError);
                Assert.That(body.sharedMesh, Is.Not.SameAs(mesh));
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(mesh);
                Object.DestroyImmediate(validMap);
                Object.DestroyImmediate(invalidMap);
                Object.DestroyImmediate(correctedMap);
            }
        }

        [Test]
        public void ChangedAssignedRendererRestoresPreviousAndReappliesCoverage()
        {
            var mesh = CreateScratchMesh();
            var map = new TextAsset(MapJson("0", "1"));
            var root = new GameObject("Scratch changed renderer coverage") { hideFlags = HideFlags.HideAndDontSave };
            var replacementRoot = new GameObject("Scratch replacement renderer") { hideFlags = HideFlags.HideAndDontSave };
            try
            {
                var body = root.AddComponent<SkinnedMeshRenderer>();
                body.sharedMesh = mesh;
                var replacement = replacementRoot.AddComponent<SkinnedMeshRenderer>();
                replacement.sharedMesh = mesh;
                var coverage = root.AddComponent<AnatomyCoveragePreview>();
                coverage.Configure(body, map);
                coverage.Apply(new[] { AnatomyRegion.Hair });
                Assert.That(body.sharedMesh, Is.Not.SameAs(mesh));

                AssignSerializedReference(coverage, "body", replacement);
                coverage.Apply(new[] { AnatomyRegion.Hair });
                Assert.That(body.sharedMesh, Is.SameAs(mesh));
                Assert.That(replacement.sharedMesh, Is.Not.SameAs(mesh));
                Assert.That(coverage.IsUsable, Is.True, coverage.ValidationError);
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(replacementRoot);
                Object.DestroyImmediate(mesh);
                Object.DestroyImmediate(map);
            }
        }

        [Test]
        public void ReimportedMapContentsInvalidateAndRecoverWithoutRestartingComponent()
        {
            var mesh = CreateScratchMesh();
            var mapPath = ScratchAssetPath("map", ".json");
            var root = new GameObject("Scratch reimported map coverage") { hideFlags = HideFlags.HideAndDontSave };
            try
            {
                var map = WriteScratchTextAsset(mapPath, MapJson("0", "1"));
                var body = root.AddComponent<SkinnedMeshRenderer>();
                body.sharedMesh = mesh;
                var coverage = root.AddComponent<AnatomyCoveragePreview>();
                coverage.Configure(body, map);
                coverage.Apply(new[] { AnatomyRegion.Hair });
                Assert.That(body.sharedMesh, Is.Not.SameAs(mesh));

                File.WriteAllText(Path.GetFullPath(mapPath), "{\"schemaVersion\":1}");
                AssetDatabase.ImportAsset(mapPath, ImportAssetOptions.ForceSynchronousImport);
                coverage.Apply(new[] { AnatomyRegion.Hair });
                Assert.That(coverage.IsUsable, Is.False);
                Assert.That(body.sharedMesh, Is.SameAs(mesh));

                File.WriteAllText(Path.GetFullPath(mapPath), MapJson("0", "1"));
                AssetDatabase.ImportAsset(mapPath, ImportAssetOptions.ForceSynchronousImport);
                coverage.Apply(new[] { AnatomyRegion.Hair });
                Assert.That(coverage.IsUsable, Is.True, coverage.ValidationError);
                Assert.That(body.sharedMesh, Is.Not.SameAs(mesh));
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(mesh);
                AssetDatabase.DeleteAsset(mapPath);
                AssetDatabase.Refresh();
            }
        }

        [Test]
        public void ScratchSceneSaveRestoresAssetMeshAndReappliesCoverageAfterReopen()
        {
            var previousScene = SceneManager.GetActiveScene();
            var scenePath = ScratchAssetPath("scene", ".unity");
            var meshPath = ScratchAssetPath("mesh", ".asset");
            var mapPath = ScratchAssetPath("map", ".json");
            var itemPath = ScratchAssetPath("item", ".asset");
            var scratchScene = default(Scene);
            var reopenedScene = default(Scene);
            // Unity Test Framework creates an untitled bootstrap with DefaultGameObjects and
            // restores the user's saved scene setup after the run. It cannot host an additive
            // scene until saved, so use single-scene scratch operations in that bootstrap.
            var runnerScene = SceneManager.sceneCount == 1 && string.IsNullOrEmpty(previousScene.path);
            try
            {
                var mesh = CreateScratchMesh();
                AssetDatabase.CreateAsset(mesh, meshPath);
                var original = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
                var map = WriteScratchTextAsset(mapPath, MapJson("0", "1"));
                var item = ScriptableObject.CreateInstance<GearItemDefinition>();
                item.Configure("scratch.helmet", "Scratch", null, "head", GearFitClass.Headgear, "",
                    new[] { AnatomyRegion.Hair });
                AssetDatabase.CreateAsset(item, itemPath);
                var savedItem = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(itemPath);
                Assert.That(savedItem, Is.Not.Null);

                scratchScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,
                    runnerScene ? NewSceneMode.Single : NewSceneMode.Additive);
                var root = new GameObject("Scratch saved coverage");
                SceneManager.MoveGameObjectToScene(root, scratchScene);
                var body = root.AddComponent<SkinnedMeshRenderer>();
                body.sharedMesh = original;
                var coverage = root.AddComponent<AnatomyCoveragePreview>();
                coverage.Configure(body, map);
                var mount = new GameObject("Scratch helmet");
                mount.transform.SetParent(root.transform);
                mount.AddComponent<GearMountedItem>().Configure(savedItem);
                coverage.ApplyMountedCoverage();
                Assert.That(coverage.PreviewCoverage, Is.True);
                Assert.That(body.sharedMesh, Is.Not.SameAs(original));
                EditorSceneManager.MarkSceneDirty(scratchScene);
                Assert.That(EditorSceneManager.SaveScene(scratchScene, scenePath), Is.True);
                Assert.That(coverage.PreviewCoverage, Is.True);
                Assert.That(body.sharedMesh, Is.Not.SameAs(original),
                    "Mounted coverage should resume after scene save while the preview preference remains enabled.");

                if (!runnerScene)
                    Assert.That(EditorSceneManager.CloseScene(scratchScene, true), Is.True);
                reopenedScene = EditorSceneManager.OpenScene(scenePath,
                    runnerScene ? OpenSceneMode.Single : OpenSceneMode.Additive);
                scratchScene = default(Scene);
                SceneManager.SetActiveScene(reopenedScene);
                var reopenedRoot = reopenedScene.GetRootGameObjects().Single();
                var reopenedBody = reopenedRoot.GetComponent<SkinnedMeshRenderer>();
                var reopenedCoverage = reopenedRoot.GetComponent<AnatomyCoveragePreview>();
                // Closing the only scene can unload/reload its asset objects. Compare the
                // reopened reference with current asset authority, not the old managed wrapper.
                var reopenedOriginal = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
                Assert.That(reopenedOriginal, Is.Not.Null);
                reopenedCoverage.enabled = false;
                Assert.That(reopenedCoverage.PreviewCoverage, Is.True);
                Assert.That(reopenedBody.sharedMesh, Is.SameAs(reopenedOriginal));
                Assert.That(AssetDatabase.GetAssetPath(reopenedBody.sharedMesh), Is.EqualTo(meshPath));
                Assert.That(reopenedBody.sharedMesh.hideFlags & HideFlags.HideAndDontSave,
                    Is.EqualTo(HideFlags.None));

                reopenedCoverage.enabled = true;
                reopenedCoverage.ApplyMountedCoverage();
                Assert.That(reopenedCoverage.IsUsable, Is.True, reopenedCoverage.ValidationError);
                Assert.That(reopenedBody.sharedMesh, Is.Not.SameAs(reopenedOriginal));
                Assert.That(reopenedBody.sharedMesh.hideFlags & HideFlags.HideAndDontSave,
                    Is.EqualTo(HideFlags.HideAndDontSave));
            }
            finally
            {
                if (runnerScene && (scratchScene.IsValid() || reopenedScene.IsValid()))
                    EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
                if (reopenedScene.IsValid() && reopenedScene.isLoaded)
                    EditorSceneManager.CloseScene(reopenedScene, true);
                if (scratchScene.IsValid() && scratchScene.isLoaded)
                    EditorSceneManager.CloseScene(scratchScene, true);
                if (previousScene.IsValid() && previousScene.isLoaded)
                    SceneManager.SetActiveScene(previousScene);
                AssetDatabase.DeleteAsset(scenePath);
                AssetDatabase.DeleteAsset(meshPath);
                AssetDatabase.DeleteAsset(mapPath);
                AssetDatabase.DeleteAsset(itemPath);
                AssetDatabase.Refresh();
            }
        }

        [Test]
        public void QualifiedHeroCoverageHidesOnlySupervisedFacesAndRestoresSource()
        {
            var importer = (ModelImporter)AssetImporter.GetAtPath(GearHeroAuthoring.HeroModelPath);
            Assert.That(importer.isReadable, Is.True, "The runtime coverage preview requires the Hero CPU mesh buffers.");
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            var sourceRenderer = prefab.GetComponentInChildren<SkinnedMeshRenderer>(true);
            var original = sourceRenderer.sharedMesh;
            var originalIndices = original.triangles;
            var originalVertices = original.vertices;
            var originalUv = original.uv;
            var map = AssetDatabase.LoadAssetAtPath<TextAsset>(
                "Assets/GalaQuest/Gear/Definitions/HeroAnatomyRegions.json");
            var root = new GameObject("Scratch anatomy coverage") { hideFlags = HideFlags.HideAndDontSave };
            var item = ScriptableObject.CreateInstance<GearItemDefinition>();
            try
            {
                var body = root.AddComponent<SkinnedMeshRenderer>();
                body.sharedMesh = original;
                var coverage = root.AddComponent<AnatomyCoveragePreview>();
                coverage.Configure(body, map);
                item.Configure("scratch.helmet", "Scratch", null, "head", GearFitClass.Headgear, "",
                    new[] { AnatomyRegion.Hair, AnatomyRegion.Ears });
                var mount = new GameObject("Scratch helmet");
                mount.transform.SetParent(root.transform);
                mount.AddComponent<GearMountedItem>().Configure(item);

                coverage.ApplyMountedCoverage();
                Assert.That(coverage.IsUsable, Is.True, coverage.ValidationError);
                Assert.That(body.sharedMesh, Is.Not.SameAs(original));
                Assert.That(body.sharedMesh.triangles.Length, Is.EqualTo((6800 - 2263 - 153) * 3));
                Assert.That(body.sharedMesh.subMeshCount, Is.EqualTo(1));
                Assert.That(body.sharedMesh.vertices, Is.EqualTo(originalVertices));
                Assert.That(body.sharedMesh.uv, Is.EqualTo(originalUv));

                // Disconfirm a count-only solution: removed faces must lie on the head, not the torso.
                var kept = body.sharedMesh.triangles.Chunk3Keys();
                var removed = Enumerable.Range(0, originalIndices.Length / 3)
                    .Where(f => !kept.Contains(string.Join(",", originalIndices.Skip(f * 3).Take(3))))
                    .SelectMany(f => originalIndices.Skip(f * 3).Take(3)).Distinct().ToArray();
                // Imported mesh-local axes need not be Hero/world axes (the FBX carries its rotation).
                var worldVertices = originalVertices.Select(sourceRenderer.transform.TransformPoint).ToArray();
                Assert.That(removed.Average(i => worldVertices[i].y), Is.GreaterThan(
                    Mathf.Lerp(worldVertices.Min(v => v.y), worldVertices.Max(v => v.y), .75f)));

                mount.SetActive(false);
                coverage.ApplyMountedCoverage();
                Assert.That(body.sharedMesh, Is.SameAs(original));
                mount.SetActive(true);
                coverage.ApplyMountedCoverage();
                coverage.PreviewCoverage = false;
                coverage.ApplyMountedCoverage();
                Assert.That(body.sharedMesh, Is.SameAs(original));
                coverage.PreviewCoverage = true;
                coverage.ApplyMountedCoverage();
                coverage.enabled = false;
                Assert.That(body.sharedMesh, Is.SameAs(original));
                Assert.That(original.triangles, Is.EqualTo(originalIndices));
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(item);
            }
        }

        private static Mesh CreateScratchMesh()
        {
            var mesh = new Mesh { name = "Scratch anatomy mesh" };
            mesh.vertices = new[]
            {
                Vector3.zero, Vector3.right, Vector3.up,
                Vector3.right * 2f, Vector3.right * 2f + Vector3.up, Vector3.right * 3f
            };
            mesh.uv = Uv;
            mesh.triangles = new[] { 0, 1, 2, 3, 4, 5 };
            mesh.RecalculateBounds();
            return mesh;
        }

        private static string MapJson(string hairFace, string earsFace)
        {
            return "{\"schemaVersion\":2,\"uvQuantization\":100000," +
                   "\"sourceTriangleUvKeys\":[\"" + Keys[0] + "\",\"" + Keys[1] + "\"]," +
                   "\"triangleCount\":2,\"regions\":{" +
                   "\"hair\":{\"faceCount\":1,\"faces\":[" + hairFace + "]}," +
                   "\"ears\":{\"faceCount\":1,\"faces\":[" + earsFace + "]}}}";
        }

        private static void AssignSerializedReference(Object target, string propertyName, Object value)
        {
            var serialized = new SerializedObject(target);
            serialized.FindProperty(propertyName).objectReferenceValue = value;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        private static string ScratchAssetPath(string stem, string extension) =>
            "Assets/GalaQuest/Tests/EditMode/__AnatomyCoverage_" + stem + "_" +
            Guid.NewGuid().ToString("N") + extension;

        private static TextAsset WriteScratchTextAsset(string path, string contents)
        {
            File.WriteAllText(Path.GetFullPath(path), contents);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(path);
            Assert.That(asset, Is.Not.Null, "Could not import scratch map asset " + path);
            return asset;
        }
    }

    internal static class AnatomyTestIndices
    {
        internal static System.Collections.Generic.HashSet<string> Chunk3Keys(this int[] indices) =>
            Enumerable.Range(0, indices.Length / 3)
                .Select(f => string.Join(",", indices.Skip(f * 3).Take(3))).ToHashSet();
    }
}
