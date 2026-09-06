using UnityEngine;

namespace GalaQuest
{
    /// <summary>Unity reproduction of the live JavaScript movement and reconciliation law.</summary>
    public static class GalaQuestMovementLaw
    {
        public const float WalkSpeed = 1.7f;
        public const float RunSpeed = 3.6f;
        public const float RunDeflection = 0.62f;
        public const float RunThresholdFraction = 3f / 7f;
        public const float RunThreshold = WalkSpeed + ((RunSpeed - WalkSpeed) * RunThresholdFraction);
        public const float InputSendHz = 15f;
        public const float MaxPredictionStepSeconds = 0.25f;
        public const float MaxPredictionBacklogSeconds = 1f;
        public const float SnapDriftUnits = 0.6f;
        public const float NudgeFraction = 0.1f;

        public static float GroundSpeedForInput(float magnitude, bool run)
        {
            var push = Mathf.Min(magnitude, 1f);
            if (!(push > 0f)) return 0f;
            if (!run) return Mathf.Min(push / RunDeflection, 1f) * WalkSpeed;
            var over = (push - RunDeflection) / (1f - RunDeflection);
            return WalkSpeed + Mathf.Clamp01(over) * (RunSpeed - WalkSpeed);
        }

        public static PredictionBudget PredictionStep(
            float rawDeltaSeconds,
            float backlogSeconds,
            bool moving,
            bool wasMoving)
        {
            var raw = rawDeltaSeconds > 0f ? rawDeltaSeconds : 0f;
            if (!moving) return new PredictionBudget(Mathf.Min(raw, MaxPredictionStepSeconds), 0f);
            var credited = wasMoving ? Mathf.Min(raw, MaxPredictionBacklogSeconds) : 0f;
            var budget = Mathf.Min(credited + backlogSeconds, MaxPredictionBacklogSeconds);
            var delta = Mathf.Min(budget, MaxPredictionStepSeconds);
            return new PredictionBudget(delta, budget - delta);
        }

        public static ReconciliationResult Reconcile(
            Vector2 predicted,
            Vector2 authoritative,
            int corrections = 1)
        {
            corrections = Mathf.Max(corrections, 0);
            var drift = Vector2.Distance(predicted, authoritative);
            if (corrections == 0 || drift == 0f)
                return new ReconciliationResult(predicted, drift, false, corrections);
            if (drift > SnapDriftUnits)
                return new ReconciliationResult(authoritative, drift, true, corrections);
            var fraction = 1f - Mathf.Pow(1f - NudgeFraction, corrections);
            return new ReconciliationResult(Vector2.LerpUnclamped(predicted, authoritative, fraction), drift, false, corrections);
        }

        public readonly struct PredictionBudget
        {
            public PredictionBudget(float deltaSeconds, float backlogSeconds)
            {
                DeltaSeconds = deltaSeconds;
                BacklogSeconds = backlogSeconds;
            }

            public float DeltaSeconds { get; }
            public float BacklogSeconds { get; }
        }

        public readonly struct ReconciliationResult
        {
            public ReconciliationResult(Vector2 position, float drift, bool snapped, int corrections)
            {
                Position = position;
                Drift = drift;
                Snapped = snapped;
                Corrections = corrections;
            }

            public Vector2 Position { get; }
            public float Drift { get; }
            public bool Snapped { get; }
            public int Corrections { get; }
        }
    }
}
