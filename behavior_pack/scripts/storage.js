export const STORE_SHARD_LIMIT = 30000;
export const STORE_PROPERTY_LIMIT = 32767;

export const LEGACY_STORE_KEY = "kingdoms:data:v1";
export const META_STORE_KEY = "kingdoms:data:meta:v1";
export const GLOBAL_ALLIANCES_KEY = "kingdoms:data:global:alliances:v1";
export const GLOBAL_LOOT_KEY = "kingdoms:data:global:loot:v1";
export const GLOBAL_GUARDS_KEY = "kingdoms:data:global:guards:v1";
export const GLOBAL_WARS_KEY = "kingdoms:data:global:wars:v1";
export const GLOBAL_DIPLOMACY_KEY = "kingdoms:data:global:diplomacy:v1";
export const GLOBAL_MINTS_KEY = "kingdoms:data:global:mints:v1";
export const GLOBAL_PAYOUTS_KEY = "kingdoms:data:global:payouts:v1";
export const SETTLEMENTS_SHARD_PREFIX = "kingdoms:data:settlements:v1:";
export const MAX_SETTLEMENT_SHARDS = 64;
export const SHARD_REGISTER_BATCH = 16;

const DATA_VERSION = 2;

const GLOBAL_KEYS = [
  GLOBAL_ALLIANCES_KEY,
  GLOBAL_LOOT_KEY,
  GLOBAL_GUARDS_KEY,
  GLOBAL_WARS_KEY,
  GLOBAL_DIPLOMACY_KEY,
  GLOBAL_MINTS_KEY,
  GLOBAL_PAYOUTS_KEY,
  `${GLOBAL_PAYOUTS_KEY}:items`
];

let shardedStorageActive = false;

function settlementShardKey(index) {
  return `${SETTLEMENTS_SHARD_PREFIX}${index}`;
}

function readProperty(world, key) {
  try {
    const raw = world.getDynamicProperty(key);
    return typeof raw === "string" && raw.length ? raw : undefined;
  } catch (_error) {
    return undefined;
  }
}

