using UnityEngine;
using UnityEngine.InputSystem;

namespace GalaQuest
{
    public sealed class GalaQuestCombatAudio : MonoBehaviour
    {
        private GalaQuestCombatContent content;
        private readonly AudioSource[] voices = new AudioSource[4];
        private bool muted;
        private float volume;
        public bool Muted => muted;

        public void Configure(GalaQuestCombatContent value)
        {
            content = value;
            muted = PlayerPrefs.GetInt("gq-audio-muted", 0) != 0;
            volume = Mathf.Clamp01(PlayerPrefs.GetFloat("gq-audio-volume", .55f));
            for (var i = 0; i < voices.Length; i++)
            {
                if (voices[i] != null) continue;
                voices[i] = gameObject.AddComponent<AudioSource>();
                voices[i].playOnAwake = false;
                voices[i].spatialBlend = 0;
                voices[i].volume = volume;
            }
        }

        public void PlaySwing() => Play(content.Swing, 150);
        public void PlayImpact() => Play(content.Impact, 100);
        public void PlayHurt() => Play(content.Hurt, 20);
        public void PlayVictory() => Play(content.Victory, 60);
        public void PlayWindup() => Play(content.Windup, 40);

        private void Play(AudioClip clip, int priority)
        {
            if (muted || clip == null || !Application.isFocused) return;
            AudioSource chosen = null;
            foreach (var voice in voices)
            {
                if (!voice.isPlaying) { chosen = voice; break; }
                if (voice.priority >= priority && (chosen == null || voice.priority > chosen.priority)) chosen = voice;
            }
            if (chosen == null) return;
            chosen.Stop(); chosen.clip = clip; chosen.priority = priority;
            chosen.volume = volume;
            chosen.Play();
        }

        public void SetMuted(bool value)
        {
            muted = value;
            if (muted) StopAll();
            PlayerPrefs.SetInt("gq-audio-muted", muted ? 1 : 0);
            PlayerPrefs.Save();
        }

        private void StopAll() { foreach (var voice in voices) if (voice != null) voice.Stop(); }
        private void OnApplicationFocus(bool focus) { if (!focus) StopAll(); }
        private void OnApplicationPause(bool paused) { if (paused) StopAll(); }

        public static bool IsInMuteRegion(Vector2 point, Vector2 viewport) =>
            new Rect(viewport.x - 130, viewport.y - 58, 114, 42).Contains(point);

        private void Update()
        {
            var anyTouch = false;
            var viewport = new Vector2(Screen.width, Screen.height);
            if (Touchscreen.current != null)
                foreach (var touch in Touchscreen.current.touches)
                {
                    if (touch.press.isPressed) anyTouch = true;
                    if (touch.press.wasPressedThisFrame && IsInMuteRegion(touch.position.ReadValue(), viewport))
                    { SetMuted(!muted); return; }
                }
            if (!anyTouch && Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame
                && IsInMuteRegion(Mouse.current.position.ReadValue(), viewport)) SetMuted(!muted);
        }

        private void OnGUI()
        {
            GUI.Box(new Rect(Screen.width - 130, 16, 114, 42), muted ? "Sound off" : "Sound on");
        }
    }
}
