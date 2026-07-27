import { system, ItemStack } from "@minecraft/server";
import {
  chunkFromLocation,
  chunkKey,
  canCaptureChunk,
  captureChunk,
  countCapturedChunks,
  MAX_EMPIRE_CAPTURED_CHUNKS
} from "./territory.js";

export const CHUNK_CAPTURE_FLAG_ITEM = "kingdoms:chunk_capture_flag";
export const CHUNK_MARKER_ENTITY = "kingdoms:chunk_marker";
export const CHUNK_MARKER_TAG = "kingdoms_chunk_marker";
export const CHUNK_CAPTURE_USE_COMPONENT = "kingdoms:chunk_capture_placer";

/** @type {object | undefined} */
let deps;

const recentPlacementKeys = new Set();

function placementKey(player, block) {
  const location = block.location;
  return `${player.name}:${Math.floor(location.x)}:${Math.floor(location.y)}:${Math.floor(location.z)}:${system.currentTick}`;
}

function queueChunkCapturePlacement(player, block, origin = "script") {
  if (!player || !block) return;

  const key = placementKey(player, block);
  if (recentPlacementKeys.has(key)) return;
  recentPlacementKeys.add(key);
  system.runTimeout(() => recentPlacementKeys.delete(key), 2);

  system.run(() => {
    try {
      handleChunkCaptureUse(player, block, origin);
    } catch (error) {
      player.sendMessage(`§c[Королевства] Ошибка захвата чанка: ${error}`);
    }
  });
}

function resolvePlayer(event) {
  return event.source ?? event.player;
}

function resolveBlock(event) {
  if (event.block) return event.block;

  const source = resolvePlayer(event);
  const faceLocation = event.faceLocation;
  if (!source?.dimension || !faceLocation) return undefined;

  try {
    return source.dimension.getBlock(faceLocation);
  } catch (_error) {
    return undefined;
  }
}

/** @type {import("@minecraft/server").ItemCustomComponent} */
const chunkCapturePlacerComponent = {
  onUseOn(event) {
    const player = event.source;
    if (event.itemStack?.typeId !== CHUNK_CAPTURE_FLAG_ITEM) return;
    if (player?.typeId !== "minecraft:player") return;

    const block = resolveBlock(event);
    if (!block) return;

    queueChunkCapturePlacement(player, block, "component");
  }
};

let registered = false;

function registerChunkCaptureComponent(registry) {
  if (registered || !registry?.registerCustomComponent) return;
  registry.registerCustomComponent(CHUNK_CAPTURE_USE_COMPONENT, chunkCapturePlacerComponent);
  registered = true;
}

function bindUseOnHandler(event) {
  if (event.itemStack?.typeId !== CHUNK_CAPTURE_FLAG_ITEM) return;

  const player = resolvePlayer(event);
  if (player?.typeId !== "minecraft:player") return;

  const block = resolveBlock(event);
  if (!block) return;

  queueChunkCapturePlacement(player, block, "itemUseOn");
}

export function bindChunkCaptureSystem(world, dependencies) {
  deps = dependencies;

  system.beforeEvents.startup.subscribe((event) => {
    registerChunkCaptureComponent(event.itemComponentRegistry);
  });

  world.beforeEvents?.worldInitialize?.subscribe((event) => {
    registerChunkCaptureComponent(event.itemComponentRegistry);
  });

  world.afterEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event));
  world.beforeEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event));

  world.afterEvents?.entityDie?.subscribe((event) => {
    if (event.deadEntity?.typeId !== CHUNK_MARKER_ENTITY) return;
    const dimension = event.deadEntity.dimension;
    try {
      dimension.spawnItem(new ItemStack(CHUNK_CAPTURE_FLAG_ITEM, 1), event.deadEntity.location);
    } catch (_error) {
      // Ignore drop failures.
    }
  });
}

function handleChunkCaptureUse(player, clickedBlock) {
  if (!player?.isValid || !clickedBlock || !deps) return;

  const data = deps.loadData();
  const settlement = deps.getPlayerSettlement(data, deps.getPlayerName(player));
  if (!settlement) {
    player.sendMessage("§cЗахват чанков доступен только жителям Империи.");
    return;
  }
  if (!deps.canCaptureChunks(data, deps.getPlayerName(player), settlement)) {
    player.sendMessage("§cСтавить флаг захвата могут создатель и Советник.");
    return;
  }

  const dimensionId = deps.getDimensionId(clickedBlock.dimension);
  if (settlement.dimensionId !== dimensionId) {
    player.sendMessage("§cЗахватывать можно только в своём измерении.");
    return;
  }

  const { cx, cz } = chunkFromLocation(clickedBlock.location);
  const error = canCaptureChunk(data, settlement, cx, cz);
  if (error) {
    player.sendMessage(error);
    return;
  }

  const inventory = player.getComponent("minecraft:inventory")?.container ?? player.getComponent("inventory")?.container;
  if (!inventory) return;

  let consumed = false;
  for (let slot = 0; slot < inventory.size; slot += 1) {
    const item = inventory.getItem(slot);
    if (item?.typeId !== CHUNK_CAPTURE_FLAG_ITEM) continue;
    if (item.amount <= 1) inventory.setItem(slot, undefined);
    else {
      item.amount -= 1;
      inventory.setItem(slot, item);
    }
    consumed = true;
    break;
  }
  if (!consumed) {
    player.sendMessage("§cНужен предмет «Флаг захвата чанка».");
    return;
  }

  captureChunk(settlement, cx, cz);
  spawnChunkMarker(clickedBlock, cx, cz, settlement.id);
  deps.saveData(data);
  player.sendMessage(`§aЧанк [${cx}, ${cz}] захвачен! (${countCapturedChunks(settlement)}/${MAX_EMPIRE_CAPTURED_CHUNKS})`);
}

function spawnChunkMarker(clickedBlock, cx, cz, settlementId) {
  const dimension = clickedBlock.dimension;
  const location = {
    x: cx * 16 + 8,
    y: Math.floor(clickedBlock.location.y) + 1,
    z: cz * 16 + 8
  };

  try {
    const marker = dimension.spawnEntity(CHUNK_MARKER_ENTITY, location);
    marker.addTag(CHUNK_MARKER_TAG);
    marker.addTag(`kingdoms_id_${settlementId}`);
    marker.addTag(`kingdoms_chunk_${chunkKey(cx, cz)}`);
    marker.nameTag = "§6Флаг чанка";
  } catch (_error) {
    // Marker is optional visual.
  }
}
