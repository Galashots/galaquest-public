using System;
using System.Collections.Generic;
using System.Linq;
using GalaQuest.Editor;
using GalaQuest.Gear;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class RuneForgeEditModeTests
    {
        private const string ProfileId = "profile-aaaaaaaa";
        private const string Welcome = "{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"destinationId\":\"emberworks-deep\",\"worldEpoch\":0}";
        private const string ValidState = "{\"v\":4,\"type\":\"forge-state\",\"id\":\"p1\",\"destinationId\":\"emberworks-deep\",\"worldEpoch\":0,\"forge\":{\"status\":\"ready\",\"contentVersion\":\"2026-09-08.1\",\"requiredSuccesses\":2,\"packs\":[{\"id\":\"grapheme-er-family\",\"title\":\"Sound runes\"}],\"entitlement\":{\"id\":\"emberworks.rune-forge.magmalord-helmet.v1\",\"itemId\":\"helmet_magmalord\",\"displayName\":\"MagmaLord Helmet\"}}}";

        [Test]
        public void ProtocolParsesPrivateForgeStateAndWritesBoundedActions()
        {
            Assert.That(GalaQuestProtocolV4.TryReadServerFrame(ValidState, out var frame), Is.True);
            Assert.That(frame.forge.requiredSuccesses, Is.EqualTo(2));
            Assert.That(frame.forge.entitlement.id, Is.EqualTo("emberworks.rune-forge.magmalord-helmet.v1"));
            Assert.That(frame.forge.packs.Single().id, Is.EqualTo("grapheme-er-family"));

            Assert.That(GalaQuestProtocolV4.ForgeOpen(3), Is.EqualTo("{\"v\":4,\"type\":\"forge-open\",\"worldEpoch\":3}"));
            Assert.That(GalaQuestProtocolV4.ForgeSelectPack("grapheme-er-family", 3), Does.Contain("\"packId\":\"grapheme-er-family\""));
            Assert.That(GalaQuestProtocolV4.ForgeAnswer("task-1", "rune-2", "v1", 3), Does.Contain("\"contentVersion\":\"v1\""));
            Assert.That(GalaQuestProtocolV4.ForgeHint("task-1", "v1", 3), Does.Contain("\"type\":\"forge-hint\""));
            Assert.That(GalaQuestProtocolV4.ForgeClaim(3), Does.Contain("\"type\":\"forge-claim\""));
            Assert.That(GalaQuestProtocolV4.Equip("helmet_magmalord", 3), Does.Contain("\"itemId\":\"helmet_magmalord\""));
        }

        [Test]
        public void SessionRejectsForgeStateFromAnotherPlayerDestinationOrEpoch()
        {
            var wire = new Wire();
            using var session = new GalaQuestConnectionSession(wire);
            var accepted = new List<GalaQuestServerFrame>();
            session.ServerFrameReceived += accepted.Add;
            session.Begin(new GalaQuestSelectedProfile(ProfileId, "Aster", "[]"));
            wire.Open();
            wire.Receive(Welcome);
            accepted.Clear();

            wire.Receive(ValidState.Replace("\"id\":\"p1\"", "\"id\":\"other\""));
            wire.Receive(ValidState.Replace("emberworks-deep", "home-hub"));
            wire.Receive(ValidState.Replace("\"worldEpoch\":0", "\"worldEpoch\":1"));
            Assert.That(accepted, Is.Empty);

            wire.Receive(ValidState);
            Assert.That(accepted.Select(value => value.type), Is.EqualTo(new[] { "forge-state" }));
        }

        [Test]
        public void ForgeActionsRequireAnAuthoritativeActiveEmberworksSession()
        {
            var wire = new Wire();
            using var session = new GalaQuestConnectionSession(wire);
            session.Begin(new GalaQuestSelectedProfile(ProfileId, "Aster", "[]"));
            Assert.That(session.TryOpenRuneForge(), Is.False);
            wire.Open();
            Assert.That(session.TryOpenRuneForge(), Is.False);
            wire.Receive(Welcome);
            Assert.That(session.TryOpenRuneForge(), Is.True);
            Assert.That(session.TrySelectRuneForgePack("grapheme-er-family"), Is.True);
            Assert.That(session.TryAnswerRuneForge("task-1", "rune-1", "v1"), Is.True);
            Assert.That(session.TryRequestRuneForgeHint("task-1", "v1"), Is.True);
            Assert.That(session.TryClaimRuneForge(), Is.True);
            Assert.That(session.TryEquip("helmet_magmalord"), Is.True);

            wire.Close("{\"code\":4001}");
            Assert.That(session.CanReconnect, Is.False);
            Assert.That(session.TryOpenRuneForge(), Is.False);
            Assert.That(session.TryClaimRuneForge(), Is.False);
            Assert.That(session.TryEquip("helmet_magmalord"), Is.False);
        }

        [Test]
        public void AuthoredSceneUsesOneWearableAssetAndAnExplicitEnlargedDisplayInstance()
        {
            var definition = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(RuneForgeAuthoring.DefinitionPath);
            Assert.That(definition, Is.Not.Null, "Run the bounded Rune Forge authoring command first.");
            Assert.That(definition.SemanticId, Is.EqualTo("gear.helmet.magmalord"));
            Assert.That(definition.SourceRepoPath, Is.EqualTo("unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/MagmaLordHelmet.fbx"));
            Assert.That(definition.SocketId, Is.EqualTo(GearSocketIds.Head));

            var pocketObject = AssetDatabase.LoadAssetAtPath<GameObject>(RuneForgeAuthoring.PocketPrefabPath);
            Assert.That(pocketObject, Is.Not.Null, "Run the bounded Rune Forge authoring command first.");
            Assert.That(PrefabUtility.GetPrefabAssetType(pocketObject), Is.EqualTo(PrefabAssetType.Regular));
            var pocket = pocketObject.transform;
            var display = pocket.Find("PrizeCage/MagmaLordForgeDisplayCopy");
            Assert.That(display, Is.Not.Null);
            Assert.That(display.localScale, Is.EqualTo(Vector3.one * 2.10f));
            Assert.That(display.GetComponentInChildren<GearMountedItem>(), Is.Null,
                "The enlarged prize is a named display instance, not another wearable or entitlement.");
            var soundPlaque = pocket.Find("SoundPlaque");
            Assert.That(soundPlaque, Is.Not.Null, "The gesture-driven HEAR control must remain authored even while inactive.");
            var soundComponents = soundPlaque.GetComponents<Component>();
            Assert.That(soundPlaque.GetComponent<GalaQuestRuneForgeInteractable>()?.Kind, Is.EqualTo("hear"),
                string.Join(", ", soundComponents.Select(component => component == null ? "MISSING" : component.GetType().FullName)));
            Assert.That(pocket.GetComponentsInChildren<GalaQuestRuneForgeInteractable>(true).Select(item => item.Kind),
                Does.Contain("hammer").And.Contain("rune").And.Contain("hint").And.Contain("hear").And.Contain("claim").And.Contain("equip"));
        }

        private sealed class Wire : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public readonly List<string> Sent = new List<string>();
            public void Connect() { }
            public bool Send(string message) { Sent.Add(message); return true; }
            public void Close() => Closed?.Invoke("closed");
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
            public void Close(string detail) => Closed?.Invoke(detail);
        }
    }
}
