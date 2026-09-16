#!/usr/bin/env python3
"""Generate flat PNG icons (solid indigo with white 'A') for the extension."""
import zlib, struct, os

SIZES = [16, 32, 48, 128]
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
os.makedirs(OUT, exist_ok=True)


def chunk(tag, data):
    block = tag + data
    return struct.pack(">I", len(data)) + block + struct.pack(">I", zlib.crc32(block))


def png(w, h, px):
    raw = b""
    for y in range(h):
        raw += b"\x00"
        for x in range(w):
            px[y][x]
            raw += bytes(px[y][x])
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


INDIGO = (79, 70, 229, 255)   # indigo-600
FACE = (255, 241, 242, 255)   # soft white


def make(w):
    px = [[(0, 0, 0, 0) for _ in range(w)] for _ in range(w)]
    # rounded-rect background
    r = max(2, w // 8)
    for y in range(w):
        for x in range(w):
            cx = min(x, w - 1 - x)
            cy = min(y, w - 1 - y)
            if cx >= r and cy >= r:
                px[y][x] = INDIGO
            elif (r - cx) ** 2 + (r - cy) ** 2 <= r * r * 1.15:
                px[y][x] = INDIGO
    # "A" glyph as two strokes + crossbar
    sx = w / 16.0
    def in_a(x, y):
        # apex near top, legs to bottom
        # left stroke
        fx = (x - 5.2 * sx) / (3.0 * sx)
        # right stroke
        gx = (x - 10.8 * sx) / (3.0 * sx)
        fy = (y - 3.2 * sx) / (10.0 * sx)
        if abs(fy) <= 1 and abs(fx) <= 1 and -1 <= fx <= 0.2:
            if abs(fx * 0.9 - fy) < 0.75:
                return True
        if abs(gx) <= 1 and -0.2 <= gx <= 1 and abs(fy) <= 1:
            if abs(gx * 0.9 + fy) < 0.75:
                return True
        if 5.6 * sx <= x <= 10.4 * sx and 6.0 * sx <= y <= 7.4 * sx:
            return True
        return False
    for y in range(w):
        for x in range(w):
            if px[y][x][3] == 255 and in_a(x, y):
                px[y][x] = FACE
    return px


for s in SIZES:
    with open(os.path.join(OUT, f"icon{s}.png"), "wb") as f:
        f.write(png(s, s, make(s)))
    print("wrote", s)