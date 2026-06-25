export const FLAG_ITEM = "kingdoms:flag";
export const FLAG_ENTITY = "kingdoms:flag";
export const LEGACY_FLAG_BLOCK = "kingdoms:flag";
export const FLAG_LABEL_ENTITY = "kingdoms:flag_label";
export const FLAG_ITEM_USE_COMPONENT = "kingdoms:flag_placer";

export const STORE_KEY = "kingdoms:data:v1";
export const STORE_LIMIT = 32767;
export const SETTLEMENT_MENU_TITLE = "kingdoms:settlement";

export const CREATION_COST = 15;
export const DAY_TICKS = 24000;
export const TAX_COOLDOWN_TICKS = 25 * 60 * 20;
export const LOOT_WINDOW_TICKS = 5 * 60 * 20;
export const LABEL_TAG = "kingdoms_flag_label";

export const PROTECTED_INTERACTIONS = [
  "minecraft:chest",
  "minecraft:trapped_chest",
  "minecraft:barrel",
  "minecraft:shulker_box",
  "minecraft:white_shulker_box",
  "minecraft:orange_shulker_box",
  "minecraft:magenta_shulker_box",
  "minecraft:light_blue_shulker_box",
  "minecraft:yellow_shulker_box",
  "minecraft:lime_shulker_box",
  "minecraft:pink_shulker_box",
  "minecraft:gray_shulker_box",
  "minecraft:light_gray_shulker_box",
  "minecraft:cyan_shulker_box",
  "minecraft:purple_shulker_box",
  "minecraft:blue_shulker_box",
  "minecraft:brown_shulker_box",
  "minecraft:green_shulker_box",
  "minecraft:red_shulker_box",
  "minecraft:black_shulker_box",
  "minecraft:lever",
  "minecraft:stone_button",
  "minecraft:oak_button",
  "minecraft:spruce_button",
  "minecraft:birch_button",
  "minecraft:jungle_button",
  "minecraft:acacia_button",
  "minecraft:dark_oak_button",
  "minecraft:mangrove_button",
  "minecraft:cherry_button",
  "minecraft:bamboo_button",
  "minecraft:crimson_button",
  "minecraft:warped_button",
  "minecraft:polished_blackstone_button"
];

export const SETTLEMENT_TYPES = [
  { name: "Деревня", hp: 120, radius: 35, tax: 4, minPlayers: 1, defeatReward: 8, upgradeCost: 0 },
  { name: "Большая деревня", hp: 180, radius: 55, tax: 8, minPlayers: 2, defeatReward: 14, upgradeCost: 80 },
  { name: "Городок", hp: 260, radius: 80, tax: 14, minPlayers: 3, defeatReward: 22, upgradeCost: 180 },
  { name: "Большой город", hp: 380, radius: 115, tax: 22, minPlayers: 4, defeatReward: 34, upgradeCost: 400 },
  { name: "Замок", hp: 560, radius: 150, tax: 32, minPlayers: 5, defeatReward: 52, upgradeCost: 800 },
  { name: "Королевство", hp: 780, radius: 220, tax: 44, minPlayers: 7, defeatReward: 80, upgradeCost: 1500 },
  { name: "Империя", hp: 1100, radius: 300, tax: 64, minPlayers: 10, defeatReward: 128, upgradeCost: 2500 }
];

export const PREFIXES = [
  { name: "Крестьянин", description: "Добывает еду, дерево и базовые ресурсы для поселения." },
  { name: "Ремесленник", description: "Создаёт инструменты, блоки, оружие и помогает развивать инфраструктуру." },
  { name: "Стражник", description: "Охраняет ворота, флаг, склады и жителей на территории поселения." },
  { name: "Купец", description: "Ведёт торговлю, доставляет ресурсы и помогает поселению богатеть." },
  { name: "Дружинник", description: "Сражается в походах и защищает союзников во время войны." },
  { name: "Рыцарь", description: "Элитный воин поселения, отвечает за атаки, оборону и честь государства." },
  { name: "Дворянин", description: "Помогает управлять жителями, дипломатией и внутренним порядком." },
  { name: "Советник", description: "Даёт стратегические решения владельцу и координирует развитие." }
];

export const CREATOR_PREFIXES = [
  "Староста",
  "Войт",
  "Посадник",
  "Бургомистр",
  "Кастелян",
  "Король",
  "Император"
];

export function creatorPrefixFor(typeIndex) {
  return CREATOR_PREFIXES[typeIndex] ?? CREATOR_PREFIXES[0];
}
