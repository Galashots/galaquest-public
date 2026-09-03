using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>
    /// The seam PlayMode tests drive to sweep a fit across real GQ_HERO_V1 animation.
    ///
    /// A fit judged in one frozen pose is the failure this project has already paid for twice: the
    /// Wildwood Blade passed a Studio still and read as an empty hand in the running game
    /// (public/src/character/gear.js, "RE-SOLVED 2026-08-28"). Sampling every clip at many normalized
    /// times is the machine half of not repeating that.
    ///
    /// This uses Unity's ordinary Animator. It is not a custom animation system.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class GearFitProofRig : MonoBehaviour
    {
        [SerializeField] private Transform heroRoot;
        [SerializeField] private HeadFitProxy headProxy;
        [SerializeField] private Animator animator;
        [SerializeField] private string[] poseStates = new string[0];

        public Transform HeroRoot => heroRoot;
        public HeadFitProxy HeadProxy => headProxy;
        public Animator Animator => animator;
        public IReadOnlyList<string> PoseStates => poseStates;

        public void Configure(Transform hero, HeadFitProxy proxy, Animator heroAnimator, string[] states)
        {
            heroRoot = hero;
            headProxy = proxy;
            animator = heroAnimator;
            poseStates = states ?? new string[0];
        }

        /// <summary>Drive the Hero to an exact point in one clip, deterministically.</summary>
        public void Sample(string stateName, float normalizedTime)
        {
            if (animator == null) return;
            animator.Play(stateName, 0, Mathf.Clamp01(normalizedTime));
            animator.Update(0f);
        }

        public IReadOnlyList<GearMountedItem> MountedItems()
        {
            var mounted = new List<GearMountedItem>();
            if (heroRoot == null) return mounted;
            mounted.AddRange(heroRoot.GetComponentsInChildren<GearMountedItem>(true));
            return mounted;
        }

        /// <summary>
        /// World position of a mounted item's socket, used to catch anchor discontinuity: a mount that
        /// teleports between adjacent animation samples is reading the wrong bone frame.
        /// </summary>
        public static bool TryGetSocketPosition(GearMountedItem item, out Vector3 position)
        {
            position = Vector3.zero;
            if (item == null || item.transform.parent == null) return false;
            position = item.transform.position;
            return true;
        }
    }
}
