#!/usr/bin/env python3
"""Generate a minimal territory border block texture (1px red stripe)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "resource_pack/textures/blocks/territory_border.png"
RED = (220, 32, 32, 255)
TRANSPARENT = (0, 0, 0, 0)


def main() -> int:
    img = Image.new("RGBA", (16, 16), TRANSPARENT)
    pixels = img.load()
    for x in range(16):
        pixels[x, 8] = RED
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, format="PNG", optimize=True)
    print(f"Wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
