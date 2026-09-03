using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using GalaQuest;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.Rendering;

namespace GalaQuest.Editor
{
    /// <summary>
    /// Deterministic authoring and review entry points for the first Emberworks Deep greybox.
    /// The scene is deliberately authored from primitives so the level question is reviewable before
    /// production props, enemies, equipment, or player migration exist.
    /// </summary>
    public static class EmberworksGreyboxBuild
    {
        public const string ScenePath = "Assets/GalaQuest/Emberworks/Scenes/EmberworksDeep.unity";

        private const string RootName = "EmberworksDeep";
        private const string StateName = "EmberworksCompletionState";
        private const int CaptureWidth = 1280;
        private const int CaptureHeight = 720;

        // Reference convention: readable staged dungeons keep cool dark rock as the field, then
        // reserve hot orange light and broad warm masses for danger, reward, and payoff landmarks.
        private static readonly Color Basalt = new Color(0.09f, 0.105f, 0.15f);
        private static readonly Color BasaltEdge = new Color(0.20f, 0.23f, 0.30f);
        private static readonly Color Iron = new Color(0.27f, 0.29f, 0.31f);
        private static readonly Color Copper = new Color(0.46f, 0.16f, 0.055f);
        private static readonly Color Ember = new Color(1.45f, 0.12f, 0.015f);
        private static readonly Color EmberSoft = new Color(0.85f, 0.035f, 0.005f);
        private static readonly Color Reward = new Color(0.95f, 0.38f, 0.06f);

        [MenuItem("GalaQuest/Emberworks/Build Greybox")]
        public static void Build()
        {
            EnsureFolder("Assets/GalaQuest/Emberworks");
            EnsureFolder("Assets/GalaQuest/Emberworks/Materials");
            EnsureFolder("Assets/GalaQuest/Emberworks/Scenes");

            var materials = CreateMaterials();
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "EmberworksDeep";

            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.105f, 0.12f, 0.17f);
            RenderSettings.fog = true;
            RenderSettings.fogColor = new Color(0.025f, 0.03f, 0.045f);
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.012f;

            var root = new GameObject(RootName);
            var environment = Child(root, "Environment");
            var arrival = Child(root, "01_CinderGate_Arrival");
            var action = Child(root, "02_ImmediateAction_SmallAggressive");
            var express = Child(root, "03_LavaExpress_Setpiece");
            var heavy = Child(root, "04_HeavyEncounter_Positional");
            var reward = Child(root, "05_VisibleReward_Emberplate");
            var forge = Child(root, "06_Climax_ForgeChamber");

            BuildEnvironment(environment, materials);
            BuildCinderGate(arrival, materials);
            BuildImmediateAction(action, materials);
            BuildLavaExpress(express, materials);
            BuildHeavyEncounter(heavy, materials);
            BuildReward(reward, materials);
            var stateObjects = BuildForge(forge, materials);

            var state = root.AddComponent<EmberworksSceneState>();
            state.Configure(stateObjects.dormant, stateObjects.relit, stateObjects.lights);
            state.SetForgeRelit(false);

            BuildLighting(root.transform);
            BuildReviewCameras(root.transform);
            AddBuildScene(ScenePath);

            EditorSceneManager.SaveScene(scene, ScenePath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Validate();
            UnityEngine.Debug.Log($"Emberworks greybox built: {ScenePath}");
        }

