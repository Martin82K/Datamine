import { useEffect, useState, type ReactNode } from "react";
import { initializeProjects } from "./project-repository";
import { localOnly } from "./runtime-mode";

export function WorkspaceGate({ children }: { readonly children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({ ready: false, error: null });
  useEffect(() => {
    let active = true;
    setState({ ready: false, error: null });
    void initializeProjects(localOnly).then(() => { if (active) setState({ ready: true, error: null }); })
      .catch((error) => { if (active) setState({ ready: false, error: error instanceof Error ? error.message : "Projekty nelze načíst." }); });
    return () => { active = false; };
  }, [attempt]);
  if (state.ready) return children;
  return <main className="v2-project-workspace"><section className="v2-empty-state" role={state.error ? "alert" : "status"}>
    <strong>{state.error ? "Projektové úložiště není dostupné" : "Načítám projekty…"}</strong>
    {state.error && <><p>{state.error}</p><button className="dm-btn dm-btn--primary" type="button" onClick={() => setAttempt((value) => value + 1)}>Zkusit znovu</button><p>Uložení na server nebylo potvrzeno. Místní projekty zůstávají v prohlížeči.</p></>}
  </section></main>;
}
