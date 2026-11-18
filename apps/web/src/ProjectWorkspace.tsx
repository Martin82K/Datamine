import { localOnly } from "./runtime-mode";
import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { StakeoutPointObject } from "@datamine/contracts";
import { BrandHomeLink } from "./BrandHomeLink";
import {
  createProjectArchive, safeProjectArchiveName, updateLocalProject,
  workspaceProjectIdFromLocation, type LocalProject, type LocalProjectFile,
} from "./local-projects";
import {
  PROJECT_FILE_ACCEPT, createProjectFileMetadata, deleteProjectFile, getProjectFile,
  projectArchiveFiles, projectFileRole, putProjectFile,
} from "./project-files";
import { PROJECT_TYPE_LABELS } from "./project-context";
import { extractStakeoutProposal, isStakeoutPdf, MAX_DESKTOP_PDF_BYTES, stakeoutObjectsFromProposal, usesDesktopPdfWorker, type StakeoutImportPayload } from "./processing-api";
import { WORKSPACE_SECTIONS, WORKSPACE_SECTION_LABELS, adjacentWorkspaceSection, workspaceSectionMessage, type WorkspaceSection } from "./workspace-section";
import type { AppTheme } from "./app-theme";
import { findProject, migrateProject, saveProject } from "./project-repository";
import { isServerProject, usesServerStorage } from "./project-api";
import { ThemeToggle } from "./ThemeToggle";

import { isStakeoutCsv, MAX_STAKEOUT_CSV_BYTES } from "./stakeout-csv";

const MAX_PROCESSING_BYTES = 64 * 1024 * 1024;
const formatBytes = (bytes: number) => bytes < 1024 * 1024
  ? new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(bytes / 1024) + " kB"
  : new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) + " MB";
const fileCountLabel = (count: number) => `${count} ${count === 1 ? "soubor" : count >= 2 && count <= 4 ? "soubory" : "souborů"}`;
const roleLabel = (role: LocalProjectFile["role"]) => role === "drawing" ? "Výkres" : role === "data" ? "Data" : "Ostatní";
const isStakeoutPoint = (object: LocalProject["objects"][number]): object is StakeoutPointObject => object.type === "stakeout.point";

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

interface ProjectWorkspaceProps {
  readonly theme: AppTheme;
  readonly onThemeChange: (theme: AppTheme) => void;
}

