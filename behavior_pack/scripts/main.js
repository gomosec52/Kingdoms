import { BlockPermutation, DynamicPropertiesDefinition, ItemStack, system, world } from "@minecraft/server";
import { ActionFormData, MessageFormData, ModalFormData } from "@minecraft/server-ui";

const FLAG_BLOCK = "kingdoms:flag";
const STORE_KEY = "kingdoms:data:v1";
const STORE_LIMIT = 32767;
const DAY_TICKS = 24000;
const TAX_COOLDOWN_TICKS = 25 * 60 * 20;
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
  { name: "Деревня", hp: 120, radius: 35, tax: 4, minPlayers: 1, defeatReward: 8 },
  { name: "Большая деревня", hp: 180, radius: 55, tax: 8, minPlayers: 2, defeatReward: 14 },
  { name: "Городок", hp: 260, radius: 80, tax: 14, minPlayers: 3, defeatReward: 22 },
  { name: "Большой город", hp: 380, radius: 115, tax: 22, minPlayers: 4, defeatReward: 34 },
  { name: "Замок", hp: 560, radius: 150, tax: 32, minPlayers: 5, defeatReward: 52 },
  { name: "Королевство", hp: 780, radius: 220, tax: 44, minPlayers: 7, defeatReward: 80 },
  { name: "Империя", hp: 1100, radius: 300, tax: 64, minPlayers: 10, defeatReward: 128 }
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

world.beforeEvents.worldInitialize?.subscribe((event) => {
  const definition = new DynamicPropertiesDefinition();
  definition.defineString(STORE_KEY, STORE_LIMIT);
  event.propertyRegistry.registerWorldDynamicProperties(definition);
});

world.afterEvents.playerPlaceBlock?.subscribe((event) => {
  if (event.block.typeId !== FLAG_BLOCK) return;
  system.run(() => beginSettlementCreation(event.player, event.block));
});

world.afterEvents.playerInteractWithBlock?.subscribe((event) => {
  if (event.block.typeId !== FLAG_BLOCK) return;
  const data = loadData();
  const settlement = findSettlementByFlag(data, event.block);
  if (!settlement) {
    event.player.sendMessage("§cЭтот флаг не привязан к поселению. Сломайте его и поставьте заново.");
    return;
  }
  system.run(() => openSettlementMenu(event.player, settlement.id));
});

world.beforeEvents.playerBreakBlock?.subscribe((event) => {
  const data = loadData();
  const block = event.block;
  const playerName = getPlayerName(event.player);

  if (block.typeId === FLAG_BLOCK) {
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
  }
});

world.beforeEvents.playerPlaceBlock?.subscribe((event) => {
  const data = loadData();
  const playerName = getPlayerName(event.player);
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
  const settlement = findSettlementAt(data, event.block.location, getDimensionId(event.block.dimension));
  if (settlement && !hasTerritoryAccess(data, settlement, playerName)) {
    event.cancel = true;
    event.player.sendMessage(`§cЧужая территория: ${settlementDisplayName(data, settlement)}. Открывать и нажимать это нельзя.`);
  }
});

