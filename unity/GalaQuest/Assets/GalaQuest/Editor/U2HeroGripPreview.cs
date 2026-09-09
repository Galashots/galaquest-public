using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GalaQuest.Editor
{
    // Owner-authorized local hand candidate. The imported source, skeleton, skin
    // weights and canonical prefab remain untouched. This is not asset promotion.
    public static class U2HeroGripPreview
    {
        public const string MarkerName = "CandidateRightGrip";
        public const string CandidateSha = "f22e1c3d00778f43dd9ecdab18c3d628a15815f2e411aa37bf7c42f9cdb3ea64";
        public static string CandidatePath => Path.Combine(U2CombatPreview.RepoRoot, ".local/m2/hero-grip-candidate/right-hand-grip-v1.json");
        private const string SourceHash = "23c161a6a7045987f54b2dae370d02c665d169aefa0c8b6377ca5ee82c893351";
        private static Vector3 V(JToken token) => new Vector3((float)token[0], (float)token[1], (float)token[2]);
        private static Vector3Int Key(Vector3 p, float tolerance) => new Vector3Int(
            Mathf.RoundToInt(p.x / tolerance), Mathf.RoundToInt(p.y / tolerance), Mathf.RoundToInt(p.z / tolerance));

        public static GameObject Prepare(GameObject original, string folder)
        {
            var sourcePath = Path.Combine(U2CombatPreview.RepoRoot, "unity/GalaQuest", U2CombatPreview.HeroSource);
            var hash = Hash(sourcePath);
            if (hash != SourceHash) throw new InvalidOperationException("Hero source changed; requalify the hand candidate");
            if (Hash(CandidatePath) != CandidateSha) throw new InvalidOperationException("Expected the qualified local hand candidate bytes");
            var receipt = JObject.Parse(File.ReadAllText(CandidatePath));
            if ((string)receipt["sourceSha256"] != SourceHash || (float)receipt["minimumJacobianDeterminant"] <= 0)
                throw new InvalidOperationException("Source mismatch or inverted hand deformation");
            var patch = receipt["patch"].ToArray();
            var hero = Object.Instantiate(original);
            try
            {
                var renderer = hero.GetComponentsInChildren<SkinnedMeshRenderer>().Single(r =>
                    r.bones.Any(b => b.name == "RightHand") && r.sharedMesh.vertexCount > 1000);
                var originalMesh = renderer.sharedMesh;
                var vertices = originalMesh.vertices;
                var sourceVertices = (Vector3[])vertices.Clone();
                var handIndex = Array.FindIndex(renderer.bones, b => b.name == "RightHand");
                var mapping = FindMapping(vertices, patch);
                var tolerance = mapping.MultiplyVector(Vector3.right).magnitude * .002f;
                var lookup = Lookup(vertices, tolerance);
                var changed = new Dictionary<int, Vector3>();
                foreach (var item in patch)
                {
                    var p = mapping.MultiplyPoint3x4(V(item["source"]));
                    var candidate = mapping.MultiplyPoint3x4(V(item["candidate"]));
                    var indices = Match(p, sourceVertices, lookup, tolerance);
                    if (indices.Count == 0) throw new InvalidOperationException("Unmatched hand vertex: " + p);
                    foreach (var index in indices)
                    {
                        if (changed.TryGetValue(index, out var prior))
                        {
                            if (Vector3.Distance(prior, candidate) > tolerance) throw new InvalidOperationException("Conflicting seam deformation");
                            continue;
                        }
                        var weight = originalMesh.boneWeights[index];
                        var handWeight = (weight.boneIndex0 == handIndex ? weight.weight0 : 0)
                            + (weight.boneIndex1 == handIndex ? weight.weight1 : 0)
                            + (weight.boneIndex2 == handIndex ? weight.weight2 : 0)
                            + (weight.boneIndex3 == handIndex ? weight.weight3 : 0);
                        if (handWeight < .499f) throw new InvalidOperationException("Patch escaped the right hand");
                        changed.Add(index, candidate);
                    }
                }
                var mesh = Object.Instantiate(originalMesh);
                mesh.name = "GQ_HERO_V1 right grip candidate";
                ReplaceHandSurface(mesh, originalMesh, changed.Keys.ToHashSet(), mapping, receipt, renderer.bones);
                if (!mesh.vertices.Take(sourceVertices.Length).SequenceEqual(sourceVertices))
                    throw new InvalidOperationException("Original vertex buffer changed during local refinement");
                if (!originalMesh.vertices.SequenceEqual(sourceVertices)) throw new InvalidOperationException("Source mesh mutated");
                AssetDatabase.CreateAsset(mesh, folder + "/HeroRightGrip.asset");
                renderer.sharedMesh = mesh;
                renderer.localBounds = mesh.bounds;
                var marker = new GameObject(MarkerName).transform;
                marker.SetParent(renderer.bones[handIndex], false);
                var bind = originalMesh.bindposes[handIndex];
                marker.localPosition = bind.MultiplyPoint3x4(mapping.MultiplyPoint3x4(V(receipt["gripGuide"]["center"])));
                var blade = bind.MultiplyVector(mapping.MultiplyVector(-V(receipt["gripGuide"]["axis"]))).normalized;
                var backOfHand = bind.MultiplyVector(mapping.MultiplyVector(Vector3.forward)).normalized;
                marker.localRotation = Quaternion.LookRotation(backOfHand, blade);
                var result = PrefabUtility.SaveAsPrefabAsset(hero, folder + "/HeroRightGrip.prefab");
                AssetDatabase.SaveAssetIfDirty(mesh);
                AssetDatabase.SaveAssetIfDirty(result);
                File.WriteAllText(Path.Combine(U2CombatPreview.RepoRoot, ".local/m2/hero-grip-candidate/unity-import-receipt.json"),
                    new JObject { ["status"] = "LOCAL_CANDIDATE_REVIEW", ["sourceSha256"] = hash,
                        ["candidateSha256"] = CandidateSha,
                        ["productionPromotion"] = false, ["sourceVertices"] = vertices.Length,
                        ["changedVertices"] = changed.Count, ["boneCount"] = renderer.bones.Length,
                        ["candidateVertices"] = mesh.vertexCount, ["candidateTriangles"] = mesh.triangles.Length / 3,
                        ["sourcePreserved"] = true, ["mapping"] = mapping.ToString(),
                        ["gripHandLocal"] = marker.localPosition.ToString("F6") }.ToString());
                return result;
            }
            finally { Object.DestroyImmediate(hero); }
        }

        private static string Hash(string path)
        {
            using var sha = System.Security.Cryptography.SHA256.Create();
            using var stream = File.OpenRead(path);
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }

        private static void ReplaceHandSurface(Mesh mesh, Mesh source, HashSet<int> affected, Matrix4x4 mapping, JObject receipt, Transform[] bones)
        {
            if (source.subMeshCount != 1 || source.blendShapeCount != 0 || source.colors.Length != 0)
                throw new InvalidOperationException("Unexpected hero mesh channels; preserve them before refining the hand");
            for (var channel = 1; channel < 8; channel++)
            {
                var extra = new List<Vector4>(); source.GetUVs(channel, extra);
                if (extra.Count != 0) throw new InvalidOperationException("Unexpected additional hero UV channel");
            }
            var sourcePoints = source.vertices;
            var vertices = sourcePoints.ToList(); var normals = source.normals.ToList();
            var tangents = source.tangents.ToList(); var uv = source.uv.ToList(); var weights = source.boneWeights.ToList();
            var tolerance = mapping.MultiplyVector(Vector3.right).magnitude * .002f;
            var lookup = Lookup(sourcePoints, tolerance);
            foreach (var check in receipt["sourceUvChecks"])
            {
                var p = mapping.MultiplyPoint3x4(V(check["source"]));
                var expected = new Vector2((float)check["uv"][0], (float)check["uv"][1]);
                if (!Match(p, sourcePoints, lookup, tolerance).Any(i => (uv[i] - expected).sqrMagnitude < 0.00000004f))
                    throw new InvalidOperationException("Imported hero UV correspondence did not match");
            }
            var indices = new List<int>(); var sourceIndices = source.triangles; var removed = 0;
            for (var i = 0; i < sourceIndices.Length; i += 3)
            {
                if (affected.Contains(sourceIndices[i]) || affected.Contains(sourceIndices[i + 1]) || affected.Contains(sourceIndices[i + 2])) removed++;
                else { indices.Add(sourceIndices[i]); indices.Add(sourceIndices[i + 1]); indices.Add(sourceIndices[i + 2]); }
            }
            if (removed != (int)receipt["refinedSourceTriangles"])
                throw new InvalidOperationException("Imported hand triangle boundary differs: " + removed);
            var offset = vertices.Count;
            var normalMap = mapping.inverse.transpose;
            foreach (var v in receipt["surfaceVertices"])
            {
                vertices.Add(mapping.MultiplyPoint3x4(V(v["position"])));
                normals.Add(normalMap.MultiplyVector(V(v["normal"])).normalized);
                uv.Add(new Vector2((float)v["uv"][0], (float)v["uv"][1]));
                tangents.Add(Vector4.zero);
                var influences = ((JObject)v["weights"]).Properties().Where(p => (float)p.Value > .000001f)
                    .OrderByDescending(p => (float)p.Value).ToArray();
                if (influences.Length > 4) throw new InvalidOperationException("Refinement would discard bone influences");
                var ids = new int[4]; var values = new float[4];
                for (var i = 0; i < influences.Length; i++)
                {
                    ids[i] = Array.FindIndex(bones, b => b.name == influences[i].Name);
                    if (ids[i] < 0) throw new InvalidOperationException("Unknown source bone " + influences[i].Name);
                    values[i] = (float)influences[i].Value;
                }
                if (Mathf.Abs(values.Sum() - 1) > .001f) throw new InvalidOperationException("Invalid interpolated skin weights");
                weights.Add(new BoneWeight { boneIndex0 = ids[0], boneIndex1 = ids[1], boneIndex2 = ids[2], boneIndex3 = ids[3],
                    weight0 = values[0], weight1 = values[1], weight2 = values[2], weight3 = values[3] });
            }
            var tangentSum = new Vector3[vertices.Count]; var bitangentSum = new Vector3[vertices.Count];
            foreach (var triangle in receipt["surfaceTriangles"])
            {
                var a = offset + (int)triangle[0]; var b = offset + (int)triangle[1]; var c = offset + (int)triangle[2];
                if (mapping.determinant < 0) (b, c) = (c, b);
                indices.Add(a); indices.Add(b); indices.Add(c);
                var edge1 = vertices[b] - vertices[a]; var edge2 = vertices[c] - vertices[a];
                var duv1 = uv[b] - uv[a]; var duv2 = uv[c] - uv[a];
                var determinant = duv1.x * duv2.y - duv1.y * duv2.x;
                if (Mathf.Abs(determinant) < .00000001f) continue;
                var tangent = (edge1 * duv2.y - edge2 * duv1.y) / determinant;
                var bitangent = (edge2 * duv1.x - edge1 * duv2.x) / determinant;
                foreach (var i in new[] { a, b, c }) { tangentSum[i] += tangent; bitangentSum[i] += bitangent; }
            }
            for (var i = offset; i < vertices.Count; i++)
            {
                var tangent = Vector3.ProjectOnPlane(tangentSum[i], normals[i]).normalized;
                if (tangent.sqrMagnitude < .5f) tangent = Vector3.Cross(normals[i], Vector3.up).normalized;
                tangents[i] = new Vector4(tangent.x, tangent.y, tangent.z,
                    Vector3.Dot(Vector3.Cross(normals[i], tangent), bitangentSum[i]) < 0 ? -1 : 1);
            }
            // All original vertices/attributes remain byte-for-byte copies; only
            // hand triangles are replaced by the locally refined candidate surface.
            mesh.SetVertices(vertices); mesh.SetNormals(normals); mesh.SetTangents(tangents); mesh.SetUVs(0, uv);
            mesh.boneWeights = weights.ToArray(); mesh.SetTriangles(indices, 0); mesh.RecalculateBounds();
        }

        private static Dictionary<Vector3Int, List<int>> Lookup(Vector3[] vertices, float tolerance)
        {
            var result = new Dictionary<Vector3Int, List<int>>();
            for (var i = 0; i < vertices.Length; i++)
            {
                var key = Key(vertices[i], tolerance);
                if (!result.TryGetValue(key, out var list)) result.Add(key, list = new List<int>());
                list.Add(i);
            }
            return result;
        }

        private static List<int> Match(Vector3 p, Vector3[] vertices, Dictionary<Vector3Int, List<int>> lookup, float tolerance)
        {
            var result = new List<int>(); var key = Key(p, tolerance);
            for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) for (var z = -1; z <= 1; z++)
                if (lookup.TryGetValue(key + new Vector3Int(x, y, z), out var list))
                    foreach (var i in list) if ((vertices[i] - p).sqrMagnitude <= tolerance * tolerance) result.Add(i);
            return result;
        }

        private static Matrix4x4 FindMapping(Vector3[] vertices, JToken[] patch)
        {
            // Test imported axes and units against actual source positions. Unity
            // may split UV/normal seams, so vertex indices are never correspondence.
            var permutations = new[] { new[] { 0, 1, 2 }, new[] { 0, 2, 1 }, new[] { 1, 0, 2 },
                new[] { 1, 2, 0 }, new[] { 2, 0, 1 }, new[] { 2, 1, 0 } };
            var matches = new List<Matrix4x4>();
            foreach (var scale in new[] { .01f, 1f, 100f })
            {
                var tolerance = scale * .002f;
                var lookup = Lookup(vertices, tolerance);
                foreach (var axes in permutations) for (var signs = 0; signs < 8; signs++)
                {
                    var matrix = Matrix4x4.zero; matrix[3, 3] = 1;
                    for (var r = 0; r < 3; r++) matrix[r, axes[r]] = scale * ((signs & (1 << r)) == 0 ? 1 : -1);
                    if (patch.All(p => Match(matrix.MultiplyPoint3x4(V(p["source"])), vertices, lookup, tolerance).Count > 0))
                        matches.Add(matrix);
                }
            }
            if (matches.Count != 1) throw new InvalidOperationException("Expected unique imported hand correspondence; found " + matches.Count);
            return matches[0];
        }
    }
}
