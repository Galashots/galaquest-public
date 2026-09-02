using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace GalaQuest.Tests
{
    public sealed class FoundationDiagnosticsPlayModeTests
    {
        [UnityTest]
        public IEnumerator Component_survives_a_playmode_frame()
        {
            var gameObject = new GameObject("FoundationDiagnosticsPlayModeTest");
            var diagnostics = gameObject.AddComponent<FoundationDiagnostics>();

            yield return null;

            Assert.That(diagnostics.isActiveAndEnabled, Is.True);
            Assert.That(diagnostics.BuildReport(), Does.Contain(FoundationDiagnostics.FoundationName));

            Object.DestroyImmediate(gameObject);
        }
    }
}
