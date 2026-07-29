import {
  CommandPermissionLevel,
  CustomCommandStatus,
  system
} from "@minecraft/server";

/** @type {Record<string, any> | null} */
let deps = null;

function getPlayerFromOrigin(origin) {
  const player = origin?.initiator ?? origin?.sourceEntity;
  if (!player?.isValid || player.typeId !== "minecraft:player") return undefined;
  return player;
}

function runAsPlayer(origin, fn) {
  const player = getPlayerFromOrigin(origin);
  if (!player) {
    return {
      status: CustomCommandStatus.Failure,
      message: "Команда только для игроков"
    };
  }
  system.run(() => fn(player));
  return { status: CustomCommandStatus.Success };
}

function requireSettlement(player) {
  const data = deps.loadData();
  const playerName = deps.getPlayerName(player);
  const settlement = deps.getPlayerSettlement(data, playerName);
  if (!settlement) {
    player.sendMessage("§c[Королевства] У вас нет поселения. Сначала поставьте флаг.");
    return undefined;
  }
  return { data, playerName, settlement };
}

function warStatusLine(data, settlement, enemyId) {
  const enemy = deps.getSettlement(data, enemyId);
  if (!enemy) return undefined;
  const campaign = deps.findWarCampaignBetween(data, settlement, enemy);
  if (!campaign) return `• ${enemy.name} — объявлена`;
  if (deps.isWarCombatActive(campaign, system.currentTick)) {
    return `• ${enemy.name} — бой`;
  }
  const remaining = deps.getWarPreparationRemaining(campaign, system.currentTick);
  if (remaining > 0) {
    return `• ${enemy.name} — подготовка ${deps.formatCooldownTicks(remaining)}`;
  }
  return `• ${enemy.name} — объявлена`;
}

function cmdWar(player) {
  const context = requireSettlement(player);
  if (!context) return;
  const { data, playerName, settlement } = context;

  if (deps.canDeclareWar(data, playerName, settlement)) {
    deps.openWarMenuFromCommand(player);
    return;
  }

  const wars = (settlement.wars || [])
    .map((enemyId) => warStatusLine(data, settlement, enemyId))
    .filter(Boolean);
  const initiated = (settlement.warInitiatedAgainst || [])
    .map((enemyId) => {
      const enemy = deps.getSettlement(data, enemyId);
      return enemy ? `• вы объявили: ${enemy.name}` : undefined;
    })
    .filter(Boolean);

  const lines = [
    `§6[Королевства] Войны: ${deps.settlementDisplayName(data, settlement)}`,
    wars.length ? wars.join("\n") : "§7Активных войн нет."
  ];
  if (initiated.length) lines.push("", "§eОбъявлены вами:", ...initiated);
  player.sendMessage(lines.join("\n"));
}

function cmdAlly(player) {
  const context = requireSettlement(player);
  if (!context) return;
  const { data, playerName, settlement } = context;

  if (deps.canAccessDiplomacy(data, playerName, settlement)) {
    deps.openDiplomacyMenuFromCommand(player);
    return;
  }

  const alliance = deps.getAlliance(data, settlement.allianceId);
  if (!alliance) {
    player.sendMessage("§7[Королевства] Ваше поселение не состоит в альянсе.");
    return;
  }

  const members = alliance.members
    .map((memberId) => deps.getSettlement(data, memberId))
    .filter(Boolean)
    .map((member) => `${member.name} (${member.creatorName})`);

  player.sendMessage([
    `§6[Королевства] Альянс «${alliance.name}»`,
    members.length ? members.map((line) => `• ${line}`).join("\n") : "§7Нет данных об участниках."
  ].join("\n"));
}

function cmdChunks(player) {
  const context = requireSettlement(player);
  if (!context) return;
  const { data, settlement } = context;

  const total = deps.getTerritoryChunkCount(settlement);
  const captured = deps.countCapturedChunks(settlement);
  const maxCaptured = deps.getMaxCapturedChunks(settlement);

  player.sendMessage([
    `§6[Королевства] Территория: ${deps.settlementDisplayName(data, settlement)}`,
    `§fВсего чанков: §e${total}`,
    `§fЗахвачено: §e${captured}§f/§e${maxCaptured}`,
    `§7Расширяйте границы флагами захвата на своей территории.`
  ].join("\n"));
}

function registerKingdomCommands(initEvent) {
  const registry = initEvent.customCommandRegistry;
  if (!registry?.registerCommand) return;

  const commands = [
    { name: "kingdoms:war", description: "Меню войны или статус", run: cmdWar },
    { name: "kingdoms:ally", description: "Меню дипломатии или альянс", run: cmdAlly },
    { name: "kingdoms:chunks", description: "Информация о чанках поселения", run: cmdChunks }
  ];

  for (const command of commands) {
    registry.registerCommand(
      {
        name: command.name,
        description: command.description,
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false
      },
      (origin) => runAsPlayer(origin, command.run)
    );
  }
}

function bindChatFallback(worldRef) {
  worldRef.beforeEvents?.chatSend?.subscribe((event) => {
    const text = event.message.trim();
    const cmd = text.split(/\s+/)[0]?.toLowerCase();
    const map = {
      "/war": () => cmdWar(event.sender),
      "/ally": () => cmdAlly(event.sender),
      "/chunks": () => cmdChunks(event.sender)
    };
    if (!map[cmd]) return;
    event.cancel = true;
    system.run(() => map[cmd]());
  });
}

export function bindKingdomCommandSystem(bindDeps) {
  deps = bindDeps;
  bindDeps.system.beforeEvents.startup.subscribe(registerKingdomCommands);
  bindChatFallback(bindDeps.world);
}
