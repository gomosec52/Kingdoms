import { system, ItemStack } from "@minecraft/server";
import { formatCopperValue, takeCopperValueWithNotice } from "./economy.js";
import {
  chunkFromLocation,
  chunkKey,
  canPlaceChunkMarker,
  captureChunk,
  chunkCaptureCostsCoins,
  countCapturedChunks,
  getChunkCaptureCostCopper,
  getMaxCapturedChunks,
  isCapturedChunk
} from "./territory.js";

export const CHUNK_CAPTURE_FLAG_ITEM = "kingdoms:chunk_capture_flag";
export const CHUNK_MARKER_ENTITY = "kingdoms:chunk_marker";
export const CHUNK_MARKER_TAG = "kingdoms_chunk_marker";
export const CHUNK_MARKER_PENDING_TAG = "kingdoms_chunk_pending";
export const CHUNK_MARKER_LIFETIME_TICKS = 40;

/** @type {object | undefined} */
let deps;

const recentPlacementKeys = new Set();

function placementKey(player, block) {
  const location = block.location;
  return `${player.name}:${Math.floor(location.x)}:${Math.floor(location.y)}:${Math.floor(location.z)}:${system.currentTick}`;
}

function queueChunkCapturePlacement(player, block) {
  if (!player || !block) return;

  const key = placementKey(player, block);
  if (recentPlacementKeys.has(key)) return;
  recentPlacementKeys.add(key);
  system.runTimeout(() => recentPlacementKeys.delete(key), 2);

  system.run(() => {
    try {
      handleChunkCaptureUse(player, block);
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

function bindUseOnHandler(event) {
  if (event.itemStack?.typeId !== CHUNK_CAPTURE_FLAG_ITEM) return;

  const player = resolvePlayer(event);
  if (player?.typeId !== "minecraft:player") return;

  const block = resolveBlock(event);
  if (!block) return;

  queueChunkCapturePlacement(player, block);
}

function restoreChunkCaptureFlag(player) {
  if (!player?.isValid || typeof deps?.giveItemStack !== "function") return;
  deps.giveItemStack(player, new ItemStack(CHUNK_CAPTURE_FLAG_ITEM, 1));
}

function validateChunkCapture(player, clickedBlock) {
  if (!player?.isValid || !clickedBlock || !deps) {
    return { error: "§cНе удалось обработать захват чанка." };
  }

  const data = deps.loadData();
  const playerName = deps.getPlayerName(player);
  const settlement = deps.getPlayerSettlement(data, playerName);
  if (!settlement) {
    return { error: "§cЗахват чанков доступен только жителям поселения." };
  }
  if (!deps.canCaptureChunks(data, playerName, settlement)) {
    return { error: "§cСтавить флаг захвата могут создатель и Советник." };
  }

  const dimensionId = deps.getDimensionId(clickedBlock.dimension);
  if (settlement.dimensionId !== dimensionId) {
    return { error: "§cЗахватывать можно только в своём измерении." };
  }

  const { cx, cz } = chunkFromLocation(clickedBlock.location);
  const error = canPlaceChunkMarker(data, settlement, cx, cz);
  if (error) return { error, data, settlement, cx, cz };

  return { data, settlement, cx, cz, dimensionId };
}

function dropChunkCaptureFlagItem(marker) {
  if (!marker?.isValid) return;
  try {
    marker.dimension.spawnItem(new ItemStack(CHUNK_CAPTURE_FLAG_ITEM, 1), marker.location);
  } catch (_error) {
    // Ignore drop failures.
  }
}

function scheduleChunkMarkerExpiry(marker) {
  if (!marker?.isValid) return;
  system.runTimeout(() => {
    if (!marker?.isValid) return;
    dropChunkCaptureFlagItem(marker);
    marker.remove();
  }, CHUNK_MARKER_LIFETIME_TICKS);
}

function finalizeChunkCapture(player, clickedBlock, settlement, cx, cz, existingMarker) {
  const data = deps.loadData();
  const freshSettlement = deps.getSettlement(data, settlement.id) ?? settlement;
  const recheck = canPlaceChunkMarker(data, freshSettlement, cx, cz);
  if (recheck) {
    if (existingMarker?.isValid) existingMarker.remove();
    restoreChunkCaptureFlag(player);
    player.sendMessage(recheck);
    return;
  }

  const newlyCaptured = !isCapturedChunk(freshSettlement, cx, cz);
  if (newlyCaptured) {
    const captureCost = getChunkCaptureCostCopper(freshSettlement);
    if (captureCost > 0 && !takeCopperValueWithNotice(player, captureCost)) {
      if (existingMarker?.isValid) existingMarker.remove();
      restoreChunkCaptureFlag(player);
      player.sendMessage(`§cДля захвата чанка нужно ${formatCopperValue(captureCost)}.`);
      return;
    }
    captureChunk(freshSettlement, cx, cz);
  }
  const marker = existingMarker?.isValid
    ? existingMarker
    : spawnChunkMarker(clickedBlock, cx, cz, freshSettlement.id);

  if (marker?.isValid) {
    marker.removeTag(CHUNK_MARKER_PENDING_TAG);
    marker.addTag(CHUNK_MARKER_TAG);
    marker.addTag(`kingdoms_id_${freshSettlement.id}`);
    marker.addTag(`kingdoms_chunk_${chunkKey(cx, cz)}`);
    marker.nameTag = "§6Флаг чанка";
    try {
      marker.teleport({
        x: cx * 16 + 8,
        y: Math.floor(clickedBlock.location.y) + 1,
        z: cz * 16 + 8
      });
    } catch (_error) {
      // Keep marker at current location if teleport fails.
    }
    scheduleChunkMarkerExpiry(marker);
  }

  deps.saveData(data);
  if (newlyCaptured && typeof deps.refreshSettlementBorders === "function") {
    deps.refreshSettlementBorders(data, freshSettlement);
  }
  player.sendMessage(
    newlyCaptured
      ? chunkCaptureCostsCoins(freshSettlement)
        ? `§aЧанк [${cx}, ${cz}] захвачен за ${formatCopperValue(getChunkCaptureCostCopper(freshSettlement))}! (${countCapturedChunks(freshSettlement)}/${getMaxCapturedChunks(freshSettlement)})`
        : `§aЧанк [${cx}, ${cz}] захвачен! (${countCapturedChunks(freshSettlement)}/${getMaxCapturedChunks(freshSettlement)})`
      : `§aФлаг чанка [${cx}, ${cz}] установлен заново.`
  );
}

function handleChunkMarkerSpawn(entity) {
  if (!entity?.isValid || entity.typeId !== CHUNK_MARKER_ENTITY) return;
  if (entity.hasTag(CHUNK_MARKER_TAG)) return;

  const player = typeof deps?.findNearestPlayer === "function"
    ? deps.findNearestPlayer(entity, 10)
    : undefined;
  if (!player) {
    entity.addTag(CHUNK_MARKER_PENDING_TAG);
    return;
  }

  let clickedBlock;
  try {
    clickedBlock = entity.dimension.getBlock({
      x: Math.floor(entity.location.x),
      y: Math.floor(entity.location.y) - 1,
      z: Math.floor(entity.location.z)
    });
  } catch (_error) {
    clickedBlock = undefined;
  }

  if (!clickedBlock) {
    entity.remove();
    restoreChunkCaptureFlag(player);
    player.sendMessage("§cНе удалось поставить флаг захвата.");
    return;
  }

  const result = validateChunkCapture(player, clickedBlock);
  if (result.error) {
    entity.remove();
    restoreChunkCaptureFlag(player);
    player.sendMessage(result.error);
    return;
  }

  entity.addTag(CHUNK_MARKER_PENDING_TAG);
  finalizeChunkCapture(player, clickedBlock, result.settlement, result.cx, result.cz, entity);
}

export function cleanupChunkMarkersForSettlement(settlement) {
  const dimension = deps?.safeDimension?.(settlement?.dimensionId);
  if (!dimension) return;

  try {
    for (const entity of dimension.getEntities({ type: CHUNK_MARKER_ENTITY, tags: [`kingdoms_id_${settlement.id}`] })) {
      entity.remove();
    }
  } catch (_error) {
    // Ignore marker cleanup failures.
  }
}

export function bindChunkCaptureSystem(world, dependencies) {
  deps = dependencies;

  // itemUseOn fallback for runtimes where entity_placer is delayed or unavailable.
  world.afterEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event));
  world.beforeEvents?.itemUseOn?.subscribe((event) => bindUseOnHandler(event));

  world.afterEvents?.entitySpawn?.subscribe((event) => {
    if (event.entity?.typeId !== CHUNK_MARKER_ENTITY) return;
    if (event.entity.hasTag(CHUNK_MARKER_TAG)) return;

    system.run(() => handleChunkMarkerSpawn(event.entity));
  });
}

function handleChunkCaptureUse(player, clickedBlock) {
  const result = validateChunkCapture(player, clickedBlock);
  if (result.error) {
    player.sendMessage(result.error);
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

  finalizeChunkCapture(player, clickedBlock, result.settlement, result.cx, result.cz);
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
    return marker;
  } catch (_error) {
    return undefined;
  }
}
