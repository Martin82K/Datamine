import { createLocalProject, readLocalProjects, writeLocalProjects, type LocalProject } from "./local-projects.ts";
import { applyProjectViewSettings, captureProjectViewSettings } from "./layer-colors.ts";
import { getLocalProjectFile } from "./project-files.ts";
import { deleteServerFile, deleteServerProject, initializeProjectApi, isServerProject, loadServerProject, ProjectApiError, saveServerProject, serverProjects, uploadServerFile, usesServerStorage } from "./project-api.ts";

export function readProjects(): readonly LocalProject[] {
  return usesServerStorage() ? serverProjects() : readLocalProjects(window.localStorage);
}

export function findProject(id: string | null): LocalProject | null {
  if (!id) return null;
  return readProjects().find((item) => item.id === id)
    ?? readLocalProjects(window.localStorage).find((item) => item.id === id) ?? null;
}

let initialization: Promise<void> | null = null;
export function initializeProjects(localOnly = false): Promise<void> {
  if (!initialization) initialization = loadProjects(localOnly).finally(() => { initialization = null; });
  return initialization;
}
async function loadProjects(localOnly: boolean): Promise<void> {
  await initializeProjectApi(localOnly);
  if (!usesServerStorage()) return;
  const parameters = new URLSearchParams(window.location.search);
  const id = parameters.get("workspace") ?? parameters.get("localProject");
  if (!id) return;
  try {
    const project = await loadServerProject(id);
    const local = readLocalProjects(window.localStorage);
    if (local.some((item) => item.id === id && !item.view_settings)) {
      writeLocalProjects(window.localStorage, local.map((item) => item.id === id ? { ...item, view_settings: captureProjectViewSettings(window.localStorage, id) } : item));
    }
    applyProjectViewSettings(window.localStorage, id, project.view_settings ?? {});
  } catch (error) {
    if (error instanceof ProjectApiError && error.status === 404 && readLocalProjects(window.localStorage).some((item) => item.id === id)) return;
    throw error;
  }
}

export async function createProject(name: string, type: LocalProject["project_type"]): Promise<LocalProject> {
  const project = createLocalProject(name, type, []);
  if (usesServerStorage()) return saveServerProject(project, true);
  writeLocalProjects(window.localStorage, [project, ...readLocalProjects(window.localStorage)]);
  return project;
}

export async function saveProject(project: LocalProject, captureView = false): Promise<LocalProject> {
  const updated = captureView ? { ...project, view_settings: captureProjectViewSettings(window.localStorage, project.id) } : project;
  if (isServerProject(project.id)) return saveServerProject(updated);
  const local = readLocalProjects(window.localStorage);
  if (!local.some((item) => item.id === project.id)) throw new Error("Místní projekt již neexistuje. Uložení bylo zastaveno.");
  writeLocalProjects(window.localStorage, local.map((item) => item.id === project.id ? updated : item));
  return updated;
}

export async function removeProject(project: LocalProject): Promise<void> {
  if (isServerProject(project.id)) return deleteServerProject(project);
  writeLocalProjects(window.localStorage, readLocalProjects(window.localStorage).filter((item) => item.id !== project.id));
}

export async function completeProject(project: LocalProject): Promise<LocalProject> {
  return isServerProject(project.id) ? loadServerProject(project.id) : project;
}

export async function migrateProject(source: LocalProject, onStatus: (message: string) => void): Promise<LocalProject> {
  if (!usesServerStorage()) throw new Error("Serverové ukládání není aktivní.");
  const copy = isServerProject(source.id);
  const id = copy ? createLocalProject(source.name, source.project_type, []).id : source.id;
  const { server_revision: _revision, ...base } = source;
  const project: LocalProject = {
    ...base, id, name: copy ? `${source.name.slice(0, 100)} (místní kopie)` : source.name,
    view_settings: source.view_settings ?? captureProjectViewSettings(window.localStorage, source.id),
  };
  const uploaded: string[] = [];
  try {
    for (const [index, file] of source.files.entries()) {
      onStatus(`Přenáším ${index + 1}/${source.files.length}: ${file.name}`);
      const blob = await getLocalProjectFile(source.id, file);
      uploaded.push(file.id);
      await uploadServerFile(id, file, blob);
    }
    onStatus("Ověřuji a ukládám celý projekt na server…");
    const saved = await saveServerProject(project, true);
    applyProjectViewSettings(window.localStorage, saved.id, saved.view_settings ?? {});
    return saved;
  } catch (error) {
    await Promise.allSettled(uploaded.map((fileId) => deleteServerFile(id, fileId)));
    throw error;
  }
}
