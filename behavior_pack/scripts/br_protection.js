/** Bedrock Reimagined compatibility: territory bypass fixes (quarry, TNT, chests, tombs, mob net). */

export const QUARRY_BLOCK_RADIUS = {
  "5fs_br:quarry": 6,
  "5fs_br:quarry_diamond": 8,
  "5fs_br:quarry_crystalline": 10,
  "5fs_br:quarry_netherite": 13,
  "5fs_br:quarry_dragonite": 16
};

const QUARRY_BLOCK_IDS = new Set(Object.keys(QUARRY_BLOCK_RADIUS));
const QUARRY_DUMMY_ENTITY = "5fs_br:quarry_dummy";

const BR_SLEEPING_BAG_SUFFIX = "_sleeping_bag";
const BR_MOB_NET_ITEM = "5fs_br:mob_net";

const BR_TOMB_ENTITY_IDS = new Set([
  "5fs_br:tomb_entity",
  "5fs_br:tomb"
]);

const BR_PROTECTED_INTERACT_KEYWORDS = [
  "chest",
  "barrel",
  "shulker",
  "forge",
  "grinder",
  "furnace",
  "anvil",
  "loader",
  "hopper",
  "backpack",
  "quarry",
  "machine",
  "storage",
  "cabinet",
  "drawer",
  "locker",
  "crate",
  "strongbox",
  "vault"
];

/** @type {Map<string, string>} */
const quarryOwners = new Map();

/** @type {Map<string, number>} */
const pendingGlobalWarKills = new Map();

const BR_DIMENSION_IDS = ["overworld", "nether", "the_end"];

/** @type {object | undefined} */
let deps;

function quarryKey(dimensionId, x, y, z) {
  return `${dimensionId}:${Math.floor(x)}:${Math.floor(y)}:${Math.floor(z)}`;
}

export function isQuarryBlock(blockId) {
  return QUARRY_BLOCK_IDS.has(blockId);
}

export function isBrSleepingBag(blockId) {
  return typeof blockId === "string"
    && blockId.startsWith("5fs_br:")
    && blockId.endsWith(BR_SLEEPING_BAG_SUFFIX);
}

export function isBrTombEntity(typeId) {
  return BR_TOMB_ENTITY_IDS.has(typeId);
}

export function isBrMobNetItem(typeId) {
  return typeId === BR_MOB_NET_ITEM;
}

export function isBrProtectedInteractBlock(blockId, vanillaProtectedIds = []) {
  if (!blockId || typeof blockId !== "string") return false;
  if (vanillaProtectedIds.includes(blockId)) return true;
  if (!blockId.startsWith("5fs_br:")) return false;

  const lower = blockId.slice("5fs_br:".length);
  return BR_PROTECTED_INTERACT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function getQuarryRadius(blockId) {
  return QUARRY_BLOCK_RADIUS[blockId] ?? 6;
}

function blockCenter(location) {
  return {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  };
}

function findForeignSettlementInQuarryFootprint(data, center, dimensionId, radius, playerName) {
  const base = blockCenter(center);
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      const settlement = deps.findSettlementAt(data, { x: base.x + dx, y: base.y, z: base.z + dz }, dimensionId);
      if (settlement && !deps.hasTerritoryAccess(data, settlement, playerName)) {
        return settlement;
      }
    }
  }
  return undefined;
}

function getNearbyPlayers(dimension, location, maxDistance) {
  if (!dimension || !location) return [];
  try {
    return dimension.getPlayers({ location, maxDistance });
  } catch {
    return [];
  }
}

function playerCanAccessTerritoryAt(data, location, dimensionId, players) {
  const settlement = deps.findSettlementAt(data, location, dimensionId);
  if (!settlement) return true;
  for (const player of players) {
    if (deps.hasTerritoryAccess(data, settlement, deps.getPlayerName(player))) return true;
  }
  return false;
}

function getExplosionContextPlayers(event) {
  const dimension = event.dimension;
  const source = event.source;
  const players = [];

  if (source?.typeId === "minecraft:player") {
    players.push(source);
  }

  const anchor = source?.location ?? source?.center?.() ?? undefined;
  for (const player of getNearbyPlayers(dimension, anchor, 48)) {
    if (!players.some((entry) => entry.id === player.id)) players.push(player);
  }
  return players;
}

