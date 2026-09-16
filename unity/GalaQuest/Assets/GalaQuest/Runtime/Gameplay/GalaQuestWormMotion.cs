using UnityEngine;

namespace GalaQuest
{
    // Bounded procedural motion for the two child-designed worm meshes.
    // Drives Director-authored blendshapes only; never moves, scales or rotates
    // the root or any child, and never mutates the mesh or its materials.
    //
    // Blendshape contract (resolved by name via mesh.GetBlendShapeIndex):
    //   Breathe    frames 0..100    soft grounded breathing, always present.
    //   CrawlSin   frames -100/+100 quadrature crawl ripple, scaled by motion.
    //   CrawlCos   frames -100/+100 quadrature crawl ripple, scaled by motion.
    //   Celebrate  frames 0..100    short pulse on explicit Celebrate() only.
    // Missing or null shapes are harmless: those channels are skipped.
    //
    // Motion is measured as planar (XZ) displacement of this root. The blend
    // between idle and moving eases at a smooth bounded rate, teleport jumps
    // (>2m between samples) and invalid samples hold idle without latching,
    // and all phases are wrapped so nothing grows without bound.
    public sealed class GalaQuestWormMotion : MonoBehaviour
    {
        public const string BreatheShape = "Breathe";
        public const string CrawlSinShape = "CrawlSin";
        public const string CrawlCosShape = "CrawlCos";
        public const string CelebrateShape = "Celebrate";

        // Planar speed that counts as fully crawling. Shared by both variants:
        // red/green differ only in phase/cadence, never in speed or scale.
        const float FullCrawlSpeed = 2f;
        // A planar jump larger than this between samples is a teleport/reconnect
        // and must not inject crawl energy.
        const float TeleportDistance = 2f;
        // Idle<->moving blend rate per second.
        const float BlendRate = 2.5f;
        // Long suspension resynchronizes; ordinary slow frames retain real elapsed time.
        const float MaxDt = 1f;
        // Hard cap on planar speed so one huge-but-sub-teleport step cannot spike.
        const float MaxSpeed = 6f;
        // Breathe stays soft and grounded.
        const float BreatheBase = 30f;
        const float BreatheAmp = 20f;
        const float BreatheHz = .3f;
        // Crawl ripple cadence at full blend.
        const float CrawlHz = 1.6f;
        // Celebration envelope length in seconds.
        const float CelebrateDuration = 1.2f;
        // Red variant offsets: subtle phase/cadence identity only.
        const float RedPhaseOffset = 1.3f;
        const float RedCadence = .92f;

        const float TwoPi = Mathf.PI * 2f;

        [SerializeField] private SkinnedMeshRenderer body;
        Mesh cachedMesh;
        int breatheIndex = -1;
        int crawlSinIndex = -1;
        int crawlCosIndex = -1;
        int celebrateIndex = -1;

        [SerializeField] private bool redVariant;
        float phaseOffset;
        float cadence = 1f;

        Vector3 previousPosition;
        bool hasPrevious;
        float moveBlend;
        float breathePhase;
        float crawlPhase;
        float celebrateClock = -1f;

        public void Configure(SkinnedMeshRenderer renderer, bool redVariant)
        {
            ClearWeights();
            body = renderer;
            this.redVariant = redVariant;
            phaseOffset = redVariant ? RedPhaseOffset : 0f;
            cadence = redVariant ? RedCadence : 1f;
            cachedMesh = null;
            breatheIndex = -1;
            crawlSinIndex = -1;
            crawlCosIndex = -1;
            celebrateIndex = -1;
            CacheIndices();
            moveBlend = 0f;
            breathePhase = phaseOffset;
            crawlPhase = phaseOffset;
            celebrateClock = -1f;
            previousPosition = transform.position;
            hasPrevious = IsFinite(previousPosition);
            ApplyWeights();
        }

        void OnEnable()
        {
            // Fresh presence (spawn/reconnect/travel) must never inherit stale
            // motion: resync on the next sample instead of diffing across it.
            Configure(body, redVariant);
            hasPrevious = false;
        }

        void OnDisable()
        {
            celebrateClock = -1f;
            hasPrevious = false;
            moveBlend = 0f;
            ClearWeights();
        }

        void LateUpdate()
        {
            Step(Time.unscaledDeltaTime);
        }

        // Explicit new-friendship pulse only. Never fires on spawn, reconnect,
        // travel, Configure, enable, or motion.
        public void Celebrate()
        {
            celebrateClock = 0f;
        }

