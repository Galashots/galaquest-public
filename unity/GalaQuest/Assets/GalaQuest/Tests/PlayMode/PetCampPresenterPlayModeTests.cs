using System;
using System.Collections;
using System.Collections.Generic;
using NUnit.Framework;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class PetCampPresenterPlayModeTests
    {
        [Test]
        public void NearestOfferIsRangeBoundAndTieBreaksByCatalogOrder()
        {
            Assert.That(GalaQuestPetCampPresenter.FindNearestOffer(new Vector2(0, 1))?.Id,
                Is.EqualTo("worm_green"), "the exact center tie deterministically keeps the first authored offer");
            Assert.That(GalaQuestPetCampPresenter.FindNearestOffer(new Vector2(3, 1))?.Id,
                Is.EqualTo("worm_red"));
            Assert.That(GalaQuestPetCampPresenter.FindNearestOffer(new Vector2(0, 5)), Is.Null);
        }

        [Test]
        public void NearestOfferReturnsNullForNonFiniteInput()
        {
            Assert.That(GalaQuestPetCampPresenter.FindNearestOffer(new Vector2(float.NaN, 1f)), Is.Null);
            Assert.That(GalaQuestPetCampPresenter.FindNearestOffer(new Vector2(0f, float.PositiveInfinity)), Is.Null);
            Assert.That(GalaQuestPetCampPresenter.FindNearestOffer(new Vector2(float.NegativeInfinity, 0f)), Is.Null);
        }

        [UnityTest]
        public IEnumerator ActionCycleUsesServerPetStateAndExistingWireContract()
        {
            GameObject root = null;
            GameObject hero = null;
            GalaQuestConnectionSession session = null;
            GalaQuestPetCampPresenter presenter = null;
            try
            {
                hero = new GameObject("Camp pet test hero");
                hero.transform.position = new Vector3(-3, 0, 1);
                root = new GameObject("Camp pet presenter test");
                var traversal = root.AddComponent<GalaQuestTraversalController>();
                traversal.Configure(null, hero.transform);
                presenter = root.AddComponent<GalaQuestPetCampPresenter>();
                var wire = new Wire();
                session = new GalaQuestConnectionSession(wire);
                presenter.BindSession(session);
                session.Begin(new GalaQuestSelectedProfile("profile-pet-camp", "Review", "[]"),
                    GalaQuestProtocolV4.HomeHubDestinationId);
                wire.Open();
                wire.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"worldEpoch\":0,"
                    + "\"destinationId\":\"home-hub\"}");
                yield return null;

                Assert.That(presenter.CurrentPetId, Is.EqualTo("worm_green"));
                Assert.That(presenter.CurrentAction, Is.EqualTo("befriend"));
                Assert.That(presenter.OwnsContextAction, Is.True);
                Assert.That(presenter.TryCurrentAction(), Is.True);
                Assert.That(wire.Sent[^1], Does.Contain("\"type\":\"pet-action\""));
                Assert.That(wire.Sent[^1], Does.Contain("\"action\":\"befriend\""));
                Assert.That(wire.Sent[^1], Does.Contain("\"petId\":\"worm_green\""));
                Assert.That(wire.Sent[^1], Does.Contain("\"rev\":0"));
                Assert.That(wire.Sent[^1], Does.Contain("\"worldEpoch\":0"));

                // Pending suppression: a second click without a server answer must not send.
                var countAfterFirst = wire.Sent.Count;
                Assert.That(presenter.TryCurrentAction(), Is.False);
                Assert.That(wire.Sent.Count, Is.EqualTo(countAfterFirst));

                // Authoritative state drives the next action (rest because equipped == this pet).
                wire.Receive(PetState("worm_green", 0));
                yield return null;
                Assert.That(presenter.CurrentAction, Is.EqualTo("rest"));
                Assert.That(presenter.TryCurrentAction(), Is.True);
                var follow = JObject.Parse(wire.Sent[^1]);
                Assert.That((string)follow["action"], Is.EqualTo("rest"));
                Assert.That((string)follow["petId"], Is.EqualTo("worm_green"));
                Assert.That((int)follow["rev"], Is.EqualTo(1));
                Assert.That((int)follow["worldEpoch"], Is.EqualTo(0));
                Assert.That(follow["type"].Value<string>(), Is.EqualTo("pet-action"));

                // Unique event ids and increasing rev across accepted transitions.
                wire.Receive(PetStateWithEquip(null, 1, "worm_green"));
                yield return null;
                Assert.That(presenter.CurrentAction, Is.EqualTo("follow"));
                Assert.That(presenter.TryCurrentAction(), Is.True);
                var followToUnequip = JObject.Parse(wire.Sent[^1]);
                var firstId = (string)follow["eventId"];
                var secondId = (string)followToUnequip["eventId"];
                Assert.That(secondId, Is.Not.EqualTo(firstId), "event ids must be unique per action");
                Assert.That((int)followToUnequip["rev"], Is.EqualTo(2));

                wire.Receive(PetState("worm_green", 2));
                yield return null;
                // Failed send must not latch pending state; retry permitted.
                wire.FailNextSend = true;
                Assert.That(presenter.TryCurrentAction(), Is.False);
                wire.FailNextSend = false;
                Assert.That(presenter.TryCurrentAction(), Is.True, "a failed transport send must allow retry");

                // Out-of-range: server rejects; presenter must surface the error and retain ownership.
                wire.Receive(PetState("worm_green", 3).Replace("\"pets\":", "\"error\":\"out-of-range\",\"pets\":"));
                yield return null;
                Assert.That(presenter.OwnsContextAction, Is.True);
                Assert.That(presenter.CurrentAction, Is.EqualTo("rest"));

                hero.transform.position = new Vector3(0, 0, 5);
                traversal.Configure(null, hero.transform);
                yield return null;
                var beforeOutOfRange = wire.Sent.Count;
                Assert.That(presenter.TryCurrentAction(), Is.False);
                Assert.That(wire.Sent.Count, Is.EqualTo(beforeOutOfRange));
                // Disconnect: no ownership, no send.
                wire.Close();
                yield return null;
                Assert.That(presenter.OwnsContextAction, Is.False);
                var beforeDisconnectSend = wire.Sent.Count;
                Assert.That(presenter.TryCurrentAction(), Is.False);
                Assert.That(wire.Sent.Count, Is.EqualTo(beforeDisconnectSend));
            }
            finally
            {
                if (presenter != null) presenter.BindSession(null);
                session?.Dispose();
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
                if (hero != null) UnityEngine.Object.DestroyImmediate(hero);
            }
        }

        [UnityTest]
        public IEnumerator GuardAgainstSendBeforeJoinOrTravelOrWrongDestination()
        {
            GameObject root = null;
            GalaQuestConnectionSession session = null;
            GalaQuestPetCampPresenter presenter = null;
            try
            {
                root = new GameObject("Camp pet guard test");
                presenter = root.AddComponent<GalaQuestPetCampPresenter>();
                var wire = new Wire();
                session = new GalaQuestConnectionSession(wire);
                presenter.BindSession(session);
                session.Begin(new GalaQuestSelectedProfile("profile-pet-guard", "Review", "[]"),
                    GalaQuestProtocolV4.HomeHubDestinationId);
                wire.Open();
                yield return null;

                var baseline = wire.Sent.Count;
                Assert.That(session.TrySendPetAction("befriend", "worm_green", Guid.NewGuid().ToString("N"), 0), Is.False,
                    "no pet-action may be sent before the join is acknowledged");
                Assert.That(wire.Sent.Count, Is.EqualTo(baseline));

                wire.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"worldEpoch\":0,"
                    + "\"destinationId\":\"emberworks-deep\"}");
                yield return null;
                Assert.That(session.DestinationId, Is.EqualTo(GalaQuestProtocolV4.EmberworksDeepDestinationId));
                var wrongDest = wire.Sent.Count;
                Assert.That(session.TrySendPetAction("befriend", "worm_green", Guid.NewGuid().ToString("N"), 0), Is.False,
                    "pet-action must be refused outside home-hub");
                Assert.That(wire.Sent.Count, Is.EqualTo(wrongDest));

                // Travel in progress must also refuse the send.
                Assert.That(session.RequestTravel(GalaQuestProtocolV4.HomeHubDestinationId), Is.True);
                var duringTravel = wire.Sent.Count;
                Assert.That(session.TrySendPetAction("befriend", "worm_green", Guid.NewGuid().ToString("N"), 0), Is.False,
                    "pet-action must be refused while travelling");
                Assert.That(wire.Sent.Count, Is.EqualTo(duringTravel));
            }
            finally
            {
                if (presenter != null) presenter.BindSession(null);
                session?.Dispose();
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [UnityTest]
        public IEnumerator ContextGestureKeepsOriginalTargetAndCancelsOnLeaving()
        {
            var hero = new GameObject("Gesture hero");
            hero.transform.position = new Vector3(-3, 0, 1);
            var root = new GameObject("Gesture fixture");
            var traversal = root.AddComponent<GalaQuestTraversalController>();
            traversal.Configure(null, hero.transform);
            var presenter = root.AddComponent<GalaQuestPetCampPresenter>();
            var wire = new Wire();
            using var session = new GalaQuestConnectionSession(wire);
            try
            {
                presenter.BindSession(session);
                session.Begin(new GalaQuestSelectedProfile("profile-gesture", "Review", "[]"), "home-hub");
                wire.Open();
                wire.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\",\"destinationId\":\"home-hub\",\"worldEpoch\":0}");
                yield return null;
                var viewport = new Vector2(390, 844);
                var point = GalaQuestDestinationPresentation.TravelButtonRect(viewport).center;
                var count = wire.Sent.Count;
                Assert.That(presenter.HandleContextPointer(EventType.MouseDown, point, viewport), Is.True);
                hero.transform.position = new Vector3(3, 0, 1); traversal.Configure(null, hero.transform);
                yield return null;
                Assert.That(presenter.CurrentPetId, Is.EqualTo("worm_red"));
                presenter.HandleContextPointer(EventType.MouseUp, point, viewport);
                Assert.That(wire.Sent.Count, Is.EqualTo(count), "pressing green then reaching red cannot befriend red");
                yield return null;
                presenter.HandleContextPointer(EventType.MouseDown, point, viewport);
                hero.transform.position = new Vector3(0, 0, 5); traversal.Configure(null, hero.transform);
                yield return null;
                Assert.That(presenter.CurrentPetId, Is.Null);
                Assert.That(presenter.OwnsContextAction, Is.True, "the held press cannot be inherited by Travel");
                presenter.HandleContextPointer(EventType.MouseUp, point, viewport);
                Assert.That(wire.Sent.Count, Is.EqualTo(count));
                yield return null;
                Assert.That(presenter.OwnsContextAction, Is.False);
                hero.transform.position = new Vector3(-3, 0, 1); traversal.Configure(null, hero.transform);
                yield return null;
                presenter.HandleContextPointer(EventType.MouseDown, point, viewport);
                presenter.HandleContextPointer(EventType.MouseUp, point, viewport);
                Assert.That(wire.Sent.Count, Is.EqualTo(count + 1));
                Assert.That((string)JObject.Parse(wire.Sent[^1])["petId"], Is.EqualTo("worm_green"));
                presenter.HandleContextPointer(EventType.MouseUp, point, viewport);
                Assert.That(wire.Sent.Count, Is.EqualTo(count + 1), "a release is not a second action");
            }
            finally
            {
                presenter.BindSession(null);
                UnityEngine.Object.DestroyImmediate(root);
                UnityEngine.Object.DestroyImmediate(hero);
            }
        }

        private static string PetState(string equipped, int rev) =>
            "{\"v\":4,\"type\":\"pet-state\",\"id\":\"p1\",\"worldEpoch\":0,\"destinationId\":\"home-hub\","
            + "\"pets\":{\"ownedPetIds\":[\"worm_green\",\"worm_red\"],\"equippedPetId\":"
            + (equipped == null ? "null" : "\"" + equipped + "\"") + ",\"equipRev\":" + rev + "}}";

        private static string PetStateWithEquip(string equipped, int rev, string owned) =>
            "{\"v\":4,\"type\":\"pet-state\",\"id\":\"p1\",\"worldEpoch\":0,\"destinationId\":\"home-hub\","
            + "\"pets\":{\"ownedPetIds\":[\"" + owned + "\"],\"equippedPetId\":"
            + (equipped == null ? "null" : "\"" + equipped + "\"") + ",\"equipRev\":" + rev + "}}";

        private static string PetError(string error) =>
            "{\"v\":4,\"type\":\"pet-state\",\"id\":\"p1\",\"worldEpoch\":0,\"destinationId\":\"home-hub\","
            + "\"error\":\"" + error + "\",\"pets\":{\"ownedPetIds\":[],\"equippedPetId\":null,\"equipRev\":-1}}";

        private sealed class Wire : IGalaQuestTransport
        {
            public readonly List<string> Sent = new List<string>();
            public bool FailNextSend;

            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;

            public void Connect() { }
            public bool Send(string message)
            {
                if (FailNextSend) { FailNextSend = false; return false; }
                Sent.Add(message);
                return true;
            }
            public void Close()
            {
                Closed?.Invoke(null);
            }
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
        }
    }
}
