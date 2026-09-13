using UnityEngine;

namespace GalaQuest
{
    // Original procedural UI materials: no imported/provider art or runtime values baked into them.
    public static class GalaQuestCombatHudStyle
    {
        public static readonly Color Gold = new Color(.88f, .65f, .31f);
        public static readonly Color Ink = new Color(.96f, .9f, .76f);
        public static readonly Color Teal = new Color(.26f, .72f, .77f);
        public static readonly Color Red = new Color(.78f, .19f, .11f);
        private static Texture2D leather, parchment, disc;
        private static GUIStyle text;

        public static void Text(Rect rect, string value, float size, Color color,
            bool bold = false, TextAnchor align = TextAnchor.MiddleLeft, bool wrap = false)
        {
            text ??= new GUIStyle(GUI.skin.label) { richText = false, clipping = TextClipping.Clip };
            text.fontSize = Mathf.RoundToInt(size);
            text.fontStyle = bold ? FontStyle.Bold : FontStyle.Normal;
            text.alignment = align;
            text.wordWrap = wrap;
            text.normal.textColor = color;
            GUI.Label(rect, value ?? string.Empty, text);
        }

        public static void Fill(Rect rect, Color color)
        {
            var old = GUI.color;
            GUI.color = QualitySettings.activeColorSpace == ColorSpace.Linear ? color.linear : color;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = old;
        }

        public static void Panel(Rect rect, bool paper = false, bool lit = false)
        {
            EnsureTextures();
            Fill(new Rect(rect.x + 2, rect.y + 4, rect.width, rect.height), new Color(0, 0, 0, .55f));
            Fill(rect, lit ? Gold : new Color(.36f, .27f, .15f));
            Fill(Inset(rect, 1), new Color(.09f, .08f, .06f));
            var inner = Inset(rect, 3);
            var old = GUI.color; GUI.color = Color.white;
            GUI.DrawTextureWithTexCoords(inner, paper ? parchment : leather,
                new Rect(0, 0, inner.width / 128, inner.height / 128));
            GUI.color = old;
            Fill(new Rect(rect.x + 4, rect.y + 3, rect.width - 8, 1), paper
                ? new Color(.93f, .78f, .47f) : new Color(.48f, .4f, .24f));
            Fill(new Rect(rect.x + 4, rect.yMax - 4, rect.width - 8, 1), new Color(.12f, .07f, .025f));
            foreach (var x in new[] { rect.x + 5, rect.xMax - 8 })
                foreach (var y in new[] { rect.y + 5, rect.yMax - 8 })
                { Fill(new Rect(x, y, 3, 3), Gold); Fill(new Rect(x, y, 2, 1), Ink); }
        }

        public static void Bar(Rect rect, float fraction, Color color)
        {
            Fill(rect, new Color(.025f, .025f, .025f));
            var inner = Inset(rect, 2); inner.width *= Mathf.Clamp01(fraction);
            Fill(inner, color);
            if (inner.width > 0) Fill(new Rect(inner.x, inner.y, inner.width, Mathf.Max(1, inner.height * .22f)),
                Color.Lerp(color, Ink, .22f));
            Fill(new Rect(rect.x, rect.yMax - 1, rect.width, 1), new Color(.45f, .34f, .19f));
        }

        public static void Disc(Rect rect, bool enabled, bool pressed)
        {
            EnsureTextures();
            var old = GUI.color;
            GUI.color = enabled ? (pressed ? new Color(1f, .76f, .38f) : Color.white) : new Color(.6f, .6f, .6f, .75f);
            GUI.DrawTexture(rect, disc);
            GUI.color = old;
        }

        public static void Sword(Rect rect, Color color)
        {
            var old = GUI.matrix;
            GUIUtility.RotateAroundPivot(-35, rect.center);
            Fill(new Rect(rect.center.x - rect.width * .07f, rect.y, rect.width * .14f, rect.height * .66f), color);
            Fill(new Rect(rect.center.x, rect.y + 2, rect.width * .055f, rect.height * .60f), Color.white);
            Fill(new Rect(rect.center.x - rect.width * .23f, rect.y + rect.height * .64f, rect.width * .46f, rect.height * .08f), Gold);
            Fill(new Rect(rect.center.x - rect.width * .045f, rect.y + rect.height * .72f, rect.width * .09f, rect.height * .24f), Gold);
            GUI.matrix = old;
        }

        public static Rect Inset(Rect r, float n) => new Rect(r.x + n, r.y + n, r.width - 2 * n, r.height - 2 * n);

        private static void EnsureTextures()
        {
            if (leather != null) return;
            leather = MaterialTexture(false); parchment = MaterialTexture(true);
            const int size = 256;
            disc = NewTexture(size, "GalaQuest forged control");
            var pixels = new Color[size * size];
            for (var y = 0; y < size; y++)
                for (var x = 0; x < size; x++)
                {
                    var dx = (x + .5f - size / 2f) / (size / 2f);
                    var dy = (y + .5f - size / 2f) / (size / 2f);
                    var radius = Mathf.Sqrt(dx * dx + dy * dy);
                    var grain = Noise(x, y);
                    var c = Color.Lerp(new Color(.055f, .047f, .035f), new Color(.14f, .12f, .08f), grain);
                    if (radius > .87f) c = new Color(.06f, .05f, .035f);
                    if ((radius > .9f && radius < .94f) || (radius > .97f && radius < .99f))
                        c = Color.Lerp(new Color(.23f, .15f, .055f), new Color(.96f, .78f, .43f), Mathf.Clamp01(.52f + dy * .4f - dx * .2f));
                    c.a = Mathf.Clamp01((1 - radius) * 128);
                    pixels[y * size + x] = c;
                }
            disc.SetPixels(pixels); disc.Apply(false, true);
        }

        private static Texture2D MaterialTexture(bool paper)
        {
            var texture = NewTexture(128, paper ? "GalaQuest parchment" : "GalaQuest worn metal and leather");
            texture.wrapMode = TextureWrapMode.Repeat;
            var pixels = new Color[128 * 128];
            for (var y = 0; y < 128; y++)
                for (var x = 0; x < 128; x++)
                {
                    var grain = Noise(x, y) * .45f + Mathf.PerlinNoise(x * .09f, y * .09f) * .55f;
                    pixels[y * 128 + x] = paper
                        ? Color.Lerp(new Color(.62f, .44f, .22f), new Color(.86f, .72f, .46f), grain)
                        : Color.Lerp(new Color(.035f, .038f, .033f), new Color(.11f, .095f, .063f), grain);
                }
            texture.SetPixels(pixels); texture.Apply(false, true); return texture;
        }

        private static float Noise(int x, int y) => ((x * 374761393u + y * 668265263u) ^ ((uint)x * (uint)y * 1274126177u)) % 1000 / 999f;
        private static Texture2D NewTexture(int size, string name) => new Texture2D(size, size, TextureFormat.RGBA32, false)
        { name = name, hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear };

        public static void Release()
        {
            foreach (var texture in new[] { leather, parchment, disc })
                if (texture != null) Object.Destroy(texture);
            leather = parchment = disc = null; text = null;
        }
    }
}
