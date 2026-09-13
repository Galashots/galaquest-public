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
        private static Texture2D leather, parchment, disc, frame, litFrame, paperFrame;
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
            // Nine slices retain cut corners and broad bevels at every screen size.
            var texture = paper ? paperFrame : lit ? litFrame : frame;
            var corner = Mathf.Min(12, rect.height * .25f);
            for (var row = 0; row < 3; row++)
                for (var col = 0; col < 3; col++)
                {
                    var x = col == 0 ? rect.x : col == 1 ? rect.x + corner : rect.xMax - corner;
                    var y = row == 0 ? rect.y : row == 1 ? rect.y + corner : rect.yMax - corner;
                    var w = col == 1 ? rect.width - corner * 2 : corner;
                    var h = row == 1 ? rect.height - corner * 2 : corner;
                    var u = col == 0 ? 0 : col == 1 ? 12f / 128 : 116f / 128;
                    var v = row == 0 ? 116f / 128 : row == 1 ? 12f / 128 : 0;
                    var uvw = col == 1 ? 104f / 128 : 12f / 128;
                    var uvh = row == 1 ? 104f / 128 : 12f / 128;
                    GUI.DrawTextureWithTexCoords(new Rect(x, y, w, h), texture, new Rect(u, v, uvw, uvh));
                }
        }

        public static void MovementRest(Rect rect)
        {
            Disc(rect, true, false);
            var thumb = new Rect(rect.center.x - rect.width * .19f, rect.center.y - rect.height * .23f,
                rect.width * .38f, rect.height * .38f);
            Disc(thumb, true, false);
            Fill(new Rect(thumb.x + thumb.width * .25f, thumb.y + thumb.height * .32f,
                thumb.width * .5f, 2), Gold);
            for (var i = 0; i < 4; i++)
            {
                var previous = GUI.matrix;
                GUIUtility.RotateAroundPivot(i * 90, rect.center);
                Fill(new Rect(rect.center.x - 1, rect.y + rect.height * .13f, 2, rect.height * .09f), Gold);
                GUI.matrix = previous;
            }
            Text(new Rect(rect.x, rect.y + rect.height * .68f, rect.width, rect.height * .18f),
                "MOVE", rect.height * .095f, Gold, true, TextAnchor.MiddleCenter);
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
            frame = FrameTexture(false, false); litFrame = FrameTexture(false, true); paperFrame = FrameTexture(true, false);
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
                        ? Color.Lerp(new Color(.77f, .63f, .39f), new Color(.85f, .73f, .50f), grain)
                        : Color.Lerp(new Color(.035f, .038f, .033f), new Color(.11f, .095f, .063f), grain);
                }
            texture.SetPixels(pixels); texture.Apply(false, true); return texture;
        }

        private static Texture2D FrameTexture(bool paper, bool lit)
        {
            const int size = 128;
            var texture = NewTexture(size, paper ? "GalaQuest cut parchment" : "GalaQuest bevelled frame");
            var pixels = new Color[size * size];
            for (var y = 0; y < size; y++)
                for (var x = 0; x < size; x++)
                {
                    var dx = Mathf.Min(x, size - 1 - x);
                    var dy = Mathf.Min(y, size - 1 - y);
                    var edge = Mathf.Min(dx, dy, (dx + dy - 8) * .7071f);
                    var light = Mathf.Clamp01(.4f + y / 180f - x / 360f);
                    var grain = Noise(x, y) * .12f + Mathf.PerlinNoise(x * .07f, y * .07f) * .88f;
                    var c = paper
                        ? Color.Lerp(new Color(.78f, .65f, .43f), new Color(.87f, .76f, .53f), grain)
                        : Color.Lerp(new Color(.055f, .052f, .039f), new Color(.095f, .083f, .057f), grain);
                    if (edge < 5) c = Color.Lerp(new Color(.13f, .10f, .06f),
                        lit ? new Color(.84f, .63f, .30f) : new Color(.48f, .37f, .21f), light);
                    if (edge < 1 || (edge >= 5 && edge < 6)) c = new Color(.025f, .023f, .018f);
                    if (edge >= 6 && edge < 7) c = paper ? new Color(.57f, .40f, .20f) : new Color(.19f, .15f, .085f);
                    c.a = Mathf.Clamp01(edge + 1);
                    pixels[y * size + x] = c;
                }
            texture.SetPixels(pixels); texture.Apply(false, true); return texture;
        }

        private static float Noise(int x, int y) => ((x * 374761393u + y * 668265263u) ^ ((uint)x * (uint)y * 1274126177u)) % 1000 / 999f;
        private static Texture2D NewTexture(int size, string name) => new Texture2D(size, size, TextureFormat.RGBA32, false)
        { name = name, hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear };

        public static void Release()
        {
            foreach (var texture in new[] { leather, parchment, disc, frame, litFrame, paperFrame })
                if (texture != null) Object.Destroy(texture);
            leather = parchment = disc = frame = litFrame = paperFrame = null; text = null;
        }
    }
}
