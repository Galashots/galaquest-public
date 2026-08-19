"""Recover a skinned mesh's disconnected shells and classify them against a cut height.

    python tools/foundry/shell_classify.py public/assets/hero/hero.glb
    python tools/foundry/shell_classify.py public/assets/hero/hero.glb --threshold 1.360

This exists to answer one question before any hero-split work is authored: when a helmet
covers the top of the head, can every shell be assigned WHOLLY to "covered" or WHOLLY to
"visible"? If even one shell straddles the helmet's brow line, shell-granularity
classification is not sufficient and the split has to drop to triangle level -- a much
larger change. The straddle count is therefore a gate, not a statistic.

Why the GLB's own chunks and not Blender: AGENTS.md forbids treating the Blender importer
as evidence, because it fabricates an unweighted Icosphere that is not in the file and
synthesises bone tails running to 1,233 units on a 1.5-unit character. Connectivity is
recovered here from the index buffer that actually ships.

Nothing is written. This reports; it does not modify the asset.
"""

import argparse
import json
import struct
import sys
from pathlib import Path

# glTF accessor component types, by their spec numbers.
COMPONENT = {
    5120: ("b", 1),  # BYTE
    5121: ("B", 1),  # UNSIGNED_BYTE
    5122: ("h", 2),  # SHORT
    5123: ("H", 2),  # UNSIGNED_SHORT
    5125: ("I", 4),  # UNSIGNED_INT
    5126: ("f", 4),  # FLOAT
}
COMPONENTS_PER = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

# glTF is Y-up; Blender is Z-up. Every height in docs/foundry/gear/*.json was measured in
# Blender, so a threshold quoted from there is a Blender Z and lands on glTF Y here.
AXIS = {"x": 0, "y": 1, "z": 2}


def read_glb(path):
    """Return (json_document, binary_chunk). Rejects anything that is not glTF 2 binary."""
    data = Path(path).read_bytes()
    if len(data) < 20:
        raise SystemExit(f"{path}: shorter than a GLB header plus JSON chunk")
    magic, version, declared = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2:
        raise SystemExit(f"{path}: not a binary glTF 2 container")
    if declared != len(data):
        raise SystemExit(f"{path}: header length {declared} != actual {len(data)}")

    document = None
    binary = b""
    offset = 12
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<I4s", data, offset)
        payload = data[offset + 8 : offset + 8 + length]
        if kind == b"JSON":
            document = json.loads(payload.decode("utf-8").rstrip(" \t\r\n\x00"))
        elif kind == b"BIN\x00":
            binary = payload
        # A conformant GLB already pads each chunk to a 4-byte boundary inside its declared
        # length, so this term is zero for every file the spec allows. It is here so a sloppily
        # written GLB desynchronises loudly on the next chunk header rather than silently.
        offset += 8 + length + (4 - length % 4) % 4
    if document is None:
        raise SystemExit(f"{path}: no JSON chunk")
    return document, binary


def read_accessor(document, binary, index):
    """Decode one accessor into a flat list, honouring byteStride so interleaved data is safe."""
    accessor = document["accessors"][index]
    fmt, size = COMPONENT[accessor["componentType"]]
    per = COMPONENTS_PER[accessor["type"]]
    count = accessor["count"]
    if "bufferView" not in accessor:
        # A sparse-only or zero-filled accessor. Not expected on this asset; say so rather
        # than silently returning zeros that would read as real geometry at the origin.
        raise SystemExit(f"accessor {index} has no bufferView; refusing to invent values")
    view = document["bufferViews"][accessor["bufferView"]]
    base = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride") or size * per

    out = []
    for i in range(count):
        start = base + i * stride
        out.extend(struct.unpack_from("<" + fmt * per, binary, start))
    return out


