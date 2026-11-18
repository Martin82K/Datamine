const ALLOWED_THEMES = new Set(["dark", "light", "system"]);
const DEFAULT_STORAGE_KEY = "datamine-theme";

export function isDatamineTheme(value) {
  return typeof value === "string" && ALLOWED_THEMES.has(value);
}

export function applyDatamineTheme(theme, root = document.documentElement) {
  if (!isDatamineTheme(theme)) {
    throw new TypeError(`Neplatné téma Datamine: ${String(theme)}`);
  }
  root.dataset.datamineTheme = theme;
  return theme;
}

export function initDatamineTheme({
  root = document.documentElement,
  storage = globalThis.localStorage,
  storageKey = DEFAULT_STORAGE_KEY,
  defaultTheme = "system",
} = {}) {
  if (!isDatamineTheme(defaultTheme)) {
    throw new TypeError(`Neplatné výchozí téma Datamine: ${String(defaultTheme)}`);
  }

  let storedTheme = null;
  try {
    storedTheme = storage?.getItem(storageKey) ?? null;
  } catch {
    // Zakázané nebo nedostupné úložiště nesmí zablokovat vykreslení UI.
  }

  return applyDatamineTheme(isDatamineTheme(storedTheme) ? storedTheme : defaultTheme, root);
}

export function setDatamineTheme(theme, {
  root = document.documentElement,
  storage = globalThis.localStorage,
  storageKey = DEFAULT_STORAGE_KEY,
} = {}) {
  applyDatamineTheme(theme, root);
  try {
    storage?.setItem(storageKey, theme);
  } catch {
    // Téma funguje i v privacy režimu nebo v sandboxovaném webview.
  }
  return theme;
}

export const datamineThemes = Object.freeze(["dark", "light", "system"]);
