using System;
using System.Collections;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class U2CombatPresentationPlayModeTests
    {
        [UnityTest]
        public IEnumerator MagmaLordHelmetFollowsAuthoritativeEquipmentForLocalAndSibling()
        {
#if UNITY_EDITOR
            GameObject root = null;
            GameObject hero = null;
            GameObject template = null;
            GalaQuestCombatContent content = null;
            GalaQuestConnectionSession session = null;
            GalaQuestCombatPresentation presentation = null;
            try
            {
                var author = Type.GetType("GalaQuest.Editor.RuneForgeAuthoring, GalaQuest.Editor", true);
                var helmet = (GalaQuest.Gear.GearItemDefinition)author.GetMethod("LoadHelmet").Invoke(null, null);
                hero = HeroWithHeadSocket("Local hero");
                template = HeroWithHeadSocket("Remote hero template");
                content = ScriptableObject.CreateInstance<GalaQuestCombatContent>();
                content.HeroPrefab = template;
                content.MagmaLordHelmet = helmet;
                root = new GameObject("Helmet presentation test");
                var traversal = root.AddComponent<GalaQuestTraversalController>();
                traversal.Configure(null, hero.transform);
                presentation = root.AddComponent<GalaQuestCombatPresentation>();
                presentation.Configure(content);
                var transport = new FakeTransport();
                session = new GalaQuestConnectionSession(transport);
                presentation.BindSession(session);
                session.Begin(new GalaQuestSelectedProfile("profile-helmet-review", "Review", "[]"));
                transport.Open();
                transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");

                var frame = HelmetFrame(1, true, true);
                presentation.ApplyFrame(frame);
                yield return null;
                Assert.That(hero.GetComponentsInChildren<Transform>(true).Count(item => item.name == "MagmaLord Helmet"), Is.EqualTo(1));
                var sibling = GameObject.Find("Other hero p2");
                Assert.That(sibling, Is.Not.Null);
                Assert.That(sibling.GetComponentsInChildren<Transform>(true).Count(item => item.name == "MagmaLord Helmet"), Is.EqualTo(1),
                    "The narrow observer representation follows that sibling's authoritative equipment state.");

                presentation.ApplyFrame(HelmetFrame(2, false, false));
                yield return null;
                yield return null;
                Assert.That(hero.GetComponentsInChildren<Transform>(true).Any(item => item.name == "MagmaLord Helmet"), Is.False);
                Assert.That(sibling.GetComponentsInChildren<Transform>(true).Any(item => item.name == "MagmaLord Helmet"), Is.False);
            }
            finally
            {
                if (presentation != null) presentation.BindSession(null);
                session?.Dispose();
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
                if (hero != null) UnityEngine.Object.DestroyImmediate(hero);
                if (template != null) UnityEngine.Object.DestroyImmediate(template);
                if (content != null) UnityEngine.Object.DestroyImmediate(content);
            }
#else
            Assert.Ignore("The candidate asset is loaded through its Editor authoring seam.");
            yield break;
#endif
        }

        [UnityTest]
        public IEnumerator RealCandidateAndHeroConsumeDamageDefeatRecoveryAndReconnect()
        {
#if UNITY_EDITOR
            if (Environment.GetEnvironmentVariable("GQ_U2_REVIEW") != "1") Assert.Ignore("Optional custody-tier combined combat review");
            // Editor authoring is invoked only in this optional Editor run; the test
            // assembly remains runnable in players without an Editor assembly reference.
            var author = Type.GetType("GalaQuest.Editor.U2CombatPreview, GalaQuest.Editor", true);
            GameObject root = null;
            GameObject hero = null;
            GalaQuestConnectionSession session = null;
            GalaQuestCombatPresentation presentation = null;
            try
            {
                var content = (GalaQuestCombatContent)author.GetMethod("Prepare").Invoke(null, null);
                hero = UnityEngine.Object.Instantiate(content.HeroPrefab, new Vector3(0, .25f, 4), Quaternion.identity);
                root = new GameObject("Combined combat test");
                var floor = GameObject.CreatePrimitive(PrimitiveType.Cube);
                floor.name = "Raised combat floor";
                floor.AddComponent<GalaQuestGroundSurface>();
                floor.transform.SetParent(root.transform);
                floor.transform.position = new Vector3(-4, .15f, 8);
                floor.transform.localScale = new Vector3(8, .7f, 8);
                var decoration = GameObject.CreatePrimitive(PrimitiveType.Cube);
                decoration.name = "Unmarked decoration is not walkable";
                decoration.transform.SetParent(root.transform);
                decoration.transform.position = new Vector3(-4, 1, 7.5f);
                decoration.transform.localScale = Vector3.one * .25f;
                decoration.GetComponent<Renderer>().enabled = false;
                var traversal = root.AddComponent<GalaQuestTraversalController>();
                traversal.Configure(null, hero.transform);
                var attack = root.AddComponent<GalaQuestAttackControl>();
                presentation = root.AddComponent<GalaQuestCombatPresentation>();
                presentation.Configure(content);
                var transport = new FakeTransport();
                session = new GalaQuestConnectionSession(transport);
                traversal.BindSession(session);
                attack.BindSession(session);
                presentation.BindSession(session);
                session.Begin(new GalaQuestSelectedProfile("profile-aaaaaaaa", "Review", "[]"));
                transport.Open();
                transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");
                var frame = JsonConvert.DeserializeObject<GalaQuestServerFrame>(File.ReadAllText("Assets/GalaQuest/Tests/Fixtures/U2CombatSnapshot.json"));
                transport.Receive(JsonConvert.SerializeObject(frame));
                yield return null;
                yield return null;
                Assert.That(presentation.EnemyViewCount, Is.EqualTo(1));
                Assert.That(presentation.RemoteHeroCount, Is.EqualTo(1));
                Assert.That(presentation.LocalHealth, Is.EqualTo(30));
                Assert.That(hero.transform.position.y, Is.EqualTo(floor.GetComponent<Collider>().bounds.max.y + .01f).Within(.002f),
                    "Feet clear the actual floor; an unmarked prop above it is not a floor");
                Assert.That(hero.GetComponent<Animator>().HasState(0, Animator.StringToHash("slash")), Is.True);
                Assert.That(hero.GetComponent<GalaQuestCombatMotion>().CurrentState, Is.EqualTo("slash"));
                var weapon = hero.GetComponentsInChildren<Transform>().Single(item => item.name == "Ironwood sword (starter review)");
                Assert.That(weapon.parent.name, Is.EqualTo("Socket_rightHand"));
                var hand = weapon.parent;
                var handBefore = hand.position;
                if (Environment.GetEnvironmentVariable("GQ_U2_CAPTURE") == "1")
                    CaptureWeapon(root, hero, "slash-start");
                yield return new WaitForSecondsRealtime(.25f);
                Assert.That(Vector3.Distance(handBefore, hand.position), Is.GreaterThan(.025f), "The native slash actually moves the weapon hand");
                if (Environment.GetEnvironmentVariable("GQ_U2_CAPTURE") == "1")
                {
                    CaptureWeapon(root, hero, "slash-contact");
                    yield return new WaitForSecondsRealtime(.35f);
                    CaptureWeapon(root, hero, "slash-recovery");
                }
                var enemy = GameObject.Find("Enemy emberworks-gremlin-1");
                Assert.That(enemy.GetComponentsInChildren<SkinnedMeshRenderer>(), Is.Not.Empty, "actual skinned candidate, not a proxy");
                var attackArea = enemy.transform.Find("Bash warning");
                Assert.That(attackArea, Is.Not.Null);

                frame.tick++;
                frame.encounter.enemies[0].mode = "bite";
                frame.encounter.enemies[0].modeSeconds = .2f;
                frame.encounter.heroes["p1"].swingSeconds = -1;
                frame.encounter.heroes["p1"].hp = 24;
                frame.events = new[] { new GalaQuestServerCombatEvent { type = "hero-hurt", heroId = "p1" } };
                transport.Receive(JsonConvert.SerializeObject(frame));
                yield return null;
                Assert.That(presentation.LocalHealth, Is.EqualTo(24));
                if (Environment.GetEnvironmentVariable("GQ_U2_GRIP_REVIEW") == "1") CaptureWeapon(root, hero, "hit");
                Assert.That(enemy.GetComponent<GalaQuestCombatMotion>().CurrentState, Is.EqualTo("bash"));
                Assert.That(attackArea.gameObject.activeSelf, Is.True);
                Assert.That(attackArea.position.y, Is.GreaterThan(floor.GetComponent<Collider>().bounds.max.y),
                    "An active warning buried under the raised arena is invisible in the browser");
                frame.tick++;
                frame.encounter.enemies[0].modeSeconds = .8f;
                frame.events = Array.Empty<GalaQuestServerCombatEvent>();
                transport.Receive(JsonConvert.SerializeObject(frame));
                yield return null;
                Assert.That(attackArea.gameObject.activeSelf, Is.False, "warning ends at contact, not after recovery");

                frame.tick++;
                frame.encounter.enemies[0].mode = "dying";
                frame.encounter.enemies[0].modeSeconds = .1f;
                frame.encounter.enemies[0].hp = 0;
                frame.encounter.heroes["p1"].hp = 0;
                frame.encounter.heroes["p1"].downSeconds = .2f;
                transport.Receive(JsonConvert.SerializeObject(frame));
                yield return null;
                Assert.That(attack.TryAttack(), Is.False);
                var downPosition = traversal.PredictedPosition;
                traversal.StepPrediction(Vector2.up, 1, false, .1f);
                traversal.StepPrediction(Vector2.up, 1, false, .1f);
                Assert.That(traversal.PredictedPosition, Is.EqualTo(downPosition));
                Assert.That(enemy.GetComponent<GalaQuestCombatMotion>().CurrentState, Is.EqualTo("death"));
                if (Environment.GetEnvironmentVariable("GQ_U2_GRIP_REVIEW") == "1") CaptureWeapon(root, hero, "down");

                frame.tick++;
                frame.encounter.heroes["p1"].hp = 30;
                frame.encounter.heroes["p1"].downSeconds = -1;
                frame.players = frame.players.Where(player => player.id == "p1").ToArray();
                frame.players[0].x = 0; frame.players[0].z = 4;
                transport.Receive(JsonConvert.SerializeObject(frame));
                yield return null;
                yield return null;
                Assert.That(traversal.PredictedPosition, Is.EqualTo(new Vector2(0, 4)));
                Assert.That(presentation.RemoteHeroCount, Is.Zero);
                transport.Close();
                yield return null;
                Assert.That(presentation.EnemyViewCount, Is.Zero);
                Assert.That(presentation.RemoteHeroCount, Is.Zero);
                session.Reconnect(); transport.Open();
                transport.Receive("{\"v\":4,\"type\":\"welcome\",\"id\":\"p1\"}");
                frame.tick = 1;
                frame.encounter.enemies[0].hp = 30;
                frame.encounter.enemies[0].mode = "idle";
                frame.encounter.enemies[0].modeSeconds = 0;
                transport.Receive(JsonConvert.SerializeObject(frame));
                yield return null;
                Assert.That(presentation.EnemyViewCount, Is.EqualTo(1));
                Assert.That(presentation.LocalHealth, Is.EqualTo(30));
                if (Environment.GetEnvironmentVariable("GQ_U2_GRIP_REVIEW") == "1") CaptureWeapon(root, hero, "rejoined");
            }
            finally
            {
                if (presentation != null) presentation.BindSession(null);
                session?.Dispose();
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
                if (hero != null) UnityEngine.Object.DestroyImmediate(hero);
                author.GetMethod("Cleanup").Invoke(null, null);
            }
#else
            Assert.Ignore("Candidate authoring review requires the Editor");
            yield break;
#endif
        }

        private static void CaptureWeapon(GameObject root, GameObject hero, string label)
        {
            var lightObject = new GameObject("Weapon diagnostic key");
            lightObject.transform.SetParent(root.transform);
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional; light.intensity = 1.6f;
            light.transform.rotation = Quaternion.Euler(35, -25, 0);
            var cameraObject = new GameObject("Weapon diagnostic camera");
            cameraObject.transform.SetParent(root.transform);
            var camera = cameraObject.AddComponent<Camera>();
            camera.transform.position = hero.transform.position + new Vector3(2.4f, 1.4f, 3.2f);
            camera.transform.LookAt(hero.transform.position + Vector3.up * .75f);
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.22f, .25f, .3f);
            camera.fieldOfView = 34;
            var target = new RenderTexture(1000, 800, 24);
            var old = RenderTexture.active;
            var pixels = new Texture2D(1000, 800, TextureFormat.RGB24, false);
            try
            {
                camera.targetTexture = target; camera.Render(); RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, 1000, 800), 0, 0); pixels.Apply();
                var gripReview = Environment.GetEnvironmentVariable("GQ_U2_GRIP_REVIEW") == "1";
                var folder = Path.GetFullPath(Path.Combine(Application.dataPath, gripReview
                    ? "../../../.local/m2/hero-grip-candidate/unity-review" : "../../../.local/m2/weapon-review"));
                Directory.CreateDirectory(folder); File.WriteAllBytes(Path.Combine(folder, label + ".png"), pixels.EncodeToPNG());
                if (gripReview)
                {
                    var grip = hero.GetComponentsInChildren<Transform>().Single(t => t.name == "CandidateRightGrip");
                    camera.fieldOfView = 32;
                    camera.nearClipPlane = .01f;
                    foreach (var view in new[] { "back", "palm" })
                    {
                        camera.transform.position = grip.position + grip.forward * (view == "back" ? .48f : -.48f) + grip.right * .2f;
                        camera.transform.LookAt(grip.position, grip.up);
                        camera.Render(); pixels.ReadPixels(new Rect(0, 0, 1000, 800), 0, 0); pixels.Apply();
                        File.WriteAllBytes(Path.Combine(folder, label + "-grip-" + view + ".png"), pixels.EncodeToPNG());
                    }
                }
            }
            finally
            {
                RenderTexture.active = old; camera.targetTexture = null;
                UnityEngine.Object.DestroyImmediate(target); UnityEngine.Object.DestroyImmediate(pixels);
                UnityEngine.Object.DestroyImmediate(cameraObject); UnityEngine.Object.DestroyImmediate(lightObject);
            }
        }

