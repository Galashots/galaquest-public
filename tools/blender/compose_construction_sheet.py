"""Compose NS-03, the Character Construction Master, from rendered views plus measured JSON.

  python tools/blender/compose_construction_sheet.py <viewsdir> <measured.json> <out.png>

The head-division grid is not drawn by eye. The orthographic camera used ortho_scale =
height * MARGIN, so the character occupies exactly renderPx / MARGIN pixels and every head line
falls at a computable position. If that relationship ever changes, the grid is wrong and this
script must change with it.
"""

import json
import sys

from PIL import Image, ImageDraw, ImageFont

VIEWS_DIR, MEASURED, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
MARGIN = 1.12          # must match render_construction_sheet.py's ortho_scale factor
RENDER_PX = 640
VIEW_PX = 470

m = json.load(open(MEASURED, encoding="utf8"))
heads_tall = m["inHeads"]["headsTall"]
TARGET_HEADS = 3.84


def font(size, bold=False):
    for name in (("arialbd.ttf", "segoeuib.ttf") if bold else ("arial.ttf", "segoeui.ttf")):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


F_TITLE, F_H, F_BODY, F_SMALL = font(38, True), font(20, True), font(17), font(14)

INK, MUTED, RULE, WARN = (26, 28, 32), (110, 116, 128), (196, 120, 60), (176, 58, 46)
W, H = 2120, 1180
sheet = Image.new("RGB", (W, H), (244, 244, 246))
d = ImageDraw.Draw(sheet)

d.text((48, 36), "NS-03 — Character Construction Master", INK, F_TITLE)
d.text((48, 88), "GalaQuest interim hero  ·  public/assets/hero/hero.glb  ·  measured 2026-08-12",
       MUTED, F_BODY)
d.text((48, 112), "CONTROLS: proportion, shoulder width, hand and foot scale, limb thickness, "
                  "hair silhouette, gear attachment scale.", INK, F_BODY)
d.text((48, 136), "DOES NOT CONTROL: palette, personality, tone — those belong to NS-02, the "
                  "identity master.", MUTED, F_BODY)
d.text((48, 160), "Orthographic. A perspective camera enlarges near limbs, which is how dimensions "
                  "get misread off a picture.", MUTED, F_SMALL)

TOP = 210
scale = VIEW_PX / RENDER_PX
char_px = VIEW_PX / MARGIN                 # the character's own height inside the view
char_top = TOP + (VIEW_PX - char_px) / 2
head_px = char_px / heads_tall

for i, name in enumerate(("front", "threequarter", "side", "back")):
    x = 48 + i * (VIEW_PX + 26)
    img = Image.open(f"{VIEWS_DIR}/{name}.png").convert("RGB").resize((VIEW_PX, VIEW_PX), Image.LANCZOS)
    sheet.paste(img, (x, TOP))
    d.rectangle([x, TOP, x + VIEW_PX, TOP + VIEW_PX], outline=(206, 208, 214))
    d.text((x + 6, TOP + VIEW_PX + 8), name.upper(), INK, F_H)

# Head divisions, drawn across all four views at once so the eye can check they line up.
grid_left, grid_right = 48, 48 + 3 * (VIEW_PX + 26) + VIEW_PX
k = 0.0
while char_top + k * head_px <= char_top + char_px + 1:
    y = char_top + k * head_px
    solid = abs(k - round(k)) < 1e-6
    d.line([(grid_left, y), (grid_right, y)], fill=RULE if solid else (222, 200, 178), width=2 if solid else 1)
    if solid and k > 0:
        d.text((grid_right + 8, y - 9), f"{int(k)}H", RULE, F_SMALL)
    k += 0.5
d.text((grid_right + 8, char_top - 9), "0H", RULE, F_SMALL)
d.text((grid_right + 8, char_top + 8), "top of hair", MUTED, F_SMALL)
d.text((grid_right + 8, char_top + char_px - 9), f"{heads_tall:.2f}H", RULE, F_SMALL)

