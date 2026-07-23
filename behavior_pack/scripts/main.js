import * as server from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";
import {
  FLAG_ENTITY,
  FLAG_ITEM,
  FLAG_LABEL_ENTITY,
  LEGACY_FLAG_BLOCK,
  PENDING_SETUP_TAG
} from "./constants.js";
import { bindFlagSystem, setFlagPlacementHandler, setWildFlagSpawnHandler } from "./flag.js";

const { BlockPermutation, ItemStack, system, world } = server;
const STORE_KEY = "kingdoms:data:v1";
const STORE_LIMIT = 32767;
const SETTLEMENT_MENU_TITLE = "kingdoms:settlement";
const CREATION_COST = 15;
const DAY_TICKS = 24000;
const TAX_COOLDOWN_TICKS = 25 * 60 * 20;
const LOOT_WINDOW_TICKS = 5 * 60 * 20;
const LABEL_TAG = "kingdoms_flag_label";
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
  { name: "Деревня", hp: 120, radius: 35, tax: 4, minPlayers: 1, defeatReward: 8, upgradeCost: 0 },
  { name: "Большая деревня", hp: 180, radius: 55, tax: 8, minPlayers: 2, defeatReward: 14, upgradeCost: 80 },
  { name: "Городок", hp: 260, radius: 80, tax: 14, minPlayers: 3, defeatReward: 22, upgradeCost: 180 },
  { name: "Большой город", hp: 380, radius: 115, tax: 22, minPlayers: 4, defeatReward: 34, upgradeCost: 400 },
  { name: "Замок", hp: 560, radius: 150, tax: 32, minPlayers: 5, defeatReward: 52, upgradeCost: 800 },
  { name: "Королевство", hp: 780, radius: 220, tax: 44, minPlayers: 7, defeatReward: 80, upgradeCost: 1500 },
  { name: "Империя", hp: 1100, radius: 300, tax: 64, minPlayers: 10, defeatReward: 128, upgradeCost: 2500 }
];

const PREFIXES = [
  { name: "Крестьянин", description: "Добывает еду, дерево и базовые ресурсы для поселения." },
  { name: "Ремесленник", description: "Создаёт инструменты, блоки, оружие и помогает развивать инфраструктуру." },
  { name: "Стражник", description: "Охраняет ворота, флаг, склады и жителей на территории поселения." },
  { name: "Купец", description: "Ведёт торговлю, доставляет ресурсы и помогает поселению богатеть." },
  { name: "Дружинник", description: "Сражается в походах и защищает союзников во время войны." },
  { name: "Рыцарь", description: "Элитный воин поселения, отвечает за атаки, оборону и честь государства." },
  { name: "Дворянин", description: "Помогает управлять жителями, дипломатией и внутренним порядком." },
  { name: "Советник", description: "Даёт стратегические решения владельцу и координирует развитие." }
];

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

const flagInteractionCooldown = new Map();
const flagPlacementCooldown = new Map();
const pendingPlacementLocks = new Set();
/** @type {Map<string, { settlementId: number, buildingId: string, startedTick: number }>} */
const pendingBuildingPlacement = new Map();
const BUILDING_PLACE_TIMEOUT_TICKS = 60 * 20;
const playerPrefixCache = new Map();
const playerIdByName = new Map();
const chatPrefixNoticeShown = new Set();
const loadedNoticeShown = new Set();
let directChatPrefixAvailable = false;
let dynamicPropertiesRegistered = false;

bindFlagSystem(world);
setFlagPlacementHandler(beginSettlementCreationFromItem);
setWildFlagSpawnHandler(handleWildFlagEntitySpawn);

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
    playerIdByName.delete(event.playerName);
    chatPrefixNoticeShown.delete(event.playerName);
  }
  if (event.playerId) removePlayerPrefixLabelById(event.playerId);
});

world.afterEvents.playerPlaceBlock?.subscribe((event) => {
  if (event.block.typeId !== LEGACY_FLAG_BLOCK) return;
  system.run(() => beginSettlementCreation(event.player, event.block));
});

world.afterEvents.playerInteractWithBlock?.subscribe((event) => {
  if (event.block.typeId !== LEGACY_FLAG_BLOCK) return;
  handleFlagInteraction(event.player, event.block);
});

function handleFlagInteraction(player, flagSource) {
  const cooldownKey = `${getPlayerName(player)}:${getDimensionId(flagSource.dimension)}:${Math.floor(flagSource.location.x)}:${Math.floor(flagSource.location.y)}:${Math.floor(flagSource.location.z)}`;
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
  system.run(() => openSettlementMenu(player, settlement.id));
}