class Union:
    """Union-find with path halving. Vertices are the elements; triangles supply the joins."""

    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, a):
        while self.parent[a] != a:
            self.parent[a] = self.parent[self.parent[a]]
            a = self.parent[a]
        return a

    def join(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


def primitives_of(document):
    """Every (mesh_name, primitive) that carries indexed triangles."""
    found = []
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            # mode 4 is TRIANGLES and is the default when mode is absent.
            if primitive.get("mode", 4) != 4:
                continue
            if "indices" not in primitive or "POSITION" not in primitive.get("attributes", {}):
                continue
            found.append((mesh.get("name", "<unnamed>"), primitive))
    return found


def shells_of(positions, indices):
    """Group triangles into connected components over shared vertex indices."""
    vertex_count = len(positions) // 3
    union = Union(vertex_count)
    for i in range(0, len(indices), 3):
        a, b, c = indices[i], indices[i + 1], indices[i + 2]
        union.join(a, b)
        union.join(b, c)

    groups = {}
    for i in range(0, len(indices), 3):
        root = union.find(indices[i])
        shell = groups.get(root)
        if shell is None:
            shell = groups[root] = {
                "triangles": 0,
                "vertices": set(),
                "lo": [float("inf")] * 3,
                "hi": [float("-inf")] * 3,
            }
        shell["triangles"] += 1
        for vertex in (indices[i], indices[i + 1], indices[i + 2]):
            shell["vertices"].add(vertex)
            for axis in range(3):
                value = positions[vertex * 3 + axis]
                if value < shell["lo"][axis]:
                    shell["lo"][axis] = value
                if value > shell["hi"][axis]:
                    shell["hi"][axis] = value
    return list(groups.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("glb")
    parser.add_argument("--axis", default="y", choices=sorted(AXIS), help="up axis; glTF is y")
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        help="cut height in the MESH's own units. Omit to report the mesh bounds first, "
        "so the threshold can be quoted in a space that was actually observed.",
    )
    parser.add_argument(
        "--sweep",
        action="store_true",
        help="walk the whole height reporting how many shells straddle each candidate cut. "
        "A failed gate says one cut does not work; this says whether ANY cut does.",
    )
    parser.add_argument("--json", default=None, help="write the per-shell table here")
    args = parser.parse_args()

    document, binary = read_glb(args.glb)
    prims = primitives_of(document)
    if not prims:
        raise SystemExit(f"{args.glb}: no indexed triangle primitives")

    axis = AXIS[args.axis]
    axis_name = args.axis.upper()
    print(f"\n{Path(args.glb).name}")
    print(f"  {len(prims)} indexed triangle primitive(s); up axis {axis_name}")

    everything = []
    for name, primitive in prims:
        positions = read_accessor(document, binary, primitive["attributes"]["POSITION"])
        indices = read_accessor(document, binary, primitive["indices"])
        shells = shells_of(positions, indices)
        shells.sort(key=lambda s: -s["triangles"])
        everything.append((name, shells))

        lo = min(s["lo"][axis] for s in shells)
        hi = max(s["hi"][axis] for s in shells)
        print(f"\n  mesh '{name}'")
        print(f"    triangles          {sum(s['triangles'] for s in shells):,}")
        print(f"    vertices           {len(positions) // 3:,}")
        print(f"    DISCONNECTED SHELLS {len(shells):,}")
        print(f"    {axis_name} range            {lo:.4f} .. {hi:.4f}   (height {hi - lo:.4f})")
        big = shells[0]
        print(f"    largest shell      {big['triangles']:,} triangles "
              f"({big['triangles'] * 100.0 / sum(s['triangles'] for s in shells):.1f}% of the mesh)")
        singles = sum(1 for s in shells if s["triangles"] <= 2)
        print(f"    shells <= 2 tris   {singles:,}")

        if args.sweep:
            # Only a shell's own lo/hi can change the count, so the candidate cuts worth
            # testing are exactly the shell boundaries. Anything between two of them gives
            # the same answer as the boundary below it.
            edges = sorted({round(s["lo"][axis], 4) for s in shells}
                           | {round(s["hi"][axis], 4) for s in shells})
            print(f"\n    --- straddle count across {len(edges)} candidate cuts ---")
            clean = []
            for cut in edges:
                crossing = [s for s in shells if s["lo"][axis] < cut < s["hi"][axis]]
                if not crossing:
                    clean.append(cut)
            if clean:
                # Report contiguous runs of clean cuts rather than every value, because
                # adjacent clean cuts are one usable band, not many separate options.
                runs = []
                for cut in clean:
                    if runs and abs(cut - runs[-1][1]) < 1e-6:
                        runs[-1][1] = cut
                    else:
                        runs.append([cut, cut])
                print(f"    {len(clean)} cut(s) straddle nothing, in {len(runs)} band(s):")
                for start, end in runs:
                    inside = sum(1 for s in shells if s["lo"][axis] >= end)
                    tris = sum(s["triangles"] for s in shells if s["lo"][axis] >= end)
                    print(f"      {axis_name} {start:.4f} .. {end:.4f}   "
                          f"hides {inside:,} shells / {tris:,} triangles above it")
            else:
                print("    NO cut anywhere on this axis avoids splitting a shell.")
            continue

        if args.threshold is None:
            print(f"\n    No --threshold given, so nothing is classified. Quote one in the "
                  f"{lo:.4f}..{hi:.4f} range above.")
            continue

        cut = args.threshold
        below = [s for s in shells if s["hi"][axis] <= cut]
        above = [s for s in shells if s["lo"][axis] >= cut]
        straddle = [s for s in shells if s["lo"][axis] < cut < s["hi"][axis]]
        tri = lambda group: sum(s["triangles"] for s in group)

        print(f"\n    --- classified against {axis_name} = {cut:.4f} ---")
        print(f"    wholly below   {len(below):>5,} shells  {tri(below):>7,} triangles")
        print(f"    wholly above   {len(above):>5,} shells  {tri(above):>7,} triangles")
        print(f"    STRADDLING     {len(straddle):>5,} shells  {tri(straddle):>7,} triangles")
        if straddle:
            print(f"\n    GATE FAILED. {len(straddle)} shell(s) cross the cut, so no assignment of "
                  f"whole shells\n    can hide everything above it without also hiding geometry below it.")
            for s in straddle[:8]:
                print(f"      {s['triangles']:>6,} tris   {axis_name} {s['lo'][axis]:.4f} .. {s['hi'][axis]:.4f}")
            if len(straddle) > 8:
                print(f"      ... and {len(straddle) - 8} more")
        else:
            print("\n    GATE PASSED. Every shell falls wholly on one side of the cut.")

    if args.json:
        payload = [
            {
                "mesh": name,
                "shells": [
                    {
                        "triangles": s["triangles"],
                        "vertices": len(s["vertices"]),
                        "min": [round(v, 6) for v in s["lo"]],
                        "max": [round(v, 6) for v in s["hi"]],
                    }
                    for s in shells
                ],
            }
            for name, shells in everything
        ]
        Path(args.json).write_text(json.dumps(payload, indent=2), encoding="utf8")
        print(f"\n  wrote {args.json}")


if __name__ == "__main__":
    sys.exit(main())