# ── the runtime truth strip ────────────────────────────────────────────────────────────────────
Y = TOP + VIEW_PX + 56
d.text((48, Y), "AT REAL PLAY SIZE", INK, F_H)
d.text((48, Y + 24), "true renders, never downscaled", MUTED, F_SMALL)
x = 48
for name, label in (("gameplay_90", "90px · normal play"), ("gameplay_150", "150px · combat")):
    img = Image.open(f"{VIEWS_DIR}/{name}.png").convert("RGB")
    sheet.paste(img, (x, Y + 50))
    d.rectangle([x, Y + 50, x + img.width, Y + 50 + img.height], outline=(206, 208, 214))
    # One baseline for both captions, below the taller image, so a short one's label cannot run
    # under its neighbour.
    d.text((x, Y + 56 + 150), label, MUTED, F_SMALL)
    x += img.width + 30

# ── measurements ──────────────────────────────────────────────────────────────────────────────
MX = 470
d.text((MX, Y), "MEASURED", INK, F_H)
d.text((MX, Y + 24), "comparison only, never adopted as targets", MUTED, F_SMALL)
skeletal = m["inHeads"]["headsTallSkeletal"]
rows = [
    ("heads tall — 0H at top of HAIR", f"{heads_tall:.4f}", f"target {TARGET_HEADS}, so {heads_tall - TARGET_HEADS:+.2f} — the convention the target was measured under"),
    ("heads tall — skeletal, hair-free", f"{skeletal:.4f}", f"target {TARGET_HEADS}, so {skeletal - TARGET_HEADS:+.2f} — Head joint to head_end joint"),
    ("shoulder width", f"{m['inHeads']['shoulderWidthUpperArmHeads']:.4f} H", "upper-arm bone heads; KayKit 0.3926, Quaternius 1.8813"),
    ("hand width", f"{m['inHeads']['handWidthX']:.4f} H", "KayKit 0.1706, Quaternius 0.4475"),
    ("foot length", f"{m['inHeads']['footLengthY']:.4f} H", "no contract value exists; chunky feet are permitted"),
    ("arm length", f"{m['inHeads']['armLength']:.4f} H", "upperarm + lowerarm, stops at the wrist"),
    ("leg length", f"{m['inHeads']['legLength']:.4f} H", "KayKit 0.3486, Quaternius 3.8011"),
    ("forearm / upper-arm thickness", f"{m['absolute']['forearmThicknessX'] / m['absolute']['upperArmThicknessX']:.4f}", "candidate C was 0.78; note-4 allows only INCREASE"),
    ("triangles / joints", f"{m['counts']['triangles']:,} / {m['counts']['joints']}", "LOD0 target 16,000 · LOD1 target 8,000"),
]
ry = Y + 50
for label, value, note in rows:
    d.text((MX, ry), label, INK, F_BODY)
    d.text((MX + 300, ry), value, INK, font(17, True))
    d.text((MX + 450, ry), note, MUTED, F_SMALL)
    ry += 27

d.text((MX, ry + 14), "READ THE PROPORTION CAREFULLY — THE TWO FIGURES DISAGREE", WARN, F_H)
d.text((MX, ry + 42),
       f"By the rig's own head span this mesh is {skeletal:.2f} heads, which is the {TARGET_HEADS} target "
       f"almost exactly ({skeletal - TARGET_HEADS:+.2f}).", INK, F_BODY)
d.text((MX, ry + 66),
       f"By head-WEIGHTED VERTICES it is {heads_tall:.2f}, because that puts 0H at the top of the hair "
       f"and extends down past the chin.", MUTED, F_SMALL)
d.text((MX, ry + 88),
       f"The 0.040 difference in head height is 0.007 of hair above the head_end joint and 0.033 of "
       f"jaw and neck below the Head joint.", MUTED, F_SMALL)
d.text((MX, ry + 110),
       "So the body proportion is very close to the lock. Quoting the vertex figure alone would have "
       "read as 8.8% short, which would be misleading.", MUTED, F_SMALL)
d.text((MX, ry + 132),
       "Four owner directives — shoulder width, hand size, foot size, limb thickness — remain "
       "valueStatus:open, gated on judging at gameplay scale. That judging has still not happened: "
       "no child has seen this, and nothing has been judged on the iPad.", MUTED, F_SMALL)

sheet.save(OUT)
print(f"wrote {OUT} ({sheet.width}x{sheet.height})")
print(f"  head grid: character occupies {char_px:.1f}px, one head = {head_px:.1f}px, {heads_tall:.4f} heads")
