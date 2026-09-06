using UnityEngine;

namespace GalaQuest
{
    public sealed class GalaQuestGameplayCamera : MonoBehaviour
    {
        private static readonly Vector3 FollowOffset = new Vector3(0f, 3.15f, -9.5f);
        private static readonly Vector3 LookOffset = new Vector3(0f, 0.6f, 0f);

        [SerializeField] private Transform target;

        public void Configure(Transform followTarget)
        {
            target = followTarget;
            FollowNow();
        }

        private void LateUpdate() => FollowNow();

        public void FollowNow()
        {
            if (target == null) return;
            transform.position = target.position + FollowOffset;
            transform.rotation = Quaternion.LookRotation((target.position + LookOffset) - transform.position);
        }
    }
}
