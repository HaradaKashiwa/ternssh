import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import { api } from "@/lib/api";

interface AddGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string | null;
  onCreated: () => Promise<void>;
}

export function AddGroupDialog({
  open,
  onOpenChange,
  parentId = null,
  onCreated,
}: AddGroupDialogProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createGroup({ name: name.trim(), parent_id: parentId });
      reset();
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("addGroup.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("addGroup.title")}</h2>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {t("common.close")}
        </Button>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-2">
          <Label htmlFor="groupName">{t("addGroup.name")}</Label>
          <Input
            id="groupName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("addGroup.placeholder")}
            required
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
