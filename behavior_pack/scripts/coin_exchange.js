import {
  CustomCommandPermissionLevel,
  CustomCommandStatus,
  system
} from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import {
  COIN_COPPER,
  COIN_SILVER,
  COIN_GOLD,
  COIN_EXCHANGE,
  countItem,
  formatCopperValue,
  giveItems,
  takeItem
} from "./economy.js";
import { kingdomsMenuTitle } from "./ui.js";

/** @type {Record<string, any> | null} */
let deps = null;

const ICON_COIN = "textures/ui/kingdoms/icon_tax";
const ICON_UP = "textures/ui/kingdoms/icon_war";
const ICON_DOWN = "textures/ui/kingdoms/icon_disband";

function exchangeUpgradeOnce(player, fromTypeId, toTypeId) {
  if (countItem(player, fromTypeId) < COIN_EXCHANGE) {
    return { ok: false, message: `§cНужно минимум ${COIN_EXCHANGE} монет.` };
  }
  if (!takeItem(player, fromTypeId, COIN_EXCHANGE)) {
    return { ok: false, message: "§cНе удалось списать монеты." };
  }
  giveItems(player, toTypeId, 1);
  return { ok: true, message: `§aОбмен: ${COIN_EXCHANGE} → 1.` };
}

function exchangeUpgradeAll(player, fromTypeId, toTypeId) {
  const held = countItem(player, fromTypeId);
  const sets = Math.floor(held / COIN_EXCHANGE);
  if (sets <= 0) {
    return { ok: false, message: `§cНужно минимум ${COIN_EXCHANGE} монет.` };
  }
  const spend = sets * COIN_EXCHANGE;
  if (!takeItem(player, fromTypeId, spend)) {
    return { ok: false, message: "§cНе удалось списать монеты." };
  }
  giveItems(player, toTypeId, sets);
  return { ok: true, message: `§aОбменяно всё: ${spend} → ${sets}.` };
}

function exchangeDowngradeOnce(player, fromTypeId, toTypeId) {
  if (countItem(player, fromTypeId) < 1) {
    return { ok: false, message: "§cНет монет для размена." };
  }
  if (!takeItem(player, fromTypeId, 1)) {
    return { ok: false, message: "§cНе удалось списать монету." };
  }
  giveItems(player, toTypeId, COIN_EXCHANGE);
  return { ok: true, message: `§aРазмен: 1 → ${COIN_EXCHANGE}.` };
}

function exchangeDowngradeAll(player, fromTypeId, toTypeId) {
  const held = countItem(player, fromTypeId);
  if (held <= 0) {
    return { ok: false, message: "§cНет монет для размена." };
  }
  if (!takeItem(player, fromTypeId, held)) {
    return { ok: false, message: "§cНе удалось списать монеты." };
  }
  giveItems(player, toTypeId, held * COIN_EXCHANGE);
  return { ok: true, message: `§aРазменяно всё: ${held} → ${held * COIN_EXCHANGE}.` };
}

export function tryUpgradeCoins(player, fromTypeId, toTypeId) {
  const result = exchangeUpgradeOnce(player, fromTypeId, toTypeId);
  if (result.message) {
    player.sendMessage(result.ok
      ? `§a[Королевства] ${result.message.slice(2)}`
      : `§e[Королевства] ${result.message.slice(2)}`);
  }
  return result.ok;
}

export function tryDowngradeCoins(player, fromTypeId, toTypeId) {
  const result = exchangeDowngradeOnce(player, fromTypeId, toTypeId);
  if (result.message) {
    player.sendMessage(result.ok
      ? `§a[Королевства] ${result.message.slice(2)}`
      : `§e[Королевства] ${result.message.slice(2)}`);
  }
  return result.ok;
}

