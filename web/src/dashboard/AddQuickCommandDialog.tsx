import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import {
  parseQuickCommandsConfig,
  serializeQuickCommandsConfig,
} from "@/lib/quick-commands-config";

interface AddQuickCommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configJson: string | null;
  onAdded: (configJson: string) => void;
}

export function AddQuickCommandDialog({
  open,
  onOpenChange,
  configJson,
  onAdded,
}: AddQuickCommandDialogProps) {
  const t = useT();
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setLabel("");
    setCommand("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextLabel = label.trim();
    const nextCommand = command.replace(/\r\n/g, "\n").trim();
    if (!nextLabel || !nextCommand) {
      setError(t("quickCommands.fillRequired"));
      return;
    }

    const current = parseQuickCommandsConfig(configJson);
    onAdded(
      serializeQuickCommandsConfig({
        ...current,
        customCommands: [
          ...current.customCommands,
          { id: crypto.randomUUID(), label: nextLabel, command: nextCommand },
        ],
      }),
    );
    reset();
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("quickCommands.addTitle")}</h2>
        <Button variant="ghost" onClick={handleClose}>
          {t("common.close")}
        </Button>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-2">
          <Label htmlFor="quickCommandLabel">{t("common.name")}</Label>
          <Input
            id="quickCommandLabel"
            placeholder={t("quickCommands.labelPlaceholder")}
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="quickCommandText">{t("quickCommands.command")}</Label>
          <Textarea
            id="quickCommandText"
            placeholder={t("quickCommands.commandPlaceholder")}
            required
            rows={6}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            {t("quickCommands.multilineHint")}
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
