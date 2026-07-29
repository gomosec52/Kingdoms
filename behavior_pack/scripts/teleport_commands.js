import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  system,
  world
} from "@minecraft/server";

const HOMES_PROPERTY = "kingdoms:homes";
const TP_COOLDOWN_PROPERTY = "kingdoms:tp_cooldown_until";
const WORLD_SPAWN_PROPERTY = "kingdoms:world_spawn";
const TP_COOLDOWN_TICKS = 30 * 20;

const DONOR_TAG_10 = "kingdoms_donor_10";
const DONOR_TAG_5 = "kingdoms_donor_5";

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

function flagTeleportLocation(flagPosition) {
  return {
    x: Math.floor(flagPosition.x) + 0.5,
    y: Math.floor(flagPosition.y),
    z: Math.floor(flagPosition.z) + 0.5
  };
}

function getMaxHomes(player) {
  if (player.hasTag(DONOR_TAG_10)) return 10;
  if (player.hasTag(DONOR_TAG_5)) return 5;
  return 2;
}

function readHomes(player) {
  const raw = player.getDynamicProperty(HOMES_PROPERTY);
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeHomes(player, homes) {
  player.setDynamicProperty(HOMES_PROPERTY, JSON.stringify(homes));
}

function normalizeHomeName(raw) {
  const name = String(raw ?? "1").trim();
  return name.length ? name.slice(0, 16) : "1";
}

function getTeleportCooldownRemaining(player) {
  const until = Number(player.getDynamicProperty(TP_COOLDOWN_PROPERTY) ?? 0);
  return Math.max(0, until - system.currentTick);
}

function setTeleportCooldown(player) {
  player.setDynamicProperty(TP_COOLDOWN_PROPERTY, system.currentTick + TP_COOLDOWN_TICKS);
}

function formatCooldownTicks(ticks) {
  const seconds = Math.ceil(ticks / 20);
  if (seconds < 60) return `${seconds} сек.`;
  return `${Math.ceil(seconds / 60)} мин.`;
}

function blockIfCooldown(player) {
  const remaining = getTeleportCooldownRemaining(player);
  if (remaining <= 0) return undefined;
  player.sendMessage(`§e[Королевства] Подождите ${formatCooldownTicks(remaining)} перед следующим телепортом.`);
  return true;
}

function teleportPlayer(player, location, dimensionId) {
  const dimension = deps?.safeDimension?.(dimensionId);
  if (!dimension) {
    player.sendMessage("§c[Королевства] Измерение недоступно.");
    return false;
  }
  try {
    player.teleport(location, { dimension });
    setTeleportCooldown(player);
    return true;
  } catch (_error) {
    player.sendMessage("§c[Королевства] Телепорт не удался.");
    return false;
  }
}

function readWorldSpawn() {
  const raw = world.getDynamicProperty(WORLD_SPAWN_PROPERTY);
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.x !== "number" || typeof parsed.y !== "number" || typeof parsed.z !== "number") {
      return undefined;
    }
    return parsed;
  } catch (_error) {
    return undefined;
  }
}

function writeWorldSpawn(location, dimensionId) {
  world.setDynamicProperty(WORLD_SPAWN_PROPERTY, JSON.stringify({
    x: location.x,
    y: location.y,
    z: location.z,
    dimensionId
  }));
}

function isTeleportAdmin(player) {
  return player.hasTag("kingdoms_admin");
}

function cmdBase(player) {
  if (blockIfCooldown(player)) return;
  const data = deps.loadData();
  const playerName = deps.getPlayerName(player);
  const settlement = deps.getPlayerSettlement(data, playerName);
  if (!settlement) {
    player.sendMessage("§c[Королевства] У вас нет поселения. Сначала поставьте флаг.");
    return;
  }
  const location = flagTeleportLocation(settlement.flag);
  if (teleportPlayer(player, location, settlement.dimensionId)) {
    player.sendMessage(`§a[Королевства] Телепорт к флагу: ${deps.settlementDisplayName(data, settlement)}.`);
  }
}

