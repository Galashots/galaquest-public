using System;
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
    }
}
