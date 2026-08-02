const CHUNK_SIZE = 16;
export const MIN_CAPTURE_TYPE_INDEX = 1;
export const KINGDOM_TYPE_INDEX = 5;
export const CHUNK_CAPTURE_COST_COPPER = 10;

/** Max extra captured chunks per settlement type (index 0 = village base, no capture). */
export const CAPTURE_LIMITS_BY_TYPE = [
  0,
  5,
  15,
  30,
  60,
  100,
  150
];

/** @deprecated use getMaxCapturedChunks */
export const MAX_EMPIRE_CAPTURED_CHUNKS = CAPTURE_LIMITS_BY_TYPE[6];
/** @deprecated use MIN_CAPTURE_TYPE_INDEX */
export const EMPIRE_TYPE_INDEX = 6;

export function canCaptureChunksType(settlement) {
  return settlement.typeIndex >= MIN_CAPTURE_TYPE_INDEX;
}

export function getMaxCapturedChunks(settlement) {
  return CAPTURE_LIMITS_BY_TYPE[settlement.typeIndex] ?? 0;
}

export function chunkCaptureCostsCoins(settlement) {
  return settlement.typeIndex < KINGDOM_TYPE_INDEX;
}

export function getChunkCaptureCostCopper(settlement) {
  return chunkCaptureCostsCoins(settlement) ? CHUNK_CAPTURE_COST_COPPER : 0;
}

export function chunkFromLocation(location) {
  return {
    cx: Math.floor(location.x / CHUNK_SIZE),
    cz: Math.floor(location.z / CHUNK_SIZE)
  };
}

export function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

export function parseChunkKey(key) {
  const [cx, cz] = String(key).split(",").map(Number);
  return { cx, cz };
}

export function chunkNeighbors(cx, cz) {
  return [
    { cx: cx + 1, cz },
    { cx: cx - 1, cz },
    { cx, cz: cz + 1 },
    { cx, cz: cz - 1 }
  ];
}

export function chunksInRadius(center, radiusBlocks) {
  const keys = new Set();
  const minCx = Math.floor((center.x - radiusBlocks) / CHUNK_SIZE);
  const maxCx = Math.floor((center.x + radiusBlocks) / CHUNK_SIZE);
  const minCz = Math.floor((center.z - radiusBlocks) / CHUNK_SIZE);
  const maxCz = Math.floor((center.z + radiusBlocks) / CHUNK_SIZE);

  for (let cx = minCx; cx <= maxCx; cx += 1) {
    for (let cz = minCz; cz <= maxCz; cz += 1) {
      const chunkCenterX = cx * CHUNK_SIZE + 8;
      const chunkCenterZ = cz * CHUNK_SIZE + 8;
      const dx = chunkCenterX - center.x;
      const dz = chunkCenterZ - center.z;
      if (Math.sqrt(dx * dx + dz * dz) <= radiusBlocks + 8) {
        keys.add(chunkKey(cx, cz));
      }
    }
  }
  return [...keys];
}

export function ensureSettlementChunks(settlement, radiusBlocks) {
  if (!Array.isArray(settlement.chunks) || !settlement.chunks.length) {
    settlement.chunks = chunksInRadius(settlement.flag, radiusBlocks);
  }
  if (!Array.isArray(settlement.capturedChunks)) settlement.capturedChunks = [];
}

export function getAllSettlementChunkKeys(settlement) {
  const keys = new Set(settlement.chunks || []);
  for (const key of settlement.capturedChunks || []) keys.add(key);
  return keys;
}

export function countCapturedChunks(settlement) {
  return Array.isArray(settlement.capturedChunks) ? settlement.capturedChunks.length : 0;
}

export function ownsChunk(settlement, cx, cz) {
  const key = chunkKey(cx, cz);
  return (settlement.chunks || []).includes(key) || (settlement.capturedChunks || []).includes(key);
}

export function findSettlementOwningChunk(data, dimensionId, cx, cz, ignoreSettlementId) {
  for (const settlement of data.settlements) {
    if (settlement.id === ignoreSettlementId) continue;
    if (settlement.dimensionId !== dimensionId) continue;
    if (ownsChunk(settlement, cx, cz)) return settlement;
  }
  return undefined;
}

export function findSettlementAtLocation(data, location, dimensionId) {
  const { cx, cz } = chunkFromLocation(location);
  return findSettlementOwningChunk(data, dimensionId, cx, cz);
}

export function chunkOverlapAt(data, dimensionId, chunkKeys, ignoreSettlementId, alliedAllianceId) {
  for (const key of chunkKeys) {
    const { cx, cz } = parseChunkKey(key);
    for (const settlement of data.settlements) {
      if (settlement.id === ignoreSettlementId) continue;
      if (settlement.dimensionId !== dimensionId) continue;
      if (alliedAllianceId && settlement.allianceId === alliedAllianceId) continue;
      if (ownsChunk(settlement, cx, cz)) return settlement;
    }
  }
  return undefined;
}

