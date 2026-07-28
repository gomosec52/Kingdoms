import { ItemStack } from "@minecraft/server";
import {
  COIN_GOLD,
  COIN_SILVER,
  countItem,
  takeItem,
  takeMixedCost,
  reportCostShortage
} from "./economy.js";
import { formatCooldownTicks, SETTLEMENT_TYPE_NAMES } from "./war.js";

export const MINT_BLOCK_T1 = "kingdoms:mint_workshop_1";
export const MINT_BLOCK_T2 = "kingdoms:mint_workshop_2";
export const MINT_SMELT_TICKS = 10 * 60 * 20;

export const MINT_TIER_DEFS = {
  1: {
    tier: 1,
    name: "Чеканный двор I",
    blockId: MINT_BLOCK_T1,
    taxBonus: 3,
    minTypeIndex: 1,
    maxPerSettlement: 1,
    cost: [
      { itemId: "kingdoms:coin_silver", amount: 28, label: "серебряные монеты" },
      { itemId: "minecraft:iron_ingot", amount: 12, label: "железные слитки" },
      { itemId: "minecraft:stone", amount: 24, label: "камень" },
      { itemId: "minecraft:anvil", amount: 1, label: "наковальня" }
    ],
    inputId: "minecraft:iron_ingot",
    inputLabel: "железный слиток",
    outputId: COIN_SILVER,
    outputAmount: 3,
    outputLabel: "серебряные монеты"
  },
  2: {
    tier: 2,
    name: "Чеканный двор II",
    blockId: MINT_BLOCK_T2,
    taxBonus: 6,
    minTypeIndex: 3,
    maxPerSettlement: 1,
    cost: [
      { itemId: "kingdoms:coin_silver", amount: 55, label: "серебряные монеты" },
      { itemId: "kingdoms:coin_gold", amount: 2, label: "золотые монеты" },
      { itemId: "minecraft:gold_ingot", amount: 8, label: "золотые слитки" },
      { itemId: "minecraft:stone_bricks", amount: 32, label: "каменные кирпичи" },
      { itemId: "minecraft:anvil", amount: 1, label: "наковальня" }
    ],
    inputId: "minecraft:gold_ingot",
    inputLabel: "золотой слиток",
    outputId: COIN_GOLD,
    outputAmount: 3,
    outputLabel: "золотые монеты"
  }
};

/** @type {object | undefined} */
let deps;

export function bindMintSystem(dependencies) {
  deps = dependencies;

  deps.world.afterEvents?.playerInteractWithBlock?.subscribe((event) => {
    const blockId = event.block?.typeId;
    if (blockId !== MINT_BLOCK_T1 && blockId !== MINT_BLOCK_T2) return;
    deps.system.run(() => {
      Promise.resolve(handleMintInteract(event.player, event.block)).catch((error) => {
        event.player?.sendMessage(`§c[Королевства] Ошибка чеканного двора: ${error?.message ?? error}`);
      });
    });
  });

  deps.world.afterEvents.playerPlaceBlock?.subscribe((event) => {
    if (event.block.typeId !== MINT_BLOCK_T1 && event.block.typeId !== MINT_BLOCK_T2) return;
    registerMintWorkshop(event.player, event.block);
  });

  deps.world.beforeEvents.playerBreakBlock?.subscribe((event) => {
    if (event.block.typeId !== MINT_BLOCK_T1 && event.block.typeId !== MINT_BLOCK_T2) return;
    handleMintBreak(event.player, event.block, event);
  });

  deps.system.runInterval(() => tickMintWorkshops(), 20);
  deps.system.runInterval(() => processPendingMintItemPayouts(), 40);
}

export function ensureMintWorkshops(data) {
  if (!Array.isArray(data.mintWorkshops)) data.mintWorkshops = [];
}

export function ensurePendingMintItems(data) {
  if (!Array.isArray(data.pendingPlayerItemPayouts)) data.pendingPlayerItemPayouts = [];
}

function getTierFromBlockId(blockId) {
  if (blockId === MINT_BLOCK_T1) return 1;
  if (blockId === MINT_BLOCK_T2) return 2;
  return undefined;
}

