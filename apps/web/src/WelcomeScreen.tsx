import { useEffect, useState } from "react";
import { BrandHomeLink } from "./BrandHomeLink";
import type { ProjectType } from "./project-context";
import type { AppTheme } from "./app-theme";
import { ThemeToggle } from "./ThemeToggle";
import { APP_VERSION, formatWelcomeDate, formatWelcomeTime } from "./welcome-format";

const ModeIcon = ({ type }: { readonly type: ProjectType }) => type === "building"
  ? <svg viewBox="0 0 96 96" aria-hidden="true"><path d="M17 22h61v55H17zM17 48h20V22M37 77V48h24v29M61 48h17M28 33h9M49 33h12M28 60h9" /><path className="v2-mode-icon__guide" d="M9 14h77M9 85h77M8 22h5M82 22h6M8 77h5M82 77h6" /></svg>
  : <svg viewBox="0 0 96 96" aria-hidden="true"><path d="M15 76c14-39 27-16 39-48 5-13 12-16 27-9M29 78c11-27 22-12 34-42 4-9 9-11 20-8" /><path strokeDasharray="6 7" d="M44 79c8-22 17-11 27-36 3-7 7-8 14-7" /><circle cx="26" cy="54" r="5" /><circle cx="59" cy="33" r="5" /><path className="v2-mode-icon__guide" d="M26 38v11M26 59v12M43 54H31M21 54H10M59 17v11M59 38v11M75 33H64M54 33H43" /></svg>;

interface WelcomeScreenProps {
  readonly theme: AppTheme;
  readonly onThemeChange: (theme: AppTheme) => void;
}

export function WelcomeScreen({ theme, onThemeChange }: WelcomeScreenProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const openProjects = (projectType: ProjectType) => {
    window.location.assign(`/?projects=${projectType}`);
  };

  return <main className="v2-welcome" aria-label="Úvodní obrazovka Datamine">
    <div className="v2-welcome__technical-lines" aria-hidden="true" />
    <div className="v2-welcome__theme"><ThemeToggle value={theme} onChange={onThemeChange} /></div>
    <section className="v2-welcome__content">
      <BrandHomeLink variant="welcome" />
      <div className="v2-welcome__clock">
        <time dateTime={now.toISOString()}>{formatWelcomeDate(now)}</time>
        <span aria-hidden="true" />
        <time dateTime={now.toISOString()}>{formatWelcomeTime(now)}</time>
      </div>
      <h1>Vyberte pracovní režim</h1>
      <div className="v2-welcome__modes">
        <button type="button" className="v2-welcome-mode" onClick={() => openProjects("building")}>
          <ModeIcon type="building" />
          <strong>Pozemní stavba</strong>
          <span>Místnosti, stěny, otvory a výkazy</span>
        </button>
        <button type="button" className="v2-welcome-mode" onClick={() => openProjects("civil")}>
          <ModeIcon type="civil" />
          <strong>Inženýrská stavba</strong>
          <span>Body, osy, povrchy a vytyčení</span>
        </button>
      </div>
    </section>
    <footer className="v2-welcome__footer">
      <div className="v2-welcome__footer-meta">
        <span>Verze {APP_VERSION}</span>
      </div>
    </footer>
  </main>;
}
