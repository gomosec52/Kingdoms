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
export const MIN_ATTACKER_ONLINE_FOR_WAR = 2;
export const MIN_ATTACKERS_ON_TERRITORY_FOR_FLAG_DAMAGE = 2;
export const WAR_PREPARATION_TICKS = 45 * 60 * 20;
export const GLOBAL_WAR_MIN_ONLINE = 5;
export const GLOBAL_WAR_KILL_POINTS_TO_WIN = 50;
export const GLOBAL_WAR_TERRITORY_TRANSFER_FRACTION = 0.6;
export const GLOBAL_WAR_DEMOTE_TYPES = 2;
export const FLAG_DAMAGE_COOLDOWN_TICKS = 15 * 20;
export const WAR_EARLY_PEACE_MORALE_PENALTY = 15;
export const FLAG_REPAIR_COOLDOWN_TICKS = 2 * 60 * 20;
export const FLAG_REPAIR_HP_FRACTION = 0.15;
export const CONDEMNATION_TTL_TICKS = 2 * 24 * 60 * 60 * 20;
export const CONDEMNATION_DEMOTE_THRESHOLD_1 = 8;
export const CONDEMNATION_DEMOTE_THRESHOLD_2 = 12;

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

export function getWarAttackerOnlineBlockReason(onlineCount) {
  if (onlineCount < MIN_ATTACKER_ONLINE_FOR_WAR) {
    return {
      ok: false,
      reason: "insufficient_attackers",
      message: `§cДля объявления войны в вашем альянсе должно быть минимум ${MIN_ATTACKER_ONLINE_FOR_WAR} игрока в сети (сейчас ${onlineCount}).`
    };
  }
  return { ok: true };
}