export function getTerritoryChunkCount(settlement) {
  return getAllSettlementChunkKeys(settlement).size;
}

export function getTerritoryRadiusDisplay(settlement, typeRadius, territoryBonus = 0) {
  const chunkCount = getTerritoryChunkCount(settlement);
  return `${chunkCount} чанк(ов)`;
}

export function expandTerritoryOnVictory(data, winner, loser) {
  ensureSettlementChunks(winner, 0);
  ensureSettlementChunks(loser, 0);

  const winnerKeys = getAllSettlementChunkKeys(winner);
  const loserKeys = getAllSettlementChunkKeys(loser);
  const additions = new Set();

  for (const key of loserKeys) {
    const { cx, cz } = parseChunkKey(key);
    for (const neighbor of chunkNeighbors(cx, cz)) {
      const nKey = chunkKey(neighbor.cx, neighbor.cz);
      if (winnerKeys.has(nKey) || loserKeys.has(nKey)) continue;
      if (findSettlementOwningChunk(data, winner.dimensionId, neighbor.cx, neighbor.cz, winner.id)) continue;

      let touchesWinner = false;
      for (const nn of chunkNeighbors(neighbor.cx, neighbor.cz)) {
        if (winnerKeys.has(chunkKey(nn.cx, nn.cz))) {
          touchesWinner = true;
          break;
        }
      }
      if (touchesWinner) additions.add(nKey);
    }
  }

  if (!additions.size) return 0;

  if (!Array.isArray(winner.chunks)) winner.chunks = [];
  for (const key of additions) {
    if (!winnerKeys.has(key)) winner.chunks.push(key);
  }
  return additions.size;
}

function computeUpgradeTerritory(data, settlement, newRadius) {
  ensureSettlementChunks(settlement, 0);
  const idealNew = chunksInRadius(settlement.flag, newRadius);
  const nextChunks = new Set(settlement.chunks || []);
  let blocked = 0;

  for (const key of idealNew) {
    const { cx, cz } = parseChunkKey(key);
    if (findSettlementOwningChunk(data, settlement.dimensionId, cx, cz, settlement.id)) {
      blocked += 1;
      continue;
    }
    nextChunks.add(key);
  }

  let addedAdjacent = 0;
  if (blocked > 0) {
    let frontier = [...nextChunks];
    const tried = new Set(nextChunks);

    while (addedAdjacent < blocked) {
      let found = false;
      const nextFrontier = [];

      for (const key of frontier) {
        const { cx, cz } = parseChunkKey(key);
        for (const neighbor of chunkNeighbors(cx, cz)) {
          const nKey = chunkKey(neighbor.cx, neighbor.cz);
          if (tried.has(nKey)) continue;
          tried.add(nKey);
          if (findSettlementOwningChunk(data, settlement.dimensionId, neighbor.cx, neighbor.cz, settlement.id)) continue;

          nextChunks.add(nKey);
          nextFrontier.push(nKey);
          addedAdjacent += 1;
          found = true;
          if (addedAdjacent >= blocked) break;
        }
        if (addedAdjacent >= blocked) break;
      }

      if (!found) break;
      frontier = nextFrontier;
    }
  }

  return { blocked, addedAdjacent, nextChunks: [...nextChunks] };
}

export function previewUpgradeTerritory(data, settlement, newRadius) {
  const { blocked, addedAdjacent } = computeUpgradeTerritory(data, settlement, newRadius);
  return { blocked, addedAdjacent };
}

export function applyUpgradeTerritory(data, settlement, newRadius) {
  const { blocked, addedAdjacent, nextChunks } = computeUpgradeTerritory(data, settlement, newRadius);
  settlement.chunks = nextChunks;
  return { blocked, addedAdjacent };
}

export function canCaptureChunk(data, settlement, cx, cz) {
  if (!canCaptureChunksType(settlement)) {
    return "§cЗахват чанков доступен после улучшения поселения.";
  }
  if (ownsChunk(settlement, cx, cz)) {
    return "§cЭтот чанк уже принадлежит вашему поселению.";
  }
  if (findSettlementOwningChunk(data, settlement.dimensionId, cx, cz, settlement.id)) {
    return "§cЭтот чанк принадлежит другому поселению.";
  }
  const maxCaptured = getMaxCapturedChunks(settlement);
  if (countCapturedChunks(settlement) >= maxCaptured) {
    return `§cЛимит захвата: ${maxCaptured} чанков.`;
  }

  let touchesOwn = false;
  for (const neighbor of chunkNeighbors(cx, cz)) {
    if (ownsChunk(settlement, neighbor.cx, neighbor.cz)) {
      touchesOwn = true;
      break;
    }
  }
  if (!touchesOwn) {
    return "§cМожно захватывать только чанки, соседние с вашей территорией.";
  }

  return undefined;
}

