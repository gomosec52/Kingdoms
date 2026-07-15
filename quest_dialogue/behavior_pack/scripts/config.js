/**
 * ============================================================
 *  QUEST DIALOGUE NPCS — РЕДАКТИРУЙ ЭТОТ ФАЙЛ
 * ============================================================
 *
 * voiceSeconds — пауза ПОСЛЕ старта звука, затем кнопки.
 * Ставь примерно длину своего .ogg (часто 0.4–2 сек).
 *
 * Квест type:"quest":
 *  - Принятие → тег quest:<questId>
 *  - Повторный разговор → кнопка «Завершить» (если хватает предметов)
 */

export const DEFAULT_PROFILE_ID = "elder";
export const DEFAULT_PROXIMITY_RADIUS = 10;
export const DIALOGUE_FORM_TITLE = "quests:dialogue";

export const NPC_PROFILES = {
  elder: {
    name: "§eСтарейшина",
    proximitySound: "note.bell",
    proximityRadius: 10,
    proximityCooldownSeconds: 12,
    lines: [
      {
        text: "§fПривет! Как твои дела, путник?",
        voice: "mob.villager.idle",
        voiceSeconds: 0.5,
        type: "next"
      },
      {
        text: "§fНашему поселению нужна помощь.\nТы как раз вовремя.",
        voice: "mob.villager.haggle",
        voiceSeconds: 0.5,
        type: "next"
      },
      {
        text: "§fПримешь квест?\n§7Собери §a10 дубовых брёвен§7 и вернись.",
        voice: "mob.villager.yes",
        voiceSeconds: 0.6,
        type: "quest",
        questId: "gather_oak",
        requireItem: "minecraft:oak_log",
        requireCount: 10,
        rewardItem: "minecraft:emerald",
        rewardCount: 5,
        acceptText: "§aСпасибо! Жду 10 дубовых брёвен.",
        acceptVoice: "random.orb",
        acceptVoiceSeconds: 0.3,
        declineText: "§7Ничего страшного. Загляни позже.",
        declineVoice: "mob.villager.no",
        declineVoiceSeconds: 0.3,
        readyText: "§fВижу дуб! Готов сдать квест?",
        readyVoice: "mob.villager.yes",
        readyVoiceSeconds: 0.4,
        incompleteText: "§7Тебе нужно ещё дубовых брёвен.\n§8(сейчас: {have}/{need})",
        incompleteVoice: "mob.villager.no",
        incompleteVoiceSeconds: 0.4,
        completeText: "§aОтлично! Вот твоя награда.",
        completeVoice: "random.levelup",
        completeVoiceSeconds: 0.4
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
        voiceSeconds: 0.5,
        type: "next"
      },
      {
        text: "§fПринеси мне §e8 золотых слитков§f.",
        voice: "mob.villager.haggle",
        voiceSeconds: 0.5,
        type: "quest",
        questId: "gather_gold",
        requireItem: "minecraft:gold_ingot",
        requireCount: 8,
        rewardItem: "minecraft:diamond",
        rewardCount: 1,
        acceptText: "§aДоговорились. Удачи!",
        acceptVoice: "random.orb",
        acceptVoiceSeconds: 0.3,
        declineText: "§7Ну как знаешь...",
        declineVoice: "mob.villager.no",
        declineVoiceSeconds: 0.3,
        readyText: "§fЗолото при тебе? Сдаём?",
        readyVoice: "mob.villager.yes",
        readyVoiceSeconds: 0.4,
        incompleteText: "§7Мало золота.\n§8(сейчас: {have}/{need})",
        incompleteVoice: "mob.villager.no",
        incompleteVoiceSeconds: 0.4,
        completeText: "§aВот алмаз за труды!",
        completeVoice: "random.levelup",
        completeVoiceSeconds: 0.4
      }
    ]
  }
};
