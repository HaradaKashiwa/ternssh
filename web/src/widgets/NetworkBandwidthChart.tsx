import { useT } from "@/i18n";
import { formatBitrate } from "@/lib/server-status";
import {
  BANDWIDTH_HISTORY_MS,
  formatPollIntervalLabel,
} from "@/lib/status-widget-config";
import { MetricBar } from "@/widgets/shared/MetricBar";

export interface BandwidthSample {
  rx: number;
  tx: number;
  at: number;
}

const BANDWIDTH_CHART_HEIGHT_PX = 56;

function barHeightPx(value: number, max: number): number {
  if (max <= 0) return 2;
  return Math.max(2, Math.round((value / max) * BANDWIDTH_CHART_HEIGHT_PX));
}

/** Pad to a fixed slot count; newest samples align to the right. */
function buildBandwidthSlots(
  history: BandwidthSample[],
  maxSlots: number,
): (BandwidthSample | null)[] {
  const slots: (BandwidthSample | null)[] = Array.from(
    { length: maxSlots },
    () => null,
  );
  const filled = history.slice(-maxSlots);
  const offset = maxSlots - filled.length;
  for (let i = 0; i < filled.length; i++) {
    slots[offset + i] = filled[i]!;
  }
  return slots;
}

export interface NetworkBandwidthChartProps {
  rxRate: number | null;
  txRate: number | null;
  history: BandwidthSample[];
  maxSlots: number;
  pollIntervalMs: number;
}

export function NetworkBandwidthChart({
  rxRate,
  txRate,
  history,
  maxSlots,
  pollIntervalMs,
}: NetworkBandwidthChartProps) {
  const t = useT();
  const historyRxMax = Math.max(...history.map((sample) => sample.rx), 0);
  const historyTxMax = Math.max(...history.map((sample) => sample.tx), 0);
  const rxScaleMax = historyRxMax > 0 ? historyRxMax : 1;
  const txScaleMax = historyTxMax > 0 ? historyTxMax : 1;
  const slots = buildBandwidthSlots(history, maxSlots);
  const historyMinutes = BANDWIDTH_HISTORY_MS / 60000;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--color-muted-foreground)]">
          {t("status.bandwidth")}
        </span>
        <span>
          ↓ {formatBitrate(rxRate)} · ↑ {formatBitrate(txRate)}
        </span>
      </div>

      <MetricBar
        label={t("status.download")}
        value={
          rxRate !== null && rxScaleMax > 0
            ? Math.min(100, (rxRate / rxScaleMax) * 100)
            : null
        }
        detail={formatBitrate(rxRate)}
        barClassName="bg-sky-400"
      />
      <MetricBar
        label={t("status.upload")}
        value={
          txRate !== null && txScaleMax > 0
            ? Math.min(100, (txRate / txScaleMax) * 100)
            : null
        }
        detail={formatBitrate(txRate)}
        barClassName="bg-[var(--color-success)]"
      />

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--color-muted-foreground)]">
          <span>
            {t("status.history", {
              minutes: historyMinutes,
              interval: formatPollIntervalLabel(pollIntervalMs, t),
              current: history.length,
              max: maxSlots,
            })}
          </span>
          {history.length > 0 && (
            <span className="truncate text-right">
              {t("status.peak", {
                rx: formatBitrate(historyRxMax || null),
                tx: formatBitrate(historyTxMax || null),
              })}
            </span>
          )}
        </div>
        <div className="h-16 rounded-sm bg-[var(--color-secondary)]/40 p-1">
          <div className="flex h-full items-end gap-px">
            {slots.map((sample, index) => (
              <div
                key={index}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-px"
              >
                {sample ? (
                  <>
                    <div
                      className="w-1/2 bg-sky-400/90 transition-all"
                      style={{
                        height: `${barHeightPx(sample.rx, rxScaleMax)}px`,
                      }}
                      title={t("status.sampleDownload", {
                        time: new Date(sample.at).toLocaleTimeString(),
                        rate: formatBitrate(sample.rx),
                      })}
                    />
                    <div
                      className="w-1/2 bg-[var(--color-success)]/90 transition-all"
                      style={{
                        height: `${barHeightPx(sample.tx, txScaleMax)}px`,
                      }}
                      title={t("status.sampleUpload", {
                        time: new Date(sample.at).toLocaleTimeString(),
                        rate: formatBitrate(sample.tx),
                      })}
                    />
                  </>
                ) : (
                  <>
                    <div className="w-1/2 rounded-sm bg-[var(--color-secondary)]/80" />
                    <div className="w-1/2 rounded-sm bg-[var(--color-secondary)]/80" />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-[var(--color-muted-foreground)]">
          <span>{t("common.minutesAgo", { count: historyMinutes })}</span>
          <span>{t("common.now")}</span>
        </div>
        <div className="flex justify-between text-[10px] text-[var(--color-muted-foreground)]">
          <span>↓ {t("status.download")}</span>
          <span>↑ {t("status.upload")}</span>
        </div>
      </div>
    </div>
  );
}
