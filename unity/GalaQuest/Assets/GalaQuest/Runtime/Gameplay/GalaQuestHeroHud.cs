using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest
{
    public sealed class GalaQuestHeroHud : MonoBehaviour
    {
        private readonly Queue<GalaQuestProgressionView> rewards = new Queue<GalaQuestProgressionView>();
        private GalaQuestProgressionView reward;
        private float rewardUntil;
        private bool rewardDeferred;
        private float rewardDeferredAt;

        public void PresentReward(GalaQuestProgressionView value)
        {
            if (!value.leveledUp && value.gainedXp == 0 && value.gainedCoins == 0 && value.gainedMarks == 0) return;
            if (rewards.Count < 8) rewards.Enqueue(value);
        }

        public void Draw(string profileName, string place, string connectionStatus,
            GalaQuestProfileProgression progression, GalaQuestCombatPresentation combat, bool connected)
        {
            if (Event.current.type != EventType.Repaint) return;
            var layout = new GalaQuestCombatHudLayout(new Vector2(Screen.width, Screen.height));
            var s = layout.Scale;
            var compact = layout.Narrow;
            var r = layout.Status;
            var state = progression?.State;
            var hp = combat != null ? combat.LocalHealth : 0;
            var maxHp = combat != null ? combat.LocalMaxHealth : 0;
            GalaQuestCombatHudStyle.Panel(r, lit: true);
            var x = r.x + 12 * s;
            var width = r.width - 24 * s;
            GalaQuestCombatHudStyle.Text(new Rect(x, r.y + (compact ? 4 : 10) * s, 38 * s, (compact ? 24 : 30) * s), "HP", 18 * s,
                GalaQuestCombatHudStyle.Ink, true);
            var health = new Rect(x + 40 * s, r.y + (compact ? 6 : 12) * s, width - 40 * s, (compact ? 22 : 30) * s);
            GalaQuestCombatHudStyle.Bar(health, maxHp > 0 ? hp / (float)maxHp : 0, GalaQuestCombatHudStyle.Red);
            GalaQuestCombatHudStyle.Text(health, maxHp > 0 ? hp + " / " + maxHp : "Waiting for health", 20 * s,
                GalaQuestCombatHudStyle.Ink, true, TextAnchor.MiddleCenter);
            var xp = new Rect(x + 72 * s, r.y + (compact ? 32 : 55) * s, width - 72 * s, (compact ? 20 : 23) * s);
            GalaQuestCombatHudStyle.Text(new Rect(x, r.y + (compact ? 29 : 49) * s, 72 * s, (compact ? 24 : 30) * s),
                state != null ? "LV " + state.level : "LV --", 19 * s, GalaQuestCombatHudStyle.Gold, true);
            GalaQuestCombatHudStyle.Bar(xp, state != null && state.xpForLevel > 0
                ? (float)(state.xpIntoLevel / (double)state.xpForLevel) : 0, GalaQuestCombatHudStyle.Teal);
            GalaQuestCombatHudStyle.Text(xp, state != null ? state.xpIntoLevel + " / " + state.xpForLevel + " XP"
                : "Progression unavailable", 13 * s, GalaQuestCombatHudStyle.Ink, true, TextAnchor.MiddleCenter);
            GalaQuestCombatHudStyle.Fill(new Rect(x, r.y + (compact ? 56 : 88) * s, width, 1), new Color(.36f, .27f, .13f));
            GalaQuestCombatHudStyle.Text(new Rect(x, r.y + (compact ? 58 : 96) * s, 100 * s, (compact ? 25 : 31) * s), "POWER", (compact ? 18 : 21) * s,
                GalaQuestCombatHudStyle.Gold, true);
            GalaQuestCombatHudStyle.Text(new Rect(x + 102 * s, r.y + (compact ? 57 : 92) * s, width - 102 * s, (compact ? 27 : 39) * s),
                state?.powerText ?? "--", (compact ? 24 : 30) * s, GalaQuestCombatHudStyle.Gold, true, TextAnchor.MiddleRight);

            r = layout.Identity;
            GalaQuestCombatHudStyle.Panel(r);
            GalaQuestCombatHudStyle.Text(new Rect(r.x + 10 * s, r.y + 3 * s, r.width - 20 * s, (compact ? 36 : 42) * s),
                profileName, (compact ? 14 : 18) * s, GalaQuestCombatHudStyle.Ink, true, TextAnchor.UpperLeft, true);
            var resources = state == null ? place : "Coins " + state.coins + "   Marks " + state.marks + "   Shards " + state.shards;
            GalaQuestCombatHudStyle.Text(new Rect(r.x + 10 * s, r.y + (compact ? 39 : 47) * s, r.width - 20 * s, r.height - (compact ? 41 : 49) * s),
                resources, (compact ? 12 : 13) * s, GalaQuestCombatHudStyle.Gold, wrap: true);

            if (!connected || !string.IsNullOrEmpty(progression?.Error))
            {
                var status = progression?.Error ?? connectionStatus;
                var notice = new Rect(layout.Objective.x, layout.Objective.yMax + 8 * s, layout.Objective.width, 52 * s);
                GalaQuestCombatHudStyle.Panel(notice);
                GalaQuestCombatHudStyle.Text(GalaQuestCombatHudStyle.Inset(notice, 8 * s), status, 15 * s,
                    GalaQuestCombatHudStyle.Ink, wrap: true);
            }
            DrawReward(layout);
        }

        private void DrawReward(GalaQuestCombatHudLayout layout)
        {
            // The physical task keeps priority over queued reward ceremonies. In
            // portrait they share the clear band above travel; retain the ceremony
            // and its remaining duration until the player leaves the station.
            if (GetComponent<GalaQuestRuneForgePresenter>()?.IsNear == true)
            {
                if (!rewardDeferred) { rewardDeferred = true; rewardDeferredAt = Time.unscaledTime; }
                return;
            }
            if (rewardDeferred)
            {
                if (reward != null) rewardUntil += Time.unscaledTime - rewardDeferredAt;
                rewardDeferred = false;
            }
            if (Time.unscaledTime >= rewardUntil)
            {
                reward = rewards.Count > 0 ? rewards.Dequeue() : null;
                if (reward != null)
                {
                    rewardUntil = Time.unscaledTime + (reward.leveledUp ? 5.5f : 2.8f);
                    if (reward.leveledUp) GetComponent<GalaQuestCombatAudio>()?.PlayVictory();
                }
            }
            if (reward == null) return;
            var r = layout.Reward;
            var s = layout.Scale;
            GalaQuestCombatHudStyle.Panel(r, lit: reward.leveledUp);
            if (reward.leveledUp)
            {
                GalaQuestCombatHudStyle.Text(new Rect(r.x + 12 * s, r.y + 5 * s, r.width - 24 * s, 30 * s),
                    "LEVEL " + reward.level + "!", 25 * s, GalaQuestCombatHudStyle.Gold, true, TextAnchor.MiddleCenter);
                GalaQuestCombatHudStyle.Text(new Rect(r.x + 12 * s, r.y + 37 * s, r.width - 24 * s, 26 * s),
                    "POWER " + reward.previousPowerText + " to " + reward.powerText + " (" + reward.powerDeltaText + ")",
                    17 * s, GalaQuestCombatHudStyle.Ink, true, TextAnchor.MiddleCenter);
                GalaQuestCombatHudStyle.Text(new Rect(r.x + 12 * s, r.y + 65 * s, r.width - 24 * s, 25 * s),
                    "+" + (reward.maxHp - reward.previousMaxHp) + " health    +" + (reward.heroDamage - reward.previousDamage) + " damage",
                    14 * s, GalaQuestCombatHudStyle.Ink, align: TextAnchor.MiddleCenter);
            }
            else
            {
                GalaQuestCombatHudStyle.Text(new Rect(r.x + 12 * s, r.y + 9 * s, r.width - 24 * s, 24 * s),
                    "EARNED", 14 * s, GalaQuestCombatHudStyle.Gold, true, TextAnchor.MiddleCenter);
                GalaQuestCombatHudStyle.Text(new Rect(r.x + 12 * s, r.y + 34 * s, r.width - 24 * s, 48 * s),
                    EarnedText(reward), 20 * s, GalaQuestCombatHudStyle.Ink, true, TextAnchor.MiddleCenter, true);
            }
        }

        private static string EarnedText(GalaQuestProgressionView value)
        {
            var parts = new List<string>(3);
            if (value.gainedXp > 0) parts.Add("+" + value.gainedXp + " XP");
            if (value.gainedCoins > 0) parts.Add("+" + value.gainedCoins + " coins");
            if (value.gainedMarks > 0) parts.Add("+" + value.gainedMarks + " marks");
            return string.Join("   ", parts);
        }

        private void OnDestroy() => GalaQuestCombatHudStyle.Release();
    }
}
