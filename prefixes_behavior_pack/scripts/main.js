import { system, world } from "@minecraft/server";

/**
 * Kingdoms Prefixes v1.0.3
 *
 * Why this approach:
 * - On Bedrock 1.26 the new chat UI (<Nick> text) often never fires chatSend.
 * - Mojang's intended fix is Player.chatNamePrefix (Beta APIs).
 * - Role is read from the player dynamic property written by Kingdoms Wars core.
 */

const PLAYER_ROLE_KEY = "kingdoms:role";
const WORLD_STORE_KEY = "kingdoms:data:v1";
const CREATOR_PREFIXES = [
  "Староста",
  "Войт",
  "Посадник",
  "Бургомистр",
  "Кастелян",
  "Король",
  "Император"
];

const greetShown = new Set();
const lastStatus = new Map();

let nativeChatAvailable = false;
let nativeChatChecked = false;

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    syncPlayer(player);
  }
}, 5);

world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!player) return;
  system.run(() => {
    syncPlayer(player);
    greet(player);
  });
});

world.afterEvents.playerLeave.subscribe((event) => {
  if (event.playerName) {
    greetShown.delete(event.playerName);
    lastStatus.delete(event.playerName);
  }
});

function syncPlayer(player) {
  const role = readRole(player);
  applyNameTag(player, role);
  const nativeOk = applyChatNamePrefix(player, role);
  reportStatus(player, role, nativeOk);
}

function readRole(player) {
  // 1) Fast bridge from Kingdoms Wars core
  try {
    const fromPlayer = player.getDynamicProperty(PLAYER_ROLE_KEY);
    if (typeof fromPlayer === "string" && fromPlayer.length) return fromPlayer;
  } catch (_error) {
    // ignore
  }

  // 2) Fallback: parse world settlement store
  return resolveFromWorldStore(player.name);
}

function resolveFromWorldStore(playerName) {
  try {
    const raw = world.getDynamicProperty(WORLD_STORE_KEY);
    if (typeof raw !== "string" || !raw) return undefined;
    const data = JSON.parse(raw);
    const settlements = Array.isArray(data.settlements) ? data.settlements : [];

    for (const settlement of settlements) {
      if (same(settlement.creatorName, playerName)) {
        const idx = typeof settlement.typeIndex === "number" ? settlement.typeIndex : 0;
        return settlement.creatorPrefix || CREATOR_PREFIXES[idx] || CREATOR_PREFIXES[0];
      }
    }

    for (const settlement of settlements) {
      for (const memberName of Object.keys(settlement.members || {})) {
        if (same(memberName, playerName)) {
          return settlement.members[memberName]?.prefix || "Крестьянин";
        }
      }
    }
  } catch (_error) {
    return undefined;
  }
  return undefined;
}

function applyNameTag(player, role) {
  const next = role ? `§7[§6${role}§7] §f${player.name}` : player.name;
  try {
    if (player.nameTag !== next) player.nameTag = next;
  } catch (_error) {
    // ignore
  }
}

function applyChatNamePrefix(player, role) {
  // Plain ASCII brackets — no § codes (more reliable for chatNamePrefix).
  const want = role ? `[${role}] ` : "";

  try {
    if ((player.chatNamePrefix ?? "") !== want) {
      player.chatNamePrefix = want;
    }
    player.chatNameSuffix = "";
    player.chatMessagePrefix = "";

    const display = player.chatDisplayName;
    if (!nativeChatChecked) {
      nativeChatChecked = true;
      nativeChatAvailable = typeof display === "string";
    }

    if (!role) return nativeChatAvailable;
    return typeof display === "string" && display.startsWith(want) && display.includes(player.name);
  } catch (_error) {
    if (!nativeChatChecked) {
      nativeChatChecked = true;
      nativeChatAvailable = false;
    }
    return false;
  }
}

function reportStatus(player, role, nativeOk) {
  const key = `${role || ""}|${nativeOk ? 1 : 0}|${nativeChatAvailable ? 1 : 0}`;
  if (lastStatus.get(player.name) === key) return;
  lastStatus.set(player.name, key);

  if (!role) {
    player.sendMessage("§7[Kingdoms Prefixes] Роли пока нет (создайте поселение).");
    return;
  }

  let display = "?";
  try {
    display = String(player.chatDisplayName ?? "нет chatDisplayName");
  } catch (_error) {
    display = "ошибка чтения chatDisplayName";
  }

  if (nativeOk) {
    player.sendMessage(`§a[Kingdoms Prefixes] Чат-префикс установлен: §f${display}`);
    player.sendMessage("§7Напишите в чат — имя должно быть с [ролью].");
  } else {
    player.sendMessage(`§c[Kingdoms Prefixes] Роль есть (§6${role}§c), но chatNamePrefix НЕ работает.`);
    player.sendMessage("§cВ настройках мира включите Beta APIs, сохраните мир и зайдите снова.");
    player.sendMessage(`§7Диагностика: chatDisplayName=§f${display}`);
  }
}

function greet(player) {
  if (greetShown.has(player.name)) return;
  greetShown.add(player.name);

  player.sendMessage("§6[Kingdoms Prefixes] §fv1.0.3");
  player.sendMessage("§7Режим: официальный chatNamePrefix (новый чат Bedrock 1.26).");
  player.sendMessage("§7Перехват chatSend на этом чате не используется — он не срабатывает.");
}

function same(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}
