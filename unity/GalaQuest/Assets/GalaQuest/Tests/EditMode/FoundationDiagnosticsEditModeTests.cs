using NUnit.Framework;
using GalaQuest.Editor;
using UnityEngine;
using UnityEngine.Rendering;

namespace GalaQuest.Tests
{
    public sealed class FoundationDiagnosticsEditModeTests
    {
        [Test]
        public void Report_contains_foundation_identity_and_pipeline()
        {
            var gameObject = new GameObject("FoundationDiagnosticsTest");
            try
            {
                var diagnostics = gameObject.AddComponent<FoundationDiagnostics>();

                StringAssert.Contains(FoundationDiagnostics.FoundationName, diagnostics.BuildReport());
                StringAssert.Contains(FoundationDiagnostics.RenderPipelineName, diagnostics.BuildReport());
            }
            finally
            {
                Object.DestroyImmediate(gameObject);
            }
        }

        [Test]
        public void Required_editor_version_is_explicit()
        {
            Assert.That(FoundationDiagnostics.RequiredUnityVersion, Is.EqualTo("6000.3.23f1"));
        }

        [Test]
        public void Active_pipeline_is_the_checked_in_urp_asset()
        {
            var activeRenderPipeline = GraphicsSettings.currentRenderPipeline;

            Assert.That(activeRenderPipeline, Is.Not.Null);
            Assert.That(FoundationBuild.IsUniversalRenderPipeline(activeRenderPipeline), Is.True);
        }

        [Test]
        public void Pipeline_classifier_rejects_no_pipeline()
        {
            Assert.That(FoundationBuild.IsUniversalRenderPipeline(null), Is.False);
        }

        [Test]
        public void Pipeline_classifier_rejects_a_non_urp_pipeline()
        {
            var pipeline = ScriptableObject.CreateInstance<TestRenderPipelineAsset>();
            try
            {
                Assert.That(FoundationBuild.IsUniversalRenderPipeline(pipeline), Is.False);
            }
            finally
            {
                Object.DestroyImmediate(pipeline);
            }
        }

        private sealed class TestRenderPipelineAsset : RenderPipelineAsset
        {
            protected override RenderPipeline CreatePipeline()
            {
                return null;
            }
        }
    }
}
