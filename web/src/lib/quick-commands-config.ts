export interface QuickCommandItem {
  id: string;
  label: string;
  command: string;
}

export type QuickCommandTargetMode = "current" | "all";

export interface QuickCommandsWidgetConfig {
  customCommands: QuickCommandItem[];
  targetMode?: QuickCommandTargetMode;
}

const EMPTY_CONFIG: QuickCommandsWidgetConfig = {
  customCommands: [],
  targetMode: "current",
};

export function parseQuickCommandsConfig(
  configJson: string | null | undefined,
): QuickCommandsWidgetConfig {
  if (!configJson) return EMPTY_CONFIG;
  try {
    const parsed = JSON.parse(configJson) as Partial<QuickCommandsWidgetConfig>;
    if (!Array.isArray(parsed.customCommands)) {
      return {
        customCommands: [],
        targetMode: parsed.targetMode === "all" ? "all" : "current",
      };
    }
    const customCommands = parsed.customCommands
      .filter(
        (item): item is QuickCommandItem =>
          typeof item === "object" &&
          item !== null &&
          typeof item.id === "string" &&
          typeof item.label === "string" &&
          typeof item.command === "string" &&
          item.label.trim().length > 0 &&
          item.command.trim().length > 0,
      )
      .map((item) => ({
        id: item.id,
        label: item.label.trim(),
        command: item.command.replace(/\r\n/g, "\n").trim(),
      }));
    return {
      customCommands,
      targetMode: parsed.targetMode === "all" ? "all" : "current",
    };
  } catch {
    return EMPTY_CONFIG;
  }
}

export function serializeQuickCommandsConfig(
  config: QuickCommandsWidgetConfig,
): string {
  return JSON.stringify(config);
}
