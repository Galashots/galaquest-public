using System;
using UnityEngine;

namespace GalaQuest
{
    public readonly struct GalaQuestSelectedProfile
    {
        public GalaQuestSelectedProfile(string profileId, string displayName, string factsJson)
        {
            ProfileId = profileId;
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? "Hero" : displayName;
            FactsJson = string.IsNullOrWhiteSpace(factsJson) ? "[]" : factsJson;
        }

        public string ProfileId { get; }
        public string DisplayName { get; }
        public string FactsJson { get; }

        public static bool TryParse(string json, out GalaQuestSelectedProfile profile, out string error)
        {
            profile = default;
            error = string.Empty;
            BrowserProfilePayload payload;
            try
            {
                payload = JsonUtility.FromJson<BrowserProfilePayload>(json);
            }
            catch (Exception exception)
            {
                error = $"Browser profile response was not JSON: {exception.Message}";
                return false;
            }

            if (payload == null || payload.status != "ok")
            {
                error = payload?.error ?? "No existing GalaQuest profile is selected.";
                return false;
            }
            if (!IsWireProfileId(payload.profileId))
            {
                error = "The selected GalaQuest profile ID is not valid for protocol v4.";
                return false;
            }

            var factsJson = string.IsNullOrWhiteSpace(payload.factsJson) ? "[]" : payload.factsJson.Trim();
            if (!factsJson.StartsWith("[", StringComparison.Ordinal)
                || !factsJson.EndsWith("]", StringComparison.Ordinal))
            {
                error = "The selected GalaQuest journal is not a fact array.";
                return false;
            }

            profile = new GalaQuestSelectedProfile(payload.profileId, payload.displayName, factsJson);
            return true;
        }

        private static bool IsWireProfileId(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length < 8 || value.Length > 64) return false;
            foreach (var character in value)
            {
                var valid = character == '-'
                    || character >= '0' && character <= '9'
                    || character >= 'A' && character <= 'Z'
                    || character >= 'a' && character <= 'z';
                if (!valid) return false;
            }
            return true;
        }

        [Serializable]
        private sealed class BrowserProfilePayload
        {
            public string status;
            public string profileId;
            public string displayName;
            public string factsJson;
            public string error;
        }
    }
}
