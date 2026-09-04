using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Scene View-only drawing for the GQ_HERO_V1 calibration kit. This is a static editor overlay,
    /// rather than a MonoBehaviour, so the fixture kit cannot leak a component into player builds.
    /// </summary>
    [InitializeOnLoad]
    public static class GearFitFixtureOverlay
    {
        private static Transform heroRoot;
        private static GearFitFixtureDefinition[] fixtures = new GearFitFixtureDefinition[0];
        private static bool showAll = true;
        private static GearFitFixtureSlot selectedSlot = GearFitFixtureSlot.Helmet;

        public static bool IsConfigured
        {
            get
            {
                ConfigureFromActiveScene();
                return heroRoot != null && fixtures.Length > 0;
            }
        }
        public static bool ShowAll => showAll;
        public static GearFitFixtureSlot SelectedSlot => selectedSlot;

        static GearFitFixtureOverlay()
        {
            SceneView.duringSceneGui -= DrawSceneView;
            SceneView.duringSceneGui += DrawSceneView;
        }

        public static void Configure(Transform root, GearFitFixtureDefinition[] definitions)
        {
            heroRoot = root;
            fixtures = definitions ?? new GearFitFixtureDefinition[0];
            showAll = true;
            SceneView.RepaintAll();
        }

        public static void ConfigureDisplay(bool displayAll, GearFitFixtureSlot slot)
        {
            showAll = displayAll;
            selectedSlot = slot;
            SceneView.RepaintAll();
        }

        private static void DrawSceneView(SceneView sceneView)
        {
            if (!IsWorkbenchScene()) return;
            ConfigureFromActiveScene();
            if (heroRoot == null) return;

            foreach (var fixture in fixtures)
            {
                if (fixture == null || (!showAll && fixture.Slot != selectedSlot)) continue;
                DrawFixture(fixture, false);

                if (fixture.Slot == GearFitFixtureSlot.Shoulder &&
                    !string.IsNullOrEmpty(fixture.MirroredAnchorBone))
                {
                    DrawFixture(fixture, true);
                }
            }
        }

        private static void ConfigureFromActiveScene()
        {
            if (!IsWorkbenchScene()) return;
            if (heroRoot == null) heroRoot = FindWorkbenchHero();
            if (fixtures.Length == 0)
                fixtures = GearFitFixtureKitAuthoring.LoadDefinitions();
        }

        private static bool IsWorkbenchScene()
        {
            return SceneManager.GetActiveScene().path == GearWorkbenchWindow.ScenePath;
        }

        private static Transform FindWorkbenchHero()
        {
            foreach (var root in SceneManager.GetActiveScene().GetRootGameObjects())
            {
                if (root.GetComponentInChildren<GearSocket>(true) != null) return root.transform;
            }

            return null;
        }

        private static void DrawFixture(GearFitFixtureDefinition fixture, bool mirrored)
        {
            var boneName = mirrored ? fixture.MirroredAnchorBone : fixture.AnchorBone;
            var anchor = FindDescendant(heroRoot, boneName);
            if (anchor == null) return;

            var sign = mirrored ? -1f : 1f;
            var localAnchor = Mirror(fixture.AnchorOffset, sign);
            var localForward = Mirror(fixture.ForwardAxis, sign);
            var localUp = Mirror(fixture.UpAxis, sign);
            var worldAnchor = anchor.TransformPoint(localAnchor);
            var basis = Quaternion.LookRotation(
                anchor.TransformDirection(localForward),
                anchor.TransformDirection(localUp));

            DrawAxes(worldAnchor, basis);
            DrawBox(
                anchor.TransformPoint(Mirror(fixture.InnerClearanceCenter, sign)),
                basis,
                fixture.InnerClearanceSize,
                new Color(0.20f, 0.85f, 0.95f, 1f));

            foreach (var landmark in fixture.Landmarks)
            {
                var center = anchor.TransformPoint(Mirror(landmark.LocalCenter, sign));
                var color = ColorFor(landmark.Kind);
                DrawBox(center, basis, landmark.LocalSize, color);
                Handles.color = color;
                Handles.Label(center, (mirrored ? "R " : "") + landmark.Label);
            }

            Handles.color = Color.white;
            Handles.Label(worldAnchor, (mirrored ? "R " : "") + fixture.DisplayName + " anchor");
            Handles.Label(
                worldAnchor + anchor.TransformDirection(localUp) * 0.06f,
                "front → / up ↑ / out →");
        }

        private static void DrawAxes(Vector3 origin, Quaternion basis)
        {
            const float length = 0.11f;
            DrawArrow(origin, origin + basis * Vector3.forward * length, new Color(1f, 0.35f, 0.2f, 1f));
            DrawArrow(origin, origin + basis * Vector3.up * length, new Color(0.25f, 1f, 0.35f, 1f));
            DrawArrow(origin, origin + basis * Vector3.right * length, new Color(0.25f, 0.55f, 1f, 1f));
            Handles.color = Color.white;
            Handles.SphereHandleCap(0, origin, Quaternion.identity, 0.025f, EventType.Repaint);
        }

        private static void DrawArrow(Vector3 from, Vector3 to, Color color)
        {
            Handles.color = color;
            Handles.DrawLine(from, to, 3f);
            Handles.ConeHandleCap(
                0,
                to,
                Quaternion.LookRotation(to - from),
                0.025f,
                EventType.Repaint);
        }

        private static void DrawBox(Vector3 center, Quaternion rotation, Vector3 size, Color color)
        {
            Gizmos.color = color;
            var previous = Gizmos.matrix;
            Gizmos.matrix = Matrix4x4.TRS(center, rotation, Vector3.one);
            Gizmos.DrawWireCube(Vector3.zero, size);
            Gizmos.matrix = previous;
        }

        private static Color ColorFor(GearFitFixtureLandmarkKind kind)
        {
            switch (kind)
            {
                case GearFitFixtureLandmarkKind.KeepClear:
                    return new Color(0.25f, 1f, 0.35f, 1f);
                case GearFitFixtureLandmarkKind.CollisionWarning:
                    return new Color(1f, 0.25f, 0.15f, 1f);
                default:
                    return new Color(1f, 0.75f, 0.15f, 1f);
            }
        }

        private static Vector3 Mirror(Vector3 value, float sign)
        {
            return new Vector3(value.x * sign, value.y, value.z);
        }

        private static Transform FindDescendant(Transform root, string name)
        {
            if (root == null || string.IsNullOrEmpty(name)) return null;
            if (root.name == name) return root;
            foreach (Transform child in root)
            {
                var result = FindDescendant(child, name);
                if (result != null) return result;
            }

            return null;
        }
    }
}
