const CHUNK_SIZE = 16;
export const MAX_EMPIRE_CAPTURED_CHUNKS = 100;
export const EMPIRE_TYPE_INDEX = 6;

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

export function canCaptureChunk(data, settlement, cx, cz) {
  if (settlement.typeIndex < EMPIRE_TYPE_INDEX) {
    return "§cЗахват чанков доступен только Империи.";
  }
  if (ownsChunk(settlement, cx, cz)) {
    return "§cЭтот чанк уже принадлежит вашему поселению.";
  }
  if (findSettlementOwningChunk(data, settlement.dimensionId, cx, cz, settlement.id)) {
    return "§cЭтот чанк принадлежит другому поселению.";
  }
  if (countCapturedChunks(settlement) >= MAX_EMPIRE_CAPTURED_CHUNKS) {
    return `§cЛимит захвата: ${MAX_EMPIRE_CAPTURED_CHUNKS} чанков.`;
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

export function releaseChunk(settlement, cx, cz) {
  const key = chunkKey(cx, cz);
  if (Array.isArray(settlement.capturedChunks)) {
    settlement.capturedChunks = settlement.capturedChunks.filter((entry) => entry !== key);
  }
}
