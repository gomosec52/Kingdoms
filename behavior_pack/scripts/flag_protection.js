/** Горизонтальный радиус (в блоках) вокруг флага, где нельзя строить. */
export const FLAG_CORE_PROTECT_RADIUS = 2;
/** Сколько блоков ниже флага тоже защищено. */
export const FLAG_CORE_PROTECT_Y_BELOW = 1;
/** Сколько блоков выше флага защищено. */
export const FLAG_CORE_PROTECT_Y_ABOVE = 4;

export function isInFlagCoreProtectionZone(location, flagPosition) {
  if (!location || !flagPosition) return false;

  const bx = Math.floor(location.x);
  const by = Math.floor(location.y);
  const bz = Math.floor(location.z);
  const fx = Math.floor(flagPosition.x);
  const fy = Math.floor(flagPosition.y);
  const fz = Math.floor(flagPosition.z);

  const dx = Math.abs(bx - fx);
  const dz = Math.abs(bz - fz);
  if (dx > FLAG_CORE_PROTECT_RADIUS || dz > FLAG_CORE_PROTECT_RADIUS) return false;

  const dy = by - fy;
  return dy >= -FLAG_CORE_PROTECT_Y_BELOW && dy <= FLAG_CORE_PROTECT_Y_ABOVE;
}

export const FLAG_CORE_PROTECT_MESSAGE = "§cРядом с флагом поселения нельзя ставить или ломать блоки — зона защиты от осады.";
