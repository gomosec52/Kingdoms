#!/usr/bin/env python3
"""Generate item and entity textures for the chunk capture flag."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ITEM_OUT = ROOT / "resource_pack/textures/items/chunk_capture_flag.png"
ENTITY_OUT = ROOT / "resource_pack/textures/entity/chunk_capture_flag.png"
ENTITY_SRC = ROOT / "resource_pack/textures/entity/kingdom_flag.png"

# Minecraft-ish palette
POLE = (92, 59, 33, 255)
POLE_DARK = (62, 39, 22, 255)
FLAG_BLUE = (36, 106, 196, 255)
FLAG_BLUE_LIGHT = (72, 148, 232, 255)
FLAG_BLUE_DARK = (24, 72, 140, 255)
GOLD = (212, 175, 55, 255)
GOLD_DARK = (156, 124, 36, 255)
WHITE = (240, 244, 255, 255)
TRANSPARENT = (0, 0, 0, 0)


def generate_item_icon() -> None:
    img = Image.new("RGBA", (16, 16), TRANSPARENT)
    draw = ImageDraw.Draw(img)

    # Pole
    draw.rectangle((2, 1, 3, 14), fill=POLE)
    draw.point((2, 1), fill=POLE_DARK)

    # Flag cloth
    draw.rectangle((4, 2, 13, 10), fill=FLAG_BLUE)
    draw.rectangle((4, 2, 13, 3), fill=GOLD)
    draw.rectangle((4, 9, 13, 10), fill=GOLD_DARK)
    draw.rectangle((12, 2, 13, 10), fill=FLAG_BLUE_DARK)

    # Chunk grid emblem (2x2)
    for x, y in ((6, 4), (9, 4), (6, 7), (9, 7)):
        draw.rectangle((x, y, x + 1, y + 1), fill=WHITE)
    draw.rectangle((7, 5, 8, 6), fill=GOLD)

    ITEM_OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(ITEM_OUT, format="PNG", optimize=True)
    print(f"Wrote {ITEM_OUT}")


def recolor_entity_texture() -> None:
    with Image.open(ENTITY_SRC) as source:
        rgba = source.convert("RGBA")
        pixels = rgba.load()
        width, height = rgba.size

        for y in range(height):
            for x in range(width):
                r, g, b, a = pixels[x, y]
                if a < 16:
                    continue

                # Recolor red kingdom flag tones into blue capture flag tones.
                if r > g + 20 and r > b + 20:
                    strength = min(1.0, (r - max(g, b)) / 140)
                    nr = int(24 + (1 - strength) * 40 + strength * 20)
                    ng = int(72 + strength * 80)
                    nb = int(140 + strength * 90)
                    pixels[x, y] = (nr, ng, nb, a)
                elif r > 150 and g > 120 and b < 90:
                    pixels[x, y] = GOLD if (x + y) % 7 else GOLD_DARK
                elif r > 200 and g > 200 and b > 200:
                    pixels[x, y] = WHITE

        ENTITY_OUT.parent.mkdir(parents=True, exist_ok=True)
        rgba.save(ENTITY_OUT, format="PNG", optimize=True)
        print(f"Wrote {ENTITY_OUT}")


def main() -> int:
    generate_item_icon()
    recolor_entity_texture()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
