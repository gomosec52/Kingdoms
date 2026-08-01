import { BlockPermutation, system } from "@minecraft/server";
import {
  chunkKey,
  getAllSettlementChunkKeys,
  parseChunkKey
} from "./territory.js";

export const TERRITORY_BORDER_BLOCK = "kingdoms:territory_border";
const BORDER_OPS_PER_TICK = 96;
const REFRESH_DEFER_TICKS = 20;

/** @type {object | undefined} */
let deps;

/** @type {Map<number, { settlementId: number, phase: string, clearIndex: number, placeIndex: number, oldBlocks: string[], positions: { x: number, z: number, axis: string }[], placed: string[], surfaceCache: Map<string, number> }>} */
const refreshJobs = new Map();
let refreshPumpScheduled = false;

export function bindTerritoryBorderSystem(world, dependencies) {
  deps = dependencies;

  world.beforeEvents?.playerBreakBlock?.subscribe((event) => {
    if (event.block?.typeId === TERRITORY_BORDER_BLOCK) event.cancel = true;
  });
}

function findSurfaceY(dimension, x, z, hintY, surfaceCache) {
  const cacheKey = `${x},${z}`;
  if (surfaceCache?.has(cacheKey)) return surfaceCache.get(cacheKey);

  const start = Math.min(Math.floor(hintY) + 8, 320);
  const end = Math.max(Math.floor(hintY) - 8, -64);

  for (let y = start; y >= end; y -= 1) {
    try {
      const below = dimension.getBlock({ x, y: y - 1, z });
      const at = dimension.getBlock({ x, y, z });
      if (!below || !at) continue;
      if (below.typeId === "minecraft:air" || below.typeId === "minecraft:water" || below.typeId === "minecraft:flowing_water") continue;
      if (at.typeId === "minecraft:air" || at.typeId === TERRITORY_BORDER_BLOCK) {
        surfaceCache?.set(cacheKey, y);
        return y;
      }
    } catch (_error) {
      // Keep scanning.
    }
  }

  const fallback = Math.floor(hintY);
  surfaceCache?.set(cacheKey, fallback);
  return fallback;
}

function removeBorderBlockAt(dimension, x, y, z) {
  try {
    const block = dimension.getBlock({ x, y, z });
    if (block?.typeId === TERRITORY_BORDER_BLOCK) {
      block.setPermutation(BlockPermutation.resolve("minecraft:air"));
      return true;
    }
  } catch (_error) {
    // Chunk may be unloaded.
  }
  return false;
}

export function clearSettlementBorders(settlement) {
  const dimension = deps?.safeDimension?.(settlement?.dimensionId);
  if (!dimension) return;

  if (Array.isArray(settlement.borderBlocks)) {
    for (const entry of settlement.borderBlocks) {
      const [x, y, z] = entry.split(",").map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      removeBorderBlockAt(dimension, x, y, z);
    }
  }
  settlement.borderBlocks = [];
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

function canPlaceBorderBlock(block) {
  if (!block) return false;
  return block.typeId === "minecraft:air" || block.typeId === TERRITORY_BORDER_BLOCK;
}

function getSettlementForJob(settlementId) {
  const data = deps?.loadData?.();
  return data ? deps?.getSettlement?.(data, settlementId) : undefined;
}

function finishRefreshJob(job) {
  const settlement = getSettlementForJob(job.settlementId);
  if (settlement) settlement.borderBlocks = job.placed;
  refreshJobs.delete(job.settlementId);
}

function processRefreshJobs() {
  refreshPumpScheduled = false;
  if (!refreshJobs.size) return;

  let budget = BORDER_OPS_PER_TICK;
  for (const job of refreshJobs.values()) {
    const settlement = getSettlementForJob(job.settlementId);
    if (!settlement) {
      refreshJobs.delete(job.settlementId);
      continue;
    }

    const dimension = deps?.safeDimension?.(settlement.dimensionId);
    if (!dimension) {
      refreshJobs.delete(job.settlementId);
      continue;
    }

    if (job.phase === "clear") {
      while (job.clearIndex < job.oldBlocks.length && budget > 0) {
        const entry = job.oldBlocks[job.clearIndex];
        job.clearIndex += 1;
        budget -= 1;
        const [x, y, z] = entry.split(",").map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        removeBorderBlockAt(dimension, x, y, z);
      }
      if (job.clearIndex >= job.oldBlocks.length) {
        settlement.borderBlocks = [];
        job.phase = "place";
      }
      continue;
    }

    const hintY = settlement.flag?.y ?? 64;
    while (job.placeIndex < job.positions.length && budget > 0) {
      const { x, z, axis } = job.positions[job.placeIndex];
      job.placeIndex += 1;
      budget -= 1;
      const y = findSurfaceY(dimension, x, z, hintY, job.surfaceCache);
      try {
        const block = dimension.getBlock({ x, y, z });
        if (!canPlaceBorderBlock(block)) continue;
        block.setPermutation(BlockPermutation.resolve(TERRITORY_BORDER_BLOCK, {
          "kingdoms:stripe_axis": axis
        }));
        job.placed.push(`${x},${y},${z}`);
      } catch (_error) {
        // Skip blocked or unloaded positions.
      }
    }

    if (job.placeIndex >= job.positions.length) finishRefreshJob(job);
  }

  if (refreshJobs.size > 0) scheduleRefreshPump();
}

function scheduleRefreshPump() {
  if (refreshPumpScheduled) return;
  refreshPumpScheduled = true;
  system.runTimeout(processRefreshJobs, 1);
}

function queueSettlementBorderRefresh(settlement) {
  if (!settlement?.id || !deps) return;

  const oldBlocks = Array.isArray(settlement.borderBlocks) ? [...settlement.borderBlocks] : [];
  refreshJobs.set(settlement.id, {
    settlementId: settlement.id,
    phase: "clear",
    clearIndex: 0,
    placeIndex: 0,
    oldBlocks,
    positions: computeBorderPositions(settlement),
    placed: [],
    surfaceCache: new Map()
  });
  scheduleRefreshPump();
}

/** @deprecated Prefer scheduleRefreshSettlementBorders — sync path kept for startup only. */
export function refreshSettlementBorders(data, settlement) {
  if (!settlement || !deps) return;
  queueSettlementBorderRefresh(settlement);
}

export function scheduleRefreshSettlementBorders(data, settlement) {
  if (!settlement) return;
  const settlementId = settlement.id;
  system.runTimeout(() => {
    const freshData = deps?.loadData?.() ?? data;
    const freshSettlement = deps?.getSettlement?.(freshData, settlementId) ?? settlement;
    if (freshSettlement) queueSettlementBorderRefresh(freshSettlement);
  }, REFRESH_DEFER_TICKS);
}

export function scheduleRefreshAllSettlementBorders(data) {
  system.runTimeout(() => {
    const freshData = deps?.loadData?.() ?? data;
    for (const settlement of freshData.settlements) {
      queueSettlementBorderRefresh(settlement);
    }
  }, REFRESH_DEFER_TICKS);
}
