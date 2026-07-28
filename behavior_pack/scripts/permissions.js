export const PREFIXES = [
  {
    name: "Крестьянин",
    description: "Добывает еду, дерево и базовые ресурсы для поселения.",
    access: "Базовый житель без особых прав."
  },
  {
    name: "Ремесленник",
    description: "Создаёт инструменты, блоки, оружие и помогает развивать инфраструктуру.",
    access: "Строительство."
  },
  {
    name: "Стражник",
    description: "Охраняет ворота, флаг, склады и жителей на территории поселения.",
    access: "Созыв рыцарей."
  },
  {
    name: "Купец",
    description: "Ведёт торговлю, доставляет ресурсы и помогает поселению богатеть.",
    access: "Меню «Торговля»."
  },
  {
    name: "Дружинник",
    description: "Сражается в походах и защищает союзников во время войны.",
    access: "Участие в войне, без особых меню."
  },
  {
    name: "Рыцарь",
    description: "Элитный воин поселения, отвечает за атаки, оборону и честь государства.",
    access: "Торговля, рыцари, строительство, созыв армии."
  },
  {
    name: "Дворянин",
    description: "Помогает управлять жителями, дипломатией и внутренним порядком.",
    access: "Торговля, рыцари (созыв до 2), строительство. Может назначать: Стражник, Купец, Дружинник."
  },
  {
    name: "Советник",
    description: "Даёт стратегические решения владельцу и координирует развитие.",
    access: "Правая рука создателя: всё кроме расформировать поселение и альянс. Назначает префиксы до Дворянина."
  }
];

const PREFIX_INDEX = Object.fromEntries(PREFIXES.map((entry, index) => [entry.name, index]));

const NOBLE_ASSIGNABLE = new Set(["Стражник", "Купец", "Дружинник"]);
const ADVISOR_MAX_INDEX = PREFIX_INDEX["Дворянин"];

export function getPrefixInfoBody() {
  return PREFIXES.map((prefix) => `§6${prefix.name}§r\n${prefix.description}\n§7Доступ: ${prefix.access}`).join("\n\n");
}

export function getPlayerRole(data, playerName, settlement) {
  if (!settlement) return undefined;
  if (samePlayerName(settlement.creatorName, playerName)) {
    return settlement.creatorPrefix ?? "Староста";
  }
  const memberName = Object.keys(settlement.members || {}).find((name) => samePlayerName(name, playerName));
  return memberName ? settlement.members[memberName]?.prefix : undefined;
}

export function isSettlementOwner(playerName, settlement) {
  return samePlayerName(settlement.creatorName, playerName);
}

export function canAssignPrefix(assignerRole, isOwner, targetPrefixName) {
  if (isOwner) return true;
  if (assignerRole === "Советник") {
    const targetIndex = PREFIX_INDEX[targetPrefixName];
    return targetIndex !== undefined && targetIndex <= ADVISOR_MAX_INDEX;
  }
  if (assignerRole === "Дворянин") return NOBLE_ASSIGNABLE.has(targetPrefixName);
  return false;
}

export function getAssignablePrefixes(assignerRole, isOwner) {
  if (isOwner) return PREFIXES.map((entry) => entry.name);
  if (assignerRole === "Советник") return PREFIXES.slice(0, ADVISOR_MAX_INDEX + 1).map((entry) => entry.name);
  if (assignerRole === "Дворянин") return PREFIXES.filter((entry) => NOBLE_ASSIGNABLE.has(entry.name)).map((entry) => entry.name);
  return [];
}

export function isSettlementMember(playerName, settlement) {
  if (!settlement) return false;
  if (isSettlementOwner(playerName, settlement)) return true;
  return Object.keys(settlement.members || {}).some((name) => samePlayerName(name, playerName));
}

export function canManageResidents(data, playerName, settlement) {
  return isSettlementOwner(playerName, settlement) || getPlayerRole(data, playerName, settlement) === "Советник";
}

export function canOpenMintWorkshop(data, playerName, settlement) {
  if (!isSettlementMember(playerName, settlement)) return false;
  return canManageResidents(data, playerName, settlement);
}

