using UnityEngine;

namespace GalaQuest
{
    [DefaultExecutionOrder(100)]
    public sealed class GalaQuestHeroLocomotion : MonoBehaviour
    {
        public const string SpeedParameter = "Speed";
        private static readonly int SpeedId = Animator.StringToHash(SpeedParameter);
        [SerializeField] private GalaQuestTraversalController movement;
        [SerializeField] private Animator animator;

        public void Configure(GalaQuestTraversalController traversal, Animator heroAnimator)
        {
            movement = traversal;
            animator = heroAnimator;
            if (animator != null)
            {
                animator.applyRootMotion = false;
                animator.updateMode = AnimatorUpdateMode.UnscaledTime;
                animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            }
        }

        private void Update() => PresentNow(Time.unscaledDeltaTime);

        public void PresentNow(float deltaSeconds)
        {
            if (animator == null || animator.runtimeAnimatorController == null) return;
            var speed = movement != null ? movement.PredictedMotionSpeed : 0f;
            animator.SetFloat(SpeedId, speed, 0.08f, Mathf.Max(0f, deltaSeconds));
        }

        private void OnDisable()
        {
            if (animator != null && animator.runtimeAnimatorController != null) animator.SetFloat(SpeedId, 0f);
        }
    }
}
