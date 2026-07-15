import { ItemStack, system, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROXIMITY_RADIUS,
  DIALOGUE_FORM_TITLE,
  NPC_PROFILES
} from "./config.js";

const NPC_TYPE = "quests:npc";
const PROFILE_TAG_PREFIX = "npc_profile:";
const QUEST_TAG_PREFIX = "quest:";
const BUSY_TAG = "quests_dialogue_busy";

const proximityMemory = new Map();
const dialogueLock = new Set();
const greeted = new Set();

world.afterEvents.playerSpawn.subscribe((event) => {
  if (!event.initialSpawn || !event.player) return;
  system.run(() => {
    const name = event.player.name;
    if (greeted.has(name)) return;
    greeted.add(name);
    event.player.sendMessage("§6[Quest Dialogue] §fv1.1.0 FRESH UUID");
    event.player.sendMessage("§7UI снизу + кнопка §aЗавершить§7 для сдачи квеста.");
    event.player.sendMessage("§7`/give @s quests:npc_spawner`");
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
      player.sendMessage(`§c[Quest Dialogue] Ошибка: ${error}`);
    });
  });
});

system.runInterval(() => {
  for (const player of world.getPlayers()) checkProximity(player);
}, 8);

function ensureProfileTag(entity) {
  if (!entity.getTags().some((t) => t.startsWith(PROFILE_TAG_PREFIX))) {
    entity.addTag(`${PROFILE_TAG_PREFIX}${DEFAULT_PROFILE_ID}`);
  }
}

function getProfileId(entity) {
  const tag = entity.getTags().find((t) => t.startsWith(PROFILE_TAG_PREFIX));
  return tag ? tag.slice(PROFILE_TAG_PREFIX.length) : DEFAULT_PROFILE_ID;
}

function getProfile(entity) {
  return NPC_PROFILES[getProfileId(entity)] ?? NPC_PROFILES[DEFAULT_PROFILE_ID];
}

function applyNameTag(entity) {
  const profile = getProfile(entity);
  try {
    entity.nameTag = profile?.name ?? "NPC";
  } catch (_error) {
    // ignore
  }
}

