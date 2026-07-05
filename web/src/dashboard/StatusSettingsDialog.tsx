import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import {
  BANDWIDTH_HISTORY_MS,
  getBandwidthMaxSlots,
  MAX_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  parseStatusWidgetConfig,
  serializeStatusWidgetConfig,
} from "@/lib/status-widget-config";

interface StatusSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configJson: string | null;
  titleKey?: string;
  onSaved: (configJson: string) => void;
}

export function StatusSettingsDialog({
  open,
  onOpenChange,
  configJson,
  titleKey = "status.settingsTitle",
  onSaved,
}: StatusSettingsDialogProps) {
  const t = useT();
  const [seconds, setSeconds] = useState("5");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const current = parseStatusWidgetConfig(configJson);
    setSeconds(String(current.pollIntervalMs / 1000));
    setError(null);
  }, [open, configJson]);

  if (!open) return null;

  const handleClose = () => {
    setError(null);
    onOpenChange(false);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t("status.pollIntervalInvalid"));
      return;
    }

    const pollIntervalMs = Math.round(value * 1000);
    const minSeconds = MIN_POLL_INTERVAL_MS / 1000;
    const maxSeconds = MAX_POLL_INTERVAL_MS / 1000;
    if (pollIntervalMs < MIN_POLL_INTERVAL_MS) {
      setError(t("status.pollIntervalTooSmall", { min: minSeconds }));
      return;
    }
    if (pollIntervalMs > MAX_POLL_INTERVAL_MS) {
      setError(t("status.pollIntervalTooLarge", { max: maxSeconds }));
      return;
    }

    onSaved(serializeStatusWidgetConfig({ pollIntervalMs }));
    onOpenChange(false);
  };

  const previewMs = Number(seconds) > 0 ? Math.round(Number(seconds) * 1000) : 0;
  const previewSlots =
    previewMs >= MIN_POLL_INTERVAL_MS && previewMs <= MAX_POLL_INTERVAL_MS
      ? getBandwidthMaxSlots(previewMs)
      : null;

  const historyMinutes = BANDWIDTH_HISTORY_MS / 60000;
  const minSeconds = MIN_POLL_INTERVAL_MS / 1000;
  const maxSeconds = MAX_POLL_INTERVAL_MS / 1000;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t(titleKey)}</h2>
        <Button variant="ghost" onClick={handleClose}>
          {t("common.close")}
        </Button>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="statusPollInterval">{t("status.pollInterval")}</Label>
            <Input
              id="statusPollInterval"
              inputMode="decimal"
              min={minSeconds}
              max={maxSeconds}
              required
              step={1}
              type="number"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
            />
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              {t("status.pollIntervalHelp", {
                min: minSeconds,
                max: maxSeconds,
                minutes: historyMinutes,
                slots:
                  previewSlots !== null
                    ? t("status.pollSlots", { count: previewSlots })
                    : "",
              })}
            </p>
          </div>

          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </div>
        </form>
    </Modal>
  );
}
