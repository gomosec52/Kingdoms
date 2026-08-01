import { ItemStack } from "@minecraft/server";
import { formatCopperValue, giveCopperValue, takeCopperValue, countCopperValue, COPPER_PER_SILVER, COPPER_PER_GOLD } from "./economy.js";
import { canAccessTrade, canWithdrawTradeCoins } from "./permissions.js";
import {
  formatItemButtonLabel,
  getItemDisplayNameRu,
  isTradeBlockedItem
} from "./item_names.js";
import { getModalTextFieldValues } from "./ui.js";

/** @type {object | undefined} */
let deps;

export function bindTradeSystem(dependencies) {
  deps = dependencies;
}

export function ensureSettlementTradeData(settlement) {
  if (!settlement.trade) {
    settlement.trade = {
      balanceCopper: 0,
      totalTurnoverCopper: 0,
      todayTurnoverCopper: 0,
      todayDay: deps.getCurrentDay(),
      partners: {},
      traderStats: {},
      inbox: [],
      outbox: [],
      pendingPayouts: []
    };
  }
  if (!Array.isArray(settlement.trade.inbox)) settlement.trade.inbox = [];
  if (!Array.isArray(settlement.trade.outbox)) settlement.trade.outbox = [];
  if (!Array.isArray(settlement.trade.pendingPayouts)) settlement.trade.pendingPayouts = [];
  if (!settlement.trade.partners || typeof settlement.trade.partners !== "object") settlement.trade.partners = {};
  if (!settlement.trade.traderStats || typeof settlement.trade.traderStats !== "object") settlement.trade.traderStats = {};
}

function ensureWorldPayouts(data) {
  if (!Array.isArray(data.pendingPlayerPayouts)) data.pendingPlayerPayouts = [];
}

function rollTradeDay(settlement) {
  ensureSettlementTradeData(settlement);
  const day = deps.getCurrentDay();
  if (settlement.trade.todayDay !== day) {
    settlement.trade.todayDay = day;
    settlement.trade.todayTurnoverCopper = 0;
  }
}

export function formatTradeInfo(data, settlement) {
  ensureSettlementTradeData(settlement);
  rollTradeDay(settlement);
  const partnerLines = Object.entries(settlement.trade.partners)
    .map(([settlementId, amount]) => {
      const partner = deps.getSettlement(data, Number(settlementId));
      if (!partner) return undefined;
      return `${partner.name}: ${formatCopperValue(amount)}`;
    })
    .filter(Boolean);
  const traderLines = Object.entries(settlement.trade.traderStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, amount]) => `${name}: ${formatCopperValue(amount)}`);
  return [
    `Сейчас монет: ${formatCopperValue(settlement.trade.balanceCopper)}`,
    `Оборот за всё время: ${formatCopperValue(settlement.trade.totalTurnoverCopper)}`,
    `Выручка сегодня: ${formatCopperValue(settlement.trade.todayTurnoverCopper)}`,
    `Исходящих предложений: ${settlement.trade.outbox.length}`,
    "",
    "Торгуем с:",
    partnerLines.length ? partnerLines.join("\n") : "пока никем",
    "",
    "Торговцы поселения:",
    traderLines.length ? traderLines.join("\n") : "пока нет данных"
  ].join("\n");
}

function nextTradeOfferId(data) {
  if (typeof data.nextTradeOfferIdValue !== "number") data.nextTradeOfferIdValue = 1;
  const id = data.nextTradeOfferIdValue;
  data.nextTradeOfferIdValue = id + 1;
  return id;
}

function getInventoryItems(player) {
  const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
  if (!inventory) return [];
  const totals = new Map();
  for (let slot = 0; slot < inventory.size; slot += 1) {
    const item = inventory.getItem(slot);
    if (!item) continue;
    if (isTradeBlockedItem(item.typeId)) continue;
    const existing = totals.get(item.typeId) || { typeId: item.typeId, amount: 0, name: getItemDisplayNameRu(item.typeId) };
    existing.amount += item.amount;
    totals.set(item.typeId, existing);
  }
  return [...totals.values()];
}

