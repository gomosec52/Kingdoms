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
export const WEAK_ATTACKER_TYPE_GAP = 2;
export const MIN_TARGET_ONLINE_FOR_WAR = 3;
export const FLAG_DAMAGE_COOLDOWN_TICKS = 10 * 20;

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

export function getAllianceWarDeclareCooldownRemaining(data, settlement, currentTick) {
  return getAllianceSettlements(data, settlement).reduce((max, member) => {
    ensureWarCooldownData(member);
    return Math.max(max, getWarDeclareCooldownRemaining(member, currentTick));
  }, 0);
}

export function getWarBlockForTarget(data, settlement, target, currentTick) {
  const globalRemaining = getAllianceWarDeclareCooldownRemaining(data, settlement, currentTick);
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

export function isMuchWeakerAttacker(attackerTypeIndex, targetTypeIndex) {
  return targetTypeIndex - attackerTypeIndex >= WEAK_ATTACKER_TYPE_GAP;
}

export function getWarTargetOnlineBlockReason(attacker, target, onlineCount) {
  if (onlineCount <= 0) {
    return {
      ok: false,
      reason: "offline",
      message: "§cНельзя объявить войну поселению без игроков в сети."
    };
  }
  if (isMuchWeakerAttacker(attacker.typeIndex, target.typeIndex) && onlineCount === 1) {
    return {
      ok: false,
      reason: "weak_sniper",
      message: "§cСлабое поселение не может объявить войну более крупному противнику, когда у него в сети только 1 игрок."
    };
  }
  if (onlineCount < MIN_TARGET_ONLINE_FOR_WAR) {
    return {
      ok: false,
      reason: "insufficient_online",
      message: `§cОбъявить войну можно только поселению, у которого больше 2 игроков в сети (минимум ${MIN_TARGET_ONLINE_FOR_WAR}, сейчас ${onlineCount}).`
    };
  }
  return { ok: true };
}

export function canDeclareWarOnTarget(data, settlement, target, currentTick, targetOnlineCount = MIN_TARGET_ONLINE_FOR_WAR) {
  if (!canTargetSettlementType(settlement.typeIndex, target.typeIndex)) {
    return { ok: false, reason: "type" };
  }
  const onlineCheck = getWarTargetOnlineBlockReason(settlement, target, targetOnlineCount);
  if (!onlineCheck.ok) return onlineCheck;
  return getWarBlockForTarget(data, settlement, target, currentTick);
}

export function recordWarDeclaration(settlement, currentTick) {
  settlement.lastWarDeclaredTick = currentTick;
}

export function recordAllianceWarDeclaration(data, settlement, currentTick) {
  for (const member of getAllianceSettlements(data, settlement)) {
    ensureWarCooldownData(member);
    recordWarDeclaration(member, currentTick);
  }
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
  if (seconds >= 60) return `${minutes} мин.`;
  return `${Math.max(1, seconds)} сек.`;
}

export function getAllianceSettlements(data, settlement) {
  if (!settlement) return [];
  if (!settlement.allianceId) return [settlement];
  return data.settlements.filter((entry) => entry.allianceId === settlement.allianceId);
}

export function areSettlementsAtWar(data, first, second) {
  if (!first || !second || first.id === second.id) return false;
  if (first.allianceId && first.allianceId === second.allianceId) return false;

  const firstSide = getAllianceSettlements(data, first);
  const secondSide = getAllianceSettlements(data, second);

  for (const left of firstSide) {
    for (const right of secondSide) {
      if ((left.wars || []).includes(right.id) || (right.wars || []).includes(left.id)) return true;
    }
  }
  return false;
}

export function linkAllianceWar(data, attackerSideLeader, target) {
  const attackers = getAllianceSettlements(data, attackerSideLeader);
  for (const member of attackers) {
    if (!Array.isArray(member.wars)) member.wars = [];
    if (!member.wars.includes(target.id)) member.wars.push(target.id);
  }
  if (!Array.isArray(target.wars)) target.wars = [];
  for (const member of attackers) {
    if (!target.wars.includes(member.id)) target.wars.push(member.id);
  }
}

export function unlinkAllianceWar(data, attackerSideLeader, targetId) {
  const attackers = getAllianceSettlements(data, attackerSideLeader);
  const target = getSettlementById(data, targetId);
  if (!target) return;

  const attackerIds = new Set(attackers.map((entry) => entry.id));
  for (const member of attackers) {
    member.wars = (member.wars || []).filter((id) => id !== target.id);
  }
  target.wars = (target.wars || []).filter((id) => !attackerIds.has(id));
}

function getSettlementById(data, settlementId) {
  return data.settlements.find((entry) => entry.id === settlementId);
}

export function findWarInitiator(data, loser, attackerSide) {
  const attackers = getAllianceSettlements(data, attackerSide);
  return attackers.find((member) => (member.warInitiatedAgainst || []).includes(loser.id)) ?? attackerSide;
}

export function allianceHasActiveWars(data, settlement) {
  return getAllianceSettlements(data, settlement).some((member) => (member.wars || []).length > 0);
}

export function ensureWarCooldownData(settlement) {
  if (typeof settlement.lastWarDeclaredTick !== "number") {
    settlement.lastWarDeclaredTick = -WAR_DECLARE_COOLDOWN_TICKS;
  }
  if (!settlement.weakWarCooldownUntil || typeof settlement.weakWarCooldownUntil !== "object") {
    settlement.weakWarCooldownUntil = {};
  }
}
