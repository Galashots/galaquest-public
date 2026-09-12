#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace GalaQuest
{
    /// <summary>
    /// Editor-only development seam. It lets the existing gameplay run against a local Node server
    /// instead of the browser, and exists only so a developer can see the real game without a WebGL
    /// build. The whole file is compiled out of the player, so the browser profile and browser
    /// transport remain the only production path and this seam cannot ship.
    ///
    /// It supplies identity and a socket. It deliberately owns no gameplay: combat, progression,
    /// learning and rewards stay server-authoritative exactly as they are in the browser.
    /// </summary>
    public static class GalaQuestEditorPlaySeam
    {
        public const string EnabledKey = "GalaQuest.EditorPlaySeam.Enabled";
        public const string ServerUrlKey = "GalaQuest.EditorPlaySeam.ServerUrl";
        public const string ProfileIdKey = "GalaQuest.EditorPlaySeam.ProfileId";
        public const string DisplayNameKey = "GalaQuest.EditorPlaySeam.DisplayName";

        // A deliberately non-default port. The production dev server uses 5201; an Editor session
        // must not silently attach to whatever server is already serving real play.
        public const string DefaultServerUrl = "ws://127.0.0.1:5202/ws";

        // A synthetic identity that is obviously not a child's. Rewards are keyed by this guest id
        // server-side, so a synthetic value cannot touch a real save even before the isolated
        // reward store is considered.
        public const string DefaultProfileId = "editor-dev-synthetic-0001";
        public const string DefaultDisplayName = "Editor Dev";

        /// <summary>Off unless a developer explicitly turns it on for this Editor.</summary>
        public static bool Enabled
        {
            get => EditorPrefs.GetBool(EnabledKey, false);
            set => EditorPrefs.SetBool(EnabledKey, value);
        }

        public static string ServerUrl
        {
            get
            {
                var stored = EditorPrefs.GetString(ServerUrlKey, string.Empty);
                return string.IsNullOrWhiteSpace(stored) ? DefaultServerUrl : stored;
            }
            set => EditorPrefs.SetString(ServerUrlKey, value ?? string.Empty);
        }

        public static string ProfileId
        {
            get
            {
                var stored = EditorPrefs.GetString(ProfileIdKey, string.Empty);
                return string.IsNullOrWhiteSpace(stored) ? DefaultProfileId : stored;
            }
            set => EditorPrefs.SetString(ProfileIdKey, value ?? string.Empty);
        }

        public static string DisplayName
        {
            get
            {
                var stored = EditorPrefs.GetString(DisplayNameKey, string.Empty);
                return string.IsNullOrWhiteSpace(stored) ? DefaultDisplayName : stored;
            }
            set => EditorPrefs.SetString(DisplayNameKey, value ?? string.Empty);
        }

        /// <summary>
        /// Attach the Editor identity and socket to the entry GameObject. Idempotent, so re-entering
        /// Play Mode cannot accumulate a second profile source or a second transport.
        /// </summary>
        public static void Attach(GameObject host)
        {
            if (host == null) return;
            if (host.GetComponent<EditorSyntheticProfileSource>() == null)
                host.AddComponent<EditorSyntheticProfileSource>();
            if (host.GetComponent<EditorWebSocketTransport>() == null)
                host.AddComponent<EditorWebSocketTransport>();
        }
    }
}
#endif
