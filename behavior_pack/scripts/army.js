export const KNIGHT_ENTITY = "kingdoms:knight";
export const ORDER_BTN_ENTITY = "kingdoms:order_btn";
export const MAX_ARMY_POWER = 1000;
export const MAX_SUMMON_KNIGHTS = 5;
export const KNIGHTS_PER_BARRACKS = 5;
export const KNIGHT_PURCHASE_BATCH = 5;
export const ARMY_DISMISS_COOLDOWN_TICKS = 15 * 60 * 20;
export const POWER_PER_RESIDENT = 15;
export const DEFAULT_KNIGHT_TYPE = "plate_knight";

export const ORDER_MODES = {
  FOLLOW: "follow",
  HOLD: "hold",
  PEACE: "peace"
};

export const ORDER_BUTTONS = [
  { id: ORDER_MODES.FOLLOW, label: "Следовать" },
  { id: ORDER_MODES.HOLD, label: "Стоять" },
  { id: ORDER_MODES.PEACE, label: "Не атак." },
  { id: "dismiss", label: "Расформ." }
];

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
    handleOwnerHurt(/** @type {import("@minecraft/server").Player} */ (hurt), event.damageSource?.damagingEntity);
  });

  deps.world.afterEvents.entityHitEntity?.subscribe((event) => {
    handleOrderButtonTouch(event.damagingEntity, event.hitEntity);
  });

  deps.world.afterEvents.playerInteractWithEntity?.subscribe((event) => {
    handleOrderButtonTouch(event.player, event.target);
  });

  deps.world.afterEvents.playerLeave.subscribe((event) => {
    dismissArmyForPlayerId(event.playerId, false);
  });

  deps.system.runInterval(() => tickArmies(), 5);
  deps.system.runInterval(() => tickOrderButtons(), 4);
}

function handleOrderButtonTouch(source, target) {
  if (!source || source.typeId !== "minecraft:player") return;
  if (!target?.isValid || target.typeId !== ORDER_BTN_ENTITY) return;
  if (!target.hasTag("kingdoms_order_btn")) return;

  const player = /** @type {import("@minecraft/server").Player} */ (source);
  if (!hasActiveArmy(player)) return;
  if (!target.hasTag(knightTag(player.id))) return;

  for (const btn of ORDER_BUTTONS) {
    if (target.hasTag(`kingdoms_order_${btn.id}`)) {
      applyArmyOrder(player, btn.id);
      return;
    }
  }
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

export function countOwnedKnights(settlement, knightId = DEFAULT_KNIGHT_TYPE) {
  ensureSettlementArmyData(settlement);
  const entry = settlement.knights.find((k) => k.type === knightId);
  return entry?.count ?? 0;
}

export function getTotalOwnedKnights(settlement) {
  return countOwnedKnights(settlement, DEFAULT_KNIGHT_TYPE);
}

export function getKnightCapacity(settlement) {
  return countBarracks(settlement) * KNIGHTS_PER_BARRACKS;
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
    `Рыцари: ${owned}/${capacity || 0}`,
    "",
    "1 казарма = 5 слотов рыцарей.",
    "Покупка: сразу 5 рыцарей.",
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

function orderBtnTag(playerId) {
  return `kingdoms_order_owner_${playerId}`;
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

function getLeftOffset(view, index) {
  const leftX = -view.z;
  const leftZ = view.x;
  const len = Math.sqrt(leftX * leftX + leftZ * leftZ) || 1;
  const dist = 2.4;
  const yOffset = 1.75 - index * 0.58;
  return {
    x: (leftX / len) * dist,
    y: yOffset,
    z: (leftZ / len) * dist
  };
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
  if (!state || state.mode === ORDER_MODES.PEACE) return;
  if (!damagingEntity?.isValid) return;
  if (damagingEntity.id === player.id) return;
  markAttackTarget(damagingEntity);
}

function followEntity(entity, targetLoc, stopDistance) {
  const loc = entity.location;
  const dx = targetLoc.x - loc.x;
  const dz = targetLoc.z - loc.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist <= stopDistance) return;

  const speed = Math.min(0.14, (dist - stopDistance) * 0.035);
  try {
    entity.applyImpulse({ x: (dx / dist) * speed, y: 0.02, z: (dz / dist) * speed });
  } catch (_error) {
    // Fallback for entities without impulse support.
    const step = Math.min(0.35, dist - stopDistance);
    entity.teleport(
      { x: loc.x + (dx / dist) * step, y: targetLoc.y, z: loc.z + (dz / dist) * step },
      { dimension: entity.dimension }
    );
  }
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
      cleanupArmyState(playerId);
      continue;
    }

    if (state.mode === ORDER_MODES.HOLD) {
      for (const knightId of state.knightIds) {
        const knight = deps.world.getEntity(knightId);
        if (!knight?.isValid) continue;
        const hold = state.holdPoint;
        if (distanceFlat(knight.location, hold) > 1.8) {
          followEntity(knight, hold, 1.2);
        }
      }
      continue;
    }

    const targetLoc = player.location;
    for (const knightId of state.knightIds) {
      const knight = deps.world.getEntity(knightId);
      if (!knight?.isValid) continue;
      followEntity(knight, targetLoc, 5);
    }
  }
}

