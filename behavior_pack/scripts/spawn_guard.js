import { ModalFormData } from "@minecraft/server-ui";
import { DEFAULT_SPAWN_GUARD_RADIUS, MAX_SPAWN_GUARD_RADIUS } from "./economy.js";

export const SPAWN_GUARD_BLOCK = "kingdoms:spawn_guard";

/** @type {object | undefined} */
let deps;

export function bindSpawnGuardSystem(dependencies) {
  deps = dependencies;

  deps.world.afterEvents.playerInteractWithBlock?.subscribe((event) => {
    if (event.block.typeId !== SPAWN_GUARD_BLOCK) return;
    if (!event.player?.isValid) return;
    deps.system.run(() => handleSpawnGuardInteract(event.player, event.block));
  });

  deps.world.afterEvents.playerPlaceBlock?.subscribe((event) => {
    if (event.block.typeId !== SPAWN_GUARD_BLOCK) return;
    registerSpawnGuard(event.player, event.block);
  });

  deps.world.beforeEvents.playerBreakBlock?.subscribe((event) => {
    if (event.block.typeId !== SPAWN_GUARD_BLOCK) return;
    handleSpawnGuardBreak(event.player, event.block, event);
  });
}

function ensureSpawnGuards(data) {
  if (!Array.isArray(data.spawnGuards)) data.spawnGuards = [];
}

export function findSpawnGuardRecord(data, location, dimensionId) {
  ensureSpawnGuards(data);
  const x = Math.floor(location.x);
  const y = Math.floor(location.y);
  const z = Math.floor(location.z);
  return data.spawnGuards.find((entry) =>
    entry.dimensionId === dimensionId
    && entry.location.x === x
    && entry.location.y === y
    && entry.location.z === z);
}

export function findSpawnProtectionAt(data, location, dimensionId) {
  ensureSpawnGuards(data);
  let best;
  let bestDist = Infinity;
  for (const guard of data.spawnGuards) {
    if (guard.dimensionId !== dimensionId) continue;
    const dist = deps.distance2D(location, guard.location);
    if (dist <= guard.radius && dist < bestDist) {
      best = guard;
      bestDist = dist;
    }
  }
  return best;
}

export function isInSpawnProtection(data, location, dimensionId) {
  return Boolean(findSpawnProtectionAt(data, location, dimensionId));
}

function registerSpawnGuard(player, block) {
  const data = deps.loadData();
  ensureSpawnGuards(data);
  const dimensionId = deps.getDimensionId(block.dimension);
  const location = deps.blockPosition(block.location);
  const existing = findSpawnGuardRecord(data, location, dimensionId);
  if (existing) return;

  data.spawnGuards.push({
    id: deps.nextSpawnGuardId(data),
    dimensionId,
    location,
    radius: DEFAULT_SPAWN_GUARD_RADIUS,
    ownerName: deps.getPlayerName(player),
    blockPvp: true,
    blockBreak: true,
    blockPlace: true,
    blockSettlements: true,
    blockInteract: true
  });
  deps.saveData(data);
  player.sendMessage(`§aЯдро защиты спавна установлено. Радиус: ${DEFAULT_SPAWN_GUARD_RADIUS}. Кликните по блоку для настройки.`);
}

function handleSpawnGuardBreak(player, block, event) {
  const data = deps.loadData();
  const record = findSpawnGuardRecord(data, block.location, deps.getDimensionId(block.dimension));
  if (!record) return;

  const playerName = deps.getPlayerName(player);
  if (!deps.samePlayerName(record.ownerName, playerName) && !player.hasTag("kingdoms_admin")) {
    event.cancel = true;
    player.sendMessage("§cЭто ядро защиты спавна может сломать только установивший его игрок.");
    return;
  }

  data.spawnGuards = data.spawnGuards.filter((entry) => entry.id !== record.id);
  deps.saveData(data);
  player.sendMessage("§eЯдро защиты спавна удалено.");
}

