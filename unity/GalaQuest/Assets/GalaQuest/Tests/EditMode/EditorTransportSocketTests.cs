using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class EditorTransportSocketTests
    {
        private Process fixture;
        private GameObject host;
        private EditorWebSocketTransport transport;
        private string previousUrl;
        private readonly List<string> messages = new List<string>();
        private string closed;
        private bool opened;
        private int callbackThread;
        [Serializable] private sealed class ClosePayload { public int code; }

        private void Pump() => typeof(EditorWebSocketTransport)
            .GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(transport, null);

        private IEnumerator Until(Func<bool> ready)
        {
            var deadline = UnityEditor.EditorApplication.timeSinceStartup + 15;
            while (!ready() && UnityEditor.EditorApplication.timeSinceStartup < deadline)
            { Pump(); yield return null; }
            Assert.That(ready(), Is.True, "Timed out waiting for the real loopback socket.");
        }

        [UnitySetUp]
        public IEnumerator SetUp()
        {
            previousUrl = GalaQuestEditorPlaySeam.ServerUrl;
            host = new GameObject("Owned socket fixture test");
            transport = host.AddComponent<EditorWebSocketTransport>();
            messages.Clear(); opened = false; closed = null; callbackThread = -1;
            fixture = Process.Start(new ProcessStartInfo("node", "tools/unity/transport-fixture.mjs")
            {
                WorkingDirectory = Path.GetFullPath(Path.Combine(Application.dataPath, "../../..")),
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
                RedirectStandardInput = true
            });
            var portTask = fixture.StandardOutput.ReadLineAsync();
            yield return Until(() => portTask.IsCompleted);
            Assert.That(int.TryParse(portTask.Result, out var port), Is.True, "Fixture must announce its owned ephemeral port.");
            GalaQuestEditorPlaySeam.ServerUrl = $"ws://127.0.0.1:{port}/ws";
            transport.Opened += () => { opened = true; callbackThread = System.Threading.Thread.CurrentThread.ManagedThreadId; };
            transport.MessageReceived += messages.Add;
            transport.Closed += detail => closed = detail;
            transport.Connect();
            yield return Until(() => opened);
        }

        [TearDown]
        public void TearDown()
        {
            if (host != null) UnityEngine.Object.DestroyImmediate(host);
            GalaQuestEditorPlaySeam.ServerUrl = previousUrl;
            if (fixture != null)
            {
                fixture.StandardInput.Close();
                if (!fixture.WaitForExit(2000)) { fixture.Kill(); fixture.WaitForExit(2000); }
                fixture.Dispose(); fixture = null;
            }
        }

        [UnityTest]
        public IEnumerator RealSocketDeliversOrderedMessagesOnMainThread()
        {
            Assert.That(callbackThread, Is.EqualTo(System.Threading.Thread.CurrentThread.ManagedThreadId));
            Assert.That(transport.Send("first"), Is.True);
            Assert.That(transport.Send("second"), Is.True);
            yield return Until(() => messages.Count == 2);
            CollectionAssert.AreEqual(new[] { "first", "second" }, messages);
            transport.Close();
            Assert.That(transport.Send("retired"), Is.False);
        }

        [UnityTest]
        public IEnumerator RealReconnectRetiresOldSocketTraffic()
        {
            Assert.That(transport.Send("retired"), Is.True);
            transport.Close();
            opened = false;
            transport.Connect();
            yield return Until(() => opened);
            Assert.That(transport.Send("replacement"), Is.True);
            yield return Until(() => messages.Count > 0);
            CollectionAssert.AreEqual(new[] { "replacement" }, messages);
        }

        [UnityTest]
        public IEnumerator FragmentedUtf8MessageSurvivesFrameBoundary()
        {
            Assert.That(transport.Send("unicode"), Is.True);
            yield return Until(() => messages.Count == 1);
            Assert.That(messages[0], Is.EqualTo("a🔥b"));
        }

        [UnityTest]
        public IEnumerator ServerTakeoverClosePreservesCodeForSessionRecoveryPolicy()
        {
            Assert.That(transport.Send("takeover"), Is.True);
            yield return Until(() => closed != null);
            Assert.That(JsonUtility.FromJson<ClosePayload>(closed).code, Is.EqualTo(4001));
        }
    }
}
