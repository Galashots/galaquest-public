"""Recolour texels selected by 3D surface position AND colour, via the mesh's own UV layout.

  python tools/recolor_region.py <in.glb> <out.glb> --ymin Y --maxlum L [--report]

Used for Zapkit: the dark-navy EAR TIPS (a well-known yellow-electric-mascot cue) are recoloured to the
surrounding ear yellow, while the navy tiger stripes on the body/back of the head (below --ymin) are kept.
Every texel is mapped to its 3D position by rasterising triangles in UV space; a texel is recoloured only
when its surface point is above --ymin (model units, +Y up) AND its luminance is below --maxlum. The
replacement colour is the median of the non-dark texels in the same height band, so it matches the ear.
The output keeps the texture as PNG (lossless); run tools/budget/recompress_glb.py afterwards.
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
ymin = float(args[args.index("--ymin") + 1])
maxlum = float(args[args.index("--maxlum") + 1])
report = "--report" in args

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
    assert bv.get("byteStride", sz * n) == sz * n, "interleaved buffers not supported"
    arr = np.frombuffer(bin_data, dtype=dt, count=a["count"] * n, offset=off).reshape(a["count"], n)
    return arr.astype(np.float64) if dt == "<f4" else arr.astype(np.int64)


prim = g["meshes"][0]["primitives"][0]
pos = accessor(prim["attributes"]["POSITION"])
uv = accessor(prim["attributes"]["TEXCOORD_0"])
idx = accessor(prim["indices"]).reshape(-1, 3)
mat = g["materials"][prim["material"]]
img_i = g["textures"][mat["pbrMetallicRoughness"]["baseColorTexture"]["index"]]["source"]
view_i = g["images"][img_i]["bufferView"]
bv = g["bufferViews"][view_i]
tex = np.array(Image.open(io.BytesIO(bin_data[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])).convert("RGB")).astype(np.float64)
H, W = tex.shape[:2]

ymap = np.full((H, W), -np.inf)
P = uv * np.array([W, H]) - 0.5
for t in idx:
    (x0, y0), (x1, y1), (x2, y2) = P[t]
    minx, maxx = int(max(0, math.floor(min(x0, x1, x2)))), int(min(W - 1, math.ceil(max(x0, x1, x2))))
    miny, maxy = int(max(0, math.floor(min(y0, y1, y2)))), int(min(H - 1, math.ceil(max(y0, y1, y2))))
    den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if maxx < minx or maxy < miny or abs(den) < 1e-12:
        continue
    xs, ys = np.meshgrid(np.arange(minx, maxx + 1), np.arange(miny, maxy + 1))
    w0 = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / den
    w1 = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / den
    w2 = 1 - w0 - w1
    ins = (w0 >= -0.03) & (w1 >= -0.03) & (w2 >= -0.03)
    yv = w0 * pos[t[0], 1] + w1 * pos[t[1], 1] + w2 * pos[t[2], 1]
    ymap[ys[ins], xs[ins]] = np.maximum(ymap[ys[ins], xs[ins]], yv[ins])

lum = tex @ np.array([0.2126, 0.7152, 0.0722])
band = ymap >= ymin
dark = lum < maxlum
sel = band & dark
if report:
    ys_dark = ymap[dark & np.isfinite(ymap)]
    print("dark texels by height:", np.histogram(ys_dark, bins=10, range=(pos[:, 1].min(), pos[:, 1].max())))
repl = np.median(tex[band & ~dark], axis=0)
# Grow the selection by 2 px so JPEG/bilinear fringes of the old navy do not survive as a dark rim.
grown = sel.copy()
for _ in range(2):
    g2 = grown.copy()
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        g2 |= np.roll(np.roll(grown, dy, 0), dx, 1) & band & (lum < maxlum + 60)
    grown = g2
tex[grown] = repl
print(f"band texels {int(band.sum())}, recoloured {int(grown.sum())} -> RGB {repl.round().tolist()}")

buf = io.BytesIO()
Image.fromarray(tex.clip(0, 255).astype(np.uint8), "RGB").save(buf, "PNG")
new = buf.getvalue()
views = []
for vi, v in enumerate(g["bufferViews"]):
    off = v.get("byteOffset", 0)
    views.append(new if vi == view_i else bin_data[off:off + v["byteLength"]])
out = bytearray()
for vi, data in enumerate(views):
    while len(out) % 4:
        out.append(0)
    g["bufferViews"][vi]["byteOffset"] = len(out)
    g["bufferViews"][vi]["byteLength"] = len(data)
    out += data
while len(out) % 4:
    out.append(0)
g["buffers"][0]["byteLength"] = len(out)
g["images"][img_i]["mimeType"] = "image/png"
js = json.dumps(g, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
with open(dst, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)))
    f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
    f.write(struct.pack("<II", len(out), 0x004E4942) + bytes(out))
print(f"wrote {dst}")
