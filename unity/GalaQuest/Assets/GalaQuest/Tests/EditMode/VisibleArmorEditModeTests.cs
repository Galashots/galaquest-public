using System.Linq;
using GalaQuest.Editor;
using GalaQuest.Migration;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class VisibleArmorEditModeTests
    {
        [Test]
        public void Visible_armor_manifest_and_fit_authority_parse_without_duplicate_fit_values()
        {
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(VisibleArmorManifest.AssetPath);
            var manifest = VisibleArmorManifest.Parse(asset.text);

            Assert.That(manifest.schema, Is.EqualTo(VisibleArmorManifest.Schema));
            Assert.That(manifest.schemaVersion, Is.EqualTo(VisibleArmorManifest.SchemaVersion));
            Assert.That(manifest.gear.semanticId, Is.EqualTo("helmet_silverguard"));
            Assert.That(manifest.gear.sourcePath, Is.EqualTo("public/assets/gear/helmet_silverguard.glb"));
            Assert.That(manifest.fitAuthority.runtimeSourcePath, Is.EqualTo("public/src/character/gear.js"));
            Assert.That(manifest.fitAuthority.semanticId, Is.EqualTo(manifest.gear.semanticId));
            Assert.That(manifest.fitAuthority.restRelativeToHeroRoot.position, Has.Length.EqualTo(3));
            Assert.That(manifest.fitAuthority.restRelativeToHeroRoot.quaternion, Has.Length.EqualTo(4));
            Assert.That(manifest.fitAuthority.restRelativeToHeroRoot.scale, Has.Length.EqualTo(3));
        }

        [Test]
        public void Invalid_visible_armor_schema_is_rejected()
        {
            Assert.Throws<VisibleArmorManifestValidationException>(() => VisibleArmorManifest.Parse(
                "{\"schema\":\"wrong\",\"schemaVersion\":1}"));
        }

        [Test]
        public void Proof_prefabs_have_deterministic_unequipped_and_equipped_states()
        {
            var unequipped = AssetDatabase.LoadAssetAtPath<GameObject>(VisibleArmorProofBuilder.UnequippedPrefabPath);
            var equipped = AssetDatabase.LoadAssetAtPath<GameObject>(VisibleArmorProofBuilder.EquippedPrefabPath);
            Assert.That(unequipped, Is.Not.Null);
            Assert.That(equipped, Is.Not.Null);

            var control = unequipped.GetComponent<VisibleArmorHeroProof>();
            var worn = equipped.GetComponent<VisibleArmorHeroProof>();
            Assert.That(control.Equipped, Is.False);
            Assert.That(control.Helmet, Is.Null);
            Assert.That(worn.Equipped, Is.True);
            Assert.That(worn.Helmet, Is.Not.Null);
            Assert.That(worn.Helmet.transform.parent.name, Is.EqualTo("Head"));
            Assert.That(VisibleArmorFitPlacement.FindRequired(equipped.transform, "Armature"), Is.Not.Null);
            Assert.That(VisibleArmorFitPlacement.FindRequired(equipped.transform, "Head"), Is.Not.Null);
            Assert.That(equipped.GetComponentsInChildren<Transform>(true).Count(transform => transform.name.Contains("Helmet")), Is.GreaterThanOrEqualTo(1));
        }

        [Test]
        public void Coordinate_conversion_fixture_is_single_canonical_seam()
        {
            var source = new Vector3(1.25f, -2f, 3.5f);
            Assert.That(ThreeToUnityCoordinates.ConvertPosition(source), Is.EqualTo(new Vector3(1.25f, -2f, -3.5f)));
            Assert.That(ThreeToUnityCoordinates.ConvertScale(new Vector3(2f, 3f, 4f)), Is.EqualTo(new Vector3(2f, 3f, 4f)));
        }
    }
}
