import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import type { ServerSession } from "@/lib/sessions";
import { registerTerminalRunner } from "@/lib/terminal-bridge";
import { cn } from "@/lib/utils";
import type { TerminalWidgetProps } from "./types";
import "@xterm/xterm/css/xterm.css";

function decodeWsPayload(data: string | Blob | ArrayBuffer): string | Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof Blob) {
    return data.text();
  }
  return String(data);
}

function parseControlMessage(data: string): {
  kind: "ignore" | "error" | "ready";
  message?: string;
} | null {
  if (!data.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(data) as { type?: string; message?: string };
    if (parsed.type === "error") {
      return { kind: "error", message: parsed.message ?? "连接失败" };
    }
    if (
      parsed.type === "status" &&
      (parsed.message?.includes("Shell 已就绪") ||
        parsed.message?.includes("认证成功"))
    ) {
      return { kind: "ready" };
    }
    return { kind: "ignore" };
  } catch {
    return null;
  }
}

interface SessionPaneProps {
  session: ServerSession;
  active: boolean;
  onStatusChange: (status: ServerSession["status"]) => void;
  onClosed: () => void;
}

function SessionPane({
  session,
  active,
  onStatusChange,
  onClosed,
}: SessionPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const runCommandRef = useRef<(command: string) => boolean>(() => false);
  const onStatusChangeRef = useRef(onStatusChange);
  const onClosedRef = useRef(onClosed);
  onStatusChangeRef.current = onStatusChange;
  onClosedRef.current = onClosed;

  useEffect(() => {
    return registerTerminalRunner(session.serverId, (command) =>
      runCommandRef.current(command),
    );
  }, [session.serverId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#0a0a0a",
        foreground: "#f5f5f5",
        cursor: "#72d4a8",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [session.serverId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}${session.wsUrl}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    onStatusChangeRef.current("connecting");
    terminal.reset();
    terminal.writeln("正在连接 SSH 会话...");

    const sendResize = () => {
      const fitAddon = fitAddonRef.current;
      const term = terminalRef.current;
      if (!fitAddon || !term || ws.readyState !== WebSocket.OPEN) return;
      fitAddon.fit();
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    };

    runCommandRef.current = (command: string) => {
      const term = terminalRef.current;
      const currentWs = wsRef.current;
      if (!term || !currentWs || currentWs.readyState !== WebSocket.OPEN) {
        return false;
      }
      const normalized = command.replace(/\r\n/g, "\n");
      term.write(`${normalized.replace(/\n/g, "\r\n")}\r\n`);
      currentWs.send(`${normalized}\n`);
      return true;
    };

    ws.onopen = () => {
      onStatusChangeRef.current("open");
      sendResize();
    };

    ws.onclose = () => {
      onStatusChangeRef.current("closed");
      terminal.writeln("\r\n会话已断开。");
      onClosedRef.current();
    };

    ws.onerror = () => {
      onStatusChangeRef.current("error");
      terminal.writeln("\r\nWebSocket 连接失败。");
    };

    let ready = false;
    ws.onmessage = (event) => {
      void (async () => {
        const data = await decodeWsPayload(event.data);
        const control = parseControlMessage(data);
        if (control) {
          if (control.kind === "error") {
            onStatusChangeRef.current("error");
            terminal.writeln(`\r\n${control.message ?? "连接失败"}`);
            return;
          }
          if (control.kind === "ready" && !ready) {
            ready = true;
            terminal.reset();
            sendResize();
            return;
          }
          return;
        }
        terminal.write(data);
      })();
    };

    const onData = terminal.onData((input) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(input);
      }
    });

    return () => {
      onData.dispose();
      ws.close();
      wsRef.current = null;
      runCommandRef.current = () => false;
    };
  }, [session.wsUrl, session.serverId]);

  useEffect(() => {
    if (!active) return;
    const fitAddon = fitAddonRef.current;
    const ws = wsRef.current;
    const terminal = terminalRef.current;
    if (!fitAddon || !terminal) return;

    fitAddon.fit();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute inset-0 overflow-hidden bg-[#0a0a0a] p-1",
        !active && "invisible pointer-events-none",
      )}
    />
  );
}

export function TerminalWidget({
  sessions,
  activeServerId,
  onSessionStatusChange,
  onSessionClosed,
  onStatusChange,
}: TerminalWidgetProps) {
  const activeSession = sessions.find(
    (session) => session.serverId === activeServerId,
  );

  useEffect(() => {
    onStatusChange?.(activeSession?.status ?? "idle");
  }, [activeSession?.status, onStatusChange]);

  return (
    <div className="relative flex h-full min-h-0 flex-col p-3">
      {sessions.length === 0 && (
        <p className="mb-2 text-sm text-[var(--color-muted-foreground)]">
          选择服务器并连接以打开会话。已连接的会话可在列表中切换。
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        {sessions.map((session) => (
          <SessionPane
            key={`${session.serverId}:${session.sessionId}`}
            session={session}
            active={session.serverId === activeServerId}
            onStatusChange={(status) =>
              onSessionStatusChange(session.serverId, status)
            }
            onClosed={() => onSessionClosed(session.serverId)}
          />
        ))}
      </div>
    </div>
  );
}
