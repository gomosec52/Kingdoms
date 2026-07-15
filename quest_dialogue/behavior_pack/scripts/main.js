import { system, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROXIMITY_RADIUS,
  DIALOGUE_FORM_TITLE,
  NPC_PROFILES
} from "./config.js";

const NPC_TYPE = "quests:npc";
const PROFILE_TAG_PREFIX = "npc_profile:";
const BUSY_TAG = "quests_dialogue_busy";

/** playerName -> last proximity tick per npc id */
const proximityMemory = new Map();
/** playerName currently in dialogue */
const dialogueLock = new Set();

const greeted = new Set();

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn || !event.player) return;
  system.run(() => {
    const name = event.player.name;
    if (greeted.has(name)) return;
    greeted.add(name);
    event.player.sendMessage("§6[Quest Dialogue] §fv1.0.0 FRESH UUID");
    event.player.sendMessage("§7Предмет: §fПоставить NPC квестов");
    event.player.sendMessage("§7Профили правятся в §fscripts/config.js");
  });
});

world.afterEvents.entitySpawn.subscribe((event) => {
  const entity = event.entity;
  if (!entity || entity.typeId !== NPC_TYPE) return;
  system.run(() => {
    ensureProfileTag(entity);
    applyNameTag(entity);
  });
});

world.afterEvents.playerInteractWithEntity.subscribe((event) => {
  const player = event.player;
  const entity = event.target;
  if (!player || !entity || entity.typeId !== NPC_TYPE) return;
  if (dialogueLock.has(player.name)) return;

  system.run(() => {
    startDialogue(player, entity).catch((error) => {
      dialogueLock.delete(player.name);
      player.sendMessage(`§c[Quest Dialogue] Ошибка диалога: ${error}`);
    });
  });
});

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    checkProximity(player);
  }
}, 8);

function ensureProfileTag(entity) {
  const tags = entity.getTags();
  const hasProfile = tags.some((tag) => tag.startsWith(PROFILE_TAG_PREFIX));
  if (!hasProfile) {
    entity.addTag(`${PROFILE_TAG_PREFIX}${DEFAULT_PROFILE_ID}`);
  }
}

function getProfileId(entity) {
  const tag = entity.getTags().find((t) => t.startsWith(PROFILE_TAG_PREFIX));
  if (!tag) return DEFAULT_PROFILE_ID;
  return tag.slice(PROFILE_TAG_PREFIX.length);
}

function getProfile(entity) {
  const id = getProfileId(entity);
  return NPC_PROFILES[id] ?? NPC_PROFILES[DEFAULT_PROFILE_ID];
}

function applyNameTag(entity) {
  const profile = getProfile(entity);
  if (!profile) return;
  try {
    entity.nameTag = profile.name ?? "NPC";
  } catch (_error) {
    // ignore
  }
}

function checkProximity(player) {
  const dimension = player.dimension;
  let nearby;
  try {
    nearby = dimension.getEntities({
      type: NPC_TYPE,
      location: player.location,
      maxDistance: 24
    });
  } catch (_error) {
    return;
  }

  for (const npc of nearby) {
    const profile = getProfile(npc);
    const radius = profile?.proximityRadius ?? DEFAULT_PROXIMITY_RADIUS;
    const dist = distance(player.location, npc.location);
    if (dist > radius) continue;

    const cooldownTicks = Math.ceil((profile.proximityCooldownSeconds ?? 12) * 20);
    const key = `${player.name}|${npc.id}`;
    const last = proximityMemory.get(key) ?? -999999;
    if (system.currentTick - last < cooldownTicks) continue;

    proximityMemory.set(key, system.currentTick);
    playVoice(player, profile.proximitySound);
  }
}

async function startDialogue(player, npc) {
  const profile = getProfile(npc);
  if (!profile?.lines?.length) {
    player.sendMessage("§cУ этого NPC нет реплик в config.js");
    return;
  }

  dialogueLock.add(player.name);
  try {
    npc.addTag(BUSY_TAG);
  } catch (_error) {
    // ignore
  }

  try {
    for (let index = 0; index < profile.lines.length; index++) {
      const line = profile.lines[index];
      const stillHere = await playAndShowLine(player, npc, profile, line);
      if (!stillHere) break;
    }
  } finally {
    dialogueLock.delete(player.name);
    try {
      npc.removeTag(BUSY_TAG);
    } catch (_error) {
      // ignore
    }
  }
}

async function playAndShowLine(player, npc, profile, line) {
  // 1) Озвучка сначала — кнопки только после окончания voiceSeconds
  playVoice(player, line.voice);
  await waitSeconds(line.voiceSeconds ?? 2);

  if (!isPlayerOk(player)) return false;

  // 2) Форма с текстом и кнопками
  const form = new ActionFormData()
    .title(DIALOGUE_FORM_TITLE)
    .body(line.text || "…");

  if (line.type === "quest") {
    form.button("§aПринять");
    form.button("§cОтклонить");
  } else {
    form.button("§eДалее");
  }

  const response = await form.show(player);
  if (response.canceled) return false;

  if (line.type === "quest") {
    if (response.selection === 0) {
      await finishQuestChoice(player, line, true);
    } else {
      await finishQuestChoice(player, line, false);
    }
    return false;
  }

  return true;
}

async function finishQuestChoice(player, line, accepted) {
  const questId = line.questId || "quest";
  if (accepted) {
    try {
      player.addTag(`quest:${questId}`);
    } catch (_error) {
      // ignore
    }
    playVoice(player, line.acceptVoice);
    await waitSeconds(line.acceptVoiceSeconds ?? 1.5);
    if (isPlayerOk(player)) {
      player.sendMessage(line.acceptText || "§aКвест принят.");
    }
  } else {
    playVoice(player, line.declineVoice);
    await waitSeconds(line.declineVoiceSeconds ?? 1.5);
    if (isPlayerOk(player)) {
      player.sendMessage(line.declineText || "§7Квест отклонён.");
    }
  }
}

function playVoice(player, soundId) {
  if (!soundId || !isPlayerOk(player)) return;
  try {
    player.playSound(soundId);
  } catch (_error) {
    try {
      player.dimension.playSound(soundId, player.location);
    } catch (_error2) {
      // Missing custom sound until user adds .ogg files.
    }
  }
}

function isPlayerOk(player) {
  try {
    return Boolean(player && player.name);
  } catch (_error) {
    return false;
  }
}

function waitSeconds(seconds) {
  const ticks = Math.max(1, Math.ceil(Number(seconds || 0) * 20));
  return new Promise((resolve) => {
    system.runTimeout(resolve, ticks);
  });
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
