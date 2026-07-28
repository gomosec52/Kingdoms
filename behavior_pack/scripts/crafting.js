import { system } from "@minecraft/server";
import { FLAG_ITEM } from "./constants.js";
import {
  COIN_COPPER,
  countItem,
  giveItems,
  takeItem
} from "./economy.js";

const COPPER_INGOT = "minecraft:copper_ingot";
const COMPACT_COPPER_INGOT = "5fs_br:compact_copper_ingot";
const WHITE_WOOL = "minecraft:white_wool";
const STICK = "minecraft:stick";
const CRAFTING_TABLE = "minecraft:crafting_table";

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

function handleShiftCraft(player) {
  if (tryCoinFromIngot(player, COPPER_INGOT, 9)) return true;
  if (tryCoinFromIngot(player, COMPACT_COPPER_INGOT, 81)) return true;
  if (tryCraftFlag(player)) return true;

  player.sendMessage("§e[Королевства] Shift+клик по верстаку: слиток → 9 монет, или 3 шерсти + палка + 4 монеты → флаг");
  return false;
}

export function bindCraftingFallback(world) {
  world.beforeEvents?.playerInteractWithBlock?.subscribe((event) => {
    const player = event.player;
    const block = event.block;
    if (!player || block?.typeId !== CRAFTING_TABLE) return;
    if (!player.isSneaking) return;

    event.cancel = true;
    system.run(() => handleShiftCraft(player));
  });
}
