import { system, world } from "@minecraft/server";

/**
 * Kingdoms Prefixes Reloaded v1.2.1
 *
 * Chat method: UpRanks+ V2.5 on Bedrock 1.26.20
 *   world.beforeEvents.chatSend → cancel → system.run → world.sendMessage
 *
 * Identity bridge: player tags from Kingdoms Wars core
 *   kw_s:<settlement>   kw_r:<role>
 *
 * Display: Nick "Settlement" "Role"
 */

const PLAYER_ROLE_KEY = "kingdoms:role";
const PLAYER_SETTLEMENT_KEY = "kingdoms:settlement";
const WORLD_STORE_KEY = "kingdoms:data:v1";
const TAG_SETTLEMENT = "kw_s:";
const TAG_ROLE = "kw_r:";
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
let chatHookInstalled = false;
let chatHookError = "";

installChatHook();

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    syncNameTag(player);
  }
}, 10);

world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!player) return;
  system.run(() => {
    syncNameTag(player);
    greet(player);
  });
});

world.afterEvents.playerLeave.subscribe((event) => {
  if (event.playerName) greetShown.delete(event.playerName);
});

function installChatHook() {
  try {
    const signal = world.beforeEvents?.chatSend;
    if (!signal || typeof signal.subscribe !== "function") {
      chatHookError = "beforeEvents.chatSend отсутствует";
      return;
    }

    signal.subscribe((event) => {
      // Always cancel first — UpRanks order.
      event.cancel = true;
      const sender = event.sender;
      const message = event.message;
      system.run(() => {
        try {
          const identity = formatIdentity(sender);
          // Leading §l§6» makes it obvious this is our rewrite, not vanilla.
          world.sendMessage(`§6»§r ${identity}§r: ${message}`);
        } catch (error) {
          world.sendMessage(`§c[Kingdoms Prefixes] Ошибка чата: ${error}`);
          world.sendMessage(`§f${sender?.name ?? "?"}§r: ${message}`);
        }
      });
    });
    chatHookInstalled = true;
  } catch (error) {
    chatHookError = String(error);
    chatHookInstalled = false;
  }
}

function syncNameTag(player) {
  const next = formatIdentity(player);
  try {
    if (player.nameTag !== next) player.nameTag = next;
  } catch (_error) {
    // ignore
  }
}

function formatIdentity(player) {
  const playerName = player.name;
  const info = readIdentity(player);
  if (info.settlement && info.role) {
    return `§f${playerName} §7"§e${info.settlement}§7" §7"§6${info.role}§7"`;
  }
  return `§f${playerName}`;
}

function readIdentity(player) {
  // 1) Tags — primary (UpRanks-style bridge across packs)
  try {
    const tags = player.getTags();
    const settlementTag = tags.find((tag) => tag.startsWith(TAG_SETTLEMENT));
    const roleTag = tags.find((tag) => tag.startsWith(TAG_ROLE));
    const settlement = settlementTag ? settlementTag.slice(TAG_SETTLEMENT.length) : undefined;
    const role = roleTag ? roleTag.slice(TAG_ROLE.length) : undefined;
    if (settlement && role) return { settlement, role };
    if (settlement || role) {
      const fromStore = resolveFromWorldStore(player.name);
      return {
        settlement: settlement || fromStore.settlement,
        role: role || fromStore.role
      };
    }
  } catch (_error) {
    // fall through
  }

  // 2) Player dynamic properties from core
  let role;
  let settlement;
  try {
    const fromRole = player.getDynamicProperty(PLAYER_ROLE_KEY);
    if (typeof fromRole === "string" && fromRole.length) role = fromRole;
  } catch (_error) {
    // ignore
  }
  try {
    const fromSettlement = player.getDynamicProperty(PLAYER_SETTLEMENT_KEY);
    if (typeof fromSettlement === "string" && fromSettlement.length) settlement = fromSettlement;
  } catch (_error) {
    // ignore
  }
  if (role && settlement) return { role, settlement };

  // 3) Shared world store
  const fromStore = resolveFromWorldStore(player.name);
  return {
    role: role || fromStore.role,
    settlement: settlement || fromStore.settlement
  };
}

function resolveFromWorldStore(playerName) {
  try {
    const raw = world.getDynamicProperty(WORLD_STORE_KEY);
    if (typeof raw !== "string" || !raw) return {};
    const data = JSON.parse(raw);
    const settlements = Array.isArray(data.settlements) ? data.settlements : [];

    for (const entry of settlements) {
      if (same(entry.creatorName, playerName)) {
        const idx = typeof entry.typeIndex === "number" ? entry.typeIndex : 0;
        return {
          settlement: entry.name,
          role: entry.creatorPrefix || CREATOR_PREFIXES[idx] || CREATOR_PREFIXES[0]
        };
      }
    }

    for (const entry of settlements) {
      for (const memberName of Object.keys(entry.members || {})) {
        if (same(memberName, playerName)) {
          return {
            settlement: entry.name,
            role: entry.members[memberName]?.prefix || "Крестьянин"
          };
        }
      }
    }
  } catch (_error) {
    return {};
  }
  return {};
}

function greet(player) {
  if (greetShown.has(player.name)) return;
  greetShown.add(player.name);

  player.sendMessage("§6[Kingdoms Prefixes Reloaded] §fv1.2.1 FRESH UUID");
  if (chatHookInstalled) {
    player.sendMessage("§aПерехват чата активен (как UpRanks).");
  } else {
    player.sendMessage(`§cПерехват чата НЕ активен: ${chatHookError || "неизвестно"}`);
    player.sendMessage("§cВключите Beta APIs и убедитесь, что нет другого чат-аддона.");
  }
  player.sendMessage("§7Формат: §6»§r Ник \"поселение\" \"роль\": текст");
  player.sendMessage("§7Выключите UpRanks и другие чат-ранки.");

  const info = readIdentity(player);
  if (info.settlement && info.role) {
    player.sendMessage(`§aРоль найдена: §f${player.name} §7"§e${info.settlement}§7" §7"§6${info.role}§7"`);
  } else {
    player.sendMessage("§7Роли пока нет — создайте/улучшите поселение, подождите 2 сек.");
  }
}

function same(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}
