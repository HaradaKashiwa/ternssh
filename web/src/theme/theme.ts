export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "ternssh-theme";
export const DEFAULT_THEME_MODE: ThemeMode = "system";

export interface ThemeOption {
  id: ThemeMode;
  labelKey: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "system", labelKey: "header.themeSystem" },
  { id: "light", labelKey: "header.themeLight" },
  { id: "dark", labelKey: "header.themeDark" },
];

export function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return getSystemTheme();
  return mode;
}

export function getStoredThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return DEFAULT_THEME_MODE;
}

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export { getTerminalTheme } from "./terminal-theme";
