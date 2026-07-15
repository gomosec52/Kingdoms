import { system } from "@minecraft/server";
import { FLAG_ENTITY, FLAG_ITEM, FLAG_ITEM_USE_COMPONENT } from "./constants.js";

const recentPlacementKeys = new Set();

/** @type {((player: import("@minecraft/server").Player, block: import("@minecraft/server").Block, blockFace: import("@minecraft/server").Direction, origin: string) => void) | null} */
let onFlagUseOn = null;

/** @type {((entity: import("@minecraft/server").Entity, player?: import("@minecraft/server").Player) => void) | null} */
let onWildFlagSpawn = null;

let componentRegistered = false;

function placementKey(player, block) {
  const location = block.location;
  return `${player.name}:${Math.floor(location.x)}:${Math.floor(location.y)}:${Math.floor(location.z)}:${system.currentTick}`;
}

export function queueFlagPlacement(player, block, blockFace, origin = "script") {
  if (!player || !block || typeof onFlagUseOn !== "function") return;

  const key = placementKey(player, block);
  if (recentPlacementKeys.has(key)) return;
  recentPlacementKeys.add(key);
  system.runTimeout(() => recentPlacementKeys.delete(key), 2);

  system.run(() => {
    try {
      onFlagUseOn(player, block, blockFace, origin);
    } catch (error) {
      player.sendMessage(`§c[Королевства] Ошибка установки флага: ${error}`);
    }
  });
}

function resolvePlayer(event) {
  return event.source ?? event.player;
}

function resolveBlock(event) {
  // Prefer the absolute block reference. faceLocation is relative to the block corner and must not be passed to getBlock().
  if (event.block) return event.block;
  return undefined;
}

function resolveBlockFace(event) {
  return event.blockFace ?? event.face ?? "Up";
}

function resolveHeldFlag(event, player) {
  if (event.itemStack?.typeId === FLAG_ITEM) return event.itemStack;

  try {
    const equippable = player?.getComponent?.("minecraft:equippable") ?? player?.getComponent?.("equippable");
    const mainhand = equippable?.getEquipment?.("Mainhand");
    if (mainhand?.typeId === FLAG_ITEM) return mainhand;
  } catch (_error) {
    // Ignore equipment lookup failures.
  }

  try {
    const inventory = player?.getComponent?.("minecraft:inventory")?.container ?? player?.getComponent?.("inventory")?.container;
    const selected = inventory?.getItem?.(player.selectedSlotIndex ?? 0);
    if (selected?.typeId === FLAG_ITEM) return selected;
  } catch (_error) {
    // Ignore inventory lookup failures.
  }

  return undefined;
}

/** @type {import("@minecraft/server").ItemCustomComponent} */
const flagPlacerComponent = {
  onUseOn(event) {
    const player = event.source;
    if (player?.typeId !== "minecraft:player") return;
    if (event.itemStack && event.itemStack.typeId !== FLAG_ITEM) return;

    const block = resolveBlock(event);
    if (!block) {
      player?.sendMessage?.("§c[Королевства] Не удалось определить блок для флага.");
      return;
    }

    queueFlagPlacement(player, block, resolveBlockFace(event), "component");
  }
};

export function setFlagPlacementHandler(handler) {
  onFlagUseOn = handler;
}

export function setWildFlagSpawnHandler(handler) {
  onWildFlagSpawn = handler;
}

export function registerFlagComponent(registry) {
  if (componentRegistered || !registry?.registerCustomComponent) return false;

  try {
    registry.registerCustomComponent(FLAG_ITEM_USE_COMPONENT, flagPlacerComponent);
    componentRegistered = true;
    return true;
  } catch (error) {
    console.warn(`[Kingdoms] Не удалось зарегистрировать компонент флага: ${error}`);
    return false;
  }
}

export function isFlagComponentRegistered() {
  return componentRegistered;
}

function bindUseOnHandler(event, origin) {
  const player = resolvePlayer(event);
  if (player?.typeId !== "minecraft:player") return;
  if (!resolveHeldFlag(event, player)) return;

  const block = resolveBlock(event);
  if (!block) return;

  queueFlagPlacement(player, block, resolveBlockFace(event), origin);
}

export function bindFlagPlacementEvents(world) {
  // Available on older Script API builds; missing on 2.0/beta.
  world.afterEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event, "afterUseOn"));
  world.beforeEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event, "beforeUseOn"));

  // Reliable fallback on 1.26 / beta when itemUseOn is gone.
  world.afterEvents?.playerInteractWithBlock?.subscribe((event) => {
    const player = event.player;
    if (!player || player.typeId !== "minecraft:player") return;
    if (!resolveHeldFlag(event, player)) return;
    if (!event.block) return;

    // Avoid stealing protected-block interactions without a held flag (already gated).
    queueFlagPlacement(player, event.block, resolveBlockFace(event), "interactBlock");
  });
}

export function entityIsValid(entity) {
  if (!entity) return false;
  try {
    if (typeof entity.isValid === "function") return entity.isValid();
    if (typeof entity.isValid === "boolean") return entity.isValid;
  } catch (_error) {
    return false;
  }
  // If the runtime exposes neither form, assume the entity reference is still usable.
  return true;
}

export function bindFlagEntitySpawn(world) {
  world.afterEvents?.entitySpawn?.subscribe((event) => {
    const entity = event.entity;
    if (!entity || entity.typeId !== FLAG_ENTITY) return;

    system.run(() => {
      try {
        if (!entityIsValid(entity)) return;
        if (typeof onWildFlagSpawn === "function") onWildFlagSpawn(entity);
      } catch (error) {
        console.warn(`[Kingdoms] Ошибка обработки флага-сущности: ${error}`);
      }
    });
  });
}

export function bindFlagSystem(world) {
  system.beforeEvents.startup.subscribe((event) => {
    registerFlagComponent(event.itemComponentRegistry);
  });

  world.beforeEvents?.worldInitialize?.subscribe((event) => {
    registerFlagComponent(event.itemComponentRegistry);
  });

  bindFlagPlacementEvents(world);
  bindFlagEntitySpawn(world);
}
