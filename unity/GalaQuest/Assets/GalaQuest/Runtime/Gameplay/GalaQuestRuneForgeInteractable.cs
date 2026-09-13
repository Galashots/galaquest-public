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
            if (label != null) label.text = text;
        }

        public void SetGlow(bool active, bool selected)
        {
            renderers ??= GetComponentsInChildren<Renderer>(true);
            properties ??= new MaterialPropertyBlock();
            properties.Clear();
            properties.SetColor("_EmissionColor", selected ? new Color(3f, .45f, .03f)
                : active ? new Color(.7f, .12f, .01f) : Color.black);
            foreach (var renderer in renderers) renderer.SetPropertyBlock(properties);
        }
    }
}