function blockLocationKey(location, dimensionId) {
  return `${dimensionId}:${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
}

export function findMintWorkshop(data, location, dimensionId) {
  ensureMintWorkshops(data);
  const key = blockLocationKey(location, dimensionId);
  return data.mintWorkshops.find((entry) => blockLocationKey(entry.location, entry.dimensionId) === key);
}

function countMintWorkshopsForSettlement(data, settlementId, tier) {
  ensureMintWorkshops(data);
  return data.mintWorkshops.filter((entry) => entry.settlementId === settlementId && entry.tier === tier).length;
}

export function getMintTaxBonus(data, settlement) {
  if (!settlement) return 0;
  ensureMintWorkshops(data);
  let total = 0;
  for (const entry of data.mintWorkshops) {
    if (entry.settlementId !== settlement.id) continue;
    const def = MINT_TIER_DEFS[entry.tier];
    if (def) total += def.taxBonus;
  }
  return total;
}

export function formatMintIncomeLine(data, settlement) {
  ensureMintWorkshops(data);
  const entries = data.mintWorkshops.filter((entry) => entry.settlementId === settlement.id);
  if (!entries.length) return "";
  const parts = entries.map((entry) => {
    const def = MINT_TIER_DEFS[entry.tier];
    return def ? `${def.name} (+${def.taxBonus})` : undefined;
  }).filter(Boolean);
  return parts.length ? parts.join(", ") : "";
}

function nextMintWorkshopId(data) {
  if (typeof data.nextMintWorkshopIdValue !== "number") data.nextMintWorkshopIdValue = 1;
  const id = data.nextMintWorkshopIdValue;
  data.nextMintWorkshopIdValue = id + 1;
  return id;
}

function registerMintWorkshop(player, block) {
  const tier = getTierFromBlockId(block.typeId);
  const def = tier ? MINT_TIER_DEFS[tier] : undefined;
  if (!def || !player?.isValid) return;

  const data = deps.loadData();
  ensureMintWorkshops(data);
  const dimensionId = deps.getDimensionId(block.dimension);
  const location = deps.blockPosition(block.location);
  if (findMintWorkshop(data, location, dimensionId)) return;

  const playerName = deps.getPlayerName(player);
  const settlement = deps.getPlayerSettlement(data, playerName);
  if (!settlement) {
    deps.setBlockToAir(block);
    queueMintItemPayout(data, playerName, def.blockId, 1);
    player.sendMessage("§cЧеканный двор можно ставить только на территории своего поселения.");
    deps.saveData(data);
    return;
  }

  const territory = deps.findSettlementAtLocation(data, block.location, dimensionId);
  if (!territory || territory.id !== settlement.id || !deps.hasTerritoryAccess(data, territory, playerName)) {
    deps.setBlockToAir(block);
    queueMintItemPayout(data, playerName, def.blockId, 1);
    player.sendMessage("§cЧеканный двор можно ставить только на своей территории.");
    deps.saveData(data);
    return;
  }

  if (countMintWorkshopsForSettlement(data, settlement.id, tier) >= def.maxPerSettlement) {
    deps.setBlockToAir(block);
    queueMintItemPayout(data, playerName, def.blockId, 1);
    player.sendMessage(`§cВ поселении уже есть ${def.name}.`);
    deps.saveData(data);
    return;
  }

  data.mintWorkshops.push({
    id: nextMintWorkshopId(data),
    settlementId: settlement.id,
    tier,
    dimensionId,
    location,
    state: "idle",
    finishTick: 0,
    placedBy: playerName
  });
  deps.saveData(data);
  player.sendMessage(`§a${def.name} установлен. Кликните по блоку, чтобы чеканить монеты. (+${def.taxBonus} к налогу)`);
}

function handleMintBreak(player, block, event) {
  const data = deps.loadData();
  const record = findMintWorkshop(data, block.location, deps.getDimensionId(block.dimension));
  if (!record) return;

  const settlement = deps.getSettlement(data, record.settlementId);
  const playerName = deps.getPlayerName(player);
  if (!settlement || !deps.hasTerritoryAccess(data, settlement, playerName)) {
    event.cancel = true;
    player.sendMessage("§cСломать чеканный двор могут жители этого поселения.");
    return;
  }

  if (record.state === "processing") {
    event.cancel = true;
    player.sendMessage("§cНельзя сломать чеканный двор во время плавки. Сначала заберите результат или дождитесь окончания.");
    return;
  }

  const def = MINT_TIER_DEFS[record.tier];
  data.mintWorkshops = data.mintWorkshops.filter((entry) => entry.id !== record.id);
  deps.saveData(data);
  if (def) tryGiveMintItem(player, def.blockId, 1);
  player.sendMessage(`§e${def?.name ?? "Чеканный двор"} снят.`);
}

function tickMintWorkshops() {
  if (!deps?.loadData || !deps?.saveData) return;

  const data = deps.loadData();
  ensureMintWorkshops(data);
  const now = deps.system.currentTick;
  let changed = false;

  for (const record of data.mintWorkshops) {
    if (record.state !== "processing" || !record.finishTick) continue;
    if (now < record.finishTick) continue;
    record.state = "ready";
    changed = true;
  }

  if (changed) deps.saveData(data);
}

function queueMintItemPayout(data, playerName, itemTypeId, amount) {
  ensurePendingMintItems(data);
  data.pendingPlayerItemPayouts.push({
    playerName,
    itemTypeId,
    itemAmount: amount,
    createdTick: deps.system.currentTick
  });
}

function canFitItem(player, typeId, amount = 1) {
  const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
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

function tryGiveMintItem(player, typeId, amount = 1) {
  if (!canFitItem(player, typeId, amount)) return false;
  const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
  const leftover = inventory?.addItem(new ItemStack(typeId, amount));
  if (leftover) {
    player.dimension.spawnItem(leftover, player.location);
  }
  return true;
}

export function processPendingMintItemPayouts() {
  if (!deps?.loadData || !deps?.saveData || !deps?.world) return;

  const data = deps.loadData();
  ensurePendingMintItems(data);
  if (!data.pendingPlayerItemPayouts.length) return;

  let changed = false;
  const remaining = [];

  for (const payout of data.pendingPlayerItemPayouts) {
    if (!payout.itemTypeId) {
      remaining.push(payout);
      continue;
    }
    const player = deps.world.getPlayers().find((online) => deps.samePlayerName(deps.getPlayerName(online), payout.playerName));
    if (!player) {
      remaining.push(payout);
      continue;
    }
    if (tryGiveMintItem(player, payout.itemTypeId, payout.itemAmount ?? 1)) {
      player.sendMessage(`§aПолучен предмет: ${payout.itemTypeId.replace("kingdoms:", "")}.`);
      changed = true;
    } else {
      remaining.push(payout);
    }
  }

  data.pendingPlayerItemPayouts = remaining;
  if (changed) deps.saveData(data);
}

function formatInventoryIngots(player, inputId) {
  const amount = countItem(player, inputId);
  return amount > 0 ? `${amount} шт.` : "нет";
}

function formatMintFurnaceBody(def, record, player) {
  const now = deps.system.currentTick;
  let inputLine = "§7[ пусто ]";
  let outputLine = "§7[ пусто ]";
  let statusLine = "§aОжидание слитка";

  if (record.state === "processing") {
    inputLine = `§f[ ${def.inputLabel} ]`;
    outputLine = `§e[ ${def.outputAmount} ${def.outputLabel} ]`;
    const remaining = Math.max(0, record.finishTick - now);
    statusLine = `§6Плавка: ${formatCooldownTicks(remaining)}`;
  } else if (record.state === "ready") {
    inputLine = "§7[ использовано ]";
    outputLine = `§a[ ${def.outputAmount} ${def.outputLabel} ]`;
    statusLine = "§aГотово — заберите монеты";
  }

  const inventoryLine = formatInventoryIngots(player, def.inputId);
  return [
    `§6${def.name}§r`,
    "",
    "       §8╔════════════╗",
    `       §8║§r ${inputLine} §8║`,
    "       §8║     ↓      ║",
    `       §8║§r ${outputLine} §8║",
    "       §8╚════════════╝",
    "",
    `§7Статус:§r ${statusLine}`,
    `§7Рецепт:§r 1 ${def.inputLabel} → ${def.outputAmount} ${def.outputLabel} (10 мин.)`,
    "",
    "§e─── Ваш инвентарь ───",
    `§f${def.inputLabel}: §e${inventoryLine}`
  ].join("\n");
}

