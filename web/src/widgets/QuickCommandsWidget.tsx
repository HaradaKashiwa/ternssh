import { useCallback, useMemo, useState } from "react";
import { Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  parseQuickCommandsConfig,
  serializeQuickCommandsConfig,
  type QuickCommandItem,
} from "@/lib/quick-commands-config";
import {
  isSessionAlive,
  SESSION_STATUS_LABEL,
  type ServerSession,
} from "@/lib/sessions";
import { runTerminalCommand } from "@/lib/terminal-bridge";
import { cn } from "@/lib/utils";

export interface QuickCommandsWidgetProps {
  activeServerId: string | null;
  sessions: Record<string, ServerSession>;
  configJson: string | null;
  onConfigChange: (configJson: string) => void;
}

interface PresetCommand {
  label: string;
  command: string;
}

interface PresetCommandGroup {
  title: string;
  commands: PresetCommand[];
}

const PRESET_GROUPS: PresetCommandGroup[] = [
  {
    title: "系统",
    commands: [
      { label: "uptime", command: "uptime" },
      { label: "whoami", command: "whoami" },
      { label: "pwd", command: "pwd" },
    ],
  },
  {
    title: "资源",
    commands: [
      { label: "磁盘", command: "df -h" },
      { label: "内存", command: "free -h" },
    ],
  },
  {
    title: "进程",
    commands: [
      { label: "Top 内存", command: "ps aux --sort=-%mem | head -10" },
      { label: "Top CPU", command: "ps aux --sort=-%cpu | head -10" },
    ],
  },
  {
    title: "Docker",
    commands: [
      { label: "容器列表", command: "docker ps" },
      {
        label: "Compose",
        command: "docker compose ps 2>/dev/null || docker-compose ps",
      },
    ],
  },
  {
    title: "网络",
    commands: [
      { label: "监听端口", command: "ss -tlnp 2>/dev/null || netstat -tlnp" },
    ],
  },
  {
    title: "日志",
    commands: [
      {
        label: "最近日志",
        command:
          "journalctl -n 50 --no-pager 2>/dev/null || tail -n 50 /var/log/syslog 2>/dev/null || dmesg | tail -n 50",
      },
    ],
  },
];

export function QuickCommandsWidget({
  activeServerId,
  sessions,
  configJson,
  onConfigChange,
}: QuickCommandsWidgetProps) {
  const session = activeServerId ? sessions[activeServerId] : null;
  const alive = session ? isSessionAlive(session.status) : false;
  const customCommands = useMemo(
    () => parseQuickCommandsConfig(configJson).customCommands,
    [configJson],
  );
  const [lastRunKey, setLastRunKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveCustomCommands = useCallback(
    (next: QuickCommandItem[]) => {
      onConfigChange(
        serializeQuickCommandsConfig({ customCommands: next }),
      );
    },
    [onConfigChange],
  );

  const handleRun = useCallback(
    (key: string, command: string) => {
      if (!activeServerId) {
        setError("请先在服务器列表中选择一台服务器");
        return;
      }
      if (!alive) {
        setError(
          `终端未连接（${SESSION_STATUS_LABEL[session?.status ?? "idle"]}）`,
        );
        return;
      }

      const ok = runTerminalCommand(activeServerId, command);
      if (!ok) {
        setError("无法发送到终端，请确认终端组件已打开且会话正常");
        return;
      }

      setError(null);
      setLastRunKey(key);
      window.setTimeout(() => setLastRunKey(null), 1200);
    },
    [activeServerId, alive, session?.status],
  );

  const handleDelete = useCallback(
    (id: string) => {
      saveCustomCommands(customCommands.filter((item) => item.id !== id));
    },
    [customCommands, saveCustomCommands],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-start gap-2 text-[11px] text-[var(--color-muted-foreground)]">
        <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>点击命令将在当前选中的服务器终端中执行。</p>
      </div>

      {error && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">
          {error}
        </p>
      )}

      {!activeServerId && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          未选择服务器
        </p>
      )}

      {activeServerId && !alive && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          终端状态：{SESSION_STATUS_LABEL[session?.status ?? "idle"]}
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-[11px] font-medium text-[var(--color-muted-foreground)]">
          我的命令
        </h3>

        {customCommands.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {customCommands.map((item) => (
              <div key={item.id} className="flex items-center gap-1.5">
                <Button
                  className={cn(
                    "h-7 min-w-0 flex-1 justify-start px-2.5 text-xs",
                    lastRunKey === item.id &&
                      "ring-1 ring-[var(--color-primary)]",
                  )}
                  disabled={!alive}
                  size="sm"
                  title={item.command}
                  variant="secondary"
                  onClick={() => handleRun(item.id, item.command)}
                >
                  <span className="truncate">{item.label}</span>
                </Button>
                <Button
                  className="widget-no-drag h-7 w-7 shrink-0 px-0"
                  size="sm"
                  title="删除"
                  variant="ghost"
                  onClick={() => handleDelete(item.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            还没有自定义命令，点击标题栏「添加」创建
          </p>
        )}
      </section>

      <div className="space-y-3">
        {PRESET_GROUPS.map((group) => (
          <section key={group.title} className="space-y-1.5">
            <h3 className="text-[11px] font-medium text-[var(--color-muted-foreground)]">
              {group.title}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {group.commands.map((command) => {
                const key = `preset:${group.title}:${command.label}`;
                return (
                  <Button
                    key={key}
                    className={cn(
                      "h-7 px-2.5 text-xs",
                      lastRunKey === key &&
                        "ring-1 ring-[var(--color-primary)]",
                    )}
                    disabled={!alive}
                    size="sm"
                    variant="secondary"
                    onClick={() => handleRun(key, command.command)}
                  >
                    {command.label}
                  </Button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
