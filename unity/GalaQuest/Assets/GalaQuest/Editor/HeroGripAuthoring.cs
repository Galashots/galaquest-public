using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using Object = UnityEngine.Object;

namespace GalaQuest.Editor
{
    // Admission of the exact Owner-approved derivative. The source FBX and original prefab stay
    // available for provenance; builds consume the committed derivative without local source files.
    public static class HeroGripAuthoring
    {
        public const string Folder = "Assets/GalaQuest/Movement/HeroGrip";
        public const string PrefabPath = Folder + "/HeroRightGrip.prefab";
        private const string OriginalPrefab = "Assets/GalaQuest/Gear/Prefabs/GQ_HERO_V1.prefab";

        public static GameObject LoadApproved()
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            if (prefab == null) throw new BuildFailedException("Missing committed approved Hero grip: " + PrefabPath);
            return prefab;
        }

        [MenuItem("GalaQuest/Hero/Author approved playtest grip")]
        public static void AuthorApproved()
        {
            var receipt = JObject.Parse(File.ReadAllText(Path.Combine(U2CombatPreview.RepoRoot,
                "docs/asset-production/HERO_RIGHT_GRIP_CANDIDATE_2026-09-07.json")));
            if ((string)receipt["acceptance"]?["ownerVisualAcceptance"] != "APPROVED_FOR_PLAYTEST"
                || (string)receipt["candidate"]?["sha256"] != U2HeroGripPreview.CandidateSha)
                throw new BuildFailedException("The exact hand derivative requires recorded Owner approval");
            if (!AssetDatabase.IsValidFolder(Folder))
            {
                AssetDatabase.CreateFolder("Assets/GalaQuest/Movement", "HeroGrip");
                U2HeroGripPreview.Prepare(AssetDatabase.LoadAssetAtPath<GameObject>(OriginalPrefab), Folder);
            }
            var approved = LoadApproved();
            var body = approved.GetComponentsInChildren<SkinnedMeshRenderer>().Single();
            if (body.sharedMesh.vertexCount != 13587 || body.sharedMesh.triangles.Length != 12140 * 3
                || body.bones.Length != 24)
                throw new BuildFailedException("Unexpected approved grip geometry or rig");
            var scene = EditorSceneManager.OpenScene(EmberworksGreyboxBuild.ScenePath, OpenSceneMode.Single);
            var hero = Object.FindFirstObjectByType<GalaQuestTraversalController>().Hero;
            ApplyToHero(hero.gameObject, approved);
            EditorSceneManager.MarkSceneDirty(scene);
            if (!EditorSceneManager.SaveScene(scene)) throw new BuildFailedException("Could not save the approved scene binding");
            AssetDatabase.SaveAssets();
            Debug.Log("Owner-approved hand bound to the playtest Hero; original source and rig preserved.");
        }

        public static void ApplyToHero(GameObject hero, GameObject approved)
        {
            var local = hero.GetComponentsInChildren<SkinnedMeshRenderer>().Single();
            var source = approved.GetComponentsInChildren<SkinnedMeshRenderer>().Single();
            if (!local.bones.Select(bone => bone.name).SequenceEqual(source.bones.Select(bone => bone.name))
                || !local.sharedMesh.bindposes.SequenceEqual(source.sharedMesh.bindposes)
                || !local.sharedMesh.vertices.SequenceEqual(source.sharedMesh.vertices.Take(local.sharedMesh.vertexCount)))
                throw new BuildFailedException("The scene Hero differs from the source of the approved hand");
            local.sharedMesh = source.sharedMesh;
            local.localBounds = source.localBounds;
        }
    }
}
