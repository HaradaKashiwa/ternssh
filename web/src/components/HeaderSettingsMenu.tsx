import { Settings } from "lucide-react";
import { useState } from "react";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

export function HeaderSettingsMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        title={t("header.settings")}
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        <Settings className="h-3.5 w-3.5" />
      </Button>

      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
