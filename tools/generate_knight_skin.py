#!/usr/bin/env python3
"""Generate a 64x64 knight player skin placeholder (silver armor style)."""
from PIL import Image

img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
px = img.load()

SILVER = (180, 184, 190, 255)
DARK = (60, 62, 68, 255)
MID = (120, 124, 130, 255)
SKIN = (190, 150, 110, 255)


def fill(x1, y1, x2, y2, color):
    for y in range(y1, y2 + 1):
        for x in range(x1, x2 + 1):
            px[x, y] = color


# Head (front 8,8 -> 16,16) helmet
fill(8, 8, 15, 15, SILVER)
fill(9, 10, 14, 12, DARK)  # visor slit
# Body front
fill(20, 20, 27, 31, SILVER)
fill(20, 32, 27, 35, MID)
# Arms
fill(44, 20, 47, 31, SILVER)
fill(36, 52, 39, 63, SILVER)
# Legs
fill(4, 20, 7, 31, MID)
fill(20, 52, 23, 63, MID)
# Head top / sides hints
fill(8, 0, 15, 7, SILVER)
fill(0, 8, 7, 15, SILVER)
fill(16, 8, 23, 15, SILVER)
fill(24, 8, 31, 15, SILVER)

img.save("/workspace/resource_pack/textures/entity/knight.png")
print("Wrote knight.png")
