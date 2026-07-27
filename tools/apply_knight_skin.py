#!/usr/bin/env python3
"""Build a 64x64 knight player skin (standard UV layout)."""
from PIL import Image, ImageDraw

OUT = "/workspace/resource_pack/textures/entity/knight.png"

SILVER = (188, 192, 198, 255)
SILVER_HI = (232, 236, 244, 255)
SILVER_LO = (118, 122, 130, 255)
STEEL = (74, 78, 86, 255)
BLACK = (28, 30, 34, 255)
SKIN = (198, 152, 110, 255)
BLUE_HI = (176, 196, 228, 255)


def fill(img, box, color):
    draw = ImageDraw.Draw(img)
    draw.rectangle(box, fill=color)


def shade_rect(img, box, base, hi, lo):
    x1, y1, x2, y2 = box
    fill(img, box, base)
    fill(img, (x1, y1, x2, y1 + 1), hi)
    fill(img, (x1, y2 - 1, x2, y2), lo)
    fill(img, (x1, y1, x1 + 1, y2), lo)
    fill(img, (x2 - 1, y1, x2, y2), hi)


def plate(img, box):
    shade_rect(img, box, SILVER, SILVER_HI, SILVER_LO)


img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))

# Head faces
for face in [(8, 8, 15, 15), (0, 8, 7, 15), (16, 8, 23, 15), (24, 8, 31, 15), (8, 0, 15, 7), (16, 0, 23, 7)]:
    plate(img, face)
fill(img, (10, 10, 13, 12), STEEL)  # visor
fill(img, (11, 11, 12, 11), SKIN)

# Body
for part in [(20, 20, 27, 31), (16, 20, 19, 31), (28, 20, 31, 31), (20, 16, 27, 19), (32, 20, 39, 31), (36, 52, 43, 63)]:
    plate(img, part)
fill(img, (20, 28, 27, 30), STEEL)

# Arms
for part in [(44, 20, 47, 31), (40, 20, 43, 31), (44, 16, 47, 19), (40, 16, 43, 19), (48, 20, 51, 31), (52, 52, 55, 63)]:
    plate(img, part)
fill(img, (52, 58, 54, 60), SKIN)

# Legs
for part in [(4, 20, 7, 31), (0, 20, 3, 31), (4, 16, 7, 19), (0, 16, 3, 19), (20, 52, 23, 63), (16, 52, 19, 63)]:
    plate(img, part)

# Metallic highlights
for px in [(9, 1), (18, 9), (21, 21), (45, 21), (5, 21), (21, 53)]:
    fill(img, (px[0], px[1], px[0], px[1]), BLUE_HI)

img.save(OUT)
print(f"Wrote {OUT}")
