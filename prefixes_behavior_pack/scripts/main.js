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

/** @type {Map<string, string | undefined>} */
const lastAppliedPrefix = new Map();
const noticeShown = new Set();
const chatHookCooldown = new Map();

/** @type {"unknown" | "native" | "fallback" | "none"} */
let chatMode = "unknown";
let apiProbeDone = false;

system.runInterval(() => syncAllPrefixes(), 10);

world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!player) return;
  system.run(() => {
    ensureChatApiProbe(player);
    syncAllPrefixes();
    notifyPlayer(player);
  });
});

world.afterEvents.playerLeave.subscribe((event) => {
  if (!event.playerName) return;
  noticeShown.delete(event.playerName);
  lastAppliedPrefix.delete(event.playerName);
  chatHookCooldown.delete(event.playerName);
});

bindChatFallback();

function bindChatFallback() {
  const chatSend = world.beforeEvents?.chatSend;
  if (!chatSend?.subscribe) return;

  chatSend.subscribe((event) => {
    // Only rewrite chat when native chatNamePrefix is unavailable.
    if (chatMode === "native") return;

    const player = event.sender;
    const playerName = player?.name;
    const message = event.message;
    if (!playerName || typeof message !== "string" || !message.length) return;

    const prefix = resolvePrefix(loadKingdomsData(), playerName);
    if (!prefix) return;

    try {
      event.cancel = true;
    } catch (_error) {
      return;
    }

    const key = `${playerName}:${system.currentTick}:${message}`;
    if (chatHookCooldown.get(key) === system.currentTick) return;
    chatHookCooldown.set(key, system.currentTick);

    system.run(() => {
      world.sendMessage(`§7[§6${prefix}§7] §f${playerName}§7: §f${String(message).replace(/§/g, "")}`);
    });

    if (chatMode !== "fallback") {
      chatMode = "fallback";
      player.sendMessage("§e[Kingdoms Prefixes] Чат через перехват сообщений (fallback).");
    }
  });
}

function syncAllPrefixes() {
  const data = loadKingdomsData();
  for (const player of world.getPlayers()) {
    ensureChatApiProbe(player);
    applyPrefix(player, resolvePrefix(data, player.name));
  }
}

function applyPrefix(player, prefix) {
  const playerName = player.name;
  const previous = lastAppliedPrefix.get(playerName);
  lastAppliedPrefix.set(playerName, prefix);

  // Overhead name always (stable Entity.nameTag).
  const nameTag = prefix ? `§7[§6${prefix}§7] §f${playerName}` : playerName;
  try {
    if (player.nameTag !== nameTag) player.nameTag = nameTag;
  } catch (_error) {
    // Ignore brief nameTag write failures.
  }

  if (!prefix) {
    clearNativeChatPrefix(player);
    return;
  }

  // Chat name without § codes — more reliable for chatNamePrefix on some clients.
  const chatPrefix = `[${prefix}] `;
  if (setNativeChatPrefix(player, chatPrefix)) {
    if (chatMode !== "native") {
      chatMode = "native";
      player.sendMessage(`§a[Kingdoms Prefixes] Чат-префикс активен: ${chatPrefix}§a(проверка chatDisplayName OK)`);
    }
  }

  if (previous !== prefix) {
    player.sendMessage(`§7[Kingdoms Prefixes] Префикс: §6${prefix}§7 | чат: §f${chatMode}`);
  }
}

function setNativeChatPrefix(player, chatPrefix) {
  try {
    player.chatNamePrefix = chatPrefix;
    player.chatNameSuffix = "";
    // Optional: leave message body uncolored.
    player.chatMessagePrefix = "";

    const display = player.chatDisplayName;
    if (typeof display !== "string") return false;
    // Real API composes prefix + name (+ suffix).
    return display.startsWith(chatPrefix) && display.includes(player.name);
  } catch (_error) {
    return false;
  }
}