        public void Step(float deltaSeconds)
        {
            var center = transform.position;
            if (!IsFinite(center))
            {
                // Invalid root position: hold a safe idle pose without poisoning
                // future frames; resync as soon as positions are finite again.
                hasPrevious = false;
                moveBlend = 0f;
                ApplyWeights();
                return;
            }

            if (!IsFinite(deltaSeconds) || deltaSeconds < 0f)
            {
                hasPrevious = false;
                moveBlend = 0f;
                ApplyWeights();
                return;
            }

            if (deltaSeconds == 0f)
            {
                // Paused: freeze every clock, keep tracking the root so no debt
                // accumulates while time is stopped.
                previousPosition = center;
                hasPrevious = true;
                return;
            }

            if (deltaSeconds > MaxDt)
            {
                previousPosition = center; hasPrevious = true;
                moveBlend = 0f; celebrateClock = -1f; ApplyWeights(); return;
            }
            var dt = deltaSeconds;

            if (!hasPrevious)
            {
                previousPosition = center;
                hasPrevious = true;
                EaseClocks(dt, 0f);
                ApplyWeights();
                return;
            }

            var dx = center.x - previousPosition.x;
            var dz = center.z - previousPosition.z;
            var planar = Mathf.Sqrt(dx * dx + dz * dz);
            previousPosition = center;

            float target;
            if (planar > TeleportDistance)
            {
                // Clear existing crawl as well as rejecting new energy.
                moveBlend = 0f; celebrateClock = -1f;
                target = 0f;
            }
            else
            {
                var speed = Mathf.Min(planar / dt, MaxSpeed);
                target = Mathf.Clamp01(speed / FullCrawlSpeed);
            }

            EaseClocks(dt, target);
            ApplyWeights();
        }

        void EaseClocks(float dt, float target)
        {
            moveBlend = Mathf.MoveTowards(moveBlend, target, BlendRate * dt);
            breathePhase = Wrap(breathePhase + TwoPi * BreatheHz * cadence * dt);
            // Ripple keeps a slow drift at rest so re-entry never pops; its
            // visible amplitude is gated by moveBlend in ApplyWeights.
            var activity = .25f + .75f * moveBlend;
            crawlPhase = Wrap(crawlPhase + TwoPi * CrawlHz * cadence * activity * dt);
            if (celebrateClock >= 0f)
            {
                celebrateClock += dt;
                if (celebrateClock >= CelebrateDuration)
                    celebrateClock = -1f;
            }
        }

        void ApplyWeights()
        {
            if (body == null)
                return;
            if (body.sharedMesh != cachedMesh)
                CacheIndices();
            if (cachedMesh == null)
                return;

            var ripple = moveBlend;
            var sin = Mathf.Sin(crawlPhase) * 100f * ripple;
            var cos = Mathf.Cos(crawlPhase) * 100f * ripple;
            var breathe = BreatheBase + Mathf.Sin(breathePhase) * BreatheAmp;
            var happy = 0f;
            if (celebrateClock >= 0f)
                happy = 100f * Mathf.Sin(Mathf.PI * Mathf.Clamp01(celebrateClock / CelebrateDuration));

            if (breatheIndex >= 0)
                body.SetBlendShapeWeight(breatheIndex, breathe);
            if (crawlSinIndex >= 0)
                body.SetBlendShapeWeight(crawlSinIndex, sin);
            if (crawlCosIndex >= 0)
                body.SetBlendShapeWeight(crawlCosIndex, cos);
            if (celebrateIndex >= 0)
                body.SetBlendShapeWeight(celebrateIndex, happy);
        }

        void ClearWeights()
        {
            if (body == null)
                return;
            if (body.sharedMesh != cachedMesh)
                CacheIndices();
            if (cachedMesh == null)
                return;
            if (breatheIndex >= 0)
                body.SetBlendShapeWeight(breatheIndex, 0f);
            if (crawlSinIndex >= 0)
                body.SetBlendShapeWeight(crawlSinIndex, 0f);
            if (crawlCosIndex >= 0)
                body.SetBlendShapeWeight(crawlCosIndex, 0f);
            if (celebrateIndex >= 0)
                body.SetBlendShapeWeight(celebrateIndex, 0f);
        }

        void CacheIndices()
        {
            cachedMesh = body != null ? body.sharedMesh : null;
            if (cachedMesh == null)
            {
                breatheIndex = -1;
                crawlSinIndex = -1;
                crawlCosIndex = -1;
                celebrateIndex = -1;
                return;
            }
            breatheIndex = cachedMesh.GetBlendShapeIndex(BreatheShape);
            crawlSinIndex = cachedMesh.GetBlendShapeIndex(CrawlSinShape);
            crawlCosIndex = cachedMesh.GetBlendShapeIndex(CrawlCosShape);
            celebrateIndex = cachedMesh.GetBlendShapeIndex(CelebrateShape);
        }

        static float Wrap(float phase)
        {
            return Mathf.Repeat(phase, TwoPi);
        }

        static bool IsFinite(Vector3 v)
        {
            return !float.IsNaN(v.x) && !float.IsInfinity(v.x) &&
                !float.IsNaN(v.y) && !float.IsInfinity(v.y) &&
                !float.IsNaN(v.z) && !float.IsInfinity(v.z);
        }

        static bool IsFinite(float v)
        {
            return !float.IsNaN(v) && !float.IsInfinity(v);
        }
    }
}
