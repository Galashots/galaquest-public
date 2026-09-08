using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using Object = UnityEngine.Object;

namespace GalaQuest.Editor
{
    // Candidate inspection only. No prefab, scene, source mesh, or shipping registration is changed.
    public static class U2EnemyCandidateDiagnostics
    {
        private const string TemporaryAssets = "Assets/U2CandidateInspectionTemporary";

        public static void CaptureBody()
        {
            var args = Environment.GetCommandLineArgs();
            string Arg(string name) => args[Array.IndexOf(args, name) + 1];
            var fbx = Path.GetFullPath(Arg("-candidateFbx"));
            var texturePath = Path.GetFullPath(Arg("-candidateTexture"));
            var output = Path.GetFullPath(Arg("-candidateOutput"));
            if (!File.Exists(fbx) || !File.Exists(texturePath)) throw new FileNotFoundException("Candidate input missing");
            if (Directory.Exists(TemporaryAssets)) throw new InvalidOperationException("Temporary candidate path already exists; preserve it");
            AssetDatabase.CreateFolder("Assets", "U2CandidateInspectionTemporary");
            try
            {
                File.Copy(fbx, TemporaryAssets + "/Body.fbx");
                File.Copy(texturePath, TemporaryAssets + "/BaseColor.png");
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                RenderSettings.ambientMode = AmbientMode.Flat;
                RenderSettings.ambientLight = new Color(0.55f, 0.55f, 0.55f);
                var source = AssetDatabase.LoadAssetAtPath<GameObject>(TemporaryAssets + "/Body.fbx");
                var body = Object.Instantiate(source);
                var renderers = body.GetComponentsInChildren<Renderer>();
                var bounds = renderers[0].bounds;
                foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
                body.transform.localScale *= 1.1f / bounds.size.y;
                bounds = renderers[0].bounds;
                foreach (var renderer in renderers) bounds.Encapsulate(renderer.bounds);
                body.transform.position -= new Vector3(bounds.center.x, bounds.min.y, bounds.center.z);
                var material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                material.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(TemporaryAssets + "/BaseColor.png"));
                material.SetFloat("_Metallic", 0);
                material.SetFloat("_Smoothness", 0.15f);
                foreach (var renderer in renderers)
                    renderer.sharedMaterials = renderer.sharedMaterials.Select(_ => material).ToArray();
                var sun = new GameObject("Diagnostic light").AddComponent<Light>();
                sun.type = LightType.Directional;
                sun.intensity = 2;
                sun.transform.rotation = Quaternion.Euler(40, -30, 0);
                var camera = new GameObject("Diagnostic camera").AddComponent<Camera>();
                camera.backgroundColor = new Color(0.72f, 0.74f, 0.77f);
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.orthographic = true;
                camera.orthographicSize = 0.75f;
                camera.nearClipPlane = 0.05f;
                camera.farClipPlane = 20;
                Directory.CreateDirectory(output);
                foreach (var yaw in new[] { 0, 45, 90, 180 })
                {
                    camera.transform.position = new Vector3(0, 0.55f, 0) + Quaternion.Euler(0, yaw, 0) * new Vector3(0, 0.1f, -3);
                    camera.transform.LookAt(new Vector3(0, 0.55f, 0));
                    var target = new RenderTexture(800, 800, 24);
                    var previous = RenderTexture.active;
                    try
                    {
                        camera.targetTexture = target;
                        camera.Render();
                        RenderTexture.active = target;
                        var pixels = new Texture2D(800, 800, TextureFormat.RGB24, false);
                        pixels.ReadPixels(new Rect(0, 0, 800, 800), 0, 0);
                        pixels.Apply();
                        File.WriteAllBytes(Path.Combine(output, $"body-{yaw}.png"), pixels.EncodeToPNG());
                        Object.DestroyImmediate(pixels);
                    }
                    finally
                    {
                        camera.targetTexture = null;
                        RenderTexture.active = previous;
                        Object.DestroyImmediate(target);
                    }
                }
                File.WriteAllText(Path.Combine(output, "body-inspection.txt"),
                    $"Unity candidate FBX inspection; normalized height 1.1m; renderers={renderers.Length}; " +
                    $"mesh vertices={body.GetComponentsInChildren<MeshFilter>().Sum(f => f.sharedMesh.vertexCount)}; " +
                    "neutral diagnostic material, source texture; not runtime or Owner acceptance.");
                Debug.Log("U2 candidate body captures complete");
            }
            finally
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                AssetDatabase.DeleteAsset(TemporaryAssets);
            }
        }
    }
}
