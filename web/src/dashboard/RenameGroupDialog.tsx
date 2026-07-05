import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import { api } from "@/lib/api";

interface RenameGroupDialogProps {
  open: boolean;
  groupId: string | null;
  initialName?: string;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => Promise<void>;
}

export function RenameGroupDialog({
  open,
  groupId,
  initialName = "",
  onOpenChange,
  onRenamed,
}: RenameGroupDialogProps) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!groupId) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.updateGroup(groupId, { name: name.trim() });
      onOpenChange(false);
      await onRenamed();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("renameGroup.createFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open && groupId !== null} onOpenChange={onOpenChange}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("renameGroup.title")}</h2>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {t("common.close")}
        </Button>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-2">
          <Label htmlFor="renameGroup">{t("renameGroup.name")}</Label>
          <Input
            id="renameGroup"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
