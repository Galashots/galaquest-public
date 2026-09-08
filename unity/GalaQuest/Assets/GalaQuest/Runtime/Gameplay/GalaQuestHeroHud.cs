using System.Collections.Generic;
using UnityEngine;

namespace GalaQuest
{
    public sealed class GalaQuestHeroHud : MonoBehaviour
    {
        private readonly Queue<GalaQuestProgressionView> rewards = new Queue<GalaQuestProgressionView>();
        private GalaQuestProgressionView reward;
        private float rewardUntil;
        private GUIStyle small;
        private GUIStyle title;
        private GUIStyle number;
        private GUIStyle centered;
        private static readonly Color Panel = new Color(.065f, .10f, .12f, .94f);
        private static readonly Color Ink = new Color(.95f, .94f, .86f);
        private static readonly Color Gold = new Color(1f, .77f, .32f);
        private static readonly Color Health = new Color(.29f, .80f, .47f);
        private static readonly Color Experience = new Color(.35f, .76f, .92f);

        public void PresentReward(GalaQuestProgressionView value)
        {
            if (!value.leveledUp && value.gainedXp == 0 && value.gainedCoins == 0 && value.gainedMarks == 0) return;
            // A level-up keeps its readable moment while later small gains wait their turn.
            if (rewards.Count < 8) rewards.Enqueue(value);
        }

        public void Draw(string profileName, string place, string connectionStatus,
            GalaQuestProfileProgression progression, GalaQuestCombatPresentation combat, bool connected)
        {
            if (Event.current.type != EventType.Repaint) return;
            EnsureStyles();
            var oldMatrix = GUI.matrix;
            // Keep the existing top-left identity convention, group health and XP, and leave
            // the combat centre / bottom touch controls clear. Reference rationale is in the checkpoint.
            var scale = Mathf.Clamp(Screen.height / 600f, .85f, 1.35f);
            GUI.matrix = Matrix4x4.TRS(Vector3.zero, Quaternion.identity, Vector3.one * scale);
            var width = Screen.width / scale;
            var state = progression?.State;
            var hp = combat != null ? combat.LocalHealth : 0;
            var maxHp = combat != null ? combat.LocalMaxHealth : 0;
            var panel = new Rect(16, 16, Mathf.Min(316, width - 32), state == null ? 84 : 130);
            Fill(panel, Panel);
            Fill(new Rect(panel.x, panel.y, 3, panel.height), Gold);
            Text(new Rect(30, 23, panel.width - 30, 19), place, small, Experience);
            Text(new Rect(30, 43, panel.width - 30, 27), profileName, title, Ink);
            if (state != null)
            {
                Text(new Rect(30, 76, 116, 26), "LEVEL " + state.level, title, Ink);
                Text(new Rect(157, 70, 146, 18), "POWER", small, Gold);
                Text(new Rect(157, 87, 152, 27), state.powerText, number, Gold);
                Bar(new Rect(30, 107, 112, 17), maxHp > 0 ? hp / (float)maxHp : 0, Health);
                Text(new Rect(30, 105, 112, 20), maxHp > 0 ? hp + " / " + maxHp : "...", centered, Ink);
                Bar(new Rect(30, 131, panel.width - 28, 5), (float)(state.xpIntoLevel / (double)state.xpForLevel), Experience);
                Text(new Rect(157, 115, 152, 17), "XP " + state.xpIntoLevel + " / " + state.xpForLevel, small, Experience);
            }
            if (!connected || !string.IsNullOrEmpty(progression?.Error))
            {
                var status = progression?.Error ?? connectionStatus;
                var rect = new Rect(16, panel.yMax + 8, Mathf.Min(400, width - 32), 55);
                Fill(rect, Panel);
                Text(new Rect(rect.x + 12, rect.y + 5, rect.width - 24, 45), status, small, Ink);
            }
            DrawReward(width, panel.yMax + 16);
            GUI.matrix = oldMatrix;
        }

        private void DrawReward(float width, float belowPanel)
        {
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
            var panelWidth = Mathf.Min(370, width - 32);
            var x = width >= 960 ? (width - panelWidth) * .5f + 54 : 16;
            var y = width >= 960 ? 18 : belowPanel;
            var height = reward.leveledUp ? 124 : 64;
            var rect = new Rect(x, y, panelWidth, height);
            Fill(rect, Panel);
            Fill(new Rect(x, y, panelWidth, 3), reward.leveledUp ? Gold : Experience);
            if (reward.leveledUp)
            {
                Text(new Rect(x + 15, y + 12, panelWidth - 30, 29), "LEVEL " + reward.level + "!", number, Gold);
                Text(new Rect(x + 15, y + 46, panelWidth - 30, 25),
                    "POWER " + reward.previousPowerText + "  →  " + reward.powerText + "  (" + reward.powerDeltaText + ")", title, Ink);
                Text(new Rect(x + 15, y + 76, panelWidth - 30, 22),
                    "+" + (reward.maxHp - reward.previousMaxHp) + " health    +" + (reward.heroDamage - reward.previousDamage) + " damage", small, Ink);
            }
            else Text(new Rect(x + 15, y + 14, panelWidth - 30, 29), EarnedText(reward), title, Experience);
        }

        private static string EarnedText(GalaQuestProgressionView value)
        {
            var parts = new List<string>(3);
            if (value.gainedXp > 0) parts.Add("+" + value.gainedXp + " XP");
            if (value.gainedCoins > 0) parts.Add("+" + value.gainedCoins + " coins");
            if (value.gainedMarks > 0) parts.Add("+" + value.gainedMarks + " marks");
            return string.Join("   ", parts);
        }

        private void EnsureStyles()
        {
            if (small != null) return;
            small = new GUIStyle(GUI.skin.label) { fontSize = 13, wordWrap = true, richText = false };
            title = new GUIStyle(small) { fontSize = 18, fontStyle = FontStyle.Bold, wordWrap = false };
            number = new GUIStyle(title) { fontSize = 24 };
            centered = new GUIStyle(small) { alignment = TextAnchor.MiddleCenter, fontStyle = FontStyle.Bold };
        }

        private static void Text(Rect rect, string text, GUIStyle style, Color color)
        {
            style.normal.textColor = color;
            GUI.Label(rect, text ?? string.Empty, style);
        }

        private static void Bar(Rect rect, float fraction, Color color)
        {
            Fill(rect, new Color(.02f, .035f, .045f, 1));
            rect.width *= Mathf.Clamp01(fraction);
            Fill(rect, color);
        }

        private static void Fill(Rect rect, Color color)
        {
            var previous = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = previous;
        }
    }
}