async function handleMintInteract(player, block) {
  if (!player?.isValid || !block) return;

  const data = deps.loadData();
  let record = findMintWorkshop(data, block.location, deps.getDimensionId(block.dimension));
  if (!record) {
    registerMintWorkshop(player, block);
    data = deps.loadData();
    record = findMintWorkshop(data, block.location, deps.getDimensionId(block.dimension));
  }
  if (!record) {
    player.sendMessage("§cНе удалось открыть чеканный двор.");
    return;
  }

  const settlement = deps.getSettlement(data, record.settlementId);
  const playerName = deps.getPlayerName(player);
  if (!settlement || !deps.hasTerritoryAccess(data, settlement, playerName)) {
    player.sendMessage("§cЭтим чеканным двором могут пользоваться жители поселения.");
    return;
  }

  const def = MINT_TIER_DEFS[record.tier];
  if (!def) return;

  tickMintWorkshops();
  const fresh = deps.loadData();
  record = findMintWorkshop(fresh, block.location, deps.getDimensionId(block.dimension));
  if (!record) return;

  const form = new deps.ActionFormData()
    .title(deps.kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.MINT))
    .body(formatMintFurnaceBody(def, record, player));

  if (record.state === "idle") {
    form.button(`Положить ${def.inputLabel}`, "textures/ui/kingdoms/icon_tax");
  }
  if (record.state === "ready") {
    form.button(`Забрать ${def.outputAmount} ${def.outputLabel}`, "textures/ui/kingdoms/icon_tax");
  }
  form.button("Обновить", "textures/ui/kingdoms/icon_info");
  form.button("Закрыть", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showFormDeferred(player, form);
  if (response.canceled) return;

  let buttonIndex = 0;
  if (record.state === "idle") {
    if (response.selection === buttonIndex) {
      return startMintSmelt(player, block, record, def);
    }
    buttonIndex += 1;
  }
  if (record.state === "ready") {
    if (response.selection === buttonIndex) {
      return collectMintOutput(player, block, record, def);
    }
    buttonIndex += 1;
  }
  if (response.selection === buttonIndex) {
    return handleMintInteract(player, block);
  }
}

