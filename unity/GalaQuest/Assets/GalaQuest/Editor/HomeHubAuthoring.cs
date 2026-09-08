using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Editor
{
    // Author through Unity so object identities, materials and scene links are native assets.
    public static class HomeHubAuthoring
    {
        public const string RootName = "HomeCamp";
        private const string Folder = "Assets/GalaQuest/HomeHub";

        public static void Author()
        {
            var scene = EditorSceneManager.OpenScene(EmberworksGreyboxBuild.ScenePath, OpenSceneMode.Single);
            var roots = scene.GetRootGameObjects();
            if (roots.Any(root => root.name == RootName))
                throw new BuildFailedException("The authored camp already exists; preserve it instead of regenerating blindly.");
            var emberworks = roots.Single(root => root.name == "EmberworksDeep");
            var runtime = roots.Single(root => root.name == EmberworksGreyboxBuild.RuntimeRootName);
            if (!AssetDatabase.IsValidFolder(Folder)) AssetDatabase.CreateFolder("Assets/GalaQuest", "HomeHub");
            var stone = Material("WarmLimestone", new Color(.56f, .52f, .42f));
            var path = Material("PathStone", new Color(.74f, .68f, .52f));
            var grass = Material("Meadow", new Color(.25f, .37f, .24f));
            var leaves = Material("Canopy", new Color(.19f, .30f, .25f));
            var wood = Material("Timber", new Color(.27f, .19f, .12f));
            var bronze = Material("GatewayBronze", new Color(.52f, .29f, .12f), .45f);
            var glow = Material("ForgeLight", new Color(1f, .54f, .13f), 0, true);
            var home = new GameObject(RootName);
            var root = home.transform;
            Shape("MeadowGround", root, PrimitiveType.Cube, new Vector3(0, -.26f, 1), new Vector3(38, .4f, 36), grass);
            Shape("CampTerrace", root, PrimitiveType.Cube, new Vector3(0, -.08f, 1), new Vector3(20, .12f, 18), stone);
            Shape("MeetingCircle", root, PrimitiveType.Cylinder, new Vector3(0, -.005f, 0), new Vector3(8, .006f, 8), path);
            for (var z = 3; z <= 8; z++)
                Shape("GatePath" + z, root, PrimitiveType.Cube, new Vector3(0, .006f, z), new Vector3(2.6f, .02f, .86f), path);
            // Solid scenery is outside the server's walkable rectangle. The gate's landing pad
            // is flat so its visual boundary cannot disagree with movement prediction.
            for (var side = -1; side <= 1; side += 2)
            {
                Shape("LowCampEdge" + side, root, PrimitiveType.Cube, new Vector3(side * 10.3f, .15f, 1), new Vector3(.5f, .4f, 18), stone);
                Shape("GatePost" + side, root, PrimitiveType.Cube, new Vector3(side * 2.6f, 1.9f, 10), new Vector3(.65f, 3.8f, .65f), stone);
                Shape("GateBand" + side, root, PrimitiveType.Cube, new Vector3(side * 2.6f, 2.9f, 10), new Vector3(.78f, .3f, .78f), bronze);
                Shape("GateLantern" + side, root, PrimitiveType.Sphere, new Vector3(side * 2.6f, 3.95f, 10), new Vector3(.4f, .55f, .4f), glow);
                Bench(root, side, wood, stone);
                for (var row = 0; row < 3; row++)
                {
                    var at = new Vector3(side * (12.7f + row % 2), 0, -5 + row * 7);
                    Shape("TreeTrunk" + side + row, root, PrimitiveType.Cylinder, at + Vector3.up * 1.5f, new Vector3(.55f, 1.5f, .55f), wood);
                    Shape("TreeCrown" + side + row, root, PrimitiveType.Sphere, at + Vector3.up * 3.5f, new Vector3(4, 3.3f, 4), leaves);
                }
            }
            Shape("GatewayLintel", root, PrimitiveType.Cube, new Vector3(0, 3.5f, 10), new Vector3(5.8f, .6f, .72f), stone);
            Shape("GatewayEmber", root, PrimitiveType.Cube, new Vector3(0, 3.51f, 9.6f), new Vector3(2.1f, .25f, .08f), glow);
            Shape("ArrivalPad", root, PrimitiveType.Cylinder, new Vector3(0, .015f, 7), new Vector3(3.2f, .008f, 3.2f), bronze);
            Shape("ArrivalLight", root, PrimitiveType.Cylinder, new Vector3(0, .035f, 7), new Vector3(2.7f, .008f, 2.7f), glow);
            var sun = new GameObject("CampSun");
            sun.transform.SetParent(root, false);
            sun.transform.rotation = Quaternion.Euler(48, -32, 0);
            var light = sun.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = new Color(1, .9f, .74f);
            light.intensity = 1.25f;
            light.shadows = LightShadows.Soft;
            var destinations = runtime.AddComponent<GalaQuestDestinationPresentation>();
            destinations.Configure(home, emberworks);
            runtime.GetComponent<GalaQuestGameEntry>().ConfigureInitialDestination(GalaQuestProtocolV4.HomeHubDestinationId);
            home.SetActive(false); // GameEntry chooses the initial destination before reading the browser profile.
            if (!EditorSceneManager.SaveScene(scene)) throw new BuildFailedException("Could not save the camp/travel scene.");
            AssetDatabase.SaveAssets();
            Debug.Log("Home camp and two-way travel authored in the existing player scene.");
        }

        private static void Bench(Transform root, int side, Material wood, Material stone)
        {
            var x = side * 10.8f;
            Shape("BenchSeat" + side, root, PrimitiveType.Cube, new Vector3(x, .48f, 0), new Vector3(.8f, .18f, 2.5f), wood);
            Shape("BenchBack" + side, root, PrimitiveType.Cube, new Vector3(x + side * .35f, .84f, 0), new Vector3(.14f, .7f, 2.5f), wood);
            foreach (var z in new[] { -.8f, .8f })
                Shape("BenchFoot" + side + z, root, PrimitiveType.Cube, new Vector3(x, .2f, z), new Vector3(.62f, .4f, .32f), stone);
        }

        private static void Shape(string name, Transform root, PrimitiveType type, Vector3 at, Vector3 size, Material material)
        {
            var item = GameObject.CreatePrimitive(type);
            item.name = name;
            item.transform.SetParent(root, false);
            item.transform.localPosition = at;
            item.transform.localScale = size;
            item.GetComponent<MeshRenderer>().sharedMaterial = material;
            Object.DestroyImmediate(item.GetComponent<Collider>());
        }

        private static Material Material(string name, Color color, float metal = 0, bool emission = false)
        {
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) throw new BuildFailedException("Missing the project's URP Lit shader.");
            var material = new Material(shader) { name = name, color = color };
            material.SetFloat("_Metallic", metal);
            material.SetFloat("_Smoothness", .28f);
            if (emission) { material.EnableKeyword("_EMISSION"); material.SetColor("_EmissionColor", color * 1.3f); }
            AssetDatabase.CreateAsset(material, Folder + "/" + name + ".mat");
            return material;
        }
    }
}