function takeItemFromInventory(player, typeId, amount) {
  const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
  if (!inventory) return false;
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

function canFitItem(player, typeId, amount) {
  const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
  if (!inventory) return false;
  let free = 0;
  let partial = 0;
  for (let slot = 0; slot < inventory.size; slot += 1) {
    const item = inventory.getItem(slot);
    if (!item) free += 64;
    else if (item.typeId === typeId) partial += 64 - item.amount;
  }
  return free + partial >= amount;
}

function giveStoredItem(player, typeId, amount) {
  if (!canFitItem(player, typeId, amount)) return false;
  let remaining = amount;
  while (remaining > 0) {
    const stackAmount = Math.min(64, remaining);
    const stack = new ItemStack(typeId, stackAmount);
    const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
    const leftover = inventory?.addItem(stack);
    if (leftover) player.dimension.spawnItem(leftover, player.location);
    remaining -= stackAmount;
  }
  return true;
}

function recordTradeStats(settlement, partnerSettlementId, traderName, copperAmount) {
  ensureSettlementTradeData(settlement);
  rollTradeDay(settlement);
  settlement.trade.totalTurnoverCopper += copperAmount;
  settlement.trade.todayTurnoverCopper += copperAmount;
  settlement.trade.balanceCopper += copperAmount;
  const partnerKey = String(partnerSettlementId);
  settlement.trade.partners[partnerKey] = (settlement.trade.partners[partnerKey] || 0) + copperAmount;
  settlement.trade.traderStats[traderName] = (settlement.trade.traderStats[traderName] || 0) + copperAmount;
}

function queueSettlementPayout(settlement, playerName, copperAmount) {
  ensureSettlementTradeData(settlement);
  settlement.trade.pendingPayouts.push({ playerName, copperAmount, createdTick: deps.system.currentTick });
}

function queuePlayerPayout(data, playerName, copperAmount) {
  ensureWorldPayouts(data);
  data.pendingPlayerPayouts.push({ playerName, copperAmount, createdTick: deps.system.currentTick });
}

function estimateCoinStacks(copperAmount) {
  let remaining = Math.max(0, Math.floor(copperAmount));
  const gold = Math.floor(remaining / (COPPER_PER_SILVER * COPPER_PER_SILVER));
  remaining -= gold * COPPER_PER_SILVER * COPPER_PER_SILVER;
  const silver = Math.floor(remaining / COPPER_PER_SILVER);
  remaining -= silver * COPPER_PER_SILVER;
  return gold + silver + (remaining > 0 ? 1 : 0);
}

function canFitCoins(player, copperAmount) {
  if (copperAmount <= 0) return true;
  const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
  if (!inventory) return false;
  let freeSlots = 0;
  for (let slot = 0; slot < inventory.size; slot += 1) {
    if (!inventory.getItem(slot)) freeSlots += 1;
  }
  return freeSlots >= estimateCoinStacks(copperAmount);
}

function tryGiveCoins(player, copperAmount) {
  if (!canFitCoins(player, copperAmount)) return false;
  giveCopperValue(player, copperAmount);
  return true;
}

export function processPendingTradePayouts() {
  const data = deps.loadData();
  let changed = false;
  ensureWorldPayouts(data);

  for (const settlement of data.settlements) {
    ensureSettlementTradeData(settlement);
    const remaining = [];
    for (const payout of settlement.trade.pendingPayouts) {
      const player = deps.world.getPlayers().find((online) => deps.samePlayerName(deps.getPlayerName(online), payout.playerName));
      if (!player) {
        remaining.push(payout);
        continue;
      }
      if (tryGiveCoins(player, payout.copperAmount)) {
        player.sendMessage(`§aПолучены монеты от торговли: ${formatCopperValue(payout.copperAmount)}.`);
        changed = true;
      } else {
        player.sendMessage("§cОсвободите место в инвентаре, чтобы получить монеты от торговли.");
        remaining.push(payout);
      }
    }
    settlement.trade.pendingPayouts = remaining;
  }

  const playerRemaining = [];
  for (const payout of data.pendingPlayerPayouts) {
    const player = deps.world.getPlayers().find((online) => deps.samePlayerName(deps.getPlayerName(online), payout.playerName));
    if (!player) {
      playerRemaining.push(payout);
      continue;
    }
    if (tryGiveCoins(player, payout.copperAmount)) {
      player.sendMessage(`§aПолучены монеты от торговли: ${formatCopperValue(payout.copperAmount)}.`);
      changed = true;
    } else {
      player.sendMessage("§cОсвободите место в инвентаре, чтобы получить монеты от торговли.");
      playerRemaining.push(payout);
    }
  }
  data.pendingPlayerPayouts = playerRemaining;

  if (changed) deps.saveData(data);
}

function removeOfferFromWorld(data, offerId) {
  for (const settlement of data.settlements) {
    ensureSettlementTradeData(settlement);
    settlement.trade.inbox = settlement.trade.inbox.filter((entry) => entry.id !== offerId);
    settlement.trade.outbox = settlement.trade.outbox.filter((entry) => entry.id !== offerId);
  }
}

function findOfferById(data, offerId) {
  for (const settlement of data.settlements) {
    ensureSettlementTradeData(settlement);
    const inboxOffer = settlement.trade.inbox.find((entry) => entry.id === offerId);
    if (inboxOffer) return inboxOffer;
    const outboxOffer = settlement.trade.outbox.find((entry) => entry.id === offerId);
    if (outboxOffer) return outboxOffer;
  }
  return undefined;
}

function parseCoinPrice(formValues) {
  const strings = getModalTextFieldValues(formValues);
  const copper = parseCoinField(strings[0]);
  const silver = parseCoinField(strings[1]);
  const gold = parseCoinField(strings[2]);
  if (copper === null || silver === null || gold === null) return Number.NaN;
  return copper + silver * COPPER_PER_SILVER + gold * COPPER_PER_GOLD;
}

function parseCoinField(value) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export async function openTradeHub(player, settlementId, sessionToken) {
  if (!deps.assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  if (!settlement) return;
  if (!canAccessTrade(data, deps.getPlayerName(player), settlement)) {
    player.sendMessage("§cМеню торговли доступно создателю, Купцу, Рыцарю, Дворянину и Советнику.");
    return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
  }

  const body = formatTradeInfo(data, settlement);
  const form = new deps.ActionFormData()
    .title(deps.kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.TRADE))
    .body(body)
    .button("Торговля", "textures/ui/icon_best3")
    .button("Почта", "textures/ui/icon_map")
    .button("Исходящие", "textures/ui/icon_import")
    .button("Монеты", "textures/ui/kingdoms/icon_tax")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showFormDeferred(player, form);
  if (response.canceled) return;
  if (response.selection === 0) return openCreateTradeOffer(player, settlementId, sessionToken);
  if (response.selection === 1) return openTradeInbox(player, settlementId, sessionToken);
  if (response.selection === 2) return openTradeOutbox(player, settlementId, sessionToken);
  if (response.selection === 3) return openTradeWithdraw(player, settlementId, sessionToken);
  return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
}

async function openTradeOutbox(player, settlementId, sessionToken) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  ensureSettlementTradeData(settlement);
  if (!settlement.trade.outbox.length) {
    player.sendMessage("§7Исходящих предложений нет.");
    return openTradeHub(player, settlementId, sessionToken);
  }

  const pick = await deps.pickFromActionList(player, "Исходящие", "Выберите предложение для отмены:", settlement.trade.outbox, {
    getLabel: (offer) => {
      const target = deps.getSettlement(data, offer.toSettlementId);
      const itemName = getItemDisplayNameRu(offer.itemTypeId);
      return formatItemButtonLabel(`${target?.name ?? "?"}: ${offer.itemAmount} × ${itemName}`, 24);
    },
    menuPage: deps.KINGDOMS_MENU_PAGE.TRADE_SELL,
    noIcon: true
  });
  if (pick.canceled) {
    if (pick.back) return openTradeHub(player, settlementId, sessionToken);
    return;
  }

  const offer = pick.item;
  const confirm = await deps.showFormDeferred(player, new deps.ActionFormData()
    .title(deps.kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.TRADE_SELL))
    .body(`Отменить предложение: ${offer.itemAmount} × ${getItemDisplayNameRu(offer.itemTypeId)}?`)
    .button("Отменить", "textures/ui/check")
    .button("Назад", "textures/ui/cancel"));
  if (confirm.canceled || confirm.selection !== 0) return openTradeOutbox(player, settlementId, sessionToken);

  removeOfferFromWorld(data, offer.id);
  if (!giveStoredItem(player, offer.itemTypeId, offer.itemAmount)) {
    settlement.trade.pendingItemReturns = settlement.trade.pendingItemReturns || [];
    settlement.trade.pendingItemReturns.push({
      playerName: deps.getPlayerName(player),
      itemTypeId: offer.itemTypeId,
      itemAmount: offer.itemAmount
    });
    player.sendMessage("§eПредложение отменено. Освободите инвентарь, чтобы забрать предметы.");
  } else {
    player.sendMessage(`§aПредложение отменено. Возвращено: ${offer.itemAmount} × ${getItemDisplayNameRu(offer.itemTypeId)}.`);
  }
  deps.saveData(data);
  return openTradeOutbox(player, settlementId, sessionToken);
}

