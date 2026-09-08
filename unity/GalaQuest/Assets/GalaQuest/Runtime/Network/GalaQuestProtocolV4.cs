using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;

namespace GalaQuest
{
    public static class GalaQuestProtocolV4
    {
        public const int Version = 4;
        public const string HomeHubDestinationId = "home-hub";
        public const string EmberworksDeepDestinationId = "emberworks-deep";
        private static readonly JsonSerializerSettings FrameJsonSettings = new JsonSerializerSettings
        {
            TypeNameHandling = TypeNameHandling.None,
            MetadataPropertyHandling = MetadataPropertyHandling.Ignore,
            MaxDepth = 32,
            CheckAdditionalContent = true
        };

        public static string Join(GalaQuestSelectedProfile profile, string destinationId = EmberworksDeepDestinationId)
        {
            return JsonUtility.ToJson(new JoinMessage
            {
                v = Version,
                type = "join",
                name = profile.DisplayName,
                guestId = profile.ProfileId,
                destinationId = destinationId
            });
        }

        public static string Input(int sequence, float directionX, float directionZ, float magnitude, bool run, int worldEpoch = 0)
        {
            return WithEpoch(JsonUtility.ToJson(new InputMessage
            {
                v = Version,
                type = "input",
                seq = sequence,
                dirX = directionX,
                dirZ = directionZ,
                magnitude = magnitude,
                run = run
            }), worldEpoch);
        }

        public static string RestoreProfile(GalaQuestSelectedProfile profile)
        {
            return $"{{\"v\":{Version},\"type\":\"restore-profile\",\"facts\":{profile.FactsJson}}}";
        }

        public static string Attack(int sequence, int worldEpoch = 0)
        {
            return WithEpoch(JsonUtility.ToJson(new AttackMessage { v = Version, type = "attack", seq = sequence }), worldEpoch);
        }

        public static string Travel(string destinationId, int worldEpoch)
        {
            return JsonUtility.ToJson(new TravelMessage
            { v = Version, type = "travel", destinationId = destinationId, worldEpoch = worldEpoch });
        }

        public static string ForgeOpen(int worldEpoch) => WithEpoch(
            JsonUtility.ToJson(new SimpleMessage { v = Version, type = "forge-open" }), worldEpoch);

        public static string ForgeSelectPack(string packId, int worldEpoch) => WithEpoch(
            JsonUtility.ToJson(new ForgePackMessage
            { v = Version, type = "forge-select-pack", packId = packId }), worldEpoch);

        public static string ForgeAnswer(string taskId, string choiceId, string contentVersion, int worldEpoch) => WithEpoch(
            JsonUtility.ToJson(new ForgeAnswerMessage
            {
                v = Version, type = "forge-answer", taskId = taskId,
                choiceId = choiceId, contentVersion = contentVersion
            }), worldEpoch);

        public static string ForgeHint(string taskId, string contentVersion, int worldEpoch) => WithEpoch(
            JsonUtility.ToJson(new ForgeHintMessage
            { v = Version, type = "forge-hint", taskId = taskId, contentVersion = contentVersion }), worldEpoch);

        public static string ForgeClaim(int worldEpoch) => WithEpoch(
            JsonUtility.ToJson(new SimpleMessage { v = Version, type = "forge-claim" }), worldEpoch);

        public static string Equip(string itemId, int worldEpoch) => WithEpoch(
            JsonUtility.ToJson(new EquipMessage { v = Version, type = "equip", itemId = itemId }), worldEpoch);

        private static string WithEpoch(string json, int worldEpoch) => worldEpoch == 0 ? json
            : json.Substring(0, json.Length - 1) + ",\"worldEpoch\":" + worldEpoch + "}";

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
                // JsonUtility silently drops encounter.heroes because its keys are player IDs.
                // Unity's AOT-compatible Newtonsoft package preserves the actual v4 wire shape.
                frame = JsonConvert.DeserializeObject<GalaQuestServerFrame>(json, FrameJsonSettings);
            }
            catch (JsonException)
            {
                return false;
            }
            if (frame == null || frame.v != Version || (frame.type != "welcome" && frame.type != "snapshot"
                    && frame.type != "destination-changed" && frame.type != "forge-state")
                || frame.worldEpoch < 0 || (frame.type == "destination-changed"
                    && (frame.worldEpoch == 0 || string.IsNullOrEmpty(frame.id) || string.IsNullOrEmpty(frame.destinationId)))
                || (frame.type == "forge-state" && (string.IsNullOrEmpty(frame.id)
                    || string.IsNullOrEmpty(frame.destinationId) || frame.forge == null)))
            {
                frame = null;
                return false;
            }
            frame.players ??= Array.Empty<GalaQuestServerPlayer>();
            frame.encounter ??= new GalaQuestServerEncounter();
            frame.encounter.heroes ??= new Dictionary<string, GalaQuestServerHeroCombat>();
            frame.encounter.enemies ??= Array.Empty<GalaQuestServerEnemy>();
            frame.events ??= Array.Empty<GalaQuestServerCombatEvent>();
            return true;
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
        private sealed class AttackMessage
        {
            public int v;
            public string type;
            public int seq;
        }

