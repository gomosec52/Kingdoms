import { system } from "@minecraft/server";
import { FLAG_ITEM, FLAG_ITEM_USE_COMPONENT } from "./config.js";

const recentPlacementKeys = new Set();

/** @type {((player: import("@minecraft/server").Player, block: import("@minecraft/server").Block, blockFace: import("@minecraft/server").Direction, origin: string) => void) | null} */
let onFlagUseOn = null;

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

function resolveBlock(event) {
  return event.block;
}

function resolveBlockFace(event) {
  return event.blockFace ?? event.face;
}

/** @type {import("@minecraft/server").ItemCustomComponent} */
const flagPlacerComponent = {
  onUseOn(event) {
    const player = event.source;
    const itemStack = event.itemStack;
    if (itemStack?.typeId !== FLAG_ITEM) return;
    if (player?.typeId !== "minecraft:player") return;
    if (!event.block) return;
    queuePlacement(player, event.block, event.blockFace, "component");
  }
};

let registered = false;

export function setFlagPlacementHandler(handler) {
  onFlagUseOn = handler;
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
    const block = resolveBlock(event);
    const blockFace = resolveBlockFace(event);
    if (!player || player.typeId !== "minecraft:player" || !block) return;

    queuePlacement(player, block, blockFace, origin);
  };

  if (world.afterEvents?.itemUseOn) {
    world.afterEvents.itemUseOn.subscribe((event) => handler(event, "afterUseOn"));
  }
  if (world.beforeEvents?.itemUseOn) {
    world.beforeEvents.itemUseOn.subscribe((event) => handler(event, "beforeUseOn"));
  }
}

export function isPlacementApiAvailable(world) {
  return Boolean(
    world.afterEvents?.itemUseOn ||
    world.beforeEvents?.itemUseOn ||
    system.beforeEvents?.startup
  );
}
