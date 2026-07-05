import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { api, type Server, type TreeNode } from "@/lib/api";
import {
  formatBytes,
  formatPercent,
  type ProcessMetrics,
  type ServerStatusMetrics,
} from "@/lib/server-status";
import { isSessionAlive, type ServerSession } from "@/lib/sessions";
import { formatPollIntervalLabel } from "@/lib/status-widget-config";
import { cn } from "@/lib/utils";

export interface ProcessStatusWidgetProps {
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

function ProcessRow({ process }: { process: ProcessMetrics }) {
  return (
    <tr className="border-b border-[var(--color-border)]/60 last:border-b-0">
      <td className="px-2 py-1.5 tabular-nums">{process.pid}</td>
      <td className="max-w-[72px] truncate px-2 py-1.5" title={process.user}>
        {process.user}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {formatPercent(process.cpuPercent)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {formatPercent(process.memPercent)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {formatBytes(process.rssKb * 1024)}
      </td>
      <td className="px-2 py-1.5">{process.stat}</td>
      <td
        className="max-w-0 truncate px-2 py-1.5"
        title={process.command}
      >
        {process.command}
      </td>
    </tr>
  );
}

export function ProcessStatusWidget({
  activeServerId,
  sessions,
  tree,
  pollIntervalMs,
}: ProcessStatusWidgetProps) {
  const t = useT();
  const session = activeServerId ? sessions[activeServerId] : null;
  const server = activeServerId ? findServer(tree, activeServerId) : null;
  const mountedRef = useRef(true);
  const [metrics, setMetrics] = useState<ServerStatusMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!session || session.status !== "open") {
      setMetrics(null);
      setError(null);
      setUpdatedAt(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.getSessionStatus(session.sessionId);
      if (!mountedRef.current) return;
      setMetrics(response.metrics);
      setUpdatedAt(response.collectedAt);
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
        {t("process.selectServer")}
      </div>
    );
  }

  const processes = metrics?.topProcesses ?? [];
  const hasData = processes.length > 0;

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
          {metrics?.processCount !== null && metrics?.processCount !== undefined && (
            <div className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
              {t("process.processCount", { count: metrics.processCount })}
            </div>
          )}
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
          {t("process.connectFirst")}
        </div>
      )}

      {isSessionAlive(session.status) && error && (
        <div className="alert-destructive px-3 py-2 text-xs">{error}</div>
      )}

      {isSessionAlive(session.status) && hasData && (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="mb-2 text-[10px] text-[var(--color-muted-foreground)]">
            {t("process.topByCpu")}
          </div>
          <table className="w-full min-w-[520px] table-fixed text-[11px]">
            <thead className="sticky top-0 bg-[var(--color-card)] text-[var(--color-muted-foreground)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="w-14 px-2 py-1.5 text-left font-medium">
                  {t("process.pid")}
                </th>
                <th className="w-[72px] px-2 py-1.5 text-left font-medium">
                  {t("process.user")}
                </th>
                <th className="w-14 px-2 py-1.5 text-right font-medium">
                  {t("process.cpu")}
                </th>
                <th className="w-14 px-2 py-1.5 text-right font-medium">
                  {t("process.mem")}
                </th>
                <th className="w-16 px-2 py-1.5 text-right font-medium">
                  {t("process.rss")}
                </th>
                <th className="w-10 px-2 py-1.5 text-left font-medium">
                  {t("process.stat")}
                </th>
                <th className="px-2 py-1.5 text-left font-medium">
                  {t("process.command")}
                </th>
              </tr>
            </thead>
            <tbody>
              {processes.map((process) => (
                <ProcessRow key={process.pid} process={process} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isSessionAlive(session.status) && metrics && !hasData && !error && (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-[var(--color-muted-foreground)]">
          {t("process.empty")}
        </div>
      )}

      {isSessionAlive(session.status) && loading && !metrics && !error && (
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
