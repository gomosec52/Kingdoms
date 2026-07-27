export const KNIGHT_ENTITY = "kingdoms:knight";
export const MAX_ARMY_POWER = 1000;
export const MAX_SUMMON_KNIGHTS = 5;
export const ARMY_DISMISS_COOLDOWN_TICKS = 15 * 60 * 20;
export const ARMY_ORDERS_TITLE = "kingdoms:army_orders";
export const POWER_PER_RESIDENT = 15;

export const KNIGHTS = {
  plate_knight: {
    id: "plate_knight",
    name: "Рыцарь в доспехах",
    description: "Крепкий воин в доспехах. Надёжная опора вашей армии на поле боя.",
    power: 80,
    cost: [
      { itemId: "minecraft:emerald", amount: 25, label: "изумруды" },
      { itemId: "minecraft:iron_ingot", amount: 10, label: "железо" },
      { itemId: "minecraft:iron_helmet", amount: 1, label: "шлем" },
      { itemId: "minecraft:iron_chestplate", amount: 1, label: "нагрудник" }
    ]
  }
};

/** @type {Map<string, object>} */
const activeArmies = new Map();

/** @type {object | undefined} */
let deps;

export function bindArmySystem(dependencies) {
  deps = dependencies;

  deps.world.afterEvents.entityHurt.subscribe((event) => {
    const hurt = event.hurtEntity;
    if (!hurt || hurt.typeId !== "minecraft:player") return;
    const player = /** @type {import("@minecraft/server").Player} */ (hurt);
    handleOwnerHurt(player, event.damageSource?.damagingEntity);
  });

  deps.world.afterEvents.playerLeave.subscribe((event) => {
    dismissArmyForPlayerId(event.playerId, false);
  });

  deps.system.runInterval(() => tickArmies(), 10);
}

export function getKnightDef(knightId) {
  return KNIGHTS[knightId];
}

export function listKnights() {
  return Object.values(KNIGHTS);
}

export function ensureSettlementArmyData(settlement) {
  if (!Array.isArray(settlement.knights)) settlement.knights = [];
}

export function countBarracks(settlement) {
  return deps.countBuildingsOfType(settlement, "barracks");
}

export function countOwnedKnights(settlement, knightId) {
  ensureSettlementArmyData(settlement);
  const entry = settlement.knights.find((k) => k.type === knightId);
  return entry?.count ?? 0;
}

export function getTotalOwnedKnights(settlement) {
  ensureSettlementArmyData(settlement);
  return settlement.knights.reduce((sum, entry) => sum + (entry.count || 0), 0);
}

export function getKnightCapacity(settlement) {
  return countBarracks(settlement);
}

export function getArmyPower(settlement) {
  ensureSettlementArmyData(settlement);
  let power = deps.getPopulation(settlement) * POWER_PER_RESIDENT;
  for (const entry of settlement.knights) {
    const def = KNIGHTS[entry.type];
    if (def) power += def.power * entry.count;
  }
  return Math.min(MAX_ARMY_POWER, power);
}

export function formatArmyPowerLine(settlement) {
  return `Мощь армии: ${getArmyPower(settlement)}/${MAX_ARMY_POWER}`;
}

export function formatArmyPageBody(settlement) {
  ensureSettlementArmyData(settlement);
  const barracks = countBarracks(settlement);
  const owned = getTotalOwnedKnights(settlement);
  const capacity = getKnightCapacity(settlement);
  return [
    formatArmyPowerLine(settlement),
    `Казармы: ${barracks}/10`,
    `Рыцари в штате: ${owned}/${capacity || 0}`,
    "",
    "Купите казармы в «Строительстве»,",
    "затем нанимайте рыцарей.",
    "",
    "Созыв: Создатель, Рыцарь, Советник."
  ].join("\n");
}

export function canCommandArmy(data, player, settlement) {
  const name = deps.getPlayerName(player);
  if (deps.samePlayerName(settlement.creatorName, name)) return true;
  const prefix = deps.playerDisplayPrefix(data, name);
  return prefix === "Рыцарь" || prefix === "Советник";
}

export function hasActiveArmy(player) {
  return activeArmies.has(player.id);
}

function getArmyState(player) {
  return activeArmies.get(player.id);
}

function getDismissCooldownUntil(player) {
  try {
    const value = player.getDynamicProperty("kingdoms:army_cooldown_until");
    return typeof value === "number" ? value : 0;
  } catch (_error) {
    return 0;
  }
}

