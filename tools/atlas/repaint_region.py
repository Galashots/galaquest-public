"""Repaint one body region of a character's texture, in place, without touching a single vertex.

  python repaint_region.py extract <glb> <uv_tris.json> <outdir>
  python repaint_region.py apply   <glb> <uv_tris.json> <painted.png> <out.glb> [--feather 3]

Why this exists. The slot ranking says the chest is "texture and value only -- no separate
geometry", and comparison with other games says the same: their characters read as armoured mostly
through texture on the body mesh, not through added props. GalaQuest built the geometry half
(helmet, shoulders) and skipped this half, which is most of why the hero still reads as a boy in a
tunic with a hat on. This is the skipped half, and it costs no triangles, no draw calls and no
credits.

`extract` rasterises the region's UV triangles into a mask and hands back that patch of the current
texture, so a painter (human or otherwise) works on the real pixels at the real scale.
`apply` composites a repainted patch back through the same mask, so paint can only ever land on the
region that owns those faces -- a misaligned patch bleeds nowhere.

The mask is FEATHERED by default. A hard UV edge shows up in game as a seam, because the mesh's
neighbouring faces sample across the boundary under bilinear filtering and mipmapping.
"""

import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def read_glb(path):
    raw = open(path, "rb").read()
    if struct.unpack_from("<I", raw, 0)[0] != 0x46546C67:
        sys.exit(f"{path} is not a GLB")
    json_len, json_type = struct.unpack_from("<II", raw, 12)
    assert json_type == 0x4E4F534A, "first chunk is not JSON"
    g = json.loads(raw[20:20 + json_len])
    bin_off = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", bin_off and raw, bin_off)
    assert bin_type == 0x004E4942, "second chunk is not BIN"
    return raw, g, raw[bin_off + 8:bin_off + 8 + bin_len]


def texture_of(g, bin_data):
    imgs = [i for i, img in enumerate(g.get("images", [])) if "bufferView" in img]
    if len(imgs) != 1:
        sys.exit(f"expected exactly one embedded image, found {len(imgs)}")
    bv = g["bufferViews"][g["images"][imgs[0]]["bufferView"]]
    off = bv.get("byteOffset", 0)
    return imgs[0], Image.open(io.BytesIO(bin_data[off:off + bv["byteLength"]])).convert("RGB")


def build_mask(tris, w, h, feather):
    """UV origin is bottom-left; image origin is top-left, so v is flipped."""
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    for tri in tris:
        d.polygon([(u * w, (1.0 - v) * h) for u, v in tri], fill=255)
    if feather:
        m = m.filter(ImageFilter.MaxFilter(2 * feather + 1)).filter(ImageFilter.GaussianBlur(feather))
    return m


