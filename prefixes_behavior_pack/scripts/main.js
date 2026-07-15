import { system, world } from "@minecraft/server";

/**
 * Kingdoms Prefixes v1.1.0
 *
 * Chat method copied from UpRanks+ V2.5 (works on Bedrock 1.26.20):
 *   world.beforeEvents.chatSend → cancel → system.run → world.sendMessage
 *
 * Display format (chat + nameTag):
 *   Nick "SettlementName" "Role"
 */

const PLAYER_ROLE_KEY = "kingdoms:role";
const PLAYER_SETTLEMENT_KEY = "kingdoms:settlement";
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

// Same pipeline as UpRanks+ V2.5 — proven on this client's 1.26.20 chat.
world.beforeEvents.chatSend.subscribe((event) => {
  const sender = event.sender;
  const message = event.message;
  event.cancel = true;

  system.run(() => {
    const identity = formatIdentity(sender);
    world.sendMessage(`${identity}§r: ${message}`);
  });
});

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

  player.sendMessage("§6[Kingdoms Prefixes] §fv1.1.0");
  player.sendMessage("§7Чат как у UpRanks: перехват chatSend + sendMessage.");
  player.sendMessage("§7Формат: §fНик §7\"§eпоселение§7\" \"§6роль§7\"");
  player.sendMessage("§7Выключите другие чат-ранк аддоны (UpRanks и т.п.), чтобы не конфликтовали.");
}

function same(a, b) {
  return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
}
