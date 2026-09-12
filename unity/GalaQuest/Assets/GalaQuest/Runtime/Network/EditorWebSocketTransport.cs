#if UNITY_EDITOR
using System;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace GalaQuest
{
    /// <summary>
    /// A real WebSocket client for Editor Play Mode, speaking the same protocol to the same Node
    /// server the browser talks to. Editor-only: compiled out of every player, so the browser
    /// transport remains the production path.
    ///
    /// It is a pipe and nothing more. It never synthesizes a welcome, snapshot, or damage frame, so
    /// everything gameplay reacts to came from the server.
    ///
    /// Threading contract: receives arrive on a background task and are queued; every event this
    /// class raises is raised from Update() on Unity's main thread, in arrival order. Sends are
    /// serialized behind one lock because concurrent SendAsync calls on a ClientWebSocket are
    /// undefined. A connection generation counter retires callbacks from a superseded socket, so a
    /// late frame from a closed connection cannot mutate the session that replaced it.
    /// </summary>
    [AddComponentMenu("")]
    public sealed class EditorWebSocketTransport : MonoBehaviour, IGalaQuestTransport
    {
        public event Action Opened;
        public event Action<string> MessageReceived;
        public event Action<string> Closed;

        private readonly ConcurrentQueue<Action> mainThreadEvents = new ConcurrentQueue<Action>();
        private readonly object sendGate = new object();
        private ClientWebSocket socket;
        private CancellationTokenSource cancellation;
        private int generation;
        private bool reportedClosed;

        public string Endpoint { get; private set; } = string.Empty;

        public void Connect()
        {
            // Retire any previous socket first: Reconnect() calls straight into here, and two live
            // sockets would both feed the one session.
            Teardown();

            var current = ++generation;
            reportedClosed = false;
            Endpoint = GalaQuestEditorPlaySeam.ServerUrl;

            if (!Uri.TryCreate(Endpoint, UriKind.Absolute, out var uri)
                || (uri.Scheme != "ws" && uri.Scheme != "wss"))
            {
                Enqueue(current, () => RaiseClosed($"Editor server endpoint is not a WebSocket URL: {Endpoint}"));
                return;
            }
            // A development seam must not reach a family or production service by accident.
            if (!uri.IsLoopback)
            {
                Enqueue(current, () => RaiseClosed($"Editor play refuses a non-loopback endpoint: {Endpoint}"));
                return;
            }

            socket = new ClientWebSocket();
            // The server refuses an upgrade whose Origin does not match its Host, and refuses a
            // missing Origin too. Send exactly what the browser sends for this same loopback host
            // rather than relaxing the check: the guard stays intact and this client satisfies it.
            socket.Options.SetRequestHeader("Origin",
                (uri.Scheme == "wss" ? "https://" : "http://") + uri.Authority);
            cancellation = new CancellationTokenSource();
            _ = RunAsync(socket, cancellation.Token, uri, current);
        }

        public bool Send(string message)
        {
            var live = socket;
            if (live == null || live.State != WebSocketState.Open) return false;
            var bytes = Encoding.UTF8.GetBytes(message ?? string.Empty);
            try
            {
                // Serialized: the session can send an input and a travel frame in the same tick.
                lock (sendGate)
                {
                    live.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None)
                        .GetAwaiter().GetResult();
                }
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        public void Close()
        {
            // Retire queued opens/messages as well as the socket. Close can happen before Update
            // dispatches an already received frame or a failed connection attempt.
            var current = ++generation;
            Teardown();
            Enqueue(current, () => RaiseClosed("Editor transport closed"));
        }

        private async Task RunAsync(ClientWebSocket live, CancellationToken token, Uri uri, int current)
        {
            try
            {
                await live.ConnectAsync(uri, token).ConfigureAwait(false);
            }
            catch (Exception exception)
            {
                Enqueue(current, () => RaiseClosed($"Editor transport could not reach {uri}: {exception.Message}"));
                return;
            }

            Enqueue(current, () => { if (generation == current) Opened?.Invoke(); });

            var buffer = new byte[16 * 1024];
            var text = new StringBuilder();
            try
            {
                while (!token.IsCancellationRequested && live.State == WebSocketState.Open)
                {
                    var result = await live.ReceiveAsync(new ArraySegment<byte>(buffer), token).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        Enqueue(current, () => RaiseClosed("Editor transport closed by the server"));
                        return;
                    }
                    text.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                    if (!result.EndOfMessage) continue;
                    var message = text.ToString();
                    text.Clear();
                    Enqueue(current, () => { if (generation == current) MessageReceived?.Invoke(message); });
                }
            }
            catch (OperationCanceledException)
            {
                // Expected on Play Mode exit or an explicit Close(); the teardown path reports it.
            }
            catch (Exception exception)
            {
                Enqueue(current, () => RaiseClosed($"Editor transport lost the connection: {exception.Message}"));
            }
        }

        // Queued work is tagged with the generation that produced it and dropped if a newer
        // connection has since taken over.
        private void Enqueue(int current, Action action)
        {
            mainThreadEvents.Enqueue(() => { if (generation == current) action(); });
        }

        private void RaiseClosed(string detail)
        {
            if (reportedClosed) return;
            reportedClosed = true;
            Closed?.Invoke(detail);
        }

        private void Update()
        {
            while (mainThreadEvents.TryDequeue(out var action)) action();
        }

        private void Teardown()
        {
            var live = socket;
            var token = cancellation;
            socket = null;
            cancellation = null;
            try { token?.Cancel(); } catch (Exception) { /* already disposed */ }
            try { live?.Abort(); } catch (Exception) { /* already faulted */ }
            try { live?.Dispose(); } catch (Exception) { /* already disposed */ }
            try { token?.Dispose(); } catch (Exception) { /* already disposed */ }
        }

        // Play Mode exit destroys this component. Bumping the generation first means any frame still
        // in flight is discarded rather than delivered into the next session.
        private void OnDestroy()
        {
            generation++;
            Teardown();
            while (mainThreadEvents.TryDequeue(out _)) { }
        }
    }
}
#endif
