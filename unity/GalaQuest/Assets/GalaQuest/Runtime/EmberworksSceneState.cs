using UnityEngine;

namespace GalaQuest
{
    /// <summary>
    /// Bounded authored-state switch for the Emberworks greybox. This is not a quest or save system;
    /// it only lets the review pack show the authored before/after forge presentation.
    /// </summary>
    public sealed class EmberworksSceneState : MonoBehaviour
    {
        [SerializeField] private bool forgeRelit;
        [SerializeField] private GameObject dormantForge;
        [SerializeField] private GameObject relitForge;
        [SerializeField] private Light[] relitLights;

        public bool ForgeRelit => forgeRelit;

        public void Configure(GameObject dormant, GameObject relit, Light[] lights)
        {
            dormantForge = dormant;
            relitForge = relit;
            relitLights = lights;
            Apply();
        }

        public void SetForgeRelit(bool value)
        {
            forgeRelit = value;
            Apply();
        }

        private void OnEnable()
        {
            Apply();
        }

        private void OnValidate()
        {
            Apply();
        }

        private void Apply()
        {
            if (dormantForge != null)
            {
                dormantForge.SetActive(!forgeRelit);
            }

            if (relitForge != null)
            {
                relitForge.SetActive(forgeRelit);
            }

            if (relitLights != null)
            {
                foreach (var light in relitLights)
                {
                    if (light != null)
                    {
                        light.enabled = forgeRelit;
                    }
                }
            }
        }
    }
}
