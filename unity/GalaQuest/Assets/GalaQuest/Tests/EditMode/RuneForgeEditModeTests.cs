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
        // net/gameServerCore.mjs RUNE_FORGE_POSITION, and an approach inside RUNE_FORGE_REACH_METERS.
        private static readonly Vector3 ForgeWorldPosition = new Vector3(7.2f, 0f, 17.2f);
        private static readonly Vector3 ForgeApproachPosition = new Vector3(5f, 0f, 15f);
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
        public void QuestionRemainsTheServerQuestionDuringRetryAndHintFeedback()
        {
            foreach (var response in new[] { "retry", "hint", "independent-success" })
            {
                var state = JsonUtility.FromJson<GalaQuestRuneForgeState>(
                    "{\"status\":\"active\",\"task\":{\"displayPrompt\":\"In 4,582, what is the value of 5?\"}}");
                state.response = response;
                Assert.That(GalaQuestRuneForgePresenter.CurrentPrompt(state, false),
                    Is.EqualTo(state.task.displayPrompt));
            }
        }

        [Test]
        public void SelectionUsesTextAndBaseColourAndRestoresOnDeselection()
        {
            var root = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var text = new GameObject("Label"); text.transform.SetParent(root.transform);
            try
            {
                var mesh = text.AddComponent<TextMesh>(); mesh.text = "500";
                var control = root.AddComponent<GalaQuestRuneForgeInteractable>();
                control.Configure("rune", "500"); control.SetGlow(true, true); control.SetLabel("500");
                Assert.That(mesh.text, Is.EqualTo("> 500 <"));
                var block = new MaterialPropertyBlock(); root.GetComponent<Renderer>().GetPropertyBlock(block);
                Assert.That(block.HasColor("_BaseColor"), Is.True);
                control.SetGlow(true, false);
                Assert.That(mesh.text, Is.EqualTo("500"));
                root.GetComponent<Renderer>().GetPropertyBlock(block);
                Assert.That(block.HasColor("_BaseColor"), Is.False);
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
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

        [Test]
        public void PresenterFindsTheActivePreviewCameraWithoutRequiringTheMainCameraTag()
        {
            UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);
            var cameraObject = new GameObject("Forge review camera");
            var presenterObject = new GameObject("Forge presenter");
            try
            {
                cameraObject.tag = "Untagged";
                var camera = cameraObject.AddComponent<Camera>();
                var presenter = presenterObject.AddComponent<GalaQuestRuneForgePresenter>();
                Assert.That(Camera.main, Is.Null);
                var property = typeof(GalaQuestRuneForgePresenter).GetProperty("InteractionCamera",
                    System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                Assert.That(property, Is.Not.Null);
                Assert.That(property.GetValue(presenter), Is.SameAs(camera));
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(presenterObject);
                UnityEngine.Object.DestroyImmediate(cameraObject);
            }
        }

        [TestCase(1024, 768)]
        [TestCase(1366, 768)]
        [TestCase(844, 390)]
        [TestCase(390, 844)]
        [TestCase(390, 844, 5.576f, 15.304f)]
        [TestCase(390, 844, 6.199f, 16.017f)]
        public void EveryActiveForgeControlIsReachableAtItsOwnProjectedScreenPoint(int width, int height,
            float approachX = 5f, float approachZ = 15f)
        {
            var scene = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Single);
            GameObject pocket = null;
            GameObject heroObject = null;
            GameObject cameraObject = null;
            try
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(RuneForgeAuthoring.PocketPrefabPath);
                Assert.That(prefab, Is.Not.Null, "Run the bounded Rune Forge authoring command first.");
                pocket = (GameObject)PrefabUtility.InstantiatePrefab(prefab, scene);
                pocket.transform.position = ForgeWorldPosition;

                // Only the controls the presenter shows together while a task is active can hide
                // one another, so that is the arrangement the player actually has to work with.
                var active = new[] { "rune", "hammer", "hint", "hear" };
                foreach (var item in pocket.GetComponentsInChildren<GalaQuestRuneForgeInteractable>(true))
                    item.gameObject.SetActive(active.Contains(item.Kind));
                Physics.SyncTransforms();

                heroObject = new GameObject("Hero");
                heroObject.transform.position = new Vector3(approachX, .01f, approachZ);
                cameraObject = new GameObject("GalaQuestGameplayCamera");
                var camera = cameraObject.AddComponent<Camera>();
                camera.fieldOfView = 42f;
                camera.nearClipPlane = .1f;
                camera.farClipPlane = 160f;
                camera.pixelRect = new Rect(0, 0, width, height);
                var follow = cameraObject.AddComponent<GalaQuestGameplayCamera>();
                follow.Configure(heroObject.transform);
                // Required task controls must be discoverable at the ordinary approach,
                // before the player has made any camera gesture.

                var finder = typeof(GalaQuestRuneForgePresenter).GetMethod("FindInteractable",
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
                Assert.That(finder, Is.Not.Null);
                foreach (var item in pocket.GetComponentsInChildren<GalaQuestRuneForgeInteractable>(false))
                {
                    item.SetLabel(item.Kind == "rune" ? "6,000 + 700 + 20"
                        : item.Kind == "hammer" ? "STRIKE" : item.Kind.ToUpperInvariant());
                    foreach (var renderer in item.GetComponentsInChildren<Renderer>())
                    {
                        var bounds = renderer.bounds;
                        for (var corner = 0; corner < 8; corner++)
                        {
                            var world = bounds.center + Vector3.Scale(bounds.extents,
                                new Vector3((corner & 1) == 0 ? -1 : 1,
                                    (corner & 2) == 0 ? -1 : 1, (corner & 4) == 0 ? -1 : 1));
                            var pixel = camera.WorldToScreenPoint(world);
                            Assert.That(pixel.z > 0 && pixel.x >= 4 && pixel.x <= width - 4
                                && pixel.y >= 4 && pixel.y <= height - 4, Is.True,
                                item.name + "/" + renderer.name + " visible bounds leave default "
                                + width + "x" + height + " view: " + pixel);
                        }
                    }
                    // This is exactly what RecordBrowserControlDiagnostics offers the player and the
                    // browser driver as this control's tap point.
                    var point = camera.WorldToScreenPoint(item.transform.position);
                    Assert.That(point.z, Is.GreaterThan(0f), item.name + " projects behind the gameplay camera.");
                    Assert.That(new Rect(0, 0, width, height).Contains(point), Is.True,
                        item.name + " is outside the " + width + "x" + height + " viewport: " + point);
                    var winner = (GalaQuestRuneForgeInteractable)finder.Invoke(
                        null, new object[] { camera.ScreenPointToRay(point) });
                    Assert.That(winner, Is.SameAs(item), item.name + " (" + item.Kind
                        + ") cannot be tapped at its own projected point; "
                        + (winner == null ? "nothing" : winner.name + " (" + winner.Kind + ")")
                        + " is in front of it at the gameplay camera.");
                }
            }
            finally
            {
                if (cameraObject != null) UnityEngine.Object.DestroyImmediate(cameraObject);
                if (heroObject != null) UnityEngine.Object.DestroyImmediate(heroObject);
                if (pocket != null) UnityEngine.Object.DestroyImmediate(pocket);
            }
        }

        [Test]
        public void PhysicalForgeTapSkipsUnrelatedEmberworksColliderInFrontOfControl()
        {
            var blocker = GameObject.CreatePrimitive(PrimitiveType.Cube);
            var control = GameObject.CreatePrimitive(PrimitiveType.Cube);
            try
            {
                blocker.name = "Ordinary Emberworks geometry";
                blocker.transform.position = new Vector3(0f, 0f, -2f);
                control.name = "Number anvil";
                control.transform.position = Vector3.zero;
                var interactable = control.AddComponent<GalaQuestRuneForgeInteractable>();
                interactable.Configure("pack", "place-value-rounding");
                Physics.SyncTransforms();

                var ray = new Ray(new Vector3(0f, 0f, -10f), Vector3.forward);
                var finder = typeof(GalaQuestRuneForgePresenter).GetMethod("FindInteractable",
                    System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
                Assert.That(finder, Is.Not.Null);
                Assert.That(finder.Invoke(null, new object[] { ray }), Is.SameAs(interactable),
                    "Visible Forge controls remain usable when ordinary level collision is closer to the camera.");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(control);
                UnityEngine.Object.DestroyImmediate(blocker);
            }
        }

        [Test]
        public void PreviewUsesItsTraversalHeroWhenAnotherSceneHasTheSameHeroName()
        {
            var source = UnityEditor.SceneManagement.EditorSceneManager.OpenScene(
                EmberworksGreyboxBuild.ScenePath,
                UnityEditor.SceneManagement.OpenSceneMode.Single);
            var preview = UnityEditor.SceneManagement.EditorSceneManager.NewScene(
                UnityEditor.SceneManagement.NewSceneSetup.EmptyScene,
                UnityEditor.SceneManagement.NewSceneMode.Additive);
            UnityEngine.SceneManagement.SceneManager.SetActiveScene(preview);
            var content = ScriptableObject.CreateInstance<GalaQuestCombatContent>();
            try
            {
                new GameObject("EmberworksDeep");
                var runtime = new GameObject("Selected runtime");
                var hero = new GameObject(EmberworksGreyboxBuild.RuntimeHeroName).transform;
                runtime.AddComponent<GalaQuestTraversalController>().Configure(null, hero);
                RuneForgeAuthoring.ConfigurePreview(runtime, content);
                var presenter = runtime.GetComponent<GalaQuestRuneForgePresenter>();
                var binding = new SerializedObject(presenter).FindProperty("hero");
                Assert.That(binding.objectReferenceValue, Is.SameAs(hero));
                Assert.That(preview.GetRootGameObjects().Single(item => item.name == "EmberworksDeep")
                    .GetComponentsInChildren<GalaQuestRuneForgeInteractable>(true), Is.Not.Empty);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(content);
                UnityEditor.SceneManagement.EditorSceneManager.CloseScene(preview, true);
                UnityEngine.SceneManagement.SceneManager.SetActiveScene(source);
            }
        }

        [TestCase(1024, 768)]
        [TestCase(1366, 768)]
        [TestCase(390, 844)]
        [TestCase(844, 390)]
        public void ForgePromptLeavesStatusAndControlsVisible(int width, int height)
        {
            var viewport = new Vector2(width, height);
            var hud = new GalaQuestCombatHudLayout(viewport);
            var prompt = GalaQuestRuneForgePresenter.PromptRect(viewport);
            Assert.That(prompt.Overlaps(hud.Status) || prompt.Overlaps(hud.Identity) || prompt.Overlaps(hud.Mute), Is.False);
            Assert.That(prompt.Overlaps(hud.Attack) || prompt.Overlaps(hud.Movement)
                || prompt.Overlaps(hud.Travel), Is.False);
            Assert.That(prompt.xMin >= 0 && prompt.yMin >= 0 && prompt.xMax <= width
                && prompt.yMax <= height, Is.True);
        }

        [Test]
        public void HelmetKeepsAuthoredMetreDimensionsWhenWearableFitReplacesRootScale()
        {
            var definition = RuneForgeAuthoring.LoadHelmet();
            var instance = UnityEngine.Object.Instantiate(definition.SourceModel);
            try
            {
                var renderers = instance.GetComponentsInChildren<Renderer>();
                Bounds Measure() { var bounds = renderers[0].bounds; foreach (var r in renderers.Skip(1)) bounds.Encapsulate(r.bounds); return bounds; }
                var authoredSize = Measure().size;
                Assert.That(authoredSize.x, Is.GreaterThan(.5f), "The authored horn span is metre-scale.");
                instance.transform.localScale = definition.LocalScale;
                instance.transform.localRotation = Quaternion.Euler(definition.LocalEulerAngles);
                Assert.That(Vector3.Distance(Measure().size, Vector3.Scale(authoredSize, definition.LocalScale)),
                    Is.LessThan(.001f), "Wearable fit must preserve both FBX units and upright source axes.");
            }
            finally { UnityEngine.Object.DestroyImmediate(instance); }
        }

        [Test]
        public void HelmetMoltenFacePointsForwardFromTheHeadSocket()
        {
            var definition = RuneForgeAuthoring.LoadHelmet();
            var instance = UnityEngine.Object.Instantiate(definition.SourceModel);
            try
            {
                instance.transform.localRotation = definition.LocalRotation;
                instance.transform.localScale = definition.LocalScale;
                var renderers = instance.GetComponentsInChildren<Renderer>();
                var plate = renderers.Single(r => r.name == "ForgedPlate");
                var face = renderers.Single(r => r.name == "MoltenSeams");
                Assert.That(face.bounds.center.z, Is.GreaterThan(plate.bounds.center.z),
                    "The authored molten brow and cheek seams belong in front of the wearer.");
            }
            finally { UnityEngine.Object.DestroyImmediate(instance); }
        }

        [Test]
        public void PhysicalRuneLabelsAreNotFlattenedByTheirAnvilScale()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(RuneForgeAuthoring.PocketPrefabPath);
            var instance = UnityEngine.Object.Instantiate(prefab);
            try
            {
                foreach (var control in instance.GetComponentsInChildren<GalaQuestRuneForgeInteractable>(true))
                {
                    control.SetLabel(control.Kind == "rune" ? "5,000" : "STRIKE");
                    var label = control.GetComponentInChildren<TextMesh>(true);
                    var scale = label.transform.lossyScale;
                    Assert.That(scale.y, Is.EqualTo(scale.x).Within(.0001f), control.name + " flattens its text.");
                    Assert.That(label.GetComponent<Renderer>().bounds.size.y, Is.GreaterThan(.14f),
                        control.name + " must have readable world text at the established approach distance.");
                }
            }
            finally { UnityEngine.Object.DestroyImmediate(instance); }
        }

        [Test]
        public void SiblingHealthBarYieldsToAnActualProjectedRuneButNotClearSpace()
        {
            var pocket = UnityEngine.Object.Instantiate(AssetDatabase.LoadAssetAtPath<GameObject>(RuneForgeAuthoring.PocketPrefabPath));
            var cameraObject = new GameObject("Projection camera");
            try
            {
                var camera = cameraObject.AddComponent<Camera>();
                camera.pixelRect = new Rect(0, 0, 390, 844);
                var rune = pocket.GetComponentsInChildren<GalaQuestRuneForgeInteractable>(true).First(c => c.Kind == "rune");
                rune.gameObject.SetActive(true);
                camera.transform.position = rune.transform.position + new Vector3(0, 2, -8);
                camera.transform.LookAt(rune.transform);
                var projected = camera.WorldToScreenPoint(rune.transform.position);
                var bar = new Rect(projected.x - 40, 844 - projected.y - 2, 80, 13);
                Assert.That(GalaQuestRuneForgePresenter.OverlapsControlProjection(bar, camera, new[] { rune }, 844), Is.True,
                    "A sibling bar cannot obscure the physical answer it projects over.");
                Assert.That(GalaQuestRuneForgePresenter.OverlapsControlProjection(new Rect(0, 0, 20, 10), camera, new[] { rune }, 844), Is.False);
                rune.gameObject.SetActive(false);
                Assert.That(GalaQuestRuneForgePresenter.OverlapsControlProjection(bar, camera, new[] { rune }, 844), Is.False,
                    "Inactive Forge controls must not hide ordinary health feedback.");
            }
            finally { UnityEngine.Object.DestroyImmediate(cameraObject); UnityEngine.Object.DestroyImmediate(pocket); }
        }

        [Test]
        public void ExpandedFormLabelWrapsWithoutChangingTheAnswerIdentity()
        {
            var root = new GameObject("Rune");
            try
            {
                var label = new GameObject("Label");
                label.transform.SetParent(root.transform);
                var mesh = label.AddComponent<TextMesh>();
                var rune = root.AddComponent<GalaQuestRuneForgeInteractable>();
                rune.Configure("rune", "expanded-correct");
                rune.SetLabel("6,000 + 700 + 20");
                Assert.That(mesh.text, Is.EqualTo("6,000 +\n700 +\n20"));
                rune.SetGlow(true, true);
                Assert.That(mesh.text, Does.Contain("6,000 +\n700 +\n20"));
                Assert.That(rune.Value, Is.EqualTo("expanded-correct"));
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
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
