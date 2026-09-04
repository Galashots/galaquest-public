using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace GalaQuest.Gear.Editor
{
    /// <summary>
    /// Scene View drawing for the GQ_HERO_V1 fit contracts. A static editor overlay rather than a
    /// MonoBehaviour, so the kit cannot leak a component into player builds.
    ///
    /// This is the human-readable embodiment of the contract, not the contract. Everything drawn here
    /// is read from the serialized fixture; nothing is computed for display only. If the picture and
    /// the numbers ever disagree, the numbers are right and this file has a bug.
    /// </summary>
    [InitializeOnLoad]
    public static class GearFitFixtureOverlay
    {
        /// <summary>Wearer right. Kept in one place so the overlay and the review pack cannot drift.</summary>
        public static readonly Color RightColor = new Color(0.30f, 0.55f, 1f, 1f);

        /// <summary>Wearer up.</summary>
        public static readonly Color UpColor = new Color(0.30f, 1f, 0.40f, 1f);

        /// <summary>Wearer forward.</summary>
        public static readonly Color ForwardColor = new Color(1f, 0.38f, 0.22f, 1f);

        /// <summary>The primary normalization measurement.</summary>
        public static readonly Color PrimaryColor = new Color(1f, 0.95f, 0.30f, 1f);

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

        /// <summary>Colour for a datum role. Shared with the review pack so evidence matches the editor.</summary>
        public static Color ColorFor(GearFitDatumRole role)
        {
            switch (role)
            {
                case GearFitDatumRole.FunctionalFit: return new Color(0.20f, 0.90f, 0.98f, 1f);
                case GearFitDatumRole.KeepClear: return new Color(0.30f, 1f, 0.40f, 1f);
                case GearFitDatumRole.CollisionWarning: return new Color(1f, 0.25f, 0.15f, 1f);
                case GearFitDatumRole.DecorativeExtent: return new Color(0.75f, 0.45f, 1f, 1f);
                default: return new Color(1f, 0.75f, 0.20f, 1f);
            }
        }

        /// <summary>One-line label for a datum, including its provenance so the picture cannot lie.</summary>
        public static string LabelFor(GearFitDatum datum)
        {
            return datum.DatumId + "  [" + datum.Role + " / " + datum.Provenance + "]";
        }

        private static void DrawSceneView(SceneView sceneView)
        {
            if (!IsWorkbenchScene()) return;
            ConfigureFromActiveScene();
            if (heroRoot == null) return;

            foreach (var fixture in fixtures)
            {
                if (fixture == null || (!showAll && fixture.Slot != selectedSlot)) continue;
                DrawFixture(fixture);
            }
        }

        private static void ConfigureFromActiveScene()
        {
            if (!IsWorkbenchScene()) return;
            if (heroRoot == null) heroRoot = FindWorkbenchHero();
            if (fixtures.Length == 0) fixtures = GearFitFixtureKitAuthoring.LoadDefinitions();
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

        private static void DrawFixture(GearFitFixtureDefinition fixture)
        {
            foreach (var frame in fixture.Frames)
            {
                var anchor = FindDescendant(heroRoot, frame.AnchorBone);
                if (anchor == null) continue;
                if (!frame.TryResolveWorldRotation(anchor, out var rotation, out var error))
                {
                    Handles.color = Color.red;
                    Handles.Label(anchor.position, fixture.DisplayName + " INVALID FRAME: " + error);
                    continue;
                }

                var origin = anchor.TransformPoint(frame.OriginInAnchor);
                DrawCanonicalAxes(origin, rotation, frame);

                foreach (var datum in fixture.Datums)
                {
                    if (datum.FrameId != frame.FrameId) continue;
                    var center = origin + rotation * datum.LocalCenter;
                    var color = ColorFor(datum.Role);
                    DrawBox(center, rotation, datum.LocalSize, color);
                    Handles.color = color;
                    Handles.Label(center, LabelFor(datum));
                }

                DrawPrimaryMeasurement(fixture, frame, origin, rotation);
            }
        }

        /// <summary>
        /// The three named axes plus the anchor. Labelled in words, because the whole point of the
        /// contract is that nobody has to work out which arrow means what.
        /// </summary>
        private static void DrawCanonicalAxes(Vector3 origin, Quaternion rotation, GearFitFrame frame)
        {
            const float length = 0.13f;
            DrawArrow(origin, rotation * GearFitCanonicalSpace.Right * length, RightColor, "+X RIGHT");
            DrawArrow(origin, rotation * GearFitCanonicalSpace.Up * length, UpColor, "+Y UP");
            DrawArrow(origin, rotation * GearFitCanonicalSpace.Forward * length, ForwardColor, "+Z FORWARD");

            Handles.color = Color.white;
            Handles.SphereHandleCap(0, origin, Quaternion.identity, 0.022f, EventType.Repaint);
            Handles.Label(origin, frame.FrameId + " origin (" + frame.AnchorBone + ", side " + frame.Side + ")");
        }

        /// <summary>
        /// The measurement an imported asset is uniformly scaled against, drawn as a labelled span so
        /// a human can see the same number the machine normalizes with.
        /// </summary>
        private static void DrawPrimaryMeasurement(
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
            var half = 0.5f * primary.ReferenceValueMetres;
            var from = center - axis * half;
            var to = center + axis * half;

            Handles.color = PrimaryColor;
            Handles.DrawLine(from, to, 5f);
            DrawTick(from, rotation, primary.Axis);
            DrawTick(to, rotation, primary.Axis);
            Handles.Label(
                to,
                "PRIMARY " + primary.Metric + " = " +
                primary.ReferenceValueMetres.ToString("F3") + " m along " + primary.Axis +
                "  [" + primary.Provenance + "]");
        }

        private static void DrawTick(Vector3 at, Quaternion rotation, GearFitFrameAxis axis)
        {
            // A cross-tick drawn on the two axes the measurement is NOT taken along.
            var first = rotation * GearFitFrame.AxisVector(
                axis == GearFitFrameAxis.Up ? GearFitFrameAxis.Right : GearFitFrameAxis.Up);
            var second = rotation * GearFitFrame.AxisVector(
                axis == GearFitFrameAxis.Forward ? GearFitFrameAxis.Right : GearFitFrameAxis.Forward);
            Handles.DrawLine(at - first * 0.02f, at + first * 0.02f, 3f);
            Handles.DrawLine(at - second * 0.02f, at + second * 0.02f, 3f);
        }

        private static void DrawArrow(Vector3 origin, Vector3 offset, Color color, string label)
        {
            var tip = origin + offset;
            Handles.color = color;
            Handles.DrawLine(origin, tip, 3f);
            Handles.ConeHandleCap(0, tip, Quaternion.LookRotation(offset), 0.024f, EventType.Repaint);
            Handles.Label(tip, label);
        }

        private static void DrawBox(Vector3 center, Quaternion rotation, Vector3 size, Color color)
        {
            Handles.color = color;
            var matrix = Handles.matrix;
            Handles.matrix = Matrix4x4.TRS(center, rotation, Vector3.one);
            Handles.DrawWireCube(Vector3.zero, size);
            Handles.matrix = matrix;
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
