using UnityEngine;

namespace GalaQuest
{
    public sealed class GalaQuestRuneForgeInteractable : MonoBehaviour
    {
        [SerializeField] private string kind;
        [SerializeField] private string value;
        private Renderer[] renderers;
        private TextMesh label;
        private MaterialPropertyBlock properties;
        private bool highlighted;
        private string plainLabel;

        public string Kind => kind;
        public string Value { get => value; set => this.value = value; }

        public void Configure(string action, string actionValue = "")
        {
            kind = action;
            value = actionValue;
            renderers = GetComponentsInChildren<Renderer>(true);
            label = GetComponentInChildren<TextMesh>(true);
        }

        public void SetLabel(string text)
        {
            if (label == null) label = GetComponentInChildren<TextMesh>(true);
            plainLabel = text;
            UpdateLabel();
        }

        public void SetGlow(bool active, bool selected)
        {
            renderers ??= GetComponentsInChildren<Renderer>(true);
            properties ??= new MaterialPropertyBlock();
            highlighted = active && selected;
            if (label == null) label = GetComponentInChildren<TextMesh>(true);
            if (plainLabel == null && label != null) plainLabel = label.text;
            UpdateLabel();
            properties.Clear();
            // Selection also changes the base colour: an iron hammer without the
            // emission shader keyword must show the same next-action cue.
            if (highlighted) properties.SetColor("_BaseColor", new Color(.9f, .58f, .12f));
            properties.SetColor("_EmissionColor", highlighted ? new Color(1.2f, .6f, .05f)
                : active ? new Color(.15f, .045f, .01f) : Color.black);
            foreach (var renderer in renderers) renderer.SetPropertyBlock(properties);
        }

        private void UpdateLabel()
        {
            if (label != null) label.text = highlighted && kind == "rune"
                ? "> " + plainLabel + " <" : plainLabel;
        }
    }
}
