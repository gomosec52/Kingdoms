import { BlockPermutation, system } from "@minecraft/server";
import {
  chunkKey,
  getAllSettlementChunkKeys,
  parseChunkKey
} from "./territory.js";

export const TERRITORY_BORDER_BLOCK = "kingdoms:territory_border";

/** @type {object | undefined} */
let deps;

export function bindTerritoryBorderSystem(world, dependencies) {
  deps = dependencies;

  world.beforeEvents?.playerBreakBlock?.subscribe((event) => {
    if (event.block?.typeId === TERRITORY_BORDER_BLOCK) event.cancel = true;
  });
}

export function clearSettlementBorders(settlement) {
  const dimension = deps?.safeDimension?.(settlement?.dimensionId);
  if (!dimension || !Array.isArray(settlement?.borderBlocks)) return;

  for (const entry of settlement.borderBlocks) {
    const [x, y, z] = entry.split(",").map(Number);
    try {
      const block = dimension.getBlock({ x, y, z });
      if (block?.typeId === TERRITORY_BORDER_BLOCK) {
        block.setPermutation(BlockPermutation.resolve("minecraft:air"));
      }
    } catch (_error) {
      // Ignore stale border cleanup failures.
    }
  }
  settlement.borderBlocks = [];
}

function findSurfaceY(dimension, x, z, hintY) {
  const start = Math.min(Math.floor(hintY) + 24, 320);
  const end = Math.max(Math.floor(hintY) - 24, -64);

  for (let y = start; y >= end; y -= 1) {
    try {
      const below = dimension.getBlock({ x, y: y - 1, z });
      const at = dimension.getBlock({ x, y, z });
      if (!below || !at) continue;
      if (below.typeId === "minecraft:air" || below.typeId === "minecraft:water" || below.typeId === "minecraft:flowing_water") continue;
      if (at.typeId === "minecraft:air" || at.typeId === TERRITORY_BORDER_BLOCK) return y;
    } catch (_error) {
      // Keep scanning.
    }
  }

  return Math.floor(hintY);
}

function computeBorderPositions(settlement) {
  const keys = getAllSettlementChunkKeys(settlement);
  const owned = new Set(keys);
  /** @type {Map<string, { x: number, z: number, axis: "x" | "z" }>} */
  const seen = new Map();

  for (const key of keys) {
    const { cx, cz } = parseChunkKey(key);
    const edges = [
      { nx: cx, nz: cz - 1, x0: cx * 16, z0: cz * 16, dx: 1, dz: 0, len: 16, axis: "x" },
      { nx: cx, nz: cz + 1, x0: cx * 16, z0: cz * 16 + 15, dx: 1, dz: 0, len: 16, axis: "x" },
      { nx: cx - 1, nz: cz, x0: cx * 16, z0: cz * 16, dx: 0, dz: 1, len: 16, axis: "z" },
      { nx: cx + 1, nz: cz, x0: cx * 16 + 15, z0: cz * 16, dx: 0, dz: 1, len: 16, axis: "z" }
    ];

    for (const edge of edges) {
      if (owned.has(chunkKey(edge.nx, edge.nz))) continue;
      for (let i = 0; i < edge.len; i += 1) {
        const x = edge.x0 + edge.dx * i;
        const z = edge.z0 + edge.dz * i;
        const posKey = `${x},${z}`;
        if (!seen.has(posKey)) seen.set(posKey, { x, z, axis: edge.axis });
      }
    }
  }

  return [...seen.values()];
}

export function refreshSettlementBorders(data, settlement) {
  if (!settlement || !deps) return;

  const dimension = deps.safeDimension(settlement.dimensionId);
  if (!dimension) return;

  clearSettlementBorders(settlement);
  if (!Array.isArray(settlement.borderBlocks)) settlement.borderBlocks = [];

  const hintY = settlement.flag?.y ?? 64;
  const placed = [];

  for (const { x, z, axis } of computeBorderPositions(settlement)) {
    const y = findSurfaceY(dimension, x, z, hintY);
    try {
      const block = dimension.getBlock({ x, y, z });
      if (!block || block.typeId !== "minecraft:air") continue;
      block.setPermutation(BlockPermutation.resolve(TERRITORY_BORDER_BLOCK, {
        "kingdoms:stripe_axis": axis
      }));
      placed.push(`${x},${y},${z}`);
    } catch (_error) {
      // Skip blocked positions.
    }
  }

  settlement.borderBlocks = placed;
  if (typeof deps.saveData === "function") deps.saveData(data);
}

export function scheduleRefreshSettlementBorders(data, settlement) {
  if (!settlement) return;
  system.run(() => {
    const freshData = deps?.loadData?.() ?? data;
    const freshSettlement = deps?.getSettlement?.(freshData, settlement.id) ?? settlement;
    if (freshSettlement) refreshSettlementBorders(freshData, freshSettlement);
  });
}

export function scheduleRefreshAllSettlementBorders(data) {
  system.run(() => {
    const freshData = deps?.loadData?.() ?? data;
    for (const settlement of freshData.settlements) {
      refreshSettlementBorders(freshData, settlement);
    }
  });
}
