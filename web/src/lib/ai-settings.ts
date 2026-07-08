export interface AiSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
};

export const AI_SETTINGS_CHANGED_EVENT = "ternssh:ai-settings-changed";

export function dispatchAiSettingsChanged(): void {
  window.dispatchEvent(new CustomEvent(AI_SETTINGS_CHANGED_EVENT));
}

export function isAiConfigured(settings: AiSettings): boolean {
  return Boolean(settings.apiBaseUrl.trim() && settings.apiKey.trim());
}

/** @deprecated Legacy widget config_json — used for one-time migration only. */
export function parseLegacyWidgetAiConfig(
  configJson: string | null | undefined,
): AiSettings {
  if (!configJson) return { ...DEFAULT_AI_SETTINGS };
  try {
    const parsed = JSON.parse(configJson) as Partial<AiSettings>;
    return {
      apiBaseUrl:
        typeof parsed.apiBaseUrl === "string" && parsed.apiBaseUrl.trim()
          ? parsed.apiBaseUrl.trim().replace(/\/+$/, "")
          : DEFAULT_AI_SETTINGS.apiBaseUrl,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model:
        typeof parsed.model === "string" && parsed.model.trim()
          ? parsed.model.trim()
          : DEFAULT_AI_SETTINGS.model,
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function hasLegacyWidgetAiConfig(
  configJson: string | null | undefined,
): boolean {
  return isAiConfigured(parseLegacyWidgetAiConfig(configJson));
}
