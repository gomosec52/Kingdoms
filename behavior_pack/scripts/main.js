import * as server from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";

const { BlockPermutation, ItemStack, system, world } = server;
const FLAG_ITEM = "kingdoms:flag";
const FLAG_ENTITY = "kingdoms:flag";
const LEGACY_FLAG_BLOCK = "kingdoms:flag";
const FLAG_LABEL_ENTITY = "kingdoms:flag_label";
const FLAG_ITEM_USE_COMPONENT = "kingdoms:flag_placer";
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

const PREFIX_TEAM_IDS = new Map();
for (let index = 0; index < CREATOR_PREFIXES.length; index++) {
  PREFIX_TEAM_IDS.set(CREATOR_PREFIXES[index], `kw_cr${index}`);
}
for (let index = 0; index < PREFIXES.length; index++) {
  PREFIX_TEAM_IDS.set(PREFIXES[index].name, `kw_mb${index}`);
}

const PLAYER_PREFIX_LABEL_TAG = "kingdoms_player_prefix_label";

const flagInteractionCooldown = new Map();
const flagPlacementCooldown = new Map();
const prefixedChatCooldown = new Map();
const playerPrefixCache = new Map();
const playerTeamCache = new Map();
const playerIdByName = new Map();
let flagItemComponentRegistered = false;
let dynamicPropertiesRegistered = false;
let prefixTeamsReady = false;
let scoreboardPrefixWorking = false;

system.beforeEvents?.startup?.subscribe((event) => {
  registerFlagItemComponent(event.itemComponentRegistry);
});

world.beforeEvents?.worldInitialize?.subscribe((event) => {
  registerDynamicProperties(event.propertyRegistry);
  registerFlagItemComponent(event.itemComponentRegistry);
  system.run(() => subscribeChatPrefixEvents());
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

function registerFlagItemComponent(registry) {
  if (flagItemComponentRegistered || !registry?.registerCustomComponent) return;

  try {
    registry.registerCustomComponent(FLAG_ITEM_USE_COMPONENT, {
      onUseOn(event) {
        if (event.itemStack?.typeId !== FLAG_ITEM) return;
        system.run(() => beginSettlementCreationFromItem(event.source, event.block, event.blockFace));
      }
    });
    flagItemComponentRegistered = true;
  } catch (error) {
    console.warn(`[Kingdoms] Не удалось зарегистрировать компонент флага: ${error}`);
  }
}

world.beforeEvents.itemUseOn?.subscribe((event) => {
  if (event.itemStack?.typeId !== FLAG_ITEM) return;
  event.cancel = true;
  system.run(() => beginSettlementCreationFromItem(event.source, event.block, event.blockFace));
});

world.afterEvents.itemUseOn?.subscribe((event) => {
  if (event.itemStack?.typeId !== FLAG_ITEM) return;
  system.run(() => beginSettlementCreationFromItem(event.source, event.block, event.blockFace));
});

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
    subscribeChatPrefixEvents();
    updatePlayerPrefixDisplays();
    notifyPlayerAboutPrefixes(player);
  });
});

