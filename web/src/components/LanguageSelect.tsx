import { Label } from "@/components/ui/label";
import { useI18n, SUPPORTED_LOCALES, type Locale } from "@/i18n";

export function LanguageSelect() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="grid gap-2">
      <Label htmlFor="app-language">{t("header.language")}</Label>
      <select
        id="app-language"
        className="flex h-9 w-full bg-[var(--color-secondary)] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        {SUPPORTED_LOCALES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.nativeLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
