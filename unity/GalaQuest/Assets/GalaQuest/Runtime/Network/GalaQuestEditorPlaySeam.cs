#if UNITY_EDITOR
using System;
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
        private const string OwnerKey = "GalaQuest.EditorPlaySeam.Owner";
        private const string PreviousUrlKey = "GalaQuest.EditorPlaySeam.PreviousUrl";

        // SessionState is local to this Editor process, survives domain reload, and is discarded
        // when the Editor exits. Global EditorPrefs must never enable another checkout's seam.
        public static bool Owns(string owner) => !string.IsNullOrEmpty(owner)
            && SessionState.GetString(OwnerKey, string.Empty) == owner;

        public static bool Acquire(string owner, string endpoint)
        {
            if (string.IsNullOrWhiteSpace(owner) || Enabled || !string.IsNullOrEmpty(SessionState.GetString(OwnerKey, string.Empty)))
                throw new InvalidOperationException("An Editor play owner is already active, or the owner token is empty.");
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Stop Play Mode before acquiring Editor play.");
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || !uri.IsLoopback
                || (uri.Scheme != "ws" && uri.Scheme != "wss"))
                throw new ArgumentException("Editor play requires a loopback WebSocket endpoint.");
            SessionState.SetString(PreviousUrlKey, ServerUrl);
            SessionState.SetString(OwnerKey, owner);
            ServerUrl = endpoint;
            Enabled = true;
            return true;
        }

        public static bool Release(string owner)
        {
            if (!Owns(owner)) return false;
            Enabled = false;
            ServerUrl = SessionState.GetString(PreviousUrlKey, DefaultServerUrl);
            SessionState.EraseString(PreviousUrlKey);
            SessionState.EraseString(OwnerKey);
            return true;
        }

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
            get => SessionState.GetBool(EnabledKey, false);
            set => SessionState.SetBool(EnabledKey, value);
        }

        public static string ServerUrl
        {
            get
            {
                var stored = SessionState.GetString(ServerUrlKey, string.Empty);
                return string.IsNullOrWhiteSpace(stored) ? DefaultServerUrl : stored;
            }
            set => SessionState.SetString(ServerUrlKey, value ?? string.Empty);
        }

        public static string ProfileId
        {
            get
            {
                var stored = SessionState.GetString(ProfileIdKey, string.Empty);
                return string.IsNullOrWhiteSpace(stored) ? DefaultProfileId : stored;
            }
            set => SessionState.SetString(ProfileIdKey, value ?? string.Empty);
        }

        public static string DisplayName
        {
            get
            {
                var stored = SessionState.GetString(DisplayNameKey, string.Empty);
                return string.IsNullOrWhiteSpace(stored) ? DefaultDisplayName : stored;
            }
            set => SessionState.SetString(DisplayNameKey, value ?? string.Empty);
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