function formatOrderLabel(label, active) {
  return active ? `§a▶ ${label}` : `§7  ${label}`;
}

function updateOrderButtonLabels(player, state) {
  for (const btn of state.orderBtnIds || []) {
    const entity = deps.world.getEntity(btn.id);
    if (!entity?.isValid) continue;
    const def = ORDER_BUTTONS.find((entry) => entry.id === btn.orderId);
    if (!def) continue;
    const active = btn.orderId === "dismiss" ? false : btn.orderId === state.mode;
    entity.nameTag = formatOrderLabel(def.label, active);
  }
}

function tickOrderButtons() {
  for (const [playerId, state] of activeArmies.entries()) {
    const player = deps.world.getEntity(playerId);
    if (!player?.isValid) continue;

    const view = player.getViewDirection();
    const base = player.location;
    for (let i = 0; i < (state.orderBtnIds || []).length; i += 1) {
      const btn = state.orderBtnIds[i];
      const entity = deps.world.getEntity(btn.id);
      if (!entity?.isValid) continue;
      const offset = getLeftOffset(view, i);
      const pos = { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z };
      try {
        entity.teleport(pos, { dimension: player.dimension });
      } catch (_error) {
        // Ignore teleport failures.
      }
    }

    updateOrderButtonLabels(player, state);
    try {
      player.onScreenDisplay.setActionBar(
        `§6Приказы §7| §f${ORDER_BUTTONS.find((b) => b.id === state.mode)?.label ?? "—"} §7| удар/ПКМ по кнопкам`
      );
    } catch (_error) {
      // Ignore action bar failures.
    }
  }
}

function spawnOrderButtons(player) {
  const dimension = player.dimension;
  const ownerTag = orderBtnTag(player.id);
  const ids = [];

  for (let i = 0; i < ORDER_BUTTONS.length; i += 1) {
    const def = ORDER_BUTTONS[i];
    try {
      const entity = dimension.spawnEntity(ORDER_BTN_ENTITY, player.location);
      entity.addTag("kingdoms_order_btn");
      entity.addTag(ownerTag);
      entity.addTag(knightTag(player.id));
      entity.addTag(`kingdoms_order_${def.id}`);
      entity.nameTag = formatOrderLabel(def.label, def.id === ORDER_MODES.FOLLOW);
      ids.push({ id: entity.id, orderId: def.id });
    } catch (_error) {
      // Ignore spawn failures.
    }
  }

  return ids;
}

function removeOrderButtons(state) {
  for (const btn of state.orderBtnIds || []) {
    const entity = deps.world.getEntity(btn.id);
    if (entity?.isValid) entity.remove();
  }
  state.orderBtnIds = [];
}

function setArmyHudTag(player, enabled) {
  try {
    if (enabled) player.addTag("kingdoms_army_hud");
    else player.removeTag("kingdoms_army_hud");
  } catch (_error) {
    // Ignore tag failures.
  }
}