world.beforeEvents.entityHurt?.subscribe((event) => {
  const victim = event.hurtEntity;
  const attacker = event.damageSource?.damagingEntity;
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

system.runInterval(() => updateFlagLabels(), 60);
system.runInterval(() => updateMoraleForNewDay(), 1200);

async function beginSettlementCreation(player, block) {
  const data = loadData();
  const playerName = getPlayerName(player);
  const dimensionId = getDimensionId(block.dimension);

  if (data.settlements.some((settlement) => settlement.creatorName === playerName)) {
    setBlockToAir(block);
    player.sendMessage("§cУ вас уже есть поселение. Один создатель может владеть только одним флагом.");
    return;
  }

  const overlap = findTerritoryOverlap(data, block.location, dimensionId, SETTLEMENT_TYPES[0].radius, undefined, undefined);
  if (overlap) {
    setBlockToAir(block);
    player.sendMessage(`§cСлишком близко к территории: ${settlementDisplayName(data, overlap)}.`);
    return;
  }

  const form = new ModalFormData()
    .title("Создание поселения")
    .textField("Название поселения", "Например: Новгород", `Поселение ${playerName}`);
  const response = await showForm(player, form);
  if (response.canceled) {
    setBlockToAir(block);
    player.sendMessage("§7Создание поселения отменено, флаг удалён.");
    return;
  }

  const name = cleanName(response.formValues?.[0]);
  if (!name) {
    setBlockToAir(block);
    player.sendMessage("§cНазвание не может быть пустым.");
    return;
  }

  const nowDay = getCurrentDay();
  const settlement = {
    id: nextSettlementId(data),
    name,
    typeIndex: 0,
    creatorName: playerName,
    creatorPrefix: "Основатель",
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
  world.sendMessage(`§6[Королевства] §f${playerName} основал(а) ${settlementDisplayName(data, settlement)}.`);
}

async function openSettlementMenu(player, settlementId) {
  const data = loadData();
  const settlement = getSettlement(data, settlementId);
  if (!settlement) {
    player.sendMessage("§cПоселение не найдено.");
    return;
  }

  const nextType = SETTLEMENT_TYPES[settlement.typeIndex + 1];
  const form = new ActionFormData()
    .title(`§6${settlementDisplayName(data, settlement)}`)
    .body(settlementInfo(data, settlement))
    .button(nextType ? `Улучшить до: ${nextType.name}` : "Максимальный тип достигнут")
    .button("Жители")
    .button("Префиксы")
    .button("О префиксах")
    .button("Создать альянс")
    .button("Объявить войну")
    .button("Налог")
    .button("Расформировать");

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

  settlement.typeIndex += 1;
  settlement.hp = getMaxHp(settlement);
  settlement.morale = Math.min(100, settlement.morale + 10);
  saveData(data);
  updateFlagLabelFor(settlement);
  world.sendMessage(`§6[Королевства] §f${settlementDisplayName(data, settlement)} улучшено. Мораль выросла.`);
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

function updateFlagLabels() {
  const data = loadData();
  for (const settlement of data.settlements) updateFlagLabelFor(settlement, data);
}

function updateFlagLabelFor(settlement, knownData) {
  const data = knownData ?? loadData();
  const dimension = safeDimension(settlement.dimensionId);
  if (!dimension) return;

  const tag = settlementTag(settlement.id);
  const location = { x: settlement.flag.x + 0.5, y: settlement.flag.y + 2.35, z: settlement.flag.z + 0.5 };
  let labels = [];
  try {
    labels = dimension.getEntities({ type: "minecraft:armor_stand", tags: [LABEL_TAG, tag] });
  } catch (_error) {
    labels = [];
  }

  const label = labels[0] ?? dimension.spawnEntity("minecraft:armor_stand", location);
  if (!label.hasTag(LABEL_TAG)) label.addTag(LABEL_TAG);
  if (!label.hasTag(tag)) label.addTag(tag);
  label.nameTag = settlementLabel(data, settlement);
  try { label.teleport(location, { dimension }); } catch (_error) { /* Older runtimes keep the stand where it spawned. */ }
  try { label.addEffect("invisibility", 120, { amplifier: 0, showParticles: false }); } catch (_error) { /* Name tag still works without invisibility. */ }

  for (const duplicate of labels.slice(1)) duplicate.remove();
}

function removeFlagLabel(settlement) {
  const dimension = safeDimension(settlement.dimensionId);
  if (!dimension) return;
  try {
    for (const entity of dimension.getEntities({ type: "minecraft:armor_stand", tags: [LABEL_TAG, settlementTag(settlement.id)] })) entity.remove();
  } catch (_error) {
    // Ignore cleanup failures; they do not affect settlement data.
  }
}

function settlementInfo(data, settlement) {
  const type = settlementType(settlement);
  const alliance = getAlliance(data, settlement.allianceId);
  const wars = (settlement.wars || []).map((id) => getSettlement(data, id)?.name).filter(Boolean);
  return [
    `Тип: ${type.name}`,
    `Название: ${settlement.name}`,
    `Создатель: ${settlement.creatorPrefix || "Основатель"} ${settlement.creatorName}`,
    `Прочность: ${settlement.hp}/${getMaxHp(settlement)}`,
    `Мораль: ${settlement.morale}/100`,
    `Жители: ${getPopulation(settlement)}`,
    `Территория: ${getTerritoryRadius(settlement)} блок(ов)`,
    `Налог: ${type.tax} изумруд(ов) раз в 25 минут`,
    `Альянс: ${alliance ? alliance.name : "нет"}`,
    `Войны: ${wars.length ? wars.join(", ") : "нет"}`
  ].join("\n");
}

function settlementLabel(data, settlement) {
  return `${settlementDisplayName(data, settlement)}\n${settlement.creatorPrefix || "Основатель"} ${settlement.creatorName}\nHP ${settlement.hp}/${getMaxHp(settlement)} | Мораль ${settlement.morale}`;
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
  return { version: 1, settlements: [], alliances: [], nextSettlementIdValue: 1, nextAllianceIdValue: 1 };
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

function getPlayerSettlement(data, playerName) {
  return data.settlements.find((settlement) => isMember(settlement, playerName));
}

function isMember(settlement, playerName) {
  return settlement.creatorName === playerName || Boolean(settlement.members?.[playerName]);
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

async function showForm(player, form) {
  try {
    return await form.show(player);
  } catch (error) {
    player.sendMessage(`§cНе удалось открыть меню: ${error}`);
    return { canceled: true };
  }
}

function giveEmeralds(player, amount) {
  let remaining = amount;
  while (remaining > 0) {
    const stackAmount = Math.min(64, remaining);
    const stack = new ItemStack("minecraft:emerald", stackAmount);
    const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
    try {
      if (inventory) inventory.addItem(stack);
      else player.dimension.spawnItem(stack, player.location);
    } catch (_error) {
      player.dimension.spawnItem(stack, player.location);
    }
    remaining -= stackAmount;
  }
}

function removeFlagBlock(settlement) {
  const dimension = safeDimension(settlement.dimensionId);
  if (!dimension) return;
  const block = dimension.getBlock(settlement.flag);
  if (block?.typeId === FLAG_BLOCK) setBlockToAir(block);
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

function blockPosition(location) {
  return { x: Math.floor(location.x), y: Math.floor(location.y), z: Math.floor(location.z) };
}

function sameBlock(first, second) {
  return first.x === second.x && first.y === second.y && first.z === second.z;
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