function setDismissCooldownUntil(player, tick) {
  try {
    player.setDynamicProperty("kingdoms:army_cooldown_until", tick);
  } catch (_error) {
    // Ignore when dynamic properties are unavailable.
  }
}

function knightTag(playerId) {
  return `kingdoms_knight_owner_${playerId}`;
}

function spawnOffset(base, index, total) {
  const angle = (Math.PI * 2 * index) / Math.max(1, total);
  return {
    x: base.x + Math.cos(angle) * 1.6,
    y: base.y,
    z: base.z + Math.sin(angle) * 1.6
  };
}

function distanceFlat(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function markAttackTarget(entity) {
  if (!entity?.isValid) return;
  try {
    entity.addTag("kingdoms_knight_target");
    deps.system.runTimeout(() => {
      if (entity.isValid) entity.removeTag("kingdoms_knight_target");
    }, 200);
  } catch (_error) {
    // Ignore tag failures on invalid entities.
  }
}

function handleOwnerHurt(player, damagingEntity) {
  const state = getArmyState(player);
  if (!state || state.mode === "peace") return;
  if (!damagingEntity?.isValid) return;
  if (damagingEntity.id === player.id) return;
  markAttackTarget(damagingEntity);
}

function tickArmies() {
  for (const [playerId, state] of activeArmies.entries()) {
    const player = deps.world.getEntity(playerId);
    if (!player?.isValid) {
      cleanupArmyState(playerId);
      continue;
    }

    state.knightIds = state.knightIds.filter((id) => {
      const entity = deps.world.getEntity(id);
      return entity?.isValid;
    });

    if (!state.knightIds.length) {
      activeArmies.delete(playerId);
      continue;
    }

    if (state.mode === "hold") {
      for (const knightId of state.knightIds) {
        const knight = deps.world.getEntity(knightId);
        if (!knight?.isValid) continue;
        const hold = state.holdPoint;
        if (distanceFlat(knight.location, hold) > 1.5) {
          try {
            knight.teleport(hold, { dimension: knight.dimension });
          } catch (_error) {
            // Ignore teleport failures.
          }
        }
      }
      continue;
    }

    const targetLoc = player.location;
    for (const knightId of state.knightIds) {
      const knight = deps.world.getEntity(knightId);
      if (!knight?.isValid) continue;

      if (state.mode === "peace") {
        followEntity(knight, targetLoc, 4.5);
        continue;
      }

      followEntity(knight, targetLoc, 4.5);
    }
  }
}

function followEntity(entity, targetLoc, stopDistance) {
  const loc = entity.location;
  const dx = targetLoc.x - loc.x;
  const dz = targetLoc.z - loc.z;
  const dist = distanceFlat(loc, targetLoc);
  if (dist <= stopDistance) return;

  const step = Math.min(0.55, (dist - stopDistance) * 0.22);
  const nx = loc.x + (dx / dist) * step;
  const nz = loc.z + (dz / dist) * step;
  try {
    entity.teleport(
      { x: nx, y: targetLoc.y, z: nz },
      { dimension: entity.dimension, rotation: { x: 0, y: (Math.atan2(-dx, dz) * 180) / Math.PI } }
    );
  } catch (_error) {
    // Ignore teleport failures on unloaded chunks.
  }
}

function cleanupArmyEntities(state) {
  for (const knightId of state.knightIds || []) {
    const knight = deps.world.getEntity(knightId);
    if (knight?.isValid) knight.remove();
  }
}

function cleanupArmyState(playerId) {
  const state = activeArmies.get(playerId);
  if (state) cleanupArmyEntities(state);
  activeArmies.delete(playerId);
}

function dismissArmyForPlayerId(playerId, applyCooldown) {
  const state = activeArmies.get(playerId);
  if (!state) return;
  cleanupArmyEntities(state);
  activeArmies.delete(playerId);

  if (!applyCooldown) return;
  const player = deps.world.getEntity(playerId);
  if (player?.isValid) {
    setDismissCooldownUntil(player, deps.system.currentTick + ARMY_DISMISS_COOLDOWN_TICKS);
  }
}

export async function openArmyMenu(player, settlementId) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement) return;

  ensureSettlementArmyData(settlement);
  const barracks = countBarracks(settlement);
  const owned = getTotalOwnedKnights(settlement);
  const capacity = getKnightCapacity(settlement);
  const lines = [
    formatArmyPowerLine(settlement),
    `Казармы: ${barracks}/10`,
    `Рыцари в штате: ${owned}/${capacity || 0}`,
    "",
    "Сначала купите казармы в «Строительстве»,",
    "затем нанимайте рыцарей здесь.",
    "",
    "Созыв доступен: Рыцарь, Советник, Создатель."
  ];

  const form = new deps.ActionFormData()
    .title(deps.settlementMenuTitle(deps.SETTLEMENT_MENU_PAGE.ARMY))
    .body(lines.join("\n"))
    .button("Купить рыцаря", "textures/ui/kingdoms/icon_war")
    .button("Созвать армию", "textures/ui/kingdoms/icon_war");

  if (hasActiveArmy(player)) {
    form.button("Приказы", "textures/ui/kingdoms/icon_info");
  }

  form.button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showForm(player, form);
  if (response.canceled) return;

  let index = 0;
  if (response.selection === index++) return openKnightShop(player, settlementId);
  if (response.selection === index++) return openSummonArmyMenu(player, settlementId);
  if (hasActiveArmy(player) && response.selection === index++) return openArmyOrdersMenu(player);
  return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.ARMY, false);
}