function startMintSmelt(player, block, record, def) {
  if (record.state !== "idle") {
    player.sendMessage("§cСейчас нельзя загрузить слиток.");
    return handleMintInteract(player, block);
  }
  if (!takeItem(player, def.inputId, 1)) {
    player.sendMessage(`§cНужен 1 ${def.inputLabel}.`);
    return handleMintInteract(player, block);
  }

  const data = deps.loadData();
  const fresh = findMintWorkshop(data, block.location, deps.getDimensionId(block.dimension));
  if (!fresh || fresh.id !== record.id) {
    deps.giveItemStack(player, new ItemStack(def.inputId, 1));
    return;
  }

  fresh.state = "processing";
  fresh.finishTick = deps.system.currentTick + MINT_SMELT_TICKS;
  deps.saveData(data);
  player.sendMessage(`§aПлавка начата. Через 10 минут получите ${def.outputAmount} ${def.outputLabel}.`);
  return handleMintInteract(player, block);
}

function collectMintOutput(player, block, record, def) {
  if (record.state !== "ready") {
    player.sendMessage("§cВыход ещё не готов.");
    return handleMintInteract(player, block);
  }
  if (!canFitItem(player, def.outputId, def.outputAmount)) {
    player.sendMessage("§cОсвободите место в инвентаре, чтобы забрать монеты.");
    return handleMintInteract(player, block);
  }

  const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
  const leftover = inventory?.addItem(new ItemStack(def.outputId, def.outputAmount));
  if (leftover) {
    player.sendMessage("§cОсвободите место в инвентаре, чтобы забрать монеты.");
    return handleMintInteract(player, block);
  }

  const data = deps.loadData();
  const fresh = findMintWorkshop(data, block.location, deps.getDimensionId(block.dimension));
  if (!fresh || fresh.id !== record.id) return;

  fresh.state = "idle";
  fresh.finishTick = 0;
  deps.saveData(data);
  player.sendMessage(`§aПолучено: ${def.outputAmount} ${def.outputLabel}.`);
  return handleMintInteract(player, block);
}

