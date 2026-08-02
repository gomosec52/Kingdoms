---
name: kw-build-bedrock-mod
description: Project-specific guidance for KW Build (Kingdoms Wars) Bedrock add-on v1.12.x. Use when editing behavior_pack/scripts, economy/territory/war systems, ActionFormData menus, or resource_pack/ui/server_form.json for the medieval settlement UI (parchment panel, icon grid, multi-page routing).
paths:
  - "behavior_pack/**"
  - "resource_pack/ui/**"
  - "resource_pack/textures/ui/kingdoms/**"
---

# KW Build — Bedrock Mod Conventions

## Project identity

- **Name:** KW Build (Kingdoms Wars)
- **Version:** 1.12.x (modules); header may lag by one patch
- **Engine:** `min_engine_version [1, 26, 20]`
- **Script API:** `@minecraft/server` 2.1.0, `@minecraft/server-ui` 2.0.0
- **Namespace:** `kingdoms:`

## Architecture

### Behavior pack — modular scripts

Entry point: `behavior_pack/scripts/main.js` (~4500 lines). **Do not add large new systems inline** — extract to dedicated modules like existing ones:

| Module | Responsibility |
| --- | --- |
| `constants.js` | Item/entity/block IDs |
| `economy.js` | Copper/silver/gold coins, costs, inventory helpers |
| `territory.js` | Chunk ownership, capture, overlap |
| `war.js` | War campaigns, preparation, combat phases |
| `diplomacy.js` | Alliances |
| `army.js` | Knights, summon, army menu |
| `trade.js` | Trade hub |
| `brewery.js` | Brewery/winery blocks and shop |
| `spawn_guard.js` | Spawn protection core |
| `permissions.js` | Prefixes, roles, action gates |
| `ui.js` | Menu title routing constants |
| `kingdom_commands.js` | `/kingdom` custom commands |
| `teleport_commands.js` | Homes and teleports |
| `flag.js`, `flag_protection.js` | Flag entity and core zone |
| `territory_border.js` | Border visualization |
| `coin_exchange.js`, `crafting.js` | Mint and crafting fallbacks |

New features: export `bindXxxSystem(deps)` or pure helpers; wire in `main.js` startup.

### Data storage

- World dynamic property key: `kingdoms:data:v1`
- JSON limit: 32767 chars — avoid bloating settlement records
- Always use `loadData()` / `saveData()` from main flow; migrate fields defensively in `loadData()`

### Economy rules

- Primary currency: copper coins (`kingdoms:coin_copper`), silver, gold
- Use helpers from `economy.js`: `countCopperValue`, `takeCopperValue`, `giveCopperValue`, `formatCopperValue`
- Do not hardcode emerald costs — legacy emerald references were replaced

## Custom UI — settlement menu

KW uses **JSON UI override** of Bedrock `ActionFormData` (long form), not pure Script UI layout.

### Script side (`behavior_pack/scripts/ui.js`)

Base title token:

```js
export const KINGDOMS_MENU_TITLE = "kingdoms:settlement";

export function kingdomsMenuTitle(page = "main", animate = false) {
  const animSuffix = animate ? "|anim=1" : "";
  return `${KINGDOMS_MENU_TITLE}|page=${page}${animSuffix}`;
}
```

- Pass this string to `ActionFormData().title(kingdomsMenuTitle(...))`
- Pages: `main`, `extra`, `trade`, `mint`, `residents`, `diplomacy`, `construction`, `brewery_shop`, etc. — see `KINGDOMS_MENU_PAGE`
- **Body text** of ActionForm still comes from script (`.body(...)`) — JSON UI replaces shell/buttons, not always the info column text
- Button icons: `textures/ui/kingdoms/icon_*` paths in `.button(label, iconPath)`
- Modal/Message forms stay vanilla — only long-form action menus use custom JSON UI

### Resource pack side (`resource_pack/ui/server_form.json`)

Routing pattern:

1. `long_form` factory shows `kingdoms_long_form_root` when title **contains** `kingdoms:settlement`:
   ```
   (not ((#title_text - 'kingdoms:settlement') = #title_text))
   ```
2. Vanilla form hidden for kingdoms titles; BR quest forms use separate title equality checks
3. Register file in `resource_pack/ui/_ui_defs.json`

Layout skeleton (380×240 parchment panel):

- **Left column (~235px):** info panel — settlement stats from `#form_text` / body binding
- **Right column:** `grid` over `form_buttons` collection — icon buttons from script
- Textures: `textures/ui/kingdoms/parchment_panel`, `info_panel`, `divider`, `panel_shadow`
- Buttons: nineslice JSON + PNG pairs in `textures/ui/kingdoms/button_*.json`
- Close: `button.menu_exit` via `common_buttons.light_text_button`

Sub-pages (trade, mint, coin exchange) may use additional title substring gates, e.g. `coin_exchange`.

### UI design rules for this project

- Medieval parchment aesthetic — warm browns, subtle shadow, no modern flat UI
- Icon grid buttons: consistent size, `font_scale_factor` ≤ 0.8 on labels
- Keep main frame **380×240** unless all pages are updated together
- New menu page = **both** new `KINGDOMS_MENU_PAGE` constant **and** JSON visibility/bindings if layout differs
- BR compatibility: resource pack must load **above** Bedrock Reimagined RP (see `resource_pack/BR_COMPAT.txt`)

## Common Script API patterns in this project

```js
// Defer mutations out of beforeEvents
world.beforeEvents.playerBreakBlock.subscribe((event) => {
  system.run(() => { /* ... */ });
});

// Permission gate before menu actions
if (!canUpgradeSettlement(data, playerName, settlement)) {
  player.sendMessage("§c...");
  return;
}

// Show custom-styled form
await showForm(player, new ActionFormData()
  .title(kingdomsMenuTitle(KINGDOMS_MENU_PAGE.MAIN))
  .body(settlementInfo(data, settlement))
  .button("...", "textures/ui/kingdoms/icon_upgrade"));
```

## Related skills

- **`minecraft-server-scriptapi`** — `@minecraft/server` API, events, components, versioning
- **`mcbe-json-ui-master`** — JSON UI architecture, bindings, pack structure
- **`mcbe-json-ui-server-forms`** — `server_form.json` routing, factory overrides, button grids
- **`mcbe-json-ui-patterns`** — reusable layout patterns

Use project skill for KW-specific title tokens and file layout; use community skills for generic Bedrock API/UI mechanics.

## Build artifact

After changes, bump module version in both manifests and rebuild `KW-Build-vX.Y.Z.mcaddon` (zip containing `behavior_pack/` + `resource_pack/` folders).
