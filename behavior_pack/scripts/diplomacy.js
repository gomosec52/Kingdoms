import {
  CONDEMNATION_DEMOTE_THRESHOLD_1,
  CONDEMNATION_DEMOTE_THRESHOLD_2,
  CONDEMNATION_TTL_TICKS
} from "./war.js";

/** @type {object | undefined} */
let deps;

export function bindDiplomacySystem(dependencies) {
  deps = dependencies;
}

export function ensureCondemnations(data) {
  if (!Array.isArray(data.condemnations)) data.condemnations = [];
}

export function purgeExpiredCondemnations(data, currentTick = deps?.system?.currentTick ?? 0) {
  ensureCondemnations(data);
  const cutoff = currentTick - CONDEMNATION_TTL_TICKS;
  const before = data.condemnations.length;
  data.condemnations = data.condemnations.filter((entry) => entry.createdTick >= cutoff);
  if (data.condemnations.length !== before) {
    for (const settlement of data.settlements) {
      resetCondemnationDemoteTracking(settlement, data, currentTick);
    }
  }
}

function resetCondemnationDemoteTracking(settlement, data, currentTick) {
  const activeCount = countUniqueCondemners(data, settlement.id, currentTick);
  if (activeCount === 0) {
    settlement.condemnationDemotesApplied = 0;
  }
}

function normalizePlayerName(name) {
  return String(name ?? "").trim().toLowerCase();
}

export function countUniqueCondemners(data, targetSettlementId, currentTick = deps.system.currentTick) {
  purgeExpiredCondemnations(data, currentTick);
  const cutoff = currentTick - CONDEMNATION_TTL_TICKS;
  const players = new Set();
  for (const entry of data.condemnations) {
    if (entry.targetSettlementId !== targetSettlementId) continue;
    if (entry.createdTick < cutoff) continue;
    players.add(normalizePlayerName(entry.fromPlayerName));
  }
  return players.size;
}

export function hasRecentCondemnationByPlayer(data, playerName, targetSettlementId, currentTick = deps.system.currentTick) {
  purgeExpiredCondemnations(data, currentTick);
  const cutoff = currentTick - CONDEMNATION_TTL_TICKS;
  const normalized = normalizePlayerName(playerName);
  return data.condemnations.some((entry) =>
    normalizePlayerName(entry.fromPlayerName) === normalized
    && entry.targetSettlementId === targetSettlementId
    && entry.createdTick >= cutoff);
}