async function handleSpawnGuardInteract(player, block) {
  if (!player?.isValid || !block) return;

  let data = deps.loadData();
  let record = findSpawnGuardRecord(data, block.location, deps.getDimensionId(block.dimension));
  if (!record) {
    registerSpawnGuard(player, block);
    data = deps.loadData();
    record = findSpawnGuardRecord(data, block.location, deps.getDimensionId(block.dimension));
  }
  if (!record) {
    player.sendMessage("§cНе удалось зарегистрировать ядро. Поставьте блок заново.");
    return;
  }

  const playerName = deps.getPlayerName(player);
  if (!deps.samePlayerName(record.ownerName, playerName) && !player.hasTag("kingdoms_admin")) {
    player.sendMessage("§cНастраивать ядро может только установивший его игрок.");
    return;
  }

  const form = new ModalFormData()
      .title("Защита спавна")
      .slider(`Радиус защиты (${record.radius})`, 10, MAX_SPAWN_GUARD_RADIUS, {
        valueStep: 5,
        defaultValue: record.radius
      })
      .toggle("Запрет PvP", { defaultValue: record.blockPvp !== false })
      .toggle("Запрет ломать блоки", { defaultValue: record.blockBreak !== false })
      .toggle("Запрет ставить блоки", { defaultValue: record.blockPlace !== false })
      .toggle("Запрет основания поселений", { defaultValue: record.blockSettlements !== false })
      .toggle("Запрет взаимодействий", { defaultValue: record.blockInteract !== false });

    const response = await deps.showForm(player, form);
    if (response.canceled) return;

    const freshData = deps.loadData();
    const freshRecord = findSpawnGuardRecord(freshData, block.location, deps.getDimensionId(block.dimension));
    if (!freshRecord) return;
    if (!deps.samePlayerName(freshRecord.ownerName, playerName) && !player.hasTag("kingdoms_admin")) return;

    freshRecord.radius = Math.max(10, Math.min(MAX_SPAWN_GUARD_RADIUS, Math.round(Number(response.formValues?.[0] ?? freshRecord.radius))));
    freshRecord.blockPvp = Boolean(response.formValues?.[1]);
    freshRecord.blockBreak = Boolean(response.formValues?.[2]);
    freshRecord.blockPlace = Boolean(response.formValues?.[3]);
    freshRecord.blockSettlements = Boolean(response.formValues?.[4]);
    freshRecord.blockInteract = Boolean(response.formValues?.[5]);
    deps.saveData(freshData);
    player.sendMessage(`§aРадиус защиты спавна: §f${freshRecord.radius}§a блоков.`);
}

export function shouldBlockSpawnBreak(data, player, location, dimensionId) {
  const guard = findSpawnProtectionAt(data, location, dimensionId);
  if (!guard || guard.blockBreak === false) return false;
  if (player.hasTag("kingdoms_admin")) return false;
  return true;
}

export function shouldBlockSpawnPlace(data, player, location, dimensionId) {
  const guard = findSpawnProtectionAt(data, location, dimensionId);
  if (!guard || guard.blockPlace === false) return false;
  if (player.hasTag("kingdoms_admin")) return false;
  return true;
}

export function shouldBlockSpawnPvp(data, player, location, dimensionId) {
  if (player?.hasTag?.("kingdoms_admin")) return false;
  const guard = findSpawnProtectionAt(data, location, dimensionId);
  if (!guard || guard.blockPvp === false) return false;
  return true;
}

export function shouldBlockSpawnSettlement(data, location, dimensionId) {
  const guard = findSpawnProtectionAt(data, location, dimensionId);
  if (!guard || guard.blockSettlements === false) return false;
  return true;
}

export function wouldSettlementRadiusOverlapSpawnGuard(data, center, dimensionId, radius) {
  ensureSpawnGuards(data);
  for (const guard of data.spawnGuards) {
    if (guard.dimensionId !== dimensionId) continue;
    if (deps.distance2D(center, guard.location) < guard.radius + radius) return guard;
  }
  return undefined;
}

export function shouldBlockSpawnInteract(data, player, location, dimensionId) {
  const guard = findSpawnProtectionAt(data, location, dimensionId);
  if (!guard || guard.blockInteract === false) return false;
  if (player.hasTag("kingdoms_admin")) return false;
  return true;
}
