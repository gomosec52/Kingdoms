import { system } from "@minecraft/server";
import { FLAG_ITEM, COIN_EXCHANGE_COMPONENT } from "./constants.js";
import {
  COIN_COPPER,
  COIN_SILVER,
  COIN_GOLD,
  COIN_EXCHANGE,
  countItem,
  giveItems,
  takeItem
} from "./economy.js";
import { tryUpgradeCoins, tryDowngradeCoins } from "./coin_exchange.js";

const COPPER_INGOT = "minecraft:copper_ingot";
const COMPACT_COPPER_INGOT = "5fs_br:compact_copper_ingot";
const WHITE_WOOL = "minecraft:white_wool";
const STICK = "minecraft:stick";
const CRAFTING_TABLE = "minecraft:crafting_table";
const COIN_TYPES = new Set([COIN_COPPER, COIN_SILVER, COIN_GOLD]);

let coinExchangeRegistered = false;

function tryCoinFromIngot(player, typeId, coinCount) {
  if (countItem(player, typeId) < 1) return false;
  if (!takeItem(player, typeId, 1)) return false;
  giveItems(player, COIN_COPPER, coinCount);
  player.sendMessage(`§a[Королевства] 1 слиток → ${coinCount} медных монет`);
  return true;
}

function tryCraftFlag(player) {
  if (countItem(player, WHITE_WOOL) < 3) return false;
  if (countItem(player, STICK) < 1) return false;
  if (countItem(player, COIN_COPPER) < 4) return false;

  if (!takeItem(player, WHITE_WOOL, 3)) return false;
  if (!takeItem(player, STICK, 1)) return false;
  if (!takeItem(player, COIN_COPPER, 4)) return false;

  giveItems(player, FLAG_ITEM, 1);
  player.sendMessage("§a[Королевства] Скрафчен флаг поселения");
  return true;
}

function sendCoinExchangeHint(player) {
  player.sendMessage(
    `§e[Королевства] Обмен: /con | ПКМ: стак ${COIN_EXCHANGE} → выше | 1 шт. → ${COIN_EXCHANGE} ниже`
  );
}

function handleCoinUse(player, itemTypeId, stackSize) {
  if (itemTypeId === COIN_COPPER && stackSize >= COIN_EXCHANGE) {
    return tryUpgradeCoins(player, COIN_COPPER, COIN_SILVER);
  }
  if (itemTypeId === COIN_SILVER && stackSize >= COIN_EXCHANGE) {
    return tryUpgradeCoins(player, COIN_SILVER, COIN_GOLD);
  }
  if (itemTypeId === COIN_SILVER && stackSize === 1) {
    return tryDowngradeCoins(player, COIN_SILVER, COIN_COPPER);
  }
  if (itemTypeId === COIN_GOLD && stackSize === 1) {
    return tryDowngradeCoins(player, COIN_GOLD, COIN_SILVER);
  }

  if (COIN_TYPES.has(itemTypeId)) {
    sendCoinExchangeHint(player);
  }
  return false;
}

function getHeldCoinStack(player) {
  const inventory = player.getComponent("minecraft:inventory")?.container;
  const held = inventory?.getItem(player.selectedSlotIndex);
  if (!held || !COIN_TYPES.has(held.typeId)) return null;
  return held;
}

function bindCoinUseEvents(world) {
  const runCoinUse = (player, itemStack) => {
    if (!player || player.typeId !== "minecraft:player" || !itemStack) return;
    system.run(() => handleCoinUse(player, itemStack.typeId, itemStack.amount ?? 0));
  };

  world.beforeEvents?.itemUse?.subscribe((event) => {
    const itemTypeId = event.itemStack?.typeId;
    if (!COIN_TYPES.has(itemTypeId)) return;
    event.cancel = true;
    runCoinUse(event.source, event.itemStack);
  });
}

/** @type {import("@minecraft/server").ItemCustomComponent} */
const coinExchangeComponent = {
  onUse(event) {
    const player = event.source;
    if (!player || player.typeId !== "minecraft:player") return;
    const itemStack = event.itemStack;
    if (!itemStack) return;
    system.run(() => handleCoinUse(player, itemStack.typeId, itemStack.amount ?? 0));
  }
};

function registerCoinExchangeComponent(registry) {
  if (coinExchangeRegistered || !registry?.registerCustomComponent) return;
  registry.registerCustomComponent(COIN_EXCHANGE_COMPONENT, coinExchangeComponent);
  coinExchangeRegistered = true;
}

export function bindCraftingFallback(world) {
  system.beforeEvents?.startup?.subscribe((event) => {
    registerCoinExchangeComponent(event.itemComponentRegistry);
  });

  world.beforeEvents?.worldInitialize?.subscribe((event) => {
    registerCoinExchangeComponent(event.itemComponentRegistry);
  });

  bindCoinUseEvents(world);

  world.beforeEvents?.playerInteractWithBlock?.subscribe((event) => {
    const player = event.player;
    const block = event.block;
    if (!player || block?.typeId !== CRAFTING_TABLE || !player.isSneaking) return;

    const held = getHeldCoinStack(player);
    if (!held) return;

    event.cancel = true;
    system.run(() => {
      if (!handleCoinUse(player, held.typeId, held.amount ?? 0)) {
        sendCoinExchangeHint(player);
      }
    });
  });

  system.afterEvents?.scriptEventReceive?.subscribe((event) => {
    const player = event.sourceEntity;
    if (!player || player.typeId !== "minecraft:player") return;

    if (event.id === "kingdoms:make_coins") {
      if (!tryCoinFromIngot(player, COPPER_INGOT, 9)) {
        player.sendMessage("§c[Королевства] Нужен медный слиток в инвентаре");
      }
      return;
    }

    if (event.id === "kingdoms:craft_flag") {
      if (!tryCraftFlag(player)) {
        player.sendMessage("§c[Королевства] Нужно: 3 белой шерсти, палка, 4 медные монеты");
      }
      return;
    }

    if (event.id === "kingdoms:exchange_copper") {
      tryUpgradeCoins(player, COIN_COPPER, COIN_SILVER);
      return;
    }

    if (event.id === "kingdoms:exchange_silver") {
      tryUpgradeCoins(player, COIN_SILVER, COIN_GOLD);
    }
  });
}
