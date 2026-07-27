#!/usr/bin/env python3
"""Downscale flag textures to a lighter Bedrock-friendly size."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


TARGET_SIZE = 512
SOURCE_CANDIDATES = [
    Path("/tmp/textures_zip/textures/lambert3SG_baseColor.png"),
]


def best_source(root: Path) -> Path:
    for candidate in SOURCE_CANDIDATES:
        if candidate.exists():
            return candidate
    return root / "resource_pack/textures/entity/kingdom_flag.png"


def downscale(source: Path, destination: Path, size: int = TARGET_SIZE) -> None:
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        resized = rgba.resize((size, size), Image.Resampling.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        resized.save(destination, format="PNG", optimize=True)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else best_source(root)
    size = int(sys.argv[2]) if len(sys.argv) > 2 else TARGET_SIZE

    targets = [
        root / "resource_pack/textures/entity/kingdom_flag.png",
        root / "resource_pack/textures/blocks/kingdom_flag.png",
    ]

    for target in targets:
        downscale(source, target, size)
        print(f"Wrote {target} ({size}x{size}) from {source.name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
