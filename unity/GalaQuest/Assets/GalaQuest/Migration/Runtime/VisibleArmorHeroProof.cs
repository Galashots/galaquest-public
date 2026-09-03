using UnityEngine;

namespace GalaQuest.Migration
{
    /// <summary>Small audit-only Hero state used by the visible armor proof; not an equipment system.</summary>
    public sealed class VisibleArmorHeroProof : MonoBehaviour
    {
        [SerializeField] private bool equipped;
        [SerializeField] private string heroSemanticId;
        [SerializeField] private string gearSemanticId;
        [SerializeField] private string fitAuthoritySourcePath;
        [SerializeField] private GameObject helmet;

        public bool Equipped => equipped;
        public string HeroSemanticId => heroSemanticId;
        public string GearSemanticId => gearSemanticId;
        public string FitAuthoritySourcePath => fitAuthoritySourcePath;
        public GameObject Helmet => helmet;

        public void Configure(VisibleArmorManifestDocument manifest, GameObject helmetObject, bool isEquipped)
        {
            heroSemanticId = manifest.hero.semanticId;
            gearSemanticId = manifest.gear.semanticId;
            fitAuthoritySourcePath = manifest.fitAuthority.runtimeSourcePath;
            helmet = helmetObject;
            equipped = isEquipped;
            if (helmet != null) helmet.SetActive(isEquipped);
        }

        public void SetEquipped(bool value)
        {
            equipped = value;
            if (helmet != null) helmet.SetActive(value);
        }
    }
}