async function openCreateTradeOffer(player, settlementId, sessionToken) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  const items = getInventoryItems(player).filter((entry) => entry.amount > 0);
  if (!items.length) {
    player.sendMessage("§cНет предметов для продажи. Монеты нельзя выставлять на торговлю.");
    return openTradeHub(player, settlementId, sessionToken);
  }

  const itemPick = await deps.pickFromActionList(player, "Торговля", "Выберите предмет:", items, {
    getLabel: (entry) => formatItemButtonLabel(`${entry.name} (${entry.amount})`),
    menuPage: deps.KINGDOMS_MENU_PAGE.TRADE_SELL,
    noIcon: true
  });
  if (itemPick.canceled) {
    if (itemPick.back) return openTradeHub(player, settlementId, sessionToken);
    return;
  }
  const selectedItem = itemPick.item;
  const maxQty = selectedItem.amount;

  const qtyResponse = await deps.showFormDeferred(player, new deps.ModalFormData()
    .title(deps.kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.TRADE_SELL))
    .slider(`Количество (макс. ${maxQty})`, 1, maxQty, {
      valueStep: 1,
      defaultValue: 1
    }));
  if (qtyResponse.canceled) return openCreateTradeOffer(player, settlementId, sessionToken);
  const quantity = Math.max(1, Math.min(maxQty, Math.round(Number(qtyResponse.formValues?.[0] ?? 1))));

  const priceResponse = await deps.showFormDeferred(player, new deps.ModalFormData()
    .title(deps.kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.TRADE_SELL))
    .label(`Цена за 1 шт. (${selectedItem.name})`)
    .textField("Медные монеты", "0", { defaultValue: "0" })
    .textField("Серебряные монеты", "0", { defaultValue: "0" })
    .textField("Золотые монеты", "0", { defaultValue: "0" }));
  if (priceResponse.canceled) return openCreateTradeOffer(player, settlementId, sessionToken);
  const pricePerUnit = parseCoinPrice(priceResponse.formValues);
  if (!Number.isFinite(pricePerUnit) || pricePerUnit < 1) {
    player.sendMessage("§cУкажите цену хотя бы в 1 медной монете (только числа).");
    return openCreateTradeOffer(player, settlementId, sessionToken);
  }
  const totalCopper = pricePerUnit * quantity;

  const targets = data.settlements.filter((candidate) => candidate.id !== settlement.id);
  if (!targets.length) {
    player.sendMessage("§cНет других поселений для торговли.");
    return openTradeHub(player, settlementId, sessionToken);
  }

  const targetPick = await deps.pickFromActionList(player, "Покупатель", "Кому отправить предложение?", targets, {
    getLabel: (candidate) => `${candidate.name} (${candidate.creatorName})`,
    icon: "textures/ui/kingdoms/icon_alliance",
    menuPage: deps.KINGDOMS_MENU_PAGE.TRADE_SELL
  });
  if (targetPick.canceled) {
    if (targetPick.back) return openCreateTradeOffer(player, settlementId, sessionToken);
    return;
  }

  if (!takeItemFromInventory(player, selectedItem.typeId, quantity)) {
    player.sendMessage("§cНе удалось списать предмет из инвентаря.");
    return openTradeHub(player, settlementId, sessionToken);
  }

  const target = targetPick.item;
  ensureSettlementTradeData(target);
  ensureSettlementTradeData(settlement);
  const offer = {
    id: nextTradeOfferId(data),
    fromSettlementId: settlement.id,
    toSettlementId: target.id,
    fromPlayerName: deps.getPlayerName(player),
    itemTypeId: selectedItem.typeId,
    itemAmount: quantity,
    pricePerUnit,
    totalCopper,
    createdTick: deps.system.currentTick
  };
  target.trade.inbox.push(offer);
  settlement.trade.outbox.push({ ...offer });
  deps.saveData(data);
  player.sendMessage(`§aТорговое предложение отправлено в ${target.name}: ${quantity} x ${selectedItem.name} за ${formatCopperValue(totalCopper)}.`);
  deps.world.sendMessage(`§6[Торговля] §f${settlement.name} предложило сделку поселению ${target.name}.`);
  return openTradeHub(player, settlementId, sessionToken);
}

