export const SETTLEMENT_TYPE_NAMES = [
  "Деревня",
  "Большая деревня",
  "Городок",
  "Большой город",
  "Замок",
  "Королевство",
  "Империя"
];

export const MAX_SETTLEMENT_TYPE_INDEX = SETTLEMENT_TYPE_NAMES.length - 1;
export const WAR_DECLARE_COOLDOWN_TICKS = 24 * 60 * 60 * 20;
export const WEAK_WAR_COOLDOWN_TICKS = 48 * 60 * 60 * 20;
export const WEAK_VICTORY_TYPE_GAP = 2;

export function canTargetSettlementType(attackerTypeIndex, targetTypeIndex) {
  if (targetTypeIndex < 0 || targetTypeIndex > MAX_SETTLEMENT_TYPE_INDEX) return false;
  const maxTarget = Math.min(attackerTypeIndex + 1, MAX_SETTLEMENT_TYPE_INDEX);
  return targetTypeIndex <= maxTarget;
}

export function isWeakTargetType(attackerTypeIndex, targetTypeIndex) {
  return attackerTypeIndex - targetTypeIndex >= WEAK_VICTORY_TYPE_GAP;
}

export function getAllowedTargetTypeNames(attackerTypeIndex) {
  const maxTarget = Math.min(attackerTypeIndex + 1, MAX_SETTLEMENT_TYPE_INDEX);
  return SETTLEMENT_TYPE_NAMES.slice(0, maxTarget + 1).join(", ");
}

export function getWarDeclareCooldownRemaining(settlement, currentTick) {
  const last = settlement.lastWarDeclaredTick ?? -WAR_DECLARE_COOLDOWN_TICKS;
  return Math.max(0, last + WAR_DECLARE_COOLDOWN_TICKS - currentTick);
}

export function getWeakWarCooldownRemaining(settlement, targetTypeIndex, currentTick) {
  if (!isWeakTargetType(settlement.typeIndex, targetTypeIndex)) return 0;
  const until = settlement.weakWarCooldownUntil?.[String(targetTypeIndex)] ?? 0;
  return Math.max(0, until - currentTick);
}

export function getWarBlockForTarget(settlement, target, currentTick) {
  const globalRemaining = getWarDeclareCooldownRemaining(settlement, currentTick);
  const weakRemaining = getWeakWarCooldownRemaining(settlement, target.typeIndex, currentTick);

  if (weakRemaining > 0 && weakRemaining >= globalRemaining) {
    return { ok: false, reason: "weak", remaining: weakRemaining, targetTypeIndex: target.typeIndex };
  }
  if (globalRemaining > 0) {
    return { ok: false, reason: "global", remaining: globalRemaining };
  }
  if (weakRemaining > 0) {
    return { ok: false, reason: "weak", remaining: weakRemaining, targetTypeIndex: target.typeIndex };
  }
  return { ok: true };
}

export function canDeclareWarOnTarget(settlement, target, currentTick) {
  if (!canTargetSettlementType(settlement.typeIndex, target.typeIndex)) {
    return { ok: false, reason: "type" };
  }
  return getWarBlockForTarget(settlement, target, currentTick);
}

export function recordWarDeclaration(settlement, currentTick) {
  settlement.lastWarDeclaredTick = currentTick;
}

export function recordWeakVictoryCooldown(winner, loser, currentTick) {
  if (winner.typeIndex - loser.typeIndex < WEAK_VICTORY_TYPE_GAP) return;
  if (!winner.weakWarCooldownUntil) winner.weakWarCooldownUntil = {};

  for (let typeIndex = 0; typeIndex <= MAX_SETTLEMENT_TYPE_INDEX; typeIndex += 1) {
    if (isWeakTargetType(winner.typeIndex, typeIndex)) {
      winner.weakWarCooldownUntil[String(typeIndex)] = currentTick + WEAK_WAR_COOLDOWN_TICKS;
    }
  }
}

export function formatCooldownTicks(ticks) {
  const seconds = Math.ceil(ticks / 20);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.ceil((seconds % 3600) / 60));
  if (hours > 0) return `${hours} ч. ${minutes} мин.`;
  return `${minutes} мин.`;
}

export function ensureWarCooldownData(settlement) {
  if (typeof settlement.lastWarDeclaredTick !== "number") {
    settlement.lastWarDeclaredTick = -WAR_DECLARE_COOLDOWN_TICKS;
  }
  if (!settlement.weakWarCooldownUntil || typeof settlement.weakWarCooldownUntil !== "object") {
    settlement.weakWarCooldownUntil = {};
  }
}
