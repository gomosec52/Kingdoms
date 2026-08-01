import {
  ItemStack,
  system,
  world
} from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { kingdomsMenuTitle, KINGDOMS_MENU_PAGE } from "./ui.js";
import { formatCooldownTicks } from "./war.js";

export const BREWERY_BLOCK = "kingdoms:brewery";
export const WINERY_BLOCK = "kingdoms:winery";
export const BREWERY_INTERACT_COMPONENT = "kingdoms:brewery_interact";
export const WINERY_INTERACT_COMPONENT = "kingdoms:winery_interact";
export const BEER_ITEM = "kingdoms:beer";
export const WINE_ITEM = "kingdoms:wine";

const HIDDEN_MENU_SLOT = "—";
const TRANSPARENT_ICON = "textures/ui/kingdoms/transparent";

const FERMENT_TICKS = 7 * 60 * 20;
const FILL_STEP_TICKS = 2 * 60 * 20;

const BEER_OUTPUT_BY_TIER = [2, 3, 4, 5, 8];
const WINE_OUTPUT_BY_TIER = [2, 3, 4, 5, 8];

const MIN_SETTLEMENT_TYPE_INDEX = 1;

const BREWERY_BUY_COST = [
  { itemId: "kingdoms:coin_silver", amount: 18, label: "серебряные монеты" },
  { itemId: "minecraft:iron_ingot", amount: 6, label: "железные слитки" },
  { itemId: "minecraft:barrel", amount: 2, label: "бочки" },
  { itemId: "minecraft:oak_planks", amount: 16, label: "дубовые доски" }
];

const WINERY_BUY_COST = [
  { itemId: "kingdoms:coin_silver", amount: 20, label: "серебряные монеты" },
  { itemId: "minecraft:iron_ingot", amount: 8, label: "железные слитки" },
  { itemId: "minecraft:glass", amount: 16, label: "стекло" },
  { itemId: "minecraft:sweet_berries", amount: 8, label: "сладкие ягоды" }
];

const BREWERY_UPGRADE_COSTS = {
  2: [
    { itemId: "kingdoms:coin_silver", amount: 22, label: "серебряные монеты" },
    { itemId: "minecraft:iron_ingot", amount: 8, label: "железные слитки" },
    { itemId: "minecraft:wheat", amount: 32, label: "пшеница" }
  ],
  3: [
    { itemId: "kingdoms:coin_silver", amount: 32, label: "серебряные монеты" },
    { itemId: "kingdoms:coin_gold", amount: 1, label: "золотые монеты" },
    { itemId: "minecraft:sugar", amount: 16, label: "сахар" }
  ],
  4: [
    { itemId: "kingdoms:coin_silver", amount: 48, label: "серебряные монеты" },
    { itemId: "kingdoms:coin_gold", amount: 2, label: "золотые монеты" },
    { itemId: "minecraft:copper_block", amount: 8, label: "медные блоки" }
  ],
  5: [
    { itemId: "kingdoms:coin_silver", amount: 64, label: "серебряные монеты" },
    { itemId: "kingdoms:coin_gold", amount: 4, label: "золотые монеты" },
    { itemId: "minecraft:diamond", amount: 1, label: "алмаз" }
  ]
};

const WINERY_UPGRADE_COSTS = {
  2: [
    { itemId: "kingdoms:coin_silver", amount: 24, label: "серебряные монеты" },
    { itemId: "minecraft:glass", amount: 12, label: "стекло" },
    { itemId: "minecraft:sweet_berries", amount: 32, label: "сладкие ягоды" }
  ],
  3: [
    { itemId: "kingdoms:coin_silver", amount: 36, label: "серебряные монеты" },
    { itemId: "kingdoms:coin_gold", amount: 1, label: "золотые монеты" },
    { itemId: "minecraft:honeycomb", amount: 16, label: "соты" }
  ],
  4: [
    { itemId: "kingdoms:coin_silver", amount: 50, label: "серебряные монеты" },
    { itemId: "kingdoms:coin_gold", amount: 2, label: "золотые монеты" },
    { itemId: "minecraft:gold_block", amount: 8, label: "золотые блоки" }
  ],
  5: [
    { itemId: "kingdoms:coin_silver", amount: 70, label: "серебряные монеты" },
    { itemId: "kingdoms:coin_gold", amount: 4, label: "золотые монеты" },
    { itemId: "minecraft:emerald", amount: 1, label: "изумруд" }
  ]
};