async function openTradeInbox(player, settlementId, sessionToken) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  ensureSettlementTradeData(settlement);
  if (!settlement.trade.inbox.length) {
    player.sendMessage("§7Входящих торговых предложений нет.");
    return openTradeHub(player, settlementId, sessionToken);
  }

  const pick = await deps.pickFromActionList(player, "Почта", "Выберите предложение:", settlement.trade.inbox, {
    getLabel: (offer) => {
      const from = deps.getSettlement(data, offer.fromSettlementId);
      const itemName = getItemDisplayNameRu(offer.itemTypeId);
      const label = `${from?.name ?? "?"}: ${offer.itemAmount} × ${itemName} за ${formatCopperValue(offer.totalCopper)}`;
      return formatItemButtonLabel(label, 24);
    },
    menuPage: deps.KINGDOMS_MENU_PAGE.TRADE_MAIL,
    noIcon: true
  });
  if (pick.canceled) {
    if (pick.back) return openTradeHub(player, settlementId, sessionToken);
    return;
  }

  const offer = pick.item;
  const accept = await deps.showFormDeferred(player, new deps.ActionFormData()
    .title(deps.kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.TRADE_MAIL))
    .body(`Купить ${offer.itemAmount} × ${getItemDisplayNameRu(offer.itemTypeId)} за ${formatCopperValue(offer.totalCopper)}?`)
    .button("Да", "textures/ui/check")
    .button("Нет", "textures/ui/cancel"));
  if (accept.canceled || accept.selection !== 0) return openTradeInbox(player, settlementId, sessionToken);

  if (!canFitItem(player, offer.itemTypeId, offer.itemAmount)) {
    player.sendMessage("§cОсвободите инвентарь, чтобы принять предложение.");
    return openTradeInbox(player, settlementId, sessionToken);
  }
  if (!takeCopperValue(player, offer.totalCopper)) {
    player.sendMessage(`§cНе хватает монет. Нужно ${formatCopperValue(offer.totalCopper)}.`);
    return openTradeInbox(player, settlementId, sessionToken);
  }

  if (!giveStoredItem(player, offer.itemTypeId, offer.itemAmount)) {
    giveCopperValue(player, offer.totalCopper);
    player.sendMessage("§cОсвободите инвентарь, чтобы принять предложение.");
    return openTradeInbox(player, settlementId, sessionToken);
  }

  removeOfferFromWorld(data, offer.id);

  const senderSettlement = deps.getSettlement(data, offer.fromSettlementId);
  const senderOnline = deps.world.getPlayers().find((online) => deps.samePlayerName(deps.getPlayerName(online), offer.fromPlayerName));

  if (senderSettlement) {
    recordTradeStats(senderSettlement, settlement.id, offer.fromPlayerName, offer.totalCopper);
    if (senderOnline) {
      senderOnline.sendMessage(`§aСделка принята! На торговом счёте ${senderSettlement.name}: +${formatCopperValue(offer.totalCopper)}.`);
    }
  } else if (senderOnline) {
    if (tryGiveCoins(senderOnline, offer.totalCopper)) {
      senderOnline.sendMessage(`§aСделка принята! Получено: ${formatCopperValue(offer.totalCopper)}.`);
    } else {
      queuePlayerPayout(data, offer.fromPlayerName, offer.totalCopper);
      senderOnline.sendMessage("§cОсвободите место в инвентаре, чтобы получить монеты от торговли.");
    }
  } else {
    queuePlayerPayout(data, offer.fromPlayerName, offer.totalCopper);
  }

  deps.saveData(data);
  player.sendMessage(`§aСделка принята: ${offer.itemAmount} × ${getItemDisplayNameRu(offer.itemTypeId)}.`);
  return openTradeInbox(player, settlementId, sessionToken);
}

