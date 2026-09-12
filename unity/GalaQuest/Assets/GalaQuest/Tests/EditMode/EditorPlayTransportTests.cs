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
        private bool hadUrl;

        [SetUp]
        public void SetUp()
        {
            hadUrl = EditorPrefs.HasKey(GalaQuestEditorPlaySeam.ServerUrlKey);
            previousUrl = GalaQuestEditorPlaySeam.ServerUrl;
            host = new GameObject("Editor transport test");
            transport = host.AddComponent<EditorWebSocketTransport>();
        }

        [TearDown]
        public void TearDown()
        {
            UnityEngine.Object.DestroyImmediate(host);
            if (hadUrl) GalaQuestEditorPlaySeam.ServerUrl = previousUrl;
            else EditorPrefs.DeleteKey(GalaQuestEditorPlaySeam.ServerUrlKey);
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