function cmdSetHome(player, slotName) {
  const name = normalizeHomeName(slotName);
  const maxHomes = getMaxHomes(player);
  const homes = readHomes(player);
  const existing = homes.find((entry) => entry.name === name);
  if (!existing && homes.length >= maxHomes) {
    player.sendMessage(`§c[Королевства] Лимит домов: ${maxHomes}. Удалите точку или получите донат-тег.`);
    return;
  }

  const location = player.location;
  const dimensionId = deps.getDimensionId(player.dimension);
  const entry = {
    name,
    x: location.x,
    y: location.y,
    z: location.z,
    dimensionId
  };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    homes.push(entry);
  }

  writeHomes(player, homes);
  player.sendMessage(`§a[Королевства] Дом «${name}» сохранён (${homes.length}/${maxHomes}).`);
}

function cmdHome(player, slotName) {
  if (blockIfCooldown(player)) return;
  const name = normalizeHomeName(slotName);
  const homes = readHomes(player);
  const entry = homes.find((home) => home.name === name);
  if (!entry) {
    player.sendMessage(`§c[Королевства] Дом «${name}» не найден. Используйте /sethome ${name}`);
    return;
  }
  if (teleportPlayer(player, { x: entry.x, y: entry.y, z: entry.z }, entry.dimensionId)) {
    player.sendMessage(`§a[Королевства] Телепорт домой: «${name}».`);
  }
}

function cmdSpawn(player) {
  if (blockIfCooldown(player)) return;
  const spawn = readWorldSpawn();
  if (!spawn) {
    player.sendMessage("§c[Королевства] Точка спавна не установлена. Админ: /setspawn");
    return;
  }
  if (teleportPlayer(player, { x: spawn.x, y: spawn.y, z: spawn.z }, spawn.dimensionId ?? "overworld")) {
    player.sendMessage("§a[Королевства] Телепорт на спавн.");
  }
}

function cmdSetSpawn(player) {
  if (!isTeleportAdmin(player)) {
    player.sendMessage("§c[Королевства] /setspawn только для админов (тег kingdoms_admin).");
    return;
  }
  const location = player.location;
  const dimensionId = deps.getDimensionId(player.dimension);
  writeWorldSpawn(location, dimensionId);
  player.sendMessage(`§a[Королевства] Спавн установлен: ${Math.floor(location.x)} ${Math.floor(location.y)} ${Math.floor(location.z)} (${dimensionId}).`);
}

function registerTeleportCommands(initEvent) {
  const registry = initEvent.customCommandRegistry;
  if (!registry?.registerCommand) return;

  const playerCommands = [
    {
      name: "kingdoms:base",
      description: "Телепорт к флагу своего поселения",
      run: (player) => cmdBase(player)
    },
    {
      name: "kingdoms:spawn",
      description: "Телепорт на спавн сервера",
      run: (player) => cmdSpawn(player)
    },
    {
      name: "kingdoms:home",
      description: "Телепорт домой",
      run: (player, slot) => cmdHome(player, slot),
      optionalParameters: [{ name: "slot", type: CustomCommandParamType.String }]
    },
    {
      name: "kingdoms:sethome",
      description: "Сохранить точку дома",
      run: (player, slot) => cmdSetHome(player, slot),
      optionalParameters: [{ name: "slot", type: CustomCommandParamType.String }]
    }
  ];

  for (const command of playerCommands) {
    registry.registerCommand(
      {
        name: command.name,
        description: command.description,
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        optionalParameters: command.optionalParameters
      },
      (origin, slot) => runAsPlayer(origin, (player) => command.run(player, slot))
    );
  }

  registry.registerCommand(
    {
      name: "kingdoms:setspawn",
      description: "Установить точку спавна сервера (админ)",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false
    },
    (origin) => runAsPlayer(origin, cmdSetSpawn)
  );
}

function bindChatFallback(worldRef) {
  worldRef.beforeEvents?.chatSend?.subscribe((event) => {
    const text = event.message.trim();
    const args = text.split(/\s+/);
    const cmd = args[0]?.toLowerCase();

    const map = {
      "/base": () => cmdBase(event.sender),
      "/spawn": () => cmdSpawn(event.sender),
      "/home": () => cmdHome(event.sender, args[1]),
      "/sethome": () => cmdSetHome(event.sender, args[1]),
      "/setspawn": () => cmdSetSpawn(event.sender)
    };

    if (!map[cmd]) return;
    event.cancel = true;
    system.run(() => map[cmd]());
  });
}

export function bindTeleportCommandSystem(bindDeps) {
  deps = bindDeps;
  bindDeps.system.beforeEvents.startup.subscribe(registerTeleportCommands);
  bindChatFallback(bindDeps.world);
}

export function getPlayerHomeLimit(player) {
  return getMaxHomes(player);
}