export function captureChunk(settlement, cx, cz) {
  const key = chunkKey(cx, cz);
  if (!Array.isArray(settlement.capturedChunks)) settlement.capturedChunks = [];
  if (!settlement.capturedChunks.includes(key)) settlement.capturedChunks.push(key);
}

export function isCapturedChunk(settlement, cx, cz) {
  return (settlement.capturedChunks || []).includes(chunkKey(cx, cz));
}

/** Allows placing a marker on an already captured chunk (e.g. after the flag was broken). */
export function canPlaceChunkMarker(data, settlement, cx, cz) {
  if (isCapturedChunk(settlement, cx, cz)) return undefined;
  return canCaptureChunk(data, settlement, cx, cz);
}

export function releaseChunk(settlement, cx, cz) {
  const key = chunkKey(cx, cz);
  if (Array.isArray(settlement.capturedChunks)) {
    settlement.capturedChunks = settlement.capturedChunks.filter((entry) => entry !== key);
  }
}

export function loseHalfTerritoryChunks(settlement) {
  ensureSettlementChunks(settlement, 0);
  const flagChunk = chunkFromLocation(settlement.flag);
  const flagKey = chunkKey(flagChunk.cx, flagChunk.cz);
  const captured = [...(settlement.capturedChunks || [])];
  const base = [...(settlement.chunks || [])];
  const allKeys = new Set([...base, ...captured]);
  const toRemoveCount = Math.floor(allKeys.size / 2);
  if (toRemoveCount <= 0) return 0;

  const removable = [];
  for (const key of captured) {
    if (key !== flagKey) removable.push({ key, priority: 0, dist: 0 });
  }
  for (const key of base) {
    if (key === flagKey || captured.includes(key)) continue;
    const { cx, cz } = parseChunkKey(key);
    const dist = Math.hypot(cx * CHUNK_SIZE + 8 - settlement.flag.x, cz * CHUNK_SIZE + 8 - settlement.flag.z);
    removable.push({ key, priority: 1, dist });
  }

  removable.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return right.dist - left.dist;
  });

  const removed = new Set(removable.slice(0, toRemoveCount).map((entry) => entry.key));
  settlement.capturedChunks = captured.filter((key) => !removed.has(key));
  settlement.chunks = base.filter((key) => !removed.has(key));
  if (!settlement.chunks.includes(flagKey)) settlement.chunks.push(flagKey);
  return removed.size;
}

export function transferDefeatedSettlementChunks(data, winner, loser, fraction = 0.6) {
  ensureSettlementChunks(winner, 0);
  ensureSettlementChunks(loser, 0);

  const flagChunk = chunkFromLocation(loser.flag);
  const flagKey = chunkKey(flagChunk.cx, flagChunk.cz);
  const captured = [...(loser.capturedChunks || [])];
  const base = [...(loser.chunks || [])];
  const allKeys = new Set([...base, ...captured]);
  const transferCount = Math.floor(allKeys.size * fraction);
  if (transferCount <= 0) return 0;

  const transferable = [];
  for (const key of captured) {
    if (key !== flagKey) transferable.push({ key, priority: 0, dist: 0 });
  }
  for (const key of base) {
    if (key === flagKey || captured.includes(key)) continue;
    const { cx, cz } = parseChunkKey(key);
    const dist = Math.hypot(cx * CHUNK_SIZE + 8 - loser.flag.x, cz * CHUNK_SIZE + 8 - loser.flag.z);
    transferable.push({ key, priority: 1, dist });
  }

  transferable.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return right.dist - left.dist;
  });

  const toTransfer = transferable.slice(0, transferCount).map((entry) => entry.key);
  const transferSet = new Set(toTransfer);
  loser.capturedChunks = captured.filter((key) => !transferSet.has(key));
  loser.chunks = base.filter((key) => !transferSet.has(key));
  if (!loser.chunks.includes(flagKey)) loser.chunks.push(flagKey);

  if (!Array.isArray(winner.capturedChunks)) winner.capturedChunks = [];
  const winnerKeys = getAllSettlementChunkKeys(winner);
  let added = 0;
  for (const key of toTransfer) {
    const { cx, cz } = parseChunkKey(key);
    if (winnerKeys.has(key)) continue;
    if (findSettlementOwningChunk(data, winner.dimensionId, cx, cz, winner.id)) continue;
    winner.capturedChunks.push(key);
    winnerKeys.add(key);
    added += 1;
  }
  return added;
}
