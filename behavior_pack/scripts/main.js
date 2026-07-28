import * as server from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import {
  FLAG_ENTITY,
  FLAG_ITEM,
  FLAG_LABEL_ENTITY,
  LEGACY_FLAG_BLOCK,
  PENDING_SETUP_TAG,
  SPAWN_GUARD_BLOCK
} from "./constants.js";
import {
  bindSpawnGuardSystem,
  findSpawnProtectionAt,
  shouldBlockSpawnBreak,
  shouldBlockSpawnPlace,
  shouldBlockSpawnPvp,
  shouldBlockSpawnSettlement,
  shouldBlockSpawnInteract,
  wouldSettlementRadiusOverlapSpawnGuard
} from "./spawn_guard.js";
import {
  CREATION_COST_COPPER,
  COPPER_PER_SILVER,
  buildingCostCopper,
  countCopperValue,
  countItem as countInventoryItem,
  emeraldCostToLabel,
  formatCopperValue,
  giveCopperValue,
  hasCopperValue,
  replaceEmeraldCosts,
  takeCopperValue,
  takeCopperValueWithNotice,
  takeMixedCost,
  getMissingCoinCost,
  describeCostShortage,
  reportCostShortage
} from "./economy.js";
import {
  chunkFromLocation,
  chunkKey,
  chunksInRadius,
  parseChunkKey,
  ownsChunk,
  ensureSettlementChunks,
  findSettlementAtLocation,
  findSettlementOwningChunk,
  chunkOverlapAt,
  getTerritoryChunkCount,
  expandTerritoryOnVictory,
  transferDefeatedSettlementChunks,
  loseHalfTerritoryChunks,
  applyUpgradeTerritory,
  previewUpgradeTerritory,
  canCaptureChunk,
  captureChunk,
  countCapturedChunks,
  getAllSettlementChunkKeys,
  chunkCaptureCostsCoins,
  getMaxCapturedChunks,
  CHUNK_CAPTURE_COST_COPPER
} from "./territory.js";
import {
  bindArmySystem,
  dismissArmiesForSettlement,
  formatArmyPowerLine,
  formatArmyPageBody,
  openArmyMenu,
  ensureSettlementArmyData
} from "./army.js";
import {
  PREFIXES,
  getPrefixInfoBody,
  getPlayerRole,
  canAssignPrefix,
  getAssignablePrefixes,
  canManageResidents,
  canManagePrefixes,
  canAccessConstruction,
  canAccessTrade,
  canAccessDiplomacy,
  canDeclareWar,
  canDisbandSettlement,
  canDisbandAlliance,
  canUpgradeSettlement,
  canClaimTax,
  canBuyKnights,
  canCommandArmy,
  getMaxSummonCount,
  isSettlementOwner,
  canCaptureChunks
} from "./permissions.js";
import { bindTradeSystem, ensureSettlementTradeData, openTradeHub } from "./trade.js";
import {
  KINGDOMS_MENU_PAGE,
  SETTLEMENT_MENU_PAGE,
  formatResidentsListTwoRows,
  getModalTextFieldValue,
  kingdomsMenuTitle,
  settlementMenuTitle,
  stripColorCodes
} from "./ui.js";

const { BlockPermutation, EquipmentSlot, ItemStack, system, world } = server;
const STORE_KEY = "kingdoms:data:v1";
const STORE_LIMIT = 32767;
const CREATION_COST = CREATION_COST_COPPER;
const DAY_TICKS = 24000;
const TAX_COOLDOWN_TICKS = 25 * 60 * 20;
const LOOT_WINDOW_TICKS = 5 * 60 * 20;
const LABEL_TAG = "kingdoms_flag_label";
const MINT_LABEL_TAG = "kingdoms_mint_label";
const MINT_QUEUE_LIMIT = 64;
const PROTECTED_INTERACTIONS = [
  "minecraft:chest",
  "minecraft:trapped_chest",
  "minecraft:barrel",
  "minecraft:shulker_box",
  "minecraft:white_shulker_box",
  "minecraft:orange_shulker_box",
  "minecraft:magenta_shulker_box",
  "minecraft:light_blue_shulker_box",
  "minecraft:yellow_shulker_box",
  "minecraft:lime_shulker_box",
  "minecraft:pink_shulker_box",
  "minecraft:gray_shulker_box",
  "minecraft:light_gray_shulker_box",
  "minecraft:cyan_shulker_box",
  "minecraft:purple_shulker_box",
  "minecraft:blue_shulker_box",
  "minecraft:brown_shulker_box",
  "minecraft:green_shulker_box",
  "minecraft:red_shulker_box",
  "minecraft:black_shulker_box",
  "minecraft:lever",
  "minecraft:stone_button",
  "minecraft:oak_button",
  "minecraft:spruce_button",
  "minecraft:birch_button",
  "minecraft:jungle_button",
  "minecraft:acacia_button",
  "minecraft:dark_oak_button",
  "minecraft:mangrove_button",
  "minecraft:cherry_button",
  "minecraft:bamboo_button",
  "minecraft:crimson_button",
  "minecraft:warped_button",
  "minecraft:polished_blackstone_button"
];

const SETTLEMENT_TYPES = [
  { name: "Деревня", hp: 500, radius: 35, tax: 4, minPlayers: 1, defeatReward: 8, upgradeCost: 0 },
  { name: "Большая деревня", hp: 750, radius: 55, tax: 8, minPlayers: 2, defeatReward: 14, upgradeCost: 80 },
  { name: "Городок", hp: 1100, radius: 80, tax: 14, minPlayers: 3, defeatReward: 22, upgradeCost: 180 },
  { name: "Большой город", hp: 1600, radius: 115, tax: 22, minPlayers: 4, defeatReward: 34, upgradeCost: 400 },
  { name: "Замок", hp: 2200, radius: 150, tax: 32, minPlayers: 5, defeatReward: 52, upgradeCost: 800 },
  { name: "Королевство", hp: 3000, radius: 220, tax: 44, minPlayers: 7, defeatReward: 80, upgradeCost: 1500 },
  { name: "Империя", hp: 4000, radius: 300, tax: 64, minPlayers: 10, defeatReward: 128, upgradeCost: 2500 }
];

const PREFIXES_LIST = PREFIXES;

const CREATOR_PREFIXES = [
  "Староста",
  "Войт",
  "Посадник",
  "Бургомистр",
  "Кастелян",
  "Король",
  "Император"
];

const PLAYER_PREFIX_LABEL_TAG = "kingdoms_player_prefix_label";

const playerTerritoryState = new Map();

const flagInteractionCooldown = new Map();
const flagPlacementCooldown = new Map();
const flagDamageCooldown = new Map();
const pendingPlacementLocks = new Set();
const playerPrefixCache = new Map();
const playerIdentityCache = new Map();
const playerIdByName = new Map();
const chatPrefixNoticeShown = new Set();
const loadedNoticeShown = new Set();
const formBusyPlayers = new Set();
const settlementMenuSessions = new Map();
const pendingResidentInvites = new Map();
const pendingAllianceOffers = new Map();
const activeFlagPlacements = new Set();
let directChatPrefixAvailable = false;
let dynamicPropertiesRegistered = false;

import { bindFlagSystem, setFlagPlacementHandler, setWildFlagSpawnHandler } from "./flag.js";
import { bindChunkCaptureSystem, cleanupChunkMarkersForSettlement } from "./chunk_flag.js";
import { bindTerritoryBorderSystem, clearSettlementBorders, refreshSettlementBorders, scheduleRefreshAllSettlementBorders, scheduleRefreshSettlementBorders } from "./territory_border.js";
import {
  canDeclareWarOnTarget,
  canTargetSettlementType,
  ensureWarCooldownData,
  formatCooldownTicks,
  getAllowedTargetTypeNames,
  getAllianceWarDeclareCooldownRemaining,
  getWeakWarCooldownRemaining,
  recordWarDeclaration,
  recordAllianceWarDeclaration,
  recordWeakVictoryCooldown,
  SETTLEMENT_TYPE_NAMES,
  FLAG_DAMAGE_COOLDOWN_TICKS,
  WAR_PREPARATION_TICKS,
  WAR_EARLY_PEACE_MORALE_PENALTY,
  MIN_ATTACKERS_ON_TERRITORY_FOR_FLAG_DAMAGE,
  areSettlementsAtWar,
  getAllianceSettlements,
  linkAllianceWar,
  unlinkAllianceWar,
  findWarInitiator,
  allianceHasActiveWars,
  getWarTargetOnlineBlockReason,
  MIN_TARGET_ONLINE_FOR_WAR,
  MIN_ATTACKER_ONLINE_FOR_WAR,
  createWarCampaign,
  createGlobalWarCampaign,
  canDeclareGlobalWarOnTarget,
  getGlobalWarOnlineBlockReason,
  GLOBAL_WAR_MIN_ONLINE,
  GLOBAL_WAR_KILL_POINTS_TO_WIN,
  GLOBAL_WAR_DEMOTE_TYPES,
  isGlobalWarCampaign,
  linkDirectWar,
  unlinkDirectWarPair,
  addGlobalWarKillPoint,
  formatGlobalWarKillScore,
  findWarCampaign,
  findWarCampaignBetween,
  isWarCombatActive,
  getWarPreparationRemaining,
  markWarFlagDamage,
  endWarCampaign,
  shouldPenalizeEarlyPeace,
  ensureWarCampaigns,
  getFlagRepairCooldownRemaining,
  computeFlagRepairCost,
  computeFlagRepairAmount
} from "./war.js";
import { bindDiplomacySystem, openCondemnationMenu } from "./diplomacy.js";
import { processPendingTradePayouts, processPendingTradeItemReturns } from "./trade.js";

bindArmySystem({
  world,
  system,
  ActionFormData,
  ModalFormData,
  ItemStack,
  EquipmentSlot,
  loadData,
  saveData,
  getSettlement,
  showForm,
  showFormDeferred,
  getPlayerName,
  playerDisplayPrefix,
  countBuildingsOfType,
  getPopulation,
  requireOwner,
  getMissingBuildingCost,
  takeBuildingCost,
  settlementMenuTitle,
  openSettlementMenu,
  SETTLEMENT_MENU_PAGE,
  samePlayerName,
  countCopperValue,
  takeCopperValue,
  formatCopperValue,
  buildingCostCopper,
  getMissingCoinCost,
  takeMixedCost,
  describeCostShortage,
  reportCostShortage,
  countInventoryItem,
  canBuyKnights,
  canCommandArmy,
  getMaxSummonCount
});

bindTradeSystem({
  world,
  system,
  ActionFormData,
  ModalFormData,
  MessageFormData,
  loadData,
  saveData,
  getSettlement,
  getPlayerName,
  samePlayerName,
  showForm,
  showFormDeferred,
  pickFromActionList,
  assertSettlementMenuSession,
  openSettlementMenu,
  SETTLEMENT_MENU_PAGE,
  KINGDOMS_MENU_PAGE,
  kingdomsMenuTitle,
  getCurrentDay
});

bindSpawnGuardSystem({
  world,
  system,
  loadData,
  saveData,
  showForm,
  getPlayerName,
  samePlayerName,
  getDimensionId,
  blockPosition,
  distance2D,
  nextSpawnGuardId
});

let mintInteractComponentRegistered = false;

function registerMintBlockInteractComponent() {
  if (mintInteractComponentRegistered) return;

  const attach = (registry) => {
    if (!registry?.registerCustomComponent || mintInteractComponentRegistered) return;
    registry.registerCustomComponent("kingdoms:mint_interact", {
      onPlayerInteract(event) {
        const block = event.block;
        const player = event.player;
        if (!player || !block || !isMintBlockId(block.typeId)) return;
        system.run(() => handleMintBlockInteract(player, block));
      }
    });
    mintInteractComponentRegistered = true;
  };

  system.beforeEvents?.startup?.subscribe(({ blockComponentRegistry }) => attach(blockComponentRegistry));
  world.beforeEvents?.worldInitialize?.subscribe(({ blockComponentRegistry }) => attach(blockComponentRegistry));
}

registerMintBlockInteractComponent();

bindFlagSystem(world);
setFlagPlacementHandler(beginSettlementCreationFromItem);
setWildFlagSpawnHandler(handleWildFlagEntitySpawn);
bindChunkCaptureSystem(world, {
  loadData,
  saveData,
  getSettlement,
  getPlayerSettlement,
  getPlayerName,
  samePlayerName,
  canCaptureChunks,
  giveItemStack,
  getDimensionId,
  blockPosition,
  findNearestPlayer,
  safeDimension,
  refreshSettlementBorders
});
bindTerritoryBorderSystem(world, {
  safeDimension,
  saveData,
  loadData,
  getSettlement
});

bindDiplomacySystem({
  world,
  system,
  ActionFormData,
  MessageFormData,
  loadData,
  saveData,
  getSettlement,
  getPlayerName,
  showFormDeferred,
  assertSettlementMenuSession,
  openDiplomacyMenu,
  openSettlementMenu,
  SETTLEMENT_MENU_PAGE,
  KINGDOMS_MENU_PAGE,
  kingdomsMenuTitle,
  canAccessDiplomacy,
  areAllied,
  settlementDisplayName,
  settlementType,
  getMaxHp,
  creatorPrefixFor,
  updateFlagLabelFor,
  scheduleRefreshSettlementBorders
});

world.beforeEvents?.worldInitialize?.subscribe((event) => {
  registerDynamicProperties(event.propertyRegistry);
});

function registerDynamicProperties(registry) {
  const DynamicPropertiesDefinition = server.DynamicPropertiesDefinition;
  if (dynamicPropertiesRegistered || !registry?.registerWorldDynamicProperties || typeof DynamicPropertiesDefinition !== "function") return;

  try {
    const definition = new DynamicPropertiesDefinition();
    definition.defineString(STORE_KEY, STORE_LIMIT);
    registry.registerWorldDynamicProperties(definition);
    dynamicPropertiesRegistered = true;
  } catch (error) {
    console.warn(`[Kingdoms] Не удалось зарегистрировать хранилище поселений: ${error}`);
  }
}

world.afterEvents.playerInteractWithEntity?.subscribe((event) => {
  const target = event.target ?? event.entity;
  if (!target || target.typeId !== FLAG_ENTITY) return;
  handleFlagInteraction(event.player, target);
});

world.afterEvents.playerSpawn?.subscribe((event) => {
  const player = event.player;
  if (!player) return;

  playerIdByName.set(getPlayerName(player), player.id);
  system.run(() => {
    updatePlayerPrefixDisplays();
    notifyPlayerAboutPrefixes(player);
    notifyPlayerAboutAddon(player);
  });
});

world.afterEvents.playerLeave?.subscribe((event) => {
  if (event.playerName) {
    playerPrefixCache.delete(event.playerName);
    playerIdentityCache.delete(event.playerName);
    playerIdByName.delete(event.playerName);
    chatPrefixNoticeShown.delete(event.playerName);
  }
  if (event.playerId) {
    removePlayerPrefixLabelById(event.playerId);
    playerTerritoryState.delete(event.playerId);
  }
});

world.afterEvents.playerPlaceBlock?.subscribe((event) => {
  const blockId = event.block.typeId;
  if (blockId === LEGACY_FLAG_BLOCK) {
    system.run(() => beginSettlementCreation(event.player, event.block));
    return;
  }
  if (isMintBlockId(blockId)) {
    system.run(() => registerPlacedMintWorkshop(event.player, event.block));
  }
});

world.afterEvents.playerInteractWithBlock?.subscribe((event) => {
  if (event.block.typeId !== LEGACY_FLAG_BLOCK) return;
  handleFlagInteraction(event.player, event.block);
});

function getFlagDamageCooldownRemaining(settlementId) {
  const lastHitTick = flagDamageCooldown.get(settlementId) ?? -FLAG_DAMAGE_COOLDOWN_TICKS;
  return Math.max(0, lastHitTick + FLAG_DAMAGE_COOLDOWN_TICKS - system.currentTick);
}