export function formatCondemnationInfoPanel(data, currentTick = deps.system.currentTick) {
  purgeExpiredCondemnations(data, currentTick);
  const lines = [
    "§6Осуждение§r",
    "Каждый игрок может осудить цель 1 раз.",
    "Через 2 дня ваши осуждения снимаются —",
    "можно осудить ту же цель снова.",
    "При массовом осуждении мораль сильно падает,",
    "а при 8+ игроках за 2 дня — тип может снизиться.",
    "При 12+ игроках — до 2 типов ниже.",
    "",
    "§eПоселения с осуждениями (2 дня):§r"
  ];

  const targets = data.settlements
    .map((settlement) => ({
      settlement,
      count: countUniqueCondemners(data, settlement.id, currentTick)
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  if (!targets.length) {
    lines.push("пока нет");
  } else {
    for (const entry of targets.slice(0, 8)) {
      lines.push(`• ${entry.settlement.name}: ${entry.count} осужд.`);
    }
  }

  return lines.join("\n");
}

export function applyCondemnationEffects(data, targetSettlement, currentTick = deps.system.currentTick) {
  const count = countUniqueCondemners(data, targetSettlement.id, currentTick);
  targetSettlement.morale = Math.max(0, (targetSettlement.morale ?? 75) - 4);

  if (count >= 5) {
    targetSettlement.morale = Math.max(0, targetSettlement.morale - 10);
  }

  const demotesApplied = targetSettlement.condemnationDemotesApplied ?? 0;
  let demoteDelta = 0;

  if (count >= CONDEMNATION_DEMOTE_THRESHOLD_2 && demotesApplied < 2) {
    demoteDelta = 2 - demotesApplied;
  } else if (count >= CONDEMNATION_DEMOTE_THRESHOLD_1 && demotesApplied < 1) {
    demoteDelta = 1;
  }

  if (demoteDelta > 0) {
    const beforeType = targetSettlement.typeIndex ?? 0;
    targetSettlement.typeIndex = Math.max(0, beforeType - demoteDelta);
    targetSettlement.condemnationDemotesApplied = demotesApplied + demoteDelta;
    targetSettlement.hp = deps.getMaxHp(targetSettlement);
    targetSettlement.creatorPrefix = deps.creatorPrefixFor(targetSettlement.typeIndex);
    return { demoteDelta, count };
  }

  return { demoteDelta: 0, count };
}

export function recordCondemnation(data, fromSettlement, targetSettlement, playerName, currentTick = deps.system.currentTick) {
  ensureCondemnations(data);
  purgeExpiredCondemnations(data, currentTick);

  if (fromSettlement.id === targetSettlement.id) {
    return { ok: false, message: "§cНельзя осудить своё поселение." };
  }
  if (deps.areAllied(data, fromSettlement.id, targetSettlement.id)) {
    return { ok: false, message: "§cНельзя осудить союзника." };
  }
  if (hasRecentCondemnationByPlayer(data, playerName, targetSettlement.id, currentTick)) {
    return { ok: false, message: "§cВы уже осуждали эту цель. Через 2 дня сможете снова." };
  }

  data.condemnations.push({
    targetSettlementId: targetSettlement.id,
    fromSettlementId: fromSettlement.id,
    fromPlayerName: playerName,
    createdTick: currentTick
  });

  const effect = applyCondemnationEffects(data, targetSettlement, currentTick);
  return { ok: true, effect };
}

export async function openCondemnationMenu(player, settlementId, sessionToken) {
  if (!deps.assertSettlementMenuSession(player, settlementId, sessionToken)) return;
  const data = deps.loadData();
  const settlement = deps.getSettlement(data, settlementId);
  const playerName = deps.getPlayerName(player);
  if (!settlement || !deps.canAccessDiplomacy(data, playerName, settlement)) {
    player.sendMessage("§cОсуждение доступно создателю и Советнику.");
    return deps.openDiplomacyMenu(player, settlementId, sessionToken);
  }

  const currentTick = deps.system.currentTick;
  const infoPanel = formatCondemnationInfoPanel(data, currentTick);
  const targets = data.settlements.filter((candidate) =>
    candidate.id !== settlement.id
    && !deps.areAllied(data, candidate.id, settlement.id));

  if (!targets.length) {
    player.sendMessage("§7Нет поселений для осуждения.");
    return deps.openDiplomacyMenu(player, settlementId, sessionToken);
  }

  const targetLines = targets.map((candidate) => {
    const count = countUniqueCondemners(data, candidate.id, currentTick);
    const suffix = count > 0 ? ` §7[${count} осужд.]` : "";
    return `→ ${deps.settlementType(candidate).name} "${candidate.name}"${suffix}`;
  });

  const body = `${infoPanel}\n\n§eВыберите цель (кнопки справа):§r\n${targetLines.join("\n")}`;
  const form = new deps.ActionFormData()
    .title(deps.kingdomsMenuTitle(deps.KINGDOMS_MENU_PAGE.DIPLOMACY))
    .body(body);

  for (const candidate of targets) {
    const count = countUniqueCondemners(data, candidate.id, currentTick);
    const label = count > 0 ? `${candidate.name} (${count})` : candidate.name;
    form.button(label, "textures/ui/kingdoms/icon_war");
  }
  form.button("Назад", "textures/ui/kingdoms/icon_disband");

  const response = await deps.showFormDeferred(player, form);
  if (response.canceled || response.selection === targets.length) {
    return deps.openDiplomacyMenu(player, settlementId, sessionToken);
  }

  const target = targets[response.selection];
  if (!target) return deps.openDiplomacyMenu(player, settlementId, sessionToken);

  const confirm = await deps.showFormDeferred(player, new deps.MessageFormData()
    .title("Осудить поселение")
    .body(`Вы хотите осудить ${deps.settlementDisplayName(data, target)} по личным или общим причинам?`)
    .button1("Да")
    .button2("Нет"));

  if (confirm.canceled || confirm.selection !== 0) {
    return openCondemnationMenu(player, settlementId, sessionToken);
  }

  const confirmFinal = await deps.showFormDeferred(player, new deps.MessageFormData()
    .title("Подтверждение осуждения")
    .body(`Подтвердите осуждение ${deps.settlementDisplayName(data, target)}.\n\nВаш голос действует 2 дня, затем снимается и вы сможете осудить снова.`)
    .button1("Осудить")
    .button2("Отмена"));

  if (confirmFinal.canceled || confirmFinal.selection !== 0) {
    return openCondemnationMenu(player, settlementId, sessionToken);
  }

  const fresh = deps.loadData();
  const freshSettlement = deps.getSettlement(fresh, settlementId);
  const freshTarget = deps.getSettlement(fresh, target.id);
  if (!freshSettlement || !freshTarget) {
    return deps.openDiplomacyMenu(player, settlementId, sessionToken);
  }

  const result = recordCondemnation(fresh, freshSettlement, freshTarget, playerName, deps.system.currentTick);
  if (!result.ok) {
    player.sendMessage(result.message);
    return openCondemnationMenu(player, settlementId, sessionToken);
  }

  deps.saveData(fresh);
  deps.updateFlagLabelFor(freshTarget, fresh);
  deps.scheduleRefreshSettlementBorders(fresh, freshTarget);

  let message = `§6[Дипломатия] §f${playerName} осудил(а) ${freshTarget.name}. Мораль цели снижена.`;
  if (result.effect?.demoteDelta > 0) {
    message += ` Тип понижен на ${result.effect.demoteDelta}.`;
  }
  deps.world.sendMessage(message);
  player.sendMessage(`§aОсуждение зарегистрировано. Всего осуждений за 2 дня: ${result.effect.count}.`);
  return openCondemnationMenu(player, settlementId, sessionToken);
}
