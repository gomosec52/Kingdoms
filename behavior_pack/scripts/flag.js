import { system } from "@minecraft/server";
import { FLAG_ENTITY, FLAG_ITEM, FLAG_ITEM_USE_COMPONENT } from "./config.js";

const recentPlacementKeys = new Set();

/** @type {((player: import("@minecraft/server").Player, block: import("@minecraft/server").Block, blockFace: import("@minecraft/server").Direction, origin: string) => void) | null} */
let onFlagUseOn = null;

/** @type {((entity: import("@minecraft/server").Entity) => void) | null} */
let onWildFlagSpawn = null;

function placementKey(player, block) {
  const location = block.location;
  return `${player.name}:${Math.floor(location.x)}:${Math.floor(location.y)}:${Math.floor(location.z)}:${system.currentTick}`;
}

function queuePlacement(player, block, blockFace, origin) {
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

/** @type {import("@minecraft/server").ItemCustomComponent} */
const flagPlacerComponent = {
  onUseOn(event) {
    const player = event.source;
    if (event.itemStack?.typeId !== FLAG_ITEM) return;
    if (player?.typeId !== "minecraft:player" || !event.block) return;
    queuePlacement(player, event.block, event.blockFace, "component");
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

export function bindFlagUseOnEvents(world) {
  const handler = (event, origin) => {
    if (event.itemStack?.typeId !== FLAG_ITEM) return;
    const player = resolvePlayer(event);
    const block = event.block;
    const blockFace = event.blockFace ?? event.face;
    if (!player || player.typeId !== "minecraft:player" || !block) return;
    queuePlacement(player, block, blockFace, origin);
  };

  world.afterEvents?.itemUseOn?.subscribe((event) => handler(event, "afterUseOn"));
  world.beforeEvents?.itemUseOn?.subscribe((event) => handler(event, "beforeUseOn"));
}

export function bindFlagEntitySpawn(world) {
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
}

export function isPlacementApiAvailable(world) {
  return Boolean(
    world.afterEvents?.itemUseOn ||
    world.afterEvents?.entitySpawn ||
    system.beforeEvents?.startup
  );
}
