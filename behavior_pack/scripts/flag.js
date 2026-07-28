import { system, world } from "@minecraft/server";
import { FLAG_ENTITY, FLAG_ITEM, FLAG_ITEM_USE_COMPONENT } from "./constants.js";

const recentPlacementKeys = new Set();
/** @type {Map<string, number>} */
const recentFlagUseTicks = new Map();

/** @type {((player: import("@minecraft/server").Player, block: import("@minecraft/server").Block, blockFace: import("@minecraft/server").Direction, origin: string) => void) | null} */
let onFlagUseOn = null;

/** @type {((entity: import("@minecraft/server").Entity, player?: import("@minecraft/server").Player) => void | Promise<void>) | null} */
let onWildFlagSpawn = null;

function placementKey(player, block) {
  const location = block.location;
  return `${player.name}:${Math.floor(location.x)}:${Math.floor(location.y)}:${Math.floor(location.z)}:${system.currentTick}`;
}

function rememberFlagUse(player) {
  if (!player?.id) return;
  recentFlagUseTicks.set(player.id, system.currentTick);
}

export function findRecentFlagPlacer(maxAgeTicks = 60) {
  const now = system.currentTick;
  let bestPlayer;
  let bestAge = maxAgeTicks + 1;

  for (const player of world.getPlayers()) {
    const usedTick = recentFlagUseTicks.get(player.id);
    if (typeof usedTick !== "number") continue;
    const age = now - usedTick;
    if (age >= 0 && age <= maxAgeTicks && age < bestAge) {
      bestPlayer = player;
      bestAge = age;
    }
  }

  return bestPlayer;
}

export function queueFlagPlacement(player, block, blockFace, origin = "script") {
  if (!player || !block || typeof onFlagUseOn !== "function") return;

  rememberFlagUse(player);

  const key = placementKey(player, block);
  if (recentPlacementKeys.has(key)) return;
  recentPlacementKeys.add(key);
  system.runTimeout(() => recentPlacementKeys.delete(key), 2);

  system.run(() => {
    try {
      onFlagUseOn(player, block, blockFace, origin);
    } catch (error) {
      player.sendMessage(`§c[Королевства] Ошибка установки флага: ${error?.message ?? error}`);
    }
  });
}

function resolvePlayer(event) {
  return event.source ?? event.player;
}

function resolveBlock(event) {
  if (event.block) return event.block;

  const source = resolvePlayer(event);
  const permutation = event.usedOnBlockPermutation;
  const faceLocation = event.faceLocation;
  if (!source?.dimension || !permutation || !faceLocation) return undefined;

  try {
    return source.dimension.getBlock(faceLocation);
  } catch (_error) {
    return undefined;
  }
}

/** @type {import("@minecraft/server").ItemCustomComponent} */
const flagPlacerComponent = {
  onUseOn(event) {
    const player = event.source;
    if (event.itemStack?.typeId !== FLAG_ITEM) return;
    if (player?.typeId !== "minecraft:player") return;

    const block = resolveBlock(event);
    if (!block) return;

    queueFlagPlacement(player, block, event.blockFace, "component");
  }
};

let registered = false;

export function setFlagPlacementHandler(handler) {
  onFlagUseOn = handler;
}

export function setWildFlagSpawnHandler(handler) {
  onWildFlagSpawn = handler;
}

export function registerFlagComponent(registry) {
  if (registered || !registry?.registerCustomComponent) return;
  registry.registerCustomComponent(FLAG_ITEM_USE_COMPONENT, flagPlacerComponent);
  registered = true;
}

function bindUseOnHandler(event, origin) {
  if (event.itemStack?.typeId !== FLAG_ITEM) return;

  const player = resolvePlayer(event);
  if (player?.typeId !== "minecraft:player") return;

  rememberFlagUse(player);

  const block = resolveBlock(event);
  if (!block) return;

  queueFlagPlacement(player, block, event.blockFace ?? event.face, origin);
}

function invokeWildFlagSpawn(entity) {
  if (typeof onWildFlagSpawn !== "function") return;
  Promise.resolve(onWildFlagSpawn(entity)).catch((error) => {
    console.warn(`[Kingdoms] Ошибка обработки флага-сущности: ${error?.message ?? error}`);
  });
}

export function bindFlagPlacementEvents(worldRef) {
  worldRef.afterEvents?.itemUse?.subscribe((event) => {
    if (event.itemStack?.typeId !== FLAG_ITEM) return;
    const player = event.source;
    if (player?.typeId !== "minecraft:player") return;
    rememberFlagUse(player);
  });

  worldRef.afterEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event, "afterUseOn"));
  worldRef.beforeEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event, "beforeUseOn"));
}

export function bindFlagEntitySpawn(worldRef) {
  worldRef.afterEvents?.entitySpawn?.subscribe((event) => {
    if (event.entity?.typeId !== FLAG_ENTITY) return;

    system.run(() => invokeWildFlagSpawn(event.entity));
    system.runTimeout(() => {
      if (event.entity?.isValid) invokeWildFlagSpawn(event.entity);
    }, 5);
  });
}

export function bindFlagSystem(worldRef) {
  system.beforeEvents.startup.subscribe((event) => {
    registerFlagComponent(event.itemComponentRegistry);
  });

  worldRef.beforeEvents?.worldInitialize?.subscribe((event) => {
    registerFlagComponent(event.itemComponentRegistry);
  });

  bindFlagPlacementEvents(worldRef);
  bindFlagEntitySpawn(worldRef);

  system.run(() => {
    console.warn("[Kingdoms] KW Build flag system ready");
  });
}
