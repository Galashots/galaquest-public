using UnityEngine;

namespace GalaQuest
{
    /// <summary>
    /// Small, scene-independent health marker for the Unity foundation.
    /// It deliberately reports project identity only; it is not gameplay state.
    /// </summary>
    public sealed class FoundationDiagnostics : MonoBehaviour
    {
        public const string FoundationName = "GalaQuest Unity Production Foundation";
        public const string RequiredUnityVersion = "6000.3.23f1";
        public const string RenderPipelineName = "Universal Render Pipeline";

        [SerializeField] private bool logOnStart;

        public bool HasExpectedUnityVersion => Application.unityVersion == RequiredUnityVersion;

        public string BuildReport()
        {
            return $"{FoundationName}|Unity={Application.unityVersion}|RenderPipeline={RenderPipelineName}";
        }

        private void Start()
        {
            if (logOnStart)
            {
                Debug.Log(BuildReport(), this);
            }
        }
    }
}
