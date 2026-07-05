import type { Locale } from "@/i18n/locales/index";
import {
  BACKGROUND_STORAGE_KEY,
  GRID_MARGIN_STORAGE_KEY,
  WIDGET_OPACITY_STORAGE_KEY,
} from "@/theme/personalization";
import { THEME_STORAGE_KEY } from "@/theme/theme";
import { TERMINAL_THEME_STORAGE_KEY } from "@/theme/terminal-theme";

export const LOCALE_STORAGE_KEY = "ternssh-locale";
export const TERMINAL_HISTORY_STORAGE_KEY = "ternssh-terminal-history";

export const APP_SETTINGS_STORAGE_KEYS = [
  LOCALE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  BACKGROUND_STORAGE_KEY,
  WIDGET_OPACITY_STORAGE_KEY,
  GRID_MARGIN_STORAGE_KEY,
  TERMINAL_THEME_STORAGE_KEY,
  TERMINAL_HISTORY_STORAGE_KEY,
] as const;

export function clearAppSettingsStorage(): void {
  for (const key of APP_SETTINGS_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
}

export function detectDefaultLocale(): Locale {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export const SETTINGS_RESET_EVENT = "ternssh:settings-reset";

export function dispatchSettingsResetEvent(): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_RESET_EVENT));
}
