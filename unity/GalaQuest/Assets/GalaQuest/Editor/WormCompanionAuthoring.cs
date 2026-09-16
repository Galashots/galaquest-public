using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GalaQuest.Editor
{
    // Opt-in private qualification only. Nothing here changes a shipping scene or
    // downloads art. Explicit promotion and source-specific rights remain separate.
    public static class WormCompanionAuthoring
    {
        public const string OutputRoot = "Assets/U2CombatPreviewTemporary/WormCompanions";
        public const float ReviewSize = .64f;
        private static readonly string[] Variants = { "green", "red" };
        private static readonly string[] FbxHashes = {
            "aef5592b2ce1a6758d9aa11e327d74c2ce0f5e7d730801c6979e944198c9c54a",
            "0198b4eb647980732a4da0fe8735e3d7af4d7d5fb8ff3ec1f80643b4ef1253eb" };
        public static string Author(string sourceRoot)
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Stop Play Mode first.");
            for (var variant = 0; variant < Variants.Length; variant++)
            {
                var color = Variants[variant];
                var source = Path.Combine(sourceRoot, color + "-merged-v2");
                if (Hash(Path.Combine(source, "candidate.fbx")) != FbxHashes[variant])
                    throw new InvalidOperationException("Unexpected qualifying FBX: " + color);
                var folder = OutputRoot + "/" + color;
                var receipt = folder + "/authoring-fingerprint.txt";
                if (File.Exists(receipt) && File.ReadAllText(receipt) == Fingerprint(source, folder)) continue;
                Directory.CreateDirectory(folder);
                foreach (var name in new[] { "candidate.fbx", "base_color.png", "normal.png", "metallic_roughness.png" })
                {
                    var from = Path.Combine(source, name); var to = folder + "/" + name;
                    if (!File.Exists(to) || Hash(from) != Hash(to)) File.Copy(from, to, true);
                }
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                var importer = (ModelImporter)AssetImporter.GetAtPath(folder + "/candidate.fbx");
                importer.isReadable = true; importer.importAnimation = false;
                importer.importNormals = ModelImporterNormals.Import;
                importer.importTangents = ModelImporterTangents.CalculateMikk;
                importer.SaveAndReimport();
                ImportTexture(folder + "/base_color.png", false, true);
                ImportTexture(folder + "/normal.png", true, false);
                var material = CreateMaterial(folder, color);
                var imported = Object.Instantiate(AssetDatabase.LoadAssetAtPath<GameObject>(folder + "/candidate.fbx"));
                GameObject prefabRoot = null;
                try
                {
                    var filters = imported.GetComponentsInChildren<MeshFilter>();
                    if (filters.Length != 1) throw new InvalidOperationException("Expected a single worm mesh.");
                    var mesh = CreateMotionMesh(filters[0].sharedMesh, filters[0].transform.localToWorldMatrix, ReviewSize);
                    mesh.name = "Worm " + color + " motion";
                    var meshPath = folder + "/WormMotion.asset";
                    var stored = AssetDatabase.LoadAssetAtPath<Mesh>(meshPath);
                    if (stored == null) { AssetDatabase.CreateAsset(mesh, meshPath); stored = mesh; }
                    else { EditorUtility.CopySerialized(mesh, stored); Object.DestroyImmediate(mesh); }
                    prefabRoot = new GameObject("Worm " + color);
                    var renderer = prefabRoot.AddComponent<SkinnedMeshRenderer>();
                    renderer.sharedMesh = stored; renderer.sharedMaterial = material;
                    var bounds = stored.bounds; bounds.Expand(ReviewSize * .3f);
                    renderer.localBounds = bounds;
                    prefabRoot.AddComponent<GalaQuestWormMotion>().Configure(renderer, color == "red");
                    PrefabUtility.SaveAsPrefabAsset(prefabRoot, folder + "/Worm.prefab");
                    AssetDatabase.SaveAssets();
                    File.WriteAllText(receipt, Fingerprint(source, folder));
                }
                finally
                {
                    Object.DestroyImmediate(imported);
                    if (prefabRoot != null) Object.DestroyImmediate(prefabRoot);
                }
            }
            AssetDatabase.SaveAssets();
            return OutputRoot + " (private qualifying prefabs; no scene or promotion changed)";
        }

        public static Mesh CreateMotionMesh(Mesh source, Matrix4x4 transform, float size)
        {
            if (source == null || source.subMeshCount != 1 || source.vertexCount == 0
                || !(size > 0) || float.IsInfinity(size)) throw new ArgumentException("Invalid worm mesh or size.");
            var mesh = Object.Instantiate(source);
            var positions = source.vertices;
            var normals = source.normals; var tangents = source.tangents;
            if (normals.Length != positions.Length) { Object.DestroyImmediate(mesh); throw new ArgumentException("Source normals required."); }
            var normalTransform = transform.inverse.transpose;
            for (var i = 0; i < positions.Length; i++) positions[i] = transform.MultiplyPoint3x4(positions[i]);
            var bounds = new Bounds(positions[0], Vector3.zero);
            foreach (var position in positions) bounds.Encapsulate(position);
            var extent = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z);
            if (!(extent > 0) || float.IsInfinity(extent)) { Object.DestroyImmediate(mesh); throw new ArgumentException("Invalid bounds."); }
            var scale = size / extent;
            var origin = new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
            for (var i = 0; i < positions.Length; i++)
            {
                positions[i] = (positions[i] - origin) * scale;
                normals[i] = normalTransform.MultiplyVector(normals[i]).normalized;
                if (tangents.Length == positions.Length)
                {
                    var t = transform.MultiplyVector(tangents[i]).normalized;
                    tangents[i] = new Vector4(t.x, t.y, t.z, tangents[i].w * Mathf.Sign(transform.determinant));
                }
            }
            mesh.ClearBlendShapes(); mesh.vertices = positions; mesh.normals = normals;
            if (tangents.Length == positions.Length) mesh.tangents = tangents;
            if (transform.determinant < 0)
            {
                var triangles = mesh.triangles;
                for (var i = 0; i < triangles.Length; i += 3)
                { var swap = triangles[i]; triangles[i] = triangles[i + 1]; triangles[i + 1] = swap; }
                mesh.triangles = triangles;
            }
            mesh.RecalculateBounds();
            AddShape(mesh, GalaQuestWormMotion.BreatheShape, 0, 1);
            AddShape(mesh, GalaQuestWormMotion.CrawlSinShape, 1, -1);
            AddShape(mesh, GalaQuestWormMotion.CrawlSinShape, 1, 0);
            AddShape(mesh, GalaQuestWormMotion.CrawlSinShape, 1, 1);
            AddShape(mesh, GalaQuestWormMotion.CrawlCosShape, 2, -1);
            AddShape(mesh, GalaQuestWormMotion.CrawlCosShape, 2, 0);
            AddShape(mesh, GalaQuestWormMotion.CrawlCosShape, 2, 1);
            AddShape(mesh, GalaQuestWormMotion.CelebrateShape, 3, 1);
            return mesh;
        }

        private static void AddShape(Mesh mesh, string name, int kind, float sign)
        {
            var vertices = mesh.vertices; var normals = mesh.normals; var tangents = mesh.tangents;
            var dv = new Vector3[vertices.Length]; var dn = new Vector3[vertices.Length];
            var dt = tangents.Length == vertices.Length ? new Vector3[vertices.Length] : null;
            var h = mesh.bounds.size.y; var length = Mathf.Max(mesh.bounds.size.z, .001f);
            for (var i = 0; i < vertices.Length; i++)
            {
                var v = vertices[i]; var jacobian = Matrix4x4.identity;
                if (kind == 0 || kind == 3)
                {
                    var s = kind == 0 ? new Vector3(1.008f, 1.035f, 1.008f) : new Vector3(.94f, 1.12f, .94f);
                    dv[i] = Vector3.Scale(v, s) - v; jacobian = Matrix4x4.Scale(s);
                }
                else
                {
                    var u = Mathf.Clamp01((v.y / Mathf.Max(h, .001f) - .27f) / .51f);
                    var mask = 1 - u * u * (3 - 2 * u);
                    var derivativeY = -6 * u * (1 - u) / Mathf.Max(.51f * h, .001f);
                    var k = 2 * Mathf.PI / length; var angle = k * v.z;
                    var wave = kind == 1 ? Mathf.Sin(angle) : Mathf.Cos(angle);
                    var gradient = kind == 1 ? Mathf.Cos(angle) : -Mathf.Sin(angle);
                    var amplitude = length * .09f * sign;
                    dv[i] = new Vector3(amplitude * mask * wave, 0, 0);
                    jacobian.m01 = amplitude * derivativeY * wave;
                    jacobian.m02 = amplitude * mask * k * gradient;
                }
                dn[i] = jacobian.inverse.transpose.MultiplyVector(normals[i]).normalized - normals[i];
                if (dt != null) dt[i] = jacobian.MultiplyVector(tangents[i]).normalized - (Vector3)tangents[i];
            }
            mesh.AddBlendShapeFrame(name, 100 * sign, dv, dn, dt);
        }

        private static Material CreateMaterial(string folder, string color)
        {
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
            try
            {
                texture.LoadImage(File.ReadAllBytes(folder + "/metallic_roughness.png"));
                var pixels = texture.GetPixels32();
                for (var i = 0; i < pixels.Length; i++)
                    pixels[i] = new Color32(pixels[i].b, 0, 0, (byte)(255 - pixels[i].g));
                texture.SetPixels32(pixels); texture.Apply();
                var path = folder + "/metallic_smoothness.png";
                var png = texture.EncodeToPNG();
                if (!File.Exists(path) || !File.ReadAllBytes(path).SequenceEqual(png)) File.WriteAllBytes(path, png);
                AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
                ImportTexture(path, false, false);
            }
            finally { Object.DestroyImmediate(texture); }
            var materialPath = folder + "/Worm.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            if (material == null)
            {
                var shader = Shader.Find("Universal Render Pipeline/Lit");
                if (shader == null) throw new InvalidOperationException("Pinned URP Lit is required.");
                material = new Material(shader) { name = "Worm " + color };
                AssetDatabase.CreateAsset(material, materialPath);
            }
            material.SetColor("_BaseColor", Color.white);
            material.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(folder + "/base_color.png"));
            material.SetTexture("_BumpMap", AssetDatabase.LoadAssetAtPath<Texture2D>(folder + "/normal.png"));
            material.SetTexture("_MetallicGlossMap", AssetDatabase.LoadAssetAtPath<Texture2D>(folder + "/metallic_smoothness.png"));
            material.SetFloat("_Metallic", 1); material.SetFloat("_Smoothness", .6f);
            material.SetFloat("_Cull", 0);
            material.EnableKeyword("_NORMALMAP"); material.EnableKeyword("_METALLICSPECGLOSSMAP");
            EditorUtility.SetDirty(material);
            return material;
        }
        private static void ImportTexture(string path, bool normal, bool srgb)
        {
            var importer = (TextureImporter)AssetImporter.GetAtPath(path);
            importer.textureType = normal ? TextureImporterType.NormalMap : TextureImporterType.Default;
            importer.sRGBTexture = srgb; importer.maxTextureSize = 1024;
            importer.mipmapEnabled = true; importer.convertToNormalmap = false;
            importer.SaveAndReimport();
        }
        private static string Fingerprint(string source, string folder)
        {
            var names = new[] { "candidate.fbx", "base_color.png", "normal.png", "metallic_roughness.png" };
            var outputs = new[] { "candidate.fbx", "candidate.fbx.meta", "base_color.png", "base_color.png.meta", "normal.png", "normal.png.meta", "metallic_smoothness.png", "metallic_smoothness.png.meta", "WormMotion.asset", "WormMotion.asset.meta", "Worm.mat", "Worm.mat.meta", "Worm.prefab", "Worm.prefab.meta" };
            var paths = names.Select(n => Path.Combine(source, n)).Concat(outputs.Select(n => folder + "/" + n))
                .Concat(new[] { "Assets/GalaQuest/Editor/WormCompanionAuthoring.cs", "Assets/GalaQuest/Runtime/Gameplay/GalaQuestWormMotion.cs" });
            return Application.unityVersion + "\n" + string.Join("\n", paths.Select(path => File.Exists(path) ? Hash(path) : "MISSING"));
        }
        private static string Hash(string path)
        {
            using var hash = SHA256.Create();
            using var input = File.OpenRead(path);
            return BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
        }
    }
}