export function canBreakMintWorkshop(data, playerName, settlement) {
  if (!isSettlementMember(playerName, settlement)) return false;
  if (isSettlementOwner(playerName, settlement)) return true;
  const role = getPlayerRole(data, playerName, settlement);
  return role === "Советник" || role === "Дворянин";
}

export function getMintWorkshopDeniedMessage(data, playerName, settlement, action) {
  if (!settlement || !isSettlementMember(playerName, settlement)) {
    return "§cЧужаки не могут взаимодействовать с чеканным двором.";
  }
  if (action === "open") {
    return "§cЧеканный двор могут открывать только создатель и Советник поселения.";
  }
  return "§cСломать чеканный двор могут только создатель, Советник и Дворянин этого поселения.";
}

export function canManagePrefixes(data, playerName, settlement) {
  const role = getPlayerRole(data, playerName, settlement);
  return isSettlementOwner(playerName, settlement) || role === "Советник" || role === "Дворянин";
}

export function canAccessConstruction(data, playerName, settlement) {
  if (isSettlementOwner(playerName, settlement)) return true;
  const role = getPlayerRole(data, playerName, settlement);
  return role === "Ремесленник" || role === "Рыцарь" || role === "Дворянин" || role === "Советник";
}

export function canAccessTrade(data, playerName, settlement) {
  if (isSettlementOwner(playerName, settlement)) return true;
  const role = getPlayerRole(data, playerName, settlement);
  return role === "Купец" || role === "Рыцарь" || role === "Дворянин" || role === "Советник";
}

export function canWithdrawTradeCoins(data, playerName, settlement) {
  if (isSettlementOwner(playerName, settlement)) return true;
  const role = getPlayerRole(data, playerName, settlement);
  return role === "Дворянин" || role === "Советник";
}

export function canBuyKnights(data, playerName, settlement) {
  if (isSettlementOwner(playerName, settlement)) return true;
  const role = getPlayerRole(data, playerName, settlement);
  return role === "Рыцарь" || role === "Дворянин" || role === "Советник";
}

export function canCommandArmy(data, playerName, settlement) {
  if (isSettlementOwner(playerName, settlement)) return true;
  const role = getPlayerRole(data, playerName, settlement);
  return role === "Стражник" || role === "Рыцарь" || role === "Дворянин" || role === "Советник";
}

export function getMaxSummonCount(data, playerName, settlement, owned, globalMax) {
  if (!canCommandArmy(data, playerName, settlement)) return 0;
  if (isSettlementOwner(playerName, settlement)) return Math.min(globalMax, owned);
  const role = getPlayerRole(data, playerName, settlement);
  if (role === "Дворянин") return Math.min(2, owned, globalMax);
  return Math.min(globalMax, owned);
}

export function canAccessDiplomacy(data, playerName, settlement) {
  return isSettlementOwner(playerName, settlement) || getPlayerRole(data, playerName, settlement) === "Советник";
}

export function canDeclareWar(data, playerName, settlement) {
  return isSettlementOwner(playerName, settlement) || getPlayerRole(data, playerName, settlement) === "Советник";
}

export function canDisbandSettlement(data, playerName, settlement) {
  return isSettlementOwner(playerName, settlement);
}

export function canDisbandAlliance(data, playerName, settlement) {
  return isSettlementOwner(playerName, settlement);
}

export function canUpgradeSettlement(data, playerName, settlement) {
  return isSettlementOwner(playerName, settlement) || getPlayerRole(data, playerName, settlement) === "Советник";
}

export function canClaimTax(data, playerName, settlement) {
  return isSettlementOwner(playerName, settlement) || getPlayerRole(data, playerName, settlement) === "Советник";
}

export function canCaptureChunks(data, playerName, settlement) {
  return isSettlementOwner(playerName, settlement) || getPlayerRole(data, playerName, settlement) === "Советник";
}

function samePlayerName(first, second) {
  return String(first ?? "").trim().toLowerCase() === String(second ?? "").trim().toLowerCase();
}