#if UNITY_EDITOR
        private static GameObject HeroWithHeadSocket(string name)
        {
            var hero = new GameObject(name);
            var socketObject = new GameObject("Socket_head");
            socketObject.transform.SetParent(hero.transform, false);
            socketObject.AddComponent<GalaQuest.Gear.GearSocket>().Configure(GalaQuest.Gear.GearSocketIds.Head, "Head");
            return hero;
        }

        private static GalaQuestServerFrame HelmetFrame(int tick, bool localEquipped, bool siblingEquipped)
        {
            var frame = new GalaQuestServerFrame
            {
                type = "state",
                tick = tick,
                destinationId = GalaQuestProtocolV4.EmberworksDeepDestinationId,
                players = new[]
                {
                    new GalaQuestServerPlayer { id = "p1", x = 0, z = 0 },
                    new GalaQuestServerPlayer { id = "p2", x = 1, z = 0 },
                },
            };
            frame.encounter.heroes["p1"] = new GalaQuestServerHeroCombat { hp = 30, maxHp = 30 };
            frame.encounter.heroes["p2"] = new GalaQuestServerHeroCombat { hp = 30, maxHp = 30 };
            frame.encounter.rewards["p1"] = Reward(localEquipped);
            frame.encounter.rewards["p2"] = Reward(siblingEquipped);
            return frame;
        }

        private static GalaQuestServerRewards Reward(bool equipped)
        {
            var reward = new GalaQuestServerRewards();
            if (equipped) reward.equippedItemIds["helmet"] = GalaQuestRuneForgePresenter.MagmaLordItemId;
            return reward;
        }
#endif

        private sealed class FakeTransport : IGalaQuestTransport
        {
            public event Action Opened;
            public event Action<string> MessageReceived;
            public event Action<string> Closed;
            public void Connect() { }
            public bool Send(string message) => true;
            public void Close() => Closed?.Invoke("interrupted");
            public void Open() => Opened?.Invoke();
            public void Receive(string message) => MessageReceived?.Invoke(message);
        }
    }
}
