using System;
using UnityEngine;
using UnityEngine.InputSystem;

namespace GalaQuest
{
    public sealed class GalaQuestTraversalController : MonoBehaviour
    {
        [SerializeField] private InputActionAsset inputActions;
        [SerializeField] private Transform hero;

        private GalaQuestConnectionSession session;
        private InputAction moveAction;
        private InputAction sprintAction;
        private Vector2 predicted;
        private Vector2 authoritative;
        private float heroY;
        private float predictionBacklog;
        private bool wasMoving;
        private bool hasAuthoritativePosition;
        private int pendingSnapshots;

        public Vector2 PredictedPosition => predicted;
        public Vector2 AuthoritativePosition => authoritative;
        public float LastDrift { get; private set; }
        public bool LastReconciliationSnapped { get; private set; }

        public void Configure(InputActionAsset actions, Transform heroTransform)
        {
            inputActions = actions;
            hero = heroTransform;
            if (hero != null)
            {
                heroY = hero.position.y;
                predicted = GalaQuestServerCoordinates.ToServerPosition(hero.position);
            }
            CacheActions();
        }

        public void BindSession(GalaQuestConnectionSession connectionSession)
        {
            if (session != null) session.ServerFrameReceived -= ApplyServerFrame;
            session = connectionSession;
            if (session != null) session.ServerFrameReceived += ApplyServerFrame;
        }

        private void Awake()
        {
            if (hero != null)
            {
                heroY = hero.position.y;
                predicted = GalaQuestServerCoordinates.ToServerPosition(hero.position);
            }
            CacheActions();
        }

        private void OnEnable()
        {
            CacheActions();
            moveAction?.Enable();
            sprintAction?.Enable();
        }

        private void OnDisable()
        {
            moveAction?.Disable();
            sprintAction?.Disable();
        }

        private void OnDestroy()
        {
            if (session != null) session.ServerFrameReceived -= ApplyServerFrame;
        }

        private void CacheActions()
        {
            if (inputActions == null) return;
            var player = inputActions.FindActionMap("Player", false);
            moveAction = player?.FindAction("Move", false);
            sprintAction = player?.FindAction("Sprint", false);
        }

        private void Update()
        {
            var raw = moveAction?.ReadValue<Vector2>() ?? Vector2.zero;
            var magnitude = Mathf.Clamp01(raw.magnitude);
            var direction = magnitude > 0f ? raw.normalized : Vector2.zero;
            var run = sprintAction?.IsPressed() == true;
            session?.TrySendMovementIntent(direction, magnitude, run, Time.unscaledTime);
            StepPrediction(direction, magnitude, run, Time.unscaledDeltaTime);
            ApplyPendingReconciliation();
        }

        public void StepPrediction(Vector2 direction, float magnitude, bool run, float rawDeltaSeconds)
        {
            if (hero == null || session == null || string.IsNullOrEmpty(session.PlayerId)) return;
            magnitude = Mathf.Clamp01(magnitude);
            var moving = magnitude > 0f && direction.sqrMagnitude > 0f;
            direction = moving ? direction.normalized : Vector2.zero;
            var budget = GalaQuestMovementLaw.PredictionStep(rawDeltaSeconds, predictionBacklog, moving, wasMoving);
            predictionBacklog = budget.BacklogSeconds;
            if (moving)
            {
                var speed = GalaQuestMovementLaw.GroundSpeedForInput(magnitude, run);
                predicted += direction * (speed * budget.DeltaSeconds);
                predicted = GalaQuestEmberworksMovementWorld.Clamp(predicted);
                hero.rotation = GalaQuestServerCoordinates.ToUnityHeading(Mathf.Atan2(direction.x, direction.y));
            }
            wasMoving = moving;
            PresentPrediction();
        }

        public void ApplyServerFrame(GalaQuestServerFrame frame)
        {
            if (frame == null || frame.players == null || session == null || string.IsNullOrEmpty(session.PlayerId)) return;
            GalaQuestServerPlayer self = null;
            foreach (var player in frame.players)
            {
                if (player != null && player.id == session.PlayerId)
                {
                    self = player;
                    break;
                }
            }
            if (self == null) return;
            authoritative = new Vector2(self.x, self.z);
            if (!hasAuthoritativePosition || frame.type == "welcome")
            {
                predicted = authoritative;
                hasAuthoritativePosition = true;
                pendingSnapshots = 0;
                LastDrift = 0f;
                LastReconciliationSnapped = false;
                PresentPrediction();
                GalaQuestBrowserInterop.RecordMovement(
                    predicted.x, predicted.y, authoritative.x, authoritative.y, 0f, false);
                return;
            }
            pendingSnapshots += 1;
        }

        public GalaQuestMovementLaw.ReconciliationResult ApplyPendingReconciliation()
        {
            var result = GalaQuestMovementLaw.Reconcile(predicted, authoritative, pendingSnapshots);
            if (pendingSnapshots == 0) return result;
            pendingSnapshots = 0;
            predicted = GalaQuestEmberworksMovementWorld.Clamp(result.Position);
            LastDrift = result.Drift;
            LastReconciliationSnapped = result.Snapped;
            PresentPrediction();
            GalaQuestBrowserInterop.RecordMovement(
                predicted.x,
                predicted.y,
                authoritative.x,
                authoritative.y,
                result.Drift,
                result.Snapped);
            return result;
        }

        private void PresentPrediction()
        {
            if (hero != null) hero.position = GalaQuestServerCoordinates.ToUnityPosition(predicted, heroY);
        }
    }
}