function applyArmyOrder(player, orderId) {
  const state = getArmyState(player);
  if (!state) return;

  if (orderId === "dismiss") {
    dismissArmyForPlayerId(player.id, true);
    player.sendMessage("§eАрмия распущена. Повторный созыв через 15 минут.");
    return;
  }

  state.mode = orderId;
  if (orderId === ORDER_MODES.HOLD) {
    const loc = player.location;
    state.holdPoint = { x: loc.x, y: loc.y, z: loc.z };
    for (const knightId of state.knightIds) {
      const knight = deps.world.getEntity(knightId);
      if (knight?.isValid) knight.teleport(loc, { dimension: knight.dimension });
    }
    player.sendMessage("§aРыцари стоят на месте.");
  } else if (orderId === ORDER_MODES.PEACE) {
    player.sendMessage("§aРыцари не атакуют в ответ.");
  } else {
    player.sendMessage("§aРыцари следуют за вами.");
  }

  updateOrderButtonLabels(player, state);
}

function cleanupArmyEntities(state) {
  for (const knightId of state.knightIds || []) {
    const knight = deps.world.getEntity(knightId);
    if (knight?.isValid) knight.remove();
  }
  removeOrderButtons(state);
}

function cleanupArmyState(playerId) {
  const state = activeArmies.get(playerId);
  if (state) cleanupArmyEntities(state);
  activeArmies.delete(playerId);
  const player = deps.world.getEntity(playerId);
  if (player?.isValid) setArmyHudTag(player, false);
}

function dismissArmyForPlayerId(playerId, applyCooldown) {
  const state = activeArmies.get(playerId);
  if (!state) return;
  cleanupArmyEntities(state);
  activeArmies.delete(playerId);

  const player = deps.world.getEntity(playerId);
  if (player?.isValid) {
    setArmyHudTag(player, false);
    if (applyCooldown) {
      setDismissCooldownUntil(player, deps.system.currentTick + ARMY_DISMISS_COOLDOWN_TICKS);
    }
  }
}

export async function openArmyMenu(player, settlementId) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement) return;

  ensureSettlementArmyData(settlement);
  const lines = [
    formatArmyPowerLine(settlement),
    `Казармы: ${countBarracks(settlement)}/10`,
    `Рыцари: ${getTotalOwnedKnights(settlement)}/${getKnightCapacity(settlement) || 0}`,
    "",
    "Купите казармы в «Строительстве».",
    "Найм: сразу 5 рыцарей за покупку.",
    "",
    "Созыв доступен: Рыцарь, Советник, Создатель."
  ];

  if (hasActiveArmy(player)) {
    lines.push("", "§aПриказы слева на экране§r — удар или ПКМ.");
  }

  const form = new deps.ActionFormData()
    .title(deps.settlementMenuTitle(deps.SETTLEMENT_MENU_PAGE.ARMY))
    .body(lines.join("\n"))
    .button("Купить рыцаря", "textures/ui/kingdoms/icon_war")
    .button("Созвать армию", "textures/ui/kingdoms/icon_war")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showForm(player, form);
  if (response.canceled) return;

  if (response.selection === 0) return openKnightShop(player, settlementId);
  if (response.selection === 1) return openSummonArmyMenu(player, settlementId);
  return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.ARMY, false);
}

export async function openKnightShop(player, settlementId) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement || !deps.requireOwner(player, settlement)) return;

  if (countBarracks(settlement) <= 0) {
    player.sendMessage("§cСначала купите казармы в разделе «Строительство».");
    return openArmyMenu(player, settlementId);
  }

  const def = getKnightDef(DEFAULT_KNIGHT_TYPE);
  return openKnightDetails(player, settlementId, def.id);
}

