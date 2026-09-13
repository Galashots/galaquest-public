using UnityEngine;

namespace GalaQuest
{
    // One screen's geometry, shared by its existing drawing and pointer owners.
    public readonly struct GalaQuestCombatHudLayout
    {
        public readonly float Scale;
        public readonly bool Narrow;
        public readonly Rect Status, Identity, Objective, Mute, Travel, Reward, Attack, Movement;

        public GalaQuestCombatHudLayout(Vector2 viewport)
        {
            Scale = Mathf.Clamp(viewport.y / 768f, .8f, 1.3f);
            Narrow = viewport.x < 700 * Scale;
            if (Narrow) Scale = Mathf.Min(Scale, viewport.x / 400f);
            var s = Scale;
            var margin = 18 * s;
            var railWidth = Narrow ? viewport.x - margin * 2 : 328 * s;
            Status = new Rect(margin, margin, railWidth, 144 * s);
            Identity = Narrow
                ? new Rect(margin, Status.yMax + 8 * s, railWidth - 110 * s, 58 * s)
                : new Rect(viewport.x - 258 * s, margin, 240 * s, 78 * s);
            Mute = new Rect(viewport.x - margin - 100 * s,
                Narrow ? Status.yMax + 8 * s : Identity.yMax + 8 * s, 100 * s, 44 * s);
            Objective = new Rect(margin, Narrow ? Identity.yMax + 10 * s : Status.yMax + 14 * s,
                railWidth, 62 * s);
            var attackSize = Mathf.Clamp(viewport.y * .18f, 96, Narrow ? 136 : 156);
            Attack = new Rect(viewport.x - margin - attackSize, viewport.y - margin - attackSize,
                attackSize, attackSize);
            var movementSize = Mathf.Min(144 * s, viewport.x * .34f);
            Movement = new Rect(margin, viewport.y - margin - movementSize, movementSize, movementSize);
            var travelWidth = Mathf.Min(260 * s, viewport.x - margin * 2);
            Travel = new Rect((viewport.x - travelWidth) * .5f,
                Narrow ? Mathf.Min(Attack.y, Movement.y) - 72 * s : viewport.y - 84 * s,
                travelWidth, 58 * s);
            var rewardWidth = Mathf.Min(370 * s, viewport.x - margin * 2);
            Reward = new Rect((viewport.x - rewardWidth) * .5f, Travel.y - 110 * s, rewardWidth, 98 * s);
        }

        public static Rect ToTouch(Rect gui, Vector2 viewport)
        { gui.y = viewport.y - gui.yMax; return gui; }

        public bool CoversStatus(Rect rect) => rect.Overlaps(Status) || rect.Overlaps(Identity)
            || rect.Overlaps(Objective) || rect.Overlaps(Mute);
    }
}
