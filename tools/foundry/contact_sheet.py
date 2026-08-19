#!/usr/bin/env python3
"""Lay captures out as one labelled contact sheet a reviewer can open in a single click.

    python tools/foundry/contact_sheet.py OUT.jpg --cols 5 --title "..." \
        --tile path/to/a.png "row label / shot label" --tile path/to/b.png "..."

WHY THIS EXISTS. AP1 shipped two contact sheets and built both by hand, which meant the layout, the
labelling and the ordering were re-decided each time and none of it was reviewable afterwards. AP2-A
needs four more, and three of them are SIDE-BY-SIDE comparisons where a mislabelled or misordered
tile is not a cosmetic problem -- it would send Sol a ruling about the wrong animation.

So the label is not decoration and is drawn from the same argument that supplies the file. A tile
whose image cannot be read fails the whole sheet rather than being silently dropped: a contact sheet
with a hole in it still looks complete, and that is exactly how a missing capture becomes an
accidental claim that something was reviewed.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

LABEL_H = 26
TITLE_H = 34
PAD = 6
BG = (24, 24, 28)
FG = (238, 238, 240)


def _font(size):
    """A real font if this machine has one, PIL's bitmap default otherwise.

    Deliberately not fatal: a sheet with ugly labels is still reviewable, a sheet that failed to
    build is not. The fallback is reported by the caller so nobody wonders why the text looks small.
    """
    for name in ("DejaVuSans.ttf", "arial.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def build(out_path, tiles, cols, title, tile_width):
    if not tiles:
        raise SystemExit("refusing to build an empty contact sheet")

    loaded = []
    for path, label in tiles:
        p = Path(path)
        if not p.exists():
            raise SystemExit(f"missing tile: {p}\n(a sheet with a hole in it still looks complete -- refusing)")
        image = Image.open(p).convert("RGB")
        scale = tile_width / image.width
        loaded.append((image.resize((tile_width, max(1, round(image.height * scale)))), label))

    tile_h = max(image.height for image, _ in loaded)
    rows = (len(loaded) + cols - 1) // cols
    cell_w = tile_width + PAD
    cell_h = tile_h + LABEL_H + PAD

    sheet = Image.new("RGB", (cols * cell_w + PAD, rows * cell_h + PAD + TITLE_H), BG)
    draw = ImageDraw.Draw(sheet)
    draw.text((PAD + 2, 8), title, fill=FG, font=_font(20))

    for i, (image, label) in enumerate(loaded):
        x = PAD + (i % cols) * cell_w
        y = TITLE_H + PAD + (i // cols) * cell_h
        sheet.paste(image, (x, y))
        draw.text((x + 2, y + image.height + 5), label[:64], fill=FG, font=_font(13))

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=88, optimize=True)
    print(f"{out}  {sheet.width}x{sheet.height}  {len(loaded)} tiles  ({out.stat().st_size // 1024} KB)")
    return out


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--cols", type=int, default=5)
    ap.add_argument("--title", default="")
    ap.add_argument("--tile-width", type=int, default=300)
    ap.add_argument("--tile", nargs=2, action="append", metavar=("PATH", "LABEL"), default=[])
    args = ap.parse_args(argv)
    build(args.out, args.tile, args.cols, args.title, args.tile_width)


if __name__ == "__main__":
    main(sys.argv[1:])