function clearNativeChatPrefix(player) {
  try {
    player.chatNamePrefix = "";
    player.chatNameSuffix = "";
    player.chatMessagePrefix = "";
  } catch (_error) {
    // Ignore.
  }
}

function ensureChatApiProbe(player) {
  if (apiProbeDone) return;
  apiProbeDone = true;

  const marker = "[KWTEST] ";
  try {
    const previous = player.chatNamePrefix ?? "";
    player.chatNamePrefix = marker;
    const display = player.chatDisplayName;
    const ok = typeof display === "string" && display.startsWith(marker);
    player.chatNamePrefix = typeof previous === "string" ? previous : "";

    if (ok) {
      chatMode = "native";
      console.warn("[Kingdoms Prefixes] chatNamePrefix/chatDisplayName available.");
    } else {
      chatMode = world.beforeEvents?.chatSend ? "fallback" : "none";
      console.warn(`[Kingdoms Prefixes] Native chatNamePrefix unavailable. mode=${chatMode}`);
      player.sendMessage(
        chatMode === "fallback"
          ? "§e[Kingdoms Prefixes] chatNamePrefix недоступен. Использую перехват чата. Проверьте, что Beta APIs включены."
          : "§c[Kingdoms Prefixes] Нет API для префикса в чате. В настройках мира включите Beta APIs и перезайдите."
      );
    }
  } catch (error) {
    chatMode = world.beforeEvents?.chatSend ? "fallback" : "none";
    console.warn(`[Kingdoms Prefixes] chat API probe failed: ${error}`);
    player.sendMessage("§c[Kingdoms Prefixes] Ошибка Beta chat API. Включите Beta APIs в мире.");
  }
}

function resolvePrefix(data, playerName) {
  if (!data?.settlements?.length) return undefined;

  const settlement = data.settlements.find((entry) => sameName(entry.creatorName, playerName))
    ?? data.settlements.find((entry) => Object.keys(entry.members || {}).some((name) => sameName(name, playerName)));
  if (!settlement) return undefined;

  if (sameName(settlement.creatorName, playerName)) {
    const typeIndex = typeof settlement.typeIndex === "number" ? settlement.typeIndex : 0;
    return settlement.creatorPrefix || CREATOR_PREFIXES[typeIndex] || CREATOR_PREFIXES[0];
  }

  const memberKey = Object.keys(settlement.members || {}).find((name) => sameName(name, playerName));
  return memberKey ? (settlement.members[memberKey]?.prefix || "Крестьянин") : undefined;
}

function loadKingdomsData() {
  try {
    const raw = world.getDynamicProperty(STORE_KEY);
    if (typeof raw !== "string" || !raw) return { settlements: [] };
    const data = JSON.parse(raw);
    if (!Array.isArray(data.settlements)) data.settlements = [];
    return data;
  } catch (_error) {
    return { settlements: [] };
  }
}

function notifyPlayer(player) {
  const name = player.name;
  if (noticeShown.has(name)) return;
  noticeShown.add(name);

  const prefix = resolvePrefix(loadKingdomsData(), name);
  player.sendMessage("§6[Kingdoms Prefixes] §fАддон префиксов загружен (v1.0.1 / API 2.8.0-beta.1.26.20).");
  player.sendMessage(`§7Режим чата: §f${chatMode}§7. Beta APIs должны быть включены в настройках мира.`);
  if (prefix) {
    player.sendMessage(`§7Ваш префикс сейчас: §6${prefix}`);
    if (typeof player.chatDisplayName === "string") {
      player.sendMessage(`§7chatDisplayName: §f${player.chatDisplayName}`);
    }
  } else {
    player.sendMessage("§7Создайте/улучшите поселение в Kingdoms Wars — префикс появится автоматически.");
  }
}

function sameName(first, second) {
  return String(first ?? "").toLowerCase() === String(second ?? "").toLowerCase();
}