        [MenuItem("GalaQuest/Emberworks/Validate Greybox")]
        public static void Validate()
        {
            var scene = SceneManager.GetActiveScene();
            if (scene.path != ScenePath)
            {
                throw new BuildFailedException($"Expected active Emberworks scene at {ScenePath}, got {scene.path}.");
            }

            var root = FindSceneObject(RootName);
            if (root == null)
            {
                throw new BuildFailedException($"Missing scene root: {RootName}");
            }

            var state = root.GetComponent<EmberworksSceneState>();
            if (state == null)
            {
                throw new BuildFailedException("Missing bounded Emberworks completion-state component.");
            }

            var required = new[]
            {
                "01_CinderGate_Arrival",
                "02_ImmediateAction_SmallAggressive",
                "03_LavaExpress_Setpiece",
                "04_HeavyEncounter_Positional",
                "05_VisibleReward_Emberplate",
                "06_Climax_ForgeChamber",
                "CinderGate_Landing",
                "Role_SmallAggressiveLavaCreature_01",
                "Role_HeavyPositionalOreGuardian",
                "LavaExpress_TrackPair",
                "ExpressLavaGap",
                "Emberplate_RewardDisplay",
                "KongOre_BossAnchor",
                "ForgeRelitState",
                "ReviewOverviewCamera",
                "ReviewCinderGateCamera",
                "ReviewImmediateActionCamera",
                "ReviewLavaExpressCamera",
                "ReviewHeavyEncounterCamera",
                "ReviewRewardCamera",
                "ReviewForgeCamera",
                "ReviewCompletionCamera"
            };
            foreach (var name in required)
            {
                if (FindSceneObject(name) == null)
                {
                    throw new BuildFailedException($"Emberworks greybox is missing required authored beat/object: {name}");
                }
            }

            var beatZ = new[]
            {
                FindSceneObject("01_CinderGate_Arrival").transform.position.z,
                FindSceneObject("02_ImmediateAction_SmallAggressive").transform.position.z,
                FindSceneObject("03_LavaExpress_Setpiece").transform.position.z,
                FindSceneObject("04_HeavyEncounter_Positional").transform.position.z,
                FindSceneObject("05_VisibleReward_Emberplate").transform.position.z,
                FindSceneObject("06_Climax_ForgeChamber").transform.position.z
            };
            for (var index = 1; index < beatZ.Length; index++)
            {
                if (beatZ[index] <= beatZ[index - 1] || beatZ[index] - beatZ[index - 1] > 14f)
                {
                    throw new BuildFailedException("Emberworks meaningful beats are not ordered with deliberately short traversal.");
                }
            }

            var beatX = new[]
            {
                FindSceneObject("01_CinderGate_Arrival").transform.position.x,
                FindSceneObject("02_ImmediateAction_SmallAggressive").transform.position.x,
                FindSceneObject("03_LavaExpress_Setpiece").transform.position.x,
                FindSceneObject("04_HeavyEncounter_Positional").transform.position.x,
                FindSceneObject("05_VisibleReward_Emberplate").transform.position.x,
                FindSceneObject("06_Climax_ForgeChamber").transform.position.x
            };
            if (Mathf.Abs(beatX[1] - beatX[0]) < 3f || Mathf.Abs(beatX[2] - beatX[1]) < 3f)
            {
                throw new BuildFailedException("Emberworks spatial revision must include a meaningful route turn before the setpiece.");
            }

            var buildScene = EditorBuildSettings.scenes.FirstOrDefault(item => item.path == ScenePath);
            if (!buildScene.enabled)
            {
                throw new BuildFailedException("Emberworks scene is not enabled in EditorBuildSettings.");
            }

            UnityEngine.Debug.Log(
                $"Emberworks greybox validation passed: 7 authored beats, " +
                $"{UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None).Length} cameras, " +
                $"traversal span {beatZ[beatZ.Length - 1] - beatZ[0]:0.0}m, " +
                $"completion default relit={state.ForgeRelit}.");
        }

        [MenuItem("GalaQuest/Emberworks/Capture Review Pack")]
        public static void CaptureReviewPack()
        {
            if (SceneManager.GetActiveScene().path != ScenePath)
            {
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }

            var root = FindSceneObject(RootName);
            var state = root == null ? null : root.GetComponent<EmberworksSceneState>();
            if (state == null)
            {
                throw new BuildFailedException("Cannot capture Emberworks review pack without scene state.");
            }

            var repositoryRoot = new DirectoryInfo(Application.dataPath).Parent.Parent.Parent.FullName;
            var outputRoot = Path.Combine(repositoryRoot, ".local", "unity", "review-pack", "emberworks-v0");
            Directory.CreateDirectory(outputRoot);
            foreach (var oldCapture in Directory.GetFiles(outputRoot, "*.png"))
            {
                File.Delete(oldCapture);
            }

            state.SetForgeRelit(false);
            var captures = new List<CameraCapture>
            {
                CaptureCamera(outputRoot, "ReviewOverviewCamera", "01-overview.png", "overview"),
                CaptureCamera(outputRoot, "ReviewCinderGateCamera", "02-cinder-gate.png", "cinder-gate"),
                CaptureCamera(outputRoot, "ReviewImmediateActionCamera", "03-immediate-action.png", "immediate-action"),
                CaptureCamera(outputRoot, "ReviewLavaExpressCamera", "04-lava-express.png", "lava-express"),
                CaptureCamera(outputRoot, "ReviewHeavyEncounterCamera", "05-heavy-encounter.png", "heavy-encounter"),
                CaptureCamera(outputRoot, "ReviewRewardCamera", "06-emberplate-reward.png", "emberplate-reward"),
                CaptureCamera(outputRoot, "ReviewForgeCamera", "07-forge-dormant.png", "forge-dormant")
            };

            state.SetForgeRelit(true);
            captures.Add(CaptureCamera(outputRoot, "ReviewCompletionCamera", "08-completion-relit.png", "completion-relit"));
            state.SetForgeRelit(false);
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            EditorSceneManager.SaveScene(SceneManager.GetActiveScene());

            var manifest = new ReviewManifest
            {
                schema = "galaquest.unity-emberworks-review-pack",
                schemaVersion = 1,
                gitSha = ReadGitSha(repositoryRoot),
                unityVersion = Application.unityVersion,
                platform = Application.platform.ToString(),
                buildTarget = EditorUserBuildSettings.activeBuildTarget.ToString(),
                scene = ScenePath,
                captureState = "fixed-camera-editor-render;primitive-greybox;no-player-traversal",
                visualConvention = "compact staged adventure: offset entry cavern, bent elevated lava bridge, distinct arena, open reward reveal, larger forge payoff",
                strongestDefect = "Forge dormant still has weak value separation: the unlit basin and focal region sit close to the surrounding basalt, so the dormant state reads less decisively than the relit flame even though both compositions are now unobstructed.",
                gameplayTraversalReadability = "UNKNOWN: no player/controller seam exists for Emberworks, so these are fixed-camera Editor captures rather than running-game traversal evidence.",
                captures = captures.ToArray()
            };
            File.WriteAllText(Path.Combine(outputRoot, "review-manifest.json"), JsonUtility.ToJson(manifest, true) + "\n");
            AssetDatabase.Refresh();
            UnityEngine.Debug.Log($"Emberworks review pack captured: {outputRoot} ({captures.Count} screenshots)");
        }