function writeProperty(world, key, value) {
  try {
    if (value === undefined || value === null || value === "") {
      try {
        world.setDynamicProperty(key, undefined);
      } catch (_error) {
        world.setDynamicProperty(key, "");
      }
      return true;
    }
    world.setDynamicProperty(key, value);
    return true;
  } catch (error) {
    console.warn(`[Kingdoms] Failed to write property ${key}: ${error}`);
    return false;
  }
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label}: ${error}`);
  }
}

function readJsonArray(world, key, label) {
  const raw = readProperty(world, key);
  if (!raw) return [];
  const parsed = parseJson(raw, label);
  return Array.isArray(parsed) ? parsed : [];
}

function writeJsonArray(world, key, label, value) {
  const serialized = JSON.stringify(value ?? []);
  if (serialized.length > STORE_PROPERTY_LIMIT) {
    throw new Error(`${label} exceeds storage limit (${serialized.length}).`);
  }
  if (!writeProperty(world, key, serialized)) {
    throw new Error(`${label} write failed.`);
  }
}

function extractCounters(data) {
  return {
    nextSettlementIdValue: data.nextSettlementIdValue ?? 1,
    nextAllianceIdValue: data.nextAllianceIdValue ?? 1,
    nextSpawnGuardIdValue: data.nextSpawnGuardIdValue ?? 1,
    nextWarCampaignIdValue: data.nextWarCampaignIdValue ?? 1,
    nextMintWorkshopIdValue: data.nextMintWorkshopIdValue ?? 1,
    nextTradeOfferIdValue: data.nextTradeOfferIdValue ?? 1
  };
}

function extractGlobalPayload(data) {
  return {
    alliances: data.alliances ?? [],
    lootZones: data.lootZones ?? [],
    spawnGuards: data.spawnGuards ?? [],
    warCampaigns: data.warCampaigns ?? [],
    condemnations: data.condemnations ?? [],
    mintWorkshops: data.mintWorkshops ?? [],
    pendingPlayerPayouts: data.pendingPlayerPayouts ?? [],
    pendingPlayerItemPayouts: data.pendingPlayerItemPayouts ?? []
  };
}

function packSettlementsIntoShards(settlements) {
  const shards = [];
  let current = [];

  for (const settlement of settlements) {
    const candidate = [...current, settlement];
    const size = JSON.stringify(candidate).length;
    if (size > STORE_SHARD_LIMIT && current.length > 0) {
      shards.push(current);
      current = [settlement];
      continue;
    }
    current = candidate;
  }

  if (current.length) shards.push(current);
  if (!shards.length) shards.push([]);
  return shards;
}

function validateShardSizes(label, parts) {
  for (let index = 0; index < parts.length; index += 1) {
    const serialized = typeof parts[index] === "string" ? parts[index] : JSON.stringify(parts[index]);
    if (serialized.length > STORE_PROPERTY_LIMIT) {
      throw new Error(`${label} shard ${index} exceeds ${STORE_PROPERTY_LIMIT} chars (${serialized.length}).`);
    }
  }
}

function registerDefinition(registry, DynamicPropertiesDefinition, keys) {
  const definition = new DynamicPropertiesDefinition();
  for (const { key, maxLength } of keys) {
    definition.defineString(key, maxLength);
  }
  registry.registerWorldDynamicProperties(definition);
}

export function registerStorageProperties(registry, DynamicPropertiesDefinition) {
  if (!registry?.registerWorldDynamicProperties || typeof DynamicPropertiesDefinition !== "function") return false;

  shardedStorageActive = false;

  try {
    registerDefinition(registry, DynamicPropertiesDefinition, [
      { key: LEGACY_STORE_KEY, maxLength: STORE_PROPERTY_LIMIT }
    ]);
  } catch (error) {
    console.warn(`[Kingdoms] Legacy storage registration failed: ${error}`);
    return false;
  }

  try {
    registerDefinition(registry, DynamicPropertiesDefinition, [
      { key: META_STORE_KEY, maxLength: 2048 },
      ...GLOBAL_KEYS.map((key) => ({ key, maxLength: STORE_PROPERTY_LIMIT }))
    ]);

    for (let start = 0; start < MAX_SETTLEMENT_SHARDS; start += SHARD_REGISTER_BATCH) {
      const batch = [];
      for (let index = start; index < Math.min(start + SHARD_REGISTER_BATCH, MAX_SETTLEMENT_SHARDS); index += 1) {
        batch.push({ key: settlementShardKey(index), maxLength: STORE_PROPERTY_LIMIT });
      }
      registerDefinition(registry, DynamicPropertiesDefinition, batch);
    }

    shardedStorageActive = true;
    return true;
  } catch (error) {
    console.warn(`[Kingdoms] Sharded storage registration failed, using legacy fallback: ${error}`);
    return true;
  }
}

function loadGlobalWorldData(world) {
  return {
    alliances: readJsonArray(world, GLOBAL_ALLIANCES_KEY, "alliances"),
    lootZones: readJsonArray(world, GLOBAL_LOOT_KEY, "lootZones"),
    spawnGuards: readJsonArray(world, GLOBAL_GUARDS_KEY, "spawnGuards"),
    warCampaigns: readJsonArray(world, GLOBAL_WARS_KEY, "warCampaigns"),
    condemnations: readJsonArray(world, GLOBAL_DIPLOMACY_KEY, "condemnations"),
    mintWorkshops: readJsonArray(world, GLOBAL_MINTS_KEY, "mintWorkshops"),
    pendingPlayerPayouts: readJsonArray(world, GLOBAL_PAYOUTS_KEY, "pendingPlayerPayouts"),
    pendingPlayerItemPayouts: readJsonArray(world, `${GLOBAL_PAYOUTS_KEY}:items`, "pendingPlayerItemPayouts")
  };
}

function loadLegacyWorldData(world) {
  const legacyRaw = readProperty(world, LEGACY_STORE_KEY);
  if (!legacyRaw) return undefined;

  try {
    const legacy = parseJson(legacyRaw, "legacy");
    legacy.__legacyMigrationPending = false;
    return legacy;
  } catch (error) {
    console.warn(`[Kingdoms] Legacy load failed: ${error}`);
    return undefined;
  }
}

function loadShardedWorldData(world) {
  const metaRaw = readProperty(world, META_STORE_KEY);
  if (!metaRaw) return undefined;

  try {
    const meta = parseJson(metaRaw, "meta");
    const shardCount = Math.max(0, Math.min(Number(meta.settlementShardCount) || 0, MAX_SETTLEMENT_SHARDS));
    const settlements = [];

    for (let index = 0; index < shardCount; index += 1) {
      const shardRaw = readProperty(world, settlementShardKey(index));
      if (!shardRaw) continue;
      const shard = parseJson(shardRaw, `settlements:${index}`);
      if (Array.isArray(shard)) settlements.push(...shard);
    }

    const expectedSettlements = shardCount > 0;
    if (expectedSettlements && settlements.length === 0) {
      console.warn("[Kingdoms] Sharded meta present but settlement shards are empty.");
      return undefined;
    }

    const global = loadGlobalWorldData(world);
    return {
      version: DATA_VERSION,
      ...extractCounters(meta),
      settlements,
      ...global
    };
  } catch (error) {
    console.warn(`[Kingdoms] Sharded load failed: ${error}`);
    return undefined;
  }
}

export function loadWorldData(world) {
  const sharded = shardedStorageActive ? loadShardedWorldData(world) : undefined;
  if (sharded) return sharded;

  const legacy = loadLegacyWorldData(world);
  if (legacy) {
    if (shardedStorageActive && readProperty(world, META_STORE_KEY)) {
      legacy.__legacyMigrationPending = true;
    }
    return legacy;
  }

  return undefined;
}

function saveLegacyWorldData(world, data) {
  const payload = { ...data, version: DATA_VERSION };
  delete payload.__legacyMigrationPending;
  const serialized = JSON.stringify(payload);
  if (serialized.length > STORE_PROPERTY_LIMIT) {
    throw new Error(`Legacy storage overflow (${serialized.length}).`);
  }
  if (!writeProperty(world, LEGACY_STORE_KEY, serialized)) {
    throw new Error("Legacy storage write failed.");
  }
  return { mode: "legacy", bytes: serialized.length };
}

function saveShardedWorldData(world, data) {
  const payload = { ...data, version: DATA_VERSION };
  delete payload.__legacyMigrationPending;
  const counters = extractCounters(payload);
  const globalPayload = extractGlobalPayload(payload);
  const settlementShards = packSettlementsIntoShards(payload.settlements ?? []);

  if (settlementShards.length > MAX_SETTLEMENT_SHARDS) {
    throw new Error(`Settlement shard limit exceeded (${settlementShards.length}/${MAX_SETTLEMENT_SHARDS}).`);
  }

  const shardSerialized = settlementShards.map((shard) => JSON.stringify(shard));
  validateShardSizes("settlements", shardSerialized);

  const meta = {
    version: DATA_VERSION,
    settlementShardCount: settlementShards.length,
    ...counters
  };
  const metaSerialized = JSON.stringify(meta);
  if (metaSerialized.length > 2048) {
    throw new Error("Meta storage overflow.");
  }

  const metaRaw = readProperty(world, META_STORE_KEY);
  let previousShardCount = 0;
  if (metaRaw) {
    try {
      previousShardCount = Number(parseJson(metaRaw, "meta").settlementShardCount) || 0;
    } catch (_error) {
      previousShardCount = 0;
    }
  }

  saveGlobalWorldData(world, globalPayload);

  for (let index = 0; index < settlementShards.length; index += 1) {
    if (!writeProperty(world, settlementShardKey(index), shardSerialized[index])) {
      throw new Error(`Failed to write settlement shard ${index}.`);
    }
  }

  const oldShardCount = Math.max(previousShardCount, settlementShards.length);
  for (let index = settlementShards.length; index < oldShardCount; index += 1) {
    writeProperty(world, settlementShardKey(index), undefined);
  }

  if (!writeProperty(world, META_STORE_KEY, metaSerialized)) {
    throw new Error("Failed to write storage meta.");
  }

  return {
    mode: "sharded",
    settlementShards: settlementShards.length,
    settlementCount: (payload.settlements ?? []).length
  };
}

function saveGlobalWorldData(world, globalPayload) {
  writeJsonArray(world, GLOBAL_ALLIANCES_KEY, "alliances", globalPayload.alliances);
  writeJsonArray(world, GLOBAL_LOOT_KEY, "lootZones", globalPayload.lootZones);
  writeJsonArray(world, GLOBAL_GUARDS_KEY, "spawnGuards", globalPayload.spawnGuards);
  writeJsonArray(world, GLOBAL_WARS_KEY, "warCampaigns", globalPayload.warCampaigns);
  writeJsonArray(world, GLOBAL_DIPLOMACY_KEY, "condemnations", globalPayload.condemnations);
  writeJsonArray(world, GLOBAL_MINTS_KEY, "mintWorkshops", globalPayload.mintWorkshops);
  writeJsonArray(world, GLOBAL_PAYOUTS_KEY, "pendingPlayerPayouts", globalPayload.pendingPlayerPayouts);
  writeJsonArray(world, `${GLOBAL_PAYOUTS_KEY}:items`, "pendingPlayerItemPayouts", globalPayload.pendingPlayerItemPayouts);
}

export function saveWorldData(world, data) {
  const payload = { ...data, version: DATA_VERSION };
  delete payload.__legacyMigrationPending;
  const legacySerialized = JSON.stringify(payload);
  const legacyFits = legacySerialized.length <= STORE_PROPERTY_LIMIT;

  if (shardedStorageActive) {
    try {
      const result = saveShardedWorldData(world, data);
      if (legacyFits) {
        writeProperty(world, LEGACY_STORE_KEY, legacySerialized);
      } else {
        writeProperty(world, LEGACY_STORE_KEY, undefined);
      }
      return result;
    } catch (error) {
      console.warn(`[Kingdoms] Sharded save failed: ${error}`);
      if (legacyFits) {
        return saveLegacyWorldData(world, data);
      }
      throw error;
    }
  }

  return saveLegacyWorldData(world, data);
}

export function getStorageStats(world) {
  const metaRaw = readProperty(world, META_STORE_KEY);
  const legacyRaw = readProperty(world, LEGACY_STORE_KEY);

  if (!metaRaw) {
    return {
      mode: legacyRaw ? "legacy" : "empty",
      legacyBytes: legacyRaw?.length ?? 0,
      shardedActive: shardedStorageActive
    };
  }

  const meta = parseJson(metaRaw, "meta");
  let settlementBytes = 0;
  for (let index = 0; index < (meta.settlementShardCount || 0); index += 1) {
    settlementBytes += readProperty(world, settlementShardKey(index))?.length ?? 0;
  }

  let globalBytes = 0;
  for (const key of GLOBAL_KEYS) {
    globalBytes += readProperty(world, key)?.length ?? 0;
  }

  return {
    mode: "sharded",
    settlementShards: meta.settlementShardCount ?? 0,
    settlementBytes,
    globalBytes,
    metaBytes: metaRaw.length,
    legacyBytes: legacyRaw?.length ?? 0,
    totalBytes: settlementBytes + globalBytes + metaRaw.length,
    shardedActive: shardedStorageActive
  };
}

export function isShardedStorageActive() {
  return shardedStorageActive;
}
