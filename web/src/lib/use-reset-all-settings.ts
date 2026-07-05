import { useCallback } from "react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import {
  clearAppSettingsStorage,
  detectDefaultLocale,
  dispatchSettingsResetEvent,
} from "@/lib/app-settings";
import { usePersonalization } from "@/theme";

export function useResetAllSettings() {
  const { setLocale } = useI18n();
  const { resetPersonalization } = usePersonalization();

  return useCallback(async () => {
    clearAppSettingsStorage();
    setLocale(detectDefaultLocale());
    resetPersonalization();
    await api.resetDashboard();
    dispatchSettingsResetEvent();
  }, [resetPersonalization, setLocale]);
}
