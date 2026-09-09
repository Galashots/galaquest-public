using System;
using System.IO;
using System.Linq;
using GalaQuest.Gear;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace GalaQuest.Editor
{
    public static class RuneForgeAuthoring
    {
        public const string PocketName = "RuneForgePocket";
        public const string ModelPath = "Assets/GalaQuest/Gear/SourceAssets/MagmaLordHelmet.fbx";
        public const string PrefabPath = "Assets/GalaQuest/Gear/Prefabs/MagmaLordHelmet.prefab";
        public const string DefinitionPath = "Assets/GalaQuest/Gear/Definitions/Gear_MagmaLordHelmet.asset";
        public const string PocketPrefabPath = "Assets/GalaQuest/RuneForge/RuneForgePocket.prefab";
        private const string Folder = "Assets/GalaQuest/RuneForge";
        private static readonly Vector3 ForgePosition = new Vector3(7.2f, 0f, 17.2f);

        [MenuItem("GalaQuest/Rune Forge/Author bounded candidate")]
        public static void Author()
        {
            EnsureFolder();
            var definition = EnsureHelmet();
            var pocket = BuildPocket(null, definition);
            try
            {
                if (AssetDatabase.LoadAssetAtPath<GameObject>(PocketPrefabPath) != null)
                    AssetDatabase.DeleteAsset(PocketPrefabPath);
                if (PrefabUtility.SaveAsPrefabAsset(pocket, PocketPrefabPath) == null)
                    throw new BuildFailedException("Could not save the bounded Rune Forge pocket prefab.");
            }
            finally { Object.DestroyImmediate(pocket); }
            AssetDatabase.SaveAssets();
            Debug.Log("Authored bounded Rune Forge candidate with " + definition.SemanticId);
        }

        public static GearItemDefinition LoadHelmet()
        {
            var definition = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(DefinitionPath);
            if (definition == null) throw new BuildFailedException("Missing authored MagmaLord gear definition: " + DefinitionPath);
            return definition;
        }

        public static void ConfigurePreview(GameObject runtime, GalaQuestCombatContent content)
        {
            content.MagmaLordHelmet = LoadHelmet();
            var pocketPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(PocketPrefabPath)
                               ?? throw new BuildFailedException("Missing authored Rune Forge pocket: " + PocketPrefabPath);
            var pocketObject = (GameObject)PrefabUtility.InstantiatePrefab(pocketPrefab, runtime.scene);
            pocketObject.name = PocketName;
            var emberworks = runtime.scene.GetRootGameObjects().Single(item => item.name == "EmberworksDeep");
            pocketObject.transform.SetParent(emberworks.transform, true);
            var pocket = pocketObject.transform;
            var prize = pocket.Find("PrizeCage/MagmaLordForgeDisplayCopy")?.gameObject
                        ?? throw new BuildFailedException("Rune Forge pocket has no visible prize.");
            var hero = Object.FindObjectsByType<Transform>(FindObjectsSortMode.None)
                .Single(item => item.name == EmberworksGreyboxBuild.RuntimeHeroName);
            var presenter = runtime.GetComponent<GalaQuestRuneForgePresenter>()
                            ?? runtime.AddComponent<GalaQuestRuneForgePresenter>();
            presenter.Configure(hero, pocket, prize, content.Windup, content.Impact, content.Victory);
            EditorUtility.SetDirty(presenter);
        }

        private static GearItemDefinition EnsureHelmet()
        {
            var source = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
            if (source == null) throw new BuildFailedException("Import the authored MagmaLord FBX first: " + ModelPath);
            var plate = Material("MagmaLordPlate", new Color(.10f, .045f, .025f), .82f, .32f);
            var horn = Material("MagmaLordHorn", new Color(.38f, .16f, .045f), .12f, .42f);
            var molten = Material("MagmaLordMolten", new Color(1f, .11f, .005f), .1f, .2f, true);
            var instance = Object.Instantiate(source);
            try
            {
                instance.name = "MagmaLordHelmet";
                foreach (var renderer in instance.GetComponentsInChildren<Renderer>(true))
                {
                    renderer.sharedMaterial = renderer.name.Contains("Molten", StringComparison.OrdinalIgnoreCase) ? molten
                        : renderer.name.Contains("Horn", StringComparison.OrdinalIgnoreCase) ? horn : plate;
                }
                PrefabUtility.SaveAsPrefabAsset(instance, PrefabPath);
            }
            finally { Object.DestroyImmediate(instance); }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            var definition = AssetDatabase.LoadAssetAtPath<GearItemDefinition>(DefinitionPath);
            var created = definition == null;
            if (created) definition = ScriptableObject.CreateInstance<GearItemDefinition>();
            definition.Configure("gear.helmet.magmalord", "MagmaLord Helmet", prefab, GearSocketIds.Head,
                GearFitClass.Headgear,
                "unity/GalaQuest/Assets/GalaQuest/Gear/SourceAssets/MagmaLordHelmet.fbx",
                new[] { AnatomyRegion.Hair, AnatomyRegion.Ears });
            if (created)
            {
                // The model is authored upright, at metre scale, around its own head centre. This is
                // the first reviewable fit, not an Owner-authored lock; Unity fit review may revise it.
                definition.TryApplySeedFit(new Vector3(0f, .205f, -.055f), Vector3.zero, Vector3.one * .72f);
                AssetDatabase.CreateAsset(definition, DefinitionPath);
            }
            EditorUtility.SetDirty(definition);
            AssetDatabase.SaveAssets();
            return definition;
        }

        private static GameObject BuildPocket(Transform parent, GearItemDefinition definition)
        {
            var basalt = Material("ForgeBasalt", new Color(.08f, .07f, .075f), .22f, .4f);
            var iron = Material("ForgeIron", new Color(.19f, .15f, .14f), .68f, .3f);
            var ember = Material("ForgeEmber", new Color(1f, .16f, .015f), .05f, .25f, true);
            var rune = Material("ForgeRune", new Color(.34f, .10f, .025f), .4f, .32f, true);
            var root = new GameObject(PocketName);
            root.transform.SetParent(parent, false);
            root.transform.position = ForgePosition;
            Shape("ForgeDais", root.transform, PrimitiveType.Cylinder, new Vector3(0, .08f, 0), new Vector3(4.8f, .08f, 4.8f), basalt, false);
            Shape("ForgeRing", root.transform, PrimitiveType.Cylinder, new Vector3(0, .17f, 0), new Vector3(3.9f, .05f, 3.9f), iron, false);
            var cage = Child(root.transform, "PrizeCage");
            Shape("PrizePlinth", cage, PrimitiveType.Cylinder, new Vector3(0, .72f, .45f), new Vector3(1.55f, .30f, 1.55f), iron, false);
            var halo = Shape("MagmaLordPrizeHalo", cage, PrimitiveType.Cylinder, new Vector3(0, 1.63f, .95f),
                new Vector3(1.65f, .08f, 1.65f), rune, false);
            halo.transform.localRotation = Quaternion.Euler(90, 0, 0);
            var prize = (GameObject)PrefabUtility.InstantiatePrefab(definition.SourceModel);
            // This is deliberately an enlarged scene instance of the one wearable asset,
            // never a second gear candidate. Its explicit name protects later custody and review.
            prize.name = "MagmaLordForgeDisplayCopy";
            prize.transform.SetParent(cage, false);
            prize.transform.localPosition = new Vector3(0, 1.55f, .45f);
            prize.transform.localRotation = Quaternion.Euler(0, 180, 0);
            prize.transform.localScale = Vector3.one * 2.10f;
            for (var side = -1; side <= 1; side += 2)
                for (var depth = -1; depth <= 1; depth += 2)
                    Shape("CageBar", cage, PrimitiveType.Cylinder, new Vector3(side * .78f, 1.55f, .45f + depth * .55f),
                        new Vector3(.07f, 1.08f, .07f), iron, false);
            Shape("CageTop", cage, PrimitiveType.Cube, new Vector3(0, 2.62f, .45f), new Vector3(1.9f, .12f, 1.45f), iron, false);
            var glow = Shape("CageEmber", cage, PrimitiveType.Sphere, new Vector3(0, 1.25f, .18f), new Vector3(.16f, .16f, .16f), ember, false);
            var light = glow.AddComponent<Light>(); light.type = LightType.Point; light.color = new Color(1f, .30f, .04f); light.range = 7f; light.intensity = 5.5f;
            WorldLabel("MagmaLordPrizeName", cage, "MAGMALORD", new Vector3(0, 2.95f, .45f), .030f);

            Interactable("ForgeCore", root.transform, "open", "", new Vector3(0, .55f, -1.35f), new Vector3(.6f, .6f, .35f), ember, "WAKE");
            Interactable("SoundAnvil", root.transform, "pack", "grapheme-er-family", new Vector3(-1.3f, .48f, -.3f), new Vector3(.75f, .48f, .72f), iron, "SOUND");
            Interactable("NumberAnvil", root.transform, "pack", "place-value-rounding", new Vector3(1.3f, .48f, -.3f), new Vector3(.75f, .48f, .72f), iron, "NUMBER");
            for (var index = 0; index < 3; index++)
                Interactable("Rune" + (index + 1), root.transform, "rune", "", new Vector3(-1f + index, .38f, -1.05f), new Vector3(.62f, .18f, .62f), rune, "?");
            Interactable("ForgeHammer", root.transform, "hammer", "", new Vector3(1.45f, .55f, -.9f), new Vector3(.32f, .55f, .30f), iron, "STRIKE");
            Interactable("HintBell", root.transform, "hint", "", new Vector3(-1.55f, .45f, -.9f), new Vector3(.28f, .4f, .28f), ember, "HINT");
            Interactable("SoundPlaque", root.transform, "hear", "", new Vector3(-1.55f, .45f, -.3f), new Vector3(.28f, .4f, .28f), rune, "HEAR");
            Interactable("ClaimAnvil", root.transform, "claim", "", new Vector3(0, .55f, -.85f), new Vector3(.85f, .42f, .72f), ember, "CLAIM");
            Interactable("EquipStand", root.transform, "equip", "", new Vector3(0, .55f, -.85f), new Vector3(.85f, .42f, .72f), rune, "EQUIP");
            return root;
        }

        private static GameObject Interactable(string name, Transform parent, string kind, string value,
            Vector3 at, Vector3 size, Material material, string label)
        {
            var root = Shape(name, parent, PrimitiveType.Cube, at, size, material, true);
            var text = new GameObject("Label");
            text.transform.SetParent(root.transform, false);
            text.transform.localPosition = new Vector3(0, .58f, 0);
            text.transform.localRotation = Quaternion.identity;
            text.transform.localScale = Vector3.one * .020f;
            var mesh = text.AddComponent<TextMesh>();
            mesh.text = label; mesh.anchor = TextAnchor.MiddleCenter; mesh.alignment = TextAlignment.Center;
            mesh.fontSize = 64; mesh.color = new Color(1f, .8f, .4f);
            root.AddComponent<GalaQuestRuneForgeInteractable>().Configure(kind, value);
            return root;
        }

        private static void WorldLabel(string name, Transform parent, string value, Vector3 at, float scale)
        {
            var text = new GameObject(name);
            text.transform.SetParent(parent, false);
            text.transform.localPosition = at;
            text.transform.localRotation = Quaternion.identity;
            text.transform.localScale = Vector3.one * scale;
            var mesh = text.AddComponent<TextMesh>();
            mesh.text = value; mesh.anchor = TextAnchor.MiddleCenter; mesh.alignment = TextAlignment.Center;
            mesh.fontSize = 64; mesh.fontStyle = FontStyle.Bold; mesh.color = new Color(1f, .66f, .18f);
        }

        private static GameObject Shape(string name, Transform parent, PrimitiveType type, Vector3 at,
            Vector3 size, Material material, bool collider)
        {
            var item = GameObject.CreatePrimitive(type);
            item.name = name;
            item.transform.SetParent(parent, false);
            item.transform.localPosition = at;
            item.transform.localScale = size;
            item.GetComponent<MeshRenderer>().sharedMaterial = material;
            if (!collider)
            {
                var existing = item.GetComponent<Collider>();
                if (existing != null) Object.DestroyImmediate(existing);
            }
            return item;
        }

        private static Transform Child(Transform parent, string name)
        {
            var value = new GameObject(name).transform;
            value.SetParent(parent, false);
            return value;
        }

        private static void EnsureFolder()
        {
            if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets/GalaQuest", "RuneForge");
        }

        private static Material Material(string name, Color color, float metallic, float smoothness, bool emission = false)
        {
            var path = Folder + "/" + name + ".mat";
            var existing = AssetDatabase.LoadAssetAtPath<Material>(path);
            var shader = Shader.Find("Universal Render Pipeline/Lit")
                         ?? throw new BuildFailedException("Missing URP Lit shader.");
            var material = existing != null ? existing : new Material(shader) { name = name };
            material.color = color;
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Smoothness", smoothness);
            if (emission)
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor("_EmissionColor", color * 2.5f);
                material.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            }
            if (existing == null) AssetDatabase.CreateAsset(material, path);
            else EditorUtility.SetDirty(material);
            return material;
        }
    }
}