export async function openKnightDetails(player, settlementId, knightId) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement || !deps.requireOwner(player, settlement)) return;

  const def = getKnightDef(knightId);
  if (!def) return;

  const owned = countOwnedKnights(settlement, knightId);
  const cap = getKnightCapacity(settlement);
  const batchCost = (def.cost || []).map((e) => `${e.amount * KNIGHT_PURCHASE_BATCH} ${e.label}`).join(", ");
  const body = [
    def.name,
    def.description,
    `Мощь: +${def.power} за рыцаря`,
    `Покупка: ${KNIGHT_PURCHASE_BATCH} рыцарей`,
    `В штате: ${owned}/${cap}`,
    `Стоимость (${KNIGHT_PURCHASE_BATCH} шт.): ${batchCost}`
  ].join("\n");

  const canBuy = owned + KNIGHT_PURCHASE_BATCH <= cap;
  const form = new deps.ActionFormData()
    .title(deps.settlementMenuTitle(deps.SETTLEMENT_MENU_PAGE.ARMY))
    .body(body)
    .button(canBuy ? `Купить ${KNIGHT_PURCHASE_BATCH} шт.` : "Лимит", "textures/ui/kingdoms/icon_war")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showForm(player, form);
  if (response.canceled) return;
  if (response.selection !== 0) return openArmyMenu(player, settlementId);
  if (!canBuy) {
    player.sendMessage("§cНужно больше казарм или достигнут лимит рыцарей.");
    return openArmyMenu(player, settlementId);
  }

  const batchDef = {
    ...def,
    cost: (def.cost || []).map((entry) => ({
      ...entry,
      amount: entry.amount * KNIGHT_PURCHASE_BATCH
    }))
  };

  const missing = deps.getMissingBuildingCost(player, batchDef);
  if (missing.length) {
    player.sendMessage(`§cНе хватает материалов: ${missing.join(", ")}`);
    return openArmyMenu(player, settlementId);
  }
  if (!deps.takeBuildingCost(player, batchDef)) {
    player.sendMessage("§cНе удалось списать материалы.");
    return openArmyMenu(player, settlementId);
  }

  ensureSettlementArmyData(settlement);
  let entry = settlement.knights.find((k) => k.type === knightId);
  if (!entry) {
    entry = { type: knightId, count: 0 };
    settlement.knights.push(entry);
  }
  entry.count += KNIGHT_PURCHASE_BATCH;
  deps.saveData(data);
  player.sendMessage(`§aНанято ${KNIGHT_PURCHASE_BATCH} рыцарей! ${formatArmyPowerLine(settlement)}`);
  return openArmyMenu(player, settlementId);
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
    player.sendMessage("§eАрмия уже созвана. Используйте приказы слева.");
    return openArmyMenu(player, settlementId);
  }

  const cooldownUntil = getDismissCooldownUntil(player);
  if (deps.system.currentTick < cooldownUntil) {
    const seconds = Math.ceil((cooldownUntil - deps.system.currentTick) / 20);
    player.sendMessage(`§cПовторный созыв через ${Math.ceil(seconds / 60)} мин.`);
    return openArmyMenu(player, settlementId);
  }

  const owned = countOwnedKnights(settlement, DEFAULT_KNIGHT_TYPE);
  if (owned <= 0) {
    player.sendMessage("§cНет нанятых рыцарей.");
    return openArmyMenu(player, settlementId);
  }

  const maxCount = Math.min(MAX_SUMMON_KNIGHTS, owned);
  const form = new deps.ModalFormData()
    .title("Созвать армию")
    .slider(`Рыцари в доспехах (макс. ${maxCount})`, 1, maxCount, {
      valueStep: 1,
      defaultValue: Math.min(3, maxCount)
    });

  const response = await deps.showForm(player, form);
  if (response.canceled) return openArmyMenu(player, settlementId);

  const count = Math.max(1, Math.min(maxCount, Math.round(Number(response.formValues?.[0] ?? 1))));
  summonArmy(player, settlement, count);
  player.sendMessage(`§aСозвано ${count} рыцарей. Приказы слева — удар или ПКМ.`);
  return openArmyMenu(player, settlementId);
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
      knight.addTag(`kingdoms_knight_type_${DEFAULT_KNIGHT_TYPE}`);
      knightIds.push(knight.id);
    } catch (error) {
      player.sendMessage(`§cНе удалось призвать рыцаря: ${error}`);
    }
  }

  if (!knightIds.length) return;

  const state = {
    settlementId: settlement.id,
    knightType: DEFAULT_KNIGHT_TYPE,
    knightIds,
    orderBtnIds: [],
    mode: ORDER_MODES.FOLLOW,
    holdPoint: { x: base.x, y: base.y, z: base.z }
  };

  activeArmies.set(player.id, state);
  state.orderBtnIds = spawnOrderButtons(player);
  setArmyHudTag(player, true);
  updateOrderButtonLabels(player, state);
}

export async function openArmyOrdersMenu(player) {
  if (!hasActiveArmy(player)) {
    player.sendMessage("§cАрмия не созвана.");
    return undefined;
  }
  player.sendMessage("§7Приказы слева на экране: удар или ПКМ по кнопкам.");
  return undefined;
}

export function dismissArmiesForSettlement(settlementId) {
  for (const [playerId, state] of activeArmies.entries()) {
    if (state.settlementId === settlementId) {
      dismissArmyForPlayerId(playerId, false);
    }
  }
}
