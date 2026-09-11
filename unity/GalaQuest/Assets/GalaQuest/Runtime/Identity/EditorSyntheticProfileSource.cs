#if UNITY_EDITOR
using System;
using UnityEngine;

namespace GalaQuest
{
    /// <summary>
    /// Supplies a clearly synthetic development identity in place of the browser's selected profile.
    /// Editor-only: the file is compiled out of every player, so the browser remains the sole source
    /// of a real child's profile.
    ///
    /// It never reads browser storage, a child's journal, or a server save. The journal it supplies is
    /// empty on purpose -- inventing facts would make Editor play disagree with the real client.
    /// </summary>
    [AddComponentMenu("")]
    public sealed class EditorSyntheticProfileSource : MonoBehaviour, IGalaQuestSelectedProfileSource
    {
        public event Action<GalaQuestSelectedProfile> Selected;
        public event Action<string> Failed;

        public void ReadSelected()
        {
            var profileId = GalaQuestEditorPlaySeam.ProfileId;
            var displayName = GalaQuestEditorPlaySeam.DisplayName;

            // Route the synthetic values through the same parser the browser payload uses, so a
            // development identity cannot bypass the protocol's own id/journal validation.
            var payload = JsonUtility.ToJson(new SyntheticPayload
            {
                status = "ok",
                profileId = profileId,
                displayName = displayName,
                factsJson = "[]"
            });

            if (GalaQuestSelectedProfile.TryParse(payload, out var profile, out var error))
            {
                Debug.Log($"[GQ-EDITOR] Synthetic development profile '{displayName}' ({profileId}). " +
                          "This is not a child's profile and carries an empty journal.");
                Selected?.Invoke(profile);
            }
            else
            {
                Failed?.Invoke($"Synthetic development profile rejected: {error}");
            }
        }

        [Serializable]
        private sealed class SyntheticPayload
        {
            public string status;
            public string profileId;
            public string displayName;
            public string factsJson;
        }
    }
}
#endif