def write_glb(raw, g, bin_data, image_index, out_tex, dst):
    """Re-embed a replacement texture and rebuild the BIN chunk from scratch.

    Every bufferView is rewritten in index order rather than patched: changing one image's length
    shifts every later offset, and an accessor left pointing at a stale offset fails silently as
    garbage geometry rather than loudly as an error.
    """
    buf = io.BytesIO()
    out_tex.save(buf, "JPEG", quality=88, optimize=True)
    blob = buf.getvalue()
    g["images"][image_index]["mimeType"] = "image/jpeg"
    view_index = g["images"][image_index]["bufferView"]

    out = bytearray()
    for i, bv in enumerate(g["bufferViews"]):
        while len(out) % 4:
            out.append(0)
        b = blob if i == view_index else bin_data[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(b)
        out.extend(b)
    while len(out) % 4:
        out.append(0)
    g["buffers"][0]["byteLength"] = len(out)
    g["buffers"][0].pop("uri", None)

    jb = json.dumps(g, separators=(",", ":")).encode("utf8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(out)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(jb), 0x4E4F534A))
        f.write(jb)
        f.write(struct.pack("<II", len(out), 0x004E4942))
        f.write(out)
    print(f"{len(raw):,} -> {os.path.basename(dst)} {total:,} bytes")


def project_positions(data, w, h):
    """Rasterise each UV triangle, barycentrically interpolating its WORLD position per texel.

    Returns (pos, hit): an h*w*3 array of world positions and a boolean coverage mask. This is what
    makes texture-only armour possible on a real character: the torso's UV islands are scattered
    across the whole atlas, so nothing can be painted in UV space, but every texel knows where it
    lives on the body and can therefore be coloured by a rule expressed in world space.
    """
    tris, poss = data["tris"], data["pos"]
    pos = np.zeros((h, w, 3), np.float32)
    hit = np.zeros((h, w), bool)
    for tri, wp in zip(tris, poss):
        px = np.array([[u * w, (1.0 - v) * h] for u, v in tri], np.float64)
        P = np.array(wp, np.float64)
        x0, y0 = np.floor(px.min(axis=0)).astype(int) - 1
        x1, y1 = np.ceil(px.max(axis=0)).astype(int) + 1
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, w), min(y1, h)
        if x1 <= x0 or y1 <= y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = px
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        l3 = 1.0 - l1 - l2
        inside = (l1 >= -0.002) & (l2 >= -0.002) & (l3 >= -0.002)
        if not inside.any():
            continue
        world = (l1[..., None] * P[0] + l2[..., None] * P[1] + l3[..., None] * P[2])
        sub_pos, sub_hit = pos[y0:y1, x0:x1], hit[y0:y1, x0:x1]
        take = inside & ~sub_hit
        sub_pos[take] = world[take]
        sub_hit[take] = True
    return pos, hit


mode = sys.argv[1] if len(sys.argv) > 1 else ""
args = sys.argv[2:]
feather = int(args[args.index("--feather") + 1]) if "--feather" in args else 3

if mode == "extract":
    glb, tri_path, outdir = args[0], args[1], args[2]
    os.makedirs(outdir, exist_ok=True)
    _, g, bin_data = read_glb(glb)
    _, tex = texture_of(g, bin_data)
    tris = json.load(open(tri_path, encoding="utf8"))["tris"]
    mask = build_mask(tris, tex.size[0], tex.size[1], feather)
    box = mask.getbbox()
    if box is None:
        sys.exit("ABORT: the region rasterised to nothing")
    print(f"texture {tex.size[0]}x{tex.size[1]}, region bbox {box}, "
          f"{int(np.asarray(mask).astype(bool).sum())} px covered")
    mask.save(os.path.join(outdir, "mask.png"))
    tex.save(os.path.join(outdir, "texture.png"))
    tex.crop(box).save(os.path.join(outdir, "region.png"))
    mask.crop(box).save(os.path.join(outdir, "region_mask.png"))
    json.dump({"box": list(box), "textureSize": list(tex.size), "feather": feather},
              open(os.path.join(outdir, "region.json"), "w", encoding="utf8"), indent=2)
    print(f"wrote {outdir}/region.png ({box[2]-box[0]}x{box[3]-box[1]}) + mask + region.json")

elif mode == "apply":
    glb, tri_path, painted_path, dst = args[0], args[1], args[2], args[3]
    raw, g, bin_data = read_glb(glb)
    image_index, tex = texture_of(g, bin_data)
    tris = json.load(open(tri_path, encoding="utf8"))["tris"]
    mask = build_mask(tris, tex.size[0], tex.size[1], feather)
    box = mask.getbbox()
    painted = Image.open(painted_path).convert("RGB")
    want = (box[2] - box[0], box[3] - box[1])
    if painted.size != want:
        print(f"  painted patch {painted.size} resized to the region's {want}")
        painted = painted.resize(want, Image.LANCZOS)
    full = tex.copy()
    full.paste(painted, (box[0], box[1]))
    out_tex = Image.composite(full, tex, mask)

    changed = int((np.abs(np.asarray(out_tex).astype(int) - np.asarray(tex).astype(int)).max(axis=2) > 2).sum())
    print(f"  {changed:,} texture pixels changed ({100.0 * changed / (tex.size[0] * tex.size[1]):.1f}%)")
    write_glb(raw, g, bin_data, image_index, out_tex, dst)

elif mode == "project":
    # Paint Tier 3 Silverguard chest armour by a rule in WORLD space, then let the UVs carry it
    # wherever the islands happen to live. Deliberately obeys the detail floor: one base colour,
    # a few broad value planes, one large accent, and nothing that would fall under 2 screen pixels
    # at 90px. Cream is left below the plate because the tier ladder says cream stays underneath.
    glb, tri_path, dst = args[0], args[1], args[2]
    raw, g, bin_data = read_glb(glb)
    image_index, tex = texture_of(g, bin_data)
    data = json.load(open(tri_path, encoding="utf8"))
    W, H = tex.size
    pos, hit = project_positions(data, W, H)
    print(f"projected {int(hit.sum()):,} texels of {W*H:,} ({100.0*hit.sum()/(W*H):.1f}%)")

    def opt(name, default):
        return float(args[args.index(name) + 1]) if name in args else default

    zmin, zmax = data["worldBounds"]["min"][2], data["worldBounds"]["max"][2]
    z = pos[..., 2]
    # Tunable, because the first attempt read as a sports-jersey stripe rather than armour: too
    # pale against a cream tunic and covering too little of the chest.
    PLATE_FROM = zmin + opt("--plate-from", 0.42) * (zmax - zmin)
    BAND = opt("--band", 0.10) * (zmax - zmin)   # the slate-blue hem, one large accent shape
    STEEL = np.array([opt("--steel", 148)] * 3, np.float32) * np.array([0.98, 1.0, 1.04], np.float32)
    BLUE = np.array([64, 92, 132], np.float32)

    # Fill the texels the rasteriser missed from their nearest painted neighbour BEFORE compositing.
    # Without this the painted area stops at the triangle edges while the feathered mask extends
    # past them, so a fringe of original tunic survives around the plate and the hem reads as a
    # torn, zigzag edge rather than a hem. This is the same gutter-dilation the atlas packer does.
    # BOUND the fill to a real gutter. An unbounded nearest-neighbour fill hands every texel in the
    # atlas the z of whatever region texel happens to be closest, which sprayed paint along UV seams
    # and put a stray streak down a trouser leg. Only texels within GUTTER px of a genuinely
    # rasterised one may inherit its position; past that the original texture stands.
    from scipy import ndimage
    GUTTER = int(opt("--gutter", 4))
    if (~hit).any() and hit.any():
        dist, idx = ndimage.distance_transform_edt(~hit, return_indices=True)
        near = dist <= GUTTER
        z = np.where(near, z[tuple(idx)], np.nan)
    paintable = np.isfinite(z)
    print(f"  paintable {int(paintable.sum()):,} texels (rasterised {int(hit.sum()):,} "
          f"+ {GUTTER}px gutter)")

    art = np.asarray(tex).astype(np.float32).copy()
    with np.errstate(invalid='ignore'):
        plate = paintable & (z >= PLATE_FROM + BAND)
        hem = paintable & (z >= PLATE_FROM) & (z < PLATE_FROM + BAND)
    # Two broad value planes: brighter toward the chest's centre-front (-Y), darker at the flanks.
    fpos = pos[..., 1]
    facing = np.clip((-fpos - data["worldBounds"]["min"][1]) /
                     max(data["worldBounds"]["max"][1] - data["worldBounds"]["min"][1], 1e-6), 0, 1)
    shade = (0.86 + 0.28 * facing)[..., None]
    art[plate] = np.clip(STEEL * shade[plate], 0, 255)
    art[hem] = np.clip(BLUE * (0.92 + 0.16 * facing[hem])[..., None], 0, 255)
    painted = Image.fromarray(art.astype(np.uint8))

    mask = build_mask(data["tris"], W, H, feather)
    out_tex = Image.composite(painted, tex, mask)
    changed = int((np.abs(np.asarray(out_tex).astype(int) - np.asarray(tex).astype(int)).max(axis=2) > 2).sum())
    print(f"  plate {int(plate.sum()):,} texels, hem {int(hem.sum()):,}, {changed:,} changed "
          f"({100.0 * changed / (W * H):.1f}% of the atlas)")
    out_tex.save(os.path.splitext(dst)[0] + "_texture.png")
    write_glb(raw, g, bin_data, image_index, out_tex, dst)

else:
    sys.exit(__doc__)
