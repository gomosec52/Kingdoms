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

  deps.system.runInterval(() => tickArmies(), 20);
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

function getBodyRightVector(player) {
  const rot = player.getRotation();
  const yawRad = (rot?.y ?? 0) * (Math.PI / 180);
  return {
    x: Math.cos(yawRad),
    z: Math.sin(yawRad)
  };
}

function getFixedMenuPosition(player, index) {
  const right = getBodyRightVector(player);
  const base = player.location;
  const horizontalDist = 3.2;
  return {
    x: base.x + right.x * horizontalDist,
    y: base.y + 1.85 - index * 0.62,
    z: base.z + right.z * horizontalDist
  };
}

function tameKnight(knight, player) {
  try {
    const tameable = knight.getComponent("minecraft:tameable");
    tameable?.tame(player);
  } catch (_error) {
    // Ignore when tameable is unavailable.
  }
}

function setKnightsMode(state, mode, player) {
  for (const knightId of state.knightIds) {
    const knight = deps.world.getEntity(knightId);
    if (!knight?.isValid) continue;
    try {
      if (mode === ORDER_MODES.HOLD) {
        knight.triggerEvent("kingdoms:mode_hold");
      } else {
        knight.triggerEvent("kingdoms:mode_follow");
        tameKnight(knight, player);
      }
    } catch (_error) {
      // Ignore event failures on older runtimes.
    }
  }
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

function spawnOrderButtons(player) {
  const dimension = player.dimension;
  const ownerTag = orderBtnTag(player.id);
  const ids = [];

  for (let i = 0; i < ORDER_BUTTONS.length; i += 1) {
    const def = ORDER_BUTTONS[i];
    const pos = getFixedMenuPosition(player, i);
    try {
      const entity = dimension.spawnEntity(ORDER_BTN_ENTITY, pos);
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
    setKnightsMode(state, ORDER_MODES.HOLD, player);
    for (const knightId of state.knightIds) {
      const knight = deps.world.getEntity(knightId);
      if (knight?.isValid) {
        knight.teleport(state.holdPoint, { dimension: knight.dimension });
      }
    }
    player.sendMessage("§aРыцари стоят на месте.");
  } else if (orderId === ORDER_MODES.PEACE) {
    setKnightsMode(state, ORDER_MODES.FOLLOW, player);
    player.sendMessage("§aРыцари не атакуют в ответ.");
  } else {
    setKnightsMode(state, ORDER_MODES.FOLLOW, player);
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
}

function dismissArmyForPlayerId(playerId, applyCooldown) {
  const state = activeArmies.get(playerId);
  if (!state) return;
  cleanupArmyEntities(state);
  activeArmies.delete(playerId);

  const player = deps.world.getEntity(playerId);
  if (player?.isValid && applyCooldown) {
    setDismissCooldownUntil(player, deps.system.currentTick + ARMY_DISMISS_COOLDOWN_TICKS);
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
    lines.push("", "§aПриказы справа§r — удар или ПКМ по тексту.");
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
    player.sendMessage("§eАрмия уже созвана. Приказы справа — удар или ПКМ по тексту.");
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
  player.sendMessage(`§aСозвано ${count} рыцарей. Приказы справа — удар или ПКМ по тексту.`);
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
      tameKnight(knight, player);
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
  setKnightsMode(state, ORDER_MODES.FOLLOW, player);
  updateOrderButtonLabels(player, state);
}

export async function openArmyOrdersMenu(player) {
  if (!hasActiveArmy(player)) {
    player.sendMessage("§cАрмия не созвана.");
    return undefined;
  }
  player.sendMessage("§7Приказы справа от вас: удар или ПКМ по тексту.");
  return undefined;
}

export function dismissArmiesForSettlement(settlementId) {
  for (const [playerId, state] of activeArmies.entries()) {
    if (state.settlementId === settlementId) {
      dismissArmyForPlayerId(playerId, false);
    }
  }
}