/** @type {Record<string, any> | null} */
let deps = null;

function ensureWorkshops(data) {
  if (!Array.isArray(data.breweryWorkshops)) data.breweryWorkshops = [];
  if (!Array.isArray(data.wineryWorkshops)) data.wineryWorkshops = [];
}

function workshopLocationKey(location, dimensionId) {
  return `${dimensionId}:${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
}

function findBreweryWorkshop(data, location, dimensionId) {
  const key = workshopLocationKey(location, dimensionId);
  return data.breweryWorkshops.find((entry) => workshopLocationKey(entry.location, entry.dimensionId) === key);
}

function findWineryWorkshop(data, location, dimensionId) {
  const key = workshopLocationKey(location, dimensionId);
  return data.wineryWorkshops.find((entry) => workshopLocationKey(entry.location, entry.dimensionId) === key);
}

function findBreweryForSettlement(data, settlementId) {
  return data.breweryWorkshops.find((entry) => entry.settlementId === settlementId);
}

function findWineryForSettlement(data, settlementId) {
  return data.wineryWorkshops.find((entry) => entry.settlementId === settlementId);
}

function nextWorkshopId(data, kind) {
  const field = kind === "brewery" ? "nextBreweryWorkshopIdValue" : "nextWineryWorkshopIdValue";
  const id = data[field] || 1;
  data[field] = id + 1;
  return id;
}

function formatCostList(cost) {
  return cost.map((entry) => `${entry.amount} ${entry.label}`).join(", ");
}

function getFermentFillLevel(record, now) {
  if (!record || record.state !== "processing" || !record.startTick) return 0;
  const elapsed = now - record.startTick;
  if (elapsed >= 6 * FILL_STEP_TICKS) return 3;
  if (elapsed >= 2 * FILL_STEP_TICKS) return 2;
  if (elapsed >= FILL_STEP_TICKS) return 1;
  return 0;
}

function fermentMenuTitle(kind, fillLevel) {
  return `${kingdomsMenuTitle(KINGDOMS_MENU_PAGE.FERMENT_WORK)}|kind=${kind}|fill=${fillLevel}|`;
}

function beerEffectsForTier(tier) {
  const bonus = (tier - 1) * 15;
  return { speed: 60 + bonus, strength: 45 + bonus };
}

function wineEffectsForTier(tier) {
  const bonus = (tier - 1) * 15;
  return { speed: 40 + bonus, nausea: 20, jump: 60 + bonus };
}

function applyDrinkEffects(player, kind, tier) {
  if (!player?.isValid) return;
  try {
    if (kind === "beer") {
      const effect = beerEffectsForTier(tier);
      player.addEffect("speed", effect.speed * 20, { amplifier: 0, showParticles: true });
      player.addEffect("strength", effect.strength * 20, { amplifier: 0, showParticles: true });
    } else {
      const effect = wineEffectsForTier(tier);
      player.addEffect("speed", effect.speed * 20, { amplifier: 0, showParticles: true });
      player.addEffect("nausea", effect.nausea * 20, { amplifier: 0, showParticles: true });
      player.addEffect("jump_boost", effect.jump * 20, { amplifier: 0, showParticles: true });
    }
  } catch (_error) {
    // Effects may be unavailable on some builds.
  }
}

function tickFermentWorkshops() {
  const data = deps.loadData();
  ensureWorkshops(data);
  const now = system.currentTick;
  let changed = false;
  for (const record of [...data.breweryWorkshops, ...data.wineryWorkshops]) {
    if (record.state === "processing" && record.finishTick && now >= record.finishTick) {
      record.state = "ready";
      changed = true;
    }
  }
  if (changed) deps.saveData(data);
}

function formatShopBody(data, settlement) {
  const brewery = findBreweryForSettlement(data, settlement.id);
  const winery = findWineryForSettlement(data, settlement.id);
  const breweryTier = brewery?.tier ?? settlement.breweryTier ?? 0;
  const wineryTier = winery?.tier ?? settlement.wineryTier ?? 0;
  const breweryPlaced = brewery ? "§aна карте§r" : "§7не установлен§r";
  const wineryPlaced = winery ? "§aна карте§r" : "§7не установлен§r";

  return [
    "§6Пивоварня и виноделие§r",
    "Купите блок, поставьте на своей территории.",
    "Улучшение — только если блок уже стоит (ур. 1–5).",
    "ПКМ / удержание — меню брожения.",
    "",
    `§eПивоварня§r: ${breweryPlaced}${breweryTier ? ` · ур. ${breweryTier}` : ""}`,
    `Покупка: ${formatCostList(BREWERY_BUY_COST)}`,
    "",
    `§eВиноделие§r: ${wineryPlaced}${wineryTier ? ` · ур. ${wineryTier}` : ""}`,
    `Покупка: ${formatCostList(WINERY_BUY_COST)}`,
    "",
    `§7Уровни: пивоварня §f${breweryTier || "—"}§7, виноделие §f${wineryTier || "—"}`,
    "§8Слева внизу — улучшения, справа — покупка блоков."
  ].join("\n");
}

function formatFermentBody(kind, record, tier, fillLevel) {
  const now = system.currentTick;
  const name = kind === "beer" ? "Пивоварня" : "Виноделие";
  const product = kind === "beer" ? "пиво" : "вино";
  const fillLabels = ["пусто", "¼", "½", "полная"];
  let status = "§aМожно начать брожение";
  if (record.state === "processing") {
    status = `§6Брожение: ${formatCooldownTicks(Math.max(0, record.finishTick - now))}`;
  } else if (record.state === "ready") {
    status = `§aГотово — заберите ${product}`;
  }

  const output = kind === "beer" ? BEER_OUTPUT_BY_TIER[tier - 1] : WINE_OUTPUT_BY_TIER[tier - 1];
  const recipe = kind === "beer"
    ? "§7Рецепт:§r ведро воды + сахар + бутылка воды (7 мин.)"
    : "§7Рецепт:§r ведро воды + мёд + сладкие ягоды ×3 (7 мин.)";

  return [
    `§6${name} · ур. ${tier}§r`,
    "",
    `§7Кружка: §e${fillLabels[fillLevel] ?? "пусто"}`,
    status,
    recipe,
    `§7Выдача:§r ${output} × ${product} за цикл`,
    "",
    "§8Ведро воды возвращается пустым."
  ].join("\n");
}

function hasBlockItem(player, blockId) {
  return deps.countItem(player, blockId) > 0;
}

function canBuyWorkshop(data, settlementId, blockId, kind) {
  const placed = kind === "brewery" ? findBreweryForSettlement(data, settlementId) : findWineryForSettlement(data, settlementId);
  if (placed) return { ok: false, message: "§cБлок уже установлен на карте." };
  return { ok: true };
}

async function openBreweryShopMenu(player, settlementId, sessionToken) {
  if (!deps.assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  const playerName = deps.getPlayerName(player);
  if (!settlement || !deps.canUseBreweryWinery(data, playerName, settlement)) {
    player.sendMessage("§cПивоварня и виноделие доступны жителям, кроме Крестьянина.");
    return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
  }

  const brewery = findBreweryForSettlement(data, settlement.id);
  const winery = findWineryForSettlement(data, settlement.id);
  const breweryTier = brewery?.tier ?? 0;
  const wineryTier = winery?.tier ?? 0;

  const form = new ActionFormData()
    .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.BREWERY_SHOP))
    .body(formatShopBody(data, settlement));

  const actions = [];

  // Fixed slots for JSON UI: 0–1 left upgrades, 2–3 right purchases, 4 back.
  if (winery && winery.tier < 5) {
    form.button(`Улучшить виноделие (${winery.tier}→${winery.tier + 1})`, "textures/ui/kingdoms/icon_winery");
    actions.push("upgrade_winery");
  } else {
    form.button(HIDDEN_MENU_SLOT, TRANSPARENT_ICON);
    actions.push("noop");
  }

  if (brewery && brewery.tier < 5) {
    form.button(`Улучшить пивоварню (${brewery.tier}→${brewery.tier + 1})`, "textures/ui/kingdoms/icon_brewery");
    actions.push("upgrade_brewery");
  } else {
    form.button(HIDDEN_MENU_SLOT, TRANSPARENT_ICON);
    actions.push("noop");
  }

  if (!brewery && !hasBlockItem(player, BREWERY_BLOCK)) {
    form.button("Купить пивоварню", "textures/ui/kingdoms/icon_brewery");
    actions.push("buy_brewery");
  } else {
    form.button(HIDDEN_MENU_SLOT, TRANSPARENT_ICON);
    actions.push("noop");
  }

  if (!winery && !hasBlockItem(player, WINERY_BLOCK)) {
    form.button("Купить виноделие", "textures/ui/kingdoms/icon_winery");
    actions.push("buy_winery");
  } else {
    form.button(HIDDEN_MENU_SLOT, TRANSPARENT_ICON);
    actions.push("noop");
  }

  form.button("Назад", "textures/ui/kingdoms/icon_disband");
  actions.push("back");

  const response = await deps.showFormDeferred(player, form);
  if (response.canceled || actions[response.selection] === "back") {
    return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
  }
  const action = actions[response.selection ?? -1];
  if (!action || action === "noop") {
    if (action === "noop") player.sendMessage("§7Это действие сейчас недоступно.");
    return openBreweryShopMenu(player, settlementId, sessionToken);
  }
  if (action === "buy_brewery") return purchaseWorkshopBlock(player, settlementId, sessionToken, "brewery");
  if (action === "buy_winery") return purchaseWorkshopBlock(player, settlementId, sessionToken, "winery");
  if (action === "upgrade_brewery") return upgradeWorkshop(player, settlementId, sessionToken, "brewery");
  if (action === "upgrade_winery") return upgradeWorkshop(player, settlementId, sessionToken, "winery");
}

async function purchaseWorkshopBlock(player, settlementId, sessionToken, kind) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement) return;

  if (settlement.typeIndex < MIN_SETTLEMENT_TYPE_INDEX) {
    player.sendMessage("§cНужен тип поселения «Большая деревня» или выше.");
    return openBreweryShopMenu(player, settlementId, sessionToken);
  }

  const blockId = kind === "brewery" ? BREWERY_BLOCK : WINERY_BLOCK;
  const cost = kind === "brewery" ? BREWERY_BUY_COST : WINERY_BUY_COST;
  const check = canBuyWorkshop(data, settlement.id, blockId, kind);
  if (!check.ok) {
    player.sendMessage(check.message);
    return openBreweryShopMenu(player, settlementId, sessionToken);
  }
  if (hasBlockItem(player, blockId)) {
    player.sendMessage("§cБлок уже есть в инвентаре.");
    return openBreweryShopMenu(player, settlementId, sessionToken);
  }

  if (deps.reportCostShortage(player, cost) || !deps.takeMixedCost(player, cost)) {
    player.sendMessage("§cНе хватает ресурсов.");
    return openBreweryShopMenu(player, settlementId, sessionToken);
  }

  deps.giveItemStack(player, new ItemStack(blockId, 1));
  player.sendMessage(`§a${kind === "brewery" ? "Пивоварня" : "Виноделие"} куплено. Поставьте на своей территории.`);
  return openBreweryShopMenu(player, settlementId, sessionToken);
}

async function upgradeWorkshop(player, settlementId, sessionToken, kind) {
  const data = deps.loadData();
  const record = kind === "brewery"
    ? findBreweryForSettlement(data, settlementId)
    : findWineryForSettlement(data, settlementId);

  if (!record) {
    player.sendMessage("§cСначала поставьте блок на карте — без этого улучшение недоступно.");
    return openBreweryShopMenu(player, settlementId, sessionToken);
  }
  if (record.tier >= 5) {
    player.sendMessage("§cУже максимальный уровень (5).");
    return openBreweryShopMenu(player, settlementId, sessionToken);
  }

  const nextTier = record.tier + 1;
  const costMap = kind === "brewery" ? BREWERY_UPGRADE_COSTS : WINERY_UPGRADE_COSTS;
  const cost = costMap[nextTier];
  if (!cost) return openBreweryShopMenu(player, settlementId, sessionToken);

  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement) return;

  if (deps.reportCostShortage(player, cost) || !deps.takeMixedCost(player, cost)) {
    player.sendMessage("§cНе хватает ресурсов для улучшения.");
    return openBreweryShopMenu(player, settlementId, sessionToken);
  }

  record.tier = nextTier;
  const tierField = kind === "brewery" ? "breweryTier" : "wineryTier";
  settlement[tierField] = nextTier;
  deps.saveData(data);
  player.sendMessage(`§a${kind === "brewery" ? "Пивоварня" : "Виноделие"} улучшена до ${nextTier} ур.`);
  return openBreweryShopMenu(player, settlementId, sessionToken);
}

function tryConsumeBeerIngredients(player) {
  if (deps.countItem(player, "minecraft:water_bucket") < 1) {
    return { ok: false, message: "§cНужно ведро воды." };
  }
  if (deps.countItem(player, "minecraft:sugar") < 1) {
    return { ok: false, message: "§cНужен сахар." };
  }
  if (deps.countItem(player, "minecraft:potion") < 1) {
    return { ok: false, message: "§cНужна бутылка воды." };
  }
  if (!deps.takeItem(player, "minecraft:sugar", 1) || !deps.takeItem(player, "minecraft:potion", 1)) {
    return { ok: false, message: "§cНе удалось списать ингредиенты." };
  }
  if (!deps.takeItem(player, "minecraft:water_bucket", 1)) {
    deps.giveItems(player, "minecraft:sugar", 1);
    return { ok: false, message: "§cНе удалось списать ведро воды." };
  }
  deps.giveItems(player, "minecraft:bucket", 1);
  return { ok: true };
}

function tryConsumeWineIngredients(player) {
  if (deps.countItem(player, "minecraft:water_bucket") < 1) {
    return { ok: false, message: "§cНужно ведро воды." };
  }
  if (deps.countItem(player, "minecraft:honey_bottle") < 1) {
    return { ok: false, message: "§cНужна бутылка мёда." };
  }
  if (deps.countItem(player, "minecraft:sweet_berries") < 3) {
    return { ok: false, message: "§cНужно 3 сладкие ягоды." };
  }
  if (!deps.takeItem(player, "minecraft:honey_bottle", 1) || !deps.takeItem(player, "minecraft:sweet_berries", 3)) {
    return { ok: false, message: "§cНе удалось списать ингредиенты." };
  }
  if (!deps.takeItem(player, "minecraft:water_bucket", 1)) {
    deps.giveItems(player, "minecraft:honey_bottle", 1);
    deps.giveItems(player, "minecraft:sweet_berries", 3);
    return { ok: false, message: "§cНе удалось списать ведро воды." };
  }
  deps.giveItems(player, "minecraft:bucket", 1);
  return { ok: true };
}

async function openFermentMenu(player, block, kind) {
  tickFermentWorkshops();
  const data = deps.loadData();
  const dimensionId = deps.getDimensionId(block.dimension);
  const record = kind === "beer"
    ? findBreweryWorkshop(data, block.location, dimensionId)
    : findWineryWorkshop(data, block.location, dimensionId);
  if (!record) {
    player.sendMessage("§cБлок не привязан к поселению.");
    return;
  }

  const settlement = deps.getSettlement(data, record.settlementId);
  const playerName = deps.getPlayerName(player);
  if (!settlement || !deps.canUseBreweryWinery(data, playerName, settlement)) {
    player.sendMessage("§cНет доступа к этому зданию.");
    return;
  }

  const now = system.currentTick;
  const fill = getFermentFillLevel(record, now);
  const form = new ActionFormData()
    .title(fermentMenuTitle(kind, fill))
    .body(formatFermentBody(kind, record, record.tier, fill));

  const actions = [];
  if (record.state === "idle") {
    form.button("Начать брожение", "textures/ui/kingdoms/icon_brewery");
    actions.push("start");
  }
  if (record.state === "ready") {
    form.button(kind === "beer" ? "Забрать пиво" : "Забрать вино", "textures/ui/kingdoms/icon_winery");
    actions.push("collect");
  }
  form.button("Обновить", "textures/ui/kingdoms/icon_info");
  actions.push("refresh");
  form.button("Закрыть", "textures/ui/kingdoms/icon_disband");
  actions.push("close");

  const response = await deps.showFormDeferred(player, form);
  if (response.canceled || actions[response.selection] === "close") return;
  if (actions[response.selection] === "refresh") {
    return openFermentMenu(player, block, kind);
  }
  if (actions[response.selection] === "start") {
    return startFerment(player, block, kind, record);
  }
  if (actions[response.selection] === "collect") {
    return collectFerment(player, block, kind, record);
  }
}

function createWorkshopRecord(data, settlement, block, kind, placedBy) {
  const blockId = kind === "brewery" ? BREWERY_BLOCK : WINERY_BLOCK;
  if (block.typeId !== blockId) return undefined;

  const list = kind === "brewery" ? data.breweryWorkshops : data.wineryWorkshops;
  const tierField = kind === "brewery" ? "breweryTier" : "wineryTier";
  const startTier = Math.max(1, Math.min(5, Number(settlement[tierField]) || 1));
  const record = {
    id: nextWorkshopId(data, kind),
    settlementId: settlement.id,
    tier: startTier,
    dimensionId: deps.getDimensionId(block.dimension),
    location: deps.blockPosition(block.location),
    state: "idle",
    startTick: 0,
    finishTick: 0,
    placedBy
  };
  list.push(record);
  return record;
}

function tryEnsureWorkshopRecord(data, block, kind, playerName) {
  const dimensionId = deps.getDimensionId(block.dimension);
  const existingAtBlock = kind === "beer"
    ? findBreweryWorkshop(data, block.location, dimensionId)
    : findWineryWorkshop(data, block.location, dimensionId);
  if (existingAtBlock) return existingAtBlock;

  const settlement = deps.findSettlementAt(data, block.location, dimensionId);
  if (!settlement || !deps.hasTerritoryAccess(data, settlement, playerName)) return undefined;

  const workshopKind = kind === "beer" ? "brewery" : "winery";
  const existingForSettlement = workshopKind === "brewery"
    ? findBreweryForSettlement(data, settlement.id)
    : findWineryForSettlement(data, settlement.id);
  if (existingForSettlement) {
    if (workshopLocationKey(existingForSettlement.location, existingForSettlement.dimensionId)
      === workshopLocationKey(block.location, dimensionId)) {
      return existingForSettlement;
    }
    return undefined;
  }

  ensureWorkshops(data);
  const record = createWorkshopRecord(data, settlement, block, workshopKind, playerName);
  if (record) deps.saveData(data);
  return record;
}

function handleWorkshopBlockInteract(player, block, kind) {
  if (!player?.isValid || !block) return;

  const data = deps.loadData();
  ensureWorkshops(data);
  const playerName = deps.getPlayerName(player);
  const record = tryEnsureWorkshopRecord(data, block, kind, playerName);
  if (!record) {
    player.sendMessage("§cБлок не привязан к поселению. Поставьте его на своей территории.");
    return;
  }

  openFermentMenu(player, block, kind).catch((error) => {
    player.sendMessage(`§c[Королевства] Ошибка меню: ${error?.message ?? error}`);
  });
}

let workshopComponentsRegistered = false;

function registerWorkshopBlockComponents(initEvent) {
  const registry = initEvent.blockComponentRegistry;
  if (workshopComponentsRegistered || !registry?.registerCustomComponent) return;

  registry.registerCustomComponent(BREWERY_INTERACT_COMPONENT, {
    onPlayerInteract(event) {
      if (!event.player) return;
      system.run(() => handleWorkshopBlockInteract(event.player, event.block, "beer"));
    }
  });
  registry.registerCustomComponent(WINERY_INTERACT_COMPONENT, {
    onPlayerInteract(event) {
      if (!event.player) return;
      system.run(() => handleWorkshopBlockInteract(event.player, event.block, "wine"));
    }
  });
  workshopComponentsRegistered = true;
}

function startFerment(player, block, kind, record) {
  if (record.state !== "idle") {
    player.sendMessage("§cСейчас нельзя начать новое брожение.");
    return openFermentMenu(player, block, kind);
  }

  const consumed = kind === "beer" ? tryConsumeBeerIngredients(player) : tryConsumeWineIngredients(player);
  if (!consumed.ok) {
    player.sendMessage(consumed.message);
    return openFermentMenu(player, block, kind);
  }

  const data = deps.loadData();
  const dimensionId = deps.getDimensionId(block.dimension);
  const fresh = kind === "beer"
    ? findBreweryWorkshop(data, block.location, dimensionId)
    : findWineryWorkshop(data, block.location, dimensionId);
  if (!fresh || fresh.id !== record.id) return;

  const now = system.currentTick;
  fresh.state = "processing";
  fresh.startTick = now;
  fresh.finishTick = now + FERMENT_TICKS;
  deps.saveData(data);
  player.sendMessage("§aБрожение начато (7 мин.).");
  return openFermentMenu(player, block, kind);
}

function collectFerment(player, block, kind, record) {
  if (record.state !== "ready") {
    player.sendMessage("§cЕщё не готово.");
    return openFermentMenu(player, block, kind);
  }

  const outputTable = kind === "beer" ? BEER_OUTPUT_BY_TIER : WINE_OUTPUT_BY_TIER;
  const amount = outputTable[Math.max(0, Math.min(4, record.tier - 1))];
  const itemId = kind === "beer" ? BEER_ITEM : WINE_ITEM;

  if (!deps.canFitItemAmount(player, itemId, amount)) {
    player.sendMessage("§cОсвободите место в инвентаре.");
    return openFermentMenu(player, block, kind);
  }

  const data = deps.loadData();
  const dimensionId = deps.getDimensionId(block.dimension);
  const fresh = kind === "beer"
    ? findBreweryWorkshop(data, block.location, dimensionId)
    : findWineryWorkshop(data, block.location, dimensionId);
  if (!fresh || fresh.id !== record.id) return;

  fresh.state = "idle";
  fresh.startTick = 0;
  fresh.finishTick = 0;
  deps.saveData(data);

  for (let i = 0; i < amount; i += 1) {
    const stack = new ItemStack(itemId, 1);
    try {
      stack.setDynamicProperty("kingdoms:drink_tier", fresh.tier);
    } catch (_error) {
      // Property may be unregistered on older builds.
    }
    deps.giveItemStack(player, stack);
  }
  player.sendMessage(`§aПолучено: ${amount} × ${kind === "beer" ? "пиво" : "вино"}.`);
  return openFermentMenu(player, block, kind);
}

function registerPlacedWorkshop(player, block, kind) {
  const blockId = kind === "brewery" ? BREWERY_BLOCK : WINERY_BLOCK;
  if (block.typeId !== blockId) return;

  const data = deps.loadData();
  ensureWorkshops(data);
  const settlement = deps.findSettlementAt(data, block.location, deps.getDimensionId(block.dimension));
  const playerName = deps.getPlayerName(player);

  if (!settlement || !deps.hasTerritoryAccess(data, settlement, playerName)) {
    deps.setBlockToAir(block);
    deps.giveItemStack(player, new ItemStack(blockId, 1));
    player.sendMessage("§cСтавить можно только на своей территории.");
    deps.saveData(data);
    return;
  }

  const existing = kind === "brewery"
    ? findBreweryForSettlement(data, settlement.id)
    : findWineryForSettlement(data, settlement.id);
  if (existing) {
    deps.setBlockToAir(block);
    deps.giveItemStack(player, new ItemStack(blockId, 1));
    player.sendMessage(`§cВ поселении уже есть ${kind === "brewery" ? "пивоварня" : "виноделие"}.`);
    deps.saveData(data);
    return;
  }

  createWorkshopRecord(data, settlement, block, kind, playerName);
  deps.saveData(data);
  const tier = (kind === "brewery" ? findBreweryForSettlement : findWineryForSettlement)(data, settlement.id)?.tier ?? 1;
  player.sendMessage(`§a${kind === "brewery" ? "Пивоварня" : "Виноделие"} установлено (ур. ${tier}).`);
}

function handleWorkshopBreak(player, block, kind) {
  const blockId = kind === "brewery" ? BREWERY_BLOCK : WINERY_BLOCK;
  if (block.typeId !== blockId) return false;

  const data = deps.loadData();
  const dimensionId = deps.getDimensionId(block.dimension);
  const record = kind === "brewery"
    ? findBreweryWorkshop(data, block.location, dimensionId)
    : findWineryWorkshop(data, block.location, dimensionId);
  const settlement = record
    ? deps.getSettlement(data, record.settlementId)
    : deps.findSettlementAt(data, block.location, dimensionId);
  const playerName = deps.getPlayerName(player);

  if (settlement && !deps.canUseBreweryWinery(data, playerName, settlement)) {
    return true;
  }
  return false;
}

function removeWorkshopRecordAt(block, kind) {
  const blockId = kind === "brewery" ? BREWERY_BLOCK : WINERY_BLOCK;
  if (block.typeId !== blockId) return;

  const data = deps.loadData();
  ensureWorkshops(data);
  const dimensionId = deps.getDimensionId(block.dimension);
  const record = kind === "brewery"
    ? findBreweryWorkshop(data, block.location, dimensionId)
    : findWineryWorkshop(data, block.location, dimensionId);
  if (!record) return;

  const settlement = deps.getSettlement(data, record.settlementId);
  const list = kind === "brewery" ? data.breweryWorkshops : data.wineryWorkshops;
  const index = list.findIndex((entry) => entry.id === record.id);
  if (index >= 0) list.splice(index, 1);
  if (settlement) {
    const tierField = kind === "brewery" ? "breweryTier" : "wineryTier";
    settlement[tierField] = record.tier;
  }
  deps.saveData(data);
}

export function bindBrewerySystem(bindDeps) {
  deps = bindDeps;

  system.beforeEvents?.startup?.subscribe((event) => {
    registerWorkshopBlockComponents(event);
  });
  bindDeps.world.beforeEvents?.worldInitialize?.subscribe((event) => {
    registerWorkshopBlockComponents(event);
  });

  bindDeps.system.runInterval(() => tickFermentWorkshops(), 40);

  bindDeps.world.afterEvents.playerPlaceBlock?.subscribe((event) => {
    if (event.block.typeId === BREWERY_BLOCK) {
      system.run(() => registerPlacedWorkshop(event.player, event.block, "brewery"));
    } else if (event.block.typeId === WINERY_BLOCK) {
      system.run(() => registerPlacedWorkshop(event.player, event.block, "winery"));
    }
  });

  bindDeps.world.afterEvents.itemCompleteUse?.subscribe((event) => {
    const typeId = event.itemStack?.typeId;
    if (typeId === BEER_ITEM) {
      const tier = Number(event.itemStack.getDynamicProperty?.("kingdoms:drink_tier") ?? 1) || 1;
      applyDrinkEffects(event.source, "beer", tier);
    } else if (typeId === WINE_ITEM) {
      const tier = Number(event.itemStack.getDynamicProperty?.("kingdoms:drink_tier") ?? 1) || 1;
      applyDrinkEffects(event.source, "wine", tier);
    }
  });
}

export {
  openBreweryShopMenu,
  handleWorkshopBreak,
  removeWorkshopRecordAt,
  handleWorkshopBlockInteract,
  BREWERY_BLOCK as BREWERY_BLOCK_ID,
  WINERY_BLOCK as WINERY_BLOCK_ID
};