world.beforeEvents.playerBreakBlock?.subscribe((event) => {
  const data = loadData();
  const block = event.block;
  const playerName = getPlayerName(event.player);

  if (block.typeId === LEGACY_FLAG_BLOCK) {
    const settlement = findSettlementByFlag(data, block);
    if (!settlement) return;

    const attackerSettlement = getPlayerSettlement(data, playerName);
    const isEnemyAtWar = attackerSettlement && isAtWar(settlement, attackerSettlement.id);
    event.cancel = true;

    if (!isEnemyAtWar) {
      event.player.sendMessage("§cФлаг можно повредить только врагу во время объявленной войны. Владелец может расформировать поселение через меню флага.");
      return;
    }

    damageFlag(data, settlement, attackerSettlement, event.player);
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

  // Режим строительства: перехватываем обычную постановку блока (флаг сюда не проходит).
  if (pendingBuildingPlacement.has(playerName)) {
    event.cancel = true;
    const block = event.block;
    const player = event.player;
    system.run(() => tryPlacePendingBuilding(player, block));
    return;
  }

  const lootZone = findLootZoneAt(data, event.block.location, getDimensionId(event.block.dimension));
  if (lootZone && !hasLootAccess(data, lootZone, playerName)) {
    event.cancel = true;
    event.player.sendMessage(`§cЗона мародёрства "${lootZone.name}" временно доступна только победителям.`);
    return;
  }

  const settlement = findSettlementAt(data, event.block.location, getDimensionId(event.block.dimension));
  if (settlement && !hasTerritoryAccess(data, settlement, playerName)) {
    event.cancel = true;
    event.player.sendMessage(`§cЧужая территория: ${settlementDisplayName(data, settlement)}. Ставить блоки нельзя.`);
  }
});

world.beforeEvents.playerInteractWithBlock?.subscribe((event) => {
  const blockId = event.block.typeId;
  if (!PROTECTED_INTERACTIONS.includes(blockId)) return;

  const data = loadData();
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
  if (victim?.typeId === FLAG_ENTITY) {
    event.cancel = true;
    if (!attacker || attacker.typeId !== "minecraft:player") return;

    const data = loadData();
    const settlement = findSettlementByFlagEntity(data, victim);
    if (!settlement) {
      attacker.sendMessage("§cЭтот флаг не привязан к поселению.");
      return;
    }

    const attackerSettlement = getPlayerSettlement(data, getPlayerName(attacker));
    const isEnemyAtWar = attackerSettlement && isAtWar(settlement, attackerSettlement.id);
    if (!isEnemyAtWar) {
      attacker.sendMessage("§cФлаг можно бить только врагу во время объявленной войны.");
      return;
    }

    damageFlag(data, settlement, attackerSettlement, attacker);
    return;
  }

  if (!victim || !attacker || victim.typeId !== "minecraft:player" || attacker.typeId !== "minecraft:player") return;

  const data = loadData();
  const victimSettlement = getPlayerSettlement(data, getPlayerName(victim));
  const attackerSettlement = getPlayerSettlement(data, getPlayerName(attacker));
  if (!victimSettlement && !attackerSettlement) return;

  if (!victimSettlement || !attackerSettlement || !isAtWar(victimSettlement, attackerSettlement.id)) {
    event.cancel = true;
    attacker.sendMessage("§cНельзя наносить урон игрокам без войны между поселениями.");
  }
});

system.run(() => updatePlayerPrefixDisplays());

system.runInterval(() => updateFlagLabels(), 60);
system.runInterval(() => updateMoraleForNewDay(), 1200);
system.runInterval(() => cleanupExpiredLootZones(), 100);
system.runInterval(() => updatePlayerPrefixDisplays(), 40);

async function beginSettlementCreationFromItem(player, clickedBlock, blockFace, origin = "script") {
  if (!player || !clickedBlock) return;

  const playerName = getPlayerName(player);
  const dimensionId = getDimensionId(clickedBlock.dimension);
  const spawnLocation = getFlagPlacementLocation(clickedBlock, blockFace);
  const territoryCenter = blockPosition(spawnLocation);
  const lockKey = placementLockKey(dimensionId, territoryCenter);
  if (!lockPlacement(lockKey)) return;

  const validationError = validateNewSettlement(player, territoryCenter, dimensionId);
  if (validationError) {
    player.sendMessage(validationError);
    return;
  }

  let flagEntity = findPendingFlagEntityAt(territoryCenter, dimensionId);
  let flagItemConsumed = Boolean(flagEntity);

  if (!flagEntity) {
    const dimension = safeDimension(dimensionId);
    if (!dimension) {
      player.sendMessage("§cНе удалось получить измерение мира.");
      return;
    }

    try {
      flagEntity = dimension.spawnEntity(FLAG_ENTITY, getFlagEntityLocation(territoryCenter));
      flagEntity.addTag(PENDING_SETUP_TAG);
      flagItemConsumed = false;
      player.sendMessage(`§aФлаг-сущность установлена (${origin}).`);
    } catch (error) {
      player.sendMessage(`§cНе удалось создать флаг-сущность: ${error}`);
      return;
    }
  } else {
    player.sendMessage(`§7Флаг-сущность найдена (${origin}).`);
  }

  await runSettlementCreationFlow(player, {
    territoryCenter,
    dimensionId,
    flagEntity,
    flagItemConsumed
  });
}

async function handleWildFlagEntitySpawn(entity, knownPlayer) {
  if (!entity?.isValid || isRegisteredFlagEntity(entity)) return;

  const territoryCenter = blockPosition(entity.location);
  const dimensionId = getDimensionId(entity.dimension);
  const lockKey = placementLockKey(dimensionId, territoryCenter);
  if (!lockPlacement(lockKey)) return;

  const player = knownPlayer ?? findNearestPlayer(entity, 12);
  if (!player) {
    entity.addTag(PENDING_SETUP_TAG);
    return;
  }

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

  const form = new ModalFormData()
    .title("Создание поселения")
    .textField({
      label: `Название поселения (${CREATION_COST} изумрудов)`,
      placeholder: "Например: Новгород",
      defaultValue: `Поселение ${playerName}`
    });
  const response = await showForm(player, form);
  if (response.canceled) {
    player.sendMessage("§7Создание поселения отменено.");
    cleanupFailedPlacement(player, flagEntity, flagItemConsumed);
    return;
  }

  const name = cleanName(response.formValues?.[0]);
  if (!name) {
    player.sendMessage("§cНазвание не может быть пустым.");
    cleanupFailedPlacement(player, flagEntity, flagItemConsumed);
    return;
  }

  if (!takeItem(player, "minecraft:emerald", CREATION_COST)) {
    player.sendMessage(`§cНе хватает изумрудов. Нужно ${CREATION_COST}.`);
    cleanupFailedPlacement(player, flagEntity, flagItemConsumed);
    return;
  }

  if (!flagItemConsumed && !takeItem(player, FLAG_ITEM, 1)) {
    giveEmeralds(player, CREATION_COST);
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
    giveEmeralds(player, CREATION_COST);
    cleanupFailedPlacement(player, flagEntity, flagItemConsumed);
    player.sendMessage(`§cНе удалось закрепить флаг-сущность: ${error}`);
    return;
  }

  data.settlements.push(settlement);
  saveData(data);
  updateFlagLabelFor(settlement, data);
  updatePlayerPrefixDisplays(data);
  world.sendMessage(`§6[Королевства] §f${playerName} основал(а) ${settlementDisplayName(data, settlement)} за ${CREATION_COST} изумрудов.`);
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

function validateNewSettlement(player, territoryCenter, dimensionId) {
  const data = loadData();
  const playerName = getPlayerName(player);

  if (data.settlements.some((settlement) => samePlayerName(settlement.creatorName, playerName))) {
    return "§cУ вас уже есть поселение. Один создатель может владеть только одним флагом.";
  }

  if (countItem(player, "minecraft:emerald") < CREATION_COST) {
    return `§cДля создания поселения нужно ${CREATION_COST} изумрудов.`;
  }

  const overlap = findTerritoryOverlap(data, territoryCenter, dimensionId, SETTLEMENT_TYPES[0].radius, undefined, undefined);
  if (overlap) {
    return `§cСлишком близко к территории: ${settlementDisplayName(data, overlap)}.`;
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

  if (countItem(player, "minecraft:emerald") < CREATION_COST) {
    removePlacedFlag(block, player);
    player.sendMessage(`§cДля создания поселения нужно ${CREATION_COST} изумрудов.`);
    return;
  }

  const overlap = findTerritoryOverlap(data, block.location, dimensionId, SETTLEMENT_TYPES[0].radius, undefined, undefined);
  if (overlap) {
    removePlacedFlag(block, player);
    player.sendMessage(`§cСлишком близко к территории: ${settlementDisplayName(data, overlap)}.`);
    return;
  }

  const form = new ModalFormData()
    .title("Создание поселения")
    .textField({
      label: `Название поселения (${CREATION_COST} изумрудов)`,
      placeholder: "Например: Новгород",
      defaultValue: `Поселение ${playerName}`
    });
  const response = await showForm(player, form);
  if (response.canceled) {
    removePlacedFlag(block, player);
    player.sendMessage("§7Создание поселения отменено, флаг возвращён.");
    return;
  }

  const name = cleanName(response.formValues?.[0]);
  if (!name) {
    removePlacedFlag(block, player);
    player.sendMessage("§cНазвание не может быть пустым.");
    return;
  }

  if (!takeItem(player, "minecraft:emerald", CREATION_COST)) {
    removePlacedFlag(block, player);
    player.sendMessage(`§cНе хватает изумрудов. Нужно ${CREATION_COST}.`);
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
  saveData(data);
  updateFlagLabelFor(settlement);
  updatePlayerPrefixDisplays(data);
  world.sendMessage(`§6[Королевства] §f${playerName} основал(а) ${settlementDisplayName(data, settlement)} за ${CREATION_COST} изумрудов.`);
}

async function openSettlementMenu(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement) {
    player.sendMessage("§cПоселение не найдено.");
    return;
  }

  const nextType = SETTLEMENT_TYPES[settlement.typeIndex + 1];
  const upgradeLabel = nextType ? `Улучшить до: ${nextType.name} (${nextType.upgradeCost} изумрудов)` : "Максимум развития";
  const form = new ActionFormData()
    .title(SETTLEMENT_MENU_TITLE)
    .body(settlementInfo(data, settlement))
    .button(upgradeLabel, "textures/ui/kingdoms/icon_upgrade")
    .button("Жители", "textures/ui/kingdoms/icon_residents")
    .button("Префиксы", "textures/ui/kingdoms/icon_prefixes")
    .button("О префиксах", "textures/ui/kingdoms/icon_info")
    .button("Создать альянс", "textures/ui/kingdoms/icon_alliance")
    .button("Объявить войну", "textures/ui/kingdoms/icon_war")
    .button("Налог", "textures/ui/kingdoms/icon_tax")
    .button("Строительство", "textures/ui/kingdoms/icon_build")
    .button("Расформировать", "textures/ui/kingdoms/icon_disband");

  const response = await showForm(player, form);
  if (response.canceled) return;

  switch (response.selection) {
    case 0:
      return upgradeSettlement(player, settlementId);
    case 1:
      return openResidentsMenu(player, settlementId);
    case 2:
      return openPrefixesMenu(player, settlementId);
    case 3:
      return openPrefixInfo(player, settlementId);
    case 4:
      return openAllianceMenu(player, settlementId);
    case 5:
      return openWarMenu(player, settlementId);
    case 6:
      return claimTax(player, settlementId);
    case 7:
      return openConstructionMenu(player, settlementId);
    case 8:
      return confirmDisband(player, settlementId);
    default:
      return undefined;
  }
}

async function upgradeSettlement(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const nextType = SETTLEMENT_TYPES[settlement.typeIndex + 1];
  if (!nextType) {
    player.sendMessage("§7Это уже максимальный тип поселения.");
    return;
  }

  const overlap = findTerritoryOverlap(data, settlement.flag, settlement.dimensionId, nextType.radius + (settlement.territoryBonus || 0), settlement.id, settlement.allianceId);
  if (overlap) {
    player.sendMessage(`§cНельзя улучшить: новая территория пересечётся с ${settlementDisplayName(data, overlap)}.`);
    return;
  }

  if (!takeItem(player, "minecraft:emerald", nextType.upgradeCost)) {
    player.sendMessage(`§cДля улучшения до "${nextType.name}" нужно ${nextType.upgradeCost} изумрудов.`);
    return;
  }

  settlement.typeIndex += 1;
  settlement.creatorPrefix = creatorPrefixFor(settlement.typeIndex);
  settlement.hp = getMaxHp(settlement);
  settlement.morale = Math.min(100, settlement.morale + 10);
  saveData(data);
  updateFlagLabelFor(settlement);
  updatePlayerPrefixDisplays(data);
  world.sendMessage(`§6[Королевства] §f${settlementDisplayName(data, settlement)} улучшено за ${nextType.upgradeCost} изумрудов. Мораль выросла.`);
}

async function openResidentsMenu(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const response = await showForm(player, new ActionFormData()
    .title("Жители")
    .body("Добавляйте игроков в поселение или исключайте их из списка жителей.")
    .button("Добавить игрока")
    .button("Исключить игрока")
    .button("Назад"));
  if (response.canceled) return;
  if (response.selection === 0) return addResident(player, settlementId);
  if (response.selection === 1) return removeResident(player, settlementId);
  return openSettlementMenu(player, settlementId);
}

async function addResident(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const candidates = world.getPlayers()
    .map((candidate) => getPlayerName(candidate))
    .filter((name) => name !== settlement.creatorName && !settlement.members[name]);
  if (!candidates.length) {
    player.sendMessage("§7Нет онлайн-игроков, которых можно добавить.");
    return;
  }

  const form = new ModalFormData().title("Добавить жителя").dropdown("Игрок", candidates, 0);
  const response = await showForm(player, form);
  if (response.canceled) return;

  const name = candidates[response.formValues?.[0] ?? 0];
  settlement.members[name] = { prefix: PREFIXES[0].name, joinedTick: system.currentTick };
  saveData(data);
  updatePlayerPrefixDisplays(data);
  world.sendMessage(`§6[Королевства] §f${name} теперь житель ${settlementDisplayName(data, settlement)}.`);
}

async function removeResident(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const members = Object.keys(settlement.members);
  if (!members.length) {
    player.sendMessage("§7В поселении пока нет жителей.");
    return;
  }

  const form = new ModalFormData().title("Исключить жителя").dropdown("Житель", members, 0);
  const response = await showForm(player, form);
  if (response.canceled) return;

  const name = members[response.formValues?.[0] ?? 0];
  delete settlement.members[name];
  saveData(data);
  updatePlayerPrefixDisplays(data);
  world.sendMessage(`§6[Королевства] §f${name} исключён(а) из ${settlementDisplayName(data, settlement)}.`);
}

async function openPrefixesMenu(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const members = Object.keys(settlement.members);
  if (!members.length) {
    player.sendMessage("§7Сначала добавьте жителей.");
    return;
  }

  const memberResponse = await showForm(player, new ModalFormData().title("Префиксы").dropdown("Житель", members, 0));
  if (memberResponse.canceled) return;
  const memberName = members[memberResponse.formValues?.[0] ?? 0];

  const prefixResponse = await showForm(player, new ModalFormData()
    .title(`Префикс для ${memberName}`)
    .dropdown("Статус", PREFIXES.map((prefix) => prefix.name), 0));
  if (prefixResponse.canceled) return;

  settlement.members[memberName].prefix = PREFIXES[prefixResponse.formValues?.[0] ?? 0].name;
  saveData(data);
  updatePlayerPrefixDisplays(data);
  player.sendMessage(`§a${memberName}: ${settlement.members[memberName].prefix}.`);
}

async function openPrefixInfo(player, settlementId) {
  const body = PREFIXES.map((prefix) => `§6${prefix.name}§r — ${prefix.description}`).join("\n\n");
  await showForm(player, new ActionFormData().title("О префиксах").body(body).button("Назад"));
  return openSettlementMenu(player, settlementId);
}

async function openAllianceMenu(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const targets = data.settlements.filter((candidate) => candidate.id !== settlement.id && !areAllied(data, candidate.id, settlement.id));
  if (!targets.length) {
    player.sendMessage("§7Нет поселений для нового альянса.");
    return;
  }

  const labels = targets.map((candidate) => `${settlementDisplayName(data, candidate)} | Создатель: ${candidate.creatorName}`);
  const response = await showForm(player, new ModalFormData().title("Создать альянс").dropdown("Поселение", labels, 0));
  if (response.canceled) return;

  const target = targets[response.formValues?.[0] ?? 0];
  const targetOwner = world.getPlayers().find((online) => getPlayerName(online) === target.creatorName);
  if (!targetOwner) {
    player.sendMessage("§cСоздатель выбранного поселения должен быть онлайн, чтобы принять альянс.");
    return;
  }

  const answer = await showForm(targetOwner, new MessageFormData()
    .title("Предложение альянса")
    .body(`${settlement.creatorName} предлагает объединить территории: ${settlementDisplayName(data, settlement)} + ${settlementDisplayName(data, target)}. Если принять, инициатор выберет общее название альянса, которое будет отображаться у поселений.`)
    .button1("Принять")
    .button2("Отклонить"));

  if (answer.canceled || answer.selection !== 0) {
    player.sendMessage("§7Альянс отклонён.");
    return;
  }

  const nameResponse = await showForm(player, new ModalFormData()
    .title("Название альянса")
    .textField({
      label: "Название альянса",
      placeholder: "Например: Северная корона",
      defaultValue: `${settlement.name} и ${target.name}`
    }));
  if (nameResponse.canceled) return;

  const name = cleanName(nameResponse.formValues?.[0]);
  if (!name) {
    player.sendMessage("§cНазвание альянса не может быть пустым.");
    return;
  }

  const fresh = loadData();
  const ownFresh = getSettlement(fresh, settlement.id);
  const targetFresh = getSettlement(fresh, target.id);
  if (!ownFresh || !targetFresh || areAllied(fresh, ownFresh.id, targetFresh.id)) return;

  const alliance = { id: nextAllianceId(fresh), name, members: [ownFresh.id, targetFresh.id], createdTick: system.currentTick };
  fresh.alliances.push(alliance);
  ownFresh.allianceId = alliance.id;
  targetFresh.allianceId = alliance.id;
  ownFresh.morale = Math.min(100, ownFresh.morale + 4);
  targetFresh.morale = Math.min(100, targetFresh.morale + 4);
  saveData(fresh);
  world.sendMessage(`§6[Королевства] §fСоздан альянс "${name}" между ${ownFresh.name} и ${targetFresh.name}. Их территории объединены.`);
}

async function openWarMenu(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const targets = data.settlements.filter((candidate) => {
    if (candidate.id === settlement.id) return false;
    if (areAllied(data, candidate.id, settlement.id)) return false;
    if (isAtWar(settlement, candidate.id)) return false;
    return Math.abs(candidate.typeIndex - settlement.typeIndex) <= 1;
  });

  if (!targets.length) {
    player.sendMessage("§7Нет подходящих целей: войну можно объявить равному типу поселения, на один тип ниже или на один тип выше.");
    return;
  }

  const labels = targets.map((candidate) => `${settlementType(candidate).name} "${candidate.name}" | ${candidate.creatorName}`);
  const response = await showForm(player, new ModalFormData().title("Объявить войну").dropdown("Цель", labels, 0));
  if (response.canceled) return;

  const target = targets[response.formValues?.[0] ?? 0];
  settlement.wars.push(target.id);
  target.wars.push(settlement.id);
  settlement.morale = Math.max(0, settlement.morale - 6);
  target.morale = Math.max(0, target.morale - 6);
  saveData(data);
  world.sendMessage(`§4[Война] §f${settlementDisplayName(data, settlement)} объявило войну ${settlementDisplayName(data, target)}. Победа достигается уничтожением вражеского флага.`);
}

function claimTax(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const elapsed = system.currentTick - (settlement.lastTaxTick ?? -TAX_COOLDOWN_TICKS);
  if (elapsed < TAX_COOLDOWN_TICKS) {
    const remainingSeconds = Math.ceil((TAX_COOLDOWN_TICKS - elapsed) / 20);
    player.sendMessage(`§7Налог можно забрать позже. Осталось примерно ${Math.ceil(remainingSeconds / 60)} мин.`);
    return;
  }

  const amount = settlementType(settlement).tax + getExtraIncomeBonus(settlement);
  giveEmeralds(player, amount);
  settlement.lastTaxTick = system.currentTick;
  saveData(data);
  const extra = getExtraIncomeBonus(settlement);
  player.sendMessage(
    extra > 0
      ? `§aНалог собран: ${amount} изумруд(ов) §7(база + доп. заработок ${extra}).`
      : `§aНалог собран: ${amount} изумруд(ов).`
  );
}

async function confirmDisband(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const response = await showForm(player, new MessageFormData()
    .title("Расформировать")
    .body("Вы правда хотите расформировать своё поселение/государство? Флаг и защита территории исчезнут.")
    .button1("Принять")
    .button2("Отклонить"));
  if (response.canceled || response.selection !== 0) return;

  disbandSettlement(data, settlement.id, "создатель расформировал государство");
  saveData(data);
}


/**
 * Каталог построек поселения.
 * cost — материалы на покупку/размещение.
 * taxBonus — добавка к налогу каждые 25 мин.
 * footprint — размер площадки (ширина x глубина), высота по схеме.
 */

const BUILDINGS = {
  bakery: {
    id: "bakery",
    name: "Пекарня",
    description: "Небольшая пекарня. Даёт скромный бонус к налогу поселения.",
    taxBonus: 2,
    maxPerSettlement: 1,
    /** Ширина (X) и глубина (Z) относительно точки клика. */
    size: { width: 5, depth: 5, height: 4 },
    cost: [
      { itemId: "minecraft:emerald", amount: 10, label: "изумруды" },
      { itemId: "minecraft:oak_log", amount: 24, label: "дубовые брёвна" },
      { itemId: "minecraft:cobblestone", amount: 16, label: "булыжник" },
      { itemId: "minecraft:oak_planks", amount: 20, label: "дубовые доски" },
      { itemId: "minecraft:glass", amount: 4, label: "стекло" },
      { itemId: "minecraft:wheat", amount: 8, label: "пшеница" }
    ]
  }
};

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

/**
 * Схема пекарни: локальные координаты относительно угла (0,0,0).
 * y = 0 — пол.
 */
function getBakeryBlueprint() {
  const blocks = [];
  const W = 5;
  const D = 5;

  const put = (x, y, z, typeId) => {
    blocks.push({ x, y, z, typeId });
  };

  // Пол
  for (let x = 0; x < W; x += 1) {
    for (let z = 0; z < D; z += 1) {
      put(x, 0, z, "minecraft:oak_planks");
    }
  }

  // Стены 1 уровня
  for (let x = 0; x < W; x += 1) {
    for (let z = 0; z < D; z += 1) {
      const edge = x === 0 || z === 0 || x === W - 1 || z === D - 1;
      if (!edge) continue;
      // Дверной проём спереди по центру
      if (z === 0 && x === 2) continue;
      put(x, 1, z, "minecraft:oak_log");
    }
  }

  // Окна / второй уровень стен
  for (let x = 0; x < W; x += 1) {
    for (let z = 0; z < D; z += 1) {
      const edge = x === 0 || z === 0 || x === W - 1 || z === D - 1;
      if (!edge) continue;
      if (z === 0 && x === 2) continue;
      if ((x === 0 || x === W - 1) && z === 2) {
        put(x, 2, z, "minecraft:glass");
      } else {
        put(x, 2, z, "minecraft:cobblestone");
      }
    }
  }

  // Крыша (плиты — без ориентации)
  for (let x = 0; x < W; x += 1) {
    for (let z = 0; z < D; z += 1) {
      put(x, 3, z, "minecraft:oak_slab");
    }
  }

  // Интерьер
  put(1, 1, 3, "minecraft:furnace");
  put(3, 1, 3, "minecraft:smoker");
  put(2, 1, 3, "minecraft:crafting_table");
  put(1, 1, 1, "minecraft:barrel");
  put(3, 1, 1, "minecraft:hay_block");

  return blocks;
}

function getBlueprint(buildingId) {
  if (buildingId === "bakery") return getBakeryBlueprint();
  return [];
}


async function openConstructionMenu(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const buildings = listBuildings();
  const lines = [
    "Покупайте постройки для доп. заработка к налогу.",
    "После покупки ПОСТАВЬ любой блок на своей территории — на его месте появится здание.",
    "",
    formatExtraIncomeLine(settlement)
  ];

  const form = new ActionFormData()
    .title(SETTLEMENT_MENU_TITLE)
    .body(lines.join("\n"));

  for (const def of buildings) {
    const owned = countBuildingsOfType(settlement, def.id);
    const limit = def.maxPerSettlement ?? 1;
    const status = owned >= limit ? "§cпостроена" : `§a+${def.taxBonus} налог`;
    form.button(`${def.name} (${status}§r)`, "textures/ui/kingdoms/icon_build");
  }
  form.button("Отмена размещения", "textures/ui/kingdoms/icon_info");
  form.button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await showForm(player, form);
  if (response.canceled) return;

  if (response.selection === buildings.length) {
    clearPendingBuilding(getPlayerName(player), player, "§7Режим размещения отменён.");
    return openConstructionMenu(player, settlementId);
  }
  if (response.selection === buildings.length + 1) {
    return openSettlementMenu(player, settlementId);
  }

  const selected = buildings[response.selection];
  if (!selected) return;
  return openBuildingDetails(player, settlementId, selected.id);
}

async function openBuildingDetails(player, settlementId, buildingId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement || !requireOwner(player, settlement)) return;

  const def = getBuildingDef(buildingId);
  if (!def) return;

  const owned = countBuildingsOfType(settlement, buildingId);
  const limit = def.maxPerSettlement ?? 1;
  const costText = formatBuildingCost(def);
  const body = [
    def.name,
    def.description,
    `Бонус к налогу: +${def.taxBonus} изумр./25м`,
    `Размер: ${def.size.width}×${def.size.depth}`,
    `Уже построено: ${owned}/${limit}`,
    `Стоимость: ${costText}`,
    "",
    "Материалы списываются только после успешного размещения.",
    "Поставьте любой блок на территории — здание появится над ним."
  ].join("\n");

  const form = new ActionFormData()
    .title(SETTLEMENT_MENU_TITLE)
    .body(body)
    .button(owned >= limit ? "Лимит достигнут" : "Купить и разместить", "textures/ui/kingdoms/icon_build")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await showForm(player, form);
  if (response.canceled) return;
  if (response.selection !== 0) return openConstructionMenu(player, settlementId);
  if (owned >= limit) {
    player.sendMessage(`§cВ поселении уже есть максимум построек этого типа (${limit}).`);
    return openConstructionMenu(player, settlementId);
  }

  const missing = getMissingBuildingCost(player, def);
  if (missing.length) {
    player.sendMessage(`§cНе хватает материалов: ${missing.join(", ")}`);
    return openConstructionMenu(player, settlementId);
  }

  pendingBuildingPlacement.set(getPlayerName(player), {
    settlementId,
    buildingId,
    startedTick: system.currentTick
  });
  player.sendMessage(`§aРежим размещения: §f${def.name}`);
  player.sendMessage("§7Поставьте любой блок на территории поселения (60 сек).");
  player.sendMessage("§8Отмена — Строительство → Отмена размещения.");
}

function getMissingBuildingCost(player, def) {
  const missing = [];
  for (const entry of def.cost || []) {
    const have = countItem(player, entry.itemId);
    if (have < entry.amount) missing.push(`${entry.label} (${have}/${entry.amount})`);
  }
  return missing;
}

function takeBuildingCost(player, def) {
  for (const entry of def.cost || []) {
    if (countItem(player, entry.itemId) < entry.amount) return false;
  }
  for (const entry of def.cost || []) {
    if (!takeItem(player, entry.itemId, entry.amount)) return false;
  }
  return true;
}

function clearPendingBuilding(playerName, player, message) {
  pendingBuildingPlacement.delete(playerName);
  if (player && message) player.sendMessage(message);
}

function tryPlacePendingBuilding(player, clickedBlock) {
  const playerName = getPlayerName(player);
  const pending = pendingBuildingPlacement.get(playerName);
  if (!pending) return;

  if (system.currentTick - pending.startedTick > BUILDING_PLACE_TIMEOUT_TICKS) {
    clearPendingBuilding(playerName, player, "§cВремя размещения истекло.");
    return;
  }

  const data = loadData();
  const settlement = getSettlement(data, pending.settlementId);
  const def = getBuildingDef(pending.buildingId);
  if (!settlement || !def) {
    clearPendingBuilding(playerName, player, "§cНе удалось разместить постройку.");
    return;
  }

  if (!requireOwner(player, settlement)) {
    clearPendingBuilding(playerName, player);
    return;
  }

  if (countBuildingsOfType(settlement, def.id) >= (def.maxPerSettlement ?? 1)) {
    clearPendingBuilding(playerName, player, "§cЛимит этой постройки уже достигнут.");
    return;
  }

  if (getDimensionId(clickedBlock.dimension) !== settlement.dimensionId) {
    player.sendMessage("§cПостройку можно ставить только в измерении поселения.");
    return;
  }

  const origin = {
    x: Math.floor(clickedBlock.location.x) - Math.floor(def.size.width / 2),
    y: Math.floor(clickedBlock.location.y) + 1,
    z: Math.floor(clickedBlock.location.z) - Math.floor(def.size.depth / 2)
  };

  const footprintError = validateBuildingFootprint(data, settlement, origin, def);
  if (footprintError) {
    player.sendMessage(`§c${footprintError}`);
    return;
  }

  const missing = getMissingBuildingCost(player, def);
  if (missing.length) {
    clearPendingBuilding(playerName, player, `§cНе хватает материалов: ${missing.join(", ")}`);
    return;
  }

  if (!takeBuildingCost(player, def)) {
    clearPendingBuilding(playerName, player, "§cНе удалось списать материалы.");
    return;
  }

  const placedCount = placeBuildingBlueprint(clickedBlock.dimension, origin, def.id);
  if (!placedCount) {
    for (const entry of def.cost || []) giveItems(player, entry.itemId, entry.amount);
    clearPendingBuilding(playerName, player, "§cНе удалось поставить блоки постройки. Материалы возвращены.");
    return;
  }

  if (!Array.isArray(settlement.buildings)) settlement.buildings = [];
  settlement.buildings.push({
    type: def.id,
    x: origin.x,
    y: origin.y,
    z: origin.z,
    dimensionId: getDimensionId(clickedBlock.dimension),
    placedTick: system.currentTick
  });
  saveData(data);
  clearPendingBuilding(playerName, player);
  player.sendMessage(`§a${def.name} построена! Доп. заработок: +${def.taxBonus} изумр. к налогу.`);
  world.sendMessage(`§6[Королевства] §fВ ${settlementDisplayName(data, settlement)} появилась ${def.name}.`);
}

function validateBuildingFootprint(data, settlement, origin, def) {
  const dimensionId = settlement.dimensionId;
  for (let dx = 0; dx < def.size.width; dx += 1) {
    for (let dz = 0; dz < def.size.depth; dz += 1) {
      const pos = { x: origin.x + dx, y: origin.y, z: origin.z + dz };
      const at = findSettlementAt(data, pos, dimensionId);
      if (!at || at.id !== settlement.id) {
        return "Всю площадку постройки можно ставить только на территории ЭТОГО поселения.";
      }
    }
  }

  const flag = settlement.flag;
  const centerX = origin.x + Math.floor(def.size.width / 2);
  const centerZ = origin.z + Math.floor(def.size.depth / 2);
  const dist = Math.hypot(centerX - flag.x, centerZ - flag.z);
  if (dist < 4) return "Слишком близко к флагу. Отойдите минимум на 4 блока.";
  return undefined;
}

function placeBuildingBlueprint(dimension, origin, buildingId) {
  const blueprint = getBlueprint(buildingId);
  if (!blueprint.length) return 0;

  let placed = 0;
  for (const cell of blueprint) {
    try {
      const block = dimension.getBlock({
        x: origin.x + cell.x,
        y: origin.y + cell.y,
        z: origin.z + cell.z
      });
      if (!block) continue;
      if (block.typeId === "minecraft:bedrock" || block.typeId === LEGACY_FLAG_BLOCK) continue;
      try {
        block.setPermutation(BlockPermutation.resolve(cell.typeId));
      } catch (_permError) {
        try { block.setType(cell.typeId); } catch (_e2) {}
      }
      placed += 1;
    } catch (_error) {}
  }
  return placed;
}


function damageFlag(data, target, attackerSettlement, player) {
  const damage = Math.max(10, Math.ceil(settlementType(attackerSettlement).hp * 0.035));
  target.hp = Math.max(0, target.hp - damage);
  target.morale = Math.max(0, target.morale - 2);

  if (target.hp <= 0) {
    handleWarVictory(data, attackerSettlement.id, target.id);
    saveData(data);
    return;
  }

  saveData(data);
  updateFlagLabelFor(target);
  player.sendMessage(`§cФлаг повреждён на ${damage}. Осталось HP: ${target.hp}/${getMaxHp(target)}.`);
}

function handleWarVictory(data, winnerId, loserId) {
  const winner = getSettlement(data, winnerId);
  const loser = getSettlement(data, loserId);
  if (!winner || !loser) return;

  winner.wars = winner.wars.filter((id) => id !== loser.id);
  const expansion = Math.max(5, Math.round(getTerritoryRadius(loser) / 5));
  const proposedRadius = getTerritoryRadius(winner) + expansion;
  const overlap = findTerritoryOverlap(data, winner.flag, winner.dimensionId, proposedRadius, winner.id, winner.allianceId, loser.id);

  if (overlap) {
    const owner = world.getPlayers().find((online) => getPlayerName(online) === winner.creatorName);
    if (owner) giveEmeralds(owner, settlementType(loser).defeatReward);
    world.sendMessage(`§6[Королевства] §fТерритория победителя не расширилась из-за границ ${settlementDisplayName(data, overlap)}. Создатель получает награду изумрудами.`);
  } else {
    winner.territoryBonus = (winner.territoryBonus || 0) + expansion;
    world.sendMessage(`§6[Королевства] §fТерритория ${settlementDisplayName(data, winner)} расширилась на ${expansion} блок(ов).`);
  }

  winner.morale = Math.min(100, winner.morale + 12);
  data.lootZones.push({
    name: loser.name,
    dimensionId: loser.dimensionId,
    center: { ...loser.flag },
    radius: getTerritoryRadius(loser),
    winnerSettlementId: winner.id,
    winnerAllianceId: winner.allianceId,
    expiresTick: system.currentTick + LOOT_WINDOW_TICKS
  });
  disbandSettlement(data, loser.id, `проиграло войну против ${winner.name}`, false);
  world.sendMessage(`§4[Война] §f${settlementDisplayName(data, winner)} победило. Поселение ${loser.name} распалось. Победители могут мародёрить бывшую территорию 5 минут.`);
}

function disbandSettlement(data, settlementId, reason, announce = true) {
  const settlement = getSettlement(data, settlementId);
  if (!settlement) return;

  for (const other of data.settlements) {
    other.wars = (other.wars || []).filter((id) => id !== settlement.id);
  }

  if (settlement.allianceId) {
    const alliance = data.alliances.find((entry) => entry.id === settlement.allianceId);
    if (alliance) {
      alliance.members = alliance.members.filter((id) => id !== settlement.id);
      if (alliance.members.length < 2) {
        for (const memberId of alliance.members) {
          const member = getSettlement(data, memberId);
          if (member) member.allianceId = undefined;
        }
        data.alliances = data.alliances.filter((entry) => entry.id !== alliance.id);
      }
    }
  }

  removeFlagBlock(settlement);
  removeFlagLabel(settlement);
  data.settlements = data.settlements.filter((entry) => entry.id !== settlement.id);
  updatePlayerPrefixDisplays(data);
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
  for (const settlement of data.settlements) updateFlagLabelFor(settlement, data);
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
    `Имя: ${shortText(settlement.name, 18)}`,
    `Созд.: ${creatorPrefixFor(settlement.typeIndex)}`,
    shortText(settlement.creatorName, 20),
    `HP: ${settlement.hp}/${getMaxHp(settlement)}`,
    `Мораль: ${settlement.morale}/100`,
    `Жители: ${getPopulation(settlement)}`,
    `Радиус: ${getTerritoryRadius(settlement)}`,
    `Налог: ${type.tax} эм./25м`,
    formatExtraIncomeLine(settlement),
    `Итого налог: ${type.tax + getExtraIncomeBonus(settlement)} эм.`,
    `Создание: ${CREATION_COST} эм.`,
    `Улучш.: ${nextType ? `${nextType.upgradeCost} эм.` : "нет"}`,
    `Альянс: ${alliance ? shortText(alliance.name, 15) : "нет"}`,
    `Войны: ${wars.length ? shortText(wars.join(", "), 15) : "нет"}`
  ].join("\n");
}

function settlementLabel(data, settlement) {
  return `${settlementDisplayName(data, settlement)}\n${creatorPrefixFor(settlement.typeIndex)} ${settlement.creatorName}\nHP ${settlement.hp}/${getMaxHp(settlement)} | Мораль ${settlement.morale}`;
}

function updatePlayerPrefixDisplays(knownData) {
  const data = knownData ?? loadData();
  const onlineNames = new Set();

  for (const player of world.getPlayers()) {
    const playerName = getPlayerName(player);
    onlineNames.add(playerName);
    playerIdByName.set(playerName, player.id);

    const prefix = playerDisplayPrefix(data, playerName);
    if (prefix) playerPrefixCache.set(playerName, prefix);
    else playerPrefixCache.delete(playerName);

    applyPlayerPrefix(player, prefix);
  }

  for (const cachedName of playerPrefixCache.keys()) {
    if (!onlineNames.has(cachedName)) playerPrefixCache.delete(cachedName);
  }
}

function applyPlayerPrefix(player, prefix) {
  const playerName = getPlayerName(player);
  const formattedPrefix = prefix ? `§7[§6${prefix}§7] ` : "";

  if (!prefix) {
    clearDirectChatPrefix(player);
    removePlayerPrefixLabel(player);
    try {
      if (player.nameTag !== playerName) player.nameTag = playerName;
    } catch (_error) {
      // Ignore nameTag reset failures.
    }
    return;
  }

  if (tryApplyDirectChatPrefix(player, formattedPrefix)) {
    directChatPrefixAvailable = true;
    removePlayerPrefixLabel(player);
    try {
      if (player.nameTag !== playerName) player.nameTag = playerName;
    } catch (_error) {
      // Ignore nameTag reset failures.
    }
    return;
  }

  updatePlayerPrefixLabel(player, prefix);
  try {
    if (player.nameTag !== playerName) player.nameTag = "";
  } catch (_error) {
    // Ignore nameTag reset failures.
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

  player.sendMessage("§6[Королевства] §fАддон загружен (v1.5.1 NOIMPORT — строительство без buildings.js).");
  player.sendMessage(`§7Флаг — сущность. Кликните предметом по блоку. Нужно ${CREATION_COST} изумрудов.`);
}

function notifyPlayerAboutPrefixes(player) {
  if (!player) return;

  const playerName = getPlayerName(player);
  if (chatPrefixNoticeShown.has(playerName)) return;

  const prefix = playerDisplayPrefix(loadData(), playerName);
  if (!prefix) return;

  chatPrefixNoticeShown.add(playerName);
  const chatHint = directChatPrefixAvailable
    ? "Префикс в чате активен (chatNamePrefix)."
    : "Префикс над головой активен. Для чата нужен обновлённый Script API (beta).";
  player.sendMessage(`§7[Королевства] Ваш префикс: §6${prefix}§7. ${chatHint}`);
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
    if (typeof data.nextSettlementIdValue !== "number") data.nextSettlementIdValue = data.settlements.reduce((max, settlement) => Math.max(max, settlement.id || 0), 0) + 1;
    if (typeof data.nextAllianceIdValue !== "number") data.nextAllianceIdValue = data.alliances.reduce((max, alliance) => Math.max(max, alliance.id || 0), 0) + 1;
    for (const settlement of data.settlements) {
      if (!settlement.members) settlement.members = {};
      if (!Array.isArray(settlement.wars)) settlement.wars = [];
      if (!Array.isArray(settlement.buildings)) settlement.buildings = [];
      if (typeof settlement.morale !== "number") settlement.morale = 75;
      if (typeof settlement.territoryBonus !== "number") settlement.territoryBonus = 0;
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
    return;
  }
  world.setDynamicProperty(STORE_KEY, serialized);
}

function emptyData() {
  return { version: 1, settlements: [], alliances: [], lootZones: [], nextSettlementIdValue: 1, nextAllianceIdValue: 1 };
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
  let closest;
  let closestDistance = Number.MAX_SAFE_INTEGER;
  for (const settlement of data.settlements) {
    if (settlement.dimensionId !== dimensionId) continue;
    const distance = distance2D(settlement.flag, location);
    if (distance <= getTerritoryRadius(settlement) && distance < closestDistance) {
      closest = settlement;
      closestDistance = distance;
    }
  }
  return closest;
}

function findLootZoneAt(data, location, dimensionId) {
  return data.lootZones.find((zone) => zone.dimensionId === dimensionId && zone.expiresTick > system.currentTick && distance2D(zone.center, location) <= zone.radius);
}

function findTerritoryOverlap(data, center, dimensionId, radius, ignoreSettlementId, alliedAllianceId, ignoredLoserId) {
  for (const settlement of data.settlements) {
    if (settlement.id === ignoreSettlementId || settlement.id === ignoredLoserId) continue;
    if (settlement.dimensionId !== dimensionId) continue;
    if (alliedAllianceId && settlement.allianceId === alliedAllianceId) continue;
    if (distance2D(center, settlement.flag) < radius + getTerritoryRadius(settlement)) return settlement;
  }
  return undefined;
}

function hasTerritoryAccess(data, settlement, playerName) {
  if (isMember(settlement, playerName)) return true;
  if (!settlement.allianceId) return false;
  return data.settlements.some((candidate) => candidate.allianceId === settlement.allianceId && isMember(candidate, playerName));
}

function hasLootAccess(data, zone, playerName) {
  const winner = getSettlement(data, zone.winnerSettlementId);
  if (winner && isMember(winner, playerName)) return true;
  if (!zone.winnerAllianceId) return false;
  return data.settlements.some((settlement) => settlement.allianceId === zone.winnerAllianceId && isMember(settlement, playerName));
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
  return settlementType(settlement).radius + (settlement.territoryBonus || 0);
}

function getPopulation(settlement) {
  return 1 + Object.keys(settlement.members || {}).length;
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
  try {
    return await form.show(player);
  } catch (error) {
    player.sendMessage(`§cНе удалось открыть меню: ${error}`);
    return { canceled: true };
  }
}

function giveEmeralds(player, amount) {
  giveItems(player, "minecraft:emerald", amount);
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
  const dimension = safeDimension(settlement.dimensionId);
  if (!dimension) return;
  const block = dimension.getBlock(settlement.flag);
  if (block?.typeId === LEGACY_FLAG_BLOCK) setBlockToAir(block);
  try {
    for (const flag of dimension.getEntities({ type: FLAG_ENTITY, tags: [settlementTag(settlement.id)] })) flag.remove();
  } catch (_error) {
    // Entity cleanup is best-effort; settlement data is still removed.
  }
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
