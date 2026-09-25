"""Re-bake the mystery egg's base-color texture procedurally onto the Meshy mesh's own UV layout.

  python docs/asset-production/farm-creatures-2026-09-24/recipes/rebake_egg.py <in.glb> <out.glb> [--size 1024] [--quality 88] [--preview out.png]

Why: both paid egg generations (raw/egg/3d1, raw/egg/3d2) came back with clean ellipsoid geometry but a
multi-view texture-blend defect -- ghosted/doubled spots in a band on one side -- because a smooth,
near-symmetric egg gives the provider's view alignment nothing to lock onto. Rather than pay a third
time, this keeps the provider geometry + UVs and replaces only the texture: every texel is painted from
a deterministic function of its 3D surface position (cream shell, bold colour spots, small speckles,
and a bright golden zigzag "about to hatch" line painted flat around the egg, as in refs/egg.png).
A 3D-position function has no view seams by construction; UV gutters are dilated to avoid mip seams.

The texture is project-authored; the mesh remains the paid-plan Meshy output.
"""
import io
import json
import math
import struct
import sys

import numpy as np
from PIL import Image

args = sys.argv[1:]
src, dst = args[0], args[1]
size = int(args[args.index("--size") + 1]) if "--size" in args else 1024
quality = int(args[args.index("--quality") + 1]) if "--quality" in args else 88
preview = args[args.index("--preview") + 1] if "--preview" in args else None

raw = open(src, "rb").read()
json_len = struct.unpack_from("<I", raw, 12)[0]
g = json.loads(raw[20:20 + json_len])
bin_off = 20 + json_len
bin_len = struct.unpack_from("<I", raw, bin_off)[0]
bin_data = raw[bin_off + 8:bin_off + 8 + bin_len]

COMP = {5126: ("<f4", 4), 5125: ("<u4", 4), 5123: ("<u2", 2), 5121: ("u1", 1)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor(i):
    a = g["accessors"][i]
    bv = g["bufferViews"][a["bufferView"]]
    dt, sz = COMP[a["componentType"]]
    n = NCOMP[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", sz * n)
    if stride == sz * n:
        arr = np.frombuffer(bin_data, dtype=dt, count=a["count"] * n, offset=off).reshape(a["count"], n)
    else:
        arr = np.stack([np.frombuffer(bin_data, dtype=dt, count=n, offset=off + k * stride) for k in range(a["count"])])
    return arr.astype(np.float64) if dt == "<f4" else arr.astype(np.int64)


assert len(g["meshes"]) == 1 and len(g["meshes"][0]["primitives"]) == 1, "expects one primitive"
prim = g["meshes"][0]["primitives"][0]
pos = accessor(prim["attributes"]["POSITION"])
uv = accessor(prim["attributes"]["TEXCOORD_0"])
idx = accessor(prim["indices"]).reshape(-1, 3)

lo, hi = pos.min(0), pos.max(0)
center = (lo + hi) / 2
half = (hi - lo) / 2

# ---- the pattern, as a function of unit direction on the (normalised) egg -------------------------
rng = np.random.default_rng(20260924)
C = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64)
SHELL_TOP, SHELL_BOT = C("#f8eed6"), C("#efdcb4")
SPOT_COLS = [C("#f7822a"), C("#45b3ea"), C("#5fb944"), C("#f5c531")]
SPECK = C("#caa46e")
GOLD, GOLD_CORE, GOLD_HALO = C("#ffc414"), C("#fff27a"), C("#ffe9a0")

def fib(n):
    k = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * k / n)
    th = math.pi * (1 + 5 ** 0.5) * k
    return np.stack([np.sin(phi) * np.sin(th), np.cos(phi), np.sin(phi) * np.cos(th)], 1)

