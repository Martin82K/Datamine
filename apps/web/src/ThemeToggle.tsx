import { nextAppTheme, type AppTheme } from "./app-theme";

interface ThemeToggleProps {
  readonly value: AppTheme;
  readonly onChange: (theme: AppTheme) => void;
}

const ThemeIcon = ({ theme }: { readonly theme: Exclude<AppTheme, "system"> }) => theme === "light"
  ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" /></svg>
  : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.7 8.7 0 1 0 20.2 15.2Z" /></svg>;

export function ThemeToggle({ value, onChange }: ThemeToggleProps) {
  const next = nextAppTheme(value, window.matchMedia("(prefers-color-scheme: light)").matches);
  const label = next === "light" ? "Přepnout na světlý motiv" : "Přepnout na tmavý motiv";
  return <button
    className="v2-theme-toggle"
    type="button"
    aria-label={label}
    title={label}
    onClick={() => onChange(next)}
  ><ThemeIcon theme={next} /></button>;
}
