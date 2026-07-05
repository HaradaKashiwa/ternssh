import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type Server, type TreeNode } from "@/lib/api";
import {
  computeNetRates,
  formatBitrate,
  formatBytes,
  formatDuration,
  formatLoad,
  type ServerStatusMetrics,
} from "@/lib/server-status";
import {
  isSessionAlive,
  SESSION_STATUS_LABEL,
  type ServerSession,
} from "@/lib/sessions";
import {
  BANDWIDTH_HISTORY_MS,
  formatPollIntervalLabel,
  getBandwidthMaxSlots,
} from "@/lib/status-widget-config";
import { cn } from "@/lib/utils";

export interface StatusWidgetProps {
  activeServerId: string | null;
  sessions: Record<string, ServerSession>;
  tree: TreeNode[];
  pollIntervalMs: number;
}

function findServer(tree: TreeNode[], serverId: string): Server | null {
  for (const node of tree) {
    if (node.type === "server" && node.id === serverId) {
      return node;
    }
    if (node.type === "group") {
      const found = findServer(node.children, serverId);
      if (found) return found;
    }
  }
  return null;
}

function MetricBar({
  label,
  value,
  detail,
  barClassName,
}: {
  label: string;
  value: number | null;
  detail: string;
  barClassName?: string;
}) {
  const percent = value ?? 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--color-muted-foreground)]">{label}</span>
        <span>{detail}</span>
      </div>
      <div className="h-1.5 bg-[var(--color-secondary)]">
        <div
          className={cn(
            "h-full transition-all",
            barClassName ??
              (percent >= 90 ? "bg-red-400" : "bg-[var(--color-primary)]"),
          )}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );
}

interface BandwidthSample {
  rx: number;
  tx: number;
  at: number;
}

const BANDWIDTH_CHART_HEIGHT_PX = 56;

function barHeightPx(value: number, max: number): number {
  if (max <= 0) return 2;
  return Math.max(2, Math.round((value / max) * BANDWIDTH_CHART_HEIGHT_PX));
}

function trimBandwidthHistory(
  samples: BandwidthSample[],
  now: number,
): BandwidthSample[] {
  const cutoff = now - BANDWIDTH_HISTORY_MS;
  return samples.filter((sample) => sample.at >= cutoff);
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

function BandwidthChart({
  rxRate,
  txRate,
  history,
  maxSlots,
  pollIntervalMs,
}: {
  rxRate: number | null;
  txRate: number | null;
  history: BandwidthSample[];
  maxSlots: number;
  pollIntervalMs: number;
}) {
  const historyRxMax = Math.max(...history.map((sample) => sample.rx), 0);
  const historyTxMax = Math.max(...history.map((sample) => sample.tx), 0);
  const rxScaleMax = historyRxMax > 0 ? historyRxMax : 1;
  const txScaleMax = historyTxMax > 0 ? historyTxMax : 1;
  const slots = buildBandwidthSlots(history, maxSlots);
  const historyMinutes = BANDWIDTH_HISTORY_MS / 60000;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--color-muted-foreground)]">带宽</span>
        <span>
          ↓ {formatBitrate(rxRate)} · ↑ {formatBitrate(txRate)}
        </span>
      </div>

      <MetricBar
        label="下载"
        value={
          rxRate !== null && rxScaleMax > 0
            ? Math.min(100, (rxRate / rxScaleMax) * 100)
            : null
        }
        detail={formatBitrate(rxRate)}
        barClassName="bg-sky-400"
      />
      <MetricBar
        label="上传"
        value={
          txRate !== null && txScaleMax > 0
            ? Math.min(100, (txRate / txScaleMax) * 100)
            : null
        }
        detail={formatBitrate(txRate)}
        barClassName="bg-emerald-400"
      />

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--color-muted-foreground)]">
          <span>
            近 {historyMinutes} 分钟 · 每 {formatPollIntervalLabel(pollIntervalMs)} ·{" "}
            {history.length}/{maxSlots} 次采样
          </span>
          {history.length > 0 && (
            <span className="truncate text-right">
              峰值 ↓ {formatBitrate(historyRxMax || null)} · ↑{" "}
              {formatBitrate(historyTxMax || null)}
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
                      title={`${new Date(sample.at).toLocaleTimeString()} 下载 ${formatBitrate(sample.rx)}`}
                    />
                    <div
                      className="w-1/2 bg-emerald-400/90 transition-all"
                      style={{
                        height: `${barHeightPx(sample.tx, txScaleMax)}px`,
                      }}
                      title={`${new Date(sample.at).toLocaleTimeString()} 上传 ${formatBitrate(sample.tx)}`}
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
          <span>{historyMinutes} 分钟前</span>
          <span>现在</span>
        </div>
        <div className="flex justify-between text-[10px] text-[var(--color-muted-foreground)]">
          <span>↓ 下载</span>
          <span>↑ 上传</span>
        </div>
      </div>
    </div>
  );
}