spots = fib(16)
spots = spots @ np.array([[math.cos(0.4), 0, math.sin(0.4)], [0, 1, 0], [-math.sin(0.4), 0, math.cos(0.4)]])
spot_r = rng.uniform(0.24, 0.33, len(spots))
spot_c = [SPOT_COLS[i % 4] for i in range(len(spots))]
specks = fib(70) @ np.array([[math.cos(1.3), 0, math.sin(1.3)], [0, 1, 0], [-math.sin(1.3), 0, math.cos(1.3)]])
speck_r = rng.uniform(0.035, 0.06, len(specks))
TEETH, H0, AMP, HALF_W = 7, 0.14, 0.15, 0.042


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def paint(d):
    """d: (N,3) unit directions -> (N,3) RGB."""
    h = d[:, 1]
    col = SHELL_BOT + (SHELL_TOP - SHELL_BOT) * ((h + 1) / 2)[:, None]
    for c, r in zip(specks, speck_r):
        ang = np.arccos(np.clip(d @ c, -1, 1))
        a = 1 - smooth(r * 0.8, r, ang)
        col = col * (1 - 0.55 * a[:, None]) + SPECK * (0.55 * a[:, None])
    for c, r, sc in zip(spots, spot_r, spot_c):
        ang = np.arccos(np.clip(d @ c, -1, 1))
        a = 1 - smooth(r - 0.012, r + 0.012, ang)
        col = col * (1 - a[:, None]) + sc * a[:, None]
    theta = np.arctan2(d[:, 0], d[:, 2])
    t = theta * TEETH / (2 * math.pi)
    tri = 2 * np.abs(2 * (t - np.floor(t + 0.5))) - 1
    line_h = H0 + AMP * tri
    slope = AMP * 4 * TEETH / (2 * math.pi) / np.maximum(0.35, np.sqrt(1 - h * h))
    dist = np.abs(h - line_h) / np.sqrt(1 + slope * slope)
    halo = (1 - smooth(HALF_W, HALF_W * 2.6, dist)) * 0.45
    col = col * (1 - halo[:, None]) + GOLD_HALO * halo[:, None]
    body = 1 - smooth(HALF_W - 0.006, HALF_W + 0.006, dist)
    col = col * (1 - body[:, None]) + GOLD * body[:, None]
    core = 1 - smooth(HALF_W * 0.35, HALF_W * 0.6, dist)
    col = col * (1 - core[:, None]) + GOLD_CORE * core[:, None]
    return col


# ---- rasterise every triangle in UV space; paint from interpolated 3D position ---------------------
img = np.zeros((size, size, 3), dtype=np.float64)
mask = np.zeros((size, size), dtype=bool)
P = uv * size - 0.5  # texel centres
for tri_i in idx:
    (x0, y0), (x1, y1), (x2, y2) = P[tri_i]
    minx, maxx = int(max(0, math.floor(min(x0, x1, x2)))), int(min(size - 1, math.ceil(max(x0, x1, x2))))
    miny, maxy = int(max(0, math.floor(min(y0, y1, y2)))), int(min(size - 1, math.ceil(max(y0, y1, y2))))
    if maxx < minx or maxy < miny:
        continue
    den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if abs(den) < 1e-12:
        continue
    xs, ys = np.meshgrid(np.arange(minx, maxx + 1), np.arange(miny, maxy + 1))
    w0 = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / den
    w1 = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / den
    w2 = 1 - w0 - w1
    eps = -0.004
    inside = (w0 >= eps) & (w1 >= eps) & (w2 >= eps)
    if not inside.any():
        continue
    p3 = (w0[inside, None] * pos[tri_i[0]] + w1[inside, None] * pos[tri_i[1]] + w2[inside, None] * pos[tri_i[2]])
    q = (p3 - center) / half
    d = q / np.linalg.norm(q, axis=1, keepdims=True)
    img[ys[inside], xs[inside]] = paint(d)
    mask[ys[inside], xs[inside]] = True

# Dilate into UV gutters so mip-mapping never samples black.
for _ in range(40):
    if mask.all():
        break
    acc = np.zeros_like(img)
    cnt = np.zeros(mask.shape)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
        m = np.roll(np.roll(mask, dy, 0), dx, 1)
        acc += np.roll(np.roll(img, dy, 0), dx, 1) * m[..., None]
        cnt += m
    grow = (~mask) & (cnt > 0)
    img[grow] = acc[grow] / cnt[grow][:, None]
    mask = mask | grow
img[~mask] = SHELL_BOT
out_img = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGB")
if preview:
    out_img.save(preview)
buf = io.BytesIO()
out_img.save(buf, "JPEG", quality=quality, optimize=True)
new_bytes = buf.getvalue()

# ---- swap the base-colour image and rebuild the BIN chunk (every bufferView re-offset) -------------
mat = g["materials"][prim["material"]]
tex_i = mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]
img_i = g["textures"][tex_i]["source"]
target_view = g["images"][img_i]["bufferView"]
g["images"][img_i]["mimeType"] = "image/jpeg"
views = []
for vi, bv in enumerate(g["bufferViews"]):
    off = bv.get("byteOffset", 0)
    views.append(new_bytes if vi == target_view else bin_data[off:off + bv["byteLength"]])
out_bin = bytearray()
for vi, data in enumerate(views):
    while len(out_bin) % 4:
        out_bin.append(0)
    g["bufferViews"][vi]["byteOffset"] = len(out_bin)
    g["bufferViews"][vi]["byteLength"] = len(data)
    out_bin += data
while len(out_bin) % 4:
    out_bin.append(0)
g["buffers"][0]["byteLength"] = len(out_bin)
js = json.dumps(g, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(out_bin)
with open(dst, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, total))
    f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
    f.write(struct.pack("<II", len(out_bin), 0x004E4942) + bytes(out_bin))
print(f"{src} -> {dst}: {total} bytes, texture {size}x{size} jpeg {len(new_bytes)} bytes, "
      f"{int(mask.sum())} texels painted/dilated, {len(idx)} triangles")
