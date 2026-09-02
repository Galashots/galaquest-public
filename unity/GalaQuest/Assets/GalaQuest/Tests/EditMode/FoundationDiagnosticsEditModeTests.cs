using NUnit.Framework;
using UnityEngine;

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
    }
}
