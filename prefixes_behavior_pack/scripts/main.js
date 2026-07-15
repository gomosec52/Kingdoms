import { system, world } from "@minecraft/server";

const STORE_KEY = "kingdoms:data:v1";
const CREATOR_PREFIXES = [
  "Староста",
  "Войт",
  "Посадник",
  "Бургомистр",
  "Кастелян",
  "Король",
  "Император"
];

const noticeShown = new Set();
let chatApiReady = false;
let lastWarnTick = -1000;

system.runInterval(() => syncAllPrefixes(), 20);

world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!player) return;
  system.run(() => {
    syncAllPrefixes();
    notifyPlayer(player);
  });
});

world.afterEvents.playerLeave.subscribe((event) => {
  if (event.playerName) noticeShown.delete(event.playerName);
});

function syncAllPrefixes() {
  const data = loadKingdomsData();
  if (!data) {
    maybeWarnMissingCore();
    return;
  }

  for (const player of world.getPlayers()) {
    applyPrefix(player, resolvePrefix(data, player.name));
  }
}

function applyPrefix(player, prefix) {
  const playerName = player.name;
  const formatted = prefix ? `§7[§6${prefix}§7] ` : "";
  const nameTag = prefix ? `${formatted}§f${playerName}` : playerName;

  try {
    if (player.nameTag !== nameTag) player.nameTag = nameTag;
  } catch (_error) {
    // nameTag can briefly reject writes during respawn.
  }

  if (!prefix) {
    clearChatPrefix(player);
    return;
  }

  if (setChatPrefix(player, formatted)) {
    chatApiReady = true;
  }
}

function setChatPrefix(player, formatted) {
  try {
    player.chatNamePrefix = formatted;
    player.chatNameSuffix = "";
    player.chatMessagePrefix = "";

    if (typeof player.chatDisplayName === "string") {
      return player.chatDisplayName.startsWith(formatted) || player.chatNamePrefix === formatted;
    }
    return player.chatNamePrefix === formatted;
  } catch (_error) {
    return false;
  }
}

function clearChatPrefix(player) {
  try {
    player.chatNamePrefix = "";
    player.chatNameSuffix = "";
    player.chatMessagePrefix = "";
  } catch (_error) {
    // Ignore.
  }
}

function resolvePrefix(data, playerName) {
  const settlement = data.settlements.find((entry) => sameName(entry.creatorName, playerName))
    ?? data.settlements.find((entry) => Object.keys(entry.members || {}).some((name) => sameName(name, playerName)));
  if (!settlement) return undefined;

  if (sameName(settlement.creatorName, playerName)) {
    return settlement.creatorPrefix || CREATOR_PREFIXES[settlement.typeIndex] || CREATOR_PREFIXES[0];
  }

  const memberKey = Object.keys(settlement.members || {}).find((name) => sameName(name, playerName));
  return memberKey ? settlement.members[memberKey]?.prefix || "Крестьянин" : undefined;
}

function loadKingdomsData() {
  try {
    const raw = world.getDynamicProperty(STORE_KEY);
    if (typeof raw !== "string" || !raw) return emptyData();
    const data = JSON.parse(raw);
    if (!Array.isArray(data.settlements)) data.settlements = [];
    return data;
  } catch (_error) {
    return undefined;
  }
}

function emptyData() {
  return { settlements: [] };
}

function maybeWarnMissingCore() {
  if (system.currentTick - lastWarnTick < 200) return;
  lastWarnTick = system.currentTick;
  console.warn("[Kingdoms Prefixes] Не удалось прочитать данные Kingdoms Wars (kingdoms:data:v1).");
}

function notifyPlayer(player) {
  const name = player.name;
  if (noticeShown.has(name)) return;
  noticeShown.add(name);

  const prefix = resolvePrefix(loadKingdomsData() || emptyData(), name);
  player.sendMessage("§6[Kingdoms Prefixes] §fАддон префиксов загружен (v1.0.0).");
  if (!chatApiReady && !probeChatApi(player)) {
    player.sendMessage("§cВключите Beta APIs в настройках мира — иначе префикс в чате не появится.");
  } else {
    player.sendMessage("§aПрефиксы в чате: chatNamePrefix активен.");
  }
  if (prefix) player.sendMessage(`§7Ваш текущий префикс: §6${prefix}`);
  else player.sendMessage("§7Вступите в поселение или создайте флаг в Kingdoms Wars — появится префикс.");
}

function probeChatApi(player) {
  try {
    const previous = player.chatNamePrefix;
    player.chatNamePrefix = previous ?? "";
    chatApiReady = true;
    return true;
  } catch (_error) {
    return false;
  }
}

function sameName(first, second) {
  return String(first ?? "").toLowerCase() === String(second ?? "").toLowerCase();
}
