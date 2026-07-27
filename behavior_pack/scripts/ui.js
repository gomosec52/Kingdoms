export const KINGDOMS_MENU_TITLE = "kingdoms:settlement";

export const KINGDOMS_MENU_PAGE = {
  MAIN: "main",
  EXTRA: "extra",
  TRADE: "trade",
  TRADE_SELL: "trade_sell",
  TRADE_MAIL: "trade_mail",
  TRADE_COINS: "trade_coins",
  RESIDENTS: "residents",
  DIPLOMACY: "diplomacy",
  CREATE: "create",
  PICK: "pick"
};

/** @deprecated Use KINGDOMS_MENU_PAGE */
export const SETTLEMENT_MENU_PAGE = KINGDOMS_MENU_PAGE;

export function kingdomsMenuTitle(page = KINGDOMS_MENU_PAGE.MAIN, animate = false) {
  const animSuffix = animate ? "|anim=1" : "";
  return `${KINGDOMS_MENU_TITLE}|page=${page}${animSuffix}`;
}

/** @deprecated Use kingdomsMenuTitle */
export function settlementMenuTitle(page = KINGDOMS_MENU_PAGE.MAIN, animate = false) {
  return kingdomsMenuTitle(page, animate);
}

export function stripColorCodes(text = "") {
  return String(text).replace(/§./g, "");
}

export function formatResidentsListTwoRows(creatorName, members = {}) {
  const names = [creatorName, ...Object.keys(members)];
  if (!names.length) return "пока никого";

  const mid = Math.ceil(names.length / 2);
  const row1 = names.slice(0, mid).join(", ");
  const row2 = names.slice(mid).join(", ");
  return row2 ? `${row1}\n${row2}` : row1;
}
