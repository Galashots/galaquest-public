using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using GalaQuest.Editor;
using GalaQuest.Migration;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class MigrationBridgeEditModeTests
    {
        [Test]
        public void Manifest_parses_and_exposes_imported_contract_and_asset_identity()
        {
            var data = MigrationBridgeAssetImporter.ImportManifestAsset();

            Assert.That(data.Schema, Is.EqualTo(MigrationBridgeManifest.Schema));
            Assert.That(data.SchemaVersion, Is.EqualTo(MigrationBridgeManifest.SchemaVersion));
            Assert.That(data.OriginatingGitSha, Does.Match("^[0-9a-f]{40}$"));
            Assert.That(data.Movement.SemanticId, Is.EqualTo("movement.speed-law"));
            Assert.That(data.Movement.SourcePath, Is.EqualTo("public/src/character/speed.js"));
            Assert.That(data.Movement.WalkSpeed, Is.EqualTo(1.7f).Within(0.00001f));
            Assert.That(data.Movement.RunSpeed, Is.EqualTo(3.6f).Within(0.00001f));
            Assert.That(data.Assets, Has.Length.EqualTo(2));
            Assert.That(data.Assets[0].SemanticId, Is.EqualTo("gear.sword.ironwood"));
            Assert.That(data.Assets[1].SemanticId, Is.EqualTo("world.keeper"));
        }

        [Test]
        public void Invalid_schema_is_rejected()
        {
            var malformed = "{\"schema\":\"wrong\",\"schemaVersion\":1}";

            Assert.Throws<MigrationManifestValidationException>(() => MigrationBridgeManifest.Parse(malformed));
        }

        [Test]
        public void Coordinate_fixture_is_converted_by_the_canonical_seam()
        {
            var manifest = AssetDatabase.LoadAssetAtPath<TextAsset>(MigrationBridgeAssetImporter.ManifestAssetPath);
            var document = MigrationBridgeManifest.Parse(manifest.text);
            var source = document.coordinateFixture.source;
            var destination = document.coordinateFixture.destination;
            var sourcePosition = new Vector3(source.position[0], source.position[1], source.position[2]);
            var sourceRotation = new Quaternion(
                source.rotationQuaternion[0],
                source.rotationQuaternion[1],
                source.rotationQuaternion[2],
                source.rotationQuaternion[3]);
            var sourceScale = new Vector3(source.scale[0], source.scale[1], source.scale[2]);

            Assert.That(ThreeToUnityCoordinates.ConvertPosition(sourcePosition), Is.EqualTo(
                new Vector3(destination.position[0], destination.position[1], destination.position[2])));
            Assert.That(ThreeToUnityCoordinates.ConvertScale(sourceScale), Is.EqualTo(
                new Vector3(destination.scale[0], destination.scale[1], destination.scale[2])));

            var expectedRotation = new Quaternion(
                destination.rotationQuaternion[0],
                destination.rotationQuaternion[1],
                destination.rotationQuaternion[2],
                destination.rotationQuaternion[3]);
            Assert.That(Quaternion.Dot(ThreeToUnityCoordinates.ConvertRotation(sourceRotation), expectedRotation), Is.GreaterThan(0.99999f));

            var rotatedSourceVector = sourceRotation * Vector3.right;
            var rotatedDestinationVector = expectedRotation * Vector3.right;
            Assert.That(Vector3.Distance(
                ThreeToUnityCoordinates.ConvertVector(rotatedSourceVector),
                rotatedDestinationVector), Is.LessThan(0.00001f));
        }

        [Test]
        public void Import_is_idempotent_and_keeps_one_scriptable_object()
        {
            var first = MigrationBridgeAssetImporter.ImportManifestAsset();
            var firstJson = EditorJsonUtility.ToJson(first);
            var firstInstanceId = first.GetInstanceID();
            var second = MigrationBridgeAssetImporter.ImportManifestAsset();
            var secondJson = EditorJsonUtility.ToJson(second);

            Assert.That(second.GetInstanceID(), Is.EqualTo(firstInstanceId));
            Assert.That(secondJson, Is.EqualTo(firstJson));
            Assert.That(AssetDatabase.FindAssets("t:MigrationBridgeData", new[] { "Assets/GalaQuest/Migration/Generated" }), Has.Length.EqualTo(1));
        }

        [Test]
        public void Asset_provenance_parses_and_matches_the_current_source_and_derivative_bytes()
        {
            var document = MigrationAssetIntake.ReadAndValidateProvenance();
            Assert.That(document.records.Select(record => record.semanticId), Is.EquivalentTo(new[]
            {
                "gear.sword.ironwood",
                "world.keeper",
            }));

            var repositoryRoot = new DirectoryInfo(Application.dataPath).Parent.Parent.Parent.FullName;
            foreach (var record in document.records)
            {
                var sourcePath = Path.Combine(repositoryRoot, record.sourceRepoPath.Replace('/', Path.DirectorySeparatorChar));
                var derivativePath = Path.Combine(repositoryRoot, record.derivativeRepoPath.Replace('/', Path.DirectorySeparatorChar));
                Assert.That(File.Exists(sourcePath), Is.True, record.sourceRepoPath);
                Assert.That(File.Exists(derivativePath), Is.True, record.derivativeRepoPath);
                Assert.That(HashFile(sourcePath), Is.EqualTo(record.sourceSha256));
                Assert.That(HashFile(derivativePath), Is.EqualTo(record.derivativeSha256));
                Assert.That(record.derivativeFiles, Has.Length.EqualTo(record.sourceInspection.imageCount));
                foreach (var derivativeFile in record.derivativeFiles)
                {
                    var texturePath = Path.Combine(repositoryRoot, derivativeFile.path.Replace('/', Path.DirectorySeparatorChar));
                    Assert.That(File.Exists(texturePath), Is.True, derivativeFile.path);
                    Assert.That(HashFile(texturePath), Is.EqualTo(derivativeFile.sha256));
                    Assert.That(derivativeFile.sizeBytes, Is.GreaterThan(0));
                }
                Assert.That(record.sourceGitSha, Is.EqualTo(document.sourceGitSha));
                Assert.That(record.conversionOptions.retarget, Is.False);
                Assert.That(record.conversionOptions.materialRepair, Is.False);
            }

            var keeper = MigrationAssetIntake.FindRecord(document, "world.keeper");
            Assert.That(keeper.sourceInspection.animations.Select(animation => animation.name), Is.EquivalentTo(new[]
            {
                "talk",
                "idle",
                "wave",
            }));
            Assert.That(keeper.sourceInspection.animations, Has.Length.EqualTo(3));
            Assert.That(keeper.sourceInspection.materialInputs, Has.Length.EqualTo(1));
            Assert.That(keeper.sourceInspection.materialInputs[0].hasMetallicFactor, Is.False);
            Assert.That(keeper.sourceInspection.materialInputs[0].emissiveImageIndex,
                Is.EqualTo(keeper.sourceInspection.materialInputs[0].baseColorImageIndex));
        }

        [Test]
        public void Native_import_preserves_keeper_skeleton_skin_materials_scale_and_actual_clip_inventory()
        {
            var keeper = AssetDatabase.LoadAssetAtPath<GameObject>(MigrationAssetIntake.KeeperModelPath);
            Assert.That(keeper, Is.Not.Null);
            Assert.That(keeper.transform.localScale.x, Is.EqualTo(1f).Within(0.0001f));
            Assert.That(keeper.transform.localScale.y, Is.EqualTo(1f).Within(0.0001f));
            Assert.That(keeper.transform.localScale.z, Is.EqualTo(1f).Within(0.0001f));
            Assert.That(keeper.GetComponentsInChildren<Transform>(true).Any(transform => transform.name == "Hips"), Is.True);

            var skinnedMeshes = keeper.GetComponentsInChildren<SkinnedMeshRenderer>(true);
            Assert.That(skinnedMeshes, Has.Length.GreaterThanOrEqualTo(1));
            Assert.That(skinnedMeshes.All(renderer => renderer.sharedMesh != null), Is.True);
            Assert.That(skinnedMeshes.All(renderer => renderer.sharedMaterials.Length >= 1), Is.True);
            Assert.That(skinnedMeshes.Sum(renderer => renderer.localBounds.size.magnitude), Is.InRange(0.01f, 100f));
            var clips = MigrationAssetIntake.GetActualKeeperClips();
            Assert.That(clips, Has.Length.EqualTo(3));
            Assert.That(clips.Select(ClipIdentity).ToHashSet(StringComparer.Ordinal), Is.EquivalentTo(new[]
            {
                "talk",
                "idle",
                "wave",
            }));

            var importedMaterials = AssetDatabase.LoadAllAssetsAtPath(MigrationAssetIntake.KeeperModelPath)
                .OfType<Material>()
                .ToArray();
            var importedTextures = AssetDatabase.FindAssets("t:Texture2D", new[] { MigrationAssetIntake.KeeperTexturePath })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<Texture2D>)
                .Where(texture => texture != null)
                .ToArray();
            Assert.That(importedMaterials, Has.Length.EqualTo(1));
            Debug.Log($"Keeper native material shader={importedMaterials[0].shader.name} properties={string.Join(",", importedMaterials[0].GetTexturePropertyNames())} textures={importedTextures.Length}");
            Assert.That(importedTextures, Has.Length.GreaterThanOrEqualTo(1));
            Assert.That(importedMaterials.Any(material => material.GetTexturePropertyNames()
                .Any(property => material.GetTexture(property) != null)), Is.True);
        }

        [Test]
        public void Proof_assets_have_one_prefab_per_semantic_asset_and_one_proof_scene()
        {
            Assert.That(AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/GalaQuest/Migration/Prefabs" }), Has.Length.EqualTo(2));
            Assert.That(AssetDatabase.FindAssets("t:AnimatorController", new[] { "Assets/GalaQuest/Migration/Generated" }), Has.Length.EqualTo(1));
            Assert.That(AssetDatabase.FindAssets("t:Scene", new[] { "Assets/GalaQuest/Migration/Scenes" }), Has.Length.EqualTo(1));

            var sword = AssetDatabase.LoadAssetAtPath<GameObject>(MigrationAssetIntake.SwordPrefabPath);
            var keeper = AssetDatabase.LoadAssetAtPath<GameObject>(MigrationAssetIntake.KeeperPrefabPath);
            Assert.That(sword.GetComponent<MigrationProofAssetIdentity>().SemanticId, Is.EqualTo("gear.sword.ironwood"));
            Assert.That(keeper.GetComponent<MigrationProofAssetIdentity>().SemanticId, Is.EqualTo("world.keeper"));
            Assert.That(keeper.GetComponent<Animator>().runtimeAnimatorController, Is.Not.Null);
        }

        private static string HashFile(string path)
        {
            using (var sha256 = SHA256.Create())
            {
                return BitConverter.ToString(sha256.ComputeHash(File.ReadAllBytes(path))).Replace("-", string.Empty).ToLowerInvariant();
            }
        }

        private static string ClipIdentity(AnimationClip clip)
        {
            var separator = clip.name.LastIndexOf('|');
            return separator >= 0 ? clip.name.Substring(separator + 1) : clip.name;
        }
    }
}