export function ProjectWorkspace({ theme, onThemeChange }: ProjectWorkspaceProps) {
  const projectId = useMemo(() => workspaceProjectIdFromLocation(window.location), []);
  const [project, setProject] = useState<LocalProject | null>(() => findProject(projectId));
  const [section, setSection] = useState<WorkspaceSection>("files");
  const [message, setMessage] = useState(project ? "Projekt je připravený." : "Projekt nebyl nalezen.");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [processingFile, setProcessingFile] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ readonly file: LocalProjectFile; readonly payload: StakeoutImportPayload } | null>(null);
  const [selectedDataFileId, setSelectedDataFileId] = useState<string | null>(null);
  const [crs, setCrs] = useState({ epsg: "5514", verticalDatum: "Bpv" });
  const input = useRef<HTMLInputElement>(null);

  const selectSection = (nextSection: WorkspaceSection) => {
    setSection(nextSection);
    setMessage(workspaceSectionMessage(nextSection));
  };

  const handleSectionKey = (event: KeyboardEvent<HTMLButtonElement>, currentSection: WorkspaceSection) => {
    const nextSection = event.key === "Home" ? WORKSPACE_SECTIONS[0]
      : event.key === "End" ? WORKSPACE_SECTIONS.at(-1)
        : event.key === "ArrowLeft" ? adjacentWorkspaceSection(currentSection, -1)
          : event.key === "ArrowRight" ? adjacentWorkspaceSection(currentSection, 1)
            : null;
    if (!nextSection) return;
    event.preventDefault();
    selectSection(nextSection);
    document.getElementById(`workspace-tab-${nextSection}`)?.focus();
  };

  const persistProject = async (updated: LocalProject) => {
    setProject(await saveProject(updated));
  };
  const transfer = async () => {
    if (!project || busy) return;
    setBusy(true);
    try {
      const saved = await migrateProject(project, setMessage);
      window.location.assign(`/?workspace=${encodeURIComponent(saved.id)}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Převod projektu selhal."); }
    finally { setBusy(false); }
  };

  const upload = async (files: FileList | readonly File[]) => {
    if (!project || project.status !== "active" || busy) return;
    setBusy(true);
    let current = project;
    const stored: LocalProjectFile[] = [];
    try {
      for (const file of Array.from(files)) {
        const currentBytes = current.files.reduce((sum, item) => sum + item.size, 0);
        const metadata = await createProjectFileMetadata(file, projectFileRole(file.name), currentBytes);
        await putProjectFile(project.id, metadata, file);
        stored.push(metadata);
        current = updateLocalProject(current, { files: [...current.files, metadata] });
      }
      await persistProject(current);
      setMessage(stored.length === 1 ? "Přidán 1 projektový podklad." : `Přidáno ${stored.length} projektových podkladů.`);
    } catch (error) {
      await Promise.allSettled(stored.map((file) => deleteProjectFile(project.id, file.id)));
      setMessage(error instanceof Error ? error.message : "Soubory nelze přidat.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const downloadFile = async (file: LocalProjectFile) => {
    if (!project || busy) return;
    setBusy(true);
    try { downloadBlob(await getProjectFile(project.id, file), file.name); setMessage(`Soubor ${file.name} byl připraven ke stažení.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Soubor nelze stáhnout."); }
    finally { setBusy(false); }
  };

  const removeFile = async (file: LocalProjectFile) => {
    if (!project || busy) return;
    if (pendingDelete !== file.id) { setPendingDelete(file.id); setMessage(`Dalším kliknutím potvrďte odebrání souboru ${file.name}.`); return; }
    setBusy(true);
    try {
      await persistProject(updateLocalProject(project, {
        files: project.files.filter((candidate) => candidate.id !== file.id),
        objects: project.objects.filter((object) => object.provenance.source_document_sha256 !== file.sha256),
      }));
      await deleteProjectFile(project.id, file.id);
      setPendingDelete(null);
      setProposal((current) => current?.file.id === file.id ? null : current);
      setMessage(`Soubor ${file.name} a jeho odvozené objekty byly odebrány.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Soubor nelze odebrat."); }
    finally { setBusy(false); }
  };

  const downloadArchive = async () => {
    if (!project || busy) return;
    setBusy(true);
    try {
      const archive = createProjectArchive(project, await projectArchiveFiles(project));
      downloadBlob(new Blob([archive.buffer as ArrayBuffer], { type: "application/zip" }), safeProjectArchiveName(project));
      setMessage("Úplný projektový ZIP byl připraven ke stažení.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Projektový ZIP nelze vytvořit."); }
    finally { setBusy(false); }
  };

  const processStakeout = async (file: LocalProjectFile) => {
    if (!project || busy || project.project_type !== "civil" || (!isStakeoutCsv(file) && (!isStakeoutPdf(file) || (localOnly && !usesDesktopPdfWorker())))) return;
    setBusy(true);
    setProcessingFile(file.id);
    setProposal(null);
    setSection("data");
    try {
      const blob = await getProjectFile(project.id, file);
      const payload = await extractStakeoutProposal(file, blob, setMessage);
      setProposal({ file, payload });
      setMessage(`Vytěženo ${payload.points.length} bodů. Zkontrolujte souřadnice a CRS.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Soubor nelze zpracovat."); }
    finally { setBusy(false); setProcessingFile(null); }
  };

  const confirmProposal = async () => {
    if (!project || !proposal || busy) return;
    const epsg = Number(crs.epsg);
    if (!Number.isInteger(epsg) || epsg < 1 || epsg > 999_999 || !crs.verticalDatum.trim() || crs.verticalDatum.length > 100) {
      setMessage("CRS musí obsahovat platný EPSG kód a výškový systém.");
      return;
    }
    setBusy(true);
    try {
      const imported = stakeoutObjectsFromProposal(proposal.payload, proposal.file, epsg, crs.verticalDatum.trim()).map((point) => {
        const confirmed = structuredClone(point);
        confirmed.properties.review_state = "confirmed";
        return confirmed;
      });
      const retained = project.objects.filter((object) => !(
        object.type === "stakeout.point" && object.provenance.source_document_sha256 === proposal.file.sha256
        && object.provenance.algorithm_version === proposal.payload.algorithm_version
      ));
      if (retained.length + imported.length > 10_000) throw new RangeError("Projekt by překročil limit 10 000 modelových objektů.");
      await persistProject(updateLocalProject(project, { objects: [...retained, ...imported] }));
      setSelectedDataFileId(proposal.file.id);
      setMessage(`${imported.length} bodů bylo vloženo do skutečného modelu. Model můžete otevřít ve 2D nebo 3D.`);
      setProposal(null);
      setSection("model");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Vytěžené body nelze vložit do modelu."); }
    finally { setBusy(false); }
  };

  if (!project) return <main className="v2-project-workspace v2-project-workspace--missing"><div className="v2-empty-state"><strong>Projekt nebyl nalezen</strong><p>Vraťte se do seznamu projektů a otevřete jej znovu.</p><button className="dm-btn dm-btn--primary" onClick={() => window.location.assign("/")}>Zpět na projekty</button></div></main>;

  const totalBytes = project.files.reduce((sum, file) => sum + file.size, 0);
  const stakeoutPoints = project.objects.filter(isStakeoutPoint);
  const extractedFiles = project.files.map((file) => ({
    file, points: stakeoutPoints.filter((point) => point.provenance.source_document_sha256 === file.sha256),
  })).filter((entry) => entry.points.length > 0);
  const selectedData = extractedFiles.find((entry) => entry.file.id === selectedDataFileId) ?? extractedFiles[0] ?? null;
  const surfaces = project.objects.filter((object) => object.type === "civil.tin_surface").length;
  const materialLayers = project.objects.filter((object) => object.type === "civil.material_layer").length;
  const editorUrl = (view: "2d" | "3d") => `/?localProject=${encodeURIComponent(project.id)}&projectType=${project.project_type}&view=${view}`;

  return <main className="v2-project-workspace" aria-label={`Správa projektu ${project.name}`}>
    <header className="v2-project-workspace__topbar">
      <BrandHomeLink />
      <div className="v2-project-workspace__nav">
        <button className="dm-btn dm-btn--ghost" type="button" onClick={() => window.location.assign(`/?projects=${project.project_type}`)}>Všechny projekty</button>
        <ThemeToggle value={theme} onChange={onThemeChange} />
      </div>
    </header>
    <section className="v2-project-workspace__hero">
      <div><p className="dm-label">{PROJECT_TYPE_LABELS[project.project_type]}</p><h1>{project.name}</h1><p>{isServerProject(project.id) ? "Projekt včetně souborů je uložen na serveru." : "Projekt je uložen pouze v tomto prohlížeči."}</p></div>
      <div className="v2-project-workspace__hero-actions"><button className="dm-btn dm-btn--ghost" type="button" disabled={busy} onClick={() => void downloadArchive()}>Stáhnout ZIP</button><button className="dm-btn dm-btn--primary" type="button" disabled={!project.objects.length} onClick={() => window.location.assign(editorUrl("3d"))}>Otevřít 3D model</button></div>
    </section>
    {usesServerStorage() && !isServerProject(project.id) && <section className="v2-empty-state"><p>Tento starší projekt je zatím místní. Přeneste jej včetně souborů na server pro přístup z dalších zařízení.</p><button className="dm-btn dm-btn--primary" disabled={busy} onClick={() => void transfer()}>Přenést na server</button></section>}
    <section className="v2-project-overview" aria-label="Souhrn projektu">
      <div><span>Stav</span><strong>{project.status === "active" ? "Aktivní" : "Archivovaný"}</strong></div><div><span>Soubory</span><strong>{project.files.length}</strong></div><div><span>Vytěžené body</span><strong>{stakeoutPoints.length}</strong></div><div><span>Velikost</span><strong>{formatBytes(totalBytes)}</strong></div>
    </section>
    <nav className="v2-workspace-tabs" role="tablist" aria-label="Sekce projektu">
      <button id="workspace-tab-files" type="button" role="tab" aria-controls="workspace-panel" aria-selected={section === "files"} tabIndex={section === "files" ? 0 : -1} className={section === "files" ? "v2-workspace-tab v2-workspace-tab--active" : "v2-workspace-tab"} onClick={() => selectSection("files")} onKeyDown={(event) => handleSectionKey(event, "files")}>{WORKSPACE_SECTION_LABELS.files} <span>{project.files.length}</span></button>
      <button id="workspace-tab-data" type="button" role="tab" aria-controls="workspace-panel" aria-selected={section === "data"} tabIndex={section === "data" ? 0 : -1} className={section === "data" ? "v2-workspace-tab v2-workspace-tab--active" : "v2-workspace-tab"} onClick={() => selectSection("data")} onKeyDown={(event) => handleSectionKey(event, "data")}>{WORKSPACE_SECTION_LABELS.data} <span>{stakeoutPoints.length}</span></button>
      <button id="workspace-tab-model" type="button" role="tab" aria-controls="workspace-panel" aria-selected={section === "model"} tabIndex={section === "model" ? 0 : -1} className={section === "model" ? "v2-workspace-tab v2-workspace-tab--active" : "v2-workspace-tab"} onClick={() => selectSection("model")} onKeyDown={(event) => handleSectionKey(event, "model")}>{WORKSPACE_SECTION_LABELS.model} <span>{project.objects.length}</span></button>
    </nav>
    <section id="workspace-panel" className="v2-project-workspace__body" role="tabpanel" aria-labelledby={`workspace-tab-${section}`}>
      {section === "files" ? <FilesSection project={project} busy={busy} dragging={dragging} pendingDelete={pendingDelete} processingFile={processingFile} stakeoutPoints={stakeoutPoints} input={input} onUpload={upload} onDragging={setDragging} onProcess={processStakeout} onDownload={downloadFile} onRemove={removeFile} /> : null}
      {section === "data" ? <DataSection proposal={proposal} crs={crs} extractedFiles={extractedFiles} selectedData={selectedData} onCrs={setCrs} busy={busy} onConfirm={() => void confirmProposal()} onCancel={() => { setProposal(null); setMessage("Návrh byl zrušen; model se nezměnil."); }} onSelectData={setSelectedDataFileId} onGoFiles={() => selectSection("files")} /> : null}
      {section === "model" ? <ModelSection project={project} stakeoutPoints={stakeoutPoints.length} surfaces={surfaces} materialLayers={materialLayers} onOpen={(view) => window.location.assign(editorUrl(view))} onPrepare={() => selectSection("files")} /> : null}
    </section>
    <footer className="v2-workspace-status" role="status" aria-live="polite"><span className={busy ? "v2-status-dot v2-status-dot--busy" : "v2-status-dot"} aria-hidden="true" />{message}</footer>
  </main>;
}

interface FilesSectionProps {
  readonly project: LocalProject; readonly busy: boolean; readonly dragging: boolean;
  readonly pendingDelete: string | null; readonly processingFile: string | null;
  readonly stakeoutPoints: readonly StakeoutPointObject[]; readonly input: RefObject<HTMLInputElement | null>;
  readonly onUpload: (files: FileList | readonly File[]) => Promise<void>; readonly onDragging: (value: boolean) => void;
  readonly onProcess: (file: LocalProjectFile) => Promise<void>; readonly onDownload: (file: LocalProjectFile) => Promise<void>;
  readonly onRemove: (file: LocalProjectFile) => Promise<void>;
}

function FilesSection({ project, busy, dragging, pendingDelete, processingFile, stakeoutPoints, input, onUpload, onDragging, onProcess, onDownload, onRemove }: FilesSectionProps) {
  return <div className="v2-project-workspace__files">
    {project.status === "active" ? <div className={dragging ? "v2-file-drop v2-file-drop--active" : "v2-file-drop"} onDragEnter={(event) => { event.preventDefault(); onDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (event.currentTarget === event.target) onDragging(false); }} onDrop={(event) => { event.preventDefault(); onDragging(false); void onUpload(event.dataTransfer.files); }}><div><p className="dm-label">Projektové podklady</p><h2>Přidat soubory</h2><p>PDF, DWG, DXF, IFC, LandXML, tabulky a rastry · nejvýše 250 MB.</p></div><button className="dm-btn dm-btn--primary" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Pracuji…" : "Vybrat soubory"}</button><input ref={input} className="v2-visually-hidden" type="file" multiple accept={PROJECT_FILE_ACCEPT} onChange={(event) => { if (event.currentTarget.files) void onUpload(event.currentTarget.files); }} /></div> : null}
    <div className="v2-file-list" aria-label="Soubory projektu"><div className="v2-file-list__head"><p className="dm-label">Obsah projektu</p><strong>{project.files.length ? fileCountLabel(project.files.length) : "Zatím bez souborů"}</strong></div>
      <div className="v2-file-list__items" role="list">
      {project.files.map((file) => {
        const importedCount = stakeoutPoints.filter((point) => point.provenance.source_document_sha256 === file.sha256).length;
        const desktop = usesDesktopPdfWorker();
        const csv = isStakeoutCsv(file);
        const isPointSource = project.project_type === "civil" && (csv || ((!localOnly || desktop) && isStakeoutPdf(file)));
        const maxBytes = csv ? MAX_STAKEOUT_CSV_BYTES : desktop ? MAX_DESKTOP_PDF_BYTES : MAX_PROCESSING_BYTES;
        const canExtract = isPointSource && file.size <= maxBytes;
        return <article className="v2-file-row" role="listitem" key={file.id}><div className="v2-file-row__badge">{file.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</div><div className="v2-file-row__name"><strong title={file.name}>{file.name}</strong><span>{roleLabel(file.role)} · {formatBytes(file.size)}{importedCount ? ` · ${importedCount} bodů` : ""}{isPointSource && !canExtract ? ` · zpracování do ${formatBytes(maxBytes)}` : ""}</span></div><div className="v2-file-row__actions">{isPointSource ? <button className="dm-btn dm-btn--primary" type="button" disabled={busy || !canExtract} onClick={() => void onProcess(file)}>{processingFile === file.id ? "Zpracovávám…" : importedCount ? "Vytěžit znovu" : "Vytěžit"}</button> : null}<button className="dm-btn dm-btn--ghost" type="button" disabled={busy} onClick={() => void onDownload(file)}>Stáhnout</button>{project.status === "active" ? <button className="dm-btn dm-btn--ghost v2-danger" type="button" disabled={busy} onClick={() => void onRemove(file)}>{pendingDelete === file.id ? "Potvrdit" : "Odebrat"}</button> : null}</div></article>;
      })}
      {!project.files.length ? <div className="v2-empty-state"><strong>Projekt nemá podklady</strong><p>Přidejte první výkres nebo datový soubor.</p></div> : null}
      </div>
    </div>
  </div>;
}

interface DataSectionProps {
  readonly busy: boolean;
  readonly proposal: { readonly file: LocalProjectFile; readonly payload: StakeoutImportPayload } | null;
  readonly crs: { readonly epsg: string; readonly verticalDatum: string };
  readonly extractedFiles: readonly { readonly file: LocalProjectFile; readonly points: readonly StakeoutPointObject[] }[];
  readonly selectedData: { readonly file: LocalProjectFile; readonly points: readonly StakeoutPointObject[] } | null;
  readonly onCrs: (value: { epsg: string; verticalDatum: string }) => void; readonly onConfirm: () => void;
  readonly onCancel: () => void; readonly onSelectData: (fileId: string) => void; readonly onGoFiles: () => void;
}

function DataSection({ busy, proposal, crs, extractedFiles, selectedData, onCrs, onConfirm, onCancel, onSelectData, onGoFiles }: DataSectionProps) {
  return <div className="v2-data-workspace">
    {proposal ? <section className="v2-import-preview" aria-label="Náhled vytěžených souřadnic"><div className="v2-file-list__head"><div><p className="dm-label">Kontrola před vložením</p><h2>{proposal.payload.points.length} vytěžených bodů</h2><p>{proposal.file.name}</p></div><div className="v2-import-preview__crs"><label>EPSG<input type="number" min="1" max="999999" value={crs.epsg} onChange={(event) => onCrs({ ...crs, epsg: event.currentTarget.value })} /></label><label>Výškový systém<input maxLength={100} value={crs.verticalDatum} onChange={(event) => onCrs({ ...crs, verticalDatum: event.currentTarget.value })} /></label></div></div><p className="v2-muted">Souřadnice X, Y, Z v metrech. Ověřte pořadí os, EPSG a výškový systém podle zdroje; import souřadnice nepřevádí.</p><PointRows points={proposal.payload.points} csv={proposal.payload.algorithm_version === "stakeout-csv-import-v1"} /><div className="v2-project-workspace__hero-actions"><button className="dm-btn dm-btn--primary" type="button" disabled={busy} onClick={onConfirm}>Potvrdit a vložit do modelu</button><button className="dm-btn dm-btn--ghost" type="button" disabled={busy} onClick={onCancel}>Zrušit návrh</button></div></section> : null}
    <div className="v2-data-layout"><aside className="v2-data-sources"><p className="dm-label">Datové sady</p>{extractedFiles.map((entry) => <button key={entry.file.id} type="button" className={selectedData?.file.id === entry.file.id ? "v2-data-source v2-data-source--active" : "v2-data-source"} onClick={() => onSelectData(entry.file.id)}><strong>{entry.file.name}</strong><span>{entry.points.length} bodů</span></button>)}{!extractedFiles.length ? <p className="v2-muted">Zatím nebyla potvrzena žádná vytěžená data.</p> : null}</aside><section className="v2-data-detail">{selectedData ? <><div className="v2-file-list__head"><div><p className="dm-label">Potvrzená datová sada</p><h2>{selectedData.points.length} bodů v modelu</h2><p>{selectedData.file.name}</p></div></div><ModelPointRows points={selectedData.points} /></> : <div className="v2-empty-state"><strong>Žádná potvrzená data</strong><p>V sekci Soubory spusťte vytěžení PDF nebo CSV a návrh zkontrolujte.</p><button className="dm-btn dm-btn--primary" type="button" onClick={onGoFiles}>Přejít na soubory</button></div>}</section></div>
  </div>;
}

function PointRows({ points, csv }: { readonly points: StakeoutImportPayload["points"]; readonly csv: boolean }) {
  return <><div className="v2-import-preview__table" role="table">{points.slice(0, 100).map((point, index) => <div className="v2-import-preview__row" role="row" key={`${point.code}-${index}`}><span>{point.code}</span><strong>{point.name}</strong><span className="dm-mono">{point.point.map((value) => value.toFixed(3)).join(" · ")}</span><span title={point.kind}>Vrstva: {point.kind} · {csv ? `řádek ${point.row}` : `str. ${point.page}`}</span></div>)}</div>{points.length > 100 ? <p className="v2-muted">Zobrazeno prvních 100 bodů; vloží se všech {points.length}.</p> : null}</>;
}

function ModelPointRows({ points }: { readonly points: readonly StakeoutPointObject[] }) {
  return <div className="v2-import-preview__table">{points.slice(0, 100).map((point) => {
    const layerName = point.properties.derivation.kind === "document_import"
      ? point.properties.derivation.source_layer ?? point.layer_id
      : point.layer_id;
    return <div className="v2-import-preview__row" key={point.id}><span>{point.properties.code}</span><strong>{point.properties.name}</strong><span className="dm-mono">{point.geometry.point.map((value) => value.toFixed(3)).join(" · ")}</span><span title={layerName}>Vrstva: {layerName} · {point.properties.review_state === "unreviewed" ? "neověřeno" : point.properties.review_state}</span></div>;
  })}</div>;
}

function ModelSection({ project, stakeoutPoints, surfaces, materialLayers, onOpen, onPrepare }: { readonly project: LocalProject; readonly stakeoutPoints: number; readonly surfaces: number; readonly materialLayers: number; readonly onOpen: (view: "2d" | "3d") => void; readonly onPrepare: () => void }) {
  return <div className="v2-model-workspace"><div className="v2-model-workspace__intro"><div><p className="dm-label">Skutečný projektový model</p><h2>{project.objects.length ? `${project.objects.length} objektů připravených k zobrazení` : "Model je zatím prázdný"}</h2><p>{project.objects.length ? "Editor vykreslí pouze potvrzená data tohoto projektu. Souřadnice zůstávají autoritativní; scéna používá lokální počátek kvůli přesnosti 3D." : "Nejprve vytěžte nebo vytvořte projektové objekty. Demo geometrie se do projektu nevkládá."}</p></div><div className="v2-model-workspace__actions"><button className="dm-btn dm-btn--ghost" type="button" disabled={!project.objects.length} onClick={() => onOpen("2d")}>Otevřít ve 2D</button><button className="dm-btn dm-btn--primary" type="button" disabled={!project.objects.length} onClick={() => onOpen("3d")}>Otevřít ve 3D</button></div></div><div className="v2-model-metrics"><div><span>Vytyčovací body</span><strong>{stakeoutPoints}</strong></div><div><span>Povrchy TIN</span><strong>{surfaces}</strong></div><div><span>Materiálové vrstvy</span><strong>{materialLayers}</strong></div><div><span>Celkem objektů</span><strong>{project.objects.length}</strong></div></div>{!project.objects.length ? <div className="v2-empty-state"><strong>3D bez mocku</strong><p>Až potvrdíte vytěžené body, objeví se zde vstup do jejich 3D zobrazení.</p><button className="dm-btn dm-btn--primary" type="button" onClick={onPrepare}>Připravit data</button></div> : null}</div>;
}
