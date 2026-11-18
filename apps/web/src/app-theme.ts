export const APP_THEME_KEY = "datamine.theme.v1";

export type AppTheme = "system" | "light" | "dark";

export const isAppTheme = (value: unknown): value is AppTheme => (
  value === "system" || value === "light" || value === "dark"
);

export const readAppTheme = (storage: Pick<Storage, "getItem">): AppTheme => {
  try {
    const stored = storage.getItem(APP_THEME_KEY);
    return isAppTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
};

export const applyAppTheme = (
  root: Pick<HTMLElement, "dataset">,
  theme: AppTheme,
): void => {
  root.dataset.datamineTheme = theme;
};

export const nextAppTheme = (theme: AppTheme, prefersLight: boolean): Exclude<AppTheme, "system"> => {
  const resolvedTheme = theme === "system" ? (prefersLight ? "light" : "dark") : theme;
  return resolvedTheme === "dark" ? "light" : "dark";
};

export const writeAppTheme = (
  storage: Pick<Storage, "setItem">,
  root: Pick<HTMLElement, "dataset">,
  theme: AppTheme,
): void => {
  storage.setItem(APP_THEME_KEY, theme);
  applyAppTheme(root, theme);
};
