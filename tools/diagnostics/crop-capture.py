#!/usr/bin/env python3
"""Crop and zoom a playtest capture, so a person can actually LOOK at one.

    python3 tools/diagnostics/crop-capture.py IN.png OUT.png X Y W H [ZOOM]

WHY THIS EXISTS. docs/MISTAKES.md has two entries about captures being filed as evidence without
anyone opening them, and a third about a check that reads a flag proving only that the rules ran.
The counter to all three is to open the picture -- and at 1024x768 the hero is about forty pixels
tall, which is not enough to tell a hero lying on the ground from a hero standing over one. Every
finding this tool was written for came from cropping in and looking: a knockdown capture that
turned out to be photographing the wrong moment, a chooser row with no picture on it, and the
in-game chip that identified a child by name to an audience that cannot read.

WHY IT IS HAND-ROLLED. This container has no PIL and no ImageMagick, and the repo has no npm. zlib
and struct are in the standard library, and a non-interlaced 8-bit PNG is a couple of dozen lines of
unfiltering, so the dependency-free version is cheaper than arguing for a dependency. It reads what
Chrome's Page.captureScreenshot writes and nothing else -- 8-bit, non-interlaced, any channel count
-- and says so rather than guessing if handed something else.

Nearest-neighbour on purpose: this is for judging what is THERE, and a smoothing resample invents
pixels that were not.
"""
import struct, sys, zlib

def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos, idat, meta = 8, [], None
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos+4])
        ctype = data[pos+4:pos+8]
        body = data[pos+8:pos+8+length]
        if ctype == b'IHDR':
            meta = struct.unpack('>IIBBBBB', body)
        elif ctype == b'IDAT':
            idat.append(body)
        elif ctype == b'IEND':
            break
        pos += 12 + length
    w, h, depth, colour, comp, filt, interlace = meta
    assert depth == 8 and interlace == 0, f'unsupported depth/interlace {depth}/{interlace}'
    channels = {0: 1, 2: 3, 4: 2, 6: 4}[colour]
    raw = zlib.decompress(b''.join(idat))
    stride = w * channels
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ftype = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if ftype == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i-channels]) & 255
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif ftype == 3:
            for i in range(stride):
                left = line[i-channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif ftype == 4:
            for i in range(stride):
                a = line[i-channels] if i >= channels else 0
                b = prev[i]
                c = prev[i-channels] if i >= channels else 0
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        elif ftype != 0:
            raise SystemExit(f'bad filter {ftype} on row {y}')
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, channels, out

def write_png(path, w, h, channels, pix):
    colour = {1: 0, 2: 4, 3: 2, 4: 6}[channels]
    stride = w * channels
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += pix[y*stride:(y+1)*stride]
    def chunk(tag, body):
        return struct.pack('>I', len(body)) + tag + body + struct.pack('>I', zlib.crc32(tag + body) & 0xffffffff)
    blob = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, colour, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 6))
            + chunk(b'IEND', b''))
    open(path, 'wb').write(blob)

def main():
    src, dst, x, y, cw, ch = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:7])
    zoom = int(sys.argv[7]) if len(sys.argv) > 7 else 1
    w, h, channels, pix = read_png(src)
    x, y = max(0, min(x, w-1)), max(0, min(y, h-1))
    cw, ch = min(cw, w-x), min(ch, h-y)
    stride = w * channels
    ow, oh = cw*zoom, ch*zoom
    out = bytearray(ow*oh*channels)
    for row in range(ch):
        base = (y+row)*stride + x*channels
        line = bytearray()
        for col in range(cw):
            px = pix[base+col*channels:base+(col+1)*channels]
            line += px * zoom
        for rep in range(zoom):
            o = ((row*zoom)+rep)*ow*channels
            out[o:o+len(line)] = line
    write_png(dst, ow, oh, channels, out)
    print(f'{src} {w}x{h} -> {dst} {ow}x{oh} (crop {cw}x{ch} at {x},{y} zoom {zoom}x)')

main()
