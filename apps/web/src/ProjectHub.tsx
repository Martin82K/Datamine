import { useMemo, useState } from "react";
import { BrandHomeLink } from "./BrandHomeLink";
import {
  createProjectArchive,
  readLocalProjects,
  safeProjectArchiveName,
  updateLocalProject,
  type LocalProject,
} from "./local-projects";
import { PROJECT_TYPE_LABELS, type ProjectType } from "./project-context";
import { deleteProjectFile, projectArchiveFiles } from "./project-files";
import type { AppTheme } from "./app-theme";
import { completeProject, createProject as createStoredProject, migrateProject, readProjects, removeProject, saveProject } from "./project-repository";
import { isServerProject, usesServerStorage } from "./project-api";
import { ThemeToggle } from "./ThemeToggle";

const downloadProject = async (project: LocalProject) => {
  const archive = createProjectArchive(project, await projectArchiveFiles(project));
  const bytes = new Uint8Array(archive.byteLength);
  bytes.set(archive);
  const url = URL.createObjectURL(new Blob([bytes.buffer], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeProjectArchiveName(project);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

interface ProjectHubProps {
  readonly projectType: ProjectType;
  readonly theme: AppTheme;
  readonly onThemeChange: (theme: AppTheme) => void;
}

export function ProjectHub({ projectType, theme, onThemeChange }: ProjectHubProps) {
  const [projects, setProjects] = useState<readonly LocalProject[]>(() => readProjects());
  const [busy, setBusy] = useState(false);
  const localProjects = usesServerStorage() ? readLocalProjects(window.localStorage).filter((item) => item.project_type === projectType) : [];
  const [showArchived, setShowArchived] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [message, setMessage] = useState(`${PROJECT_TYPE_LABELS[projectType]} · vyberte existující projekt nebo založte nový.`);

  const visibleProjects = useMemo(() => projects.filter((project) => (
    project.project_type === projectType
    && (showArchived ? project.status === "archived" : project.status === "active")
  )), [projects, projectType, showArchived]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await action(); setProjects(readProjects()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operaci nelze dokončit."); }
    finally { setBusy(false); }
  };
  const createProject = () => run(async () => {
    const project = await createStoredProject(newProjectName, projectType);
    window.location.assign(`/?workspace=${encodeURIComponent(project.id)}`);
  });
  const patchProject = (project: LocalProject, status: LocalProject["status"]) => run(async () => {
    // Katalog obsahuje jen souhrn. Změnu stavu aplikujeme na úplný model a soubory.
    await saveProject(updateLocalProject(await completeProject(project), { status }));
    setMessage(status === "archived" ? "Projekt byl přesunut do archivu." : "Projekt byl obnoven.");
  });
  const deleteProject = async (project: LocalProject) => {
    if (pendingDelete !== project.id) { setPendingDelete(project.id); return; }
    await run(async () => {
      const remote = isServerProject(project.id);
      await removeProject(project);
      if (!remote) await Promise.all(project.files.map((file) => deleteProjectFile(project.id, file.id)));
      setPendingDelete(null);
      setMessage(remote ? "Projekt i soubory byly odstraněny ze serveru." : "Projekt byl odstraněn z tohoto prohlížeče.");
    });
  };
  const downloadArchive = (project: LocalProject) => run(async () => {
    await downloadProject(await completeProject(project));
    setMessage("Úplný projektový ZIP byl připraven ke stažení.");
  });
  const transfer = (project: LocalProject) => run(async () => {
    const saved = await migrateProject(project, setMessage);
    setMessage(`Projekt „${saved.name}“ je uložen na serveru včetně souborů. Původní místní kopie zůstala zachována.`);
  });

  return <main className="v2-hub" aria-label={`${PROJECT_TYPE_LABELS[projectType]} – projekty`}>
    <header className="v2-hub__header">
      <BrandHomeLink variant="hub" />
      <button className="v2-hub__back" type="button" onClick={() => window.location.assign("/")} aria-label="Zpět na výběr pracovního režimu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg><span>Pracovní režimy</span></button>
      <ThemeToggle value={theme} onChange={onThemeChange} />
    </header>

    <section className="v2-hub__intro">
      <p className="dm-label">{projectType === "building" ? "Budovy a dispozice" : "Terén a infrastruktura"}</p>
      <h1>{PROJECT_TYPE_LABELS[projectType]}</h1>
      <p>{usesServerStorage() ? "Projekty a jejich soubory se ukládají na server a jsou dostupné z dalších zařízení." : "Projekty a soubory jsou uloženy pouze v tomto prohlížeči."}</p>
      <a className="dm-btn dm-btn--ghost" href={`/?projectType=${projectType}`}>Otevřít syntetickou ukázku</a>
    </section>

    <section className="v2-hub__projects" aria-label="Seznam projektů">
      <div className="v2-hub__section-head"><div><p className="dm-label">Projekty</p><h2>{showArchived ? "Archivované" : "Aktivní"}</h2></div><button className="dm-btn dm-btn--ghost" type="button" onClick={() => { setShowArchived((value) => !value); setPendingDelete(null); }}>{showArchived ? "Zpět na aktivní" : "Zobrazit archiv"}</button></div>
      {!showArchived && <form className="v2-new-project" onSubmit={(event) => { event.preventDefault(); createProject(); }}><label>Název nového projektu<input value={newProjectName} maxLength={120} placeholder={projectType === "building" ? "Např. Administrativní budova" : "Např. Obchvat města"} onChange={(event) => setNewProjectName(event.currentTarget.value)} /></label><button className="dm-btn dm-btn--primary" type="submit" disabled={busy || !newProjectName.trim()}>Založit projekt</button></form>}
      <div className="v2-project-grid">
        {visibleProjects.map((project) => <article className="v2-project-card" key={project.id}>
          <div><span className="v2-project-card__type">{PROJECT_TYPE_LABELS[project.project_type]}</span><h3>{project.name}</h3><p>Aktualizováno {new Date(project.updated_at).toLocaleString("cs-CZ")}</p></div>
          <fieldset disabled={busy} className="v2-project-card__actions" style={{ border: 0, padding: 0, margin: 0 }}>
            {project.status === "active" ? <button className="dm-btn dm-btn--primary" type="button" onClick={() => window.location.assign(`/?workspace=${encodeURIComponent(project.id)}`)}>Otevřít</button> : <button className="dm-btn dm-btn--primary" type="button" onClick={() => patchProject(project, "active")}>Obnovit</button>}
            <button className="dm-btn dm-btn--ghost" type="button" onClick={() => void downloadArchive(project)}>Stáhnout ZIP</button>
            {project.status === "active" ? <button className="dm-btn dm-btn--ghost" type="button" onClick={() => patchProject(project, "archived")}>Archivovat</button> : <button className="dm-btn dm-btn--ghost v2-danger" type="button" onClick={() => void deleteProject(project)}>{pendingDelete === project.id ? "Potvrdit smazání" : "Smazat"}</button>}
          </fieldset>
        </article>)}
        {!visibleProjects.length && <div className="v2-empty-state"><strong>{showArchived ? "Archiv je prázdný" : "Zatím tu není žádný projekt"}</strong><p>{showArchived ? "Archivované projekty se objeví zde." : "Zadejte název a založte první projekt."}</p></div>}
      </div>
      {localProjects.length > 0 && <details><summary>Místní projekty v tomto prohlížeči ({localProjects.length})</summary><p>Přeneste projekt včetně všech souborů na server. Původní kopie zůstane v tomto prohlížeči.</p>
        {localProjects.map((project) => <article className="v2-project-card" key={project.id}><h3>{project.name}</h3><button className="dm-btn dm-btn--primary" disabled={busy} onClick={() => void transfer(project)}>{isServerProject(project.id) ? "Přenést jako další kopii" : "Přenést na server"}</button></article>)}
      </details>}
      <p className="v2-hub__status" role="status" aria-live="polite">{message}</p>
    </section>
  </main>;
}
