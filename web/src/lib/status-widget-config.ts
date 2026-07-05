export const DEFAULT_POLL_INTERVAL_MS = 5000;
export const MIN_POLL_INTERVAL_MS = 3000;
export const MAX_POLL_INTERVAL_MS = 60000;
export const BANDWIDTH_HISTORY_MS = 2 * 60 * 1000;

export interface StatusWidgetConfig {
  pollIntervalMs: number;
}

const DEFAULT_CONFIG: StatusWidgetConfig = {
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
};

function clampPollIntervalMs(value: number): number {
  return Math.min(
    MAX_POLL_INTERVAL_MS,
    Math.max(MIN_POLL_INTERVAL_MS, Math.round(value)),
  );
}

export function parseStatusWidgetConfig(
  configJson: string | null | undefined,
): StatusWidgetConfig {
  if (!configJson) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(configJson) as Partial<StatusWidgetConfig>;
    if (typeof parsed.pollIntervalMs !== "number") return DEFAULT_CONFIG;
    return { pollIntervalMs: clampPollIntervalMs(parsed.pollIntervalMs) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function serializeStatusWidgetConfig(
  config: StatusWidgetConfig,
): string {
  return JSON.stringify({
    pollIntervalMs: clampPollIntervalMs(config.pollIntervalMs),
  });
}

export function getBandwidthMaxSlots(pollIntervalMs: number): number {
  return Math.max(1, Math.floor(BANDWIDTH_HISTORY_MS / pollIntervalMs));
}

export function formatPollIntervalLabel(
  pollIntervalMs: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const count =
    pollIntervalMs % 1000 === 0
      ? pollIntervalMs / 1000
      : Number((pollIntervalMs / 1000).toFixed(1));
  return t("common.seconds", { count });
}
