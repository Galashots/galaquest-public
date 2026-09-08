using System;
using UnityEngine;
using UnityEngine.Scripting;

namespace GalaQuest
{
    [Preserve]
    public sealed class BrowserSelectedProfileSource : MonoBehaviour, IGalaQuestSelectedProfileSource
    {
        public event Action<GalaQuestSelectedProfile> Selected;
        public event Action<string> Failed;

        public void ReadSelected()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            GalaQuestBrowserInterop.ReadSelectedProfile(gameObject.name, nameof(OnBrowserProfile));
#else
            Failed?.Invoke("CP1 profile authority is available in the same-origin Unity Web build.");
#endif
        }

        [Preserve]
        public void OnBrowserProfile(string payload)
        {
            if (GalaQuestSelectedProfile.TryParse(payload, out var profile, out var error))
            {
                Selected?.Invoke(profile);
            }
            else
            {
                Failed?.Invoke(error);
            }
        }
    }
}