        private static Dictionary<string, Material> CreateMaterials()
        {
            return new Dictionary<string, Material>
            {
                ["basalt"] = CreateMaterial("Basalt", Basalt, 0.05f, 0.25f, Color.black, 0f),
                ["basaltEdge"] = CreateMaterial("BasaltEdge", BasaltEdge, 0.1f, 0.32f, Color.black, 0f),
                ["iron"] = CreateMaterial("ForgeIron", Iron, 0.75f, 0.38f, Color.black, 0f),
                ["copper"] = CreateMaterial("ForgeCopper", Copper, 0.65f, 0.3f, Color.black, 0f),
                ["ember"] = CreateMaterial("MoltenEmber", Ember, 0.05f, 0.2f, Ember, 4.5f),
                ["emberSoft"] = CreateMaterial("EmberSoft", EmberSoft, 0.05f, 0.2f, EmberSoft, 2.2f),
                ["reward"] = CreateMaterial("EmberplateReward", Reward, 0.8f, 0.25f, new Color(0.3f, 0.04f, 0.005f), 0.4f),
            };
        }

        private static Material CreateMaterial(string name, Color color, float metallic, float smoothness, Color emission, float emissionStrength)
        {
            var path = $"Assets/GalaQuest/Emberworks/Materials/{name}.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"))
                {
                    name = name
                };
                AssetDatabase.CreateAsset(material, path);
            }

            material.color = color;
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (material.HasProperty("_Metallic")) material.SetFloat("_Metallic", metallic);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            if (material.HasProperty("_EmissionColor"))
            {
                material.SetColor("_EmissionColor", emission * emissionStrength);
                if (emissionStrength > 0f) material.EnableKeyword("_EMISSION");
                else material.DisableKeyword("_EMISSION");
            }
            EditorUtility.SetDirty(material);
            return material;
        }

        private static void BuildEnvironment(GameObject environment, Dictionary<string, Material> m)
        {
            Cube("DeepFloor", environment.transform, new Vector3(0f, -0.25f, 31f), new Vector3(42f, 0.5f, 88f), m["basalt"]);
            Cube("LeftCavernWall", environment.transform, new Vector3(-21f, 5f, 31f), new Vector3(2f, 11f, 88f), m["basalt"]);
            Cube("RightCavernWall", environment.transform, new Vector3(21f, 5f, 31f), new Vector3(2f, 11f, 88f), m["basalt"]);
            Cube("CeilingBeamNorth", environment.transform, new Vector3(0f, 10.5f, 8f), new Vector3(36f, 1f, 1.2f), m["basaltEdge"]);
            Cube("CeilingBeamMid", environment.transform, new Vector3(4f, 10.5f, 31f), new Vector3(30f, 1f, 1.2f), m["basaltEdge"]);
            // Sightline cleanup: keep the forge structural beam overhead without cutting across the focal read.
            Cube("CeilingBeamForge", environment.transform, new Vector3(3f, 12.5f, 58f), new Vector3(36f, 0.6f, 1.2f), m["basaltEdge"]);

            foreach (var z in new[] { 5f, 17f, 29f, 43f, 59f })
            {
                Cube($"LavaChannelLeft_{z:0}", environment.transform, new Vector3(-12.5f, 0.035f, z), new Vector3(1.4f, 0.08f, 8f), m["ember"]);
                Cube($"LavaChannelRight_{z:0}", environment.transform, new Vector3(12.5f, 0.035f, z), new Vector3(1.4f, 0.08f, 8f), m["emberSoft"]);
            }

            var buttresses = new[]
            {
                new Vector3(-18f, 4f, 8f), new Vector3(18f, 5f, 17f),
                new Vector3(-18f, 3f, 29f), new Vector3(18f, 4f, 43f),
                new Vector3(-18f, 5f, 59f), new Vector3(18f, 3f, 68f)
            };
            for (var index = 0; index < buttresses.Length; index++)
            {
                var scale = buttresses[index].y > 4.5f ? new Vector3(1.8f, 8f, 1.8f) : new Vector3(1.4f, 6f, 1.4f);
                Cylinder($"CavernButtress_{index:00}", environment.transform, buttresses[index], scale, m["basaltEdge"]);
            }
            RotatedCube("RouteEntryTurn", environment.transform, new Vector3(-3.5f, 0.06f, 8f), new Vector3(10f, 0.12f, 3f), -35f, m["basaltEdge"]);
            RotatedCube("RouteActionToExpress", environment.transform, new Vector3(-1f, 0.06f, 19f), new Vector3(12f, 0.12f, 3f), 38f, m["basaltEdge"]);
            Cube("RouteExpressToHeavy", environment.transform, new Vector3(6f, 0.06f, 30f), new Vector3(3f, 0.12f, 10f), m["basaltEdge"]);
            RotatedCube("RouteRewardTurn", environment.transform, new Vector3(1.5f, 0.06f, 41f), new Vector3(10f, 0.12f, 3f), -38f, m["basaltEdge"]);
            Cube("RouteForgeReveal", environment.transform, new Vector3(3f, 0.06f, 51f), new Vector3(3f, 0.12f, 10f), m["basaltEdge"]);
        }

        private static void BuildCinderGate(GameObject arrival, Dictionary<string, Material> m)
        {
            arrival.transform.position = new Vector3(0f, 0f, 3f);
            var landing = Empty("CinderGate_Landing", arrival.transform, new Vector3(0f, 0.25f, 1f));
            Cylinder("GateThreshold", arrival.transform, new Vector3(0f, 0.12f, 0f), new Vector3(12f, 0.25f, 4f), m["iron"]);
            Cube("GatePillarLeft", arrival.transform, new Vector3(-7f, 3.5f, 0f), new Vector3(2.5f, 7f, 2.5f), m["basaltEdge"]);
            Cube("GatePillarRight", arrival.transform, new Vector3(7f, 3.5f, 0f), new Vector3(2.5f, 7f, 2.5f), m["basaltEdge"]);
            Cube("GateLintel", arrival.transform, new Vector3(0f, 7f, 0f), new Vector3(16.5f, 2.2f, 2.5f), m["basaltEdge"]);
            Cube("GateHotCore", arrival.transform, new Vector3(0f, 4.8f, -0.2f), new Vector3(9f, 0.35f, 0.35f), m["ember"]);
            for (var x = -5f; x <= 5f; x += 2.5f)
            {
                Sphere($"GateCinder_{x:0}", arrival.transform, new Vector3(x, 6.4f + Mathf.Abs(x) * 0.08f, -1.35f), Vector3.one * 0.28f, m["emberSoft"]);
            }
            PointLight("GateLight", arrival.transform, new Vector3(0f, 4f, 1f), new Color(1f, 0.12f, 0.015f), 7f, 10f);
        }

        private static void BuildImmediateAction(GameObject action, Dictionary<string, Material> m)
        {
            action.transform.position = new Vector3(-7f, 0f, 13f);
            Cylinder("ImmediateActionArena", action.transform, new Vector3(0f, 0.15f, 0f), new Vector3(17f, 0.35f, 17f), m["basaltEdge"]);
            Cube("ImmediateActionCavernBack", action.transform, new Vector3(0f, 3f, 6.5f), new Vector3(16f, 6f, 1.2f), m["basalt"]);
            Cube("ImmediateActionCavernWingL", action.transform, new Vector3(-7f, 2f, 3f), new Vector3(1.4f, 4f, 7f), m["basaltEdge"]);
            Cube("ImmediateActionCavernWingR", action.transform, new Vector3(7f, 2f, 3f), new Vector3(1.4f, 4f, 7f), m["basaltEdge"]);
            for (var index = 0; index < 8; index++)
            {
                var angle = index * Mathf.PI * 0.25f;
                var position = new Vector3(Mathf.Cos(angle) * 5.4f, 0.42f, Mathf.Sin(angle) * 5.4f);
                Cube($"ActionLavaCrack_{index:00}", action.transform, position, new Vector3(0.25f, 0.08f, 2.5f), m["emberSoft"]);
            }

            for (var index = 0; index < 3; index++)
            {
                var creature = Empty($"Role_SmallAggressiveLavaCreature_{index + 1:00}", action.transform, new Vector3(-4f + index * 4f, 1f, 1f + (index % 2) * 2f));
                Sphere("RollyBody", creature.transform, Vector3.zero, new Vector3(1.25f, 0.95f, 1.1f), m["ember"]);
                Cone("UglyFace", creature.transform, new Vector3(0f, 0.75f, -0.35f), new Vector3(0.55f, 0.6f, 0.55f), m["copper"]);
                Sphere("HotEyeL", creature.transform, new Vector3(-0.22f, 0.9f, -0.72f), Vector3.one * 0.12f, m["ember"]);
                Sphere("HotEyeR", creature.transform, new Vector3(0.22f, 0.9f, -0.72f), Vector3.one * 0.12f, m["ember"]);
            }
            PointLight("ActionGlow", action.transform, new Vector3(0f, 2f, 0f), new Color(1f, 0.08f, 0.01f), 8f, 9f);
        }

        private static void BuildLavaExpress(GameObject express, Dictionary<string, Material> m)
        {
            express.transform.position = new Vector3(4f, 0f, 24f);
            express.transform.rotation = Quaternion.Euler(0f, 90f, 0f);
            Cube("ExpressLavaGap", express.transform, new Vector3(0f, 0.03f, 0f), new Vector3(18f, 0.08f, 11f), m["emberSoft"]);
            Cube("ExpressBridge", express.transform, new Vector3(0f, 1.28f, 0f), new Vector3(5f, 0.45f, 16f), m["iron"]);
            Cube("ExpressBridgeSupportL", express.transform, new Vector3(-6f, 0.65f, 0f), new Vector3(1.5f, 1.3f, 4f), m["basaltEdge"]);
            Cube("ExpressBridgeSupportR", express.transform, new Vector3(6f, 0.65f, 0f), new Vector3(1.5f, 1.3f, 4f), m["basaltEdge"]);
            var tracks = Empty("LavaExpress_TrackPair", express.transform, Vector3.zero);
            Cube("TrackLeft", tracks.transform, new Vector3(-1.35f, 1.58f, 0f), new Vector3(0.32f, 0.25f, 15f), m["copper"]);
            Cube("TrackRight", tracks.transform, new Vector3(1.35f, 1.58f, 0f), new Vector3(0.32f, 0.25f, 15f), m["copper"]);
            for (var index = 0; index < 7; index++)
            {
                Cube($"TrackTie_{index:00}", express.transform, new Vector3(0f, 1.48f, -6f + index * 2f), new Vector3(7f, 0.22f, 0.42f), m["basaltEdge"]);
            }
            // Sightline cleanup: the gate frames the far end of the bridge, not the player's near-side view.
            Cube("ExpressBridgeGate", express.transform, new Vector3(0f, 4f, -7.5f), new Vector3(10f, 7f, 0.7f), m["basalt"]);
            var cart = Empty("LavaExpress_CartPlaceholder", express.transform, new Vector3(0f, 2.25f, 1f));
            Cube("CartBed", cart.transform, Vector3.zero, new Vector3(3.8f, 0.7f, 3.2f), m["copper"]);
            Cube("CartFrontShield", cart.transform, new Vector3(0f, 1.1f, -1.2f), new Vector3(3.4f, 1.5f, 0.35f), m["iron"]);
            for (var x = -1.3f; x <= 1.3f; x += 2.6f)
            {
                Cylinder($"CartWheel_{x:0}", cart.transform, new Vector3(x, -0.5f, -0.9f), new Vector3(0.55f, 0.3f, 0.55f), m["basalt"]);
            }
            Cube("ExpressLavaDrop", express.transform, new Vector3(0f, 0.08f, 7f), new Vector3(8f, 0.08f, 1.2f), m["ember"]);
            PointLight("ExpressGlow", express.transform, new Vector3(0f, 3f, 5f), new Color(1f, 0.12f, 0.01f), 10f, 15f);
        }

        private static void BuildHeavyEncounter(GameObject heavy, Dictionary<string, Material> m)
        {
            heavy.transform.position = new Vector3(6f, 0f, 35f);
            Cylinder("HeavyEncounterArena", heavy.transform, new Vector3(0f, 0.2f, 0f), new Vector3(18f, 0.45f, 18f), m["basaltEdge"]);
            for (var index = 0; index < 4; index++)
            {
                var angle = Mathf.PI * 0.25f + index * Mathf.PI * 0.5f;
                Cylinder($"HeavyArenaButtress_{index:00}", heavy.transform, new Vector3(Mathf.Cos(angle) * 7.2f, 2.5f, Mathf.Sin(angle) * 7.2f), new Vector3(1f, 5f, 1f), m["iron"]);
            }
            var guardian = Empty("Role_HeavyPositionalOreGuardian", heavy.transform, new Vector3(0f, 0f, 0f));
            Cube("OreGuardianBody", guardian.transform, new Vector3(0f, 2.3f, 0f), new Vector3(3.6f, 4.6f, 3f), m["basaltEdge"]);
            Sphere("OreGuardianCore", guardian.transform, new Vector3(0f, 2.3f, -1.55f), Vector3.one * 0.65f, m["ember"]);
            Cube("OreGuardianShoulderL", guardian.transform, new Vector3(-2.2f, 2.9f, 0f), new Vector3(1.5f, 2.1f, 2f), m["iron"]);
            Cube("OreGuardianShoulderR", guardian.transform, new Vector3(2.2f, 2.9f, 0f), new Vector3(1.5f, 2.1f, 2f), m["iron"]);
            Sphere("OreGuardianHead", guardian.transform, new Vector3(0f, 5.2f, 0f), Vector3.one * 1.35f, m["basalt"]);
            PointLight("HeavyCoreGlow", heavy.transform, new Vector3(0f, 2f, -2f), new Color(1f, 0.1f, 0.01f), 7f, 10f);
        }

        private static void BuildReward(GameObject reward, Dictionary<string, Material> m)
        {
            reward.transform.position = new Vector3(-3f, 0f, 45f);
            Cylinder("RewardChamberFloor", reward.transform, new Vector3(0f, 0.18f, 0f), new Vector3(16f, 0.35f, 14f), m["basaltEdge"]);
            var display = Empty("Emberplate_RewardDisplay", reward.transform, Vector3.zero);
            Cylinder("RewardPedestal", display.transform, new Vector3(0f, 1f, 0f), new Vector3(3.2f, 2f, 3.2f), m["copper"]);
            Cube("EmberplateChest", display.transform, new Vector3(0f, 3f, 0f), new Vector3(2.8f, 2.1f, 1.2f), m["reward"]);
            Cube("EmberplateCore", display.transform, new Vector3(0f, 3f, -0.68f), new Vector3(0.75f, 0.75f, 0.12f), m["ember"]);
            Sphere("RewardHalo", display.transform, new Vector3(0f, 4.8f, 0f), Vector3.one * 0.55f, m["ember"]);
            for (var x = -1f; x <= 1f; x += 2f)
            {
                Sphere($"RewardShoulder_{x:0}", display.transform, new Vector3(x, 3.55f, 0f), Vector3.one * 0.58f, m["reward"]);
            }
            Cube("RewardRevealWall", reward.transform, new Vector3(0f, 4.5f, 5f), new Vector3(12f, 9f, 1f), m["basalt"]);
            PointLight("RewardLight", reward.transform, new Vector3(0f, 4f, -2f), new Color(1f, 0.18f, 0.025f), 9f, 14f);
        }

        private static ForgeStateObjects BuildForge(GameObject forge, Dictionary<string, Material> m)
        {
            forge.transform.position = new Vector3(3f, 0f, 57f);
            Cylinder("ForgeChamberFloor", forge.transform, new Vector3(0f, 0.2f, 0f), new Vector3(34f, 0.45f, 24f), m["basaltEdge"]);
            // Sightline cleanup: keep a rear forge wall, but narrow it so the focal region is not swallowed by a dark slab.
            Cube("ForgeBackWall", forge.transform, new Vector3(0f, 7f, 9f), new Vector3(24f, 14f, 1.8f), m["basalt"]);
            // Sightline cleanup: retain side framing while leaving the forge and Kong-Ore region readable.
            foreach (var x in new[] { -12f, 12f })
            {
                Cube($"ForgeTower_{x:0}", forge.transform, new Vector3(x, 6f, 5f), new Vector3(3f, 12f, 3f), m["iron"]);
            }

            var boss = Empty("KongOre_BossAnchor", forge.transform, new Vector3(-7f, 0f, 3f));
            Sphere("KongOreMass", boss.transform, new Vector3(0f, 3.1f, 0f), new Vector3(4.8f, 5.8f, 4.5f), m["basalt"]);
            Sphere("KongOreCore", boss.transform, new Vector3(0f, 3.1f, -2.35f), Vector3.one * 0.9f, m["ember"]);
            Cube("KongOreArmL", boss.transform, new Vector3(-4f, 2.3f, 0f), new Vector3(2.2f, 3.6f, 2.2f), m["iron"]);
            Cube("KongOreArmR", boss.transform, new Vector3(4f, 2.3f, 0f), new Vector3(2.2f, 3.6f, 2.2f), m["iron"]);

            var dormant = Empty("ForgeDormantState", forge.transform, new Vector3(2f, 0f, 9f));
            Cylinder("DormantForgeBasin", dormant.transform, new Vector3(0f, 1.2f, 0f), new Vector3(10f, 2.4f, 10f), m["iron"]);
            Cylinder("DormantForgeCore", dormant.transform, new Vector3(0f, 2.55f, 0f), new Vector3(4.2f, 0.3f, 4.2f), m["basalt"]);
            Cube("DormantForgeSmoke", dormant.transform, new Vector3(0f, 5f, 0f), new Vector3(2.5f, 4f, 2.5f), m["basalt"]);

            var relit = Empty("ForgeRelitState", forge.transform, new Vector3(2f, 0f, 9f));
            Cylinder("RelitForgeBasin", relit.transform, new Vector3(0f, 1.2f, 0f), new Vector3(10f, 2.4f, 10f), m["copper"]);
            Cylinder("RelitForgeCore", relit.transform, new Vector3(0f, 2.7f, 0f), new Vector3(7f, 0.5f, 7f), m["ember"]);
            Cube("RelitForgeFlame", relit.transform, new Vector3(0f, 6.5f, 0f), new Vector3(5f, 9f, 5f), m["ember"]);
            Cube("RelitForgeWaterfallL", relit.transform, new Vector3(-5f, 4.5f, 0f), new Vector3(0.9f, 8f, 0.9f), m["emberSoft"]);
            Cube("RelitForgeWaterfallR", relit.transform, new Vector3(5f, 4.5f, 0f), new Vector3(0.9f, 8f, 0.9f), m["emberSoft"]);
            var lights = new[]
            {
                PointLight("RelitForgeLight", relit.transform, new Vector3(0f, 6f, 1f), new Color(1f, 0.13f, 0.01f), 18f, 30f),
                PointLight("RelitForgeLightL", relit.transform, new Vector3(-6f, 4f, 0f), new Color(1f, 0.06f, 0.005f), 12f, 16f),
                PointLight("RelitForgeLightR", relit.transform, new Vector3(6f, 4f, 0f), new Color(1f, 0.06f, 0.005f), 12f, 16f)
            };
            return new ForgeStateObjects { dormant = dormant, relit = relit, lights = lights };
        }

        private static void BuildLighting(Transform root)
        {
            var moon = new GameObject("UndergroundFillLight");
            moon.transform.SetParent(root);
            var light = moon.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = new Color(0.12f, 0.18f, 0.32f);
            light.intensity = 0.55f;
            light.transform.rotation = Quaternion.Euler(45f, -25f, 0f);
        }

        private static void BuildReviewCameras(Transform root)
        {
            Camera("ReviewOverviewCamera", root, new Vector3(31f, 38f, -25f), new Vector3(0f, 1.5f, 34f), 52f);
            Camera("ReviewCinderGateCamera", root, new Vector3(0f, 5.4f, -10f), new Vector3(0f, 3.6f, 3f), 48f);
            Camera("ReviewImmediateActionCamera", root, new Vector3(-16f, 8f, 7f), new Vector3(-7f, 1.5f, 13f), 50f);
            Camera("ReviewLavaExpressCamera", root, new Vector3(16f, 10f, 16f), new Vector3(4f, 1.8f, 24f), 50f);
            Camera("ReviewHeavyEncounterCamera", root, new Vector3(6f, 9f, 24f), new Vector3(6f, 2.5f, 35f), 50f);
            Camera("ReviewRewardCamera", root, new Vector3(-14f, 7f, 35f), new Vector3(-3f, 2.8f, 45f), 48f);
            Camera("ReviewForgeCamera", root, new Vector3(3f, 11f, 42f), new Vector3(3f, 4.5f, 66f), 50f);
            Camera("ReviewCompletionCamera", root, new Vector3(3f, 11f, 42f), new Vector3(3f, 5f, 67f), 50f);
        }

        private static CameraCapture CaptureCamera(string outputRoot, string cameraName, string filename, string view)
        {
            var camera = GameObject.Find(cameraName)?.GetComponent<Camera>();
            if (camera == null) throw new BuildFailedException($"Review camera not found: {cameraName}");
            foreach (var other in UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None)) other.enabled = other == camera;

            var texture = new RenderTexture(CaptureWidth, CaptureHeight, 24, RenderTextureFormat.ARGB32);
            var previousActive = RenderTexture.active;
            var previousTarget = camera.targetTexture;
            try
            {
                camera.targetTexture = texture;
                RenderTexture.active = texture;
                camera.Render();
                var image = new Texture2D(CaptureWidth, CaptureHeight, TextureFormat.RGBA32, false);
                image.ReadPixels(new Rect(0f, 0f, CaptureWidth, CaptureHeight), 0, 0);
                image.Apply(false, false);
                File.WriteAllBytes(Path.Combine(outputRoot, filename), image.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(image);
            }
            finally
            {
                camera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                UnityEngine.Object.DestroyImmediate(texture);
            }
            return new CameraCapture { filename = filename, camera = cameraName, view = view };
        }

        private static void AddBuildScene(string path)
        {
            var scenes = EditorBuildSettings.scenes.ToList();
            var index = scenes.FindIndex(scene => scene.path == path);
            var entry = new EditorBuildSettingsScene(path, true);
            if (index >= 0) scenes[index] = entry;
            else scenes.Add(entry);
            EditorBuildSettings.scenes = scenes.ToArray();
        }

        private static GameObject Child(GameObject parent, string name)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent.transform, false);
            return child;
        }

        private static GameObject FindSceneObject(string name)
        {
            return Resources.FindObjectsOfTypeAll<GameObject>()
                .FirstOrDefault(candidate => candidate.name == name && candidate.scene == SceneManager.GetActiveScene());
        }

        private static GameObject Empty(string name, Transform parent, Vector3 position)
        {
            var objectRoot = new GameObject(name);
            objectRoot.transform.SetParent(parent, false);
            objectRoot.transform.localPosition = position;
            return objectRoot;
        }

        private static GameObject Cube(string name, Transform parent, Vector3 position, Vector3 scale, Material material)
        {
            return Primitive(name, PrimitiveType.Cube, parent, position, scale, material);
        }

        private static GameObject RotatedCube(string name, Transform parent, Vector3 position, Vector3 scale, float yaw, Material material)
        {
            var cube = Cube(name, parent, position, scale, material);
            cube.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            return cube;
        }

        private static GameObject Sphere(string name, Transform parent, Vector3 position, Vector3 scale, Material material)
        {
            return Primitive(name, PrimitiveType.Sphere, parent, position, scale, material);
        }

        private static GameObject Cylinder(string name, Transform parent, Vector3 position, Vector3 scale, Material material)
        {
            return Primitive(name, PrimitiveType.Cylinder, parent, position, scale, material);
        }

        private static GameObject Cone(string name, Transform parent, Vector3 position, Vector3 scale, Material material)
        {
            var cone = Primitive(name, PrimitiveType.Cylinder, parent, position, scale, material);
            cone.transform.localScale = new Vector3(scale.x, scale.y, scale.z);
            return cone;
        }

        private static GameObject Primitive(string name, PrimitiveType type, Transform parent, Vector3 position, Vector3 scale, Material material)
        {
            var primitive = GameObject.CreatePrimitive(type);
            primitive.name = name;
            primitive.transform.SetParent(parent, false);
            primitive.transform.localPosition = position;
            primitive.transform.localScale = scale;
            primitive.GetComponent<Renderer>().sharedMaterial = material;
            return primitive;
        }

        private static Light PointLight(string name, Transform parent, Vector3 position, Color color, float range, float intensity)
        {
            var lightObject = new GameObject(name);
            lightObject.transform.SetParent(parent, false);
            lightObject.transform.localPosition = position;
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = color;
            light.range = range;
            light.intensity = intensity;
            return light;
        }

        private static Camera Camera(string name, Transform parent, Vector3 position, Vector3 target, float fieldOfView)
        {
            var cameraObject = new GameObject(name);
            cameraObject.transform.SetParent(parent, false);
            cameraObject.transform.position = position;
            cameraObject.transform.rotation = Quaternion.LookRotation(target - position, Vector3.up);
            var camera = cameraObject.AddComponent<Camera>();
            camera.fieldOfView = fieldOfView;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 150f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0.008f, 0.01f, 0.018f);
            camera.enabled = false;
            return camera;
        }

        private static void EnsureFolder(string path)
        {
            var parts = path.Split('/');
            var current = parts[0];
            for (var index = 1; index < parts.Length; index++)
            {
                var next = $"{current}/{parts[index]}";
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[index]);
                current = next;
            }
        }

        private static string ReadGitSha(string repositoryRoot)
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = "git",
                Arguments = "rev-parse HEAD",
                WorkingDirectory = repositoryRoot,
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(startInfo))
            {
                process.WaitForExit();
                if (process.ExitCode != 0) throw new BuildFailedException(process.StandardError.ReadToEnd());
                var sha = process.StandardOutput.ReadToEnd().Trim();
                if (sha.Length != 40) throw new BuildFailedException($"Git HEAD was not a full SHA: {sha}");
                return sha;
            }
        }

        private sealed class ForgeStateObjects
        {
            public GameObject dormant;
            public GameObject relit;
            public Light[] lights;
        }

        [Serializable]
        private sealed class ReviewManifest
        {
            public string schema;
            public int schemaVersion;
            public string gitSha;
            public string unityVersion;
            public string platform;
            public string buildTarget;
            public string scene;
            public string captureState;
            public string visualConvention;
            public string strongestDefect;
            public string gameplayTraversalReadability;
            public CameraCapture[] captures;
        }

        [Serializable]
        private sealed class CameraCapture
        {
            public string filename;
            public string camera;
            public string view;
        }
    }
}
