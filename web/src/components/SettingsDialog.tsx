import { LanguageSelect } from "@/components/LanguageSelect";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const t = useT();

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("header.settings")}</h2>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {t("common.close")}
        </Button>
      </div>

      <div className="space-y-5">
        <section className="space-y-2">
          <LanguageSelect />
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            {t("header.languageHint")}
          </p>
        </section>
      </div>

      <div className="mt-6 flex justify-end">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t("common.close")}
        </Button>
      </div>
    </Modal>
  );
}
