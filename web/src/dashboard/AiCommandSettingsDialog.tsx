import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import {
  DEFAULT_AI_SETTINGS,
  dispatchAiSettingsChanged,
  hasLegacyWidgetAiConfig,
  isAiConfigured,
  parseLegacyWidgetAiConfig,
  type AiSettings,
} from "@/lib/ai-settings";

interface AiCommandSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legacyConfigJson?: string | null;
  onLegacyMigrated?: () => void;
}

export function AiCommandSettingsDialog({
  open,
  onOpenChange,
  legacyConfigJson,
  onLegacyMigrated,
}: AiCommandSettingsDialogProps) {
  const t = useT();
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_AI_SETTINGS.apiBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_AI_SETTINGS.model);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void api
      .getAiSettings()
      .then(async ({ settings }) => {
        if (cancelled) return;

        if (
          !isAiConfigured(settings) &&
          hasLegacyWidgetAiConfig(legacyConfigJson)
        ) {
          const legacy = parseLegacyWidgetAiConfig(legacyConfigJson);
          const migrated = await api.updateAiSettings(legacy);
          if (cancelled) return;
          onLegacyMigrated?.();
          dispatchAiSettingsChanged();
          setApiBaseUrl(migrated.settings.apiBaseUrl);
          setApiKey(migrated.settings.apiKey);
          setModel(migrated.settings.model);
          return;
        }

        setApiBaseUrl(settings.apiBaseUrl);
        setApiKey(settings.apiKey);
        setModel(settings.model);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("ai.settingsLoadFailed"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [legacyConfigJson, onLegacyMigrated, open, t]);

  if (!open) return null;

  const handleClose = () => onOpenChange(false);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload: AiSettings = { apiBaseUrl, apiKey, model };
    void api
      .updateAiSettings(payload)
      .then(({ settings }) => {
        setApiBaseUrl(settings.apiBaseUrl);
        setApiKey(settings.apiKey);
        setModel(settings.model);
        dispatchAiSettingsChanged();
        onOpenChange(false);
      })
      .catch((saveError) => {
        setError(
          saveError instanceof Error
            ? saveError.message
            : t("ai.settingsSaveFailed"),
        );
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("ai.settingsTitle")}</h2>
        <Button variant="ghost" onClick={handleClose}>
          {t("common.close")}
        </Button>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          {t("ai.settingsHint")}
        </p>

        {loading ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {t("ai.settingsLoading")}
          </p>
        ) : (
          <>
            <div className="grid gap-2">
              <Label htmlFor="ai-widget-api-base">{t("ai.apiBaseUrl")}</Label>
              <Input
                id="ai-widget-api-base"
                placeholder={DEFAULT_AI_SETTINGS.apiBaseUrl}
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
              />
              <p className="text-[11px] text-[var(--color-muted-foreground)]">
                {t("ai.apiBaseUrlHint")}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ai-widget-api-key">{t("ai.apiKey")}</Label>
              <Input
                id="ai-widget-api-key"
                type="password"
                autoComplete="off"
                placeholder={t("ai.apiKeyPlaceholder")}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ai-widget-model">{t("ai.model")}</Label>
              <Input
                id="ai-widget-model"
                placeholder={DEFAULT_AI_SETTINGS.model}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
              <p className="text-[11px] text-[var(--color-muted-foreground)]">
                {t("ai.modelHint")}
              </p>
            </div>
          </>
        )}

        {error && (
          <p className="text-sm text-[var(--color-destructive)]">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={loading || saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
