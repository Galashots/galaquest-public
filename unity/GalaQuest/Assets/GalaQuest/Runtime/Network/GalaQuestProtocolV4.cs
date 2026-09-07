using System;
using UnityEngine;

namespace GalaQuest
{
    public static class GalaQuestProtocolV4
    {
        public const int Version = 4;
        public const string EmberworksDeepDestinationId = "emberworks-deep";

        public static string Join(GalaQuestSelectedProfile profile)
        {
            return JsonUtility.ToJson(new JoinMessage
            {
                v = Version,
                type = "join",
                name = profile.DisplayName,
                guestId = profile.ProfileId,
                destinationId = EmberworksDeepDestinationId
            });
        }

        public static string Input(int sequence, float directionX, float directionZ, float magnitude, bool run)
        {
            return JsonUtility.ToJson(new InputMessage
            {
                v = Version,
                type = "input",
                seq = sequence,
                dirX = directionX,
                dirZ = directionZ,
                magnitude = magnitude,
                run = run
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

        public static bool TryReadServerFrame(string json, out GalaQuestServerFrame frame)
        {
            frame = null;
            try
            {
                frame = JsonUtility.FromJson<GalaQuestServerFrame>(json);
            }
            catch
            {
                return false;
            }
            return frame != null
                   && frame.v == Version
                   && (frame.type == "welcome" || frame.type == "snapshot");
        }

        [Serializable]
        private sealed class JoinMessage
        {
            public int v;
            public string type;
            public string name;
            public string guestId;
            public string destinationId;
        }

        [Serializable]
        private sealed class InputMessage
        {
            public int v;
            public string type;
            public int seq;
            public float dirX;
            public float dirZ;
            public float magnitude;
            public bool run;
        }

        [Serializable]
        private sealed class MessageHeader
        {
            public int v;
            public string type;
            public string id;
        }
    }

    [Serializable]
    public sealed class GalaQuestServerFrame
    {
        public int v;
        public string type;
        public string id;
        public int tick;
        public string destinationId;
        public GalaQuestServerPlayer[] players;
    }

    [Serializable]
    public sealed class GalaQuestServerPlayer
    {
        public string id;
        public float x;
        public float z;
        public float heading;
        public float speed;
    }
}
