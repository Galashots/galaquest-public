using System;
using System.Collections;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;
using UnityEngine.Rendering;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace GalaQuest.Tests
{
    // Optional custody-tier candidate inspection. No source asset is a CI prerequisite,
    // and successful diagnostics do not register or promote a shipping enemy.
    public sealed class U2EnemyCandidatePlayModeTests
    {
        [UnityTest]
        public IEnumerator CandidateFbxPlaysFiveNativeClipsOnItsActualSkin()
        {
#if UNITY_EDITOR
            var input = Environment.GetEnvironmentVariable("GQ_U2_CANDIDATE_DIRECTORY");
            if (string.IsNullOrEmpty(input)) Assert.Ignore("Set GQ_U2_CANDIDATE_DIRECTORY to inspect a custodied candidate.");
            var sourceFbx = Path.Combine(input, "lava-gremlin-local-v1.fbx");
            var texturePath = Path.GetFullPath(Path.Combine(input, "../gremlin-body/texture_0_base_color.png"));
            var output = Path.Combine(input, "unity-playmode");
            const string temporary = "Assets/U2RigInspectionTemporary";
            Assert.That(File.Exists(sourceFbx), Is.True);
            Assert.That(File.Exists(texturePath), Is.True);
            Assert.That(Directory.Exists(temporary), Is.False, "Preserve any pre-existing inspection work");
            UnityEditor.AssetDatabase.CreateFolder("Assets", "U2RigInspectionTemporary");
            GameObject body = null;
            GameObject stage = null;
            Material material = null;
            var graph = default(PlayableGraph);
            var previousAmbientMode = RenderSettings.ambientMode;
            var previousAmbient = RenderSettings.ambientLight;
            try
            {
                File.Copy(sourceFbx, temporary + "/Candidate.fbx");
                File.Copy(texturePath, temporary + "/BaseColor.png");
                UnityEditor.AssetDatabase.Refresh(UnityEditor.ImportAssetOptions.ForceSynchronousImport);
                var importer = (UnityEditor.ModelImporter)UnityEditor.AssetImporter.GetAtPath(temporary + "/Candidate.fbx");
                importer.animationType = UnityEditor.ModelImporterAnimationType.Generic;
                importer.importAnimation = true;
                importer.optimizeGameObjects = false;
                importer.isReadable = true;
                importer.SaveAndReimport();
                var clips = UnityEditor.AssetDatabase.LoadAllAssetsAtPath(temporary + "/Candidate.fbx")
                    .OfType<AnimationClip>().Where(clip => !clip.name.StartsWith("__preview__")).ToArray();
                Assert.That(clips.Length, Is.EqualTo(5), "Every authored action must survive the FBX importer");
                body = Object.Instantiate(UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>(temporary + "/Candidate.fbx"));
                var skin = body.GetComponentInChildren<SkinnedMeshRenderer>();
                Assert.That(skin, Is.Not.Null);
                Assert.That(skin.sharedMesh.vertexCount, Is.GreaterThan(8000));
                Assert.That(skin.bones.Length, Is.GreaterThanOrEqualTo(21));
                skin.updateWhenOffscreen = true;
                // Compare in the same baked-mesh space: FBX import leaves a 100x
                // conversion on the mesh transform relative to sharedMesh vertices.
                var bindMesh = new Mesh();
                skin.BakeMesh(bindMesh);
                var sourceRadius = bindMesh.vertices.Max(vertex => vertex.magnitude);
                Object.Destroy(bindMesh);
                var animator = body.GetComponent<Animator>();
                if (animator == null) animator = body.AddComponent<Animator>();
                animator.applyRootMotion = false;
                animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
                graph = PlayableGraph.Create("Candidate native clip inspection");
                graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
                var animationOutput = AnimationPlayableOutput.Create(graph, "Candidate", animator);
                graph.Play();

                material = new Material(Shader.Find("Universal Render Pipeline/Lit"));
                material.SetTexture("_BaseMap", UnityEditor.AssetDatabase.LoadAssetAtPath<Texture2D>(temporary + "/BaseColor.png"));
                material.SetFloat("_Metallic", 0);
                material.SetFloat("_Smoothness", .15f);
                skin.sharedMaterial = material;
                stage = new GameObject("Candidate diagnostic stage");
                var camera = new GameObject("Candidate camera").AddComponent<Camera>();
                camera.transform.SetParent(stage.transform);
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = new Color(.70f, .72f, .75f);
                camera.orthographic = true;
                camera.orthographicSize = .85f;
                camera.nearClipPlane = .05f;
                camera.farClipPlane = 20;
                var light = new GameObject("Candidate light").AddComponent<Light>();
                light.transform.SetParent(stage.transform);
                light.type = LightType.Directional;
                light.intensity = 2;
                light.transform.rotation = Quaternion.Euler(35, -30, 0);
                RenderSettings.ambientMode = AmbientMode.Flat;
                RenderSettings.ambientLight = new Color(.55f, .55f, .55f);
                Directory.CreateDirectory(output);
                yield return null;
                var report = new System.Text.StringBuilder("Actual FBX skin, native clips evaluated by Playables in Unity Play Mode. Diagnostic only.\n");
                foreach (var name in new[] { "idle", "walk", "bash", "hit", "death" })
                {
                    var clip = clips.SingleOrDefault(candidate => candidate.name == name || candidate.name.EndsWith("|" + name));
                    Assert.That(clip, Is.Not.Null, "Missing action " + name + ": " + string.Join(", ", clips.Select(c => c.name)));
                    var playable = AnimationClipPlayable.Create(graph, clip);
                    animationOutput.SetSourcePlayable(playable);
                    playable.SetTime(0);
                    graph.Evaluate(0);
                    var rootPosition = body.transform.position;
                    var rootRotation = body.transform.rotation;
                    var bindLengths = skin.bones.Select(bone => bone.localPosition.magnitude).ToArray();
                    var before = skin.bones.Select(bone => bone.localRotation).ToArray();
                    var largestChange = 0f;
                    var sampleMesh = new Mesh();
                    report.AppendLine($"{name}: imported={clip.name}, duration={clip.length:F3}s");
                    try
                    {
                        foreach (var fraction in new[] { 0f, .25f, .45f, .6f, 1f })
                        {
                            playable.SetTime(clip.length * fraction);
                            graph.Evaluate(0);
                            // Allow Unity to upload the new skin matrices before Camera.Render.
                            // Immediate CPU BakeMesh sees the new pose while GPU capture can lag.
                            yield return null;
                            skin.BakeMesh(sampleMesh);
                            var yaw = name == "idle" && fraction == 0 ? 0f : 35f;
                            camera.transform.position = new Vector3(0, .5f, 0) + Quaternion.Euler(0, yaw, 0) * new Vector3(0, .7f, 3);
                            camera.transform.LookAt(new Vector3(0, .5f, 0));
                            Capture(camera, Path.Combine(output, $"{name}-{fraction:F2}.png"));
                            report.AppendLine($"  t={clip.length * fraction:F3}s bounds={sampleMesh.bounds} hips={skin.bones.First(b => b.name == "Hips").position}");
                            File.WriteAllText(Path.Combine(output, "inspection.txt"), report.ToString());
                            // AABB diagonals grow when a rigid body turns diagonally, even without
                            // deformation. Radial reach plus bone-length checks avoids that false alarm.
                            Assert.That(sampleMesh.vertices.Max(vertex => vertex.magnitude), Is.LessThan(sourceRadius * 1.3f), "Exploding skin in " + name);
                            Assert.That(sampleMesh.bounds.size.y, Is.GreaterThan(.2f), "Collapsed skin in " + name);
                            largestChange = Mathf.Max(largestChange, skin.bones.Select((bone, index) => Quaternion.Angle(before[index], bone.localRotation)).Max());
                            Assert.That(Vector3.Distance(body.transform.position, rootPosition), Is.LessThan(.001f), "Host owns world translation");
                            Assert.That(Quaternion.Angle(body.transform.rotation, rootRotation), Is.LessThan(.01f));
                            for (var index = 0; index < skin.bones.Length; index++)
                            {
                                var bone = skin.bones[index];
                                if (bone.name == "Hips" || bone.name == "Root") continue;
                                Assert.That(bone.localPosition.magnitude, Is.EqualTo(bindLengths[index]).Within(.001f), "Stretch in " + name + "/" + bone.name);
                            }
                        }
                    }
                    finally { Object.Destroy(sampleMesh); }
                    Assert.That(largestChange, Is.GreaterThan(.5f), "Frozen imported clip " + name);
                    report.AppendLine($"{name}: imported={clip.name}, duration={clip.length:F3}s, largestJointRotationChange={largestChange:F2}deg");
                    graph.DestroyPlayable(playable);
                }
                File.WriteAllText(Path.Combine(output, "inspection.txt"), report.ToString());
            }
            finally
            {
                if (graph.IsValid()) graph.Destroy();
                if (body != null) Object.DestroyImmediate(body);
                if (stage != null) Object.DestroyImmediate(stage);
                if (material != null) Object.DestroyImmediate(material);
                RenderSettings.ambientMode = previousAmbientMode;
                RenderSettings.ambientLight = previousAmbient;
                UnityEditor.AssetDatabase.DeleteAsset(temporary);
            }
#else
            Assert.Ignore("Custody-tier FBX import requires the Editor play-mode runner.");
            yield break;
#endif
        }

        private static void Capture(Camera camera, string path)
        {
            var target = new RenderTexture(600, 600, 24);
            var previous = RenderTexture.active;
            var pixels = new Texture2D(600, 600, TextureFormat.RGB24, false);
            try
            {
                camera.targetTexture = target;
                camera.Render();
                RenderTexture.active = target;
                pixels.ReadPixels(new Rect(0, 0, 600, 600), 0, 0);
                pixels.Apply();
                File.WriteAllBytes(path, pixels.EncodeToPNG());
            }
            finally
            {
                camera.targetTexture = null;
                RenderTexture.active = previous;
                Object.DestroyImmediate(pixels);
                Object.DestroyImmediate(target);
            }
        }
    }
}
