using System.Collections;
using GalaQuest.Migration;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class VisibleArmorPlayModeTests
    {
        [UnityTest]
        public IEnumerator Visible_armor_scene_loads_and_toggle_changes_equipment_state()
        {
            var load = SceneManager.LoadSceneAsync("VisibleArmorProof", LoadSceneMode.Single);
            Assert.That(load, Is.Not.Null);
            while (!load.isDone) yield return null;

            var equipped = GameObject.Find("Hero Equipped Silverguard Helmet");
            var control = GameObject.Find("Hero Unequipped (control)");
            Assert.That(equipped, Is.Not.Null);
            Assert.That(control, Is.Not.Null);

            var proof = equipped.GetComponent<VisibleArmorHeroProof>();
            Assert.That(proof, Is.Not.Null);
            Assert.That(proof.Equipped, Is.True);
            Assert.That(proof.Helmet, Is.Not.Null);
            Assert.That(proof.Helmet.activeSelf, Is.True);

            proof.SetEquipped(false);
            yield return null;
            Assert.That(proof.Equipped, Is.False);
            Assert.That(proof.Helmet.activeSelf, Is.False);

            proof.SetEquipped(true);
            yield return null;
            Assert.That(proof.Equipped, Is.True);
            Assert.That(proof.Helmet.activeSelf, Is.True);
            Assert.That(control.GetComponent<VisibleArmorHeroProof>().Equipped, Is.False);
        }
    }
}