world.afterEvents.playerLeave?.subscribe((event) => {
  if (event.playerName) {
    playerTeamCache.delete(event.playerName);
    playerPrefixCache.delete(event.playerName);
    playerIdByName.delete(event.playerName);
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
    player.sendMessage("§cЭтот флаг не привязан к поселению. Сломайте его и поставьте заново.");
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

subscribeChatPrefixEvents();
system.run(() => {
  subscribeChatPrefixEvents();
  updatePlayerPrefixDisplays();
});

system.runInterval(() => updateFlagLabels(), 60);
system.runInterval(() => updateMoraleForNewDay(), 1200);
system.runInterval(() => cleanupExpiredLootZones(), 100);
system.runInterval(() => updatePlayerPrefixDisplays(), 40);

async function beginSettlementCreationFromItem(player, clickedBlock, blockFace) {
  if (!player || !clickedBlock) return;

  const data = loadData();
  const playerName = getPlayerName(player);
  const dimensionId = getDimensionId(clickedBlock.dimension);
  const spawnLocation = getFlagPlacementLocation(clickedBlock, blockFace);
  const territoryCenter = blockPosition(spawnLocation);
  const cooldownKey = `${playerName}:${dimensionId}:${territoryCenter.x}:${territoryCenter.y}:${territoryCenter.z}`;
  const lastPlacementTick = flagPlacementCooldown.get(cooldownKey) ?? -20;
  if (system.currentTick - lastPlacementTick < 10) return;
  flagPlacementCooldown.set(cooldownKey, system.currentTick);

  if (data.settlements.some((settlement) => settlement.creatorName === playerName)) {
    player.sendMessage("§cУ вас уже есть поселение. Один создатель может владеть только одним флагом.");
    return;
  }

  if (countItem(player, "minecraft:emerald") < CREATION_COST) {
    player.sendMessage(`§cДля создания поселения нужно ${CREATION_COST} изумрудов.`);
    return;
  }

  const overlap = findTerritoryOverlap(data, territoryCenter, dimensionId, SETTLEMENT_TYPES[0].radius, undefined, undefined);
  if (overlap) {
    player.sendMessage(`§cСлишком близко к территории: ${settlementDisplayName(data, overlap)}.`);
    return;
  }

  const form = new ModalFormData()
    .title("Создание поселения")
    .textField(`Название поселения (${CREATION_COST} изумрудов)`, "Например: Новгород", `Поселение ${playerName}`);
  const response = await showForm(player, form);
  if (response.canceled) {
    player.sendMessage("§7Создание поселения отменено.");
    return;
  }

  const name = cleanName(response.formValues?.[0]);
  if (!name) {
    player.sendMessage("§cНазвание не может быть пустым.");
    return;
  }

  if (!takeItem(player, "minecraft:emerald", CREATION_COST)) {
    player.sendMessage(`§cНе хватает изумрудов. Нужно ${CREATION_COST}.`);
    return;
  }

  if (!takeItem(player, FLAG_ITEM, 1)) {
    giveEmeralds(player, CREATION_COST);
    player.sendMessage("§cПредмет флага не найден в инвентаре.");
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
    flag: territoryCenter,
    wars: [],
    allianceId: undefined,
    createdTick: system.currentTick,
    lastTaxTick: -TAX_COOLDOWN_TICKS,
    lastMoraleDay: nowDay
  };

  try {
    spawnOrUpdateFlagEntity(settlement, data);
  } catch (error) {
    giveEmeralds(player, CREATION_COST);
    giveItemStack(player, new ItemStack(FLAG_ITEM, 1));
    player.sendMessage(`§cНе удалось поставить флаг-сущность: ${error}`);
    return;
  }

  data.settlements.push(settlement);
  saveData(data);
  updateFlagLabelFor(settlement, data);
  updatePlayerPrefixDisplays(data);
  world.sendMessage(`§6[Королевства] §f${playerName} основал(а) ${settlementDisplayName(data, settlement)} за ${CREATION_COST} изумрудов.`);
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
    .textField(`Название поселения (${CREATION_COST} изумрудов)`, "Например: Новгород", `Поселение ${playerName}`);
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
    lastMoraleDay: nowDay
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
    .textField("Название альянса", "Например: Северная корона", `${settlement.name} и ${target.name}`));
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

  const amount = settlementType(settlement).tax;
  giveEmeralds(player, amount);
  settlement.lastTaxTick = system.currentTick;
  saveData(data);
  player.sendMessage(`§aНалог собран: ${amount} изумруд(ов).`);
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
  ensurePrefixTeams();
  const data = knownData ?? loadData();
  const onlineNames = new Set();

  for (const player of world.getPlayers()) {
    const playerName = getPlayerName(player);
    onlineNames.add(playerName);
    playerIdByName.set(playerName, player.id);

    const prefix = playerDisplayPrefix(data, playerName);
    if (prefix) playerPrefixCache.set(playerName, prefix);
    else playerPrefixCache.delete(playerName);

    applyScoreboardPrefix(player, prefix);
    updatePlayerPrefixLabel(player, prefix);
    applyOptionalChatNamePrefix(player, prefix);

    try {
      const nextNameTag = prefix ? "" : playerName;
      if (player.nameTag !== nextNameTag) player.nameTag = nextNameTag;
    } catch (_error) {
      // Some runtimes reject nameTag writes during player state transitions.
    }
  }

  for (const cachedName of playerPrefixCache.keys()) {
    if (!onlineNames.has(cachedName)) playerPrefixCache.delete(cachedName);
  }
  for (const cachedName of playerTeamCache.keys()) {
    if (!onlineNames.has(cachedName)) playerTeamCache.delete(cachedName);
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

function commandSucceeded(result) {
  return (result?.successCount ?? 0) > 0;
}

function escapeCommandArg(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function ensurePrefixTeams() {
  if (prefixTeamsReady) return;

  const dimension = safeDimension("overworld");
  if (!dimension) return;

  for (const [roleName, teamId] of PREFIX_TEAM_IDS) {
    const prefixText = `§7[§6${roleName}§7] §r`;
    try {
      dimension.runCommand(`scoreboard teams add ${teamId}`);
    } catch (_error) {
      // Team may already exist.
    }
    try {
      dimension.runCommand(`scoreboard teams modify ${teamId} prefix "${prefixText}"`);
    } catch (_error) {
      // Best-effort only.
    }
  }

  prefixTeamsReady = true;
}

function applyScoreboardPrefix(player, prefix) {
  if (chatPrefixEventsSubscribed) return;

  const playerName = getPlayerName(player);
  const teamId = prefix ? PREFIX_TEAM_IDS.get(prefix) : undefined;
  if (playerTeamCache.get(playerName) === teamId) return;

  const dimension = player.dimension ?? safeDimension("overworld");
  if (!dimension) return;

  const quotedName = `"${escapeCommandArg(playerName)}"`;
  let worked = false;

  try {
    dimension.runCommand(`scoreboard teams leave ${quotedName}`);
    if (teamId) {
      const joinResult = dimension.runCommand(`scoreboard teams join ${teamId} ${quotedName}`);
      worked = commandSucceeded(joinResult);
    } else {
      worked = true;
    }
  } catch (_error) {
    worked = false;
  }

  playerTeamCache.set(playerName, teamId);
  if (worked) scoreboardPrefixWorking = true;
}

function applyOptionalChatNamePrefix(player, prefix) {
  if (!("chatNamePrefix" in player)) return;

  try {
    player.chatNamePrefix = prefix ? `§7[§6${prefix}§7] ` : undefined;
  } catch (_error) {
    // Property exists only on newer API versions.
  }
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
  if (!prefix) {
    removePlayerPrefixLabel(player);
    return;
  }

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

let chatPrefixEventsSubscribed = false;

function subscribeChatPrefixEvents() {
  if (chatPrefixEventsSubscribed) return;

  const beforeHandler = (event) => handlePrefixedChat(event);

  if (world.beforeEvents.chatSend?.subscribe) {
    world.beforeEvents.chatSend.subscribe(beforeHandler);
    chatPrefixEventsSubscribed = true;
    return;
  }

  if (world.beforeEvents.chat?.subscribe) {
    world.beforeEvents.chat.subscribe(beforeHandler);
    chatPrefixEventsSubscribed = true;
  }

  system.runTimeout(() => {
    subscribeChatPrefixEvents();
    if (chatPrefixEventsSubscribed || scoreboardPrefixWorking) return;
    world.sendMessage("§7[Королевства] Префикс в чате: включите Beta APIs в экспериментах мира или читы.");
  }, 160);
}

function notifyPlayerAboutPrefixes(player) {
  if (!player) return;

  const prefix = playerDisplayPrefix(loadData(), getPlayerName(player));
  if (!prefix) return;

  const chatHint = chatPrefixEventsSubscribed
    ? "Префикс также виден в чате."
    : scoreboardPrefixWorking
      ? "Префикс в чате работает через scoreboard."
      : "Для префикса в чате включите Beta APIs или читы мира.";
  player.sendMessage(`§7[Королевства] Ваш префикс: §6${prefix}§7. ${chatHint}`);
}

function handlePrefixedChat(event) {
  const message = event.message;
  if (typeof message !== "string" || !message.length) return;

  const player = event.sender ?? event.player;
  const resolved = resolveChatPrefix(player, event);
  if (!resolved) return;

  const { playerName, prefix } = resolved;
  event.cancel = true;

  const duplicateKey = `${playerName}:${system.currentTick}:${message}`;
  if (prefixedChatCooldown.get(duplicateKey) === system.currentTick) return;
  prefixedChatCooldown.set(duplicateKey, system.currentTick);

  const formatted = formatPrefixedChatMessage(playerName, prefix, message);
  system.run(() => broadcastChatMessage(formatted));
}

function resolveChatPrefix(player, event) {
  const playerName = getChatPlayerName(event, player);
  if (!playerName) return undefined;

  let prefix = getCachedOrLoadedPrefix(playerName);
  if (!prefix && player) {
    prefix = playerDisplayPrefix(loadData(), getPlayerName(player));
    if (prefix) playerPrefixCache.set(getPlayerName(player), prefix);
  }
  if (!prefix) return undefined;

  return { playerName, prefix };
}

function formatPrefixedChatMessage(playerName, prefix, message) {
  return `§7[§6${prefix}§7] §f${playerName}§7: §f${cleanChatMessage(message)}`;
}

function broadcastChatMessage(formatted) {
  try {
    world.sendMessage(formatted);
    return;
  } catch (_error) {
    // Fallback if world.sendMessage is unavailable.
  }

  for (const recipient of world.getPlayers()) {
    try {
      recipient.sendMessage(formatted);
    } catch (_error) {
      // Ignore per-player delivery failures.
    }
  }
}

function getChatPlayerName(event, player) {
  if (player?.name) return player.name;
  if (player?.id) {
    for (const online of world.getPlayers()) {
      if (online.id === player.id) return online.name;
    }
  }
  if (typeof event.sender === "string") return event.sender;
  if (typeof event.player === "string") return event.player;
  if (typeof event.senderName === "string") return event.senderName;
  return "";
}

function getCachedOrLoadedPrefix(playerName) {
  const cached = playerPrefixCache.get(playerName);
  if (cached) return cached;

  try {
    const prefix = playerDisplayPrefix(loadData(), playerName);
    if (prefix) playerPrefixCache.set(playerName, prefix);
    return prefix;
  } catch (_error) {
    return undefined;
  }
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

function spawnOrUpdateFlagEntity(settlement, data) {
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

  const flag = flags[0] ?? dimension.spawnEntity(FLAG_ENTITY, location);
  if (!flag.hasTag("kingdoms_flag")) flag.addTag("kingdoms_flag");
  if (!flag.hasTag(tag)) flag.addTag(tag);
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
