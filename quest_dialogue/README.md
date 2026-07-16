# Quest Dialogue NPCs

Аддон NPC с квестами и RPG-диалогом (низ экрана).

## Установка

1. Скачай **`QuestDialogue-Reloaded-v1.2.0.mcaddon`**
2. Импортируй в Minecraft Bedrock 1.26.20+
3. Включи **оба** пака (behavior + resource) в мире
4. Если одновременно стоит **Kingdoms Wars** — поставь его resource pack **выше** Quest Dialogue RP в списке (иначе UI может не открыться)
5. `/give @s quests:npc_spawner` и поставь NPC

## Что уже есть

1. **Кастомная модель/скин** — заглушка, меняй файлы в RP
2. **Звук в радиусе 10 блоков** при приближении
3. **Нельзя ударить / толкнуть** NPC
4. **RPG UI** снизу (~1/4 экрана, полупрозрачный серый)
   - текст реплики
   - справа снизу «Далее»
   - на этапе квеста — «Принять» / «Отклонить»
5. **Озвучка до кнопок**: играет `voice`, ждёт `voiceSeconds`, только потом форма с кнопками

## Как редактировать (главное)

Файл: `behavior_pack/scripts/config.js`

- Текст реплик: `lines[].text`
- Звук реплики: `lines[].voice`
- Длительность до кнопок: `lines[].voiceSeconds`
- Новый NPC: скопируй профиль (`elder` / `merchant`) с новым id
- Назначить профиль поставленному NPC:

```
/tag @e[type=quests:npc,c=1] add npc_profile:merchant
```

### Свои звуки

1. Положи `.ogg` в `resource_pack/sounds/quests/`
2. Они уже намечены в `sound_definitions.json`
3. В `config.js` поставь например `voice: "quests.npc.line1"`

### Своя модель

- `resource_pack/models/entity/quest_npc.geo.json`
- `resource_pack/textures/entity/quest_npc.png`
- `resource_pack/entity/quest_npc.entity.json`

## Сдача квеста

Если квест принят, повторный разговор с NPC:

- мало предметов → текст «не хватает» + кнопка «Понятно»
- хватает предметов → кнопка **«Завершить»** (забирает предметы, выдаёт награду, снимает тег квеста)

Настрой `requireItem`, `requireCount`, `rewardItem`, `rewardCount` в `config.js`.