function filterExplosionBlocks(event, data) {
  const impacted = event.getImpactedBlocks?.() ?? event.impactedBlocks;
  if (!Array.isArray(impacted) || impacted.length === 0) return;

  const dimensionId = deps.getDimensionId(event.dimension);
  const contextPlayers = getExplosionContextPlayers(event);
  const allowed = [];

  for (const block of impacted) {
    if (!block?.isValid) continue;
    const location = block.location ?? block;
    if (playerCanAccessTerritoryAt(data, location, dimensionId, contextPlayers)) {
      allowed.push(block);
    }
  }

  if (typeof event.setImpactedBlocks === "function") {
    event.setImpactedBlocks(allowed);
  } else {
    event.impactedBlocks = allowed;
  }
}

function tryDisableQuarry(block, ownerName, reasonSettlement) {
  if (!block?.isValid || !isQuarryBlock(block.typeId)) return;

  try {
    const powered = block.permutation.getState("5fs_br:powered");
    if (powered) {
      block.setPermutation(block.permutation.withState("5fs_br:powered", false));
    }
  } catch {
    return;
  }

  const owner = deps.findOnlinePlayerByName?.(ownerName);
  if (owner?.isValid) {
    const label = reasonSettlement ? deps.settlementDisplayName(deps.loadData(), reasonSettlement) : "чужой";
    owner.sendMessage(`§cКарьер остановлен: зона добычи затрагивает ${label} территорию.`);
  }
}

function tickQuarryProtection() {
  const data = deps.loadData();

  for (const dimensionName of BR_DIMENSION_IDS) {
    let dimension;
    try {
      dimension = deps.world.getDimension(dimensionName);
    } catch {
      continue;
    }

    const dimensionId = deps.getDimensionId(dimension);

    let quarries;
    try {
      quarries = dimension.getEntities({ type: QUARRY_DUMMY_ENTITY });
    } catch {
      continue;
    }

    for (const dummy of quarries) {
      if (!dummy?.isValid) continue;

      const center = blockCenter(dummy.location);
      const block = dimension.getBlock(center);
      if (!block?.isValid || !isQuarryBlock(block.typeId)) continue;

      const key = quarryKey(dimensionId, center.x, center.y, center.z);
      const ownerName = quarryOwners.get(key);
      if (!ownerName) continue;

      const foreign = findForeignSettlementInQuarryFootprint(
        data,
        center,
        dimensionId,
        getQuarryRadius(block.typeId),
        ownerName
      );
      if (foreign) tryDisableQuarry(block, ownerName, foreign);
    }
  }
}

function registerQuarryOwner(event) {
  const blockId = event.block?.typeId;
  if (!isQuarryBlock(blockId)) return;

  const playerName = deps.getPlayerName(event.player);
  const dimensionId = deps.getDimensionId(event.block.dimension);
  const center = blockCenter(event.block.location);
  const key = quarryKey(dimensionId, center.x, center.y, center.z);
  quarryOwners.set(key, playerName);
}

function validateQuarryPlacement(event, data, playerName, dimensionId) {
  const radius = getQuarryRadius(event.block.typeId);
  const foreign = findForeignSettlementInQuarryFootprint(
    data,
    event.block.location,
    dimensionId,
    radius,
    playerName
  );
  if (!foreign) return true;

  event.cancel = true;
  event.player.sendMessage(
    `§cКарьер нельзя ставить здесь: зона добычи (${radius * 2 + 1}×${radius * 2 + 1}) затрагивает ${deps.settlementDisplayName(data, foreign)}.`
  );
  return false;
}

function validateSleepingBagPlacement(event, data, playerName, dimensionId) {
  const settlement = deps.findSettlementAt(data, event.block.location, dimensionId);
  if (!settlement || deps.hasTerritoryAccess(data, settlement, playerName)) return true;

  event.cancel = true;
  event.player.sendMessage(
    `§cСпальник нельзя ставить на чужой территории: ${deps.settlementDisplayName(data, settlement)}.`
  );
  return false;
}

function handleProtectedEntityInteract(event) {
  const player = event.player;
  const target = event.target;
  if (!player || !target?.isValid) return;

  const data = deps.loadData();
  const playerName = deps.getPlayerName(player);
  const dimensionId = deps.getDimensionId(target.dimension);
  const settlement = deps.findSettlementAt(data, target.location, dimensionId);

  if (isBrTombEntity(target.typeId)) {
    if (settlement && !deps.hasTerritoryAccess(data, settlement, playerName)) {
      event.cancel = true;
      player.sendMessage(`§cНадгробие на чужой территории: ${deps.settlementDisplayName(data, settlement)}.`);
    }
    return;
  }

  const mainhand = player.getComponent("minecraft:equippable")?.getEquipment("Mainhand");
  if (!isBrMobNetItem(mainhand?.typeId)) return;
  if (target.typeId === "minecraft:player") return;

  if (settlement && !deps.hasTerritoryAccess(data, settlement, playerName)) {
    event.cancel = true;
    player.sendMessage(`§cНа чужой территории нельзя ловить мобов: ${deps.settlementDisplayName(data, settlement)}.`);
  }
}

