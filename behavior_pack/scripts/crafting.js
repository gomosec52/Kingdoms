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

const COPPER_INGOT = "minecraft:copper_ingot";
const COMPACT_COPPER_INGOT = "5fs_br:compact_copper_ingot";
const WHITE_WOOL = "minecraft:white_wool";
const STICK = "minecraft:stick";
const CRAFTING_TABLE = "minecraft:crafting_table";

let coinExchangeRegistered = false;
const inventorySnapshots = new Map();

function snapshotCoins(player) {
  return {
    copper: countItem(player, COIN_COPPER),
    silver: countItem(player, COIN_SILVER),
    gold: countItem(player, COIN_GOLD)
  };
}

function storeSnapshot(player) {
  inventorySnapshots.set(player.id, snapshotCoins(player));
}

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

function tryUpgradeCoins(player, fromTypeId, toTypeId) {
  if (countItem(player, fromTypeId) < COIN_EXCHANGE) {
    player.sendMessage(`§e[Королевства] Нужно ${COIN_EXCHANGE} монет`);
    return false;
  }
  storeSnapshot(player);
  if (!takeItem(player, fromTypeId, COIN_EXCHANGE)) return false;
  giveItems(player, toTypeId, 1);
  storeSnapshot(player);
  return true;
}

function tryDowngradeCoins(player, fromTypeId, toTypeId) {
  if (countItem(player, fromTypeId) < 1) return false;
  storeSnapshot(player);
  if (!takeItem(player, fromTypeId, 1)) return false;
  giveItems(player, toTypeId, COIN_EXCHANGE);
  storeSnapshot(player);
  return true;
}

function revertInvalidCoinCraft(player, before, after) {
  const dCopper = after.copper - before.copper;
  const dSilver = after.silver - before.silver;
  const dGold = after.gold - before.gold;

  if (dSilver === 1 && dCopper < 0 && dCopper > -COIN_EXCHANGE) {
    takeItem(player, COIN_SILVER, 1);
    giveItems(player, COIN_COPPER, -dCopper);
    player.sendMessage(`§c[Королевства] Положи ${COIN_EXCHANGE} медных монет в один слот (не раскладывай по сетке)`);
    storeSnapshot(player);
    return true;
  }

  if (dGold === 1 && dSilver < 0 && dSilver > -COIN_EXCHANGE) {
    takeItem(player, COIN_GOLD, 1);
    giveItems(player, COIN_SILVER, -dSilver);
    player.sendMessage(`§c[Королевства] Положи ${COIN_EXCHANGE} серебряных монет в один слот (не раскладывай по сетке)`);
    storeSnapshot(player);
    return true;
  }

  return false;
}

function handleShiftCraft(player) {
  if (tryCoinFromIngot(player, COPPER_INGOT, 9)) return true;
  if (tryCoinFromIngot(player, COMPACT_COPPER_INGOT, 81)) return true;
  if (tryUpgradeCoins(player, COIN_COPPER, COIN_SILVER)) return true;
  if (tryUpgradeCoins(player, COIN_SILVER, COIN_GOLD)) return true;
  if (tryDowngradeCoins(player, COIN_SILVER, COIN_COPPER)) return true;
  if (tryDowngradeCoins(player, COIN_GOLD, COIN_SILVER)) return true;
  if (tryCraftFlag(player)) return true;

  player.sendMessage(`§e[Королевства] Shift+клик: обмен ${COIN_EXCHANGE}↔1, слиток→монеты, флаг`);
  return false;
}

function handleCoinUse(player, itemTypeId, stackSize) {
  if (itemTypeId === COIN_COPPER && stackSize >= COIN_EXCHANGE) {
    tryUpgradeCoins(player, COIN_COPPER, COIN_SILVER);
    return true;
  }
  if (itemTypeId === COIN_SILVER && stackSize >= COIN_EXCHANGE) {
    tryUpgradeCoins(player, COIN_SILVER, COIN_GOLD);
    return true;
  }
  if (itemTypeId === COIN_SILVER && stackSize >= 1) {
    tryDowngradeCoins(player, COIN_SILVER, COIN_COPPER);
    return true;
  }
  if (itemTypeId === COIN_GOLD && stackSize >= 1) {
    tryDowngradeCoins(player, COIN_GOLD, COIN_SILVER);
    return true;
  }
  return false;
}

/** @type {import("@minecraft/server").ItemCustomComponent} */
const coinExchangeComponent = {
  onUse(event) {
    const player = event.source;
    if (!player || player.typeId !== "minecraft:player") return;

    const itemTypeId = event.itemStack?.typeId;
    const stackSize = event.itemStack?.amount ?? 0;
    if (!itemTypeId) return;

    system.run(() => {
      if (handleCoinUse(player, itemTypeId, stackSize)) return;
      if (itemTypeId === COIN_COPPER || itemTypeId === COIN_SILVER || itemTypeId === COIN_GOLD) {
        player.sendMessage(`§e[Королевства] Обмен: ${COIN_EXCHANGE} в стаке → выше, 1 шт. → ${COIN_EXCHANGE} ниже`);
      }
    });
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

  world.afterEvents?.playerSpawn?.subscribe((event) => {
    if (event.player) storeSnapshot(event.player);
  });

  system.runInterval(() => {
    for (const player of world.getPlayers()) {
      if (!inventorySnapshots.has(player.id)) storeSnapshot(player);
    }
  }, 20);

  world.afterEvents?.playerInventoryItemChange?.subscribe((event) => {
    const player = event.player;
    if (!player || player.typeId !== "minecraft:player") return;

    system.run(() => {
      const before = inventorySnapshots.get(player.id) ?? snapshotCoins(player);
      const after = snapshotCoins(player);
      if (revertInvalidCoinCraft(player, before, after)) return;
      inventorySnapshots.set(player.id, after);
    });
  });

  world.beforeEvents?.playerInteractWithBlock?.subscribe((event) => {
    const player = event.player;
    const block = event.block;
    if (!player || block?.typeId !== CRAFTING_TABLE) return;
    if (!player.isSneaking) return;

    event.cancel = true;
    system.run(() => handleShiftCraft(player));
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
    }
  });
}
