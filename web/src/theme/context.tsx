import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyBackgroundImage,
  applyGridMargin,
  applyWidgetOpacity,
  BACKGROUND_STORAGE_KEY,
  getStoredBackgroundImage,
  getStoredGridMargin,
  getStoredWidgetOpacity,
  GRID_MARGIN_DEFAULT,
  GRID_MARGIN_STORAGE_KEY,
  WIDGET_OPACITY_DEFAULT,
  WIDGET_OPACITY_STORAGE_KEY,
} from "./personalization";
import {
  applyTheme,
  DEFAULT_THEME_MODE,
  getStoredThemeMode,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme";
import {
  createDefaultTerminalThemeConfig,
  getAppThemeTerminalColors,
  getStoredTerminalThemeConfig,
  resolveTerminalXtermTheme,
  TERMINAL_THEME_STORAGE_KEY,
  type CustomTerminalThemeColors,
  type TerminalThemeColors,
  type TerminalThemeConfig,
  type TerminalThemeMode,
} from "./terminal-theme";

interface PersonalizationContextValue {
  mode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  backgroundImage: string | null;
  setBackgroundImage: (image: string | null) => void;
  widgetOpacity: number;
  setWidgetOpacity: (opacity: number) => void;
  gridMargin: number;
  setGridMargin: (margin: number) => void;
  terminalTheme: TerminalThemeConfig;
  resolvedTerminalColors: TerminalThemeColors;
  setTerminalThemeMode: (mode: TerminalThemeMode) => void;
  setTerminalThemeColor: (
    key: keyof CustomTerminalThemeColors,
    value: string,
  ) => void;
  resetTerminalThemeCustom: () => void;
  resetPersonalization: () => void;
}

const PersonalizationContext = createContext<PersonalizationContextValue | null>(
  null,
);

function persistTerminalTheme(config: TerminalThemeConfig) {
  localStorage.setItem(TERMINAL_THEME_STORAGE_KEY, JSON.stringify(config));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredThemeMode());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    applyTheme(getStoredThemeMode()),
  );
  const [backgroundImage, setBackgroundImageState] = useState<string | null>(
    () => getStoredBackgroundImage(),
  );
  const [widgetOpacity, setWidgetOpacityState] = useState<number>(() =>
    getStoredWidgetOpacity(),
  );
  const [gridMargin, setGridMarginState] = useState<number>(() =>
    getStoredGridMargin(),
  );
  const [terminalTheme, setTerminalThemeState] = useState<TerminalThemeConfig>(
    () => getStoredTerminalThemeConfig(),
  );

  const resolvedTerminalColors = useMemo(
    () => resolveTerminalXtermTheme(terminalTheme, resolvedTheme),
    [terminalTheme, resolvedTheme],
  );

  useEffect(() => {
    applyBackgroundImage(backgroundImage);
  }, [backgroundImage]);

  useEffect(() => {
    applyWidgetOpacity(widgetOpacity);
  }, [widgetOpacity]);

  useEffect(() => {
    applyGridMargin(gridMargin);
  }, [gridMargin]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setResolvedTheme(applyTheme(next));
  }, []);

  const setBackgroundImage = useCallback((image: string | null) => {
    setBackgroundImageState(image);
    if (image) {
      localStorage.setItem(BACKGROUND_STORAGE_KEY, image);
    } else {
      localStorage.removeItem(BACKGROUND_STORAGE_KEY);
    }
    applyBackgroundImage(image);
  }, []);

  const setWidgetOpacity = useCallback((opacity: number) => {
    const clamped = applyWidgetOpacity(opacity);
    setWidgetOpacityState(clamped);
    localStorage.setItem(WIDGET_OPACITY_STORAGE_KEY, String(clamped));
  }, []);

  const setGridMargin = useCallback((margin: number) => {
    const clamped = applyGridMargin(margin);
    setGridMarginState(clamped);
    localStorage.setItem(GRID_MARGIN_STORAGE_KEY, String(clamped));
  }, []);

  const setTerminalThemeMode = useCallback((next: TerminalThemeMode) => {
    setTerminalThemeState((current) => {
      const nextConfig: TerminalThemeConfig = {
        ...current,
        mode: next,
      };
      persistTerminalTheme(nextConfig);
      return nextConfig;
    });
  }, []);

  const setTerminalThemeColor = useCallback(
    (key: keyof CustomTerminalThemeColors, value: string) => {
      setTerminalThemeState((current) => {
        const nextConfig: TerminalThemeConfig = {
          mode: "custom",
          custom: {
            ...current.custom,
            [key]: value.toLowerCase(),
          },
        };
        persistTerminalTheme(nextConfig);
        return nextConfig;
      });
    },
    [],
  );

  const resetTerminalThemeCustom = useCallback(() => {
    const nextConfig: TerminalThemeConfig = {
      mode: "custom",
      custom: getAppThemeTerminalColors(resolvedTheme),
    };
    setTerminalThemeState(nextConfig);
    persistTerminalTheme(nextConfig);
  }, [resolvedTheme]);

  const resetPersonalization = useCallback(() => {
    const defaultMode = DEFAULT_THEME_MODE;
    setModeState(defaultMode);
    localStorage.setItem(THEME_STORAGE_KEY, defaultMode);
    const resolved = applyTheme(defaultMode);
    setResolvedTheme(resolved);

    setBackgroundImageState(null);
    localStorage.removeItem(BACKGROUND_STORAGE_KEY);
    applyBackgroundImage(null);

    const opacity = applyWidgetOpacity(WIDGET_OPACITY_DEFAULT);
    setWidgetOpacityState(opacity);
    localStorage.setItem(WIDGET_OPACITY_STORAGE_KEY, String(opacity));

    const margin = applyGridMargin(GRID_MARGIN_DEFAULT);
    setGridMarginState(margin);
    localStorage.setItem(GRID_MARGIN_STORAGE_KEY, String(margin));

    const nextTerminal = createDefaultTerminalThemeConfig();
    setTerminalThemeState(nextTerminal);
    persistTerminalTheme(nextTerminal);
  }, []);

  useEffect(() => {
    if (mode !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setResolvedTheme(applyTheme("system"));
    };

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  const value = useMemo(
    () => ({
      mode,
      resolvedTheme,
      setMode,
      backgroundImage,
      setBackgroundImage,
      widgetOpacity,
      setWidgetOpacity,
      gridMargin,
      setGridMargin,
      terminalTheme,
      resolvedTerminalColors,
      setTerminalThemeMode,
      setTerminalThemeColor,
      resetTerminalThemeCustom,
      resetPersonalization,
    }),
    [
      mode,
      resolvedTheme,
      setMode,
      backgroundImage,
      setBackgroundImage,
      widgetOpacity,
      setWidgetOpacity,
      gridMargin,
      setGridMargin,
      terminalTheme,
      resolvedTerminalColors,
      setTerminalThemeMode,
      setTerminalThemeColor,
      resetTerminalThemeCustom,
      resetPersonalization,
    ],
  );

  return (
    <PersonalizationContext.Provider value={value}>
      {children}
    </PersonalizationContext.Provider>
  );
}

function usePersonalizationContext() {
  const context = useContext(PersonalizationContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

export function useTheme() {
  const { mode, resolvedTheme, setMode } = usePersonalizationContext();
  return { mode, resolvedTheme, setMode };
}

export function usePersonalization() {
  return usePersonalizationContext();
}
