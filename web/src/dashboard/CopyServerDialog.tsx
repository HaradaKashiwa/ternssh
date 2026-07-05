import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import { api, type Server } from "@/lib/api";

interface CopyServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: Server | null;
  onCopied: () => Promise<void>;
}

export function CopyServerDialog({
  open,
  onOpenChange,
  source,
  onCopied,
}: CopyServerDialogProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<"password" | "private_key">(
    "password",
  );
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !source) return;
    setName(`${source.name}${t("copyServer.nameSuffix")}`);
    setHost(source.host);
    setPort(String(source.port));
    setUsername(source.username);
    setAuthType(source.auth_type);
    setCredential("");
    setError(null);
  }, [open, source, t]);

  if (!open || !source) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.copyServer(source.id, {
        name,
        host,
        port: Number(port),
        username,
        auth_type: authType,
        group_id: source.group_id,
        ...(credential.trim() ? { credential: credential.trim() } : {}),
      });
      onOpenChange(false);
      await onCopied();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("copyServer.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal className="max-w-lg" open={open} onOpenChange={onOpenChange}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("copyServer.title")}</h2>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {t("common.close")}
        </Button>
      </div>

      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-2">
          <Label htmlFor="copy-name">{t("common.name")}</Label>
          <Input
            id="copy-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 grid gap-2">
            <Label htmlFor="copy-host">{t("addServer.host")}</Label>
            <Input
              id="copy-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="copy-port">{t("addServer.port")}</Label>
            <Input
              id="copy-port"
              value={port}
              onChange={(event) => setPort(event.target.value)}
              required
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="copy-username">{t("addServer.username")}</Label>
          <Input
            id="copy-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="copy-authType">{t("addServer.authType")}</Label>
          <select
            id="copy-authType"
            className="flex h-9 w-full bg-[var(--color-secondary)] px-3 text-sm"
            value={authType}
            onChange={(event) =>
              setAuthType(event.target.value as "password" | "private_key")
            }
          >
            <option value="password">{t("addServer.password")}</option>
            <option value="private_key">{t("addServer.privateKey")}</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="copy-credential">
            {authType === "password"
              ? t("addServer.password")
              : t("addServer.privateKeyContent")}
          </Label>
          {authType === "password" ? (
            <Input
              id="copy-credential"
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder={t("copyServer.credentialPlaceholder")}
            />
          ) : (
            <textarea
              id="copy-credential"
              className="min-h-28 w-full bg-[var(--color-secondary)] px-3 py-2 text-sm"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder={t("copyServer.credentialPlaceholder")}
            />
          )}
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            {t("copyServer.credentialHint")}
          </p>
        </div>

        {error && (
          <p className="text-sm text-[var(--color-destructive)]">{error}</p>
        )}

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
