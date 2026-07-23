import { system } from "@minecraft/server";
import { FLAG_ENTITY, FLAG_ITEM, FLAG_ITEM_USE_COMPONENT } from "./constants.js";

const recentPlacementKeys = new Set();

/** @type {((player: import("@minecraft/server").Player, block: import("@minecraft/server").Block, blockFace: import("@minecraft/server").Direction, origin: string) => void) | null} */
let onFlagUseOn = null;

/** @type {((entity: import("@minecraft/server").Entity, player?: import("@minecraft/server").Player) => void) | null} */
let onWildFlagSpawn = null;

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

function getHeldItem(player) {
  try {
    const equippable = player.getComponent("minecraft:equippable") ?? player.getComponent("equippable");
    const main = equippable?.getEquipment?.("Mainhand");
    if (main) return main;
  } catch (_error) {
    // ignore
  }
  try {
    const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
    const slot = player.selectedSlotIndex ?? player.selectedSlot ?? 0;
    return inventory?.getItem?.(slot);
  } catch (_error2) {
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
  try {
    registry.registerCustomComponent(FLAG_ITEM_USE_COMPONENT, flagPlacerComponent);
    registered = true;
  } catch (error) {
    console.warn(`[Kingdoms] Не удалось зарегистрировать flag_placer: ${error}`);
  }
}

function bindUseOnHandler(event, origin) {
  if (event.itemStack?.typeId !== FLAG_ITEM) return;

  const player = resolvePlayer(event);
  if (player?.typeId !== "minecraft:player") return;

  const block = resolveBlock(event);
  if (!block) return;

  queueFlagPlacement(player, block, event.blockFace ?? event.face, origin);
}

export function bindFlagPlacementEvents(world) {
  try {
    world.afterEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event, "afterUseOn"));
  } catch (_error) {
    // itemUseOn removed on some API versions
  }
  try {
    world.beforeEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event, "beforeUseOn"));
  } catch (_error2) {
    // ignore
  }

  // Fallback: ПКМ по блоку с флагом в руке (работает даже без itemUseOn / custom component)
  try {
    world.afterEvents?.playerInteractWithBlock?.subscribe((event) => {
      const player = event.player;
      if (!player || player.typeId !== "minecraft:player") return;
      const held = event.itemStack ?? getHeldItem(player);
      if (held?.typeId !== FLAG_ITEM) return;
      if (!event.block) return;
      queueFlagPlacement(player, event.block, event.blockFace ?? event.face, "interactBlock");
    });
  } catch (_error3) {
    // ignore
  }
}

export function bindFlagEntitySpawn(world) {
  try {
    world.afterEvents?.entitySpawn?.subscribe((event) => {
      if (event.entity?.typeId !== FLAG_ENTITY) return;

      system.run(() => {
        try {
          if (typeof onWildFlagSpawn === "function") onWildFlagSpawn(event.entity);
        } catch (error) {
          console.warn(`[Kingdoms] Ошибка обработки флага-сущности: ${error}`);
        }
      });
    });
  } catch (error) {
    console.warn(`[Kingdoms] Не удалось подписаться на entitySpawn: ${error}`);
  }
}

export function bindFlagSystem(world) {
  try {
    system.beforeEvents?.startup?.subscribe((event) => {
      registerFlagComponent(event.itemComponentRegistry);
    });
  } catch (error) {
    console.warn(`[Kingdoms] startup registry недоступен: ${error}`);
  }

  try {
    world.beforeEvents?.worldInitialize?.subscribe((event) => {
      registerFlagComponent(event.itemComponentRegistry);
    });
  } catch (_error) {
    // ignore
  }

  bindFlagPlacementEvents(world);
  bindFlagEntitySpawn(world);
}
