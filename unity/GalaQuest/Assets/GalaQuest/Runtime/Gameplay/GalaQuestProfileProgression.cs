using System;
using UnityEngine;
using UnityEngine.Scripting;

namespace GalaQuest
{
    [Preserve]
    public sealed class GalaQuestProfileProgression : MonoBehaviour
    {
        private GalaQuestConnectionSession session;
        private string profileId;
        public GalaQuestProgressionView State { get; private set; }
        public string Error { get; private set; }
        public event Action<GalaQuestProgressionView> Changed;

        public void BindSession(GalaQuestConnectionSession value, string selectedProfileId)
        {
            if (session != null) session.AcceptedServerMessage -= ApplyMessage;
            session = value;
            profileId = selectedProfileId;
            State = null;
            Error = null;
            if (session != null) session.AcceptedServerMessage += ApplyMessage;
        }

        private void ApplyMessage(string message)
        {
            GalaQuestBrowserInterop.ApplyProgressionFrame(gameObject.name, nameof(OnBrowserProgression),
                profileId, session.PlayerId, message);
        }

        [Preserve]
        public void OnBrowserProgression(string payload)
        {
            if (session == null) return;
            GalaQuestProgressionView value;
            try { value = JsonUtility.FromJson<GalaQuestProgressionView>(payload); }
            catch (Exception exception) { Error = exception.Message; return; }
            if (value == null || value.profileId != profileId) return;
            if (value.status != "ok") { Error = value.error ?? "Progress could not be saved on this device."; return; }
            if (value.level < 1 || value.xp < 0 || value.xpForLevel <= 0 || value.maxHp <= 0
                || value.heroDamage <= 0 || string.IsNullOrEmpty(value.factsJson))
            { Error = "The profile returned incomplete progression."; return; }
            session.RefreshProfileJournal(profileId, value.factsJson);
            State = value;
            Error = null;
            Changed?.Invoke(value);
        }

        private void OnDestroy() => BindSession(null, null);
    }

    [Serializable]
    public sealed class GalaQuestProgressionView
    {
        public string status;
        public string profileId;
        public string factsJson;
        public string error;
        public long xp;
        public int level;
        public long xpIntoLevel;
        public long xpForLevel;
        public double power;
        public string powerText;
        public string previousPowerText;
        public string powerDeltaText;
        public int maxHp;
        public int heroDamage;
        public int coins;
        public int marks;
        public int shards;
        public long gainedXp;
        public int gainedCoins;
        public int gainedMarks;
        public bool leveledUp;
        public int previousLevel;
        public int previousMaxHp;
        public int previousDamage;
        public double previousPower;
    }
}