function checkProximity(player) {
  let nearby;
  try {
    nearby = player.dimension.getEntities({
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
    if (distance(player.location, npc.location) > radius) continue;

    const cooldownTicks = Math.ceil((profile.proximityCooldownSeconds ?? 12) * 20);
    const key = `${player.name}|${npc.id}`;
    const last = proximityMemory.get(key) ?? -999999;
    if (system.currentTick - last < cooldownTicks) continue;

    proximityMemory.set(key, system.currentTick);
    playVoice(player, profile.proximitySound);
  }
}

function getQuestLines(profile) {
  return (profile.lines || []).filter((line) => line.type === "quest");
}

function getActiveQuestLine(player, profile) {
  for (const line of getQuestLines(profile)) {
    const id = line.questId;
    if (!id) continue;
    if (player.hasTag(`${QUEST_TAG_PREFIX}${id}`)) return line;
  }
  return undefined;
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
    const activeQuest = getActiveQuestLine(player, profile);
    if (activeQuest) {
      await showQuestTurnIn(player, activeQuest);
      return;
    }

    for (const line of profile.lines) {
      const stillHere = await playAndShowLine(player, line);
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

async function showQuestTurnIn(player, line) {
  const need = Math.max(1, Number(line.requireCount || 1));
  const itemId = line.requireItem || "minecraft:oak_log";
  const have = countItem(player, itemId);
  const canComplete = have >= need;

  if (canComplete) {
    playVoice(player, line.readyVoice || line.voice);
    showPreview(player, line.readyText || "§fГотов сдать квест?");
    await waitSeconds(line.readyVoiceSeconds ?? line.voiceSeconds ?? 0.4);
    if (!isPlayerOk(player)) return;

    const response = await showDialogue(player, line.readyText || "§fГотов сдать квест?", [
      "§aЗавершить",
      "§7Позже"
    ]);
    if (response.canceled || response.selection !== 0) return;

    if (countItem(player, itemId) < need) {
      player.sendMessage("§cПредметов уже не хватает.");
      return;
    }

    if (!takeItem(player, itemId, need)) {
      player.sendMessage("§cНе удалось забрать предметы.");
      return;
    }

    if (line.rewardItem && line.rewardCount) {
      giveItem(player, line.rewardItem, Number(line.rewardCount));
    }

    try {
      player.removeTag(`${QUEST_TAG_PREFIX}${line.questId}`);
    } catch (_error) {
      // ignore
    }

    playVoice(player, line.completeVoice || "random.levelup");
    await waitSeconds(line.completeVoiceSeconds ?? 0.3);
    if (isPlayerOk(player)) {
      player.sendMessage(line.completeText || "§aКвест завершён!");
    }
    return;
  }

  const text = String(line.incompleteText || "§7Квест ещё не выполнен.")
    .replace("{have}", String(have))
    .replace("{need}", String(need));

  playVoice(player, line.incompleteVoice || line.voice);
  showPreview(player, text);
  await waitSeconds(line.incompleteVoiceSeconds ?? line.voiceSeconds ?? 0.4);
  if (!isPlayerOk(player)) return;

  await showDialogue(player, text, ["§eПонятно"]);
}

async function playAndShowLine(player, line) {
  playVoice(player, line.voice);
  showPreview(player, line.text || "…");
  await waitSeconds(line.voiceSeconds ?? 0.4);
  if (!isPlayerOk(player)) return false;

  const buttons =
    line.type === "quest"
      ? ["§aПринять", "§cОтклонить"]
      : ["§eДалее"];

  const response = await showDialogue(player, line.text || "…", buttons);
  if (response.canceled) return false;

  if (line.type === "quest") {
    await finishQuestChoice(player, line, response.selection === 0);
    return false;
  }

  return true;
}

async function finishQuestChoice(player, line, accepted) {
  const questId = line.questId || "quest";
  if (accepted) {
    try {
      player.addTag(`${QUEST_TAG_PREFIX}${questId}`);
    } catch (_error) {
      // ignore
    }
    playVoice(player, line.acceptVoice);
    await waitSeconds(line.acceptVoiceSeconds ?? 0.3);
    if (isPlayerOk(player)) player.sendMessage(line.acceptText || "§aКвест принят.");
  } else {
    playVoice(player, line.declineVoice);
    await waitSeconds(line.declineVoiceSeconds ?? 0.3);
    if (isPlayerOk(player)) player.sendMessage(line.declineText || "§7Квест отклонён.");
  }
}

async function showDialogue(player, body, buttons) {
  const form = new ActionFormData().title(DIALOGUE_FORM_TITLE).body(body);
  for (const label of buttons) form.button(label);
  return form.show(player);
}

function showPreview(player, text) {
  try {
    player.onScreenDisplay.setActionBar(String(text).replace(/\n/g, " "));
  } catch (_error) {
    // ignore
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
      // ignore
    }
  }
}

function getInventory(player) {
  try {
    return player.getComponent("minecraft:inventory")?.container;
  } catch (_error) {
    return undefined;
  }
}

function countItem(player, typeId) {
  const container = getInventory(player);
  if (!container) return 0;
  let total = 0;
  for (let i = 0; i < container.size; i++) {
    const stack = container.getItem(i);
    if (stack?.typeId === typeId) total += stack.amount;
  }
  return total;
}

function takeItem(player, typeId, amount) {
  const container = getInventory(player);
  if (!container) return false;
  let left = amount;
  for (let i = 0; i < container.size && left > 0; i++) {
    const stack = container.getItem(i);
    if (!stack || stack.typeId !== typeId) continue;
    if (stack.amount > left) {
      stack.amount -= left;
      container.setItem(i, stack);
      left = 0;
    } else {
      left -= stack.amount;
      container.setItem(i, undefined);
    }
  }
  return left === 0;
}

function giveItem(player, typeId, amount) {
  const container = getInventory(player);
  try {
    const stack = new ItemStack(typeId, amount);
    if (container) {
      const leftover = container.addItem(stack);
      if (leftover) player.dimension.spawnItem(leftover, player.location);
    } else {
      player.dimension.spawnItem(stack, player.location);
    }
  } catch (_error) {
    player.sendMessage(`§cНе удалось выдать награду: ${typeId}`);
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
  const value = Number(seconds);
  if (!value || value <= 0) {
    return new Promise((resolve) => system.run(resolve));
  }
  const ticks = Math.max(1, Math.ceil(value * 20));
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
