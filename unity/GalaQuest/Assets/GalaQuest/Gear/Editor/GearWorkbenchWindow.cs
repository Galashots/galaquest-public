using System.Collections.Generic;
using System.IO;
using System.Linq;
using GalaQuest.Gear;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// The Owner-facing gear fitting surface.
    ///
    /// Deliberately NOT a 3D manipulator. Unity's Scene View already moves, rotates and scales things
    /// better than any custom panel would, so this window only does the things Unity has no opinion
    /// about: which item is loaded, which pose the Hero is standing in, where the camera is looking,
    /// what the machine gates currently say, and whether the candidate has been saved.
    ///
    /// Everything it saves is ordinary project data, so a fit survives closing Unity.
    /// </summary>
    public sealed class GearWorkbenchWindow : EditorWindow
    {
        public const string ScenePath = "Assets/GalaQuest/Gear/Scenes/GearWorkbench.unity";

        private GearItemDefinition[] items = new GearItemDefinition[0];
        private string[] itemLabels = new string[0];
        private int selectedIndex;

        private AnimationClip[] clips = new AnimationClip[0];
        private string[] clipLabels = new string[0];
        private int clipIndex;
        private float normalizedTime;
        private bool posing;

        private List<GearFitIssue> issues = new List<GearFitIssue>();
        private Vector2 scroll;

        [MenuItem("GalaQuest/Gear/Gear Workbench")]
        public static void Open()
        {
            var window = GetWindow<GearWorkbenchWindow>("Gear Workbench");
            window.minSize = new Vector2(360f, 480f);
            window.Show();
        }

        private void OnEnable()
        {
            RefreshItems();
            RefreshClips();
        }

        private void OnDisable()
        {
            StopPosing();
        }

        private void RefreshItems()
        {
            items = AssetDatabase.FindAssets("t:GearItemDefinition")
                .Select(AssetDatabase.GUIDToAssetPath)
                .Select(AssetDatabase.LoadAssetAtPath<GearItemDefinition>)
                .Where(asset => asset != null)
                .OrderBy(asset => asset.DisplayName)
                .ToArray();

            itemLabels = items.Select(asset => asset.DisplayName).ToArray();
            selectedIndex = Mathf.Clamp(selectedIndex, 0, Mathf.Max(0, items.Length - 1));
        }

        private void RefreshClips()
        {
            clips = AssetDatabase.LoadAllAssetsAtPath(GearHeroAuthoring.HeroModelPath)
                .OfType<AnimationClip>()
                .Where(clip => !clip.name.StartsWith("__preview__"))
                .OrderBy(clip => clip.name)
                .ToArray();

            clipLabels = clips.Select(clip => clip.name).ToArray();
            clipIndex = Mathf.Clamp(clipIndex, 0, Mathf.Max(0, clips.Length - 1));
        }

        private void OnGUI()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);

            EditorGUILayout.LabelField("GQ_HERO_V1 Gear Workbench", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Fit gear with the normal Scene View move/rotate/scale gizmos. This panel only loads, " +
                "poses, frames, checks and saves.",
                MessageType.None);

            DrawSceneSection();
            DrawFixtureSection();
            EditorGUILayout.Space();
            DrawItemSection();
            EditorGUILayout.Space();
            DrawPoseSection();
            EditorGUILayout.Space();
            DrawCameraSection();
            EditorGUILayout.Space();
            DrawValidationSection();

            EditorGUILayout.EndScrollView();
        }

        private void DrawSceneSection()
        {
            EditorGUILayout.LabelField("1. Workbench scene", EditorStyles.boldLabel);
            if (GUILayout.Button("Open Gear Workbench scene"))
            {
                OpenWorkbenchScene();
            }

            var hero = FindHero();
            EditorGUILayout.LabelField("Hero in scene",
                hero == null ? "not loaded" : hero.name);
        }

        private void DrawFixtureSection()
        {
            EditorGUILayout.LabelField("Fit contract", EditorStyles.boldLabel);
            if (!GearFitFixtureOverlay.IsConfigured)
            {
                EditorGUILayout.HelpBox(
                    "Open the Workbench scene to show the GQ_HERO_V1 slot contracts.",
                    MessageType.Info);
                return;
            }

            EditorGUILayout.HelpBox(
                "Arrows are labelled +X RIGHT, +Y UP, +Z FORWARD in wearer space. Cyan is functional " +
                "fit, green is keep-clear, red is collision warning, purple is decorative extent, " +
                "amber is reference only, and the yellow span is the primary normalization " +
                "measurement. Each label carries its provenance. The serialized fixture is the " +
                "authority; this drawing only shows it.",
                MessageType.None);

            var displayAll = EditorGUILayout.Toggle("Show all slots", GearFitFixtureOverlay.ShowAll);
            var selected = (GearFitFixtureSlot)EditorGUILayout.EnumPopup(
                "Solo slot", GearFitFixtureOverlay.SelectedSlot);
            if (displayAll != GearFitFixtureOverlay.ShowAll || selected != GearFitFixtureOverlay.SelectedSlot)
            {
                GearFitFixtureOverlay.ConfigureDisplay(displayAll, selected);
                SceneView.RepaintAll();
            }
        }

        private void DrawItemSection()
        {
            EditorGUILayout.LabelField("2. Item", EditorStyles.boldLabel);

            using (new EditorGUILayout.HorizontalScope())
            {
                if (items.Length == 0)
                {
                    EditorGUILayout.LabelField("No GearItemDefinition assets found.");
                }
                else
                {
                    selectedIndex = EditorGUILayout.Popup(selectedIndex, itemLabels);
                }

                if (GUILayout.Button("Refresh", GUILayout.Width(70f))) RefreshItems();
            }

            var definition = SelectedItem;
            using (new EditorGUI.DisabledScope(definition == null))
            {
                if (GUILayout.Button("Load item onto Hero"))
                {
                    MountSelected();
                }

                using (new EditorGUILayout.HorizontalScope())
                {
                    if (GUILayout.Button("Save candidate fit"))
                    {
                        SaveCandidateFit();
                    }

                    if (GUILayout.Button("Reset to saved"))
                    {
                        ResetToSaved();
                    }
                }
            }

            if (definition != null)
            {
                EditorGUILayout.LabelField("Socket", definition.SocketId);
                EditorGUILayout.LabelField("Fit class", definition.FitClass.ToString());
                EditorGUILayout.LabelField("Covers",
                    definition.HidesAnatomy == null || definition.HidesAnatomy.Length == 0
                        ? "nothing"
                        : string.Join(", ", definition.HidesAnatomy.Select(region => region.ToString())));
            }

            var coverage = FindCoverage();
            if (coverage != null)
            {
                var preview = EditorGUILayout.Toggle("Preview hidden anatomy", coverage.PreviewCoverage);
                if (preview != coverage.PreviewCoverage)
                {
                    Undo.RecordObject(coverage, "Toggle anatomy coverage preview");
                    coverage.PreviewCoverage = preview;
                    ApplyCoverage();
                }

                if (!string.IsNullOrEmpty(coverage.ValidationError))
                    EditorGUILayout.HelpBox(coverage.ValidationError, MessageType.Warning);
            }

            var visualizer = FindVisualizer();
            if (visualizer != null)
            {
                var show = EditorGUILayout.Toggle("Show head fit proxy", visualizer.ShowProxy);
                if (show != visualizer.ShowProxy)
                {
                    Undo.RecordObject(visualizer, "Toggle head fit proxy");
                    visualizer.ShowProxy = show;
                    SceneView.RepaintAll();
                }
            }
        }

        private void DrawPoseSection()
        {
            EditorGUILayout.LabelField("3. Pose", EditorStyles.boldLabel);

            if (clips.Length == 0)
            {
                EditorGUILayout.HelpBox(
                    "No AnimationClips found on " + GearHeroAuthoring.HeroModelPath,
                    MessageType.Warning);
                return;
            }

            using (new EditorGUILayout.HorizontalScope())
            {
                var newClip = EditorGUILayout.Popup(clipIndex, clipLabels);
                if (newClip != clipIndex)
                {
                    clipIndex = newClip;
                    SamplePose();
                }

                if (GUILayout.Button("Bind pose", GUILayout.Width(80f)))
                {
                    StopPosing();
                }
            }

            var newTime = EditorGUILayout.Slider("Normalized time", normalizedTime, 0f, 1f);
            if (!Mathf.Approximately(newTime, normalizedTime))
            {
                normalizedTime = newTime;
                SamplePose();
            }

            using (new EditorGUILayout.HorizontalScope())
            {
                foreach (var preset in new[] { "idle", "running", "sword_slash" })
                {
                    if (!GUILayout.Button(preset)) continue;
                    var index = System.Array.FindIndex(clips, clip => clip.name.Contains(preset));
                    if (index >= 0)
                    {
                        clipIndex = index;
                        SamplePose();
                    }
                    else
                    {
                        Debug.LogWarning("GQ_HERO_V1 has no clip matching '" + preset + "'.");
                    }
                }
            }
        }

        private void DrawCameraSection()
        {
            EditorGUILayout.LabelField("4. Inspection view", EditorStyles.boldLabel);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Front")) FrameHead(GearReviewViews.View.Front);
                if (GUILayout.Button("Three-quarter")) FrameHead(GearReviewViews.View.ThreeQuarter);
                if (GUILayout.Button("Side")) FrameHead(GearReviewViews.View.Side);
                if (GUILayout.Button("Gameplay")) FrameHead(GearReviewViews.View.Gameplay);
            }
        }

        private void DrawValidationSection()
        {
            EditorGUILayout.LabelField("5. Machine gates", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "These reject bad fits. They never visually accept one -- that stays with Unity and " +
                "running-game inspection.",
                MessageType.None);

            if (GUILayout.Button("Run checks on current pose"))
            {
                RunValidation();
            }

            if (issues.Count == 0)
            {
                EditorGUILayout.LabelField("No rejections recorded in the last run.");
                return;
            }

            foreach (var issue in issues)
            {
                EditorGUILayout.HelpBox(issue.ToString(),
                    issue.Severity == GearFitSeverity.Rejection ? MessageType.Error : MessageType.Warning);
            }
        }

        private GearItemDefinition SelectedItem =>
            items.Length == 0 ? null : items[Mathf.Clamp(selectedIndex, 0, items.Length - 1)];

        public static void OpenWorkbenchScene()
        {
            if (File.Exists(ScenePath))
            {
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                return;
            }

            GearWorkbenchSceneBuilder.Build();
        }

        private static GameObject FindHero()
        {
            var scene = SceneManager.GetActiveScene();
            if (!scene.IsValid()) return null;

            foreach (var root in scene.GetRootGameObjects())
            {
                if (root.GetComponentInChildren<GearSocket>(true) != null) return root;
            }
            return null;
        }

        private static AnatomyCoveragePreview FindCoverage()
        {
            var hero = FindHero();
            return hero == null ? null : hero.GetComponentInChildren<AnatomyCoveragePreview>(true);
        }

        /// <summary>
        /// Hide whatever the currently mounted items declare they cover, so the Owner fits a helmet
        /// against the head it will actually sit on rather than against a hairstyle that will be hidden.
        /// </summary>
        private static void ApplyCoverage()
        {
            var coverage = FindCoverage();
            var hero = FindHero();
            if (coverage == null || hero == null) return;

            var regions = new List<AnatomyRegion>();
            foreach (var mount in hero.GetComponentsInChildren<GearMountedItem>(true))
            {
                if (mount.Definition?.HidesAnatomy == null) continue;
                if (!mount.gameObject.activeInHierarchy) continue;
                regions.AddRange(mount.Definition.HidesAnatomy);
            }

            coverage.Apply(regions);
            SceneView.RepaintAll();
        }

        private static HeadFitProxyVisualizer FindVisualizer()
        {
            var hero = FindHero();
            return hero == null ? null : hero.GetComponentInChildren<HeadFitProxyVisualizer>(true);
        }

        private static GearMountedItem FindMount(GearItemDefinition definition)
        {
            var hero = FindHero();
            if (hero == null) return null;

            foreach (var mount in hero.GetComponentsInChildren<GearMountedItem>(true))
                if (mount.Definition == definition) return mount;
            return null;
        }

        private void MountSelected()
        {
            var definition = SelectedItem;
            var hero = FindHero();
            if (definition == null || hero == null)
            {
                Debug.LogWarning("Open the workbench scene and select an item first.");
                return;
            }

            var existing = FindMount(definition);
            if (existing != null) Undo.DestroyObjectImmediate(existing.gameObject);

            var mounted = GearMounter.Mount(hero.transform, definition);
            mounted.AddComponent<GearMountedItem>().Configure(definition);
            Undo.RegisterCreatedObjectUndo(mounted, "Load gear item");
            Selection.activeGameObject = mounted;
            ApplyCoverage();
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
        }

        private void SaveCandidateFit()
        {
            var definition = SelectedItem;
            var mount = FindMount(definition);
            if (mount == null)
            {
                Debug.LogWarning("Load the item onto the Hero before saving a fit.");
                return;
            }

            var t = mount.transform;
            var scale = t.localScale;
            // The mirror flag owns the sign, so a mirrored pair keeps one authored scale.
            if (definition.MirrorX) scale = new Vector3(-scale.x, scale.y, scale.z);

            Undo.RecordObject(definition, "Save gear fit");
            definition.ApplyAuthoredFit(t.localPosition, t.localEulerAngles, scale);
            EditorUtility.SetDirty(definition);
            AssetDatabase.SaveAssets();
            Debug.Log("Saved candidate fit for " + definition.DisplayName + ".");
            RunValidation();
        }

        private void ResetToSaved()
        {
            var definition = SelectedItem;
            var mount = FindMount(definition);
            var hero = FindHero();
            if (mount == null || hero == null) return;

            var socket = GearMounter.ResolveSocket(hero.transform, definition.SocketId);
            Undo.RecordObject(mount.transform, "Reset gear fit");
            GearMounter.ApplyFit(mount.transform, socket, definition);
            SceneView.RepaintAll();
        }

        private void SamplePose()
        {
            var hero = FindHero();
            if (hero == null || clips.Length == 0) return;

            var clip = clips[Mathf.Clamp(clipIndex, 0, clips.Length - 1)];
            if (!AnimationMode.InAnimationMode())
            {
                AnimationMode.StartAnimationMode();
                posing = true;
            }

            AnimationMode.BeginSampling();
            AnimationMode.SampleAnimationClip(hero, clip, normalizedTime * clip.length);
            AnimationMode.EndSampling();
            SceneView.RepaintAll();
        }

        private void StopPosing()
        {
            if (!posing && !AnimationMode.InAnimationMode()) return;
            AnimationMode.StopAnimationMode();
            posing = false;
            SceneView.RepaintAll();
        }

        private void FrameHead(GearReviewViews.View view)
        {
            var hero = FindHero();
            if (hero == null) return;

            var sceneView = SceneView.lastActiveSceneView;
            if (sceneView == null) return;

            var head = GearHeroAuthoring.FindDescendant(hero.transform, GearSocketIds.HeadBone);
            var pivot = view == GearReviewViews.View.Gameplay || head == null
                ? hero.transform.position + Vector3.up * 0.8f
                : head.position;

            sceneView.pivot = pivot;
            sceneView.rotation = GearReviewViews.RotationFor(view);
            sceneView.size = GearReviewViews.SizeFor(view);
            sceneView.Repaint();
        }

        private void RunValidation()
        {
            var definition = SelectedItem;
            var hero = FindHero();
            var mount = FindMount(definition);
            var visualizer = FindVisualizer();

            if (definition == null || hero == null || mount == null)
            {
                issues = new List<GearFitIssue>();
                Debug.LogWarning("Load the item onto the Hero before running checks.");
                return;
            }

            issues = GearFitValidator.Validate(
                hero.transform,
                mount.gameObject,
                definition,
                visualizer == null ? null : visualizer.Proxy);

            Repaint();
        }
    }
}
