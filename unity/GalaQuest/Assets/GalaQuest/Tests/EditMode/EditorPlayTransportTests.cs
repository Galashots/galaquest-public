using System;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class EditorPlayTransportTests
    {
        private GameObject host;
        private EditorWebSocketTransport transport;
        private string previousUrl;


        [SetUp]
        public void SetUp()
        {

            previousUrl = GalaQuestEditorPlaySeam.ServerUrl;
            host = new GameObject("Editor transport test");
            transport = host.AddComponent<EditorWebSocketTransport>();
        }

        [TearDown]
        public void TearDown()
        {
            UnityEngine.Object.DestroyImmediate(host);
            GalaQuestEditorPlaySeam.ServerUrl = previousUrl;

        }

        [Test]
        public void DisabledSeamIgnoresAnAttachedNativeAdapter()
        {
            var enabled = GalaQuestEditorPlaySeam.Enabled;
            var entryHost = new GameObject("Selection test");
            entryHost.SetActive(false);
            try
            {
                GalaQuestEditorPlaySeam.Enabled = false;
                entryHost.AddComponent<EditorWebSocketTransport>();
                var entry = entryHost.AddComponent<GalaQuestGameEntry>();
                var resolver = typeof(GalaQuestGameEntry).GetMethod("ResolveDevelopmentOverride", BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(resolver.MakeGenericMethod(typeof(IGalaQuestTransport)).Invoke(entry, null), Is.Null);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(entryHost);
                GalaQuestEditorPlaySeam.Enabled = enabled;
            }
        }
        [Test]
        public void LegacyGlobalPreferenceCannotEnableThisEditor()
        {
            var had = EditorPrefs.HasKey(GalaQuestEditorPlaySeam.EnabledKey);
            var oldGlobal = EditorPrefs.GetBool(GalaQuestEditorPlaySeam.EnabledKey);
            var oldLocal = GalaQuestEditorPlaySeam.Enabled;
            try
            {
                GalaQuestEditorPlaySeam.Enabled = false;
                EditorPrefs.SetBool(GalaQuestEditorPlaySeam.EnabledKey, true);
                Assert.That(GalaQuestEditorPlaySeam.Enabled, Is.False);
            }
            finally
            {
                if (had) EditorPrefs.SetBool(GalaQuestEditorPlaySeam.EnabledKey, oldGlobal);
                else EditorPrefs.DeleteKey(GalaQuestEditorPlaySeam.EnabledKey);
                GalaQuestEditorPlaySeam.Enabled = oldLocal;
            }
        }

        [Test]
        public void OnlyAcquiringOwnerCanReleaseAndRestoreEndpoint()
        {
            Assert.That(GalaQuestEditorPlaySeam.Enabled, Is.False, "Run ownership tests with the helper released.");
            var owner = Guid.NewGuid().ToString();
            var previous = GalaQuestEditorPlaySeam.ServerUrl;
            try
            {
                Assert.That(GalaQuestEditorPlaySeam.Acquire(owner, "ws://127.0.0.1:5217/ws"), Is.True);
                Assert.Throws<InvalidOperationException>(() => GalaQuestEditorPlaySeam.Acquire("other", "ws://127.0.0.1:5216/ws"));
                Assert.That(GalaQuestEditorPlaySeam.Release("other"), Is.False);
                Assert.That(GalaQuestEditorPlaySeam.Enabled, Is.True);
                Assert.That(GalaQuestEditorPlaySeam.ServerUrl, Does.Contain(":5217/"));
                Assert.That(GalaQuestEditorPlaySeam.Release(owner), Is.True);
                Assert.That(GalaQuestEditorPlaySeam.Enabled, Is.False);
                Assert.That(GalaQuestEditorPlaySeam.ServerUrl, Is.EqualTo(previous));
                Assert.That(GalaQuestEditorPlaySeam.Release(owner), Is.False);
            }
            finally { GalaQuestEditorPlaySeam.Release(owner); }
        }
        private void Pump() => typeof(EditorWebSocketTransport)
            .GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(transport, null);

        [Test]
        public void ExplicitCloseRetiresAlreadyQueuedCallbacks()
        {
            var delivered = 0;
            var type = typeof(EditorWebSocketTransport);
            var generation = (int)type.GetField("generation", BindingFlags.Instance | BindingFlags.NonPublic)
                .GetValue(transport);
            type.GetMethod("Enqueue", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(transport, new object[] { generation, (Action)(() => delivered++) });
            transport.Close();
            Pump();
            Assert.That(delivered, Is.Zero, "A frame queued before close must not reach a retired session.");
        }

        [Test]
        public void CloseBeforeFailureDispatchReportsOnlyOneClosure()
        {
            GalaQuestEditorPlaySeam.ServerUrl = "not-a-websocket-url";
            var closed = 0;
            transport.Closed += _ => closed++;
            transport.Connect();
            transport.Close();
            Pump();
            Assert.That(closed, Is.EqualTo(1));
        }

        [TestCase("ws://192.0.2.1:5202/ws")]
        [TestCase("https://127.0.0.1:5202/ws")]
        [TestCase("invalid")]
        public void InvalidOrNonLoopbackEndpointFailsOnTheMainThreadWithoutSocket(string endpoint)
        {
            GalaQuestEditorPlaySeam.ServerUrl = endpoint;
            var thread = System.Threading.Thread.CurrentThread.ManagedThreadId;
            var callbackThread = -1;
            var opened = false;
            transport.Opened += () => opened = true;
            transport.Closed += _ => callbackThread = System.Threading.Thread.CurrentThread.ManagedThreadId;
            transport.Connect();
            Assert.That(callbackThread, Is.EqualTo(-1), "Events must be dispatched by Update.");
            Pump();
            Assert.That(callbackThread, Is.EqualTo(thread));
            Assert.That(opened, Is.False);
            Assert.That(transport.Send("{}"), Is.False);
            Assert.That(typeof(EditorWebSocketTransport)
                .GetField("socket", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(transport), Is.Null);
        }

        [Test]
        public void ReconnectDropsAnEarlierQueuedFailure()
        {
            GalaQuestEditorPlaySeam.ServerUrl = "invalid";
            var closed = 0;
            transport.Closed += _ => closed++;
            transport.Connect();
            transport.Connect();
            Pump();
            Assert.That(closed, Is.EqualTo(1));
        }
    }
}


