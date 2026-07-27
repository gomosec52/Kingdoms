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

/** @type {object | undefined} */
let deps;

export function bindChunkCaptureSystem(world, dependencies) {
  deps = dependencies;

  system.beforeEvents.startup.subscribe(({ itemComponentRegistry }) => {
    if (!itemComponentRegistry?.registerCustomComponent) return;
    itemComponentRegistry.registerCustomComponent("kingdoms:chunk_capture_placer", {
      onUseOn(event) {
        const player = event.source;
        if (player?.typeId !== "minecraft:player" || event.itemStack?.typeId !== CHUNK_CAPTURE_FLAG_ITEM) return;
        system.run(() => handleChunkCaptureUse(player, event.block));
      }
    });
  });

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
  if (!player?.isValid || !clickedBlock) return;

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
