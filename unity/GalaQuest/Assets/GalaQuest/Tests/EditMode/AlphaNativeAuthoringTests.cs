using System.IO;
using GalaQuest.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;

namespace GalaQuest.Tests
{
    // Narrow native Alpha authoring checks. No material or Owner approval is
    // required from these tests; they pin the receipt binding, the authored bite
    // retime, and the candidate content mapping.
    public sealed class AlphaNativeAuthoringTests
    {
        private static string Hash(byte[] bytes) { using var sha=System.Security.Cryptography.SHA256.Create(); return System.BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        private static string WriteCandidate(string sourceSha, string fileSha, long fileBytes, bool includeFbxEntry = true)
        {
            var dir=Path.Combine(Path.GetTempPath(), Path.GetRandomFileName()); Directory.CreateDirectory(dir);
            var fbx=new byte[]{1,2,3,4}; var texture=new byte[]{5,6};
            File.WriteAllBytes(Path.Combine(dir,"Alpha.fbx"),fbx); File.WriteAllBytes(Path.Combine(dir,"Alpha.texture-0.jpg"),texture);
            var files=new System.Collections.Generic.List<object>();
            if(includeFbxEntry) files.Add(new {name="Alpha.fbx",sha256=fileSha,bytes=fileBytes});
            files.Add(new {name="Alpha.texture-0.jpg",sha256=Hash(texture),bytes=texture.Length});
            var receipt=new {sourceSha256=sourceSha,fbxSha256=fileSha,blenderVersion="4.5.13",
                recipeSha256=Hash(File.ReadAllBytes(Path.Combine(U2CombatPreview.RepoRoot,AlphaCandidateAuthoring.RecipePath))),
                converterSha256=Hash(File.ReadAllBytes(Path.Combine(U2CombatPreview.RepoRoot,AlphaCandidateAuthoring.ConverterPath))),files};
            File.WriteAllText(Path.Combine(dir,"receipt.json"),Newtonsoft.Json.JsonConvert.SerializeObject(receipt)); return dir;
        }
        [Test]
        public void ValidBindingPassesButChangedTextureRejects()
        {
            var dir=WriteCandidate(AlphaCandidateAuthoring.SourceSha256,Hash(new byte[]{1,2,3,4}),4);
            try { AlphaCandidateAuthoring.ValidateCandidate(dir); File.WriteAllBytes(Path.Combine(dir,"Alpha.texture-0.jpg"),new byte[]{7,8});
                Assert.Throws<UnityEditor.Build.BuildFailedException>(()=>AlphaCandidateAuthoring.ValidateCandidate(dir)); }
            finally { Directory.Delete(dir,true); }
        }

        [Test]
        public void WrongSourceHashIsRejected()
        {
            var dir = WriteCandidate(new string('0', 64), new string('0', 64), 4);
            try
            {
                Assert.Throws<UnityEditor.Build.BuildFailedException>(() => AlphaCandidateAuthoring.ValidateCandidate(dir));
            }
            finally { Directory.Delete(dir, true); }
        }

        [Test]
        public void WrongFileHashIsRejected()
        {
            var dir = WriteCandidate(AlphaCandidateAuthoring.SourceSha256, new string('0', 64), 4);
            try
            {
                Assert.Throws<UnityEditor.Build.BuildFailedException>(() => AlphaCandidateAuthoring.ValidateCandidate(dir));
            }
            finally { Directory.Delete(dir, true); }
        }

        [Test]
        public void BiteRetimeMapsContactAndEnd()
        {
            const float sourceLength = 1f;
            Assert.That(AlphaCandidateAuthoring.RetimeBiteTime(0, sourceLength), Is.EqualTo(0));
            Assert.That(AlphaCandidateAuthoring.RetimeBiteTime(AlphaCandidateAuthoring.BiteContactSourceSeconds, sourceLength),
                Is.EqualTo(AlphaCandidateAuthoring.BiteContactAuthoredSeconds).Within(.0001f));
            Assert.That(AlphaCandidateAuthoring.RetimeBiteTime(sourceLength, sourceLength),
                Is.EqualTo(AlphaCandidateAuthoring.BiteAuthoredDuration).Within(.0001f));
            Assert.That(AlphaCandidateAuthoring.RetimeBiteTime(.6f, sourceLength),
                Is.GreaterThan(AlphaCandidateAuthoring.BiteContactAuthoredSeconds));
        }

        [Test]
        public void RetimedBiteClipKeepsKeysAndControllerFindsBash()
        {
            var source = new AnimationClip { legacy = false };
            var curve = new AnimationCurve(
                new Keyframe(0, 0), new Keyframe(AlphaCandidateAuthoring.BiteContactSourceSeconds, 1), new Keyframe(1f, 0));
            AnimationUtility.SetEditorCurve(source, EditorCurveBinding.FloatCurve("", typeof(Transform), "m_LocalPosition.x"), curve);
            var retimed = AlphaCandidateAuthoring.RetimeBiteClip(source);
            var keys = AnimationUtility.GetEditorCurve(retimed,
                EditorCurveBinding.FloatCurve("", typeof(Transform), "m_LocalPosition.x")).keys;
            Assert.That(keys.Length, Is.EqualTo(3));
            Assert.That(keys[0].time, Is.EqualTo(0));
            Assert.That(keys[1].time, Is.EqualTo(AlphaCandidateAuthoring.BiteContactAuthoredSeconds).Within(.0001f));
            Assert.That(keys[2].time, Is.EqualTo(AlphaCandidateAuthoring.BiteAuthoredDuration).Within(.0001f));
            var controller = new AnimatorController();
            controller.AddLayer("Base");
            AlphaCandidateAuthoring.AddState(controller, "bash", retimed, AlphaCandidateAuthoring.BiteAuthoredDuration);
            var state = controller.layers[0].stateMachine.states[0].state;
            Assert.That(state.motion, Is.SameAs(retimed));
            Assert.That(state.speed, Is.EqualTo(retimed.length / AlphaCandidateAuthoring.BiteAuthoredDuration).Within(.0001f));
            Object.DestroyImmediate(controller);
            Object.DestroyImmediate(source);
            Object.DestroyImmediate(retimed);
        }

        [Test]
        public void ControlledCandidatePrepMapsAlphaWolf()
        {
            if (!AlphaCandidateAuthoring.IsCandidatePresent())
                Assert.Ignore("Requires the delivered Astra alpha-native candidate");
            const string folder = "Assets/AlphaNativeAuthoringTestTemporary";
            if (Directory.Exists(folder)) Assert.Fail("Preserve pre-existing test folder: " + folder);
            AssetDatabase.CreateFolder("Assets", "AlphaNativeAuthoringTestTemporary");
            try
            {
                var prefab = AlphaCandidateAuthoring.Prepare(folder);
                Assert.That(prefab, Is.Not.Null);
                var content = ScriptableObject.CreateInstance<GalaQuestCombatContent>();
                content.Enemies = new[] { AlphaCandidateAuthoring.NewEnemyEntry(prefab) };
                Assert.That(content.FindEnemy("alpha-wolf"), Is.Not.Null);
                Object.DestroyImmediate(content);
                var visual = prefab.transform.Find("Visual");
                Assert.That(visual, Is.Not.Null);
                Assert.That(visual.localScale.x, Is.EqualTo(AlphaCandidateAuthoring.AuthoredScale).Within(.0001f));
                Assert.That(prefab.transform.localScale, Is.EqualTo(Vector3.one), "The authoritative telegraph is not scaled with the mesh.");
            }
            finally { AssetDatabase.DeleteAsset(folder); }
        }
    }
}
