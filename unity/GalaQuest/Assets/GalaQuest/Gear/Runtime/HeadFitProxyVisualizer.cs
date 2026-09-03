using UnityEngine;

namespace GalaQuest.Gear
{
    /// <summary>
    /// Draws the Head Fit Proxy in the Scene View with ordinary Unity gizmos, so the Owner can see the
    /// clearance the helmet has to respect while dragging it with the normal move/rotate/scale tools.
    ///
    /// Gizmos only -- this never renders in a build and never affects a fit.
    /// </summary>
    [ExecuteAlways]
    [DisallowMultipleComponent]
    public sealed class HeadFitProxyVisualizer : MonoBehaviour
    {
        [SerializeField] private HeadFitProxy proxy;
        [SerializeField] private Transform headBone;
        [SerializeField] private bool showProxy = true;

        public HeadFitProxy Proxy => proxy;
        public bool ShowProxy
        {
            get => showProxy;
            set => showProxy = value;
        }

        public void Configure(HeadFitProxy fitProxy, Transform bone)
        {
            proxy = fitProxy;
            headBone = bone;
        }

        private void OnDrawGizmos()
        {
            if (!showProxy || proxy == null || headBone == null) return;

            var crown = headBone.TransformPoint(proxy.Crown);
            var face = headBone.TransformPoint(proxy.FaceAnchor);
            var eye = headBone.TransformPoint(proxy.EyeLine);
            var basePoint = headBone.position;

            // Head axis: base of the head bone to the crown helper.
            Gizmos.color = new Color(0.4f, 0.8f, 1f, 0.9f);
            Gizmos.DrawLine(basePoint, crown);
            Gizmos.DrawWireSphere(crown, 0.012f);

            // Face direction from the headfront helper.
            Gizmos.color = new Color(0.6f, 1f, 0.6f, 0.9f);
            Gizmos.DrawLine(basePoint, face);

            // Skull seat reference at the eye line height.
            Gizmos.color = new Color(1f, 1f, 1f, 0.25f);
            Gizmos.DrawWireSphere(basePoint + (crown - basePoint) * 0.5f, proxy.SkullRadius);

            // The keep-out that actually rejects a fit: the face window at the eye line.
            Gizmos.color = new Color(1f, 0.35f, 0.35f, 0.95f);
            Gizmos.DrawWireSphere(eye, proxy.EyeClearanceRadius);
            Gizmos.DrawLine(eye - headBone.right * proxy.EyeClearanceRadius,
                            eye + headBone.right * proxy.EyeClearanceRadius);

            // The floating limit above the crown.
            Gizmos.color = new Color(1f, 0.8f, 0.2f, 0.6f);
            var up = headBone.TransformDirection(proxy.UpAxis).normalized;
            Gizmos.DrawWireSphere(crown + up * proxy.MaxCrownGap, 0.008f);
        }
    }
}
