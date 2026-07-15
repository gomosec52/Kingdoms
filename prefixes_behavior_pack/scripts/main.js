import { system, world } from "@minecraft/server";

/**
 * Kingdoms Prefixes v1.0.2
 *
 * Strategy (chosen because chatNamePrefix alone did not change <Nick> chat on 1.26):
 * 1) Rewrite chat: cancel chatSend + world.sendMessage with [Role] Nick: text
 * 2) Also set chatNamePrefix when chatDisplayName proves it is real
 * 3) Also set nameTag (backup; Kingdoms Wars core also sets nameTag)
 */

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
const lastToldPrefix = new Map();
const chatDedup = new Map();

let chatSendBound = false;
let nativeChatOk = false;

bindChatRewrite();
system.runInterval(() => syncPlayers(), 10);

world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!player) return;
  system.run(() => {
    syncPlayers();
    greet(player);
  });
});

world.afterEvents.playerLeave.subscribe((event) => {
  if (!event.playerName) return;
  noticeShown.delete(event.playerName);
  lastToldPrefix.delete(event.playerName);
});

function bindChatRewrite() {
  const before = world.beforeEvents?.chatSend;
  const after = world.afterEvents?.chatSend;

  if (before?.subscribe) {
    before.subscribe((event) => {
      const player = event.sender;
      const playerName = player?.name;
      const message = event.message;
      if (!playerName || typeof message !== "string") return;

      const prefix = resolvePrefix(loadData(), playerName);
      if (!prefix) return;

      try {
        event.cancel = true;
      } catch (_error) {
        // Continue — we still broadcast a prefixed line below.
      }

      broadcastPrefixed(playerName, prefix, message);
    });
    chatSendBound = true;
    console.warn("[Kingdoms Prefixes] beforeEvents.chatSend bound.");
  }

  if (after?.subscribe) {
    after.subscribe((event) => {
      const player = event.sender;
      const playerName = player?.name;
      const message = event.message;
      if (!playerName || typeof message !== "string") return;

      const prefix = resolvePrefix(loadData(), playerName);
      if (!prefix) return;

      // If before-cancel failed, this still prints a role line after vanilla chat.
      broadcastPrefixed(playerName, prefix, message);
    });
    chatSendBound = true;
    console.warn("[Kingdoms Prefixes] afterEvents.chatSend bound.");
  }

  if (!chatSendBound) {
    console.warn("[Kingdoms Prefixes] chatSend events недоступны.");
  }
}

function broadcastPrefixed(playerName, prefix, message) {
  const dedupKey = `${playerName}|${system.currentTick}|${message}`;
  if (chatDedup.has(dedupKey)) return;
  chatDedup.set(dedupKey, true);
  system.runTimeout(() => chatDedup.delete(dedupKey), 2);

  const clean = String(message).replace(/§/g, "");
  system.run(() => {
    world.sendMessage(`§7[§6${prefix}§7] §f${playerName}§7: §f${clean}`);
  });
}

function syncPlayers() {
  const data = loadData();
  for (const player of world.getPlayers()) {
    const prefix = resolvePrefix(data, player.name);
    applyNameTag(player, prefix);
    applyNativeChatPrefix(player, prefix);
    maybeAnnounceRole(player, prefix);
  }
}

function applyNameTag(player, prefix) {
  const next = prefix ? `§7[§6${prefix}§7] §f${player.name}` : player.name;
  try {
    if (player.nameTag !== next) player.nameTag = next;
  } catch (_error) {
    // ignore
  }
}

function applyNativeChatPrefix(player, prefix) {
  const bare = prefix ? `[${prefix}] ` : "";
  try {
    player.chatNamePrefix = bare;
    player.chatNameSuffix = "";
    player.chatMessagePrefix = "";
    if (!prefix) return;

    const display = player.chatDisplayName;
    nativeChatOk = typeof display === "string" && display.startsWith(bare) && display.includes(player.name);
  } catch (_error) {
    nativeChatOk = false;
  }
}

function maybeAnnounceRole(player, prefix) {
  const prev = lastToldPrefix.get(player.name);
  if (prev === prefix) return;
  lastToldPrefix.set(player.name, prefix);
  if (!prefix) return;
  player.sendMessage(`§a[Kingdoms Prefixes] Роль: §6${prefix}`);
}

function greet(player) {
  if (noticeShown.has(player.name)) return;
  noticeShown.add(player.name);

  const prefix = resolvePrefix(loadData(), player.name);
  player.sendMessage("§6[Kingdoms Prefixes] §fv1.0.2 загружен.");
  player.sendMessage(
    chatSendBound
      ? "§aЧат: перехват chatSend включён (сообщения будут с [Роль])."
      : "§cЧат: chatSend недоступен. Включите Beta APIs и пересоздайте/перезайдите в мир."
  );
  if (nativeChatOk) player.sendMessage("§aТакже доступен native chatNamePrefix.");
  if (prefix) player.sendMessage(`§7Сейчас ваш префикс: §6${prefix}`);
  else player.sendMessage("§7Нет роли — создайте поселение в Kingdoms Wars.");
}

function resolvePrefix(data, playerName) {
  const settlements = data?.settlements;
  if (!Array.isArray(settlements) || !settlements.length) return undefined;

  const own = settlements.find((s) => same(s.creatorName, playerName));
  if (own) {
    const idx = typeof own.typeIndex === "number" ? own.typeIndex : 0;
    return own.creatorPrefix || CREATOR_PREFIXES[idx] || CREATOR_PREFIXES[0];
  }

  for (const settlement of settlements) {
    for (const memberName of Object.keys(settlement.members || {})) {
      if (!same(memberName, playerName)) continue;
      return settlement.members[memberName]?.prefix || "Крестьянин";
    }
  }
  return undefined;
}

function loadData() {
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

function same(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}