export function StatusWidget({
  activeServerId,
  sessions,
  tree,
  pollIntervalMs,
}: StatusWidgetProps) {
  const session = activeServerId ? sessions[activeServerId] : null;
  const server = activeServerId ? findServer(tree, activeServerId) : null;
  const mountedRef = useRef(true);
  const lastNetSampleRef = useRef<{
    rxBytes: number;
    txBytes: number;
    at: number;
  } | null>(null);
  const [metrics, setMetrics] = useState<ServerStatusMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [bandwidthHistory, setBandwidthHistory] = useState<BandwidthSample[]>([]);
  const maxBandwidthSlots = getBandwidthMaxSlots(pollIntervalMs);

  const fetchStatus = useCallback(async () => {
    if (!session || session.status !== "open") {
      setMetrics(null);
      setError(null);
      setUpdatedAt(null);
      setBandwidthHistory([]);
      lastNetSampleRef.current = null;
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.getSessionStatus(session.sessionId);
      if (!mountedRef.current) return;

      const at = Date.parse(response.collectedAt) || Date.now();
      const { netRxRate, netTxRate, sample } = computeNetRates(
        response.metrics.netRxBytes,
        response.metrics.netTxBytes,
        lastNetSampleRef.current,
        at,
      );
      if (sample) {
        lastNetSampleRef.current = sample;
      }

      const nextMetrics: ServerStatusMetrics = {
        ...response.metrics,
        netRxRate,
        netTxRate,
      };
      setMetrics(nextMetrics);
      setUpdatedAt(response.collectedAt);

      if (netRxRate !== null && netTxRate !== null) {
        setBandwidthHistory((current) =>
          trimBandwidthHistory(
            [
              ...current,
              {
                rx: netRxRate,
                tx: netTxRate,
                at,
              },
            ],
            at,
          ),
        );
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "获取状态失败");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [session?.sessionId, session?.status]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setBandwidthHistory([]);
    lastNetSampleRef.current = null;
  }, [session?.sessionId, pollIntervalMs]);

  useEffect(() => {
    void fetchStatus();
    if (!session || session.status !== "open") return;

    const timer = window.setInterval(() => {
      void fetchStatus();
    }, pollIntervalMs);

    return () => window.clearInterval(timer);
  }, [fetchStatus, pollIntervalMs, session?.sessionId, session?.status]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--color-muted-foreground)]">
        选择或连接服务器以查看状态
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {server?.name ?? "未知服务器"}
          </div>
          <div className="truncate text-[11px] text-[var(--color-muted-foreground)]">
            {server ? `${server.username}@${server.host}:${server.port}` : "-"}
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
            会话：{SESSION_STATUS_LABEL[session.status] ?? session.status}
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={loading || !isSessionAlive(session.status)}
          onClick={() => void fetchStatus()}
          title="刷新"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {!isSessionAlive(session.status) && (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-[var(--color-muted-foreground)]">
          请先连接终端会话后再查看服务器状态
        </div>
      )}

      {isSessionAlive(session.status) && error && (
        <div className="border-b border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {isSessionAlive(session.status) && metrics && (
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div className="bg-[var(--color-secondary)]/50 p-2">
              <div className="text-[var(--color-muted-foreground)]">1 分钟</div>
              <div className="mt-1 text-sm">{formatLoad(metrics.load1)}</div>
            </div>
            <div className="bg-[var(--color-secondary)]/50 p-2">
              <div className="text-[var(--color-muted-foreground)]">5 分钟</div>
              <div className="mt-1 text-sm">{formatLoad(metrics.load5)}</div>
            </div>
            <div className="bg-[var(--color-secondary)]/50 p-2">
              <div className="text-[var(--color-muted-foreground)]">15 分钟</div>
              <div className="mt-1 text-sm">{formatLoad(metrics.load15)}</div>
            </div>
          </div>

          <MetricBar
            label="内存"
            value={metrics.memoryUsedPercent}
            detail={
              metrics.memoryTotal !== null
                ? metrics.memoryUsedPercent !== null
                  ? `${metrics.memoryUsedPercent}% · ${formatBytes(
                      metrics.memoryAvailable,
                    )} 可用 / ${formatBytes(metrics.memoryTotal)}`
                  : `${formatBytes(metrics.memoryAvailable)} 可用 / ${formatBytes(metrics.memoryTotal)}`
                : "-"
            }
          />

          <MetricBar
            label="磁盘 /"
            value={metrics.diskUsedPercent}
            detail={
              metrics.diskUsedPercent !== null
                ? `${metrics.diskUsedPercent}% · ${formatBytes(
                    metrics.diskAvailable,
                  )} 可用 / ${formatBytes(metrics.diskTotal)}`
                : "-"
            }
          />

          <BandwidthChart
            history={bandwidthHistory}
            maxSlots={maxBandwidthSlots}
            pollIntervalMs={pollIntervalMs}
            rxRate={metrics.netRxRate}
            txRate={metrics.netTxRate}
          />

          <div className="grid grid-cols-1 gap-2 text-[11px]">
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-muted-foreground)]">运行时间</span>
              <span>{formatDuration(metrics.uptimeSeconds)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-muted-foreground)]">系统</span>
              <span className="truncate text-right">{metrics.osInfo ?? "-"}</span>
            </div>
          </div>
        </div>
      )}

      {isSessionAlive(session.status) && loading && !metrics && !error && (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-[var(--color-muted-foreground)]">
          正在采集状态...
        </div>
      )}

      <div className="border-t border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">
        {updatedAt
          ? `更新于 ${new Date(updatedAt).toLocaleTimeString()} · 采样 ${formatPollIntervalLabel(pollIntervalMs)}`
          : `等待数据 · 采样 ${formatPollIntervalLabel(pollIntervalMs)}`}
      </div>
    </div>
  );
}