export async function openKnightShop(player, settlementId) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement || !deps.requireOwner(player, settlement)) return;

  const barracks = countBarracks(settlement);
  if (barracks <= 0) {
    player.sendMessage("§cСначала купите казармы в разделе «Строительство».");
    return openArmyMenu(player, settlementId);
  }

  const knights = listKnights();
  const form = new deps.ActionFormData()
    .title(deps.settlementMenuTitle(deps.SETTLEMENT_MENU_PAGE.ARMY))
    .body([
      formatArmyPowerLine(settlement),
      `Слоты рыцарей: ${getTotalOwnedKnights(settlement)}/${getKnightCapacity(settlement)}`,
      "",
      "Выберите тип рыцаря для найма."
    ].join("\n"));

  for (const def of knights) {
    const owned = countOwnedKnights(settlement, def.id);
    const cap = getKnightCapacity(settlement);
    const status = owned >= cap ? "§cлимит" : `§a+${def.power} мощи`;
    form.button(`${def.name} (${status}§r)`, "textures/ui/kingdoms/icon_war");
  }
  form.button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showForm(player, form);
  if (response.canceled) return;
  if (response.selection === knights.length) return openArmyMenu(player, settlementId);
  const selected = knights[response.selection];
  if (!selected) return;
  return openKnightDetails(player, settlementId, selected.id);
}

export async function openKnightDetails(player, settlementId, knightId) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement || !deps.requireOwner(player, settlement)) return;

  const def = getKnightDef(knightId);
  if (!def) return;

  const owned = countOwnedKnights(settlement, knightId);
  const cap = getKnightCapacity(settlement);
  const costText = (def.cost || []).map((e) => `${e.amount} ${e.label}`).join(", ");
  const body = [
    def.name,
    def.description,
    `Мощь: +${def.power} (макс. ${MAX_ARMY_POWER})`,
    `В штате: ${owned}/${cap}`,
    `Стоимость: ${costText}`
  ].join("\n");

  const canBuy = owned < cap;
  const form = new deps.ActionFormData()
    .title(deps.settlementMenuTitle(deps.SETTLEMENT_MENU_PAGE.ARMY))
    .body(body)
    .button(canBuy ? "Купить" : "Лимит", "textures/ui/kingdoms/icon_war")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showForm(player, form);
  if (response.canceled) return;
  if (response.selection !== 0) return openKnightShop(player, settlementId);
  if (!canBuy) {
    player.sendMessage("§cНужно больше казарм или достигнут лимит рыцарей.");
    return openKnightShop(player, settlementId);
  }

  const missing = deps.getMissingBuildingCost(player, def);
  if (missing.length) {
    player.sendMessage(`§cНе хватает материалов: ${missing.join(", ")}`);
    return openKnightShop(player, settlementId);
  }
  if (!deps.takeBuildingCost(player, def)) {
    player.sendMessage("§cНе удалось списать материалы.");
    return openKnightShop(player, settlementId);
  }

  ensureSettlementArmyData(settlement);
  let entry = settlement.knights.find((k) => k.type === knightId);
  if (!entry) {
    entry = { type: knightId, count: 0 };
    settlement.knights.push(entry);
  }
  entry.count += 1;
  deps.saveData(data);
  player.sendMessage(`§a${def.name} нанят! ${formatArmyPowerLine(settlement)}`);
  return openKnightShop(player, settlementId);
}

