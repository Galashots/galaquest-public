"""Report a rig's bone frames from the GLB's own node graph, and test two hands for mirroring.

    python tools/foundry/rig_axes.py public/assets/hero/hero.glb
    python tools/foundry/rig_axes.py public/assets/hero/hero.glb --pair LeftHand RightHand

Two questions this answers, both of which change what gear code has to do:

1. IS THE SCALE CHAIN UNIFORM? The armature root carries 0.01, and gear inherits it. If every
   basis vector of a bone's world frame has the same length, the inherited scale is uniform and
   three.js's Object3D.attach() -- documented not to support non-uniformly-scaled ancestors --
   is safe. Measured on hero.glb, all three axes of both hands are exactly 0.01000.

2. ARE THE TWO HANDS MIRROR IMAGES? If a rig was symmetrized in Blender, the left and right
   bones have reflected local axes and ONE authored grip offset works unchanged on both. This
   rig is not symmetrized: both hands measure determinant +1 (proper rotations, neither is
   mirrored), and while their Y and Z axes satisfy the mirror relation to 0.0002, the X axes
   point in opposite directions. So the hands are related by a proper ROTATION, not a
   reflection -- which is the good case, because a quaternion can express a rotation and cannot
   express a reflection. It also means a naive "negate the offset's X and reuse the rotation"
   is wrong, and each hand must keep its own authored transform.

Reads the shipped GLB rather than importing it. AGENTS.md forbids the Blender importer as
evidence: it fabricates geometry and synthesises bone tails of 1,233 units on a 1.5-unit rig.
"""

import argparse
import json
import struct
from pathlib import Path

IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
MIRROR_TOLERANCE = 0.01


def load_nodes(path):
    data = Path(path).read_bytes()
    if struct.unpack_from("<4s", data, 0)[0] != b"glTF":
        raise SystemExit(f"{path}: not a binary glTF container")
    json_len = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20 : 20 + json_len].decode("utf-8").rstrip(" \t\r\n\x00"))
    return document.get("nodes", [])


def multiply(a, b):
    """Column-major 4x4 multiply, which is the convention glTF stores matrices in."""
    out = [0.0] * 16
    for col in range(4):
        for row in range(4):
            out[col * 4 + row] = sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
    return out


def local_matrix(node):
    if "matrix" in node:
        return list(node["matrix"])
    tx, ty, tz = node.get("translation", [0, 0, 0])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    m = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
    ]
    for col, scale in enumerate((sx, sy, sz)):
        for row in range(3):
            m[col * 4 + row] *= scale
    m[12], m[13], m[14] = tx, ty, tz
    return m


def build_index(nodes):
    parent = {}
    for index, node in enumerate(nodes):
        for child in node.get("children", []):
            parent[child] = index
    names = {node["name"]: i for i, node in enumerate(nodes) if node.get("name")}
    return parent, names


def world_matrix(nodes, parent, index):
    chain = []
    while index is not None:
        chain.append(index)
        index = parent.get(index)
    matrix = list(IDENTITY)
    for node_index in reversed(chain):
        matrix = multiply(matrix, local_matrix(nodes[node_index]))
    return matrix, [nodes[i].get("name", f"<{i}>") for i in chain]


def column(matrix, axis):
    return matrix[axis * 4 : axis * 4 + 3]


def determinant3(m):
    return (
        m[0] * (m[5] * m[10] - m[6] * m[9])
        - m[4] * (m[1] * m[10] - m[2] * m[9])
        + m[8] * (m[1] * m[6] - m[2] * m[5])
    )


def describe(nodes, parent, names, bone):
    if bone not in names:
        print(f"  {bone}: NOT FOUND")
        return None
    matrix, chain = world_matrix(nodes, parent, names[bone])
    print(f"\n{bone}   {' <- '.join(chain)}")
    print(f"  world position   ({matrix[12]:+.5f}, {matrix[13]:+.5f}, {matrix[14]:+.5f})")
    lengths = []
    for axis, label in enumerate("XYZ"):
        col = column(matrix, axis)
        length = sum(v * v for v in col) ** 0.5
        lengths.append(length)
        print(f"  local {label} axis    ({col[0]:+.5f}, {col[1]:+.5f}, {col[2]:+.5f})   len {length:.5f}")
    spread = max(lengths) - min(lengths)
    print(f"  scale            {'UNIFORM' if spread < 1e-6 else f'NON-UNIFORM (spread {spread:.6f})'}"
          f"  ~{sum(lengths) / 3:.5f} per axis")
    det = determinant3(matrix)
    print(f"  determinant      {det:+.9f}   {'right-handed' if det > 0 else 'LEFT-handed, i.e. mirrored'}")
    return matrix


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("glb")
    parser.add_argument("--pair", nargs=2, metavar=("LEFT", "RIGHT"), default=["LeftHand", "RightHand"])
    parser.add_argument("--all", action="store_true", help="describe every named node, not just the pair")
    args = parser.parse_args()

    nodes = load_nodes(args.glb)
    parent, names = build_index(nodes)
    print(f"{Path(args.glb).name}: {len(nodes)} nodes")

    if args.all:
        for name in names:
            describe(nodes, parent, names, name)
        return

    left_name, right_name = args.pair
    left = describe(nodes, parent, names, left_name)
    right = describe(nodes, parent, names, right_name)
    if left is None or right is None:
        return

    print(f"\nMirror test: is {right_name}'s frame the reflection of {left_name}'s across the YZ plane?")
    print("  If it were, one authored grip offset would serve both hands with no runtime maths.")
    worst = 0.0
    for axis, label in enumerate("XYZ"):
        got = column(right, axis)
        want = [-column(left, axis)[0], column(left, axis)[1], column(left, axis)[2]]
        diff = max(abs(got[k] - want[k]) for k in range(3))
        worst = max(worst, diff)
        print(f"  {label}  got ({got[0]:+.5f},{got[1]:+.5f},{got[2]:+.5f})   "
              f"reflected ({want[0]:+.5f},{want[1]:+.5f},{want[2]:+.5f})   max diff {diff:.5f}")

    print(f"\n  worst component difference {worst:.5f} against a tolerance of {MIRROR_TOLERANCE}")
    if worst < MIRROR_TOLERANCE:
        print("  MIRRORED. One offset serves both hands unchanged.")
    else:
        print("  NOT MIRRORED. Each hand keeps its own authored transform.")
        print("  Both determinants above are positive, so the two frames differ by a proper")
        print("  rotation rather than a reflection -- expressible as a quaternion. Do not write")
        print("  reflection maths, and do not derive one hand's offset by negating the other's.")


if __name__ == "__main__":
    main()
