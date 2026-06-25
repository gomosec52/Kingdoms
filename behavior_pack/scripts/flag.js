import { system } from "@minecraft/server";
import { FLAG_ITEM, FLAG_ITEM_USE_COMPONENT } from "./config.js";

/** @type {import("@minecraft/server").ItemCustomComponent} */
const flagPlacerComponent = {
  onUseOn(event) {
    const player = event.source;
    const itemStack = event.itemStack;
    if (itemStack?.typeId !== FLAG_ITEM) return;
    if (player?.typeId !== "minecraft:player") return;
    if (!event.block) return;

    const block = event.block;
    const blockFace = event.blockFace;
    system.run(() => {
      if (typeof onFlagUseOn === "function") onFlagUseOn(player, block, blockFace);
    });
  }
};

let registered = false;
/** @type {((player: import("@minecraft/server").Player, block: import("@minecraft/server").Block, blockFace: import("@minecraft/server").Direction) => void) | null} */
let onFlagUseOn = null;

export function setFlagPlacementHandler(handler) {
  onFlagUseOn = handler;
}

export function registerFlagComponent(registry) {
  if (registered || !registry?.registerCustomComponent) return;

  registry.registerCustomComponent(FLAG_ITEM_USE_COMPONENT, flagPlacerComponent);
  registered = true;
}

export function bindFlagUseOnFallback(subscribe) {
  subscribe((event) => {
    if (event.itemStack?.typeId !== FLAG_ITEM) return;
    if (event.source?.typeId !== "minecraft:player") return;
    if (!event.block) return;

    const player = event.source;
    const block = event.block;
    const blockFace = event.blockFace;
    system.run(() => {
      if (typeof onFlagUseOn === "function") onFlagUseOn(player, block, blockFace);
    });
  });
}
