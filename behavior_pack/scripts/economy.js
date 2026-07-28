import { ItemStack } from "@minecraft/server";

export const COIN_COPPER = "kingdoms:coin_copper";
export const COIN_SILVER = "kingdoms:coin_silver";
export const COIN_GOLD = "kingdoms:coin_gold";
export const COIN_ROLL_COPPER = "kingdoms:coin_roll_copper";
export const COIN_ROLL_SILVER = "kingdoms:coin_roll_silver";
export const COIN_EXCHANGE = 32;
export const COIN_ROLL_SIZE = 8;

/** 1 старый изумруд = 1 серебряная монета = 32 медных */
export const COPPER_PER_SILVER = COIN_EXCHANGE;
export const COPPER_PER_GOLD = COIN_EXCHANGE * COIN_EXCHANGE;

export const CREATION_COST_COPPER = 15 * COPPER_PER_SILVER;
export const DEFAULT_SPAWN_GUARD_RADIUS = 50;
export const MAX_SPAWN_GUARD_RADIUS = 400;

const COIN_LABELS = {
  [COIN_COPPER]: "медные монеты",
  [COIN_SILVER]: "серебряные монеты",
  [COIN_GOLD]: "золотые монеты"
};

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
    + countItem(player, COIN_ROLL_COPPER) * COIN_ROLL_SIZE
    + countItem(player, COIN_SILVER) * COPPER_PER_SILVER
    + countItem(player, COIN_ROLL_SILVER) * COIN_ROLL_SIZE * COPPER_PER_SILVER
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
  if (!Number.isFinite(copperAmount) || copperAmount < 0) return false;
  const total = countCopperValue(player);
  if (total < copperAmount) return false;

  const copperHeld = countItem(player, COIN_COPPER);
  const copperRollHeld = countItem(player, COIN_ROLL_COPPER);
  const silverHeld = countItem(player, COIN_SILVER);
  const silverRollHeld = countItem(player, COIN_ROLL_SILVER);
  const goldHeld = countItem(player, COIN_GOLD);

  if (copperHeld > 0) takeItem(player, COIN_COPPER, copperHeld);
  if (copperRollHeld > 0) takeItem(player, COIN_ROLL_COPPER, copperRollHeld);
  if (silverHeld > 0) takeItem(player, COIN_SILVER, silverHeld);
  if (silverRollHeld > 0) takeItem(player, COIN_ROLL_SILVER, silverRollHeld);
  if (goldHeld > 0) takeItem(player, COIN_GOLD, goldHeld);

  giveCopperValue(player, total - copperAmount);
  return true;
}

export function takeCopperValueWithNotice(player, copperAmount) {
  const total = countCopperValue(player);
  if (total < copperAmount) return false;
  const change = total - copperAmount;
  if (!takeCopperValue(player, copperAmount)) return false;
  if (change > 0) player.sendMessage(`§7Сдача: ${formatCopperValue(change)}`);
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

export function isCoinType(typeId) {
  return typeId === COIN_COPPER || typeId === COIN_SILVER || typeId === COIN_GOLD;
}

function coinCopperValue(typeId) {
  if (typeId === COIN_GOLD) return COPPER_PER_GOLD;
  if (typeId === COIN_SILVER) return COPPER_PER_SILVER;
  if (typeId === COIN_COPPER) return 1;
  return 0;
}

export function getTotalCoinCostCopper(costEntries) {
  return (costEntries || []).reduce((sum, entry) => {
    if (!isCoinType(entry.itemId)) return sum;
    return sum + entry.amount * coinCopperValue(entry.itemId);
  }, 0);
}

function buildCoinConversionHint(player, entry, have) {
  const need = entry.amount - have;

  if (entry.itemId === COIN_SILVER) {
    const copper = countItem(player, COIN_COPPER);
    if (copper >= need * COPPER_PER_SILVER) {
      return `Переделайте ${need * COPPER_PER_SILVER} медных монет в ${need} серебряных (верстак)`;
    }
    if (countItem(player, COIN_GOLD) > 0) {
      return "Переделайте золотые монеты в серебряные на верстаке (1 зол. → 32 сер.)";
    }
  }

  if (entry.itemId === COIN_GOLD) {
    const silver = countItem(player, COIN_SILVER);
    if (silver >= need * COPPER_PER_SILVER) {
      return `Переделайте ${need * COPPER_PER_SILVER} серебряных монет в ${need} золотых (верстак)`;
    }
    if (silver > 0 || countItem(player, COIN_COPPER) >= COPPER_PER_SILVER) {
      return "Переделайте серебряные монеты в золотые на верстаке (32 сер. → 1 зол.)";
    }
  }

  if (entry.itemId === COIN_COPPER) {
    if (countItem(player, COIN_SILVER) > 0) {
      return "Переделайте серебряные монеты в медные на верстаке (1 сер. → 32 мед.)";
    }
    if (countItem(player, COIN_GOLD) > 0) {
      return "Переделайте золотые монеты в медные через серебряные (верстак)";
    }
  }

  return `Переделайте монеты в ${COIN_LABELS[entry.itemId] ?? entry.label} на верстаке`;
}

export function describeCostShortage(player, costEntries) {
  const missing = [];
  const hints = [];
  const entries = costEntries || [];
  const canAffordCoinsInTotal = countCopperValue(player) >= getTotalCoinCostCopper(entries);

  for (const entry of entries) {
    if (isCoinType(entry.itemId)) {
      const have = countItem(player, entry.itemId);
      if (have >= entry.amount) continue;
      if (canAffordCoinsInTotal) {
        hints.push(buildCoinConversionHint(player, entry, have));
      } else {
        missing.push(`${entry.label} (${have}/${entry.amount})`);
      }
      continue;
    }

    const have = countItem(player, entry.itemId);
    if (have < entry.amount) missing.push(`${entry.label} (${have}/${entry.amount})`);
  }

  return { missing, hints: [...new Set(hints)] };
}

export function reportCostShortage(player, costEntries) {
  const { missing, hints } = describeCostShortage(player, costEntries);
  for (const hint of hints) player.sendMessage(`§e${hint}`);
  if (missing.length) player.sendMessage(`§cНе хватает: ${missing.join(", ")}`);
  return missing.length > 0 || hints.length > 0;
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