function countOnlineAllianceMembers(data, settlement) {
  const names = new Set();
  for (const memberSettlement of getAllianceSettlements(data, settlement)) {
    names.add(memberSettlement.creatorName);
    for (const residentName of Object.keys(memberSettlement.members || {})) names.add(residentName);
  }

  let count = 0;
  for (const player of world.getPlayers()) {
    const playerName = getPlayerName(player);
    for (const memberName of names) {
      if (samePlayerName(memberName, playerName)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function countEnemyAttackersOnTerritory(data, defenderSettlement) {
  let count = 0;
  for (const player of world.getPlayers()) {
    if (getDimensionId(player.dimension) !== defenderSettlement.dimensionId) continue;
    const territory = findSettlementAtLocation(data, player.location, defenderSettlement.dimensionId);
    if (!territory || territory.id !== defenderSettlement.id) continue;

    const attackerSettlement = getPlayerSettlement(data, getPlayerName(player));
    if (!attackerSettlement) continue;
    if (!areSettlementsAtWar(data, defenderSettlement, attackerSettlement)) continue;
    count += 1;
  }
  return count;
}

function canDealFlagDamage(data, defenderSettlement, attackerSettlement, player) {
  const campaign = findWarCampaignBetween(data, defenderSettlement, attackerSettlement);
  if (!campaign) {
    return { ok: false, message: "§cФлаг можно бить только во время объявленной войны." };
  }
  if (!isWarCombatActive(campaign, system.currentTick)) {
    const remaining = getWarPreparationRemaining(campaign, system.currentTick);
    return {
      ok: false,
      message: `§cБой начнётся через ${formatCooldownTicks(remaining)}. Сейчас идёт подготовка к войне.`
    };
  }
  const attackersOnTerritory = countEnemyAttackersOnTerritory(data, defenderSettlement);
  if (!isGlobalWarCampaign(campaign) && attackersOnTerritory < MIN_ATTACKERS_ON_TERRITORY_FOR_FLAG_DAMAGE) {
    return {
      ok: false,
      message: `§cУрон по флагу возможен только если на территории минимум ${MIN_ATTACKERS_ON_TERRITORY_FOR_FLAG_DAMAGE} атакующих (сейчас ${attackersOnTerritory}).`
    };
  }
  const remaining = getFlagDamageCooldownRemaining(defenderSettlement.id);
  if (remaining > 0) {
    return {
      ok: false,
      message: `§cФлаг недавно атаковали. Подождите ${formatCooldownTicks(remaining)}.`
    };
  }
  return { ok: true, campaign };
}

function canFightInWarCombat(data, firstSettlement, secondSettlement) {
  if (!areSettlementsAtWar(data, firstSettlement, secondSettlement)) return false;
  const campaign = findWarCampaignBetween(data, firstSettlement, secondSettlement);
  if (!campaign) return true;
  return isWarCombatActive(campaign, system.currentTick);
}

function tryApplyFlagDamage(data, settlement, attackerSettlement, player, flagEntity, rawDamage) {
  const check = canDealFlagDamage(data, settlement, attackerSettlement, player);
  if (!check.ok) {
    player.sendMessage(check.message);
    return;
  }
  flagDamageCooldown.set(settlement.id, system.currentTick);
  damageFlag(data, settlement, attackerSettlement, player, flagEntity, rawDamage, check.campaign);
}

function handleFlagInteraction(player, flagSource) {
  if (!player?.isValid) return;
  const cooldownKey = `${player.id}:${getPlayerName(player)}:${getDimensionId(flagSource.dimension)}:${Math.floor(flagSource.location.x)}:${Math.floor(flagSource.location.y)}:${Math.floor(flagSource.location.z)}`;
  const lastInteractionTick = flagInteractionCooldown.get(cooldownKey) ?? -20;
  if (system.currentTick - lastInteractionTick < 10) return;
  flagInteractionCooldown.set(cooldownKey, system.currentTick);

  const data = loadData();
  const settlement = flagSource.typeId === FLAG_ENTITY
    ? findSettlementByFlagEntity(data, flagSource)
    : findSettlementByFlag(data, flagSource);
  if (!settlement) {
    if (flagSource.typeId === FLAG_ENTITY && !isRegisteredFlagEntity(flagSource)) {
      system.run(() => handleWildFlagEntitySpawn(flagSource, player));
      return;
    }
    player.sendMessage("§cЭтот флаг не привязан к поселению. Уберите его и поставьте заново.");
    return;
  }
  const sessionToken = `${player.id}:${settlement.id}:${system.currentTick}`;
  settlementMenuSessions.set(player.id, { settlementId: settlement.id, token: sessionToken, openedAt: system.currentTick });
  system.run(() => openSettlementMenu(player, settlement.id, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken));
}

world.beforeEvents.playerBreakBlock?.subscribe((event) => {
  const data = loadData();
  const block = event.block;
  const playerName = getPlayerName(event.player);
  const dimensionId = getDimensionId(block.dimension);

  if (block.typeId !== SPAWN_GUARD_BLOCK && shouldBlockSpawnBreak(data, event.player, block.location, dimensionId)) {
    event.cancel = true;
    event.player.sendMessage("§cЗона защиты спавна: ломать блоки нельзя.");
    return;
  }

  if (block.typeId === LEGACY_FLAG_BLOCK) {
    const settlement = findSettlementByFlag(data, block);
    if (!settlement) return;

    const attackerSettlement = getPlayerSettlement(data, playerName);
    const isEnemyAtWar = attackerSettlement && areSettlementsAtWar(data, settlement, attackerSettlement);
    event.cancel = true;

    if (!isEnemyAtWar) {
      event.player.sendMessage("§cФлаг можно повредить только врагу во время объявленной войны. Владелец может расформировать поселение через меню флага.");
      return;
    }

    const check = canDealFlagDamage(data, settlement, attackerSettlement, event.player);
    if (!check.ok) {
      event.player.sendMessage(check.message);
      return;
    }

    tryApplyFlagDamage(data, settlement, attackerSettlement, event.player, undefined, undefined);
    return;
  }

  if (isMintBlockId(block.typeId)) {
    tryBreakMintWorkshop(event.player, block, event);
    return;
  }

  const settlement = findSettlementAt(data, block.location, getDimensionId(block.dimension));
  if (settlement && !hasTerritoryAccess(data, settlement, playerName)) {
    event.cancel = true;
    event.player.sendMessage(`§cЧужая территория: ${settlementDisplayName(data, settlement)}. Ломать блоки нельзя.`);
    return;
  }

  const lootZone = findLootZoneAt(data, block.location, getDimensionId(block.dimension));
  if (lootZone && !hasLootAccess(data, lootZone, playerName)) {
    event.cancel = true;
    event.player.sendMessage(`§cЗона мародёрства "${lootZone.name}" временно доступна только победителям.`);
  }
});

world.beforeEvents.playerPlaceBlock?.subscribe((event) => {
  const data = loadData();
  const playerName = getPlayerName(event.player);
  const dimensionId = getDimensionId(event.block.dimension);

  if (event.block.typeId !== SPAWN_GUARD_BLOCK && shouldBlockSpawnPlace(data, event.player, event.block.location, dimensionId)) {
    event.cancel = true;
    event.player.sendMessage("§cЗона защиты спавна: ставить блоки нельзя.");
    return;
  }

  const lootZone = findLootZoneAt(data, event.block.location, dimensionId);
  if (lootZone && !hasLootAccess(data, lootZone, playerName)) {
    event.cancel = true;
    event.player.sendMessage(`§cЗона мародёрства "${lootZone.name}" временно доступна только победителям.`);
    return;
  }

  const settlement = findSettlementAt(data, event.block.location, dimensionId);
  if (settlement && !hasTerritoryAccess(data, settlement, playerName)) {
    event.cancel = true;
    event.player.sendMessage(`§cЧужая территория: ${settlementDisplayName(data, settlement)}. Ставить блоки нельзя.`);
  }
});

world.beforeEvents.playerInteractWithBlock?.subscribe((event) => {
  const blockId = event.block.typeId;
  const data = loadData();
  const dimensionId = getDimensionId(event.block.dimension);
  if (PROTECTED_INTERACTIONS.includes(blockId) && shouldBlockSpawnInteract(data, event.player, event.block.location, dimensionId)) {
    event.cancel = true;
    event.player.sendMessage("§cЗона защиты спавна: взаимодействовать с этим нельзя.");
    return;
  }
  if (!PROTECTED_INTERACTIONS.includes(blockId)) return;

  const playerName = getPlayerName(event.player);
  const lootZone = findLootZoneAt(data, event.block.location, getDimensionId(event.block.dimension));
  if (lootZone && !hasLootAccess(data, lootZone, playerName)) {
    event.cancel = true;
    event.player.sendMessage(`§cЗона мародёрства "${lootZone.name}" временно доступна только победителям.`);
    return;
  }

  const settlement = findSettlementAt(data, event.block.location, getDimensionId(event.block.dimension));
  if (settlement && !hasTerritoryAccess(data, settlement, playerName)) {
    event.cancel = true;
    event.player.sendMessage(`§cЧужая территория: ${settlementDisplayName(data, settlement)}. Открывать и нажимать это нельзя.`);
  }
});

world.beforeEvents.entityHurt?.subscribe((event) => {
  const victim = event.hurtEntity;
  const attacker = event.damageSource?.damagingEntity;

  if (victim?.typeId === "kingdoms:order_btn") {
    event.cancel = true;
    return;
  }

  if (victim?.typeId === FLAG_ENTITY) {
    event.cancel = true;
    if (!attacker || attacker.typeId !== "minecraft:player") return;

    system.run(() => {
      if (!attacker?.isValid || !victim?.isValid) return;
      const freshData = loadData();
      const settlement = findSettlementByFlagEntity(freshData, victim);
      if (!settlement) {
        removeAllSettlementFlags(victim, undefined);
        return;
      }

      const attackerSettlement = getPlayerSettlement(freshData, getPlayerName(attacker));
      const isEnemyAtWar = attackerSettlement && areSettlementsAtWar(freshData, settlement, attackerSettlement);
      if (!isEnemyAtWar) {
        attacker.sendMessage("§cФлаг можно бить только врагу во время объявленной войны.");
        return;
      }
      if (!canFightInWarCombat(freshData, settlement, attackerSettlement)) {
        const campaign = findWarCampaignBetween(freshData, settlement, attackerSettlement);
        const remaining = campaign ? getWarPreparationRemaining(campaign, system.currentTick) : 0;
        attacker.sendMessage(`§cБой начнётся через ${formatCooldownTicks(remaining)}. Сейчас подготовка к войне.`);
        return;
      }

      tryApplyFlagDamage(freshData, settlement, attackerSettlement, attacker, victim, event.damage);
    });
    return;
  }

  if (!victim || !attacker || victim.typeId !== "minecraft:player" || attacker.typeId !== "minecraft:player") return;

  const data = loadData();
  const victimLoc = victim.location;
  const dimensionId = getDimensionId(victim.dimension);
  if (shouldBlockSpawnPvp(data, event.player, victimLoc, dimensionId)) {
    event.cancel = true;
    attacker.sendMessage("§cPvP запрещено в зоне защиты спавна.");
    return;
  }

  const victimSettlement = getPlayerSettlement(data, getPlayerName(victim));
  const attackerSettlement = getPlayerSettlement(data, getPlayerName(attacker));
  const victimTerritory = findSettlementAt(data, victimLoc, dimensionId);
  const attackerTerritory = findSettlementAt(data, attacker.location, dimensionId);

  if (!victimTerritory && !attackerTerritory) return;

  if (!victimSettlement || !attackerSettlement || !canFightInWarCombat(data, victimSettlement, attackerSettlement)) {
    event.cancel = true;
    if (victimSettlement && attackerSettlement && areSettlementsAtWar(data, victimSettlement, attackerSettlement)) {
      const campaign = findWarCampaignBetween(data, victimSettlement, attackerSettlement);
      const remaining = campaign ? getWarPreparationRemaining(campaign, system.currentTick) : 0;
      attacker.sendMessage(`§cPvP начнётся через ${formatCooldownTicks(remaining)}. Сейчас подготовка к войне.`);
    } else {
      attacker.sendMessage("§cНа чужой территории можно драться только во время войны между поселениями.");
    }
  }
});

world.afterEvents.entityDie?.subscribe((event) => {
  const victim = event.deadEntity;
  if (!victim || victim.typeId !== "minecraft:player") return;

  const killer = event.damageSource?.damagingEntity;
  if (!killer || killer.typeId !== "minecraft:player") return;

  const data = loadData();
  const victimSettlement = getPlayerSettlement(data, getPlayerName(victim));
  const killerSettlement = getPlayerSettlement(data, getPlayerName(killer));
  if (!victimSettlement || !killerSettlement || victimSettlement.id === killerSettlement.id) return;

  const campaign = findWarCampaignBetween(data, victimSettlement, killerSettlement);
  if (!campaign || !isGlobalWarCampaign(campaign) || campaign.ended) return;
  if (!isWarCombatActive(campaign, system.currentTick)) return;

  const points = addGlobalWarKillPoint(campaign, killerSettlement.id);
  const scoreLine = formatGlobalWarKillScore(data, campaign);
  world.sendMessage(`§4[Глобальная война] §f${getPlayerName(killer)} убил ${getPlayerName(victim)}. Счёт: ${scoreLine}.`);

  if (points >= GLOBAL_WAR_KILL_POINTS_TO_WIN) {
    handleGlobalWarVictory(data, killerSettlement, victimSettlement, killer, campaign);
  }
  saveData(data);
});

system.run(() => updatePlayerPrefixDisplays());
system.runTimeout(() => scheduleRefreshAllSettlementBorders(loadData()), 60);

system.runInterval(() => checkWarActivations(), 200);
system.runInterval(() => updateFlagLabels(), 60);
system.runInterval(() => updateMoraleForNewDay(), 1200);
system.runInterval(() => cleanupExpiredLootZones(), 100);
system.runInterval(() => updatePlayerPrefixDisplays(), 40);
system.runInterval(() => updatePlayerTerritoryMessages(), 20);
system.runInterval(() => processPendingTradePayouts(), 40);
system.runInterval(() => processPendingTradeItemReturns(), 40);
system.runInterval(() => tickMintWorkshops(), 20);
system.runInterval(() => refreshAllMintLabels(), 60);

async function beginSettlementCreationFromItem(player, clickedBlock, blockFace, origin = "script") {
  if (!player || !clickedBlock) return;

  const playerName = getPlayerName(player);
  const dimensionId = getDimensionId(clickedBlock.dimension);
  const spawnLocation = getFlagPlacementLocation(clickedBlock, blockFace);
  const territoryCenter = blockPosition(spawnLocation);
  const lockKey = placementLockKey(dimensionId, territoryCenter);
  if (!lockPlacement(lockKey)) {
    player.sendMessage("§cПодождите, флаг уже устанавливается.");
    return;
  }

  const validationError = validateNewSettlement(player, territoryCenter, dimensionId);
  if (validationError) {
    player.sendMessage(validationError);
    removeOrphanFlagsAt(territoryCenter, dimensionId);
    return;
  }

  let flagEntity = findPendingFlagEntityAt(territoryCenter, dimensionId);
  if (!flagEntity) {
    system.runTimeout(() => {
      const retryEntity = findPendingFlagEntityAt(territoryCenter, dimensionId);
      if (!retryEntity) {
        player.sendMessage("§cНе удалось найти флаг. Попробуйте поставить ещё раз.");
        return;
      }
      runSettlementCreationFlow(player, {
        territoryCenter,
        dimensionId,
        flagEntity: retryEntity,
        flagItemConsumed: true
      });
    }, 2);
    return;
  }

  await runSettlementCreationFlow(player, {
    territoryCenter,
    dimensionId,
    flagEntity,
    flagItemConsumed: true
  });
}

async function handleWildFlagEntitySpawn(entity, knownPlayer) {
  if (!entity?.isValid || isRegisteredFlagEntity(entity)) return;

  const territoryCenter = blockPosition(entity.location);
  const dimensionId = getDimensionId(entity.dimension);
  const placementKey = placementLockKey(dimensionId, territoryCenter);
  if (activeFlagPlacements.has(placementKey)) {
    removeDuplicateFlagEntity(entity, territoryCenter, dimensionId);
    return;
  }

  const player = knownPlayer ?? findNearestPlayer(entity, 12);
  if (!player) {
    entity.addTag(PENDING_SETUP_TAG);
    return;
  }

  const validationError = validateNewSettlement(player, territoryCenter, dimensionId);
  if (validationError) {
    player.sendMessage(validationError);
    cleanupInvalidFlagPlacement(entity, player);
    return;
  }

  if (!lockPlacement(placementKey)) {
    removeDuplicateFlagEntity(entity, territoryCenter, dimensionId);
    return;
  }

  activeFlagPlacements.add(placementKey);
  system.runTimeout(() => activeFlagPlacements.delete(placementKey), 40);

  if (!entity.hasTag(PENDING_SETUP_TAG)) entity.addTag(PENDING_SETUP_TAG);
  player.sendMessage("§aФлаг-сущность появилась. Открываю меню создания поселения...");

  await runSettlementCreationFlow(player, {
    territoryCenter,
    dimensionId,
    flagEntity: entity,
    flagItemConsumed: true
  });
}

async function runSettlementCreationFlow(player, context) {
  const { territoryCenter, dimensionId, flagEntity, flagItemConsumed } = context;
  const playerName = getPlayerName(player);

  const validationError = validateNewSettlement(player, territoryCenter, dimensionId);
  if (validationError) {
    player.sendMessage(validationError);
    cleanupFailedPlacement(player, flagEntity, flagItemConsumed);
    return;
  }

  const warning = getTerritoryPlacementWarning(loadData(), territoryCenter, dimensionId);
  const response = await showForm(player, buildSettlementCreationForm(playerName, warning));
  if (response.canceled) {
    player.sendMessage("§7Создание поселения отменено.");
    cleanupFailedPlacement(player, flagEntity, flagItemConsumed);
    return;
  }

  const name = cleanName(getModalTextFieldValue(response.formValues, 0));
  if (!name) {
    player.sendMessage("§cНазвание не может быть пустым.");
    cleanupFailedPlacement(player, flagEntity, flagItemConsumed);
    return;
  }

  if (!takeCopperValueWithNotice(player, CREATION_COST)) {
    player.sendMessage(`§cНе хватает монет. Нужно ${formatCopperValue(CREATION_COST)}.`);
    cleanupFailedPlacement(player, flagEntity, flagItemConsumed);
    return;
  }

  if (!flagItemConsumed && !takeItem(player, FLAG_ITEM, 1)) {
    giveCopperValue(player, CREATION_COST);
    cleanupFailedPlacement(player, flagEntity, false);
    player.sendMessage("§cПредмет флага не найден в инвентаре.");
    return;
  }

  const data = loadData();
  const nowDay = getCurrentDay();
  const settlement = {
    id: nextSettlementId(data),
    name,
    typeIndex: 0,
    creatorName: playerName,
    creatorPrefix: creatorPrefixFor(0),
    members: {},
    hp: SETTLEMENT_TYPES[0].hp,
    morale: 75,
    territoryBonus: 0,
    dimensionId,
    flag: territoryCenter,
    wars: [],
    allianceId: undefined,
    createdTick: system.currentTick,
    lastTaxTick: -TAX_COOLDOWN_TICKS,
    lastMoraleDay: nowDay,
    buildings: []
  };

  try {
    spawnOrUpdateFlagEntity(settlement, data, flagEntity);
  } catch (error) {
    giveCopperValue(player, CREATION_COST);
    cleanupFailedPlacement(player, flagEntity, flagItemConsumed);
    player.sendMessage(`§cНе удалось закрепить флаг-сущность: ${error}`);
    return;
  }

  data.settlements.push(settlement);
  ensureSettlementChunks(settlement, settlementType(settlement).radius);
  saveData(data);
  updateFlagLabelFor(settlement, data);
  updatePlayerPrefixDisplays(data);
  scheduleRefreshSettlementBorders(data, settlement);
  world.sendMessage(`§6[Королевства] §f${playerName} основал(а) ${settlementDisplayName(data, settlement)} за ${formatCopperValue(CREATION_COST)}.`);
}

function isRegisteredFlagEntity(entity) {
  if (!entity?.isValid) return false;
  return entity.getTags().some((tag) => tag.startsWith("kingdoms_id_"));
}

function findNearestPlayer(entity, maxDistance = 12) {
  let nearest;
  let nearestDistance = maxDistance;

  for (const player of world.getPlayers()) {
    if (player.dimension.id !== entity.dimension.id) continue;
    const dx = player.location.x - entity.location.x;
    const dy = player.location.y - entity.location.y;
    const dz = player.location.z - entity.location.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance <= nearestDistance) {
      nearest = player;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function findPendingFlagEntityAt(territoryCenter, dimensionId) {
  const dimension = safeDimension(dimensionId);
  if (!dimension) return undefined;

  try {
    const entities = dimension.getEntities({
      type: FLAG_ENTITY,
      location: getFlagEntityLocation(territoryCenter),
      maxDistance: 2.5
    });
    return entities.find((entity) => !isRegisteredFlagEntity(entity));
  } catch (_error) {
    return undefined;
  }
}

function placementLockKey(dimensionId, territoryCenter) {
  return `place:${dimensionId}:${territoryCenter.x}:${territoryCenter.y}:${territoryCenter.z}`;
}

function lockPlacement(lockKey) {
  if (pendingPlacementLocks.has(lockKey)) return false;
  pendingPlacementLocks.add(lockKey);
  system.runTimeout(() => pendingPlacementLocks.delete(lockKey), 30);
  return true;
}

function cleanupFailedPlacement(player, flagEntity, restoreFlagItem) {
  try {
    if (flagEntity?.isValid) flagEntity.remove();
  } catch (_error) {
    // Ignore cleanup failures.
  }
  if (restoreFlagItem) giveItemStack(player, new ItemStack(FLAG_ITEM, 1));
}

function cleanupInvalidFlagPlacement(flagEntity, player) {
  try {
    if (flagEntity?.isValid) flagEntity.remove();
  } catch (_error) {
    // Ignore cleanup failures.
  }
  giveItemStack(player, new ItemStack(FLAG_ITEM, 1));
}

function removeDuplicateFlagEntity(entity, territoryCenter, dimensionId) {
  const primary = findPendingFlagEntityAt(territoryCenter, dimensionId);
  if (primary?.isValid && primary.id !== entity.id) {
    try { entity.remove(); } catch (_error) { /* ignore */ }
  }
}

function removeOrphanFlagsAt(territoryCenter, dimensionId) {
  const dimension = safeDimension(dimensionId);
  if (!dimension) return;
  try {
    for (const flag of dimension.getEntities({
      type: FLAG_ENTITY,
      location: getFlagEntityLocation(territoryCenter),
      maxDistance: 2
    })) {
      if (!isRegisteredFlagEntity(flag)) flag.remove();
    }
  } catch (_error) {
    // Ignore cleanup failures.
  }
}

function formatExtraPageBody(settlement) {
  return [
    formatArmyPowerLine(settlement),
    "",
    "Дополнительные разделы:",
    "• Армия — рыцари и приказы",
    "• Торговля — сделки между поселениями",
    "• Чеканный двор — покупка блока, ПКМ — плавка слитков"
  ].join("\n");
}

const MINT_BLOCK_T1 = "kingdoms:mint_workshop_1";
const MINT_BLOCK_T2 = "kingdoms:mint_workshop_2";
const MINT_SMELT_TICKS = 10 * 60 * 20;

const MINT_SHOP_TIERS = {
  1: {
    name: "Чеканный двор I",
    blockId: MINT_BLOCK_T1,
    minTypeIndex: 1,
    cost: [
      { itemId: "kingdoms:coin_silver", amount: 28, label: "серебряные монеты" },
      { itemId: "minecraft:iron_ingot", amount: 12, label: "железные слитки" },
      { itemId: "minecraft:stone", amount: 24, label: "камень" },
      { itemId: "minecraft:anvil", amount: 1, label: "наковальня" }
    ],
    inputId: "minecraft:iron_ingot",
    inputLabel: "железный слиток",
    outputId: "kingdoms:coin_silver",
    outputAmount: 3,
    outputLabel: "серебряные монеты"
  },
  2: {
    name: "Чеканный двор II",
    blockId: MINT_BLOCK_T2,
    minTypeIndex: 3,
    cost: [
      { itemId: "kingdoms:coin_silver", amount: 55, label: "серебряные монеты" },
      { itemId: "kingdoms:coin_gold", amount: 2, label: "золотые монеты" },
      { itemId: "minecraft:gold_ingot", amount: 8, label: "золотые слитки" },
      { itemId: "minecraft:stone_bricks", amount: 32, label: "каменные кирпичи" },
      { itemId: "minecraft:anvil", amount: 1, label: "наковальня" }
    ],
    inputId: "minecraft:gold_ingot",
    inputLabel: "золотой слиток",
    outputId: "kingdoms:coin_gold",
    outputAmount: 3,
    outputLabel: "золотые монеты"
  }
};

function formatMintCost(def) {
  return (def.cost || [])
    .map((entry) => `${entry.amount} ${entry.label}`)
    .join(", ");
}

function formatMintSmeltLine(def) {
  return `Плавка: 1 ${def.inputLabel} → ${def.outputAmount} ${def.outputLabel} (10 мин., по одному)`;
}

function formatMintShopBody(data, settlementId) {
  const tier1 = MINT_SHOP_TIERS[1];
  const tier2 = MINT_SHOP_TIERS[2];
  const owned1 = settlementHasMintTier(data, settlementId, 1);
  const owned2 = settlementHasMintTier(data, settlementId, 2);
  return [
    "§6Чеканный двор§r",
    "Купите блок один раз, поставьте на своей территории.",
    "ПКМ — загрузить до 64 слитков, плавка по 1 (10 мин).",
    "",
    `§e${tier1.name}§r ${owned1 ? "§c[уже куплен]§r" : ""}`,
    `Тип поселения: ${SETTLEMENT_TYPE_NAMES[tier1.minTypeIndex]} или выше`,
    `Покупка: ${formatMintCost(tier1)}`,
    formatMintSmeltLine(tier1),
    "",
    `§e${tier2.name}§r ${owned2 ? "§c[уже куплен]§r" : ""}`,
    `Тип поселения: ${SETTLEMENT_TYPE_NAMES[tier2.minTypeIndex]} или выше`,
    `Покупка: ${formatMintCost(tier2)}`,
    formatMintSmeltLine(tier2)
  ].join("\n");
}

async function openMintShopMenu(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canAccessConstruction(data, playerName, settlement)) {
    player.sendMessage("§cЧеканный двор покупают создатель, Ремесленник, Рыцарь, Дворянин и Советник.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
  }

  const form = new ActionFormData()
    .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.MINT))
    .body(formatMintShopBody(data, settlementId));

  const buyOptions = [];
  if (!settlementHasMintTier(data, settlementId, 1)) {
    form.button("Купить двор I", "textures/ui/kingdoms/icon_tax");
    buyOptions.push(1);
  }
  if (!settlementHasMintTier(data, settlementId, 2)) {
    form.button("Купить двор II", "textures/ui/kingdoms/icon_tax");
    buyOptions.push(2);
  }
  form.button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await showFormDeferred(player, form);
  if (response.canceled || response.selection === buyOptions.length) {
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
  }

  const tier = buyOptions[response.selection];
  if (!tier) return openMintShopMenu(player, settlementId, sessionToken);
  return purchaseMintBlock(player, settlementId, sessionToken, tier);
}

async function purchaseMintBlock(player, settlementId, sessionToken, tier) {
  const def = MINT_SHOP_TIERS[tier];
  if (!def) return openMintShopMenu(player, settlementId, sessionToken);

  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement) return;

  if (settlement.typeIndex < def.minTypeIndex) {
    player.sendMessage(`§c${def.name} доступен с типа «${SETTLEMENT_TYPE_NAMES[def.minTypeIndex]}».`);
    return openMintShopMenu(player, settlementId, sessionToken);
  }

  if (settlementHasMintTier(data, settlement.id, tier)) {
    player.sendMessage(`§c${def.name} для этого поселения уже куплен.`);
    return openMintShopMenu(player, settlementId, sessionToken);
  }

  if (countInventoryItem(player, def.blockId) > 0) {
    player.sendMessage(`§cУ вас уже есть ${def.name} в инвентаре.`);
    return openMintShopMenu(player, settlementId, sessionToken);
  }

  if (reportCostShortage(player, def.cost) || !takeMixedCost(player, def.cost)) {
    player.sendMessage("§cНе хватает ресурсов для покупки.");
    return openMintShopMenu(player, settlementId, sessionToken);
  }

  ensureSettlementMintOwned(settlement);
  settlement.mintOwned[tier] = true;
  saveData(data);
  giveItemStack(player, new ItemStack(def.blockId, 1));
  player.sendMessage(`§a${def.name} куплен. Поставьте на территории. ПКМ — ${formatMintSmeltLine(def)}`);
  return openMintShopMenu(player, settlementId, sessionToken);
}

function isMintBlockId(blockId) {
  return blockId === MINT_BLOCK_T1 || blockId === MINT_BLOCK_T2;
}

function getMintTierFromBlockId(blockId) {
  if (blockId === MINT_BLOCK_T1) return 1;
  if (blockId === MINT_BLOCK_T2) return 2;
  return undefined;
}

function ensureMintWorkshops(data) {
  if (!Array.isArray(data.mintWorkshops)) data.mintWorkshops = [];
}

function ensureSettlementMintOwned(settlement) {
  if (!settlement.mintOwned || typeof settlement.mintOwned !== "object") settlement.mintOwned = {};
}

function settlementHasMintTier(data, settlementId, tier) {
  const settlement = getSettlement(data, settlementId);
  if (!settlement) return false;
  ensureSettlementMintOwned(settlement);
  if (settlement.mintOwned[tier]) return true;
  return data.mintWorkshops.some((entry) => entry.settlementId === settlementId && entry.tier === tier);
}

function migrateMintWorkshopRecord(record) {
  if (typeof record.queuedIngots !== "number") {
    record.queuedIngots = record.state === "idle" ? 0 : 0;
  }
  if (record.state === "processing" && !record.finishTick) record.finishTick = 0;
}

function mintWorkshopLabelTag(recordId) {
  return `mint_ws_${recordId}`;
}

function getMintLabelLocation(record) {
  return {
    x: record.location.x + 0.5,
    y: record.location.y + 1.35,
    z: record.location.z + 0.5
  };
}

function updateMintWorkshopLabel(record) {
  const def = MINT_SHOP_TIERS[record.tier];
  if (!def) return;
  const dimension = safeDimension(record.dimensionId);
  if (!dimension) return;

  const tag = mintWorkshopLabelTag(record.id);
  const location = getMintLabelLocation(record);
  let labels = [];
  try {
    labels = dimension.getEntities({ type: FLAG_LABEL_ENTITY, tags: [MINT_LABEL_TAG, tag] });
  } catch (_error) {
    labels = [];
  }

  const label = labels[0] ?? dimension.spawnEntity(FLAG_LABEL_ENTITY, location);
  if (!label.hasTag(MINT_LABEL_TAG)) label.addTag(MINT_LABEL_TAG);
  if (!label.hasTag(tag)) label.addTag(tag);
  label.nameTag = def.name;
  try {
    label.teleport(location, { dimension });
  } catch (_error) {
    // Keep the label at its last known position if teleport fails.
  }
  for (const duplicate of labels.slice(1)) duplicate.remove();
}

function removeMintWorkshopLabel(record) {
  const dimension = safeDimension(record.dimensionId);
  if (!dimension) return;
  try {
    for (const entity of dimension.getEntities({ type: FLAG_LABEL_ENTITY, tags: [MINT_LABEL_TAG, mintWorkshopLabelTag(record.id)] })) {
      entity.remove();
    }
  } catch (_error) {
    // Best-effort cleanup.
  }
}

function refreshAllMintLabels() {
  const data = loadData();
  ensureMintWorkshops(data);
  for (const record of data.mintWorkshops) {
    migrateMintWorkshopRecord(record);
    updateMintWorkshopLabel(record);
  }
}

function getMintDepositCapacity(record) {
  migrateMintWorkshopRecord(record);
  let used = record.queuedIngots;
  if (record.state === "processing") used += 1;
  return Math.max(0, MINT_QUEUE_LIMIT - used);
}

function tryStartMintProcessing(record) {
  migrateMintWorkshopRecord(record);
  if (record.state !== "idle" || record.queuedIngots <= 0) return false;
  record.queuedIngots -= 1;
  record.state = "processing";
  record.finishTick = system.currentTick + MINT_SMELT_TICKS;
  return true;
}

function mintLocationKey(location, dimensionId) {
  return `${dimensionId}:${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
}

function findMintWorkshop(data, location, dimensionId) {
  ensureMintWorkshops(data);
  const key = mintLocationKey(location, dimensionId);
  return data.mintWorkshops.find((entry) => mintLocationKey(entry.location, entry.dimensionId) === key);
}

function nextMintWorkshopId(data) {
  if (typeof data.nextMintWorkshopIdValue !== "number") data.nextMintWorkshopIdValue = 1;
  const id = data.nextMintWorkshopIdValue;
  data.nextMintWorkshopIdValue = id + 1;
  return id;
}

function registerPlacedMintWorkshop(player, block) {
  const tier = getMintTierFromBlockId(block.typeId);
  const def = tier ? MINT_SHOP_TIERS[tier] : undefined;
  if (!def || !player?.isValid) return;

  const data = loadData();
  ensureMintWorkshops(data);
  const dimensionId = getDimensionId(block.dimension);
  const location = blockPosition(block.location);
  if (findMintWorkshop(data, location, dimensionId)) return;

  const playerName = getPlayerName(player);
  const settlement = getPlayerSettlement(data, playerName);
  const territory = findSettlementAtLocation(data, block.location, dimensionId);

  if (!settlement || !territory || territory.id !== settlement.id || !hasTerritoryAccess(data, territory, playerName)) {
    setBlockToAir(block);
    giveItemStack(player, new ItemStack(def.blockId, 1));
    player.sendMessage("§cЧеканный двор можно ставить только на своей территории.");
    saveData(data);
    return;
  }

  const alreadyHas = data.mintWorkshops.some((entry) => entry.settlementId === settlement.id && entry.tier === tier);
  if (alreadyHas) {
    setBlockToAir(block);
    giveItemStack(player, new ItemStack(def.blockId, 1));
    player.sendMessage(`§cВ поселении уже есть ${def.name}.`);
    saveData(data);
    return;
  }

  data.mintWorkshops.push({
    id: nextMintWorkshopId(data),
    settlementId: settlement.id,
    tier,
    dimensionId,
    location,
    state: "idle",
    queuedIngots: 0,
    finishTick: 0,
    placedBy: playerName
  });
  ensureSettlementMintOwned(settlement);
  settlement.mintOwned[tier] = true;
  saveData(data);
  updateMintWorkshopLabel(data.mintWorkshops[data.mintWorkshops.length - 1]);
  player.sendMessage(`§a${def.name} установлен. ПКМ — меню плавки.`);
}

function ensureMintWorkshopRecord(player, block) {
  let data = loadData();
  let record = findMintWorkshop(data, block.location, getDimensionId(block.dimension));
  if (record) return record;

  registerPlacedMintWorkshop(player, block);
  data = loadData();
  return findMintWorkshop(data, block.location, getDimensionId(block.dimension));
}

function formatMintFurnaceBody(def, record, player) {
  migrateMintWorkshopRecord(record);
  const now = system.currentTick;
  let inputLine = `§f[ ${record.queuedIngots} в очереди ]`;
  let outputLine = "§7[ пусто ]";
  let statusLine = `§aМожно загрузить до ${getMintDepositCapacity(record)} ${def.inputLabel}`;

  if (record.state === "processing") {
    inputLine = `§f[ ${record.queuedIngots} + 1 плавится ]`;
    outputLine = `§e[ ${def.outputAmount} ${def.outputLabel} ]`;
    statusLine = `§6Плавка: ${formatCooldownTicks(Math.max(0, record.finishTick - now))}`;
  } else if (record.state === "ready") {
    inputLine = `§f[ ${record.queuedIngots} в очереди ]`;
    outputLine = `§a[ ${def.outputAmount} ${def.outputLabel} ]`;
    statusLine = "§aГотово — заберите монеты";
  }

  const haveInput = countItem(player, def.inputId);
  return [
    `§6${def.name}§r`,
    "",
    "       §8╔════════════╗",
    `       §8║§r ${inputLine} §8║`,
    "       §8║     ↓      ║",
    `       §8║§r ${outputLine} §8║`,
    "       §8╚════════════╝",
    "",
    `§7Статус:§r ${statusLine}`,
    `§7Рецепт:§r 1 ${def.inputLabel} → ${def.outputAmount} ${def.outputLabel} (10 мин., по одному)`,
    `§7Лимит загрузки:§r ${MINT_QUEUE_LIMIT} слитков`,
    "",
    "§e─── Ваш инвентарь ───",
    `§f${def.inputLabel}: §e${haveInput > 0 ? `${haveInput} шт.` : "нет"}`
  ].join("\n");
}

function canFitItemAmount(player, typeId, amount) {
  const inventory = getInventory(player);
  if (!inventory) return false;
  let free = 0;
  let partial = 0;
  for (let slot = 0; slot < inventory.size; slot += 1) {
    const item = inventory.getItem(slot);
    if (!item) free += 64;
    else if (item.typeId === typeId) partial += Math.max(0, 64 - item.amount);
  }
  return free + partial >= amount;
}

async function openMintFurnaceMenu(player, block) {
  if (!player?.isValid || !block) return;

  tickMintWorkshops();
  const data = loadData();
  const record = ensureMintWorkshopRecord(player, block);
  if (!record) {
    player.sendMessage("§cНе удалось открыть чеканный двор.");
    return;
  }

  const def = MINT_SHOP_TIERS[record.tier];
  const settlement = getSettlement(data, record.settlementId);
  const playerName = getPlayerName(player);
  if (!def || !settlement || !hasTerritoryAccess(data, settlement, playerName)) {
    player.sendMessage("§cЭтим чеканным двором могут пользоваться жители поселения.");
    return;
  }

  const fresh = findMintWorkshop(loadData(), block.location, getDimensionId(block.dimension));
  if (!fresh) return;

  const form = new ActionFormData()
    .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.MINT))
    .body(formatMintFurnaceBody(def, fresh, player));

  const depositCapacity = getMintDepositCapacity(fresh);
  if (depositCapacity > 0) {
    form.button(`Положить слитки (до ${depositCapacity})`, "textures/ui/kingdoms/icon_tax");
  }
  if (fresh.state === "ready") {
    form.button(`Забрать ${def.outputAmount} ${def.outputLabel}`, "textures/ui/kingdoms/icon_tax");
  }
  form.button("Обновить", "textures/ui/kingdoms/icon_info");
  form.button("Закрыть", "textures/ui/kingdoms/icon_disband");

  const response = await showFormDeferred(player, form);
  if (response.canceled) return;

  let buttonIndex = 0;
  if (depositCapacity > 0) {
    if (response.selection === buttonIndex) {
      return depositMintIngots(player, block, fresh, def);
    }
    buttonIndex += 1;
  }
  if (fresh.state === "ready") {
    if (response.selection === buttonIndex) {
      return collectMintSmeltOutput(player, block, fresh, def);
    }
    buttonIndex += 1;
  }
  if (response.selection === buttonIndex) {
    return openMintFurnaceMenu(player, block);
  }
}

function depositMintIngots(player, block, record, def) {
  migrateMintWorkshopRecord(record);
  const capacity = getMintDepositCapacity(record);
  if (capacity <= 0) {
    player.sendMessage(`§cМожно хранить не больше ${MINT_QUEUE_LIMIT} слитков.`);
    return openMintFurnaceMenu(player, block);
  }

  const available = countItem(player, def.inputId);
  if (available <= 0) {
    player.sendMessage(`§cНужен ${def.inputLabel}.`);
    return openMintFurnaceMenu(player, block);
  }

  const amount = Math.min(available, capacity);
  if (!takeItem(player, def.inputId, amount)) {
    player.sendMessage(`§cНе удалось загрузить ${def.inputLabel}.`);
    return openMintFurnaceMenu(player, block);
  }

  const data = loadData();
  const fresh = findMintWorkshop(data, block.location, getDimensionId(block.dimension));
  if (!fresh || fresh.id !== record.id) {
    giveItems(player, def.inputId, amount);
    return;
  }

  fresh.queuedIngots += amount;
  tryStartMintProcessing(fresh);
  saveData(data);
  player.sendMessage(`§aЗагружено: ${amount} ${def.inputLabel}. Плавка идёт по одному.`);
  return openMintFurnaceMenu(player, block);
}

function collectMintSmeltOutput(player, block, record, def) {
  if (record.state !== "ready") {
    player.sendMessage("§cВыход ещё не готов.");
    return openMintFurnaceMenu(player, block);
  }
  if (!canFitItemAmount(player, def.outputId, def.outputAmount)) {
    player.sendMessage("§cОсвободите место в инвентаре.");
    return openMintFurnaceMenu(player, block);
  }

  giveItems(player, def.outputId, def.outputAmount);

  const data = loadData();
  const fresh = findMintWorkshop(data, block.location, getDimensionId(block.dimension));
  if (!fresh || fresh.id !== record.id) return;

  fresh.state = "idle";
  fresh.finishTick = 0;
  tryStartMintProcessing(fresh);
  saveData(data);
  player.sendMessage(`§aПолучено: ${def.outputAmount} ${def.outputLabel}.`);
  return openMintFurnaceMenu(player, block);
}

function handleMintBlockInteract(player, block) {
  if (!player?.isValid || !block) return;
  openMintFurnaceMenu(player, block).catch((error) => {
    player.sendMessage(`§c[Королевства] Ошибка чеканного двора: ${error?.message ?? error}`);
  });
}

function tryBreakMintWorkshop(player, block, event) {
  const data = loadData();
  const record = findMintWorkshop(data, block.location, getDimensionId(block.dimension));
  if (!record) return false;

  const settlement = getSettlement(data, record.settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !hasTerritoryAccess(data, settlement, playerName)) {
    event.cancel = true;
    player.sendMessage("§cСломать чеканный двор могут жители этого поселения.");
    return true;
  }

  const def = MINT_SHOP_TIERS[record.tier];
  if (record.state === "processing" && def) {
    giveItemStack(player, new ItemStack(def.inputId, 1));
  }
  if (record.state === "ready" && def) {
    giveItems(player, def.outputId, def.outputAmount);
  }
  if (record.queuedIngots > 0 && def) {
    giveItems(player, def.inputId, record.queuedIngots);
  }
  removeMintWorkshopLabel(record);
  data.mintWorkshops = data.mintWorkshops.filter((entry) => entry.id !== record.id);
  saveData(data);
  if (def) giveItemStack(player, new ItemStack(def.blockId, 1));
  player.sendMessage(`§e${def?.name ?? "Чеканный двор"} снят.`);
  return false;
}

function tickMintWorkshops() {
  const data = loadData();
  ensureMintWorkshops(data);
  const now = system.currentTick;
  let changed = false;

  for (const record of data.mintWorkshops) {
    migrateMintWorkshopRecord(record);
    if (record.state === "processing" && record.finishTick && now >= record.finishTick) {
      record.state = "ready";
      changed = true;
    }
  }

  for (const record of data.mintWorkshops) {
    if (tryStartMintProcessing(record)) changed = true;
  }

  if (changed) saveData(data);
}

function getTerritoryPlacementWarning(data, center, dimensionId) {
  const empireRadius = SETTLEMENT_TYPES[SETTLEMENT_TYPES.length - 1].radius;
  if (wouldSettlementRadiusOverlapSpawnGuard(data, center, dimensionId, empireRadius)) {
    return `§eВ этом месте нельзя разместить флаг: радиус Империи (${empireRadius}) коснётся зоны защиты спавна. Отойдите подальше.`;
  }
  return undefined;
}

function buildSettlementCreationForm(playerName, warning) {
  const form = new ModalFormData()
    .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.CREATE));
  if (warning) form.label(stripColorCodes(warning));
  form.textField(
    `Название поселения (${formatCopperValue(CREATION_COST)})`,
    "Например: Новгород",
    { defaultValue: `Поселение ${playerName}` }
  );
  return form;
}

function validateNewSettlement(player, territoryCenter, dimensionId) {
  const data = loadData();
  const playerName = getPlayerName(player);

  if (data.settlements.some((settlement) => samePlayerName(settlement.creatorName, playerName))) {
    return "§cУ вас уже есть поселение. Один создатель может владеть только одним флагом.";
  }

  if (!hasCopperValue(player, CREATION_COST)) {
    return `§cДля создания поселения нужно ${formatCopperValue(CREATION_COST)}.`;
  }

  if (shouldBlockSpawnSettlement(data, territoryCenter, dimensionId)) {
    const guard = findSpawnProtectionAt(data, territoryCenter, dimensionId);
    return `§cРядом со спавном нельзя основывать поселения${guard ? ` (радиус ${guard.radius})` : ""}.`;
  }

  const empireRadius = SETTLEMENT_TYPES[SETTLEMENT_TYPES.length - 1].radius;
  const spawnEmpireOverlap = wouldSettlementRadiusOverlapSpawnGuard(data, territoryCenter, dimensionId, empireRadius);
  if (spawnEmpireOverlap) {
    return `§cЗдесь нельзя разместить флаг: радиус Империи (${empireRadius}) коснётся зоны защиты спавна (радиус ${spawnEmpireOverlap.radius}). Отойдите подальше.`;
  }

  const overlap = findTerritoryOverlap(data, territoryCenter, dimensionId, SETTLEMENT_TYPES[0].radius, undefined, undefined);
  if (overlap) {
    return `§cСлишком близко к территории: ${settlementDisplayName(data, overlap)}.`;
  }

  const { cx, cz } = chunkFromLocation(territoryCenter);
  const chunkOwner = findSettlementOwningChunk(data, dimensionId, cx, cz);
  if (chunkOwner) {
    return `§cЭтот чанк уже занят: ${settlementDisplayName(data, chunkOwner)}.`;
  }

  return undefined;
}

async function beginSettlementCreation(player, block) {
  const data = loadData();
  const playerName = getPlayerName(player);
  const dimensionId = getDimensionId(block.dimension);

  if (data.settlements.some((settlement) => settlement.creatorName === playerName)) {
    removePlacedFlag(block, player);
    player.sendMessage("§cУ вас уже есть поселение. Один создатель может владеть только одним флагом.");
    return;
  }

  if (!hasCopperValue(player, CREATION_COST)) {
    removePlacedFlag(block, player);
    player.sendMessage(`§cДля создания поселения нужно ${formatCopperValue(CREATION_COST)}.`);
    return;
  }

  if (shouldBlockSpawnSettlement(data, block.location, dimensionId)) {
    removePlacedFlag(block, player);
    const guard = findSpawnProtectionAt(data, block.location, dimensionId);
    player.sendMessage(`§cРядом со спавном нельзя основывать поселения${guard ? ` (радиус ${guard.radius})` : ""}.`);
    return;
  }

  const empireRadius = SETTLEMENT_TYPES[SETTLEMENT_TYPES.length - 1].radius;
  const spawnEmpireOverlap = wouldSettlementRadiusOverlapSpawnGuard(data, block.location, dimensionId, empireRadius);
  if (spawnEmpireOverlap) {
    removePlacedFlag(block, player);
    player.sendMessage(`§cЗдесь нельзя разместить флаг: радиус Империи (${empireRadius}) коснётся зоны защиты спавна (радиус ${spawnEmpireOverlap.radius}). Отойдите подальше.`);
    return;
  }

  const overlap = findTerritoryOverlap(data, block.location, dimensionId, SETTLEMENT_TYPES[0].radius, undefined, undefined);
  if (overlap) {
    removePlacedFlag(block, player);
    player.sendMessage(`§cСлишком близко к территории: ${settlementDisplayName(data, overlap)}.`);
    return;
  }

  const warning = getTerritoryPlacementWarning(data, block.location, dimensionId);
  const response = await showForm(player, buildSettlementCreationForm(playerName, warning));
  if (response.canceled) {
    removePlacedFlag(block, player);
    player.sendMessage("§7Создание поселения отменено, флаг возвращён.");
    return;
  }

  const name = cleanName(getModalTextFieldValue(response.formValues, 0));
  if (!name) {
    removePlacedFlag(block, player);
    player.sendMessage("§cНазвание не может быть пустым.");
    return;
  }

  if (!takeCopperValueWithNotice(player, CREATION_COST)) {
    removePlacedFlag(block, player);
    player.sendMessage(`§cНе хватает монет. Нужно ${formatCopperValue(CREATION_COST)}.`);
    return;
  }

  const nowDay = getCurrentDay();
  const settlement = {
    id: nextSettlementId(data),
    name,
    typeIndex: 0,
    creatorName: playerName,
    creatorPrefix: creatorPrefixFor(0),
    members: {},
    hp: SETTLEMENT_TYPES[0].hp,
    morale: 75,
    territoryBonus: 0,
    dimensionId,
    flag: blockPosition(block.location),
    wars: [],
    allianceId: undefined,
    createdTick: system.currentTick,
    lastTaxTick: -TAX_COOLDOWN_TICKS,
    lastMoraleDay: nowDay,
    buildings: []
  };

  data.settlements.push(settlement);
  ensureSettlementChunks(settlement, settlementType(settlement).radius);
  saveData(data);
  updateFlagLabelFor(settlement);
  updatePlayerPrefixDisplays(data);
  world.sendMessage(`§6[Королевства] §f${playerName} основал(а) ${settlementDisplayName(data, settlement)} за ${formatCopperValue(CREATION_COST)}.`);
}

function assertSettlementMenuSession(player, settlementId, sessionToken) {
  if (!player?.isValid) return false;
  const session = settlementMenuSessions.get(player.id);
  if (!session || session.settlementId !== settlementId) return false;
  if (sessionToken && session.token !== sessionToken) return false;
  return true;
}

async function openSettlementMenu(player, settlementId, page = SETTLEMENT_MENU_PAGE.MAIN, animate = false, sessionToken) {
  if (!player?.isValid) return;
  const session = settlementMenuSessions.get(player.id);
  if (!session || session.settlementId !== settlementId) return;
  if (sessionToken && session.token !== sessionToken) return;

  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement) {
    player.sendMessage("§cПоселение не найдено.");
    settlementMenuSessions.delete(player.id);
    return;
  }

  const playerName = getPlayerName(player);
  const isOwner = isSettlementOwner(playerName, settlement);
  const isResident = isMember(settlement, playerName) && !isOwner;

  const nextType = SETTLEMENT_TYPES[settlement.typeIndex + 1];
  const upgradeLabel = formatUpgradeButtonLabel(nextType);
  const atWar = (settlement.wars || []).length > 0;
  const form = new ActionFormData()
    .title(settlementMenuTitle(page, animate))
    .body(page === SETTLEMENT_MENU_PAGE.EXTRA ? formatExtraPageBody(settlement) : settlementInfo(data, settlement));

  if (page === SETTLEMENT_MENU_PAGE.EXTRA) {
    form
      .button("Армия", "textures/ui/kingdoms/icon_war")
      .button("Торговля", "textures/ui/kingdoms/icon_tax")
      .button("Чеканный двор", "textures/ui/kingdoms/icon_build")
      .button("Назад", "textures/ui/kingdoms/icon_disband");
  } else {
    form
      .button(upgradeLabel, "textures/ui/kingdoms/icon_upgrade")
      .button("Жители", "textures/ui/kingdoms/icon_residents")
      .button("Префиксы", "textures/ui/kingdoms/icon_prefixes")
      .button("О префиксах", "textures/ui/kingdoms/icon_info")
      .button("Дипломатия", "textures/ui/kingdoms/icon_alliance")
      .button("Объявить войну", "textures/ui/kingdoms/icon_war")
      .button("Налог", "textures/ui/kingdoms/icon_tax")
      .button("Строительство", "textures/ui/kingdoms/icon_build")
      .button(isResident ? "Покинуть поселение" : "Расформировать", "textures/ui/kingdoms/icon_disband");
    if (atWar) form.button("Починить флаг", "textures/ui/kingdoms/icon_upgrade");
    form.button("Далее", "textures/ui/kingdoms/icon_war");
  }

  const response = await showForm(player, form);
  if (response.canceled) return;
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;

  const selection = Number(response.selection);
  if (Number.isNaN(selection)) return;

  if (page === SETTLEMENT_MENU_PAGE.EXTRA) {
    if (selection === 0) return deferMenu(player, () => openArmyMenu(player, settlementId, sessionToken));
    if (selection === 1) return deferMenu(player, () => openTradeHub(player, settlementId, sessionToken));
    if (selection === 2) return deferMenu(player, () => openMintShopMenu(player, settlementId, sessionToken));
    if (selection === 3) {
      return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
    }
    return undefined;
  }

  if (selection === 9 + (atWar ? 1 : 0)) {
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
  }

  switch (selection) {
    case 0:
      return upgradeSettlement(player, settlementId, sessionToken);
    case 1:
      return deferMenu(player, () => openResidentsMenu(player, settlementId, sessionToken));
    case 2:
      return deferMenu(player, () => openPrefixesMenu(player, settlementId, sessionToken));
    case 3:
      return deferMenu(player, () => openPrefixInfo(player, settlementId, sessionToken));
    case 4:
      return deferMenu(player, () => openDiplomacyMenu(player, settlementId, sessionToken));
    case 5:
      return deferMenu(player, () => openWarMenu(player, settlementId, sessionToken));
    case 6:
      return claimTax(player, settlementId, sessionToken);
    case 7:
      return deferMenu(player, () => openConstructionMenu(player, settlementId, sessionToken));
    case 8:
      if (isOwner) return deferMenu(player, () => confirmDisband(player, settlementId, sessionToken));
      if (isResident) return deferMenu(player, () => confirmLeaveSettlement(player, settlementId, sessionToken));
      player.sendMessage("§cЭто действие недоступно.");
      return;
    case 9:
      if (atWar) return repairSettlementFlag(player, settlementId, sessionToken);
      return undefined;
    default:
      return undefined;
  }
}

function grantChunkCaptureFlagOnUpgrade(player, settlement) {
  if (settlement.typeIndex < 1) return;
  giveItemStack(player, new ItemStack("kingdoms:chunk_capture_flag", 1));
  const maxChunks = getMaxCapturedChunks(settlement);
  const costNote = chunkCaptureCostsCoins(settlement)
    ? ` Стоимость захвата: ${formatCopperValue(CHUNK_CAPTURE_COST_COPPER)} за чанк.`
    : " Захват чанков бесплатный.";
  player.sendMessage(`§aВы получили §fФлаг захвата чанка§a (лимит: ${maxChunks}).${costNote}`);
}

function finishSettlementUpgrade(player, data, settlement, upgradeCost, options = {}) {
  const { expandTerritory = true, overlap } = options;
  settlement.typeIndex += 1;
  settlement.creatorPrefix = creatorPrefixFor(settlement.typeIndex);
  settlement.hp = getMaxHp(settlement);
  settlement.morale = Math.min(100, settlement.morale + 10);

  if (expandTerritory) {
    const expansion = applyUpgradeTerritory(data, settlement, settlementType(settlement).radius);
    if (overlap && expansion.addedAdjacent > 0) {
      player.sendMessage(`§eТерритория пересекалась с ${settlementDisplayName(data, overlap)} — добавлено ${expansion.addedAdjacent} соседних свободных чанков.`);
    }
    scheduleRefreshSettlementBorders(data, settlement);
    world.sendMessage(`§6[Королевства] §f${settlementDisplayName(data, settlement)} улучшено за ${formatCopperValue(upgradeCost)}. Мораль выросла.`);
  } else {
    player.sendMessage("§eТерритория не изменилась — улучшен только тип поселения.");
    world.sendMessage(`§6[Королевства] §f${settlementDisplayName(data, settlement)} улучшено за ${formatCopperValue(upgradeCost)} без расширения территории. Мораль выросла.`);
  }

  grantChunkCaptureFlagOnUpgrade(player, settlement);
  saveData(data);
  updateFlagLabelFor(settlement);
  updatePlayerPrefixDisplays(data);
}

async function upgradeSettlement(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canUpgradeSettlement(data, playerName, settlement)) {
    player.sendMessage("§cУлучшать поселение могут создатель и Советник.");
    return;
  }

  const nextType = SETTLEMENT_TYPES[settlement.typeIndex + 1];
  if (!nextType) {
    player.sendMessage("§7Это уже максимальный тип поселения.");
    return;
  }

  const overlap = findTerritoryOverlap(data, settlement.flag, settlement.dimensionId, nextType.radius + (settlement.territoryBonus || 0), settlement.id, settlement.allianceId);
  const expansionPreview = previewUpgradeTerritory(data, settlement, nextType.radius);
  const upgradeCost = buildingCostCopper(nextType.upgradeCost);
  const costLabel = formatCopperValue(upgradeCost);

  if (expansionPreview.blocked > 0 && expansionPreview.addedAdjacent === 0) {
    const response = await showFormDeferred(player, new MessageFormData()
      .title("Улучшение без расширения")
      .body(`Вам некуда расшириться — соседние чанки заняты.${overlap ? `\n\nМешает: ${settlementDisplayName(data, overlap)}.` : ""}\n\nУлучшить до «${nextType.name}» за ${costLabel} без расширения территории?`)
      .button1(`Улучшить (${costLabel})`)
      .button2("Отмена"));
    if (response.canceled || response.selection !== 0) {
      return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
    }
    if (!takeCopperValueWithNotice(player, upgradeCost)) {
      player.sendMessage(`§cДля улучшения до "${nextType.name}" нужно ${costLabel}.`);
      return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
    }
    finishSettlementUpgrade(player, data, settlement, upgradeCost, { expandTerritory: false });
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  if (!takeCopperValueWithNotice(player, upgradeCost)) {
    player.sendMessage(`§cДля улучшения до "${nextType.name}" нужно ${costLabel}.`);
    return;
  }

  finishSettlementUpgrade(player, data, settlement, upgradeCost, { expandTerritory: true, overlap });
}

async function openResidentsMenu(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canManageResidents(data, playerName, settlement)) {
    player.sendMessage("§cЖителями управляют создатель и Советник.");
    return;
  }

  const residentList = formatResidentsListTwoRows(settlement.creatorName, settlement.members);
  const response = await showForm(player, new ActionFormData()
    .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.RESIDENTS))
    .body(`Жители поселения:\n${residentList}`)
    .button("Добавить игрока", "textures/ui/icon_multiplayer")
    .button("Исключить игрока", "textures/ui/icon_multiplayer")
    .button("Назад", "textures/ui/kingdoms/icon_disband"));
  if (response.canceled) return;
  if (response.selection === 0) return deferMenu(player, () => addResident(player, settlementId, sessionToken));
  if (response.selection === 1) return deferMenu(player, () => removeResident(player, settlementId, sessionToken));
  return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
}

async function addResident(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !canManageResidents(data, getPlayerName(player), settlement)) return;

  const candidates = world.getPlayers()
    .filter((candidate) => {
      const name = getPlayerName(candidate);
      return name !== settlement.creatorName
        && !settlement.members[name]
        && !getPlayerSettlement(data, name);
    });
  if (!candidates.length) {
    player.sendMessage("§7Нет онлайн-игроков, которых можно пригласить.");
    return openResidentsMenu(player, settlementId, sessionToken);
  }

  const pick = await pickFromActionList(player, "Добавить жителя", "Выберите игрока:", candidates, {
    getLabel: (candidate) => getPlayerName(candidate),
    menuPage: KINGDOMS_MENU_PAGE.PICK
  });
  if (pick.canceled) {
    if (pick.back) return openResidentsMenu(player, settlementId, sessionToken);
    return;
  }

  const targetPlayer = pick.item;
  const targetName = getPlayerName(targetPlayer);
  player.sendMessage(`§7Приглашение отправлено игроку ${targetName}.`);

  const accepted = await showFormDeferred(targetPlayer, new ActionFormData()
    .title("Приглашение в поселение")
    .body(`${getPlayerName(player)} приглашает вас в ${settlementDisplayName(data, settlement)}.\n\nВступить?`)
    .button("Вступить", "textures/ui/check")
    .button("Нет", "textures/ui/cancel"));
  if (accepted.canceled || accepted.selection !== 0) {
    player.sendMessage(`§7${targetName} отклонил(а) приглашение.`);
    targetPlayer.sendMessage(`§7Вы отклонили приглашение в ${settlement.name}.`);
    return openResidentsMenu(player, settlementId, sessionToken);
  }

  const freshData = loadData();
  const freshSettlement = getSettlement(freshData, settlementId);
  if (!freshSettlement || getPlayerSettlement(freshData, targetName)) {
    player.sendMessage(`§c${targetName} больше не может вступить (уже в другом поселении).`);
    return openResidentsMenu(player, settlementId, sessionToken);
  }

  freshSettlement.members[targetName] = { prefix: PREFIXES_LIST[0].name, joinedTick: system.currentTick };
  saveData(freshData);
  updatePlayerPrefixDisplays(freshData);
  world.sendMessage(`§6[Королевства] §f${targetName} теперь житель ${settlementDisplayName(freshData, freshSettlement)}.`);
  targetPlayer.sendMessage(`§aВы вступили в ${settlementDisplayName(freshData, freshSettlement)}.`);
  return openResidentsMenu(player, settlementId, sessionToken);
}

async function removeResident(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !canManageResidents(data, getPlayerName(player), settlement)) return;

  const members = Object.keys(settlement.members);
  if (!members.length) {
    player.sendMessage("§7В поселении пока нет жителей.");
    return openResidentsMenu(player, settlementId, sessionToken);
  }

  const pick = await pickFromActionList(player, "Исключить жителя", "Выберите жителя:", members, {
    getLabel: (name) => name,
    menuPage: KINGDOMS_MENU_PAGE.PICK
  });
  if (pick.canceled) {
    if (pick.back) return openResidentsMenu(player, settlementId, sessionToken);
    return;
  }

  const name = pick.item;
  delete settlement.members[name];
  saveData(data);
  updatePlayerPrefixDisplays(data);
  world.sendMessage(`§6[Королевства] §f${name} исключён(а) из ${settlementDisplayName(data, settlement)}.`);
  return openResidentsMenu(player, settlementId, sessionToken);
}

async function openPrefixesMenu(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canManagePrefixes(data, playerName, settlement)) {
    player.sendMessage("§cПрефиксы назначают создатель, Советник и Дворянин.");
    return;
  }

  const members = Object.keys(settlement.members);
  if (!members.length) {
    player.sendMessage("§7Сначала добавьте жителей.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const memberPick = await pickFromActionList(player, "Префиксы", "Выберите жителя:", members, {
    getLabel: (name) => name,
    icon: "textures/ui/kingdoms/icon_prefixes"
  });
  if (memberPick.canceled) {
    if (memberPick.back) return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
    return;
  }
  const memberName = memberPick.item;

  const assignable = getAssignablePrefixes(getPlayerRole(data, playerName, settlement), isSettlementOwner(playerName, settlement))
    .map((name) => PREFIXES_LIST.find((entry) => entry.name === name))
    .filter(Boolean);

  const prefixPick = await pickFromActionList(
    player,
    `Префикс для ${memberName}`,
    "Выберите статус:",
    assignable.length ? assignable : PREFIXES_LIST,
    {
      getLabel: (prefix) => prefix.name,
      icon: "textures/ui/kingdoms/icon_prefixes"
    }
  );
  if (prefixPick.canceled) {
    if (prefixPick.back) return openPrefixesMenu(player, settlementId, sessionToken);
    return;
  }

  if (!canAssignPrefix(getPlayerRole(data, playerName, settlement), isSettlementOwner(playerName, settlement), prefixPick.item.name)) {
    player.sendMessage("§cВы не можете назначить этот префикс.");
    return openPrefixesMenu(player, settlementId, sessionToken);
  }

  settlement.members[memberName].prefix = prefixPick.item.name;
  saveData(data);
  updatePlayerPrefixDisplays(data);
  player.sendMessage(`§a${memberName}: ${settlement.members[memberName].prefix}.`);
  return openPrefixesMenu(player, settlementId, sessionToken);
}

async function openPrefixInfo(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const body = getPrefixInfoBody();
  await showForm(player, new ActionFormData().title("О префиксах").body(body).button("Назад"));
  return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
}

async function openDiplomacyMenu(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canAccessDiplomacy(data, playerName, settlement)) {
    player.sendMessage("§cДипломатией управляют создатель и Советник.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const ownAlliance = getAlliance(data, settlement.allianceId);
  const allianceLines = ownAlliance
    ? ownAlliance.members.map((memberId) => {
      const member = getSettlement(data, memberId);
      return member ? `• ${member.name} (${member.creatorName})` : undefined;
    }).filter(Boolean)
    : [];

  const body = [
    ownAlliance ? `Ваш альянс: ${ownAlliance.name}` : "Вы не состоите в альянсе.",
    "",
    "Альянсы мира:",
    ...data.alliances.map((alliance) => {
      const members = alliance.members.map((id) => getSettlement(data, id)?.name).filter(Boolean).join(", ");
      return `• ${alliance.name}: ${members || "нет данных"}`;
    })
  ].join("\n");

  const form = new ActionFormData()
    .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.DIPLOMACY))
    .body(data.alliances.length ? body : `${body}\n\nПока нет созданных альянсов.`)
    .button("Создать альянс", "textures/ui/kingdoms/icon_alliance")
    .button(ownAlliance ? "Расформировать альянс" : "Расформировать альянс", "textures/ui/kingdoms/icon_disband")
    .button("Осудить", "textures/ui/kingdoms/icon_war")
    .button("Список альянсов", "textures/ui/kingdoms/icon_info")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await showFormDeferred(player, form);
  if (response.canceled) return;
  if (response.selection === 0) return openAllianceMenu(player, settlementId, sessionToken);
  if (response.selection === 1) return dissolveAllianceMenu(player, settlementId, sessionToken);
  if (response.selection === 2) return openCondemnationMenu(player, settlementId, sessionToken);
  if (response.selection === 3) return listAlliancesMenu(player, settlementId, sessionToken);
  return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
}

async function listAlliancesMenu(player, settlementId, sessionToken) {
  const data = loadData();
  if (!data.alliances.length) {
    player.sendMessage("§7На сервере пока нет альянсов.");
    return openDiplomacyMenu(player, settlementId, sessionToken);
  }

  const pick = await pickFromActionList(player, "Альянсы", "Выберите альянс:", data.alliances, {
    getLabel: (alliance) => {
      const members = alliance.members.map((id) => getSettlement(data, id)?.name).filter(Boolean).join(", ");
      return `${alliance.name} (${members})`;
    },
    icon: "textures/ui/kingdoms/icon_alliance",
    menuPage: KINGDOMS_MENU_PAGE.PICK
  });
  if (pick.canceled) {
    if (pick.back) return openDiplomacyMenu(player, settlementId, sessionToken);
    return;
  }

  const alliance = pick.item;
  const members = alliance.members.map((id) => getSettlement(data, id)).filter(Boolean);
  player.sendMessage(`§6Альянс "${alliance.name}": ${members.map((entry) => entry.name).join(", ")}`);
  return openDiplomacyMenu(player, settlementId, sessionToken);
}

async function dissolveAllianceMenu(player, settlementId, sessionToken) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement?.allianceId) {
    player.sendMessage("§7Ваше поселение не состоит в альянсе.");
    return openDiplomacyMenu(player, settlementId, sessionToken);
  }
  if (!canDisbandAlliance(data, playerName, settlement)) {
    player.sendMessage("§cРасформировать альянс может только создатель поселения.");
    return openDiplomacyMenu(player, settlementId, sessionToken);
  }

  const alliance = getAlliance(data, settlement.allianceId);
  const warNote = allianceHasActiveWars(data, settlement)
    ? "\n\n§cВнимание: у участников альянса есть активные войны. После роспуска войны продолжатся, но общий доступ к территориям союзников пропадёт."
    : "";
  const response = await showFormDeferred(player, new MessageFormData()
    .title("Расформировать альянс")
    .body(`Расформировать альянс "${alliance?.name ?? "?"}"?${warNote}`)
    .button1("Да")
    .button2("Нет"));
  if (response.canceled || response.selection !== 0) return openDiplomacyMenu(player, settlementId, sessionToken);

  disbandAlliance(data, settlement.allianceId, "создатель расформировал альянс");
  saveData(data);
  updatePlayerPrefixDisplays(data);
  player.sendMessage("§eАльянс расформирован.");
  return openDiplomacyMenu(player, settlementId, sessionToken);
}

function disbandAlliance(data, allianceId, reason) {
  const alliance = getAlliance(data, allianceId);
  if (!alliance) return;
  for (const memberId of alliance.members) {
    const member = getSettlement(data, memberId);
    if (member) member.allianceId = undefined;
  }
  data.alliances = data.alliances.filter((entry) => entry.id !== allianceId);
  world.sendMessage(`§6[Королевства] §fАльянс "${alliance.name}" расформирован: ${reason}.`);
}

async function openAllianceMenu(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canAccessDiplomacy(data, playerName, settlement)) return;

  const targets = data.settlements.filter((candidate) => {
    if (candidate.id === settlement.id) return false;
    if (areAllied(data, candidate.id, settlement.id)) return false;
    if (areSettlementsAtWar(data, settlement, candidate)) return false;
    return true;
  });
  if (!targets.length) {
    player.sendMessage("§7Нет поселений для нового альянса.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const pick = await pickFromActionList(player, "Создать альянс", "Выберите поселение:", targets, {
    getLabel: (candidate) => `${settlementDisplayName(data, candidate)} (${candidate.creatorName})`,
    icon: "textures/ui/kingdoms/icon_alliance"
  });
  if (pick.canceled) {
    if (pick.back) return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
    return;
  }

  const target = pick.item;
  if (areSettlementsAtWar(data, settlement, target)) {
    player.sendMessage("§cНельзя заключить альянс с поселением, с которым идёт война.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const targetOwner = world.getPlayers().find((online) => samePlayerName(getPlayerName(online), target.creatorName));
  if (!targetOwner) {
    player.sendMessage("§cСоздатель выбранного поселения должен быть онлайн, чтобы принять альянс.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  pendingAllianceOffers.set(targetOwner.id, {
    fromPlayerId: player.id,
    fromSettlementId: settlement.id,
    targetSettlementId: target.id
  });

  const answer = await showFormDeferred(targetOwner, new MessageFormData()
    .title("Предложение альянса")
    .body(`${settlement.creatorName} предлагает объединить территории: ${settlementDisplayName(data, settlement)} + ${settlementDisplayName(data, target)}. Если принять, инициатор выберет общее название альянса, которое будет отображаться у поселений.`)
    .button1("Принять")
    .button2("Отклонить"));

  if (answer.canceled || answer.selection !== 0) {
    pendingAllianceOffers.delete(targetOwner.id);
    player.sendMessage("§7Альянс отклонён.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const offer = pendingAllianceOffers.get(targetOwner.id);
  pendingAllianceOffers.delete(targetOwner.id);
  if (!offer || offer.fromPlayerId !== player.id || offer.fromSettlementId !== settlement.id || offer.targetSettlementId !== target.id) {
    player.sendMessage("§cПредложение альянса устарело. Попробуйте снова.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const nameResponse = await showFormDeferred(player, new ModalFormData()
    .title("Название альянса")
    .textField(
      "Название альянса",
      "Например: Северная корона",
      { defaultValue: `${settlement.name} и ${target.name}` }
    ));
  if (nameResponse.canceled) {
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const name = cleanName(nameResponse.formValues?.[0]);
  if (!name) {
    player.sendMessage("§cНазвание альянса не может быть пустым.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const fresh = loadData();
  const ownFresh = getSettlement(fresh, settlement.id);
  const targetFresh = getSettlement(fresh, target.id);
  if (!ownFresh || !targetFresh || areAllied(fresh, ownFresh.id, targetFresh.id)) {
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }
  if (areSettlementsAtWar(fresh, ownFresh, targetFresh)) {
    player.sendMessage("§cНельзя заключить альянс с поселением, с которым идёт война.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const alliance = { id: nextAllianceId(fresh), name, members: [ownFresh.id, targetFresh.id], createdTick: system.currentTick };
  fresh.alliances.push(alliance);
  ownFresh.allianceId = alliance.id;
  targetFresh.allianceId = alliance.id;
  ownFresh.morale = Math.min(100, ownFresh.morale + 4);
  targetFresh.morale = Math.min(100, targetFresh.morale + 4);
  saveData(fresh);
  world.sendMessage(`§6[Королевства] §fСоздан альянс "${name}" между ${ownFresh.name} и ${targetFresh.name}. Их территории объединены.`);
  return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
}

async function openWarMenu(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canDeclareWar(data, playerName, settlement)) {
    player.sendMessage("§cВойной управляют создатель и Советник.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  ensureWarInitiatedAgainst(settlement);
  ensureWarCooldownData(settlement);
  const activeInitiatedWars = getAllianceSettlements(data, settlement)
    .flatMap((ally) => (ally.warInitiatedAgainst || []).map((id) => getSettlement(data, id)))
    .filter(Boolean)
    .filter((entry, index, list) => list.findIndex((other) => other.id === entry.id) === index);
  const currentTick = system.currentTick;
  const globalCooldown = getAllianceWarDeclareCooldownRemaining(data, settlement, currentTick);
  const allowedTypes = getAllowedTargetTypeNames(settlement.typeIndex);
  const warTargets = data.settlements.filter((candidate) => {
    if (candidate.id === settlement.id) return false;
    if (areAllied(data, candidate.id, settlement.id)) return false;
    return canTargetSettlementType(settlement.typeIndex, candidate.typeIndex);
  });
  const maxWeakCooldown = warTargets.reduce(
    (max, candidate) => Math.max(max, getWeakWarCooldownRemaining(settlement, candidate.typeIndex, currentTick)),
    0
  );
  const cooldownLines = [];
  if (maxWeakCooldown > globalCooldown) {
    cooldownLines.push(`Кулдаун на слабые типы (48 ч.): ${formatCooldownTicks(maxWeakCooldown)}.`);
  } else if (globalCooldown > 0) {
    cooldownLines.push(`Кулдаун объявления войны (альянс): ${formatCooldownTicks(globalCooldown)}.`);
  } else if (maxWeakCooldown > 0) {
    cooldownLines.push(`Кулдаун на слабые типы (48 ч.): ${formatCooldownTicks(maxWeakCooldown)}.`);
  } else {
    cooldownLines.push("Кулдаун объявления войны: готов.");
  }

  const form = new ActionFormData()
    .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.MAIN))
    .body([
      activeInitiatedWars.length
        ? `Активные войны альянса: ${activeInitiatedWars.map((entry) => entry.name).join(", ")}`
        : "Выберите действие.",
      `Доступные цели: ${allowedTypes}.`,
      `Подготовка к бою: ${formatCooldownTicks(WAR_PREPARATION_TICKS)} после объявления.`,
      `Глобальная война (кнопка ниже): только создатель, 1 на 1, минимум ${GLOBAL_WAR_MIN_ONLINE} жителей в сети с каждой стороны, победа — флаг или ${GLOBAL_WAR_KILL_POINTS_TO_WIN} убийств, 60% чанков проигравшего.`,
      `Атакующих в сети: минимум ${MIN_ATTACKER_ONLINE_FOR_WAR}. Цель: минимум ${MIN_TARGET_ONLINE_FOR_WAR} в сети.`,
      `Урон по флагу: минимум ${MIN_ATTACKERS_ON_TERRITORY_FOR_FLAG_DAMAGE} атакующих на территории, кулдаун на флаг ${formatCooldownTicks(FLAG_DAMAGE_COOLDOWN_TICKS)}.`,
      "Прекратить войну досрочно без боя — штраф морали.",
      "Прекратить войну может только поселение, которое её объявило.",
      ...cooldownLines
    ].join("\n"))
    .button("Объявить войну", "textures/ui/kingdoms/icon_war")
    .button("Глобальная война", "textures/ui/kingdoms/icon_war")
    .button("Прекратить войну", "textures/ui/kingdoms/icon_disband")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await showFormDeferred(player, form);
  if (response.canceled || response.selection === 3) {
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }
  if (response.selection === 0) return declareWarMenu(player, settlementId, sessionToken);
  if (response.selection === 1) return declareGlobalWarMenu(player, settlementId, sessionToken);
  return endWarMenu(player, settlementId, sessionToken);
}

function countOnlineSettlementMembers(settlement) {
  const memberNames = new Set([settlement.creatorName, ...Object.keys(settlement.members || {})]);
  let count = 0;
  for (const player of world.getPlayers()) {
    const playerName = getPlayerName(player);
    for (const memberName of memberNames) {
      if (samePlayerName(memberName, playerName)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

async function declareWarMenu(player, settlementId, sessionToken) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement) return;
  ensureWarCooldownData(settlement);

  const targets = data.settlements.filter((candidate) => {
    if (candidate.id === settlement.id) return false;
    if (areAllied(data, candidate.id, settlement.id)) return false;
    if (areSettlementsAtWar(data, settlement, candidate)) return false;
    if (!canTargetSettlementType(settlement.typeIndex, candidate.typeIndex)) return false;
    const onlineCount = countOnlineSettlementMembers(candidate);
    return getWarTargetOnlineBlockReason(settlement, candidate, onlineCount).ok;
  });

  if (!targets.length) {
    player.sendMessage(`§7Нет подходящих целей. Нужен противник в сети (минимум ${MIN_TARGET_ONLINE_FOR_WAR} игрока поселения). Ваш тип: ${settlementType(settlement).name}.`);
    return openWarMenu(player, settlementId, sessionToken);
  }

  const pick = await pickFromActionList(player, "Объявить войну", "Выберите цель:", targets, {
    getLabel: (candidate) => {
      const onlineCount = countOnlineSettlementMembers(candidate);
      const weakCooldown = getWeakWarCooldownRemaining(settlement, candidate.typeIndex, system.currentTick);
      const suffix = weakCooldown > 0 ? ` §7(кулдаун ${formatCooldownTicks(weakCooldown)})` : "";
      return `${settlementType(candidate).name} "${candidate.name}" (${candidate.creatorName}) §7[${onlineCount} в сети]${suffix}`;
    },
    icon: "textures/ui/kingdoms/icon_war"
  });
  if (pick.canceled) {
    if (pick.back) return openWarMenu(player, settlementId, sessionToken);
    return;
  }

  const target = pick.item;
  const targetOnlineCount = countOnlineSettlementMembers(target);
  const attackerOnlineCount = countOnlineAllianceMembers(data, settlement);
  const check = canDeclareWarOnTarget(data, settlement, target, system.currentTick, targetOnlineCount, attackerOnlineCount);
  if (!check.ok) {
    if (check.message) {
      player.sendMessage(check.message);
    } else if (check.reason === "global") {
      player.sendMessage(`§cОбъявить войну можно через ${formatCooldownTicks(check.remaining)}.`);
    } else if (check.reason === "weak") {
      const typeName = SETTLEMENT_TYPE_NAMES[check.targetTypeIndex] ?? "?";
      player.sendMessage(`§cПосле победы над слабым противником кулдаун 48 ч. на войну с типом «${typeName}»: ${formatCooldownTicks(check.remaining)}.`);
    } else {
      player.sendMessage(`§cНельзя объявить войну этому типу поселения. Доступно: ${getAllowedTargetTypeNames(settlement.typeIndex)}.`);
    }
    return declareWarMenu(player, settlementId, sessionToken);
  }

  const reasonResponse = await showFormDeferred(player, new ModalFormData()
    .title("Причина войны")
    .textField("Причина (увидят все игроки)", "Например: незаконный захват территории", { defaultValue: "" }));
  if (reasonResponse.canceled) return declareWarMenu(player, settlementId, sessionToken);

  const reason = cleanName(getModalTextFieldValue(reasonResponse.formValues, 0));
  if (!reason || reason.length < 5) {
    player.sendMessage("§cУкажите причину войны (минимум 5 символов).");
    return declareWarMenu(player, settlementId, sessionToken);
  }

  const currentTick = system.currentTick;
  linkAllianceWar(data, settlement, target);
  createWarCampaign(data, settlement, target, reason, currentTick);
  ensureWarInitiatedAgainst(settlement);
  if (!settlement.warInitiatedAgainst.includes(target.id)) settlement.warInitiatedAgainst.push(target.id);
  recordAllianceWarDeclaration(data, settlement, currentTick);
  settlement.morale = Math.max(0, settlement.morale - 6);
  target.morale = Math.max(0, target.morale - 6);
  saveData(data);
  world.sendMessage(`§4[Война] §f${settlementDisplayName(data, settlement)} объявило войну ${settlementDisplayName(data, target)}. Причина: "${reason}". Бой начнётся через ${formatCooldownTicks(WAR_PREPARATION_TICKS)}.`);
  return openWarMenu(player, settlementId, sessionToken);
}

async function declareGlobalWarMenu(player, settlementId, sessionToken) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !isSettlementOwner(playerName, settlement)) {
    player.sendMessage("§cГлобальную войну может объявить только создатель поселения.");
    return openWarMenu(player, settlementId, sessionToken);
  }

  ensureWarCooldownData(settlement);
  const targets = data.settlements.filter((candidate) => {
    if (candidate.id === settlement.id) return false;
    if (areAllied(data, candidate.id, settlement.id)) return false;
    if (areSettlementsAtWar(data, settlement, candidate)) return false;
    const onlineCount = countOnlineSettlementMembers(candidate);
    return getGlobalWarOnlineBlockReason(onlineCount, "противника").ok;
  });

  const ownOnline = countOnlineSettlementMembers(settlement);
  if (!getGlobalWarOnlineBlockReason(ownOnline, "вашего поселения").ok) {
    player.sendMessage(`§cДля глобальной войны у вашего поселения должно быть минимум ${GLOBAL_WAR_MIN_ONLINE} жителей в сети (сейчас ${ownOnline}).`);
    return openWarMenu(player, settlementId, sessionToken);
  }

  if (!targets.length) {
    player.sendMessage(`§7Нет подходящих целей. Нужен противник с минимум ${GLOBAL_WAR_MIN_ONLINE} жителями в сети.`);
    return openWarMenu(player, settlementId, sessionToken);
  }

  const pick = await pickFromActionList(player, "Глобальная война", "Выберите цель (1 на 1, без альянса):", targets, {
    getLabel: (candidate) => {
      const onlineCount = countOnlineSettlementMembers(candidate);
      return `${settlementType(candidate).name} "${candidate.name}" (${candidate.creatorName}) §7[${onlineCount} в сети]`;
    },
    icon: "textures/ui/kingdoms/icon_war"
  });
  if (pick.canceled) {
    if (pick.back) return openWarMenu(player, settlementId, sessionToken);
    return;
  }

  const target = pick.item;
  const targetOnlineCount = countOnlineSettlementMembers(target);
  const initiatorOnlineCount = countOnlineSettlementMembers(settlement);
  const check = canDeclareGlobalWarOnTarget(data, settlement, target, system.currentTick, initiatorOnlineCount, targetOnlineCount);
  if (!check.ok) {
    if (check.message) {
      player.sendMessage(check.message);
    } else if (check.reason === "global") {
      player.sendMessage(`§cОбъявить глобальную войну можно через ${formatCooldownTicks(check.remaining)}.`);
    }
    return declareGlobalWarMenu(player, settlementId, sessionToken);
  }

  const reasonResponse = await showFormDeferred(player, new ModalFormData()
    .title("Причина глобальной войны")
    .textField("Причина (увидят все игроки)", "Например: захват ключевых территорий", { defaultValue: "" }));
  if (reasonResponse.canceled) return declareGlobalWarMenu(player, settlementId, sessionToken);

  const reason = cleanName(getModalTextFieldValue(reasonResponse.formValues, 0));
  if (!reason || reason.length < 5) {
    player.sendMessage("§cУкажите причину войны (минимум 5 символов).");
    return declareGlobalWarMenu(player, settlementId, sessionToken);
  }

  const currentTick = system.currentTick;
  linkDirectWar(settlement, target);
  createGlobalWarCampaign(data, settlement, target, reason, currentTick);
  ensureWarInitiatedAgainst(settlement);
  if (!settlement.warInitiatedAgainst.includes(target.id)) settlement.warInitiatedAgainst.push(target.id);
  recordWarDeclaration(settlement, currentTick);
  settlement.morale = Math.max(0, settlement.morale - 8);
  target.morale = Math.max(0, target.morale - 8);
  saveData(data);
  world.sendMessage(
    `§4[Глобальная война] §f${settlementDisplayName(data, settlement)} объявило глобальную войну ${settlementDisplayName(data, target)}. Причина: "${reason}". Бой через ${formatCooldownTicks(WAR_PREPARATION_TICKS)}. Победа: флаг или ${GLOBAL_WAR_KILL_POINTS_TO_WIN} убийств. На время боя — мародёрство на территории противника.`
  );
  return openWarMenu(player, settlementId, sessionToken);
}

async function endWarMenu(player, settlementId, sessionToken) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement) return;

  ensureWarInitiatedAgainst(settlement);
  const targets = (settlement.warInitiatedAgainst || [])
    .map((id) => getSettlement(data, id))
    .filter((entry) => entry && isAtWar(settlement, entry.id));

  if (!targets.length) {
    player.sendMessage("§7Нет войн, которые вы объявляли. Прекратить может только та сторона, которая начала войну.");
    return openWarMenu(player, settlementId, sessionToken);
  }

  const pick = await pickFromActionList(player, "Прекратить войну", "С каким поселением прекратить войну?", targets, {
    getLabel: (candidate) => `${settlementType(candidate).name} "${candidate.name}"`,
    icon: "textures/ui/kingdoms/icon_disband"
  });
  if (pick.canceled) {
    if (pick.back) return openWarMenu(player, settlementId, sessionToken);
    return;
  }

  const target = pick.item;
  const confirm = await showFormDeferred(player, new MessageFormData()
    .title("Прекратить войну")
    .body(`Прекратить войну с ${settlementDisplayName(data, target)}?`)
    .button1("Да")
    .button2("Нет"));
  if (confirm.canceled || confirm.selection !== 0) return endWarMenu(player, settlementId, sessionToken);

  if (!endWarBetween(data, settlement, target.id)) {
    player.sendMessage("§cНе удалось прекратить войну.");
    return openWarMenu(player, settlementId, sessionToken);
  }

  saveData(data);
  world.sendMessage(`§e[Война] §f${settlementDisplayName(data, settlement)} прекратило войну с ${settlementDisplayName(data, target)}.`);
  return openWarMenu(player, settlementId, sessionToken);
}

function repairSettlementFlag(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canDeclareWar(data, playerName, settlement)) {
    player.sendMessage("§cЧинить флаг могут создатель и Советник.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }
  if (!(settlement.wars || []).length) {
    player.sendMessage("§7Починка доступна только во время войны.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const maxHp = getMaxHp(settlement);
  if ((settlement.hp ?? maxHp) >= maxHp) {
    player.sendMessage("§7Флаг уже в полном порядке.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const repairCooldown = getFlagRepairCooldownRemaining(settlement, system.currentTick);
  if (repairCooldown > 0) {
    player.sendMessage(`§cПочинка флага доступна через ${formatCooldownTicks(repairCooldown)}.`);
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const cost = computeFlagRepairCost(settlement, maxHp);
  if (!takeCopperValueWithNotice(player, cost)) {
    player.sendMessage(`§cДля починки нужно ${formatCopperValue(cost)}.`);
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const repairAmount = computeFlagRepairAmount(maxHp);
  settlement.hp = Math.min(maxHp, (settlement.hp ?? maxHp) + repairAmount);
  settlement.lastFlagRepairTick = system.currentTick;
  saveData(data);
  updateFlagLabelFor(settlement, data);
  player.sendMessage(`§aФлаг восстановлен на ${repairAmount} HP. Сейчас ${settlement.hp}/${maxHp}.`);
  return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
}

function checkWarActivations() {
  const data = loadData();
  ensureWarCampaigns(data);
  let changed = false;

  for (const campaign of data.warCampaigns) {
    if (campaign.ended || campaign.combatAnnounced) continue;
    if (system.currentTick < campaign.activeTick) continue;

    campaign.combatAnnounced = true;
    changed = true;
    const initiator = getSettlement(data, campaign.initiatorSettlementId);
    const target = getSettlement(data, campaign.targetSettlementId);
    if (!initiator || !target) continue;
    if (isGlobalWarCampaign(campaign)) {
      world.sendMessage(
        `§4[Глобальная война] §fБой начался: ${settlementDisplayName(data, initiator)} против ${settlementDisplayName(data, target)}. Причина: "${campaign.reason}". Мародёрство на территории противника разрешено. Победа: флаг или ${GLOBAL_WAR_KILL_POINTS_TO_WIN} убийств.`
      );
    } else {
      world.sendMessage(`§4[Война] §fБой начался: ${settlementDisplayName(data, initiator)} против ${settlementDisplayName(data, target)}. Причина: "${campaign.reason}".`);
    }
  }

  if (changed) saveData(data);
}

function ensureWarInitiatedAgainst(settlement) {
  if (!Array.isArray(settlement.warInitiatedAgainst)) settlement.warInitiatedAgainst = [];
}

function endWarBetween(data, initiator, targetId) {
  const target = getSettlement(data, targetId);
  if (!target || !isAtWar(initiator, targetId)) return false;
  ensureWarInitiatedAgainst(initiator);
  if (!initiator.warInitiatedAgainst.includes(targetId)) return false;

  const campaign = endWarCampaign(data, initiator.id, targetId);
  if (campaign && shouldPenalizeEarlyPeace(campaign, system.currentTick)) {
    initiator.morale = Math.max(0, (initiator.morale ?? 75) - WAR_EARLY_PEACE_MORALE_PENALTY);
    const warLabel = isGlobalWarCampaign(campaign) ? "Глобальная война" : "Война";
    world.sendMessage(`§e[${warLabel}] §f${initiator.name} прекращает войну без боя и теряет ${WAR_EARLY_PEACE_MORALE_PENALTY} морали.`);
  }

  if (campaign && isGlobalWarCampaign(campaign)) {
    unlinkDirectWarPair(data, initiator.id, targetId);
  } else {
    unlinkAllianceWar(data, initiator, targetId);
  }
  initiator.warInitiatedAgainst = initiator.warInitiatedAgainst.filter((id) => id !== targetId);
  return true;
}

function claimTax(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canClaimTax(data, playerName, settlement)) {
    player.sendMessage("§cНалог могут забирать создатель и Советник.");
    return;
  }

  const elapsed = system.currentTick - (settlement.lastTaxTick ?? -TAX_COOLDOWN_TICKS);
  if (elapsed < TAX_COOLDOWN_TICKS) {
    const remainingSeconds = Math.ceil((TAX_COOLDOWN_TICKS - elapsed) / 20);
    player.sendMessage(`§7Налог можно забрать позже. Осталось примерно ${Math.ceil(remainingSeconds / 60)} мин.`);
    return;
  }

  const amount = settlementType(settlement).tax + getExtraIncomeBonus(settlement);
  giveCopperValue(player, buildingCostCopper(amount));
  settlement.lastTaxTick = system.currentTick;
  saveData(data);
  const extra = getExtraIncomeBonus(settlement);
  const payout = formatCopperValue(buildingCostCopper(amount));
  player.sendMessage(
    extra > 0
      ? `§aНалог собран: ${payout} §7(база + доп. заработок ${formatCopperValue(buildingCostCopper(extra))}).`
      : `§aНалог собран: ${payout}.`
  );
}

async function confirmLeaveSettlement(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !isMember(settlement, playerName) || isSettlementOwner(playerName, settlement)) {
    player.sendMessage("§cПокинуть поселение могут только жители (не создатель).");
    return;
  }

  const response = await showForm(player, new MessageFormData()
    .title("Покинуть поселение")
    .body("Вы точно хотите покинуть поселение?")
    .button1("Да")
    .button2("Нет"));
  if (response.canceled || response.selection !== 0) {
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const memberName = Object.keys(settlement.members || {}).find((name) => samePlayerName(name, playerName));
  if (memberName) delete settlement.members[memberName];
  saveData(data);
  updatePlayerPrefixDisplays(data);
  settlementMenuSessions.delete(player.id);
  world.sendMessage(`§6[Королевства] §f${playerName} покинул(а) ${settlementDisplayName(data, settlement)}.`);
  player.sendMessage("§eВы покинули поселение.");
}

async function confirmDisband(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canDisbandSettlement(data, playerName, settlement)) {
    player.sendMessage("§cРасформировать поселение может только создатель.");
    return;
  }

  const response = await showForm(player, new MessageFormData()
    .title("Расформировать")
    .body(
      (settlement.wars || []).length
        ? "§cУ вашего поселения активные войны. Расформирование не засчитается как победа противнику — война просто прекратится.\n\nВы правда хотите расформировать своё поселение/государство? Флаг и защита территории исчезнут."
        : "Вы правда хотите расформировать своё поселение/государство? Флаг и защита территории исчезнут."
    )
    .button1("Принять")
    .button2("Отклонить"));
  if (response.canceled || response.selection !== 0) return;

  disbandSettlement(data, settlement.id, "создатель расформировал государство");
  saveData(data);
}

/**
 * Каталог построек поселения.
 * cost — материалы на покупку (игроки сами строят здания на территории).
 * taxBonus — добавка к налогу каждые 25 мин.
 * minTypeIndex — минимальный уровень поселения для покупки.
 */

const BUILDINGS = {
  bakery: {
    id: "bakery",
    name: "Пекарня",
    description: "Пекарня для выпечки хлеба. Постройте здание сами на территории.",
    taxBonus: 2,
    maxPerSettlement: 1,
    minTypeIndex: 0,
    cost: [
      { itemId: "minecraft:emerald", amount: 10, label: "изумруды" },
      { itemId: "minecraft:oak_log", amount: 24, label: "дубовые брёвна" },
      { itemId: "minecraft:cobblestone", amount: 16, label: "булыжник" },
      { itemId: "minecraft:oak_planks", amount: 20, label: "дубовые доски" },
      { itemId: "minecraft:glass", amount: 4, label: "стекло" },
      { itemId: "minecraft:wheat", amount: 8, label: "пшеница" }
    ]
  },
  mill: {
    id: "mill",
    name: "Мельница",
    description: "Мельница перемалывает зерно. Постройте здание сами на территории.",
    taxBonus: 2,
    maxPerSettlement: 1,
    minTypeIndex: 0,
    cost: [
      { itemId: "minecraft:emerald", amount: 8, label: "изумруды" },
      { itemId: "minecraft:wheat", amount: 16, label: "пшеница" },
      { itemId: "minecraft:oak_log", amount: 16, label: "дубовые брёвна" },
      { itemId: "minecraft:cobblestone", amount: 12, label: "булыжник" }
    ]
  },
  warehouse: {
    id: "warehouse",
    name: "Склад",
    description: "Склад для хранения дани и товаров. Постройте здание сами на территории.",
    taxBonus: 2,
    maxPerSettlement: 1,
    minTypeIndex: 0,
    cost: [
      { itemId: "minecraft:emerald", amount: 12, label: "изумруды" },
      { itemId: "minecraft:barrel", amount: 8, label: "бочки" },
      { itemId: "minecraft:chest", amount: 4, label: "сундуки" },
      { itemId: "minecraft:oak_log", amount: 20, label: "дубовые брёвна" }
    ]
  },
  tavern: {
    id: "tavern",
    name: "Таверна",
    description: "Таверна привлекает путников и торговцев. Постройте здание сами на территории.",
    taxBonus: 3,
    maxPerSettlement: 1,
    minTypeIndex: 1,
    cost: [
      { itemId: "minecraft:emerald", amount: 15, label: "изумруды" },
      { itemId: "minecraft:barrel", amount: 6, label: "бочки" },
      { itemId: "minecraft:cooked_beef", amount: 16, label: "стейки" },
      { itemId: "minecraft:oak_planks", amount: 24, label: "дубовые доски" }
    ]
  },
  smithy: {
    id: "smithy",
    name: "Кузница",
    description: "Кузница обеспечивает ремесленный доход. Постройте здание сами на территории.",
    taxBonus: 3,
    maxPerSettlement: 1,
    minTypeIndex: 1,
    cost: [
      { itemId: "minecraft:emerald", amount: 18, label: "изумруды" },
      { itemId: "minecraft:iron_ingot", amount: 12, label: "слитки железа" },
      { itemId: "minecraft:coal", amount: 16, label: "уголь" },
      { itemId: "minecraft:cobblestone", amount: 20, label: "булыжник" }
    ]
  },
  market: {
    id: "market",
    name: "Торговый ряд",
    description: "Торговый ряд приносит основной торговый доход. Постройте здание сами на территории.",
    taxBonus: 4,
    maxPerSettlement: 1,
    minTypeIndex: 2,
    cost: [
      { itemId: "minecraft:emerald", amount: 25, label: "изумруды" },
      { itemId: "minecraft:chest", amount: 8, label: "сундуки" },
      { itemId: "minecraft:gold_ingot", amount: 8, label: "слитки золота" },
      { itemId: "minecraft:barrel", amount: 4, label: "бочки" }
    ]
  },
  town_hall: {
    id: "town_hall",
    name: "Ратуша",
    description: "Ратуша централизует сбор налогов. Постройте здание сами на территории.",
    taxBonus: 5,
    maxPerSettlement: 1,
    minTypeIndex: 3,
    cost: [
      { itemId: "minecraft:emerald", amount: 40, label: "изумруды" },
      { itemId: "minecraft:stone_bricks", amount: 32, label: "каменные кирпичи" },
      { itemId: "minecraft:glass", amount: 8, label: "стекло" },
      { itemId: "minecraft:oak_log", amount: 16, label: "дубовые брёвна" }
    ]
  },
  barracks: {
    id: "barracks",
    name: "Казармы",
    description: "Казармы позволяют нанимать рыцарей (5 слотов на казарму). Постройте здание на территории.",
    taxBonus: 0,
    maxPerSettlement: 10,
    minTypeIndex: 0,
    cost: [
      { itemId: "minecraft:emerald", amount: 20, label: "изумруды" },
      { itemId: "minecraft:oak_log", amount: 24, label: "дубовые брёвна" },
      { itemId: "minecraft:cobblestone", amount: 32, label: "булыжник" },
      { itemId: "minecraft:iron_ingot", amount: 6, label: "железо" },
      { itemId: "minecraft:iron_sword", amount: 1, label: "железный меч" }
    ]
  }
};

for (const def of Object.values(BUILDINGS)) {
  def.cost = replaceEmeraldCosts(def.cost);
}

function getBuildingDef(buildingId) {
  return BUILDINGS[buildingId];
}

function listBuildings() {
  return Object.values(BUILDINGS);
}

function formatBuildingCost(def) {
  return (def.cost || [])
    .map((entry) => `${entry.amount} ${entry.label}`)
    .join(", ");
}

function countBuildingsOfType(settlement, buildingId) {
  return (settlement.buildings || []).filter((b) => b.type === buildingId).length;
}

function getExtraIncomeBonus(settlement) {
  let total = 0;
  for (const placed of settlement.buildings || []) {
    const def = BUILDINGS[placed.type];
    if (def) total += Number(def.taxBonus || 0);
  }
  return total;
}

function formatExtraIncomeLine(settlement) {
  const buildings = settlement.buildings || [];
  if (!buildings.length) return "Доп заработок: нет";

  const parts = [];
  for (const placed of buildings) {
    const def = BUILDINGS[placed.type];
    if (!def) continue;
    parts.push(`${def.name} (+${def.taxBonus})`);
  }
  if (!parts.length) return "Доп заработок: нет";
  return `Доп заработок: ${parts.join(", ")}`;
}

function canPurchaseBuilding(settlement, def) {
  return settlement.typeIndex >= (def.minTypeIndex ?? 0);
}

function requiredSettlementTypeName(def) {
  return SETTLEMENT_TYPES[def.minTypeIndex ?? 0]?.name ?? "Деревня";
}

async function openConstructionMenu(player, settlementId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const playerName = getPlayerName(player);
  if (!settlement || !canAccessConstruction(data, playerName, settlement)) {
    player.sendMessage("§cСтроительство доступно создателю, Ремесленнику, Рыцарю, Дворянину и Советнику.");
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const buildings = listBuildings();
  const lines = [
    "Покупайте лицензии на постройки для доп. заработка к налогу.",
    "Материалы списываются при покупке — здания стройте сами на территории.",
    "",
    formatExtraIncomeLine(settlement)
  ];

  const form = new ActionFormData()
    .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.CONSTRUCTION))
    .body(lines.join("\n"));

  for (const def of buildings) {
    const owned = countBuildingsOfType(settlement, def.id);
    const limit = def.maxPerSettlement ?? 1;
    let status;
    if (owned >= limit) {
      status = "§cкуплена";
    } else if (!canPurchaseBuilding(settlement, def)) {
      status = `§eс ${requiredSettlementTypeName(def)}`;
    } else {
      status = `§a+${def.taxBonus} налог`;
    }
    form.button(`${def.name} (${status}§r)`, "textures/ui/kingdoms/icon_build");
  }
  form.button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await showForm(player, form);
  if (response.canceled) return;

  if (response.selection === buildings.length) {
    return openSettlementMenu(player, settlementId, SETTLEMENT_MENU_PAGE.MAIN, false, sessionToken);
  }

  const selected = buildings[response.selection];
  if (!selected) return;
  return openBuildingDetails(player, settlementId, selected.id, sessionToken);
}

async function openBuildingDetails(player, settlementId, buildingId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !canAccessConstruction(data, getPlayerName(player), settlement)) return;

  const def = getBuildingDef(buildingId);
  if (!def) return;

  const owned = countBuildingsOfType(settlement, buildingId);
  const limit = def.maxPerSettlement ?? 1;
  const costText = formatBuildingCost(def);
  const tierLine = (def.minTypeIndex ?? 0) > 0
    ? `Нужен уровень: ${requiredSettlementTypeName(def)} или выше`
    : "Доступно с: Деревня";
  const body = [
    def.name,
    def.description,
    `Бонус к налогу: +${formatCopperValue(buildingCostCopper(def.taxBonus))}/25м`,
    tierLine,
    `Уже куплено: ${owned}/${limit}`,
    `Стоимость: ${costText}`,
    "",
    "После покупки постройте здание в любом месте своей территории."
  ].join("\n");

  const canBuy = owned < limit && canPurchaseBuilding(settlement, def);
  const form = new ActionFormData()
    .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.CONSTRUCTION))
    .body(body)
    .button(canBuy ? "Купить" : "Недоступно", "textures/ui/kingdoms/icon_build")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await showForm(player, form);
  if (response.canceled) return;
  if (response.selection !== 0) return openConstructionMenu(player, settlementId, sessionToken);
  if (!canBuy) {
    if (owned >= limit) {
      player.sendMessage(`§cВ поселении уже куплен максимум построек этого типа (${limit}).`);
    } else {
      player.sendMessage(`§cНужен уровень поселения: ${requiredSettlementTypeName(def)} или выше.`);
    }
    return openConstructionMenu(player, settlementId, sessionToken);
  }

  return purchaseBuilding(player, settlementId, buildingId, sessionToken);
}

function purchaseBuilding(player, settlementId, buildingId, sessionToken) {
  if (!assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  const def = getBuildingDef(buildingId);
  if (!settlement || !def || !canAccessConstruction(data, getPlayerName(player), settlement)) return;

  if (countBuildingsOfType(settlement, def.id) >= (def.maxPerSettlement ?? 1)) {
    player.sendMessage(`§cВ поселении уже куплен максимум построек этого типа (${def.maxPerSettlement ?? 1}).`);
    return openConstructionMenu(player, settlementId, sessionToken);
  }

  if (!canPurchaseBuilding(settlement, def)) {
    player.sendMessage(`§cНужен уровень поселения: ${requiredSettlementTypeName(def)} или выше.`);
    return openConstructionMenu(player, settlementId, sessionToken);
  }

  if (reportBuildingCostShortage(player, def)) {
    return openConstructionMenu(player, settlementId, sessionToken);
  }

  if (!takeBuildingCost(player, def)) {
    player.sendMessage("§cНе удалось списать материалы.");
    return openConstructionMenu(player, settlementId, sessionToken);
  }

  if (!Array.isArray(settlement.buildings)) settlement.buildings = [];
  settlement.buildings.push({
    type: def.id,
    purchasedTick: system.currentTick
  });
  saveData(data);
  player.sendMessage(`§a${def.name} куплена! Доп. заработок: +${formatCopperValue(buildingCostCopper(def.taxBonus))} к налогу.`);
  player.sendMessage("§7Постройте здание на территории поселения в своём стиле.");
  world.sendMessage(`§6[Королевства] §fВ ${settlementDisplayName(data, settlement)} куплена лицензия: ${def.name}.`);
  return openConstructionMenu(player, settlementId, sessionToken);
}

function getMissingBuildingCost(player, def) {
  const missing = describeCostShortage(player, def.cost || []).missing;
  return missing;
}

function reportBuildingCostShortage(player, def) {
  return reportCostShortage(player, def.cost || []);
}

function takeBuildingCost(player, def) {
  return takeMixedCost(player, def.cost || []);
}

function formatUpgradeButtonLabel(nextType) {
  if (!nextType) return "Максимум развития";
  const cost = formatCopperValue(buildingCostCopper(nextType.upgradeCost));
  const name = nextType.name;
  if (name.length > 15) {
    const mid = Math.ceil(name.length / 2);
    let splitAt = name.lastIndexOf(" ", mid + 3);
    if (splitAt <= 0) splitAt = mid;
    const line1 = name.slice(0, splitAt).trim();
    const line2 = name.slice(splitAt).trim();
    return `Улучшить до\n${line1}\n${line2}\n(${cost})`;
  }
  return `Улучшить до\n${name}\n(${cost})`;
}

function captureSettlementSnapshot(settlement) {
  if (!settlement) return undefined;
  return {
    id: settlement.id,
    dimensionId: settlement.dimensionId,
    flag: {
      x: settlement.flag.x,
      y: settlement.flag.y,
      z: settlement.flag.z
    }
  };
}

function damageFlag(data, target, attackerSettlement, player, flagEntity, rawDamage, campaign) {
  if (!getSettlement(data, target.id)) {
    removeAllSettlementFlags(flagEntity, captureSettlementSnapshot(target));
    return;
  }

  const parsedDamage = Number(rawDamage);
  const damage = Number.isFinite(parsedDamage) && parsedDamage > 0
    ? Math.max(1, Math.round(parsedDamage))
    : Math.max(10, Math.ceil(settlementType(attackerSettlement).hp * 0.035));
  target.hp = Math.max(0, target.hp - damage);
  target.morale = Math.max(0, target.morale - 2);
  if (campaign) markWarFlagDamage(campaign);

  if (target.hp <= 0) {
    target.hp = 0;
    if (isGlobalWarCampaign(campaign)) {
      handleGlobalWarVictory(data, attackerSettlement, target, player, campaign);
    } else {
      const warInitiator = findWarInitiator(data, target, attackerSettlement);
      handleWarVictory(data, warInitiator, target, player, campaign);
    }
    if (!saveData(data)) {
      player.sendMessage("§cНе удалось сохранить результат войны: слишком много данных мира.");
    }
    updateFlagLabelFor(target, data);
    return;
  }

  saveData(data);
  updateFlagLabelFor(target, data);
  player.sendMessage(`§cФлаг повреждён на ${damage}. Осталось HP: ${target.hp}/${getMaxHp(target)}.`);
}

function applyWarDefeat(data, loser) {
  const beforeType = settlementType(loser).name;
  if (loser.typeIndex > 0) {
    loser.typeIndex -= 1;
    loser.creatorPrefix = creatorPrefixFor(loser.typeIndex);
  }
  loser.hp = getMaxHp(loser);
  const lostChunks = loseHalfTerritoryChunks(loser);
  loser.morale = Math.max(0, (loser.morale ?? 75) - 25);
  loser.defeatRecoveryUntil = system.currentTick + 24 * 60 * 60 * 20;
  scheduleRefreshSettlementBorders(data, loser);
  return { beforeType, lostChunks };
}

function applyGlobalWarDefeat(data, loser) {
  const beforeType = settlementType(loser).name;
  loser.typeIndex = Math.max(0, loser.typeIndex - GLOBAL_WAR_DEMOTE_TYPES);
  loser.creatorPrefix = creatorPrefixFor(loser.typeIndex);
  loser.hp = getMaxHp(loser);
  loser.morale = Math.max(0, (loser.morale ?? 75) - 25);
  loser.defeatRecoveryUntil = system.currentTick + 24 * 60 * 60 * 20;
  scheduleRefreshSettlementBorders(data, loser);
  return { beforeType };
}

function handleGlobalWarVictory(data, winner, loser, attackerPlayer, campaign) {
  if (!winner || !loser || !getSettlement(data, loser.id)) return;

  const winnerLabel = settlementDisplayName(data, winner);
  const loserLabel = settlementDisplayName(data, loser);

  unlinkDirectWarPair(data, winner.id, loser.id);
  endWarCampaign(data, campaign?.initiatorSettlementId ?? winner.id, loser.id);
  if (Array.isArray(winner.warInitiatedAgainst)) {
    winner.warInitiatedAgainst = winner.warInitiatedAgainst.filter((id) => id !== loser.id);
  }

  ensureSettlementChunks(winner, settlementType(winner).radius);
  ensureSettlementChunks(loser, settlementType(loser).radius);
  const transferredChunks = winner.dimensionId === loser.dimensionId
    ? transferDefeatedSettlementChunks(data, winner, loser)
    : 0;
  const defeat = applyGlobalWarDefeat(data, loser);

  winner.morale = Math.min(100, (winner.morale ?? 75) + 12);
  ensureWarCooldownData(winner);

  const reasonSuffix = campaign?.reason ? ` Причина: "${campaign.reason}".` : "";
  const scoreSuffix = campaign ? ` Счёт: ${formatGlobalWarKillScore(data, campaign)}.` : "";
  world.sendMessage(
    `§4[Глобальная война] §f${winnerLabel} победило. ${loserLabel} понижено (${defeat.beforeType} → ${settlementType(loser).name}), передано ${transferredChunks} чанк(ов) победителю.${reasonSuffix}${scoreSuffix}`
  );

  updateFlagLabelFor(loser, data);
  updateFlagLabelFor(winner, data);
  scheduleRefreshSettlementBorders(data, winner);

  if (attackerPlayer?.isValid) {
    attackerPlayer.sendMessage(`§a${winnerLabel} победило в глобальной войне. ${loserLabel} потеряло ${transferredChunks} чанк(ов) и −2 типа.`);
  }
}

function handleWarVictory(data, winner, loser, attackerPlayer, campaign) {
  if (!winner || !loser || !getSettlement(data, loser.id)) return;

  const winnerLabel = settlementDisplayName(data, winner);
  const loserLabel = settlementDisplayName(data, loser);

  unlinkAllianceWar(data, winner, loser.id);
  endWarCampaign(data, winner.id, loser.id);
  if (Array.isArray(winner.warInitiatedAgainst)) {
    winner.warInitiatedAgainst = winner.warInitiatedAgainst.filter((id) => id !== loser.id);
  }

  ensureSettlementChunks(winner, settlementType(winner).radius);
  ensureSettlementChunks(loser, settlementType(loser).radius);
  const addedChunks = expandTerritoryOnVictory(data, winner, loser);
  const defeat = applyWarDefeat(data, loser);

  if (addedChunks <= 0) {
    const owner = world.getPlayers().find((online) => samePlayerName(getPlayerName(online), winner.creatorName));
    if (owner) giveCopperValue(owner, buildingCostCopper(settlementType(loser).defeatReward));
    world.sendMessage(`§6[Королевства] §fТерритория победителя не расширилась — создатель получает награду монетами.`);
  } else {
    world.sendMessage(`§6[Королевства] §fТерритория ${winnerLabel} расширилась на ${addedChunks} чанк(ов).`);
  }

  winner.morale = Math.min(100, (winner.morale ?? 75) + 12);
  ensureWarCooldownData(winner);
  recordWeakVictoryCooldown(winner, loser, system.currentTick);
  const winnerSide = getAllianceSettlements(data, winner);
  data.lootZones.push({
    name: loser.name,
    dimensionId: loser.dimensionId,
    center: { ...loser.flag },
    radius: getTerritoryRadius(loser),
    winnerSettlementId: winner.id,
    winnerSettlementIds: winnerSide.map((entry) => entry.id),
    winnerAllianceId: winner.allianceId,
    expiresTick: system.currentTick + LOOT_WINDOW_TICKS
  });

  const reasonSuffix = campaign?.reason ? ` Причина войны: "${campaign.reason}".` : "";
  world.sendMessage(`§4[Война] §f${winnerLabel} победило. ${loserLabel} понижено (${defeat.beforeType} → ${settlementType(loser).name}), потеряно ${defeat.lostChunks} чанк(ов). Мародёрство 5 минут.${reasonSuffix}`);

  updateFlagLabelFor(loser, data);
  updateFlagLabelFor(winner, data);
  scheduleRefreshSettlementBorders(data, winner);

  if (attackerPlayer?.isValid) {
    attackerPlayer.sendMessage(`§a${winnerLabel} победило. ${loserLabel} откатилось на тип ниже.`);
  }
}

function removeAllSettlementFlags(flagEntity, settlementSnapshot) {
  try {
    if (flagEntity?.isValid) flagEntity.remove();
  } catch (_error) {
    // Ignore direct entity removal failures.
  }

  if (!settlementSnapshot) return;

  const dimension = safeDimension(settlementSnapshot.dimensionId);
  if (!dimension) return;

  const center = getFlagEntityLocation(settlementSnapshot.flag);
  try {
    for (const flag of dimension.getEntities({ type: FLAG_ENTITY, tags: [settlementTag(settlementSnapshot.id)] })) {
      try { flag.remove(); } catch (_error) { /* continue */ }
    }
    for (const flag of dimension.getEntities({ type: FLAG_ENTITY, location: center, maxDistance: 4 })) {
      try { flag.remove(); } catch (_error) { /* continue */ }
    }
  } catch (_error) {
    // Ignore bulk entity query failures.
  }

  try {
    const block = dimension.getBlock(settlementSnapshot.flag);
    if (block?.typeId === LEGACY_FLAG_BLOCK) setBlockToAir(block);
  } catch (_error) {
    // Ignore legacy block cleanup failures.
  }

  removeFlagLabel(settlementSnapshot);
}

function removeOrphanFlagEntity(flagEntity) {
  removeAllSettlementFlags(flagEntity, undefined);
}

function cleanupSettlementKnights(settlement) {
  const dimension = safeDimension(settlement.dimensionId);
  if (!dimension) return;
  const tag = `kingdoms_settlement_${settlement.id}`;
  try {
    for (const entity of dimension.getEntities({ type: "kingdoms:knight", tags: [tag] })) {
      entity.remove();
    }
  } catch (_error) {
    // Ignore cleanup failures.
  }
}

function disbandSettlement(data, settlementId, reason, announce = true) {
  const settlement = getSettlement(data, settlementId);
  if (!settlement) return;

  clearSettlementBorders(settlement);
  cleanupChunkMarkersForSettlement(settlement);

  data.settlements = data.settlements.filter((entry) => entry.id !== settlementId);

  for (const other of data.settlements) {
    other.wars = (other.wars || []).filter((id) => id !== settlementId);
    if (Array.isArray(other.warInitiatedAgainst)) {
      other.warInitiatedAgainst = other.warInitiatedAgainst.filter((id) => id !== settlementId);
    }
  }

  if (settlement.allianceId) {
    const alliance = data.alliances.find((entry) => entry.id === settlement.allianceId);
    if (alliance) {
      alliance.members = alliance.members.filter((id) => id !== settlementId);
      if (alliance.members.length < 2) {
        for (const memberId of alliance.members) {
          const member = getSettlement(data, memberId);
          if (member) member.allianceId = undefined;
        }
        data.alliances = data.alliances.filter((entry) => entry.id !== alliance.id);
      }
    }
  }

  try {
    removeFlagBlock(settlement);
    dismissArmiesForSettlement(settlementId);
    cleanupSettlementKnights(settlement);
  } catch (_error) {
    // Best-effort cleanup after settlement data is already removed.
  }

  try {
    updatePlayerPrefixDisplays(data);
  } catch (_error) {
    // Prefix refresh should not block disband.
  }

  if (announce) world.sendMessage(`§6[Королевства] §f${settlement.name} распалось: ${reason}.`);
}

function updateMoraleForNewDay() {
  const data = loadData();
  const day = getCurrentDay();
  let changed = false;
  const disbandIds = [];

  for (const settlement of data.settlements) {
    if ((settlement.lastMoraleDay ?? day) >= day) continue;

    let delta = 0;
    if (settlement.typeIndex >= 4) {
      delta += getPopulation(settlement) >= settlementType(settlement).minPlayers ? 5 : -8;
    }
    delta += (settlement.wars || []).length === 0 ? 3 : -10;
    if (settlement.allianceId) delta += 4;
    if (settlement.hp < getMaxHp(settlement) * 0.35) delta -= 8;

    settlement.morale = clamp((settlement.morale ?? 75) + delta, 0, 100);
    settlement.lastMoraleDay = day;
    changed = true;

    if (settlement.morale <= 0) disbandIds.push(settlement.id);
  }

  for (const id of disbandIds) disbandSettlement(data, id, "мораль упала до 0");
  if (changed || disbandIds.length) saveData(data);
}

function cleanupExpiredLootZones() {
  const data = loadData();
  const before = data.lootZones.length;
  data.lootZones = data.lootZones.filter((zone) => zone.expiresTick > system.currentTick);
  if (data.lootZones.length !== before) saveData(data);
}

function updateFlagLabels() {
  const data = loadData();
  cleanupOrphanFlagEntities(data);
  for (const settlement of data.settlements) updateFlagLabelFor(settlement, data);
}

function cleanupOrphanFlagEntities(data) {
  for (const dimensionId of ["overworld", "nether", "the_end"]) {
    const dimension = safeDimension(dimensionId);
    if (!dimension) continue;

    let flags = [];
    try {
      flags = dimension.getEntities({ type: FLAG_ENTITY });
    } catch (_error) {
      continue;
    }

    for (const flag of flags) {
      if (!flag?.isValid || flag.hasTag(PENDING_SETUP_TAG)) continue;
      if (findSettlementByFlagEntity(data, flag)) continue;
      try { flag.remove(); } catch (_error) { /* continue */ }
    }
  }
}

function updateFlagLabelFor(settlement, knownData) {
  const data = knownData ?? loadData();
  const flag = spawnOrUpdateFlagEntity(settlement, data);
  if (flag) flag.nameTag = settlementLabel(data, settlement);

  // Cleanup label entities from older builds; the flag entity now owns the visible name tag.
  const dimension = safeDimension(settlement.dimensionId);
  if (!dimension) return;
  try {
    for (const label of dimension.getEntities({ type: FLAG_LABEL_ENTITY, tags: [LABEL_TAG, settlementTag(settlement.id)] })) label.remove();
    for (const oldLabel of dimension.getEntities({ type: "minecraft:armor_stand", tags: [LABEL_TAG, settlementTag(settlement.id)] })) oldLabel.remove();
  } catch (_error) {
    // Cleanup is best-effort only.
  }
}

function removeFlagLabel(settlement) {
  const dimension = safeDimension(settlement.dimensionId);
  if (!dimension) return;
  try {
    for (const entity of dimension.getEntities({ type: FLAG_LABEL_ENTITY, tags: [LABEL_TAG, settlementTag(settlement.id)] })) entity.remove();
    for (const entity of dimension.getEntities({ type: "minecraft:armor_stand", tags: [LABEL_TAG, settlementTag(settlement.id)] })) entity.remove();
  } catch (_error) {
    // Ignore cleanup failures; they do not affect settlement data.
  }
}

function settlementInfo(data, settlement) {
  const type = settlementType(settlement);
  const alliance = getAlliance(data, settlement.allianceId);
  const wars = (settlement.wars || []).map((id) => getSettlement(data, id)?.name).filter(Boolean);
  const nextType = SETTLEMENT_TYPES[settlement.typeIndex + 1];
  return [
    `Тип: ${type.name}`,
    `Имя: ${settlement.name}`,
    `Созд.: ${creatorPrefixFor(settlement.typeIndex)} ${settlement.creatorName}`,
    `HP: ${settlement.hp}/${getMaxHp(settlement)}`,
    `Мораль: ${settlement.morale}/100`,
    `Жители: ${getPopulation(settlement)}`,
    `Чанков: ${getTerritoryChunkCount(settlement)} (захвачено: ${countCapturedChunks(settlement)}/${getMaxCapturedChunks(settlement)})`,
    `Налог: ${formatCopperValue(buildingCostCopper(type.tax))}/25м`,
    formatExtraIncomeLine(settlement),
    formatArmyPowerLine(settlement),
    `Итого налог: ${formatCopperValue(buildingCostCopper(type.tax + getExtraIncomeBonus(settlement)))}`,
    `Создание: ${formatCopperValue(CREATION_COST)}`,
    `Улучш.: ${nextType ? emeraldCostToLabel(nextType.upgradeCost) : "нет"}`,
    `Альянс: ${alliance ? alliance.name : "нет"}`,
    `Войны: ${wars.length ? wars.join(", ") : "нет"}`
  ].join("\n");
}

function settlementLabel(data, settlement) {
  return `${settlementDisplayName(data, settlement)}\n${creatorPrefixFor(settlement.typeIndex)} ${settlement.creatorName}\nHP ${settlement.hp}/${getMaxHp(settlement)} | Мораль ${settlement.morale}`;
}

function playerSettlementName(data, playerName) {
  return getPlayerSettlement(data, playerName)?.name;
}

/**
 * Bridge identity to Prefix Reloaded / Kingdoms Prefixes via player tags.
 */
function syncIdentityTags(player, settlementName, prefix) {
  const wantSettlement = settlementName ? `kw_s:${settlementName}` : undefined;
  const wantRole = prefix ? `kw_r:${prefix}` : undefined;
  try {
    for (const tag of player.getTags()) {
      if (tag.startsWith("kw_s:") && tag !== wantSettlement) player.removeTag(tag);
      if (tag.startsWith("kw_r:") && tag !== wantRole) player.removeTag(tag);
    }
    if (wantSettlement && !player.hasTag(wantSettlement)) player.addTag(wantSettlement);
    if (wantRole && !player.hasTag(wantRole)) player.addTag(wantRole);
  } catch (_error) {
    // Ignore tag sync failures; Prefix Reloaded can still try dynamic properties.
  }
}

function syncIdentityProperties(player, settlementName, prefix) {
  try {
    const nextRole = prefix ?? "";
    const nextSettlement = settlementName ?? "";
    if (player.getDynamicProperty("kingdoms:role") !== nextRole) {
      player.setDynamicProperty("kingdoms:role", nextRole);
    }
    if (player.getDynamicProperty("kingdoms:settlement") !== nextSettlement) {
      player.setDynamicProperty("kingdoms:settlement", nextSettlement);
    }
  } catch (_error) {
    // Older runtimes without player dynamic properties still get tags.
  }
}

function updatePlayerPrefixDisplays(knownData) {
  const data = knownData ?? loadData();
  const onlineNames = new Set();

  for (const player of world.getPlayers()) {
    const playerName = getPlayerName(player);
    onlineNames.add(playerName);
    playerIdByName.set(playerName, player.id);

    const prefix = playerDisplayPrefix(data, playerName);
    const settlementName = playerSettlementName(data, playerName);
    const identityKey = `${settlementName ?? ""}|${prefix ?? ""}`;
    if (playerIdentityCache.get(playerName) !== identityKey) {
      syncIdentityTags(player, settlementName, prefix);
      syncIdentityProperties(player, settlementName, prefix);
      playerIdentityCache.set(playerName, identityKey);
    }

    if (prefix) playerPrefixCache.set(playerName, prefix);
    else playerPrefixCache.delete(playerName);
  }

  for (const cachedName of playerPrefixCache.keys()) {
    if (!onlineNames.has(cachedName)) playerPrefixCache.delete(cachedName);
  }
  for (const cachedName of playerIdentityCache.keys()) {
    if (!onlineNames.has(cachedName)) playerIdentityCache.delete(cachedName);
  }
}

function tryApplyDirectChatPrefix(player, formattedPrefix) {
  try {
    player.chatNamePrefix = formattedPrefix;
    player.chatNameSuffix = "";
    player.chatMessagePrefix = "";
    return player.chatNamePrefix === formattedPrefix;
  } catch (_error) {
    return false;
  }
}

function clearDirectChatPrefix(player) {
  try {
    player.chatNamePrefix = "";
    player.chatNameSuffix = "";
    player.chatMessagePrefix = "";
  } catch (_error) {
    // chatNamePrefix is unavailable on older API modules.
  }
}

function playerDisplayPrefix(data, playerName) {
  const settlement = getPlayerSettlement(data, playerName);
  if (!settlement) return undefined;

  const role = samePlayerName(settlement.creatorName, playerName)
    ? (settlement.creatorPrefix ?? creatorPrefixFor(settlement.typeIndex))
    : getMemberRecord(settlement, playerName)?.prefix;
  if (!role) return undefined;
  return role;
}

function playerPrefixLabelTag(player) {
  return `kingdoms_pid_${player.id}`;
}

function getPlayerPrefixLabelLocation(player) {
  const sneakingOffset = player.isSneaking ? -0.25 : 0;
  return {
    x: player.location.x,
    y: player.location.y + 2.05 + sneakingOffset,
    z: player.location.z
  };
}

function updatePlayerPrefixLabel(player, prefix) {
  const dimension = player.dimension;
  if (!dimension) return;

  const pidTag = playerPrefixLabelTag(player);
  const location = getPlayerPrefixLabelLocation(player);
  const displayText = `§7[§6${prefix}§7] §f${getPlayerName(player)}`;
  let labels = [];

  try {
    labels = dimension.getEntities({ type: FLAG_LABEL_ENTITY, tags: [PLAYER_PREFIX_LABEL_TAG, pidTag] });
  } catch (_error) {
    labels = [];
  }

  const label = labels[0] ?? dimension.spawnEntity(FLAG_LABEL_ENTITY, location);
  if (!label.hasTag(PLAYER_PREFIX_LABEL_TAG)) label.addTag(PLAYER_PREFIX_LABEL_TAG);
  if (!label.hasTag(pidTag)) label.addTag(pidTag);
  label.nameTag = displayText;

  try {
    label.teleport(location, { dimension });
  } catch (_error) {
    // Keep the label at its last known position if teleport fails.
  }

  for (const duplicate of labels.slice(1)) duplicate.remove();
}

function removePlayerPrefixLabel(player) {
  if (!player) return;
  removePlayerPrefixLabelById(player.id, player.dimension);
}

function removePlayerPrefixLabelById(playerId, preferredDimension) {
  const pidTag = `kingdoms_pid_${playerId}`;
  const dimensions = preferredDimension
    ? [preferredDimension]
    : ["overworld", "nether", "the_end"].map((id) => safeDimension(id)).filter(Boolean);

  for (const dimension of dimensions) {
    try {
      for (const entity of dimension.getEntities({ type: FLAG_LABEL_ENTITY, tags: [PLAYER_PREFIX_LABEL_TAG, pidTag] })) {
        entity.remove();
      }
    } catch (_error) {
      // Ignore cleanup failures.
    }
  }
}

function getMemberRecord(settlement, playerName) {
  const memberName = Object.keys(settlement.members || {}).find((name) => samePlayerName(name, playerName));
  return memberName ? settlement.members[memberName] : undefined;
}

function creatorPrefixFor(typeIndex) {
  return CREATOR_PREFIXES[typeIndex] ?? CREATOR_PREFIXES[0];
}

function notifyPlayerAboutAddon(player) {
  if (!player) return;

  const playerName = getPlayerName(player);
  if (loadedNoticeShown.has(playerName)) return;
  loadedNoticeShown.add(playerName);

  player.sendMessage("§6[KW Build] §fv1.12.31 §7— глобальная война: 1v1, 60% чанков, 50 убийств");
  player.sendMessage(`§7Флаг — сущность. Кликните предметом по блоку. Нужно ${formatCopperValue(CREATION_COST)}.`);
}

function notifyPlayerAboutPrefixes(player) {
  if (!player) return;

  const playerName = getPlayerName(player);
  if (chatPrefixNoticeShown.has(playerName)) return;

  const prefix = playerDisplayPrefix(loadData(), playerName);
  if (!prefix) return;

  chatPrefixNoticeShown.add(playerName);
  player.sendMessage(`§7[Королевства] Ваш префикс: §6${prefix}§7. Отображение через Prefix Reloaded.`);
}

function settlementDisplayName(data, settlement) {
  const alliance = getAlliance(data, settlement.allianceId);
  const name = alliance ? `${settlement.name} · Альянс ${alliance.name}` : settlement.name;
  return `${settlementType(settlement).name} "${name}"`;
}

function loadData() {
  const raw = world.getDynamicProperty(STORE_KEY);
  if (typeof raw !== "string" || !raw) return emptyData();

  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.settlements)) data.settlements = [];
    if (!Array.isArray(data.alliances)) data.alliances = [];
    if (!Array.isArray(data.lootZones)) data.lootZones = [];
    if (!Array.isArray(data.spawnGuards)) data.spawnGuards = [];
    if (typeof data.nextSpawnGuardIdValue !== "number") {
      data.nextSpawnGuardIdValue = (data.spawnGuards || []).reduce((max, guard) => Math.max(max, guard.id || 0), 0) + 1;
    }
    if (typeof data.nextSettlementIdValue !== "number") data.nextSettlementIdValue = data.settlements.reduce((max, settlement) => Math.max(max, settlement.id || 0), 0) + 1;
    if (typeof data.nextAllianceIdValue !== "number") data.nextAllianceIdValue = data.alliances.reduce((max, alliance) => Math.max(max, alliance.id || 0), 0) + 1;
    for (const settlement of data.settlements) {
      if (!settlement.members) settlement.members = {};
      if (!Array.isArray(settlement.wars)) settlement.wars = [];
      if (!Array.isArray(settlement.warInitiatedAgainst)) settlement.warInitiatedAgainst = [];
      ensureWarCooldownData(settlement);
      if (!Array.isArray(settlement.buildings)) settlement.buildings = [];
      if (!Array.isArray(settlement.borderBlocks)) settlement.borderBlocks = [];
      ensureSettlementArmyData(settlement);
      ensureSettlementTradeData(settlement);
      if (typeof settlement.morale !== "number") settlement.morale = 75;
      if (typeof settlement.territoryBonus !== "number") settlement.territoryBonus = 0;
      ensureSettlementChunks(settlement, settlementType(settlement).radius);
      if (!Array.isArray(settlement.capturedChunks)) settlement.capturedChunks = [];
      if (typeof settlement.condemnationDemotesApplied !== "number") settlement.condemnationDemotesApplied = 0;
      ensureSettlementMintOwned(settlement);
    }
    ensureMintWorkshops(data);
    for (const record of data.mintWorkshops) {
      migrateMintWorkshopRecord(record);
      const ownerSettlement = getSettlement(data, record.settlementId);
      if (ownerSettlement) {
        ensureSettlementMintOwned(ownerSettlement);
        ownerSettlement.mintOwned[record.tier] = true;
      }
    }
    if (typeof data.nextMintWorkshopIdValue !== "number") {
      data.nextMintWorkshopIdValue = data.mintWorkshops.reduce((max, entry) => Math.max(max, entry.id || 0), 0) + 1;
    }
    if (!Array.isArray(data.pendingPlayerPayouts)) data.pendingPlayerPayouts = [];
    if (typeof data.nextTradeOfferIdValue !== "number") data.nextTradeOfferIdValue = 1;
    ensureWarCampaigns(data);
    if (typeof data.nextWarCampaignIdValue !== "number") data.nextWarCampaignIdValue = 1;
    if (!Array.isArray(data.condemnations)) data.condemnations = [];
    for (const zone of data.lootZones) {
      if (!Array.isArray(zone.winnerSettlementIds) || !zone.winnerSettlementIds.length) {
        zone.winnerSettlementIds = zone.winnerSettlementId ? [zone.winnerSettlementId] : [];
      }
    }
    return data;
  } catch (error) {
    world.sendMessage(`§c[Королевства] Ошибка чтения данных: ${error}`);
    return emptyData();
  }
}

function saveData(data) {
  data.version = 1;
  const serialized = JSON.stringify(data);
  if (serialized.length > STORE_LIMIT) {
    world.sendMessage("§c[Королевства] Слишком много данных для одного мира. Удалите часть старых поселений или перенесите хранилище в несколько ключей.");
    return false;
  }
  world.setDynamicProperty(STORE_KEY, serialized);
  return true;
}

function emptyData() {
  return {
    version: 1,
    settlements: [],
    alliances: [],
    lootZones: [],
    spawnGuards: [],
    warCampaigns: [],
    condemnations: [],
    mintWorkshops: [],
    nextSettlementIdValue: 1,
    nextAllianceIdValue: 1,
    nextSpawnGuardIdValue: 1,
    nextWarCampaignIdValue: 1,
    nextMintWorkshopIdValue: 1
  };
}

function nextSettlementId(data) {
  const id = data.nextSettlementIdValue || 1;
  data.nextSettlementIdValue = id + 1;
  return id;
}

function nextAllianceId(data) {
  const id = data.nextAllianceIdValue || 1;
  data.nextAllianceIdValue = id + 1;
  return id;
}

function nextSpawnGuardId(data) {
  const id = data.nextSpawnGuardIdValue || 1;
  data.nextSpawnGuardIdValue = id + 1;
  return id;
}

function findSettlementByFlag(data, block) {
  const position = blockPosition(block.location);
  const dimensionId = getDimensionId(block.dimension);
  return data.settlements.find((settlement) => settlement.dimensionId === dimensionId && sameBlock(settlement.flag, position));
}

function findSettlementByFlagEntity(data, entity) {
  const tag = entity.getTags?.().find((entry) => entry.startsWith("kingdoms_id_"));
  if (tag) {
    const id = Number(tag.replace("kingdoms_id_", ""));
    const settlement = getSettlement(data, id);
    if (settlement) return settlement;
  }

  const position = blockPosition(entity.location);
  const dimensionId = getDimensionId(entity.dimension);
  return data.settlements.find((settlement) => settlement.dimensionId === dimensionId && distance2D(settlement.flag, position) <= 1.5);
}

function spawnOrUpdateFlagEntity(settlement, data, existingEntity) {
  const dimension = safeDimension(settlement.dimensionId);
  if (!dimension) return undefined;

  const tag = settlementTag(settlement.id);
  const location = getFlagEntityLocation(settlement.flag);
  let flags = [];
  try {
    flags = dimension.getEntities({ type: FLAG_ENTITY, tags: [tag] });
  } catch (_error) {
    flags = [];
  }

  const flag = existingEntity?.isValid ? existingEntity : (flags[0] ?? dimension.spawnEntity(FLAG_ENTITY, location));
  if (!flag.hasTag("kingdoms_flag")) flag.addTag("kingdoms_flag");
  if (!flag.hasTag(tag)) flag.addTag(tag);
  flag.removeTag(PENDING_SETUP_TAG);
  flag.nameTag = settlementLabel(data, settlement);
  try { flag.teleport(location, { dimension }); } catch (_error) { /* Keep the entity if teleport is unavailable. */ }

  for (const duplicate of flags.slice(1)) duplicate.remove();
  return flag;
}

function findSettlementAt(data, location, dimensionId) {
  return findSettlementAtLocation(data, location, dimensionId);
}

function findLootZoneAt(data, location, dimensionId) {
  return data.lootZones.find((zone) => zone.dimensionId === dimensionId && zone.expiresTick > system.currentTick && distance2D(zone.center, location) <= zone.radius);
}

function findTerritoryOverlap(data, center, dimensionId, radius, ignoreSettlementId, alliedAllianceId, ignoredLoserId) {
  const proposed = chunksInRadius(center, radius);
  for (const settlement of data.settlements) {
    if (settlement.id === ignoreSettlementId || settlement.id === ignoredLoserId) continue;
    if (settlement.dimensionId !== dimensionId) continue;
    if (alliedAllianceId && settlement.allianceId === alliedAllianceId) continue;
    ensureSettlementChunks(settlement, settlementType(settlement).radius);
    for (const key of proposed) {
      const { cx, cz } = parseChunkKey(key);
      if (ownsChunk(settlement, cx, cz)) return settlement;
    }
  }
  return undefined;
}

function canGriefDuringGlobalWar(data, territorySettlement, playerName) {
  const playerSettlement = getPlayerSettlement(data, playerName);
  if (!playerSettlement || playerSettlement.id === territorySettlement.id) return false;
  const campaign = findWarCampaignBetween(data, playerSettlement, territorySettlement);
  if (!campaign || !isGlobalWarCampaign(campaign) || campaign.ended) return false;
  return isWarCombatActive(campaign, system.currentTick);
}

function hasTerritoryAccess(data, settlement, playerName) {
  if (isMember(settlement, playerName)) return true;
  if (settlement.allianceId && data.settlements.some((candidate) => candidate.allianceId === settlement.allianceId && isMember(candidate, playerName))) {
    return true;
  }
  return canGriefDuringGlobalWar(data, settlement, playerName);
}

function hasLootAccess(data, zone, playerName) {
  const winnerIds = Array.isArray(zone.winnerSettlementIds) && zone.winnerSettlementIds.length
    ? zone.winnerSettlementIds
    : (zone.winnerSettlementId ? [zone.winnerSettlementId] : []);
  for (const settlementId of winnerIds) {
    const winner = getSettlement(data, settlementId);
    if (winner && isMember(winner, playerName)) return true;
  }
  return false;
}

function getPlayerSettlement(data, playerName) {
  return data.settlements.find((settlement) => samePlayerName(settlement.creatorName, playerName))
    ?? data.settlements.find((settlement) => Object.keys(settlement.members || {}).some((memberName) => samePlayerName(memberName, playerName)));
}

function isMember(settlement, playerName) {
  return samePlayerName(settlement.creatorName, playerName)
    || Object.keys(settlement.members || {}).some((memberName) => samePlayerName(memberName, playerName));
}

function areAllied(data, firstId, secondId) {
  if (firstId === secondId) return true;
  const first = getSettlement(data, firstId);
  const second = getSettlement(data, secondId);
  return Boolean(first?.allianceId && first.allianceId === second?.allianceId);
}

function isAtWar(settlement, targetId) {
  return (settlement.wars || []).includes(targetId);
}

function requireOwner(player, settlement) {
  if (settlement.creatorName === getPlayerName(player)) return true;
  player.sendMessage("§cЭто действие доступно только создателю поселения.");
  return false;
}

function getSettlement(data, settlementId) {
  return data.settlements.find((settlement) => settlement.id === settlementId);
}

function getAlliance(data, allianceId) {
  if (!allianceId) return undefined;
  return data.alliances.find((alliance) => alliance.id === allianceId);
}

function settlementType(settlement) {
  return SETTLEMENT_TYPES[settlement.typeIndex] ?? SETTLEMENT_TYPES[0];
}

function getMaxHp(settlement) {
  return settlementType(settlement).hp;
}

function getTerritoryRadius(settlement) {
  ensureSettlementChunks(settlement, settlementType(settlement).radius);
  const chunkCount = getTerritoryChunkCount(settlement);
  return Math.max(settlementType(settlement).radius + (settlement.territoryBonus || 0), Math.ceil(Math.sqrt(chunkCount) * 12));
}

function getPopulation(settlement) {
  return 1 + Object.keys(settlement.members || {}).length;
}

function settlementTerritoryLabel(settlement) {
  return `${settlementType(settlement).name} "${settlement.name}"`;
}

function updatePlayerTerritoryMessages() {
  const data = loadData();

  for (const player of world.getPlayers()) {
    if (!player?.isValid) continue;

    const dimensionId = getDimensionId(player.dimension);
    const settlement = findSettlementAt(data, player.location, dimensionId);
    const currentId = settlement?.id ?? null;
    const previousId = playerTerritoryState.get(player.id);

    if (previousId === undefined) {
      playerTerritoryState.set(player.id, currentId);
      if (settlement) notifyTerritoryEnter(player, settlement);
      continue;
    }

    if (currentId === previousId) continue;

    const previousSettlement = previousId ? getSettlement(data, previousId) : undefined;
    if (previousSettlement) notifyTerritoryExit(player, previousSettlement);
    if (settlement) notifyTerritoryEnter(player, settlement);
    playerTerritoryState.set(player.id, currentId);
  }
}

function notifyTerritoryEnter(player, settlement) {
  const label = settlementTerritoryLabel(settlement);
  if (isMember(settlement, getPlayerName(player))) {
    player.sendMessage(`§aВы вошли в ${label}.`);
    return;
  }
  player.sendMessage(`§eВы вошли в ${label}.`);
}

function notifyTerritoryExit(player, settlement) {
  const label = settlementTerritoryLabel(settlement);
  if (isMember(settlement, getPlayerName(player))) {
    player.sendMessage(`§7Вы покинули ${label}.`);
    return;
  }
  player.sendMessage(`§7Вы покинули ${label}.`);
}

function cleanName(value) {
  return String(value ?? "").replace(/[\n\r§]/g, "").trim().slice(0, 32);
}

function cleanChatMessage(value) {
  return String(value ?? "").replace(/§/g, "");
}

function shortText(value, maxLength) {
  const text = String(value ?? "").replace(/[\n\r§]/g, "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function showForm(player, form) {
  if (!player?.isValid) return { canceled: true };
  if (formBusyPlayers.has(player.id)) return { canceled: true };
  formBusyPlayers.add(player.id);
  try {
    return await form.show(player);
  } catch (error) {
    player.sendMessage(`§cНе удалось открыть меню: ${error}`);
    return { canceled: true };
  } finally {
    formBusyPlayers.delete(player.id);
  }
}

const FORM_CHAIN_DELAY_TICKS = 3;

function deferMenu(player, fn) {
  system.runTimeout(() => {
    if (!player?.isValid) return;
    fn();
  }, FORM_CHAIN_DELAY_TICKS);
}

async function showFormDeferred(player, form, delayTicks = FORM_CHAIN_DELAY_TICKS) {
  return new Promise((resolve) => {
    system.runTimeout(async () => {
      if (!player?.isValid) {
        resolve({ canceled: true });
        return;
      }
      resolve(await showForm(player, form));
    }, delayTicks);
  });
}

async function pickFromActionList(player, title, body, items, options = {}) {
  const {
    getLabel = (item) => String(item),
    icon = "textures/ui/icon_multiplayer",
    backLabel = "Назад",
    showBack = true,
    menuPage,
    noIcon = false
  } = options;

  if (!items.length) return { canceled: true, empty: true };

  const form = new ActionFormData().title(menuPage ? kingdomsMenuTitle(menuPage) : title);
  if (body) form.body(body);
  for (const item of items) form.button(getLabel(item), noIcon ? "" : icon);
  if (showBack) form.button(backLabel, "textures/ui/kingdoms/icon_disband");

  const response = await showFormDeferred(player, form);
  if (response.canceled) return { canceled: true };
  const selection = Number(response.selection);
  if (Number.isNaN(selection)) return { canceled: true };
  if (showBack && selection >= items.length) return { canceled: true, back: true };
  if (selection < 0 || selection >= items.length) return { canceled: true };
  return { canceled: false, index: selection, item: items[selection] };
}

function giveCurrency(player, copperAmount) {
  giveCopperValue(player, copperAmount);
}

function countItem(player, typeId) {
  const inventory = getInventory(player);
  if (!inventory) return 0;

  let total = 0;
  for (let slot = 0; slot < inventory.size; slot += 1) {
    const item = inventory.getItem(slot);
    if (item?.typeId === typeId) total += item.amount;
  }
  return total;
}

function takeItem(player, typeId, amount) {
  const inventory = getInventory(player);
  if (!inventory || countItem(player, typeId) < amount) return false;

  let remaining = amount;
  for (let slot = 0; slot < inventory.size && remaining > 0; slot += 1) {
    const item = inventory.getItem(slot);
    if (item?.typeId !== typeId) continue;

    const removed = Math.min(item.amount, remaining);
    const newAmount = item.amount - removed;
    remaining -= removed;
    if (newAmount <= 0) inventory.setItem(slot, undefined);
    else {
      item.amount = newAmount;
      inventory.setItem(slot, item);
    }
  }

  return remaining === 0;
}

function getInventory(player) {
  return player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
}

function giveItems(player, typeId, amount) {
  let remaining = amount;
  while (remaining > 0) {
    const stackAmount = Math.min(64, remaining);
    giveSingleStack(player, new ItemStack(typeId, stackAmount));
    remaining -= stackAmount;
  }
}

function giveItemStack(player, stack) {
  giveSingleStack(player, stack);
}

function giveSingleStack(player, stack) {
  const inventory = getInventory(player);
  try {
    if (inventory) inventory.addItem(stack);
    else player.dimension.spawnItem(stack, player.location);
  } catch (_error) {
    player.dimension.spawnItem(stack, player.location);
  }
}

function removePlacedFlag(block, player) {
  setBlockToAir(block);
  giveItemStack(player, new ItemStack(FLAG_ITEM, 1));
}

function removeFlagBlock(settlement) {
  removeAllSettlementFlags(undefined, captureSettlementSnapshot(settlement));
}

function setBlockToAir(block) {
  try {
    block.setPermutation(BlockPermutation.resolve("minecraft:air"));
  } catch (_error) {
    try { block.setType("minecraft:air"); } catch (__error) { /* Some old runtimes reject both in early events. */ }
  }
}

function safeDimension(dimensionId) {
  try {
    return world.getDimension(dimensionId);
  } catch (_error) {
    return undefined;
  }
}

function getDimensionId(dimension) {
  return dimension.id.replace("minecraft:", "");
}

function getFlagPlacementLocation(clickedBlock, blockFace) {
  const offset = blockFaceOffset(blockFace);
  return {
    x: Math.floor(clickedBlock.location.x) + offset.x + 0.5,
    y: Math.floor(clickedBlock.location.y) + offset.y,
    z: Math.floor(clickedBlock.location.z) + offset.z + 0.5
  };
}

function getFlagEntityLocation(flagPosition) {
  return {
    x: Math.floor(flagPosition.x) + 0.5,
    y: Math.floor(flagPosition.y),
    z: Math.floor(flagPosition.z) + 0.5
  };
}

function blockFaceOffset(blockFace) {
  const face = String(blockFace ?? "up").toLowerCase();
  if (face.includes("down")) return { x: 0, y: -1, z: 0 };
  if (face.includes("north")) return { x: 0, y: 0, z: -1 };
  if (face.includes("south")) return { x: 0, y: 0, z: 1 };
  if (face.includes("west")) return { x: -1, y: 0, z: 0 };
  if (face.includes("east")) return { x: 1, y: 0, z: 0 };
  return { x: 0, y: 1, z: 0 };
}

function blockPosition(location) {
  return { x: Math.floor(location.x), y: Math.floor(location.y), z: Math.floor(location.z) };
}

function sameBlock(first, second) {
  return first.x === second.x && first.y === second.y && first.z === second.z;
}

function samePlayerName(first, second) {
  return String(first ?? "").toLowerCase() === String(second ?? "").toLowerCase();
}

function distance2D(first, second) {
  const dx = first.x - second.x;
  const dz = first.z - second.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function settlementTag(id) {
  return `kingdoms_id_${id}`;
}

function getPlayerName(player) {
  return player.name;
}

function getCurrentDay() {
  try {
    return Math.floor(world.getAbsoluteTime() / DAY_TICKS);
  } catch (_error) {
    return Math.floor(system.currentTick / DAY_TICKS);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
