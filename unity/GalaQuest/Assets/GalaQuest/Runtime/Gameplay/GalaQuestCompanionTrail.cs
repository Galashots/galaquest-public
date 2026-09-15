using UnityEngine;

namespace GalaQuest
{
    // Pure trail follower. No scene, no MonoBehaviour, no network.
    // Ring of waypoints always lies AHEAD of the follower. Position is the follower;
    // head is the next corner/point to walk toward, tail is the newest owner sample.
    public sealed class GalaQuestCompanionTrail
    {
        public const float FollowDistance = 1f;
        public const float MaxSpeed = 6f;
        public const float MaxDt = .1f;
        public const int MaxSamples = 128;
        public const float TeleportDistance = 6f;

        private readonly Vector3[] _points = new Vector3[MaxSamples]; // ring, head..tail order
        private int _head;   // index of first unconsumed waypoint
        private int _count;  // number of queued points (0..MaxSamples)

        private Vector3 _position;
        private Vector3 _facing;
        private Vector3 _previousOwner;
        private float _remaining;
        private bool _needsReset;
        private bool _initialized;

        public Vector3 Position => _position;
        public Vector3 Facing => _facing;
        private bool _moving;
        public bool Moving => _moving;
        public int SampleCount => _count;
        public bool NeedsReset => _needsReset;

        public GalaQuestCompanionTrail(Vector3 ownerPosition, Vector3 ownerForward)
        {
            var ok = IsFinite(ownerPosition) && IsFinite(ownerForward);
            var fwd = ok ? Flat(ownerForward) : Vector3.forward;
            if (!ok || fwd.sqrMagnitude < 1e-8f) fwd = Vector3.forward;

            if (ok)
            {
                Reset(ownerPosition, fwd);
            }
            else
            {
                // Finite safe default; no queue, quiet state.
                _position = Vector3.zero;
                _facing = Vector3.forward;
                _previousOwner = Vector3.zero;
                _head = 0;
                _count = 0;
                _remaining = 0f;
                _needsReset = false;
                _initialized = true;
            }
        }

        public void Reset(Vector3 ownerPosition, Vector3 ownerForward)
        {
            if (!IsFinite(ownerPosition) || !IsFinite(ownerForward))
            {
                if (_initialized) return; // invalid reset after initial state leaves it untouched
                ownerPosition = Vector3.zero;
                ownerForward = Vector3.forward;
            }

            var fwd = Flat(ownerForward);
            if (fwd.sqrMagnitude < 1e-8f) fwd = Vector3.forward;
            fwd.Normalize();

            _facing = fwd;
            _position = Flat(ownerPosition) - fwd * FollowDistance;
            _position.y = ownerPosition.y;

            _head = 0;
            _count = 0;
            PushTail(Flat(ownerPosition));

            _moving = false;
            _remaining = FollowDistance; // follower -> owner sample distance along route
            _previousOwner = ownerPosition;
            _needsReset = false;
            _initialized = true;
        }

        // Returns the new follower position.
        public Vector3 Step(Vector3 ownerPosition, float dt) => Step(ownerPosition, _facing, dt);

        public Vector3 Step(Vector3 ownerPosition, Vector3 ownerForward, float dt)
        {
            if (!IsFinite(ownerPosition) || !IsFinite(ownerForward) || !IsFinite(dt)) return _position;
            _moving = false;
            var before = Flat(_position);
            if (_needsReset) { _previousOwner = ownerPosition; return _position; }

            var flat = Flat(ownerPosition);

            if (_count > 0)
            {
                var delta = flat - Flat(_previousOwner);
                if (delta.magnitude > TeleportDistance)
                {
                    Reset(ownerPosition, ownerForward);
                    return _position;
                }
            }

            // Append owner to tail (merge collinear, skip exact dup).
            if (_count == 0 || (flat - Tail()).sqrMagnitude > 1e-10f)
            {
                if (_count < MaxSamples)
                {
                    PushTail(flat);
                    MergeTail();
                }
                else
                {
                    // Cannot represent the new meaningful corner; hold safely, flag.
                    _needsReset = true;
                    _previousOwner = ownerPosition;
                    return _position;
                }
            }

            _previousOwner = ownerPosition;
            _position.y = ownerPosition.y;

            RecomputeRemaining();

            var budget = Mathf.Min(MaxSpeed * Mathf.Clamp(dt, 0f, MaxDt), Mathf.Max(0f, _remaining - FollowDistance));

            while (budget > 1e-6f && _count > 0)
            {
                var target = Head();
                var to = target - _position;
                to.y = 0f;
                var dist = to.magnitude;

                if (dist < 1e-5f)
                {
                    PopHead();
                    RecomputeRemaining();
                    continue;
                }

                var dir = to / dist;

                if (budget >= dist)
                {
                    _position = target;
                    budget -= dist;
                    PopHead();
                    RecomputeRemaining();
                    if (_count == 0) break;
                }
                else
                {
                    _position += dir * budget;
                    budget = 0f;
                }

                // Rotate only when actively traversing a segment.
                var flatFacing = Flat(_facing);
                if (flatFacing.sqrMagnitude < 1e-8f || Angle(dir, flatFacing.normalized) > 1e-4f)
                {
                    _facing = dir;
                }
            }

            _position.y = ownerPosition.y;
            RecomputeRemaining();
            _moving = (Flat(_position) - before).sqrMagnitude > 1e-10f;
            return _position;
        }

        private void RecomputeRemaining()
        {
            if (_count == 0) { _remaining = 0f; return; }
            var total = Flat(_position - Head()).magnitude;
            for (var i = 0; i < _count - 1; i++)
            {
                total += (PointAt(i + 1) - PointAt(i)).magnitude;
            }
            _remaining = total;
        }

        // Merge only when the last two segments are collinear AND same direction.
        private void MergeTail()
        {
            if (_count < 3) return;
            var a = PointAt(_count - 3);
            var b = PointAt(_count - 2);
            var c = PointAt(_count - 1);
            var ab = Flat(b - a);
            var bc = Flat(c - b);
            if (ab.sqrMagnitude < 1e-10f || bc.sqrMagnitude < 1e-10f) return;
            if (Angle(ab.normalized, bc.normalized) > 1e-4f) return;
            SetPointAt(_count - 2, c);
            _count--;
        }

        private Vector3 Head() => PointAt(0);
        private Vector3 Tail() => PointAt(_count - 1);

        private void PopHead()
        {
            if (_count <= 0) return;
            _head = (_head + 1) % MaxSamples;
            _count--;
        }

        private void PushTail(Vector3 p)
        {
            var idx = (_head + _count) % MaxSamples;
            _points[idx] = p;
            _count++;
        }

        private Vector3 PointAt(int i) => _points[(_head + i) % MaxSamples];

        private void SetPointAt(int i, Vector3 v) => _points[(_head + i) % MaxSamples] = v;

        private static Vector3 Flat(Vector3 v) => new Vector3(v.x, 0f, v.z);

        private static bool IsFinite(Vector3 v) => IsFinite(v.x) && IsFinite(v.y) && IsFinite(v.z);

        private static bool IsFinite(float f) => !float.IsNaN(f) && !float.IsInfinity(f);

        private static float Angle(Vector3 a, Vector3 b)
        {
            var d = Mathf.Clamp(Vector3.Dot(a, b), -1f, 1f);
            return Mathf.Acos(d);
        }
    }
}
