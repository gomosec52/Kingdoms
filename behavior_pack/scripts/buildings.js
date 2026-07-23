/**
 * Каталог построек поселения.
 * cost — материалы на покупку/размещение.
 * taxBonus — добавка к налогу каждые 25 мин.
 * footprint — размер площадки (ширина x глубина), высота по схеме.
 */

export const BUILDINGS = {
  bakery: {
    id: "bakery",
    name: "Пекарня",
    description: "Небольшая пекарня. Даёт скромный бонус к налогу поселения.",
    taxBonus: 2,
    maxPerSettlement: 1,
    /** Ширина (X) и глубина (Z) относительно точки клика. */
    size: { width: 5, depth: 5, height: 4 },
    cost: [
      { itemId: "minecraft:emerald", amount: 10, label: "изумруды" },
      { itemId: "minecraft:oak_log", amount: 24, label: "дубовые брёвна" },
      { itemId: "minecraft:cobblestone", amount: 16, label: "булыжник" },
      { itemId: "minecraft:oak_planks", amount: 20, label: "дубовые доски" },
      { itemId: "minecraft:glass", amount: 4, label: "стекло" },
      { itemId: "minecraft:wheat", amount: 8, label: "пшеница" }
    ]
  }
};

export function getBuildingDef(buildingId) {
  return BUILDINGS[buildingId];
}

export function listBuildings() {
  return Object.values(BUILDINGS);
}

export function formatBuildingCost(def) {
  return (def.cost || [])
    .map((entry) => `${entry.amount} ${entry.label}`)
    .join(", ");
}

export function countBuildingsOfType(settlement, buildingId) {
  return (settlement.buildings || []).filter((b) => b.type === buildingId).length;
}

export function getExtraIncomeBonus(settlement) {
  let total = 0;
  for (const placed of settlement.buildings || []) {
    const def = BUILDINGS[placed.type];
    if (def) total += Number(def.taxBonus || 0);
  }
  return total;
}

export function formatExtraIncomeLine(settlement) {
  const buildings = settlement.buildings || [];
  if (!buildings.length) return "Доп заработок: нет";

  const parts = [];
  for (const placed of buildings) {
    const def = BUILDINGS[placed.type];
    if (!def) continue;
    parts.push(`${def.name} (+${def.taxBonus})`);
  }
  if (!parts.length) return "Доп заработок: нет";
  return `Доп заработок: ${parts.join(", ")}`;
}

/**
 * Схема пекарни: локальные координаты относительно угла (0,0,0).
 * y = 0 — пол.
 */
export function getBakeryBlueprint() {
  const blocks = [];
  const W = 5;
  const D = 5;

  const put = (x, y, z, typeId) => {
    blocks.push({ x, y, z, typeId });
  };

  // Пол
  for (let x = 0; x < W; x += 1) {
    for (let z = 0; z < D; z += 1) {
      put(x, 0, z, "minecraft:oak_planks");
    }
  }

  // Стены 1 уровня
  for (let x = 0; x < W; x += 1) {
    for (let z = 0; z < D; z += 1) {
      const edge = x === 0 || z === 0 || x === W - 1 || z === D - 1;
      if (!edge) continue;
      // Дверной проём спереди по центру
      if (z === 0 && x === 2) continue;
      put(x, 1, z, "minecraft:oak_log");
    }
  }

  // Окна / второй уровень стен
  for (let x = 0; x < W; x += 1) {
    for (let z = 0; z < D; z += 1) {
      const edge = x === 0 || z === 0 || x === W - 1 || z === D - 1;
      if (!edge) continue;
      if (z === 0 && x === 2) continue;
      if ((x === 0 || x === W - 1) && z === 2) {
        put(x, 2, z, "minecraft:glass");
      } else {
        put(x, 2, z, "minecraft:cobblestone");
      }
    }
  }

  // Крыша (плиты — без ориентации)
  for (let x = 0; x < W; x += 1) {
    for (let z = 0; z < D; z += 1) {
      put(x, 3, z, "minecraft:oak_slab");
    }
  }

  // Интерьер
  put(1, 1, 3, "minecraft:furnace");
  put(3, 1, 3, "minecraft:smoker");
  put(2, 1, 3, "minecraft:crafting_table");
  put(1, 1, 1, "minecraft:barrel");
  put(3, 1, 1, "minecraft:hay_block");

  return blocks;
}

export function getBlueprint(buildingId) {
  if (buildingId === "bakery") return getBakeryBlueprint();
  return [];
}
