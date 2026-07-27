import { ItemStack } from "@minecraft/server";

export const COIN_COPPER = "kingdoms:coin_copper";
export const COIN_SILVER = "kingdoms:coin_silver";
export const COIN_GOLD = "kingdoms:coin_gold";
export const COIN_EXCHANGE = 32;

/** 1 старый изумруд = 1 серебряная монета = 32 медных */
export const COPPER_PER_SILVER = COIN_EXCHANGE;
export const COPPER_PER_GOLD = COIN_EXCHANGE * COIN_EXCHANGE;

export const CREATION_COST_COPPER = 15 * COPPER_PER_SILVER;
export const DEFAULT_SPAWN_GUARD_RADIUS = 50;
export const MAX_SPAWN_GUARD_RADIUS = 400;

function getInventory(player) {
  return player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
}

export function countItem(player, typeId) {
  const inventory = getInventory(player);
  if (!inventory) return 0;

  let total = 0;
  for (let slot = 0; slot < inventory.size; slot += 1) {
    const item = inventory.getItem(slot);
    if (item?.typeId === typeId) total += item.amount;
  }
  return total;
}

export function countCopperValue(player) {
  return countItem(player, COIN_COPPER)
    + countItem(player, COIN_SILVER) * COPPER_PER_SILVER
    + countItem(player, COIN_GOLD) * COPPER_PER_GOLD;
}

export function formatCopperValue(copperAmount) {
  let remaining = Math.max(0, Math.floor(copperAmount));
  const gold = Math.floor(remaining / COPPER_PER_GOLD);
  remaining -= gold * COPPER_PER_GOLD;
  const silver = Math.floor(remaining / COPPER_PER_SILVER);
  remaining -= silver * COPPER_PER_SILVER;
  const parts = [];
  if (gold > 0) parts.push(`${gold} зол.`);
  if (silver > 0) parts.push(`${silver} сер.`);
  if (remaining > 0) parts.push(`${remaining} мед.`);
  return parts.length ? parts.join(" ") : "0 мед.";
}

export function emeraldCostToLabel(emeraldAmount) {
  return formatCopperValue(emeraldAmount * COPPER_PER_SILVER);
}

function giveSingleStack(player, stack) {
  const inventory = getInventory(player);
  if (!inventory) {
    try {
      player.dimension.spawnItem(stack, player.location);
    } catch (_error) {
      // Ignore spawn failures.
    }
    return;
  }

  const leftover = inventory.addItem(stack);
  if (leftover) {
    try {
      player.dimension.spawnItem(leftover, player.location);
    } catch (_error) {
      // Ignore spawn failures.
    }
  }
}

export function giveItems(player, typeId, amount) {
  let remaining = amount;
  while (remaining > 0) {
    const stackAmount = Math.min(64, remaining);
    giveSingleStack(player, new ItemStack(typeId, stackAmount));
    remaining -= stackAmount;
  }
}

export function giveCopperValue(player, copperAmount) {
  let remaining = Math.max(0, Math.floor(copperAmount));
  const gold = Math.floor(remaining / COPPER_PER_GOLD);
  remaining -= gold * COPPER_PER_GOLD;
  const silver = Math.floor(remaining / COPPER_PER_SILVER);
  remaining -= silver * COPPER_PER_SILVER;
  if (gold > 0) giveItems(player, COIN_GOLD, gold);
  if (silver > 0) giveItems(player, COIN_SILVER, silver);
  if (remaining > 0) giveItems(player, COIN_COPPER, remaining);
}

export function takeItem(player, typeId, amount) {
  const inventory = getInventory(player);
  if (!inventory || countItem(player, typeId) < amount) return false;

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

export function takeCopperValue(player, copperAmount) {
  const total = countCopperValue(player);
  if (total < copperAmount) return false;

  const copperHeld = countItem(player, COIN_COPPER);
  const silverHeld = countItem(player, COIN_SILVER);
  const goldHeld = countItem(player, COIN_GOLD);

  if (copperHeld > 0) takeItem(player, COIN_COPPER, copperHeld);
  if (silverHeld > 0) takeItem(player, COIN_SILVER, silverHeld);
  if (goldHeld > 0) takeItem(player, COIN_GOLD, goldHeld);

  giveCopperValue(player, total - copperAmount);
  return true;
}

export function hasCopperValue(player, copperAmount) {
  return countCopperValue(player) >= copperAmount;
}

export function buildingCostCopper(emeraldAmount) {
  return emeraldAmount * COPPER_PER_SILVER;
}

export function replaceEmeraldCosts(costEntries) {
  return (costEntries || []).map((entry) => {
    if (entry.itemId !== "minecraft:emerald") return entry;
    const copper = buildingCostCopper(entry.amount);
    return {
      itemId: COIN_SILVER,
      amount: Math.ceil(copper / COPPER_PER_SILVER),
      label: "серебряные монеты",
      copperValue: copper
    };
  }).map((entry) => {
    if (entry.copperValue) {
      const { copperValue, ...rest } = entry;
      return rest;
    }
    return entry;
  });
}

export function getMissingCoinCost(player, costEntries) {
  const missing = [];
  for (const entry of costEntries || []) {
    if (entry.itemId === COIN_COPPER || entry.itemId === COIN_SILVER || entry.itemId === COIN_GOLD) {
      const have = countItem(player, entry.itemId);
      if (have < entry.amount) missing.push(`${entry.label} (${have}/${entry.amount})`);
      continue;
    }
    const have = countItem(player, entry.itemId);
    if (have < entry.amount) missing.push(`${entry.label} (${have}/${entry.amount})`);
  }
  return missing;
}

export function takeMixedCost(player, costEntries) {
  for (const entry of costEntries || []) {
    if (entry.itemId === COIN_COPPER || entry.itemId === COIN_SILVER || entry.itemId === COIN_GOLD) {
      if (countItem(player, entry.itemId) < entry.amount) return false;
      continue;
    }
    if (countItem(player, entry.itemId) < entry.amount) return false;
  }

  for (const entry of costEntries || []) {
    if (!takeItem(player, entry.itemId, entry.amount)) return false;
  }
  return true;
}
