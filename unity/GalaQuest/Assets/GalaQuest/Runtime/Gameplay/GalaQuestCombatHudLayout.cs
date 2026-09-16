using UnityEngine;

namespace GalaQuest
{
    // One screen's geometry, shared by its existing drawing and pointer owners.
    public readonly struct GalaQuestCombatHudLayout
    {
        public readonly float Scale;
        public readonly bool Narrow;
        public readonly Rect Status, Identity, Objective, Mute, Travel, Reward, Attack, Special, Movement;

        public GalaQuestCombatHudLayout(Vector2 viewport)
        {
            Scale = Mathf.Clamp(viewport.y / 768f, .8f, 1.3f);
            Narrow = viewport.x < 700 * Scale;
            if (Narrow) Scale = Mathf.Min(Scale, viewport.x / 400f);
            var s = Scale;
            var margin = 18 * s;
            var railWidth = Narrow ? viewport.x - margin * 2 : 328 * s;
            // Portrait keeps the same three truthful status rows, with less vertical
            // padding, so contextual Forge text clears the ordinary approach Hero.
            Status = new Rect(margin, margin, railWidth, (Narrow ? 90 : 144) * s);
            Identity = Narrow
                ? new Rect(margin, Status.yMax + 8 * s, railWidth - 110 * s, 64 * s)
                : new Rect(viewport.x - 258 * s, margin, 240 * s, 78 * s);
            Mute = new Rect(viewport.x - margin - 100 * s,
                Narrow ? Status.yMax + 8 * s : Identity.yMax + 8 * s, 100 * s, 44 * s);
            Objective = new Rect(margin, Narrow ? Identity.yMax + 10 * s : Status.yMax + 14 * s,
                railWidth, 62 * s);
            var attackSize = Mathf.Clamp(viewport.y * .18f, 96, Narrow ? 136 : 156);
            Attack = new Rect(viewport.x - margin - attackSize, viewport.y - margin - attackSize,
                attackSize, attackSize);
            var specialSize = attackSize * .48f;
            // Keep the compact special beside the ordinary attack in the bottom rail. In portrait,
            // the band above the attack belongs to Forge/travel context and must remain readable.
            Special = new Rect(Attack.x - specialSize - 10 * s,
                Attack.y + Attack.height - specialSize, specialSize, specialSize);
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

        public Rect PlaceEngagedNameplate(Rect rect, Vector2 viewport)
        {
            var original = rect;
            var best = rect;
            var distance = float.PositiveInfinity;
            for (var i = 0; i < 4; i++)
            {
                var obstacle = i == 0 ? Status : i == 1 ? Identity : i == 2 ? Objective : Mute;
                if (!original.Overlaps(obstacle)) continue;
                for (var side = 0; side < 4; side++)
                {
                    var candidate = original;
                    if (side == 0) candidate.x = obstacle.xMax + 8 * Scale;
                    else if (side == 1) candidate.x = obstacle.xMin - original.width - 8 * Scale;
                    else if (side == 2) candidate.y = obstacle.yMax + 8 * Scale;
                    else candidate.y = obstacle.yMin - original.height - 8 * Scale;
                    if (candidate.xMin < 0 || candidate.yMin < 0 || candidate.xMax > viewport.x
                        || candidate.yMax > viewport.y || CoversStatus(candidate)) continue;
                    var delta = (candidate.center - original.center).sqrMagnitude;
                    if (delta < distance) { best = candidate; distance = delta; }
                }
            }
            return best;
        }
    }
}
