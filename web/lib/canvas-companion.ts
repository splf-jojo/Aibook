export type CompanionMode = "off" | "white" | "teacher";
export const COMPANION_STORAGE_KEY = "canvas_app_companion";
export function companionMode(value: string | null): CompanionMode {
  return value === "off" || value === "teacher" ? value : "white";
}
export const COMPANION_TEXT = {
  ru: { companion: "Компаньон", off: "Выключен", white: "Белый", teacher: "Учитель" },
  en: { companion: "Companion", off: "Off", white: "White", teacher: "Teacher" },
  zh: { companion: "伙伴", off: "关闭", white: "白色", teacher: "老师" },
};