async function openTradeWithdraw(player, settlementId, sessionToken) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  ensureSettlementTradeData(settlement);
  const playerName = deps.getPlayerName(player);
  if (!canWithdrawTradeCoins(data, playerName, settlement)) {
    player.sendMessage("§cЗабрать монеты могут создатель, Дворянин и Советник.");
    return openTradeHub(player, settlementId, sessionToken);
  }
  if (settlement.trade.balanceCopper <= 0) {
    player.sendMessage("§7На счету торговли пока нет монет.");
    return openTradeHub(player, settlementId, sessionToken);
  }

  const amount = settlement.trade.balanceCopper;
  const response = await deps.showFormDeferred(player, new deps.ActionFormData()
    .title(deps.kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.TRADE_COINS))
    .body(`Вы желаете забрать монеты (${formatCopperValue(amount)})?`)
    .button("Да", "textures/ui/check")
    .button("Нет", "textures/ui/cancel"));
  if (response.canceled || response.selection !== 0) return openTradeHub(player, settlementId, sessionToken);

  if (!tryGiveCoins(player, amount)) {
    player.sendMessage("§cОсвободите инвентарь, чтобы забрать монеты.");
    return openTradeHub(player, settlementId, sessionToken);
  }

  settlement.trade.balanceCopper = 0;
  deps.saveData(data);
  player.sendMessage(`§aЗабрано с торгового счёта: ${formatCopperValue(amount)}.`);
  return openTradeHub(player, settlementId, sessionToken);
}

export function processPendingTradeItemReturns() {
  const data = deps.loadData();
  let changed = false;
  for (const settlement of data.settlements) {
    ensureSettlementTradeData(settlement);
    if (!Array.isArray(settlement.trade.pendingItemReturns) || !settlement.trade.pendingItemReturns.length) continue;
    const remaining = [];
    for (const entry of settlement.trade.pendingItemReturns) {
      const player = deps.world.getPlayers().find((online) => deps.samePlayerName(deps.getPlayerName(online), entry.playerName));
      if (!player) {
        remaining.push(entry);
        continue;
      }
      if (giveStoredItem(player, entry.itemTypeId, entry.itemAmount)) {
        player.sendMessage(`§aВозвращены предметы: ${entry.itemAmount} × ${getItemDisplayNameRu(entry.itemTypeId)}.`);
        changed = true;
      } else {
        player.sendMessage("§cОсвободите инвентарь, чтобы получить возвращённые предметы.");
        remaining.push(entry);
      }
    }
    settlement.trade.pendingItemReturns = remaining;
  }
  if (changed) deps.saveData(data);
}
