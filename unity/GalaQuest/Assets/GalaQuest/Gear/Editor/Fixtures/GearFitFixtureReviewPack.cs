using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using GalaQuest.Gear;
using UnityEditor;
using UnityEngine;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Captures the same fixture data as simple phone-readable Unity renders. The kit itself remains
    /// Scene View gizmos; these temporary line meshes exist only while making review evidence.
    /// </summary>
    public static class GearFitFixtureReviewPack
    {
        public const string OutputRoot = ".local/unity/review-pack/fit-fixtures";
        private const int Width = 1080;
        private const int Height = 1350;

        [MenuItem("GalaQuest/Gear/Capture fit fixture review pack")]
        public static void Capture()
        {
            var repoRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", ".."));
            var output = Path.Combine(repoRoot, OutputRoot.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(output);

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(GearHeroAuthoring.HeroPrefabPath);
            if (prefab == null) throw new FileNotFoundException("GQ_HERO_V1 prefab missing.");

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            var cameraObject = new GameObject("FitFixtureReviewCamera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.12f, .14f, .18f, 1f);
            camera.nearClipPlane = .01f;
            camera.farClipPlane = 50f;
            var definitions = GearFitFixtureKitAuthoring.EnsureDefinitions();
            var captures = new List<string>();

            try
            {
                foreach (var fixture in definitions)
                {
                    var renderRoot = new GameObject(fixture.DisplayName + " evidence");
                    try
                    {
                        var target = DrawFixture(renderRoot.transform, hero.transform, fixture, false);
                        if (fixture.Slot == GearFitFixtureSlot.Shoulder)
                            DrawFixture(renderRoot.transform, hero.transform, fixture, true);

                        camera.transform.position = target + new Vector3(.8f, .15f, -1.65f);
                        camera.transform.LookAt(target);
                        camera.fieldOfView = fixture.Slot == GearFitFixtureSlot.Helmet ? 28f : 35f;
                        captures.Add(Render(camera, fixture.Slot.ToString().ToLowerInvariant() + "-fixture.png", output));
                    }
                    finally
                    {
                        Object.DestroyImmediate(renderRoot);
                    }
                }

                var sha = RunGit("rev-parse HEAD", repoRoot);
                var dirty = RunGit("diff --name-only HEAD -- unity docs tools public", repoRoot);
                var manifest = new StringBuilder();
                manifest.AppendLine("{");
                manifest.AppendLine("  \"schema\": \"galaquest.unity-gear-fit-fixture-review-pack\",");
                manifest.AppendLine("  \"schemaVersion\": 1,");
                manifest.AppendLine("  \"unityVersion\": \"" + Application.unityVersion + "\",");
                manifest.AppendLine("  \"gitSha\": \"" + sha + "\",");
                manifest.AppendLine("  \"exactShaClaim\": " + (string.IsNullOrWhiteSpace(dirty) ? "true" : "false") + ",");
                manifest.AppendLine("  \"note\": \"Temporary line renderers visualize editor fixture data; the kit itself is Scene View-only.\",");
                manifest.AppendLine("  \"captures\": [");
                manifest.AppendLine(string.Join(",\n", captures.Select(c => "    \"" + c + "\"")));
                manifest.AppendLine("  ]");
                manifest.AppendLine("}");
                File.WriteAllText(Path.Combine(output, "review-manifest.json"), manifest.ToString());
                Debug.Log("Fit fixture review pack captured " + captures.Count + " images into " + output + ".");
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(hero);
            }
        }

        private static Vector3 DrawFixture(
            Transform renderRoot,
            Transform heroRoot,
            GearFitFixtureDefinition fixture,
            bool mirrored)
        {
            var boneName = mirrored ? fixture.MirroredAnchorBone : fixture.AnchorBone;
            var anchor = FindDescendant(heroRoot, boneName);
            if (anchor == null) throw new MissingReferenceException("Missing fixture anchor bone: " + boneName);

            var sign = mirrored ? -1f : 1f;
            var basis = Quaternion.LookRotation(
                anchor.TransformDirection(Mirror(fixture.ForwardAxis, sign)),
                anchor.TransformDirection(Mirror(fixture.UpAxis, sign)));
            var anchorPoint = anchor.TransformPoint(Mirror(fixture.AnchorOffset, sign));
            DrawAxes(renderRoot, anchorPoint, basis, mirrored);
            DrawBox(renderRoot, anchor.TransformPoint(Mirror(fixture.InnerClearanceCenter, sign)),
                basis, fixture.InnerClearanceSize, new Color(.15f, .85f, 1f, 1f));

            foreach (var landmark in fixture.Landmarks)
            {
                DrawBox(renderRoot, anchor.TransformPoint(Mirror(landmark.LocalCenter, sign)),
                    basis, landmark.LocalSize, ColorFor(landmark.Kind));
            }

            return anchorPoint + anchor.TransformDirection(Mirror(fixture.InnerClearanceCenter, sign));
        }

        private static void DrawAxes(Transform root, Vector3 origin, Quaternion basis, bool mirrored)
        {
            DrawLine(root, origin, origin + basis * Vector3.forward * .18f, new Color(1f, .3f, .2f, 1f));
            DrawLine(root, origin, origin + basis * Vector3.up * .18f, new Color(.2f, 1f, .35f, 1f));
            DrawLine(root, origin, origin + basis * Vector3.right * .18f, new Color(.2f, .5f, 1f, 1f));
        }

        private static void DrawBox(Transform root, Vector3 center, Quaternion rotation, Vector3 size, Color color)
        {
            var half = size * .5f;
            var corners = new Vector3[8];
            for (var i = 0; i < corners.Length; i++)
            {
                corners[i] = center + rotation * new Vector3(
                    (i & 1) == 0 ? -half.x : half.x,
                    (i & 2) == 0 ? -half.y : half.y,
                    (i & 4) == 0 ? -half.z : half.z);
            }

            foreach (var edge in new[]
            {
                new[] { 0, 1 }, new[] { 0, 2 }, new[] { 0, 4 }, new[] { 1, 3 },
                new[] { 1, 5 }, new[] { 2, 3 }, new[] { 2, 6 }, new[] { 3, 7 },
                new[] { 4, 5 }, new[] { 4, 6 }, new[] { 5, 7 }, new[] { 6, 7 },
            })
            {
                DrawLine(root, corners[edge[0]], corners[edge[1]], color);
            }
        }

        private static void DrawLine(Transform root, Vector3 from, Vector3 to, Color color)
        {
            var lineObject = new GameObject("fixture line");
            lineObject.transform.SetParent(root, true);
            var line = lineObject.AddComponent<LineRenderer>();
            line.material = new Material(Shader.Find("Sprites/Default")) { color = color };
            line.startColor = color;
            line.endColor = color;
            line.startWidth = .012f;
            line.endWidth = .012f;
            line.positionCount = 2;
            line.SetPosition(0, from);
            line.SetPosition(1, to);
        }

        private static string Render(Camera camera, string fileName, string output)
        {
            var texture = new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32);
            var readback = new Texture2D(Width, Height, TextureFormat.RGB24, false);
            var previous = RenderTexture.active;
            try
            {
                camera.targetTexture = texture;
                camera.Render();
                RenderTexture.active = texture;
                readback.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
                readback.Apply();
                File.WriteAllBytes(Path.Combine(output, fileName), readback.EncodeToPNG());
                return fileName;
            }
            finally
            {
                camera.targetTexture = null;
                RenderTexture.active = previous;
                Object.DestroyImmediate(readback);
                texture.Release();
                Object.DestroyImmediate(texture);
            }
        }

        private static Color ColorFor(GearFitFixtureLandmarkKind kind)
        {
            switch (kind)
            {
                case GearFitFixtureLandmarkKind.KeepClear: return new Color(.2f, 1f, .3f, 1f);
                case GearFitFixtureLandmarkKind.CollisionWarning: return new Color(1f, .2f, .1f, 1f);
                default: return new Color(1f, .7f, .1f, 1f);
            }
        }

        private static Vector3 Mirror(Vector3 value, float sign)
        {
            return new Vector3(value.x * sign, value.y, value.z);
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root.name == name) return root;
            foreach (Transform child in root)
            {
                var match = FindDescendant(child, name);
                if (match != null) return match;
            }
            return null;
        }

        private static string RunGit(string arguments, string workingDirectory)
        {
            var info = new System.Diagnostics.ProcessStartInfo("git", arguments)
            {
                WorkingDirectory = workingDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using (var process = System.Diagnostics.Process.Start(info))
            {
                if (process == null) return string.Empty;
                var output = process.StandardOutput.ReadToEnd();
                process.WaitForExit(15000);
                return output.Trim();
            }
        }
    }
}
