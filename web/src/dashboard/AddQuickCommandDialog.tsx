import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

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
      setError("请填写命令名称和内容");
      return;
    }

    const current = parseQuickCommandsConfig(configJson);
    onAdded(
      serializeQuickCommandsConfig({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-[var(--color-card)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">添加快捷命令</h2>
          <Button variant="ghost" onClick={handleClose}>
            关闭
          </Button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="quickCommandLabel">名称</Label>
            <Input
              id="quickCommandLabel"
              placeholder="例如：重启 nginx"
              required
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="quickCommandText">命令</Label>
            <Textarea
              id="quickCommandText"
              placeholder={"例如：systemctl restart nginx\n或输入多行脚本"}
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
              支持多行命令，Ctrl+Enter 或 ⌘+Enter 保存
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
