using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace GalaQuest.Editor
{
    public static class EmberworksTraversalAuthoring
    {
        public const string BoundaryRootName = "OpeningRouteBoundary";

        [MenuItem("GalaQuest/Movement/Wire Opening Route Boundary")]
        public static void Wire()
        {
            var scene = EditorSceneManager.OpenScene(EmberworksGreyboxBuild.ScenePath, OpenSceneMode.Single);
            var environment = scene.GetRootGameObjects().Single(item => item.name == "EmberworksDeep");
            var root = environment.transform.Find(BoundaryRootName);
            if (root == null)
            {
                root = new GameObject(BoundaryRootName).transform;
                root.SetParent(environment.transform, false);
            }
            var stone = AssetDatabase.LoadAssetAtPath<Material>("Assets/GalaQuest/Emberworks/Materials/BasaltEdge.mat");
            var copper = AssetDatabase.LoadAssetAtPath<Material>("Assets/GalaQuest/Emberworks/Materials/ForgeCopper.mat");
            if (stone == null || copper == null) throw new BuildFailedException("Existing route materials are required.");
            const float thickness = 0.7f;
            var offset = GalaQuestEmberworksMovementWorld.HeroClearance + thickness * 0.5f;
            var width = GalaQuestEmberworksMovementWorld.MaxX - GalaQuestEmberworksMovementWorld.MinX;
            var depth = GalaQuestEmberworksMovementWorld.MaxZ - GalaQuestEmberworksMovementWorld.MinZ;
            var centreX = (GalaQuestEmberworksMovementWorld.MinX + GalaQuestEmberworksMovementWorld.MaxX) * 0.5f;
            var centreZ = (GalaQuestEmberworksMovementWorld.MinZ + GalaQuestEmberworksMovementWorld.MaxZ) * 0.5f;
            Rail(root, "West", new Vector3(GalaQuestEmberworksMovementWorld.MinX - offset, 0.25f, centreZ),
                new Vector3(thickness, 0.5f, depth + 2f * offset + thickness), stone, copper);
            Rail(root, "East", new Vector3(GalaQuestEmberworksMovementWorld.MaxX + offset, 0.25f, centreZ),
                new Vector3(thickness, 0.5f, depth + 2f * offset + thickness), stone, copper);
            Rail(root, "South", new Vector3(centreX, 0.25f, GalaQuestEmberworksMovementWorld.MinZ - offset),
                new Vector3(width + 2f * offset + thickness, 0.5f, thickness), stone, copper);
            Rail(root, "North", new Vector3(centreX, 0.25f, GalaQuestEmberworksMovementWorld.MaxZ + offset),
                new Vector3(width + 2f * offset + thickness, 0.5f, thickness), stone, copper);
            EditorSceneManager.MarkSceneDirty(scene);
            if (!EditorSceneManager.SaveScene(scene)) throw new BuildFailedException("Could not save opening route boundary.");
            Debug.Log("Opening route perimeter is visible; its inner faces agree with the movement envelope plus hero clearance.");
        }

        // Re-running updates only these eight named pieces. The frozen greybox is not regenerated.
        private static void Rail(Transform root, string name, Vector3 centre, Vector3 size, Material stone, Material copper)
        {
            Cube(root, name, centre, size, stone);
            Cube(root, name + "Cap", centre + Vector3.up * 0.28f,
                new Vector3(size.x, 0.06f, size.z), copper);
        }

        private static void Cube(Transform root, string name, Vector3 centre, Vector3 size, Material material)
        {
            var part = root.Find(name);
            if (part == null)
            {
                part = GameObject.CreatePrimitive(PrimitiveType.Cube).transform;
                part.name = name;
                part.SetParent(root, false);
            }
            part.localPosition = centre;
            part.localRotation = Quaternion.identity;
            part.localScale = size;
            part.GetComponent<MeshRenderer>().sharedMaterial = material;
        }

        public static void WireMovementCheckpoint()
        {
            HeroLocomotionAuthoring.Wire();
            Wire();
        }
    }
}
