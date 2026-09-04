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
    /// Phone-readable renders of the fit contracts, plus a manifest carrying the NUMBERS the pictures
    /// depict.
    ///
    /// The manifest matters as much as the images here. A picture can show that a helmet box looks
    /// about head-sized; only the manifest can show that the width is 0.19 m, that it came from
    /// Head-dominated vertices at the 95th percentile, and that the clearance added to it was authored.
    /// Review the manifest for authority and the images for plausibility.
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

            var definitions = GearFitFixtureKitAuthoring.EnsureDefinitions();
            var registration = GearFitAssetRegistrationAuthoring.EnsureSilverguardHelmetRegistration();

            var hero = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            var cameraObject = new GameObject("FitFixtureReviewCamera");
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.12f, .14f, .18f, 1f);
            camera.nearClipPlane = .01f;
            camera.farClipPlane = 50f;

            var captures = new List<string>();
            try
            {
                var survey = GearHeroDatumSurvey.Measure(hero);

                foreach (var fixture in definitions)
                {
                    var renderRoot = new GameObject(fixture.DisplayName + " evidence");
                    try
                    {
                        var focus = DrawFixture(renderRoot.transform, hero.transform, fixture);

                        // Stand IN FRONT of the wearer (+Z), on the side the slot lives on. Viewing
                        // from behind hides the face datums and the +Z arrow, which are exactly what
                        // this evidence exists to show.
                        var side = fixture.PrimaryFrame.Side == GearFitFrameSide.Left ? -1f : 1f;
                        camera.transform.position = focus + new Vector3(side * .95f, .18f, 1.45f);
                        camera.transform.LookAt(focus);
                        camera.fieldOfView = fixture.Slot == GearFitFixtureSlot.Helmet ? 26f : 34f;

                        LabelFixture(renderRoot.transform, hero.transform, fixture, camera.transform);
                        captures.Add(Render(
                            camera, fixture.Slot.ToString().ToLowerInvariant() + "-fixture.png", output));
                    }
                    finally
                    {
                        Object.DestroyImmediate(renderRoot);
                    }
                }

                var sha = RunGit("rev-parse HEAD", repoRoot);
                var dirty = RunGit("diff --name-only HEAD -- unity docs tools public", repoRoot);
                File.WriteAllText(
                    Path.Combine(output, "review-manifest.json"),
                    BuildManifest(sha, dirty, captures, definitions, survey, registration));
                Debug.Log("Fit contract review pack captured " + captures.Count + " images into " + output + ".");
            }
            finally
            {
                Object.DestroyImmediate(cameraObject);
                Object.DestroyImmediate(hero);
            }
        }

        private static string BuildManifest(
            string sha,
            string dirty,
            List<string> captures,
            GearFitFixtureDefinition[] definitions,
            GearHeroDatumSurvey.Survey survey,
            GearFitAssetRegistration registration)
        {
            var json = new StringBuilder();
            json.AppendLine("{");
            json.AppendLine("  \"schema\": \"galaquest.unity-gear-fit-contract-review-pack\",");
            json.AppendLine("  \"schemaVersion\": 2,");
            json.AppendLine("  \"contract\": \"" + GearFitCanonicalSpace.ContractId + "\",");
            json.AppendLine("  \"contractVersion\": \"" + GearFitCanonicalSpace.ContractVersion + "\",");
            json.AppendLine("  \"coordinateConvention\": \"" + GearFitCanonicalSpace.Description + "\",");
            json.AppendLine("  \"unityVersion\": \"" + Application.unityVersion + "\",");
            json.AppendLine("  \"gitSha\": \"" + sha + "\",");
            json.AppendLine("  \"exactShaClaim\": " + (string.IsNullOrWhiteSpace(dirty) ? "true" : "false") + ",");

            json.AppendLine("  \"canonicalSpaceEvidence\": {");
            json.AppendLine("    \"valid\": " + (survey.IsCanonical ? "true" : "false") + ",");
            json.AppendLine("    \"error\": \"" + Escape(survey.CanonicalSpaceError) + "\",");
            json.AppendLine("    \"upFromFeetToHead\": " + Vec(survey.UpEvidence) + ",");
            json.AppendLine("    \"rightFromLeftToRightShoulder\": " + Vec(survey.RightEvidence) + ",");
            json.AppendLine("    \"rightFromLeftToRightHip\": " + Vec(survey.HipRightEvidence) + ",");
            json.AppendLine("    \"forwardFromHeadToFaceHelper\": " + Vec(survey.ForwardEvidence));
            json.AppendLine("  },");

            json.AppendLine("  \"heroJointsInRootSpace\": {");
            json.AppendLine(string.Join(",\n", GearHeroDatumSurvey.RequiredJoints.Select(joint =>
                "    \"" + joint + "\": " + Vec(survey.LocalJoint(joint)))));
            json.AppendLine("  },");
            json.AppendLine("  \"derivedJointRoles\": {");
            json.AppendLine("    \"collarJoint\": \"" + survey.CollarJointName + "\",");
            json.AppendLine("    \"waistJoint\": \"" + survey.WaistJointName + "\"");
            json.AppendLine("  },");

            json.AppendLine("  \"measuredHero\": {");
            json.AppendLine("    \"prefab\": \"" + GearHeroAuthoring.HeroPrefabPath + "\",");
            json.AppendLine("    \"sourceRepoPath\": \"" + GearHeroAuthoring.HeroSourceRepoPath + "\",");
            json.AppendLine("    \"sourceSha256\": \"" + GearHeroAuthoring.HeroSourceSha256 + "\",");
            json.AppendLine("    \"spanPercentile\": " + N(GearHeroDatumSurvey.SpanPercentile) + ",");
            json.AppendLine("    \"headWidthMetres\": " + N(survey.HeadWidth) + ",");
            json.AppendLine("    \"headDepthMetres\": " + N(survey.HeadDepth) + ",");
            json.AppendLine("    \"headHeightMetres\": " + N(survey.HeadHeight) + ",");
            json.AppendLine("    \"shoulderCupWidthMetres\": " + N(survey.ShoulderCupWidth) + ",");
            json.AppendLine("    \"chestWidthMetres\": " + N(survey.ChestWidth) + ",");
            json.AppendLine("    \"chestDepthMetres\": " + N(survey.ChestDepth) + ",");
            json.AppendLine("    \"torsoLengthMetres\": " + N(survey.TorsoLength) + ",");
            json.AppendLine("    \"forearmLengthMetres\": " + N(survey.ForearmLength) + ",");
            json.AppendLine("    \"forearmDiameterMetres\": " + N(survey.ForearmDiameter));
            json.AppendLine("  },");

            json.AppendLine("  \"fixtures\": [");
            for (var i = 0; i < definitions.Length; i++)
            {
                var fixture = definitions[i];
                var valid = fixture.TryValidateContract(null, out var error);
                json.AppendLine("    {");
                json.AppendLine("      \"slot\": \"" + fixture.Slot + "\",");
                json.AppendLine("      \"valid\": " + (valid ? "true" : "false") + ",");
                json.AppendLine("      \"validationError\": \"" + Escape(error) + "\",");
                json.AppendLine("      \"frames\": [");
                json.AppendLine(string.Join(",\n", fixture.Frames.Select(frame =>
                    "        { \"id\": \"" + frame.FrameId + "\", \"anchorBone\": \"" + frame.AnchorBone +
                    "\", \"side\": \"" + frame.Side + "\", \"right\": " + Vec(frame.RightAxisInAnchor) +
                    ", \"up\": " + Vec(frame.UpAxisInAnchor) + ", \"forward\": " +
                    Vec(frame.ForwardAxisInAnchor) + ", \"provenance\": \"" + frame.Provenance + "\" }")));
                json.AppendLine("      ],");
                json.AppendLine("      \"primary\": {");
                json.AppendLine("        \"metric\": \"" + fixture.PrimaryMeasurement.Metric + "\",");
                json.AppendLine("        \"datum\": \"" + fixture.PrimaryMeasurement.SourceDatumId + "\",");
                json.AppendLine("        \"axis\": \"" + fixture.PrimaryMeasurement.Axis + "\",");
                json.AppendLine("        \"referenceMetres\": " +
                                N(fixture.PrimaryMeasurement.ReferenceValueMetres) + ",");
                json.AppendLine("        \"provenance\": \"" + fixture.PrimaryMeasurement.Provenance + "\"");
                json.AppendLine("      },");
                json.AppendLine("      \"datums\": [");
                json.AppendLine(string.Join(",\n", fixture.Datums.Select(datum =>
                    "        { \"id\": \"" + datum.DatumId + "\", \"role\": \"" + datum.Role +
                    "\", \"provenance\": \"" + datum.Provenance + "\", \"frame\": \"" + datum.FrameId +
                    "\", \"centre\": " + Vec(datum.LocalCenter) + ", \"size\": " + Vec(datum.LocalSize) +
                    ", \"sourceJoints\": [" +
                    string.Join(", ", datum.SourceJoints.Select(joint => "\"" + joint + "\"")) + "] }")));
                json.AppendLine("      ],");
                json.AppendLine("      \"secondaryProportionChecks\": [");
                json.AppendLine(string.Join(",\n", fixture.SecondaryProportionChecks.Select(check =>
                    "        { \"id\": \"" + check.CheckId + "\", \"ratio\": \"" + check.NumeratorAxis +
                    "/" + check.DenominatorAxis + "\", \"rejectBelow\": " + N(check.RejectBelow) +
                    ", \"warnBelow\": " + N(check.WarnBelow) + ", \"warnAbove\": " + N(check.WarnAbove) +
                    ", \"rejectAbove\": " + N(check.RejectAbove) + ", \"provenance\": \"" +
                    check.Provenance + "\" }")));
                json.AppendLine("      ]");
                json.Append("    }");
                json.AppendLine(i == definitions.Length - 1 ? string.Empty : ",");
            }

            json.AppendLine("  ],");

            json.AppendLine("  \"registrationProof\": {");
            json.AppendLine("    \"semanticAssetId\": \"" + registration.SemanticAssetId + "\",");
            json.AppendLine("    \"sourceRepoPath\": \"" + registration.SourceRepoPath + "\",");
            json.AppendLine("    \"slot\": \"" + registration.FixtureSlot + "\",");
            json.AppendLine("    \"frame\": \"" + registration.GearFrameId + "\",");
            json.AppendLine("    \"landmark\": \"" + registration.FunctionalLandmarkId + "\",");
            json.AppendLine("    \"rawToCanonicalEuler\": " + Vec(registration.RawToCanonicalEuler) + ",");
            json.AppendLine("    \"measuredPrimaryMetres\": " +
                            N(registration.MeasuredPrimaryDimensionMetres) + ",");
            json.AppendLine("    \"targetPrimaryMetres\": " +
                            N(registration.TargetPrimaryDimensionMetres) + ",");
            json.AppendLine("    \"uniformNormalizationScale\": " +
                            N(registration.UniformNormalizationScale) + ",");
            json.AppendLine("    \"normalizedSizeMetres\": " + Vec(registration.NormalizedSizeInFrame) + ",");
            json.AppendLine("    \"ownerAuthoredScaleForComparison\": " +
                            N(registration.OwnerAuthoredScaleForComparison) + ",");
            json.AppendLine("    \"contractScaleAsFractionOfOwnerScale\": " +
                            N(registration.OwnerAuthoredScaleForComparison <= 0f
                                ? 0f
                                : registration.UniformNormalizationScale /
                                  registration.OwnerAuthoredScaleForComparison) + ",");
            json.AppendLine("    \"status\": \"" + registration.Status + "\",");
            json.AppendLine("    \"findings\": [" + string.Join(", ",
                registration.ProportionFindings.Select(f => "\"" + Escape(f) + "\"")) + "]");
            json.AppendLine("  },");

            json.AppendLine("  \"note\": \"Temporary line renderers visualize contract data; the kit " +
                            "itself is Scene View-only. The numbers in this manifest are the authority; " +
                            "the images show only that they are plausible on the Hero.\",");
            json.AppendLine("  \"captures\": [");
            json.AppendLine(string.Join(",\n", captures.Select(c => "    \"" + c + "\"")));
            json.AppendLine("  ]");
            json.AppendLine("}");
            return json.ToString();
        }

        private static Vector3 DrawFixture(
            Transform renderRoot,
            Transform heroRoot,
            GearFitFixtureDefinition fixture)
        {
            var focus = Vector3.zero;
            var frames = 0;

            foreach (var frame in fixture.Frames)
            {
                var anchor = FindDescendant(heroRoot, frame.AnchorBone);
                if (anchor == null)
                    throw new MissingReferenceException("Missing fixture anchor bone: " + frame.AnchorBone);
                if (!frame.TryResolveWorldRotation(anchor, out var rotation, out var error))
                    throw new System.InvalidOperationException(error);

                var origin = anchor.TransformPoint(frame.OriginInAnchor);
                focus += origin;
                frames++;

                DrawLine(renderRoot, origin, origin + rotation * Vector3.right * .17f,
                    GearFitFixtureOverlay.RightColor);
                DrawLine(renderRoot, origin, origin + rotation * Vector3.up * .17f,
                    GearFitFixtureOverlay.UpColor);
                DrawLine(renderRoot, origin, origin + rotation * Vector3.forward * .17f,
                    GearFitFixtureOverlay.ForwardColor);

                foreach (var datum in fixture.Datums)
                {
                    if (datum.FrameId != frame.FrameId) continue;
                    DrawBox(renderRoot, origin + rotation * datum.LocalCenter, rotation, datum.LocalSize,
                        GearFitFixtureOverlay.ColorFor(datum.Role));
                }

                DrawPrimary(renderRoot, fixture, frame, origin, rotation);
            }

            return frames == 0 ? Vector3.zero : focus / frames;
        }

        /// <summary>
        /// Write the axis names, the anchor and the primary measurement into the render itself.
        ///
        /// The Scene View overlay has Handles.Label; a still does not, and a colour key a reviewer has
        /// to look up elsewhere is not "clearly visible". These are billboarded TextMesh objects, torn
        /// down with the rest of the temporary render root.
        /// </summary>
        private static void LabelFixture(
            Transform renderRoot,
            Transform heroRoot,
            GearFitFixtureDefinition fixture,
            Transform camera)
        {
            foreach (var frame in fixture.Frames)
            {
                var anchor = FindDescendant(heroRoot, frame.AnchorBone);
                if (anchor == null) continue;
                if (!frame.TryResolveWorldRotation(anchor, out var rotation, out _)) continue;

                var origin = anchor.TransformPoint(frame.OriginInAnchor);

                // Sit each label just beyond its own arrow tip so the three do not pile up on the anchor.
                const float tip = .21f;
                Label(renderRoot, camera, origin + rotation * Vector3.right * tip,
                    "+X RIGHT", GearFitFixtureOverlay.RightColor);
                Label(renderRoot, camera, origin + rotation * Vector3.up * tip,
                    "+Y UP", GearFitFixtureOverlay.UpColor);
                Label(renderRoot, camera, origin + rotation * Vector3.forward * tip,
                    "+Z FWD", GearFitFixtureOverlay.ForwardColor);

                var primary = fixture.PrimaryMeasurement;
                if (!fixture.TryGetDatum(primary.SourceDatumId, out var datum)) continue;
                if (datum.FrameId != frame.FrameId) continue;

                var axis = rotation * GearFitFrame.AxisVector(primary.Axis);
                var center = origin + rotation * datum.LocalCenter;
                Label(renderRoot, camera,
                    center + axis * (.5f * primary.ReferenceValueMetres) + rotation * Vector3.up * .05f,
                    "PRIMARY " + primary.ReferenceValueMetres.ToString("F3") + " m " + primary.Axis,
                    GearFitFixtureOverlay.PrimaryColor);
            }
        }

        private static void Label(
            Transform root, Transform camera, Vector3 position, string text, Color color)
        {
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (font == null) return;

            var labelObject = new GameObject("fixture label");
            labelObject.transform.SetParent(root, true);
            labelObject.transform.position = position;

            // Billboard toward the camera. Rotated 180 about up because TextMesh reads correctly when
            // its own forward points AWAY from the viewer.
            labelObject.transform.rotation =
                Quaternion.LookRotation(position - camera.position, Vector3.up);

            var mesh = labelObject.AddComponent<TextMesh>();
            mesh.text = text;
            mesh.font = font;
            mesh.color = color;
            // fontSize * characterSize sets the world height of a glyph. Roughly 2 cm of text at the
            // framing this pack uses; larger and the five labels overlap into an unreadable mat.
            mesh.fontSize = 80;
            mesh.characterSize = .0022f;
            mesh.anchor = TextAnchor.MiddleCenter;
            mesh.alignment = TextAlignment.Center;
            labelObject.GetComponent<MeshRenderer>().sharedMaterial = font.material;
        }

        private static void DrawPrimary(
            Transform renderRoot,
            GearFitFixtureDefinition fixture,
            GearFitFrame frame,
            Vector3 origin,
            Quaternion rotation)
        {
            var primary = fixture.PrimaryMeasurement;
            if (!fixture.TryGetDatum(primary.SourceDatumId, out var datum)) return;
            if (datum.FrameId != frame.FrameId) return;

            var axis = rotation * GearFitFrame.AxisVector(primary.Axis);
            var center = origin + rotation * datum.LocalCenter;
            var half = .5f * primary.ReferenceValueMetres;
            DrawLine(renderRoot, center - axis * half, center + axis * half,
                GearFitFixtureOverlay.PrimaryColor);
        }

        private static void DrawBox(
            Transform root, Vector3 center, Quaternion rotation, Vector3 size, Color color)
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
            line.startWidth = .010f;
            line.endWidth = .010f;
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

        private static string N(float value)
        {
            return value.ToString("F5", CultureInfo.InvariantCulture);
        }

        private static string Vec(Vector3 value)
        {
            return "[" + N(value.x) + ", " + N(value.y) + ", " + N(value.z) + "]";
        }

        private static string Escape(string value)
        {
            return string.IsNullOrEmpty(value)
                ? string.Empty
                : value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ");
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