        [Serializable]
        private sealed class TravelMessage
        {
            public int v;
            public string type;
            public string destinationId;
            public int worldEpoch;
        }

        [Serializable]
        private sealed class SimpleMessage { public int v; public string type; }

        [Serializable]
        private sealed class ForgePackMessage { public int v; public string type; public string packId; }

        [Serializable]
        private sealed class ForgeAnswerMessage
        {
            public int v; public string type; public string taskId; public string choiceId; public string contentVersion;
        }

        [Serializable]
        private sealed class ForgeHintMessage
        { public int v; public string type; public string taskId; public string contentVersion; }

        [Serializable]
        private sealed class EquipMessage { public int v; public string type; public string itemId; }

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
        public int worldEpoch;
        public string destinationId;
        public GalaQuestServerPlayer[] players = Array.Empty<GalaQuestServerPlayer>();
        public GalaQuestServerEncounter encounter = new GalaQuestServerEncounter();
        public GalaQuestServerCombatEvent[] events = Array.Empty<GalaQuestServerCombatEvent>();
        public GalaQuestRuneForgeState forge;
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

    [Serializable]
    public sealed class GalaQuestServerEncounter
    {
        public int revision;
        public GalaQuestServerEnemy[] enemies = Array.Empty<GalaQuestServerEnemy>();
        public Dictionary<string, GalaQuestServerHeroCombat> heroes = new Dictionary<string, GalaQuestServerHeroCombat>();
        public Dictionary<string, GalaQuestServerRewards> rewards = new Dictionary<string, GalaQuestServerRewards>();
    }

    [Serializable]
    public sealed class GalaQuestServerRewards
    {
        public string[] ownedItemIds = Array.Empty<string>();
        public Dictionary<string, string> equippedItemIds = new Dictionary<string, string>();
        public int xp;
    }

    [Serializable]
    public sealed class GalaQuestRuneForgeState
    {
        public string status;
        public GalaQuestRuneForgeEntitlement entitlement;
        public GalaQuestRuneForgePack[] packs = Array.Empty<GalaQuestRuneForgePack>();
        public string selectedPackId;
        public string contentVersion;
        public int completedCount;
        public int requiredSuccesses;
        public bool readyToClaim;
        public bool owned;
        public GalaQuestRuneForgeTask task;
        public GalaQuestRuneForgeHistory[] history = Array.Empty<GalaQuestRuneForgeHistory>();
        public string response;
        public string hint;
        public bool justGranted;
    }

    [Serializable]
    public sealed class GalaQuestRuneForgeEntitlement { public string id; public string itemId; public string displayName; }

    [Serializable]
    public sealed class GalaQuestRuneForgePack { public string id; public string title; }

    [Serializable]
    public sealed class GalaQuestRuneForgeTask
    {
        public string id;
        public string skill;
        public string spokenPrompt;
        public string displayPrompt;
        public string hint;
        public GalaQuestRuneForgeChoice[] choices = Array.Empty<GalaQuestRuneForgeChoice>();
    }

    [Serializable]
    public sealed class GalaQuestRuneForgeChoice { public string id; public string label; }

    [Serializable]
    public sealed class GalaQuestRuneForgeHistory
    { public string entitlementId; public string packId; public string taskId; public string contentVersion; public string outcome; }

    [Serializable]
    public sealed class GalaQuestServerHeroCombat
    {
        public int hp;
        public int maxHp;
        public float swingSeconds = -1;
        public float cooldown;
        public float downSeconds = -1;
        public float protectionSeconds;
    }

    [Serializable]
    public sealed class GalaQuestServerEnemy
    {
        public string enemyId;
        public string kind;
        public int level;
        public int hp;
        public int maxHp;
        public float x;
        public float z;
        public float heading;
        public string mode;
        public float modeSeconds;
        public string targetId;
        public GalaQuestServerEnemyAttack attack;
    }

    [Serializable]
    public sealed class GalaQuestServerEnemyAttack
    {
        public float contactSeconds;
        public float durationSeconds;
        public float cooldownSeconds;
        public float reach;
        public float halfArcRadians;
    }

    [Serializable]
    public sealed class GalaQuestServerCombatEvent
    {
        public string type;
        public string heroId;
        public string enemyId;
        public string kind;
        public int remaining;
    }
}
