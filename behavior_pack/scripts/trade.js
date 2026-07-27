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
      pendingPayouts: []
    };
  }
  if (!Array.isArray(settlement.trade.inbox)) settlement.trade.inbox = [];
  if (!Array.isArray(settlement.trade.pendingPayouts)) settlement.trade.pendingPayouts = [];
  if (!settlement.trade.partners || typeof settlement.trade.partners !== "object") settlement.trade.partners = {};
  if (!settlement.trade.traderStats || typeof settlement.trade.traderStats !== "object") settlement.trade.traderStats = {};
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
  const items = [];
  for (let slot = 0; slot < inventory.size; slot += 1) {
    const item = inventory.getItem(slot);
    if (!item) continue;
    if (isTradeBlockedItem(item.typeId)) continue;
    items.push({
      slot,
      typeId: item.typeId,
      amount: item.amount,
      name: getItemDisplayNameRu(item.typeId)
    });
  }
  return items;
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
  if (canFitItem(player, typeId, amount)) {
    let remaining = amount;
    while (remaining > 0) {
      const stackAmount = Math.min(64, remaining);
      const stack = new ItemStack(typeId, stackAmount);
      const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
      const leftover = inventory?.addItem(stack);
      if (leftover) {
        player.dimension.spawnItem(leftover, player.location);
      }
      remaining -= stackAmount;
    }
    return true;
  }
  return false;
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

function queuePayout(settlement, playerName, copperAmount) {
  ensureSettlementTradeData(settlement);
  settlement.trade.pendingPayouts.push({ playerName, copperAmount, createdTick: deps.system.currentTick });
}

export function processPendingTradePayouts() {
  const data = deps.loadData();
  let changed = false;
  for (const settlement of data.settlements) {
    ensureSettlementTradeData(settlement);
    const remaining = [];
    for (const payout of settlement.trade.pendingPayouts) {
      const player = deps.world.getPlayers().find((online) => deps.samePlayerName(deps.getPlayerName(online), payout.playerName));
      if (!player) {
        remaining.push(payout);
        continue;
      }
      if (countCopperValue(player) >= 0 && giveStoredCoins(player, payout.copperAmount)) {
        player.sendMessage(`§aПолучены монеты от торговли: ${formatCopperValue(payout.copperAmount)}.`);
        changed = true;
      } else {
        player.sendMessage("§cОсвободите инвентарь, чтобы получить монеты от торговли.");
        remaining.push(payout);
      }
    }
    settlement.trade.pendingPayouts = remaining;
  }
  if (changed) deps.saveData(data);
}

function giveStoredCoins(player, copperAmount) {
  if (!canFitCoins(player, copperAmount)) return false;
  giveCopperValue(player, copperAmount);
  return true;
}

function canFitCoins(player, copperAmount) {
  return canFitItem(player, "kingdoms:coin_copper", 1) || canFitItem(player, "kingdoms:coin_silver", 1) || canFitItem(player, "kingdoms:coin_gold", 1) || copperAmount === 0;
}

function parseCoinPrice(formValues) {
  const strings = getModalTextFieldValues(formValues);
  const copper = Math.max(0, Math.floor(Number(strings[0] ?? 0)));
  const silver = Math.max(0, Math.floor(Number(strings[1] ?? 0)));
  const gold = Math.max(0, Math.floor(Number(strings[2] ?? 0)));
  return copper + silver * COPPER_PER_SILVER + gold * COPPER_PER_GOLD;
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
    .button("Монеты", "textures/ui/kingdoms/icon_tax")
    .button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showFormDeferred(player, form);
  if (response.canceled) return;
  if (response.selection === 0) return openCreateTradeOffer(player, settlementId, sessionToken);
  if (response.selection === 1) return openTradeInbox(player, settlementId, sessionToken);
  if (response.selection === 2) return openTradeWithdraw(player, settlementId, sessionToken);
  return deps.openSettlementMenu(player, settlementId, deps.SETTLEMENT_MENU_PAGE.EXTRA, false, sessionToken);
}

async function openCreateTradeOffer(player, settlementId, sessionToken) {
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  const items = getInventoryItems(player).filter((entry) => entry.amount > 0);
  if (!items.length) {
    player.sendMessage("§cНет предметов для продажи. Монеты нельзя выставлять на торговлю.");
    return openTradeHub(player, settlementId, sessionToken);
  }

  const uniqueItems = [];
  const seen = new Set();
  for (const entry of items) {
    if (seen.has(entry.typeId)) continue;
    seen.add(entry.typeId);
    uniqueItems.push(entry);
  }

  const itemPick = await deps.pickFromActionList(player, "Торговля", "Выберите предмет:", uniqueItems, {
    getLabel: (entry) => formatItemButtonLabel(entry.name),
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
  if (pricePerUnit < 1) {
    player.sendMessage("§cУкажите цену хотя бы в 1 медной монете.");
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

  settlement.trade.inbox = settlement.trade.inbox.filter((entry) => entry.id !== offer.id);

  const senderSettlement = deps.getSettlement(data, offer.fromSettlementId);
  if (senderSettlement) {
    recordTradeStats(senderSettlement, settlement.id, offer.fromPlayerName, offer.totalCopper);
    const senderOnline = deps.world.getPlayers().find((online) => deps.samePlayerName(deps.getPlayerName(online), offer.fromPlayerName));
    if (senderOnline) {
      senderOnline.sendMessage(`§aСделка принята! На торговом счёте ${senderSettlement.name}: +${formatCopperValue(offer.totalCopper)}.`);
    }
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

  if (!giveStoredCoins(player, amount)) {
    player.sendMessage("§cОсвободите инвентарь, чтобы забрать монеты.");
    return openTradeHub(player, settlementId, sessionToken);
  }

  settlement.trade.balanceCopper = 0;
  deps.saveData(data);
  player.sendMessage(`§aЗабрано с торгового счёта: ${formatCopperValue(amount)}.`);
  return openTradeHub(player, settlementId, sessionToken);
}
