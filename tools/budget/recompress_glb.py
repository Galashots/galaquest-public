"""Re-encode a GLB's embedded textures and rebuild the binary chunk.

  python tools/budget/recompress_glb.py <in.glb> <out.glb> [--size 1024] [--quality 85]

Why this exists: every shipped GalaQuest asset breaches the 1 MB payload cap, and in all of them
the texture is 65-99% of the file. Meshy and Blender both hand back PNG, which for a painted
1024 texture runs ~1.7 MB where a quality JPEG runs ~170 KB for no visible difference at 90 CSS px.

Safe here because every material measured is alphaMode=OPAQUE and the PNG alpha is opaque export
residue (hero: 95 non-opaque pixels of 1,048,576). CHECK THAT AGAIN before pointing this at a new
asset -- run tools/budget/glb_budget.mjs and look at the material's alphaMode. If a material ever
needs real cutout alpha, JPEG is the wrong container and this script must refuse it.

The BIN chunk is rebuilt from scratch rather than patched: changing one image's length shifts every
later bufferView offset, and an accessor reading from a stale offset fails silently as garbage
geometry rather than loudly as an error.
"""

import io
import json
import os
import struct
import sys

from PIL import Image

args = sys.argv[1:]
if len(args) < 2:
    sys.exit("usage: recompress_glb.py <in.glb> <out.glb> [--size N] [--quality N]")
src, dst = args[0], args[1]
size = int(args[args.index("--size") + 1]) if "--size" in args else None
quality = int(args[args.index("--quality") + 1]) if "--quality" in args else 85

raw = open(src, "rb").read()
if struct.unpack_from("<I", raw, 0)[0] != 0x46546C67:
    sys.exit(f"{src} is not a GLB")
json_len, json_type = struct.unpack_from("<II", raw, 12)
assert json_type == 0x4E4F534A, "first chunk is not JSON"
g = json.loads(raw[20:20 + json_len])
bin_offset = 20 + json_len
bin_len, bin_type = struct.unpack_from("<II", raw, bin_offset)
assert bin_type == 0x004E4942, "second chunk is not BIN"
bin_data = raw[bin_offset + 8:bin_offset + 8 + bin_len]

# Refuse anything that actually uses alpha, rather than silently flattening it.
for m in g.get("materials", []):
    if m.get("alphaMode", "OPAQUE") != "OPAQUE":
        sys.exit(f"material alphaMode={m['alphaMode']} needs alpha; JPEG would destroy it")

image_views = {img["bufferView"]: i for i, img in enumerate(g.get("images", [])) if "bufferView" in img}
new_blobs = {}
for view_index, image_index in image_views.items():
    bv = g["bufferViews"][view_index]
    off = bv.get("byteOffset", 0)
    im = Image.open(io.BytesIO(bin_data[off:off + bv["byteLength"]])).convert("RGB")
    before = bv["byteLength"]
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True)
    new_blobs[view_index] = buf.getvalue()
    g["images"][image_index]["mimeType"] = "image/jpeg"
    print(f"  image[{image_index}] {im.size[0]}x{im.size[1]}  {before:,} -> {len(new_blobs[view_index]):,} bytes")

# Rebuild every bufferView in index order so accessors keep pointing at their own bytes.
out = bytearray()
for i, bv in enumerate(g["bufferViews"]):
    while len(out) % 4:
        out.append(0)
    blob = new_blobs.get(i) or bin_data[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
    bv["byteOffset"] = len(out)
    bv["byteLength"] = len(blob)
    out.extend(blob)
while len(out) % 4:
    out.append(0)
g["buffers"][0]["byteLength"] = len(out)
g["buffers"][0].pop("uri", None)

json_bytes = json.dumps(g, separators=(",", ":")).encode("utf8")
json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
total = 12 + 8 + len(json_bytes) + 8 + len(out)
with open(dst, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, total))
    f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    f.write(json_bytes)
    f.write(struct.pack("<II", len(out), 0x004E4942))
    f.write(out)

print(f"{os.path.basename(src)} {len(raw):,} -> {os.path.basename(dst)} {total:,} bytes "
      f"({100.0 * total / len(raw):.0f}% of original)")
