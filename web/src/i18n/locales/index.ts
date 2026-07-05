import { en } from "./en";
import { zh } from "./zh";
import type { Messages } from "./zh";

export interface LocaleDefinition {
  id: string;
  nativeLabel: string;
  htmlLang: string;
  messages: Messages;
}

export const SUPPORTED_LOCALES: LocaleDefinition[] = [
  {
    id: "zh",
    nativeLabel: "中文",
    htmlLang: "zh-CN",
    messages: zh,
  },
  {
    id: "en",
    nativeLabel: "English",
    htmlLang: "en",
    messages: en,
  },
];

export type Locale = (typeof SUPPORTED_LOCALES)[number]["id"];

const localeById = new Map(SUPPORTED_LOCALES.map((item) => [item.id, item]));

export function isLocale(value: string): value is Locale {
  return localeById.has(value);
}

export function getLocaleDefinition(locale: Locale): LocaleDefinition {
  return localeById.get(locale)!;
}

export function getDefaultLocale(): Locale {
  const stored = localStorage.getItem("ternssh-locale");
  if (stored && isLocale(stored)) return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}
