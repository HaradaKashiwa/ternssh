import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Send, Sparkles, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { AiCommandError, generateShellCommand } from "@/lib/ai-command";
import {
  AI_SETTINGS_CHANGED_EVENT,
  isAiConfigured,
  type AiSettings,
} from "@/lib/ai-settings";
import { api } from "@/lib/api";
import {
  getPrimarySessionForServer,
  isSessionAlive,
  type ServerSession,
} from "@/lib/sessions";
import { getTerminalHistory } from "@/lib/terminal-suggestions";
import { runTerminalCommand } from "@/lib/terminal-bridge";
import { cn } from "@/lib/utils";

export interface AiCommandWidgetProps {
  activeServerId: string | null;
  activeSessionId: string | null;
  sessions: Record<string, ServerSession>;
}

function sessionStatusLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  status: ServerSession["status"] | undefined,
): string {
  if (!status) return t("common.idle");
  return t(`session.${status}`);
}

export function AiCommandWidget({
  activeServerId,
  activeSessionId,
  sessions,
}: AiCommandWidgetProps) {
  const t = useT();
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const configured = aiSettings ? isAiConfigured(aiSettings) : false;
  const [prompt, setPrompt] = useState("");
  const [generatedCommand, setGeneratedCommand] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);

  const loadSettings = useCallback(() => {
    void api
      .getAiSettings()
      .then(({ settings }) => setAiSettings(settings))
      .catch(() => setAiSettings(null));
  }, []);

  useEffect(() => {
    loadSettings();
    const sync = () => loadSettings();
    window.addEventListener(AI_SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(AI_SETTINGS_CHANGED_EVENT, sync);
  }, [loadSettings]);

  const session =
    activeSessionId && sessions[activeSessionId]?.serverId === activeServerId
      ? sessions[activeSessionId]
      : activeServerId
        ? getPrimarySessionForServer(sessions, activeServerId, activeSessionId)
        : null;
  const alive = session ? isSessionAlive(session.status) : false;
  const canSend = Boolean(activeServerId && alive && generatedCommand.trim());

  const history = useMemo(
    () => (activeServerId ? getTerminalHistory(activeServerId) : []),
    [activeServerId, generatedCommand],
  );

  const handleGenerate = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError(t("ai.promptRequired"));
      return;
    }
    if (!configured) {
      setError(t("ai.notConfigured"));
      return;
    }

    setGenerating(true);
    setError(null);
    setCopied(false);
    setSent(false);

    try {
      const command = await generateShellCommand({
        prompt: trimmedPrompt,
        history,
      });
      setGeneratedCommand(command);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError(
        err instanceof AiCommandError
          ? err.message === "not-a-command"
            ? t("ai.notACommand")
            : err.message
          : err instanceof Error
            ? err.message
            : t("ai.generateFailed"),
      );
    } finally {
      setGenerating(false);
    }
  }, [configured, history, prompt, t]);

  const handleSend = useCallback(() => {
    if (!activeServerId) {
      setError(t("ai.selectServerFirst"));
      return;
    }
    if (!alive || !session) {
      setError(
        t("ai.terminalNotConnected", {
          status: sessionStatusLabel(t, session?.status),
        }),
      );
      return;
    }

    const command = generatedCommand.trim();
    if (!command) {
      setError(t("ai.commandRequired"));
      return;
    }

    const ok = runTerminalCommand(session.sessionId, command);
    if (!ok) {
      setError(t("ai.sendFailed"));
      return;
    }

    setError(null);
    setSent(true);
    window.setTimeout(() => setSent(false), 1200);
  }, [activeServerId, alive, generatedCommand, session, t]);

  const handleCopy = useCallback(async () => {
    const command = generatedCommand.trim();
    if (!command) return;

    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setError(t("ai.copyFailed"));
    }
  }, [generatedCommand, t]);

  const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleGenerate();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
      <div className="shrink-0 space-y-3">
        <div className="flex items-start gap-2 text-[11px] text-[var(--color-muted-foreground)]">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{t("ai.hint")}</p>
        </div>

        {!configured && (
          <p className="rounded border border-[color-mix(in_oklch,var(--color-primary)_25%,transparent)] bg-[color-mix(in_oklch,var(--color-primary)_8%,transparent)] px-2 py-1.5 text-[11px] text-[var(--color-foreground)]">
            {t("ai.configureInHeader")}
          </p>
        )}

        {error && (
          <p className="rounded border border-[color-mix(in_oklch,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-destructive)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--color-destructive)]">
            {error}
          </p>
        )}

        {!activeServerId && (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t("ai.noServer")}
          </p>
        )}

        {activeServerId && !alive && (
          <p className="flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
            <Terminal className="h-3.5 w-3.5 shrink-0" />
            {t("ai.terminalStatus", {
              status: sessionStatusLabel(t, session?.status),
            })}
          </p>
        )}

        <div className="space-y-1.5">
          <label
            className="text-[11px] font-medium text-[var(--color-muted-foreground)]"
            htmlFor="ai-prompt"
          >
            {t("ai.promptLabel")}
          </label>
          <Textarea
            id="ai-prompt"
            className="widget-no-drag min-h-20 resize-y text-xs"
            placeholder={t("ai.promptPlaceholder")}
            value={prompt}
            disabled={generating}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
          />
          <p className="text-[10px] text-[var(--color-muted-foreground)]">
            {t("ai.promptShortcut")}
          </p>
        </div>

        <Button
          className="widget-no-drag w-full"
          disabled={generating || !prompt.trim()}
          onClick={() => void handleGenerate()}
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          {generating ? t("ai.generating") : t("ai.generate")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <label
          className="shrink-0 text-[11px] font-medium text-[var(--color-muted-foreground)]"
          htmlFor="ai-command"
        >
          {t("ai.commandLabel")}
        </label>
        <div className="min-h-0 flex-1">
          <Textarea
            id="ai-command"
            className="widget-no-drag h-full min-h-0 resize-none font-mono text-xs"
            placeholder={t("ai.commandPlaceholder")}
            value={generatedCommand}
            onChange={(event) => {
              setGeneratedCommand(event.target.value);
              setSent(false);
            }}
          />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          className={cn(
            "widget-no-drag h-8 flex-1 text-xs",
            sent && "ring-1 ring-[var(--color-primary)]",
          )}
          disabled={!canSend}
          size="sm"
          variant="default"
          onClick={handleSend}
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {t("ai.sendToTerminal")}
        </Button>
        <Button
          className={cn(
            "widget-no-drag h-8 text-xs",
            copied && "ring-1 ring-[var(--color-primary)]",
          )}
          disabled={!generatedCommand.trim()}
          size="sm"
          variant="secondary"
          onClick={() => void handleCopy()}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          {copied ? t("ai.copied") : t("ai.copy")}
        </Button>
      </div>
    </div>
  );
}
