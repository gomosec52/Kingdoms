import { system, world } from "@minecraft/server";
import { creatorPrefixFor } from "./config.js";
import { isPlacementApiAvailable } from "./flag.js";

const playerPrefixCache = new Map();
const prefixedChatCooldown = new Map();
const chatPrefixNoticeShown = new Set();

let directChatPrefixAvailable = false;
let chatPrefixMode = "none";
let resolvePrefix = () => undefined;

export function getChatPrefixMode() {
  return chatPrefixMode;
}

export function configurePrefixResolver(resolver) {
  resolvePrefix = resolver;
}

export function bindPrefixSystem() {
  if (world.beforeEvents.chatSend?.subscribe) {
    world.beforeEvents.chatSend.subscribe((event) => handlePrefixedChat(event, true));
    if (chatPrefixMode === "none") chatPrefixMode = "before";
  } else {
    chatPrefixMode = "none";
  }
}

export function updatePlayerPrefixDisplays(getPrefixForPlayer) {
  const onlineNames = new Set();

  for (const player of world.getPlayers()) {
    const playerName = player.name;
    onlineNames.add(playerName);

    const prefix = getPrefixForPlayer(playerName);
    if (prefix) playerPrefixCache.set(playerName, prefix);
    else playerPrefixCache.delete(playerName);

    applyPlayerPrefix(player, prefix);
  }

  for (const cachedName of playerPrefixCache.keys()) {
    if (!onlineNames.has(cachedName)) playerPrefixCache.delete(cachedName);
  }
}

export function announceChatPrefixStatus() {
  for (const player of world.getPlayers()) {
    const playerName = player.name;
    if (chatPrefixNoticeShown.has(playerName)) continue;

    const prefix = playerPrefixCache.get(playerName) ?? getCachedOrLoadedPrefix(playerName);
    if (!prefix) continue;

    chatPrefixNoticeShown.add(playerName);
    const active = chatPrefixMode === "chatNamePrefix" || chatPrefixMode === "before";
    if (active) player.sendMessage(`§aПрефикс в чате активен. Режим: ${chatPrefixMode}.`);
    else if (!world.beforeEvents.chatSend) {
      player.sendMessage("§7Префикс над ником активен. Чат-префиксы требуют обновления игры.");
    } else {
      player.sendMessage("§cПрефикс в чате не подключился. Префикс над ником работает.");
    }
  }
}

export function resetChatPrefixNotice(playerName) {
  if (playerName) chatPrefixNoticeShown.delete(playerName);
}

export function getPrefixFor(data, playerName, getPlayerSettlement, getMemberRecord) {
  const settlement = getPlayerSettlement(data, playerName);
  if (!settlement) return undefined;

  if (samePlayerName(settlement.creatorName, playerName)) {
    return creatorPrefixFor(settlement.typeIndex);
  }

  return getMemberRecord(settlement, playerName)?.prefix;
}

function applyPlayerPrefix(player, prefix) {
  const playerName = player.name;
  const formattedPrefix = prefix ? `§7[§6${prefix}§7] §f` : "";
  const nextNameTag = prefix ? `${formattedPrefix}${playerName}` : playerName;

  try {
    if (player.nameTag !== nextNameTag) player.nameTag = nextNameTag;
  } catch (_error) {
    // Some runtimes reject nameTag writes during player state transitions.
  }

  if (!prefix) {
    clearDirectChatPrefix(player);
    return;
  }

  if (tryApplyDirectChatPrefix(player, formattedPrefix)) {
    directChatPrefixAvailable = true;
    chatPrefixMode = "chatNamePrefix";
  }
}

function tryApplyDirectChatPrefix(player, formattedPrefix) {
  try {
    player.chatNamePrefix = formattedPrefix;
    player.chatNameSuffix = "";
    player.chatMessagePrefix = "";
    return true;
  } catch (_error) {
    return false;
  }
}

function clearDirectChatPrefix(player) {
  try {
    player.chatNamePrefix = "";
    player.chatNameSuffix = "";
    player.chatMessagePrefix = "";
  } catch (_error) {
    // Direct chat prefix API is optional.
  }
}

function handlePrefixedChat(event, canCancel) {
  const message = event.message;
  if (typeof message !== "string" || !message.length) return;

  const player = event.sender;
  const playerName = player?.name ?? "";
  if (!playerName) return;

  const prefix = getCachedOrLoadedPrefix(playerName);
  if (!prefix) return;
  if (directChatPrefixAvailable) return;

  if (canCancel) event.cancel = true;

  const duplicateKey = `${playerName}:${system.currentTick}:${message}`;
  if (prefixedChatCooldown.get(duplicateKey) === system.currentTick) return;
  prefixedChatCooldown.set(duplicateKey, system.currentTick);

  system.run(() => {
    world.sendMessage(`§7[§6${prefix}§7] §f${playerName}§7: §f${cleanChatMessage(message)}`);
  });
}

function getCachedOrLoadedPrefix(playerName) {
  const cached = playerPrefixCache.get(playerName);
  if (cached) return cached;

  try {
    const prefix = resolvePrefix(playerName);
    if (prefix) playerPrefixCache.set(playerName, prefix);
    return prefix;
  } catch (_error) {
    return undefined;
  }
}

function cleanChatMessage(value) {
  return String(value ?? "").replace(/§/g, "");
}

function samePlayerName(first, second) {
  return String(first ?? "").toLowerCase() === String(second ?? "").toLowerCase();
}

export function describeScriptApiStatus(worldRef = world) {
  const placement = isPlacementApiAvailable(worldRef);
  const chat = Boolean(worldRef.beforeEvents?.chatSend);
  const forms = Boolean(worldRef.afterEvents?.playerSpawn);
  return { placement, chat, forms };
}