export async function openMintShopMenu(player, settlementId, sessionToken) {
  if (!deps.assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  const playerName = deps.getPlayerName(player);
  if (!settlement || !deps.canAccessConstruction(data, playerName, settlement)) {
    player.sendMessage("§cЧеканный двор покупают создатель, Ремесленник, Рыцарь, Дворянин и Советник.");
    return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
  }

  const lines = [
    "§6Чеканный двор§r",
    "Дополнительный заработок для поселения.",
    "Поставьте блок на своей территории и",
    "переплавляйте слитки в монеты.",
    "",
    "§eЧеканный двор I§r — железо → 3 серебряные (10 мин.), +3 к налогу",
    "§eЧеканный двор II§r — золото → 3 золотые (10 мин.), +6 к налогу"
  ];

  const form = new deps.ActionFormData()
    .title(deps.kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.MINT))
    .body(lines.join("\n"))
    .button("Купить двор I", "textures/ui/kingdoms/icon_tax")
    .button("Купить двор II", "textures/ui/kingdoms/icon_tax")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showFormDeferred(player, form);
  if (response.canceled || response.selection === 2) {
    return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
  }

  const tier = response.selection === 0 ? 1 : 2;
  return purchaseMintWorkshop(player, settlementId, sessionToken, tier);
}

async function purchaseMintWorkshop(player, settlementId, sessionToken, tier) {
  const def = MINT_TIER_DEFS[tier];
  if (!def) return openMintShopMenu(player, settlementId, sessionToken);

  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement) return;

  if (settlement.typeIndex < def.minTypeIndex) {
    player.sendMessage(`§c${def.name} доступен с типа «${SETTLEMENT_TYPE_NAMES[def.minTypeIndex]}».`);
    return openMintShopMenu(player, settlementId, sessionToken);
  }

  if (countMintWorkshopsForSettlement(data, settlement.id, tier) >= def.maxPerSettlement) {
    player.sendMessage(`§cУ вас уже есть установленный ${def.name} или он ожидает установки.`);
    return openMintShopMenu(player, settlementId, sessionToken);
  }
  if (countItem(player, def.blockId) > 0) {
    player.sendMessage(`§cУ вас уже есть ${def.name} в инвентаре. Сначала установите его.`);
    return openMintShopMenu(player, settlementId, sessionToken);
  }

  if (reportCostShortage(player, def.cost) || !takeMixedCost(player, def.cost)) {
    player.sendMessage("§cНе хватает ресурсов для покупки.");
    return openMintShopMenu(player, settlementId, sessionToken);
  }

  const playerName = deps.getPlayerName(player);
  if (tryGiveMintItem(player, def.blockId, 1)) {
    player.sendMessage(`§a${def.name} куплен. Поставьте блок на территории поселения.`);
  } else {
    queueMintItemPayout(data, playerName, def.blockId, 1);
    deps.saveData(data);
    player.sendMessage("§eЧеканный двор оплачен. Освободите инвентарь — предмет будет выдан автоматически.");
    return openMintShopMenu(player, settlementId, sessionToken);
  }

  deps.saveData(data);
  return openMintShopMenu(player, settlementId, sessionToken);
}

export function migrateMintWorkshopRecords(data) {
  ensureMintWorkshops(data);
  ensurePendingMintItems(data);
  if (typeof data.nextMintWorkshopIdValue !== "number") {
    data.nextMintWorkshopIdValue = data.mintWorkshops.reduce((max, entry) => Math.max(max, entry.id || 0), 0) + 1;
  }
}
