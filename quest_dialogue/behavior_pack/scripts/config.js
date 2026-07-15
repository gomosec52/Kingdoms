/**
 * ============================================================
 *  QUEST DIALOGUE NPCS — РЕДАКТИРУЙ ЭТОТ ФАЙЛ
 * ============================================================
 *
 * Как добавить нового NPC:
 * 1) Скопируй блок в NPC_PROFILES с новым id (например "merchant").
 * 2) Поменяй name, lines[].text, lines[].voice, lines[].voiceSeconds.
 * 3) Для своих звуков: положи .ogg в resource_pack/sounds/quests/
 *    и пропиши в sounds/sound_definitions.json, затем укажи id звука здесь.
 *    Пока стоят ванильные звуки-заглушки для теста тайминга кнопок.
 * 4) Поставь NPC предметом "Поставить NPC квестов".
 * 5) Назначь профиль:
 *      /tag @e[type=quests:npc,c=1] add npc_profile:merchant
 *    (старый тег профиля лучше снять: /tag ... remove npc_profile:elder)
 *
 * Модель / скин (замени сам):
 * - resource_pack/models/entity/quest_npc.geo.json
 * - resource_pack/textures/entity/quest_npc.png
 * - resource_pack/entity/quest_npc.entity.json
 *
 * voiceSeconds — длительность озвучки в секундах.
 * Кнопки появляются ТОЛЬКО после окончания этого времени.
 */

/** Профиль по умолчанию, если у сущности нет тега npc_profile:... */
export const DEFAULT_PROFILE_ID = "elder";

/** Радиус приветственного звука (блоки). */
export const DEFAULT_PROXIMITY_RADIUS = 10;

export const NPC_PROFILES = {
  elder: {
    name: "§eСтарейшина",
    // Заглушка: потом замени на "quests.npc.notice"
    proximitySound: "note.bell",
    proximityRadius: 10,
    proximityCooldownSeconds: 12,
    lines: [
      {
        text: "§fПривет! Как твои дела, путник?",
        voice: "mob.villager.idle",
        voiceSeconds: 2.5,
        type: "next"
      },
      {
        text: "§fНашему поселению нужна помощь.\nТы как раз вовремя.",
        voice: "mob.villager.haggle",
        voiceSeconds: 3.0,
        type: "next"
      },
      {
        text: "§fПримешь квест?\n§7Собери §a10 дубовых брёвен§7 и вернись ко мне.",
        voice: "mob.villager.yes",
        voiceSeconds: 3.5,
        type: "quest",
        questId: "gather_oak",
        acceptText: "§aСпасибо! Жду 10 дубовых брёвен.",
        acceptVoice: "random.orb",
        acceptVoiceSeconds: 1.5,
        declineText: "§7Ничего страшного. Загляни позже.",
        declineVoice: "mob.villager.no",
        declineVoiceSeconds: 1.5
      }
    ]
  },

  merchant: {
    name: "§6Торговец",
    proximitySound: "note.hat",
    proximityRadius: 10,
    proximityCooldownSeconds: 12,
    lines: [
      {
        text: "§fЭй! Не интересуют редкие товары?",
        voice: "mob.villager.idle",
        voiceSeconds: 2.0,
        type: "next"
      },
      {
        text: "§fПринеси мне §e8 золотых слитков§f —\nи получишь награду.",
        voice: "mob.villager.haggle",
        voiceSeconds: 3.0,
        type: "quest",
        questId: "gather_gold",
        acceptText: "§aДоговорились. Удачи в поисках!",
        acceptVoice: "random.orb",
        acceptVoiceSeconds: 1.5,
        declineText: "§7Ну как знаешь...",
        declineVoice: "mob.villager.no",
        declineVoiceSeconds: 1.5
      }
    ]
  }
};

/** Текст скрытого заголовка формы — не меняй, если не трогаешь UI. */
export const DIALOGUE_FORM_TITLE = "quests:dialogue";
