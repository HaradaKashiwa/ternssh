import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  onSaved: (configJson: string) => void;
}

export function StatusSettingsDialog({
  open,
  onOpenChange,
  configJson,
  onSaved,
}: StatusSettingsDialogProps) {
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
      setError("请输入有效的采样间隔");
      return;
    }

    const pollIntervalMs = Math.round(value * 1000);
    if (pollIntervalMs < MIN_POLL_INTERVAL_MS) {
      setError(`采样间隔不能小于 ${MIN_POLL_INTERVAL_MS / 1000} 秒`);
      return;
    }
    if (pollIntervalMs > MAX_POLL_INTERVAL_MS) {
      setError(`采样间隔不能大于 ${MAX_POLL_INTERVAL_MS / 1000} 秒`);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-[var(--color-card)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">服务器状态设置</h2>
          <Button variant="ghost" onClick={handleClose}>
            关闭
          </Button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="statusPollInterval">采样间隔（秒）</Label>
            <Input
              id="statusPollInterval"
              inputMode="decimal"
              min={MIN_POLL_INTERVAL_MS / 1000}
              max={MAX_POLL_INTERVAL_MS / 1000}
              required
              step={1}
              type="number"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
            />
            <p className="text-[11px] text-[var(--color-muted-foreground)]">
              范围 {MIN_POLL_INTERVAL_MS / 1000}–{MAX_POLL_INTERVAL_MS / 1000}{" "}
              秒。带宽图表固定显示近 {BANDWIDTH_HISTORY_MS / 60000}{" "}
              分钟
              {previewSlots !== null
                ? `，当前约 ${previewSlots} 个采样点`
                : ""}
              。
            </p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
