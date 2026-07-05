import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { api, type Server, type TreeNode } from "@/lib/api";
import { computeNetRates } from "@/lib/server-status";
import { isSessionAlive, type ServerSession } from "@/lib/sessions";
import {
  BANDWIDTH_HISTORY_MS,
  formatPollIntervalLabel,
  getBandwidthMaxSlots,
} from "@/lib/status-widget-config";
import { cn } from "@/lib/utils";
import {
  NetworkBandwidthChart,
  type BandwidthSample,
} from "@/widgets/NetworkBandwidthChart";

export interface NetworkStatusWidgetProps {
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

function trimBandwidthHistory(
  samples: BandwidthSample[],
  now: number,
): BandwidthSample[] {
  const cutoff = now - BANDWIDTH_HISTORY_MS;
  return samples.filter((sample) => sample.at >= cutoff);
}

export function NetworkStatusWidget({
  activeServerId,
  sessions,
  tree,
  pollIntervalMs,
}: NetworkStatusWidgetProps) {
  const t = useT();
  const session = activeServerId ? sessions[activeServerId] : null;
  const server = activeServerId ? findServer(tree, activeServerId) : null;
  const mountedRef = useRef(true);
  const lastNetSampleRef = useRef<{
    rxBytes: number;
    txBytes: number;
    at: number;
  } | null>(null);
  const [rxRate, setRxRate] = useState<number | null>(null);
  const [txRate, setTxRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [bandwidthHistory, setBandwidthHistory] = useState<BandwidthSample[]>([]);
  const maxBandwidthSlots = getBandwidthMaxSlots(pollIntervalMs);

  const fetchStatus = useCallback(async () => {
    if (!session || session.status !== "open") {
      setRxRate(null);
      setTxRate(null);
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
      const rates = computeNetRates(
        response.metrics.netRxBytes,
        response.metrics.netTxBytes,
        lastNetSampleRef.current,
        at,
      );
      if (rates.sample) {
        lastNetSampleRef.current = rates.sample;
      }

      setRxRate(rates.netRxRate);
      setTxRate(rates.netTxRate);
      setUpdatedAt(response.collectedAt);

      if (rates.netRxRate !== null && rates.netTxRate !== null) {
        setBandwidthHistory((current) =>
          trimBandwidthHistory(
            [
              ...current,
              {
                rx: rates.netRxRate!,
                tx: rates.netTxRate!,
                at,
              },
            ],
            at,
          ),
        );
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : t("status.collectFailed"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [session?.sessionId, session?.status, t]);

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
        {t("network.selectServer")}
      </div>
    );
  }

  const hasRates = rxRate !== null && txRate !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {server?.name ?? t("common.unknownServer")}
          </div>
          <div className="truncate text-[11px] text-[var(--color-muted-foreground)]">
            {server ? `${server.username}@${server.host}:${server.port}` : "-"}
          </div>
          <div className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
            {t("status.sessionStatus", {
              label: t("session.label"),
              status: t(`session.${session.status}`),
            })}
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={loading || !isSessionAlive(session.status)}
          onClick={() => void fetchStatus()}
          title={t("common.refresh")}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {!isSessionAlive(session.status) && (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-[var(--color-muted-foreground)]">
          {t("network.connectFirst")}
        </div>
      )}

      {isSessionAlive(session.status) && error && (
        <div className="alert-destructive px-3 py-2 text-xs">{error}</div>
      )}

      {isSessionAlive(session.status) && hasRates && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <NetworkBandwidthChart
            history={bandwidthHistory}
            maxSlots={maxBandwidthSlots}
            pollIntervalMs={pollIntervalMs}
            rxRate={rxRate}
            txRate={txRate}
          />
        </div>
      )}

      {isSessionAlive(session.status) && loading && !hasRates && !error && (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-[var(--color-muted-foreground)]">
          {t("status.collecting")}
        </div>
      )}

      <div className="border-t border-[var(--color-border)] px-3 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">
        {updatedAt
          ? t("status.updatedAt", {
              time: new Date(updatedAt).toLocaleTimeString(),
              interval: formatPollIntervalLabel(pollIntervalMs, t),
            })
          : t("status.waiting", {
              interval: formatPollIntervalLabel(pollIntervalMs, t),
            })}
      </div>
    </div>
  );
}
