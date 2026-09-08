using UnityEngine;

namespace GalaQuest
{
    // State clocks come from the authority. Animator states use this character's
    // own clips, with authoring-time playback speeds matched to the combat clocks.
    public sealed class GalaQuestCombatMotion : MonoBehaviour
    {
        private Animator animator;
        private bool hero;
        private string state;
        private float lastClock;
        public string CurrentState => state;

        public void Configure(Animator value, bool isHero)
        {
            animator = value;
            hero = isHero;
            animator.applyRootMotion = false;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            animator.updateMode = AnimatorUpdateMode.UnscaledTime;
            state = null;
        }

        public void Present(string mode, float clock, float duration, float speed = 0)
        {
            if (animator == null || animator.runtimeAnimatorController == null) return;
            var next = mode;
            if (hero && (mode == "idle" || mode == "walk"))
            {
                next = "Locomotion";
                animator.SetFloat(GalaQuestHeroLocomotion.SpeedParameter, speed, .08f, Time.unscaledDeltaTime);
            }
            if (next != state || (duration > 0 && clock < lastClock - .05f))
            {
                var progress = duration > 0 ? Mathf.Clamp(clock / duration, 0, .999f) : 0;
                animator.CrossFade(next, .06f, 0, progress);
                state = next;
            }
            lastClock = clock;
        }
    }
}
