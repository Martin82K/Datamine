import brandIconUrl from "../../../src-tauri/icons/icon.png";
import { DATAMINE_HOME_PATH } from "./app-navigation";

interface BrandHomeLinkProps {
  readonly variant?: "chrome" | "hub" | "welcome";
}

export function BrandHomeLink({ variant = "chrome" }: BrandHomeLinkProps) {
  const className = variant === "welcome"
    ? "v2-welcome__brand"
    : variant === "hub"
      ? "v2-brand v2-brand--hub"
      : "v2-brand";
  return <a
    className={className}
    href={DATAMINE_HOME_PATH}
    aria-label="Datamine – úvodní obrazovka"
    title="Přejít na úvodní obrazovku"
  >
    <img className={variant === "welcome" ? undefined : "v2-brand__icon"} src={brandIconUrl} alt="" />
    {variant === "welcome" ? <strong>Datamine</strong> : <span>Datamine</span>}
  </a>;
}
