using System;
using UnityEngine;

namespace GalaQuest
{
    public static class GalaQuestProtocolV4
    {
        public const int Version = 4;

        public static string Join(GalaQuestSelectedProfile profile)
        {
            return JsonUtility.ToJson(new JoinMessage
            {
                v = Version,
                type = "join",
                name = profile.DisplayName,
                guestId = profile.ProfileId
            });
        }

        public static string RestoreProfile(GalaQuestSelectedProfile profile)
        {
            return $"{{\"v\":{Version},\"type\":\"restore-profile\",\"facts\":{profile.FactsJson}}}";
        }

        public static bool TryReadWelcome(string json, out string playerId)
        {
            playerId = string.Empty;
            MessageHeader message;
            try
            {
                message = JsonUtility.FromJson<MessageHeader>(json);
            }
            catch
            {
                return false;
            }
            if (message == null || message.v != Version || message.type != "welcome"
                || string.IsNullOrEmpty(message.id)) return false;
            playerId = message.id;
            return true;
        }

        [Serializable]
        private sealed class JoinMessage
        {
            public int v;
            public string type;
            public string name;
            public string guestId;
        }

        [Serializable]
        private sealed class MessageHeader
        {
            public int v;
            public string type;
            public string id;
        }
    }
}
