using System;
using System.Collections.Generic;
using System.Linq;
using GalaQuest.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class GalaQuestConnectionEditModeTests
    {
        [Test]
        public void BrowserProfilePayloadPreservesTheSelectedJournalAsProtocolJson()
        {
            const string payload =
                "{\"status\":\"ok\",\"profileId\":\"profile-aaaaaaaa\",\"displayName\":\"Aster\"," +
                "\"factsJson\":\"[{\\\"eventId\\\":\\\"mark:a\\\",\\\"type\\\":\\\"mark-earned\\\"}]\"}";

            Assert.That(GalaQuestSelectedProfile.TryParse(payload, out var profile, out var error), Is.True, error);
            Assert.That(profile.ProfileId, Is.EqualTo("profile-aaaaaaaa"));
            Assert.That(profile.DisplayName, Is.EqualTo("Aster"));
            Assert.That(profile.FactsJson, Is.EqualTo("[{\"eventId\":\"mark:a\",\"type\":\"mark-earned\"}]"));
        }

        [Test]
        public void WelcomeRestoresOnlyTheSelectedProfileJournalAndReconnectKeepsIdentity()
        {
            var transport = new FakeTransport();
            var profile = new GalaQuestSelectedProfile(
                "profile-aaaaaaaa",
                "Aster",
                "[{\"eventId\":\"mark:a\",\"type\":\"mark-earned\"}]");
            var session = new GalaQuestConnectionSession(transport);

            session.Begin(profile);
            Assert.That(transport.ConnectCount, Is.EqualTo(1));
            transport.Open();
            Assert.That(transport.Sent, Has.Count.EqualTo(1));
            StringAssert.Contains("\"type\":\"join\"", transport.Sent[0]);
            StringAssert.Contains("\"guestId\":\"profile-aaaaaaaa\"", transport.Sent[0]);

            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");
            Assert.That(transport.Sent, Has.Count.EqualTo(2));
            Assert.That(
                transport.Sent[1],
                Is.EqualTo("{\"v\":4,\"type\":\"restore-profile\",\"facts\":[{\"eventId\":\"mark:a\",\"type\":\"mark-earned\"}]}"));

            transport.CloseFromServer("wifi interrupted");
            session.Reconnect();
            transport.Open();
            Assert.That(transport.ConnectCount, Is.EqualTo(2));
            StringAssert.Contains("\"guestId\":\"profile-aaaaaaaa\"", transport.Sent[2]);
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p2\"}");
            Assert.That(transport.Sent[3], Is.EqualTo(transport.Sent[1]));
        }

        [Test]
        public void SequentialProfilesNeverCarryTheOtherProfilesFacts()
        {
            var a = RunProfile(
                new GalaQuestSelectedProfile("profile-aaaaaaaa", "Aster", "[{\"eventId\":\"mark:a\",\"type\":\"mark-earned\"}]"));
            var b = RunProfile(
                new GalaQuestSelectedProfile("profile-bbbbbbbb", "Bramble", "[{\"eventId\":\"coin:b\",\"type\":\"coin-earned\"}]"));
            var aAgain = RunProfile(
                new GalaQuestSelectedProfile("profile-aaaaaaaa", "Aster", "[{\"eventId\":\"mark:a\",\"type\":\"mark-earned\"}]"));

            StringAssert.Contains("profile-aaaaaaaa", a.Join);
            StringAssert.DoesNotContain("coin:b", a.Restore);
            StringAssert.Contains("profile-bbbbbbbb", b.Join);
            StringAssert.Contains("coin:b", b.Restore);
            StringAssert.DoesNotContain("mark:a", b.Restore);
            Assert.That(aAgain.Join, Is.EqualTo(a.Join));
            Assert.That(aAgain.Restore, Is.EqualTo(a.Restore));
        }

        [Test]
        public void EmberworksCp1SceneIsWiredAndFrozenFromGreyboxRegeneration()
        {
            Assert.That(EmberworksGreyboxBuild.CanBuildGreybox(), Is.False);
            Assert.Throws<BuildFailedException>(EmberworksGreyboxBuild.EnsureRegenerationWillNotOverwritePlayableScene);

            var firstScene = EditorBuildSettings.scenes.First(scene => scene.enabled);
            Assert.That(firstScene.path, Is.EqualTo("Assets/GalaQuest/Emberworks/Scenes/EmberworksDeep.unity"));

            var scene = EditorSceneManager.OpenScene(firstScene.path, OpenSceneMode.Single);
            EmberworksGreyboxBuild.ValidateU1Cp1Runtime();
            Assert.That(scene.GetRootGameObjects().Count(root => root.name == "GalaQuestRuntime"), Is.EqualTo(1));
            Assert.That(UnityEngine.Object.FindObjectsByType<GalaQuestGameEntry>(FindObjectsSortMode.None), Has.Length.EqualTo(1));
            Assert.That(UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None).Count(camera => camera.CompareTag("MainCamera")), Is.EqualTo(1));

            var hero = GameObject.Find(EmberworksGreyboxBuild.RuntimeHeroName);
            var camera = GameObject.Find(EmberworksGreyboxBuild.RuntimeCameraName).GetComponent<Camera>();
            var visibleHeroRenderers = hero.GetComponentsInChildren<Renderer>()
                .Where(renderer => renderer.enabled && renderer.gameObject.activeInHierarchy)
                .ToArray();
            Assert.That(visibleHeroRenderers, Is.Not.Empty, "the real Hero prefab must have a live renderer");
            var frustum = GeometryUtility.CalculateFrustumPlanes(camera);
            Assert.That(
                visibleHeroRenderers.Any(renderer => GeometryUtility.TestPlanesAABB(frustum, renderer.bounds)),
                Is.True,
                "the real Hero must be inside the gameplay camera frustum");
        }

        private static (string Join, string Restore) RunProfile(GalaQuestSelectedProfile profile)
        {
            var transport = new FakeTransport();
            var session = new GalaQuestConnectionSession(transport);
            session.Begin(profile);
            transport.Open();
            transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");
            return (transport.Sent[0], transport.Sent[1]);
        }

        private sealed class FakeTransport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;

            public int ConnectCount { get; private set; }
            public List<string> Sent { get; } = new List<string>();

            public void Connect() => ConnectCount += 1;
            public bool Send(string message)
            {
                Sent.Add(message);
                return true;
            }
            public void Close() { }
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
            public void CloseFromServer(string reason) => Closed?.Invoke(reason);
        }
    }
}