function scheduleGlobalWarKillFallback(victim, killer) {
  const dedupeKey = `fallback:${victim.id}:${killer.id}`;
  if (pendingGlobalWarKills.has(dedupeKey)) return;
  pendingGlobalWarKills.set(dedupeKey, deps.system.currentTick);

  deps.system.runTimeout(() => {
    pendingGlobalWarKills.delete(dedupeKey);
    if (!killer?.isValid) return;

    const victimName = deps.getPlayerName(victim);
    const killerName = deps.getPlayerName(killer);
    const fresh = deps.loadData();
    const victimSettlement = deps.getPlayerSettlement(fresh, victimName);
    const killerSettlement = deps.getPlayerSettlement(fresh, killerName);
    if (!victimSettlement || !killerSettlement || victimSettlement.id === killerSettlement.id) return;

    const campaign = deps.findWarCampaignBetween(fresh, victimSettlement, killerSettlement);
    if (!campaign || !deps.isGlobalWarCampaign(campaign) || campaign.ended) return;
    if (!deps.isWarCombatActive(campaign, deps.system.currentTick)) return;

    try {
      if (victim?.isValid) {
        const health = victim.getComponent("minecraft:health")?.currentValue ?? 1;
        if (health > 0) return;
      }
    } catch {
      // Player entity removed after death.
    }

    deps.handleGlobalWarKillFromProtection?.(
      fresh,
      killer,
      victim,
      killerSettlement,
      victimSettlement,
      campaign
    );
  }, 40);
}

function handleGlobalWarFatalHurt(event) {
  const victim = event.hurtEntity;
  const killer = event.damageSource?.damagingEntity;
  if (!victim || victim.typeId !== "minecraft:player") return;
  if (!killer || killer.typeId !== "minecraft:player") return;

  let healthAfter = 1;
  try {
    healthAfter = victim.getComponent("minecraft:health")?.currentValue ?? 1;
  } catch {
    return;
  }
  if (healthAfter > 0) return;

  const data = deps.loadData();
  const victimSettlement = deps.getPlayerSettlement(data, deps.getPlayerName(victim));
  const killerSettlement = deps.getPlayerSettlement(data, deps.getPlayerName(killer));
  if (!victimSettlement || !killerSettlement || victimSettlement.id === killerSettlement.id) return;

  const campaign = deps.findWarCampaignBetween(data, victimSettlement, killerSettlement);
  if (!campaign || !deps.isGlobalWarCampaign(campaign) || campaign.ended) return;
  if (!deps.isWarCombatActive(campaign, deps.system.currentTick)) return;

  scheduleGlobalWarKillFallback(victim, killer);
}

export function bindBrProtectionSystem(dependencies) {
  deps = dependencies;

  deps.world.beforeEvents.explosion?.subscribe((event) => {
    filterExplosionBlocks(event, deps.loadData());
  });

  deps.world.beforeEvents.playerPlaceBlock?.subscribe((event) => {
    const blockId = event.block?.typeId;
    if (!blockId) return;

    const data = deps.loadData();
    const playerName = deps.getPlayerName(event.player);
    const dimensionId = deps.getDimensionId(event.block.dimension);

    if (isQuarryBlock(blockId)) {
      if (!validateQuarryPlacement(event, data, playerName, dimensionId)) return;
      registerQuarryOwner(event);
      return;
    }

    if (isBrSleepingBag(blockId)) {
      validateSleepingBagPlacement(event, data, playerName, dimensionId);
    }
  });

  deps.world.afterEvents.playerPlaceBlock?.subscribe((event) => {
    registerQuarryOwner(event);
  });

  deps.world.beforeEvents.playerInteractWithEntity?.subscribe((event) => {
    handleProtectedEntityInteract(event);
  });

  deps.world.afterEvents.entityHurt?.subscribe((event) => {
    handleGlobalWarFatalHurt(event);
  });

  deps.system.runInterval(() => tickQuarryProtection(), 40);
}
