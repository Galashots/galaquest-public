using NUnit.Framework;
using UnityEngine;

namespace GalaQuest.Tests
{
    public sealed class U1PhysicalIpadTouchCp3PlayModeTests
    {
        [Test]
        public void ExistingGameEntryInstallsExactlyOneRuntimeTouchOwner()
        {
            var root = new GameObject("CP3 runtime entry test");
            try
            {
                root.AddComponent<GalaQuestGameEntry>();
                Assert.That(root.GetComponents<GalaQuestFloatingJoystick>(), Has.Length.EqualTo(1));
                Assert.That(root.GetComponent<GalaQuestTraversalController>(), Is.Not.Null);
                Assert.That(root.GetComponent<BrowserSelectedProfileSource>(), Is.Not.Null);
                Assert.That(root.GetComponent<BrowserWebSocketTransport>(), Is.Not.Null);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }
    }
}
