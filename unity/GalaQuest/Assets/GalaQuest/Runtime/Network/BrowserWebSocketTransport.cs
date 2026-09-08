using System;
using UnityEngine;
using UnityEngine.Scripting;

namespace GalaQuest
{
    [Preserve]
    public sealed class BrowserWebSocketTransport : MonoBehaviour, IGalaQuestTransport
    {
        private int connectionId;

        public event Action Opened;
        public event Action<string> MessageReceived;
        public event Action<string> Closed;

        public void Connect()
        {
            connectionId = GalaQuestBrowserInterop.ConnectWebSocket(
                gameObject.name,
                nameof(OnSocketOpen),
                nameof(OnSocketMessage),
                nameof(OnSocketClose));
#if !UNITY_WEBGL || UNITY_EDITOR
            Closed?.Invoke("CP1 transport is available in the same-origin Unity Web build.");
#endif
        }

        public bool Send(string message)
        {
            return connectionId > 0 && GalaQuestBrowserInterop.SendWebSocket(connectionId, message);
        }

        public void Close()
        {
            if (connectionId <= 0) return;
            GalaQuestBrowserInterop.CloseWebSocket(connectionId);
            connectionId = 0;
        }

        [Preserve]
        public void OnSocketOpen(string openedConnectionId)
        {
            if (!int.TryParse(openedConnectionId, out var opened) || opened != connectionId) return;
            Opened?.Invoke();
        }

        [Preserve]
        public void OnSocketMessage(string message)
        {
            MessageReceived?.Invoke(message);
        }

        [Preserve]
        public void OnSocketClose(string detail)
        {
            connectionId = 0;
            Closed?.Invoke(detail);
        }

        private void OnDestroy()
        {
            Close();
        }
    }
}