export async function openSummonArmyMenu(player, settlementId) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement) return;

  if (!canCommandArmy(data, player, settlement)) {
    player.sendMessage("§cСозывать армию могут только Создатель, Рыцарь или Советник.");
    return openArmyMenu(player, settlementId);
  }

  if (hasActiveArmy(player)) {
    player.sendMessage("§eАрмия уже созвана. Откройте «Приказы».");
    return openArmyOrdersMenu(player);
  }

  const cooldownUntil = getDismissCooldownUntil(player);
  if (deps.system.currentTick < cooldownUntil) {
    const seconds = Math.ceil((cooldownUntil - deps.system.currentTick) / 20);
    player.sendMessage(`§cПовторный созыв через ${Math.ceil(seconds / 60)} мин.`);
    return openArmyMenu(player, settlementId);
  }

  const owned = getTotalOwnedKnights(settlement);
  if (owned <= 0) {
    player.sendMessage("§cНет нанятых рыцарей. Купите их в «Купить рыцаря».");
    return openArmyMenu(player, settlementId);
  }

  const maxCount = Math.min(MAX_SUMMON_KNIGHTS, owned);
  const form = new deps.ModalFormData()
    .title("Созвать армию")
    .slider(`Сколько рыцарей (макс. ${maxCount})`, 1, maxCount, { valueStep: 1, defaultValue: Math.min(3, maxCount) });

  const response = await deps.showForm(player, form);
  if (response.canceled) {
    return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.ARMY, false);
  }

  const count = Math.max(1, Math.min(maxCount, Math.round(Number(response.formValues?.[0] ?? 1))));
  summonArmy(player, settlement, count);
  player.sendMessage(`§aСозвано рыцарей: ${count}. Открываю меню приказов.`);
  return openArmyOrdersMenu(player);
}

function summonArmy(player, settlement, count) {
  dismissArmyForPlayerId(player.id, false);

  const dimension = player.dimension;
  const base = player.location;
  const knightIds = [];
  const ownerTag = knightTag(player.id);

  for (let i = 0; i < count; i += 1) {
    const loc = spawnOffset(base, i, count);
    try {
      const knight = dimension.spawnEntity(KNIGHT_ENTITY, loc);
      knight.nameTag = "§6Рыцарь";
      knight.addTag("kingdoms_knight");
      knight.addTag(ownerTag);
      knight.addTag(`kingdoms_settlement_${settlement.id}`);
      knightIds.push(knight.id);
    } catch (error) {
      player.sendMessage(`§cНе удалось призвать рыцаря: ${error}`);
    }
  }

  if (!knightIds.length) return;

  activeArmies.set(player.id, {
    settlementId: settlement.id,
    knightIds,
    mode: "follow",
    holdPoint: { x: base.x, y: base.y, z: base.z }
  });
}

export async function openArmyOrdersMenu(player) {
  const state = getArmyState(player);
  if (!state) {
    player.sendMessage("§cАрмия не созвана.");
    return undefined;
  }

  const modeLabel = state.mode === "peace"
    ? "режим: не атаковать"
    : state.mode === "hold"
      ? "режим: стоять"
      : "режим: следовать";

  const form = new deps.ActionFormData()
    .title(ARMY_ORDERS_TITLE)
    .body(`§lПриказы§r\n${modeLabel}\nРыцарей: ${state.knightIds.length}`)
    .button("Не Атаковать!", "")
    .button("Стоять тут", "")
    .button("Распустить", "")
    .button("Закрыть", "");

  const response = await deps.showForm(player, form);
  if (response.canceled) return undefined;

  switch (response.selection) {
    case 0:
      state.mode = "peace";
      player.sendMessage("§aРыцари не будут атаковать в ответ.");
      break;
    case 1: {
      state.mode = "hold";
      const loc = player.location;
      state.holdPoint = { x: loc.x, y: loc.y, z: loc.z };
      for (const knightId of state.knightIds) {
        const knight = deps.world.getEntity(knightId);
        if (knight?.isValid) {
          knight.teleport(loc, { dimension: knight.dimension });
        }
      }
      player.sendMessage("§aРыцари заняли позицию.");
      break;
    }
    case 2:
      dismissArmyForPlayerId(player.id, true);
      player.sendMessage("§eАрмия распущена. Повторный созыв через 15 минут.");
      return undefined;
    default:
      return undefined;
  }

  return openArmyOrdersMenu(player);
}

export function dismissArmiesForSettlement(settlementId) {
  for (const [playerId, state] of activeArmies.entries()) {
    if (state.settlementId === settlementId) {
      dismissArmyForPlayerId(playerId, false);
    }
  }
}
