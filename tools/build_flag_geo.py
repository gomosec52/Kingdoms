#!/usr/bin/env python3
"""Convert uploaded model.geo_49b2 into Bedrock flag geometry with correct normals."""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

CLOTH_Z = 0.04
WOOD_Z = -0.25


def cross(a: list[float], b: list[float]) -> list[float]:
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def normalize(v: list[float]) -> list[float]:
    length = math.sqrt(sum(component * component for component in v))
    if length <= 1e-8:
        return [0.0, 0.0, 1.0]
    return [component / length for component in v]


def round_vec(v: list[float]) -> list[float]:
    return [round(component, 5) for component in v]


def transform_position(
    position: list[float], center_x: float, min_z: float, depth: float
) -> list[float]:
    # Source flag lies in XZ with constant Y; map height to Bedrock Y-up.
    return round_vec([position[0] - center_x, position[2] - min_z, depth])


def triangle_normal(
    positions: list[list[float]], i0: int, i1: int, i2: int, reverse: bool = False
) -> list[float]:
    p0, p1, p2 = positions[i0], positions[i1], positions[i2]
    edge_a = [p1[index] - p0[index] for index in range(3)]
    edge_b = [p2[index] - p0[index] for index in range(3)]
    if reverse:
        edge_a, edge_b = edge_b, edge_a
    return round_vec(normalize(cross(edge_a, edge_b)))


def build_poly(
    positions: list[list[float]],
    poly: list[list[int]],
    normals: list[list[float]],
    normal_map: dict[tuple[float, float, float], int],
    reverse: bool,
) -> list[list[int]]:
    i0, i1, i2 = poly[0][0], poly[1][0], poly[2][0]
    normal = triangle_normal(positions, i0, i1, i2, reverse=reverse)
    key = tuple(normal)
    if key not in normal_map:
        normal_map[key] = len(normals)
        normals.append(normal)
    normal_index = normal_map[key]
    return [
        [i0, normal_index, poly[0][2]],
        [i1, normal_index, poly[1][2]],
        [i2, normal_index, poly[2][2]],
        [i0, normal_index, poly[0][2]],
    ]


def is_wood_vertex(flat_x: float, flat_y: float) -> bool:
    # Horizontal beam, end caps, and top pole hardware sit behind the cloth.
    if flat_y >= 63.5:
        return True
    if flat_x <= -17.0 and flat_y >= 60.0:
        return True
    if flat_x >= 17.0 and flat_y >= 63.0:
        return True
    return False


def classify_vertices(
    positions_src: list[list[float]], center_x: float, min_z: float
) -> list[bool]:
    wood_flags: list[bool] = []
    for position in positions_src:
        flat_x = position[0] - center_x
        flat_y = position[2] - min_z
        wood_flags.append(is_wood_vertex(flat_x, flat_y))
    return wood_flags


def poly_kind(indices: list[int], wood_flags: list[bool]) -> str:
    wood_count = sum(1 for index in indices if wood_flags[index])
    if wood_count == len(indices):
        return "wood"
    if wood_count == 0:
        return "cloth"
    return "mixed"


def convert(source_path: Path) -> dict:
    with source_path.open(encoding="utf-8") as handle:
        source = json.load(handle)

    source_geometry = source["minecraft:geometry"][0]
    source_bone = source_geometry["bones"][-1]
    source_mesh = source_bone["poly_mesh"]

    positions_src = source_mesh["positions"]
    uvs = source_mesh["uvs"]
    polys_src = source_mesh["polys"]

    xs = [position[0] for position in positions_src]
    zs = [position[2] for position in positions_src]
    min_z = min(zs)
    center_x = (min(xs) + max(xs)) / 2

    wood_flags = classify_vertices(positions_src, center_x, min_z)
    positions = [
        transform_position(position, center_x, min_z, WOOD_Z if is_wood else CLOTH_Z)
        for position, is_wood in zip(positions_src, wood_flags, strict=True)
    ]
    height = max(position[1] for position in positions)

    normals: list[list[float]] = []
    normal_map: dict[tuple[float, float, float], int] = {}
    polys: list[list[list[int]]] = []
    stats = defaultdict(int)

    for poly in polys_src:
        indices = [corner[0] for corner in poly[:3]]
        kind = poly_kind(indices, wood_flags)

        if kind == "mixed":
            # Border triangles belong to the cloth layer so art stays continuous up front.
            kind = "cloth"
            stats["mixed_as_cloth"] += 1

        if kind == "cloth":
            polys.append(build_poly(positions, poly, normals, normal_map, reverse=False))
            polys.append(build_poly(positions, poly, normals, normal_map, reverse=True))
            stats["cloth"] += 2
            continue

        front = build_poly(positions, poly, normals, normal_map, reverse=False)
        back = build_poly(positions, poly, normals, normal_map, reverse=True)
        front_normal = normals[front[0][1]]
        back_normal = normals[back[0][1]]

        # Keep only the face pointing away from the viewer standing in front (+Z).
        if front_normal[2] < 0:
            polys.append(front)
            stats["wood_back"] += 1
        elif back_normal[2] < 0:
            polys.append(back)
            stats["wood_back"] += 1
        else:
            stats["wood_skipped"] += 1

    print(
        "poly layers:",
        dict(stats),
        f"wood verts {sum(wood_flags)}/{len(wood_flags)}",
    )

    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [
            {
                "description": {
                    "identifier": "geometry.kingdoms_flag",
                    "texture_width": 512,
                    "texture_height": 512,
                    "visible_bounds_width": 3,
                    "visible_bounds_height": max(3, round(height / 16, 2)),
                    "visible_bounds_offset": [0, round(height / 32, 3), 0],
                },
                "bones": [
                    {
                        "name": "flag",
                        "pivot": [0, 0, 0],
                        "poly_mesh": {
                            "normalized_uvs": True,
                            "positions": positions,
                            "normals": normals,
                            "uvs": uvs,
                            "polys": polys,
                        },
                    }
                ],
            }
        ],
    }


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    source_path = Path(
        sys.argv[1]
        if len(sys.argv) > 1
        else "/home/ubuntu/.cursor/projects/workspace/uploads/model.geo_49b2.json"
    )
    output_path = Path(
        sys.argv[2] if len(sys.argv) > 2 else root / "resource_pack/models/blocks/kingdom_flag.geo.json"
    )

    geometry = convert(source_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(geometry, handle, indent=2)
        handle.write("\n")

    mesh = geometry["minecraft:geometry"][0]["bones"][0]["poly_mesh"]
    print(
        f"Wrote {output_path.name}: "
        f"{len(mesh['positions'])} verts, {len(mesh['normals'])} normals, {len(mesh['polys'])} polys"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