export function canDeclareWarOnTarget(data, settlement, target, currentTick, targetOnlineCount = MIN_TARGET_ONLINE_FOR_WAR, attackerOnlineCount = MIN_ATTACKER_ONLINE_FOR_WAR) {
  if (!canTargetSettlementType(settlement.typeIndex, target.typeIndex)) {
    return { ok: false, reason: "type" };
  }
  const attackerOnlineCheck = getWarAttackerOnlineBlockReason(attackerOnlineCount);
  if (!attackerOnlineCheck.ok) return attackerOnlineCheck;
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

export function ensureWarCampaigns(data) {
  if (!Array.isArray(data.warCampaigns)) data.warCampaigns = [];
}

export function findWarCampaign(data, initiatorSettlementId, targetSettlementId) {
  ensureWarCampaigns(data);
  return data.warCampaigns.find((entry) =>
    entry.initiatorSettlementId === initiatorSettlementId
    && entry.targetSettlementId === targetSettlementId
    && !entry.ended);
}

export function findWarCampaignBetween(data, first, second) {
  if (!first || !second) return undefined;
  ensureWarCampaigns(data);
  const firstSide = getAllianceSettlements(data, first);
  const secondIds = new Set(getAllianceSettlements(data, second).map((entry) => entry.id));

  return data.warCampaigns.find((entry) => {
    if (entry.ended) return false;
    const initiatorInFirst = firstSide.some((ally) => ally.id === entry.initiatorSettlementId);
    const targetMatches = secondIds.has(entry.targetSettlementId)
      || firstSide.some((ally) => ally.id === entry.targetSettlementId);
    const initiatorInSecond = getAllianceSettlements(data, second).some((ally) => ally.id === entry.initiatorSettlementId);
    if (initiatorInFirst && secondIds.has(entry.targetSettlementId)) return true;
    if (initiatorInSecond && firstSide.some((ally) => ally.id === entry.targetSettlementId)) return true;
    return false;
  });
}

export function createWarCampaign(data, initiator, target, reason, currentTick, warType = "normal") {
  ensureWarCampaigns(data);
  const campaign = {
    id: nextWarCampaignId(data),
    initiatorSettlementId: initiator.id,
    targetSettlementId: target.id,
    warType,
    reason: String(reason ?? "").trim(),
    declaredTick: currentTick,
    activeTick: currentTick + WAR_PREPARATION_TICKS,
    flagDamageDealt: false,
    combatAnnounced: false,
    ended: false
  };
  if (warType === "global") {
    campaign.killPoints = {
      [String(initiator.id)]: 0,
      [String(target.id)]: 0
    };
  }
  data.warCampaigns.push(campaign);
  return campaign;
}

export function createGlobalWarCampaign(data, initiator, target, reason, currentTick) {
  return createWarCampaign(data, initiator, target, reason, currentTick, "global");
}

export function isGlobalWarCampaign(campaign) {
  return campaign?.warType === "global";
}

export function getGlobalWarOnlineBlockReason(onlineCount, sideLabel) {
  if (onlineCount < GLOBAL_WAR_MIN_ONLINE) {
    return {
      ok: false,
      message: `§cДля глобальной войны у ${sideLabel} должно быть минимум ${GLOBAL_WAR_MIN_ONLINE} жителей в сети (сейчас ${onlineCount}).`
    };
  }
  return { ok: true };
}

export function canDeclareGlobalWarOnTarget(data, initiator, target, currentTick, initiatorOnlineCount, targetOnlineCount) {
  const initiatorCheck = getGlobalWarOnlineBlockReason(initiatorOnlineCount, "вашего поселения");
  if (!initiatorCheck.ok) return initiatorCheck;
  const targetCheck = getGlobalWarOnlineBlockReason(targetOnlineCount, "противника");
  if (!targetCheck.ok) return targetCheck;
  const cooldownRemaining = getWarDeclareCooldownRemaining(initiator, currentTick);
  if (cooldownRemaining > 0) {
    return { ok: false, reason: "global", remaining: cooldownRemaining };
  }
  return { ok: true };
}

export function linkDirectWar(initiator, target) {
  if (!Array.isArray(initiator.wars)) initiator.wars = [];
  if (!Array.isArray(target.wars)) target.wars = [];
  if (!initiator.wars.includes(target.id)) initiator.wars.push(target.id);
  if (!target.wars.includes(initiator.id)) target.wars.push(initiator.id);
}

export function unlinkDirectWarPair(data, firstId, secondId) {
  const first = getSettlementById(data, firstId);
  const second = getSettlementById(data, secondId);
  if (first) first.wars = (first.wars || []).filter((id) => id !== secondId);
  if (second) second.wars = (second.wars || []).filter((id) => id !== firstId);
}

export function getGlobalWarKillPoints(campaign, settlementId) {
  if (!isGlobalWarCampaign(campaign)) return 0;
  return campaign.killPoints?.[String(settlementId)] ?? 0;
}

export function addGlobalWarKillPoint(campaign, settlementId) {
  if (!isGlobalWarCampaign(campaign)) return 0;
  if (!campaign.killPoints) campaign.killPoints = {};
  const key = String(settlementId);
  campaign.killPoints[key] = (campaign.killPoints[key] ?? 0) + 1;
  return campaign.killPoints[key];
}

export function formatGlobalWarKillScore(data, campaign) {
  const initiator = getSettlementById(data, campaign.initiatorSettlementId);
  const target = getSettlementById(data, campaign.targetSettlementId);
  const left = getGlobalWarKillPoints(campaign, campaign.initiatorSettlementId);
  const right = getGlobalWarKillPoints(campaign, campaign.targetSettlementId);
  const leftName = initiator?.name ?? "?";
  const rightName = target?.name ?? "?";
  return `${leftName} ${left}/${GLOBAL_WAR_KILL_POINTS_TO_WIN} — ${right}/${GLOBAL_WAR_KILL_POINTS_TO_WIN} ${rightName}`;
}

export function nextWarCampaignId(data) {
  if (typeof data.nextWarCampaignIdValue !== "number") data.nextWarCampaignIdValue = 1;
  const id = data.nextWarCampaignIdValue;
  data.nextWarCampaignIdValue = id + 1;
  return id;
}

export function isWarCombatActive(campaign, currentTick) {
  if (!campaign || campaign.ended) return false;
  return currentTick >= campaign.activeTick;
}

export function getWarPreparationRemaining(campaign, currentTick) {
  if (!campaign || campaign.ended) return 0;
  return Math.max(0, campaign.activeTick - currentTick);
}

export function markWarFlagDamage(campaign) {
  if (campaign) campaign.flagDamageDealt = true;
}

export function endWarCampaign(data, initiatorSettlementId, targetSettlementId) {
  ensureWarCampaigns(data);
  const campaign = findWarCampaign(data, initiatorSettlementId, targetSettlementId);
  if (campaign) campaign.ended = true;
  return campaign;
}

export function endWarCampaignRecord(campaign) {
  if (campaign) campaign.ended = true;
  return campaign;
}

export function shouldPenalizeEarlyPeace(campaign, currentTick) {
  if (!campaign) return false;
  return !campaign.flagDamageDealt || currentTick < campaign.activeTick;
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
  const campaign = data.warCampaigns?.find((entry) =>
    !entry.ended && entry.targetSettlementId === loser.id
    && attackers.some((member) => member.id === entry.initiatorSettlementId));
  if (campaign) {
    return getSettlementById(data, campaign.initiatorSettlementId) ?? attackerSide;
  }
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
  if (typeof settlement.lastFlagRepairTick !== "number") {
    settlement.lastFlagRepairTick = -FLAG_REPAIR_COOLDOWN_TICKS;
  }
}

export function getFlagRepairCooldownRemaining(settlement, currentTick) {
  const last = settlement.lastFlagRepairTick ?? -FLAG_REPAIR_COOLDOWN_TICKS;
  return Math.max(0, last + FLAG_REPAIR_COOLDOWN_TICKS - currentTick);
}

export function computeFlagRepairCost(settlement, maxHp) {
  const missing = Math.max(0, maxHp - (settlement.hp ?? maxHp));
  if (missing <= 0) return 0;
  return Math.max(1, Math.ceil(missing / 4));
}

export function computeFlagRepairAmount(maxHp) {
  return Math.max(1, Math.ceil(maxHp * FLAG_REPAIR_HP_FRACTION));
}