function formatExchangeBody(player) {
  const copper = countItem(player, COIN_COPPER);
  const silver = countItem(player, COIN_SILVER);
  const gold = countItem(player, COIN_GOLD);
  const canCopperUp = Math.floor(copper / COIN_EXCHANGE);
  const canSilverUp = Math.floor(silver / COIN_EXCHANGE);

  return [
    "§6══════ ОБМЕН МОНЕТ ══════",
    "",
    `§7Курс: §f${COIN_EXCHANGE} медных = 1 серебряная = 1/32 золотой`,
    "",
    "§fВаши монеты:",
    `§c● Медные: §f${copper} §7(можно поднять: ${canCopperUp})`,
    `§7● Серебряные: §f${silver} §7(можно поднять: ${canSilverUp}, разменять: ${silver})`,
    `§6● Золотые: §f${gold} §7(можно разменять: ${gold})`,
    "",
    `§7Итого: §f${formatCopperValue(copper + silver * COIN_EXCHANGE + gold * COIN_EXCHANGE * COIN_EXCHANGE)}`,
    "",
    "§8Команда: /kingdoms:con"
  ].join("\n");
}

async function runExchange(player, action) {
  const result = action();
  if (result.message) player.sendMessage(result.message);
  if (result.ok) return openCoinExchangeMenu(player);
  return openCoinExchangeMenu(player);
}

export async function openCoinExchangeMenu(player) {
  if (!deps || !player?.isValid) return;

  const form = new ActionFormData()
    .title(kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.COIN_EXCHANGE))
    .body(formatExchangeBody(player))
    .button(`32 медных → 1 серебряная`, ICON_UP)
    .button("Обменять все медные ↑", ICON_UP)
    .button(`32 серебряных → 1 золотая`, ICON_UP)
    .button("Обменять все серебряные ↑", ICON_UP)
    .button(`1 серебряная → 32 медных`, ICON_DOWN)
    .button("Обменять все серебряные ↓", ICON_DOWN)
    .button(`1 золотая → 32 серебряных`, ICON_DOWN)
    .button("Обменять все золотые ↓", ICON_DOWN)
    .button("Закрыть", ICON_COIN);

  const response = await deps.showFormDeferred(player, form);
  if (response.canceled || response.selection === 8) return;

  switch (response.selection) {
    case 0:
      return runExchange(player, () => exchangeUpgradeOnce(player, COIN_COPPER, COIN_SILVER));
    case 1:
      return runExchange(player, () => exchangeUpgradeAll(player, COIN_COPPER, COIN_SILVER));
    case 2:
      return runExchange(player, () => exchangeUpgradeOnce(player, COIN_SILVER, COIN_GOLD));
    case 3:
      return runExchange(player, () => exchangeUpgradeAll(player, COIN_SILVER, COIN_GOLD));
    case 4:
      return runExchange(player, () => exchangeDowngradeOnce(player, COIN_SILVER, COIN_COPPER));
    case 5:
      return runExchange(player, () => exchangeDowngradeAll(player, COIN_SILVER, COIN_COPPER));
    case 6:
      return runExchange(player, () => exchangeDowngradeOnce(player, COIN_GOLD, COIN_SILVER));
    case 7:
      return runExchange(player, () => exchangeDowngradeAll(player, COIN_GOLD, COIN_SILVER));
    default:
      return openCoinExchangeMenu(player);
  }
}

function registerConCommand(initEvent) {
  const registry = initEvent.customCommandRegistry;
  if (!registry?.registerCommand) return;

  registry.registerCommand(
    {
      name: "kingdoms:con",
      description: "Меню обмена монет",
      permissionLevel: CustomCommandPermissionLevel.Any,
      cheatsRequired: false
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (!player?.isValid || player.typeId !== "minecraft:player") {
        return {
          status: CustomCommandStatus.Failure,
          message: "Команда только для игроков"
        };
      }
      system.run(() => openCoinExchangeMenu(player));
      return { status: CustomCommandStatus.Success };
    }
  );
}

export function bindCoinExchangeSystem(bindDeps) {
  deps = bindDeps;
  bindDeps.system.beforeEvents.startup.subscribe(registerConCommand);

  bindDeps.system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id !== "kingdoms:open_con") return;
    const player = event.sourceEntity;
    if (!player?.isValid || player.typeId !== "minecraft:player") return;
    system.run(() => openCoinExchangeMenu(player));
  });
}
