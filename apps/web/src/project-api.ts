import { isLocalProject, type LocalProject, type LocalProjectFile } from "./local-projects.ts";

export class ProjectApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

let serverStorage = false;
const remoteIds = new Set<string>();
let projects: readonly LocalProject[] = [];
export const usesServerStorage = () => serverStorage;
export const isServerProject = (id: string) => remoteIds.has(id);
export const serverProjects = () => projects;

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try { response = await fetch(`/v2/workspace${path}`, { ...init, cache: "no-store" }); }
  catch { throw new ProjectApiError("Server není dostupný. Změny nebyly uloženy na VPS.", 0); }
  if (!response.ok) {
    let message = "Požadavek na projektové úložiště selhal.";
    try {
      const value: unknown = await response.json();
      if (value && typeof value === "object") {
        if ("message" in value && typeof value.message === "string") message = value.message;
        else if ("detail" in value && typeof value.detail === "string") message = value.detail;
      }
    } catch { /* HTTP stav je stále dostupný. */ }
    throw new ProjectApiError(message, response.status);
  }
  return response;
}

function parseProject(value: unknown): LocalProject {
  if (!value || typeof value !== "object" || !("project" in value) || !("revision" in value)
    || !isLocalProject(value.project) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    throw new ProjectApiError("Server vrátil neplatný projekt.", 502);
  }
  return { ...value.project, server_revision: value.revision as number };
}

function remember(project: LocalProject): LocalProject {
  remoteIds.add(project.id);
  projects = [project, ...projects.filter((item) => item.id !== project.id)];
  return project;
}

export async function initializeProjectApi(localOnly = false): Promise<void> {
  serverStorage = false;
  remoteIds.clear();
  projects = [];
  if (localOnly) return;
  let response: Response;
  try { response = await request("/status"); }
  catch (error) {
    // Pouze lokální vývoj může používat samotný Vite bez backendu.
    if (error instanceof ProjectApiError && ["127.0.0.1", "localhost"].includes(window.location.hostname)
      && [0, 404, 500, 502].includes(error.status)) return;
    throw error;
  }
  const config = await response.json() as { storage?: unknown };
  if (config.storage === "local") return;
  if (config.storage !== "server") throw new ProjectApiError("Režim úložiště není platný.", 502);
  serverStorage = true;
  const result: unknown = await (await request("/projects")).json();
  if (!result || typeof result !== "object" || !("items" in result) || !Array.isArray(result.items) || result.items.length > 100) {
    throw new ProjectApiError("Server vrátil neplatný katalog projektů.", 502);
  }
  projects = result.items.map(parseProject);
  projects.forEach((project) => remoteIds.add(project.id));
}

export async function loadServerProject(id: string): Promise<LocalProject> {
  return remember(parseProject(await (await request(`/projects/${encodeURIComponent(id)}`)).json()));
}

export async function saveServerProject(project: LocalProject, create = false): Promise<LocalProject> {
  const { server_revision, ...payload } = project;
  if (!create && !Number.isSafeInteger(server_revision)) throw new ProjectApiError("Chybí revize serverového projektu.", 409);
  const response = await request(`/projects/${encodeURIComponent(project.id)}`, {
    method: "PUT", headers: { "Content-Type": "application/json", "If-Match": `"${create ? 0 : server_revision}"` },
    body: JSON.stringify(payload),
  });
  return remember(parseProject(await response.json()));
}

export async function deleteServerProject(project: LocalProject): Promise<void> {
  await request(`/projects/${encodeURIComponent(project.id)}`, { method: "DELETE", headers: { "If-Match": `"${project.server_revision}"` } });
  remoteIds.delete(project.id);
  projects = projects.filter((item) => item.id !== project.id);
}

export async function uploadServerFile(projectId: string, file: LocalProjectFile, blob: Blob): Promise<void> {
  const base = `/projects/${encodeURIComponent(projectId)}/files`;
  const session = await (await request(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(file) })).json() as { ready?: unknown; chunk_bytes?: unknown };
  if (session.ready === true) return;
  if (session.ready !== false || session.chunk_bytes !== 4 * 1024 * 1024) throw new ProjectApiError("Server vrátil neplatný upload.", 502);
  for (let offset = 0, position = 0; offset < blob.size; offset += session.chunk_bytes, position += 1) {
    await request(`${base}/${file.id}/chunks/${position}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: blob.slice(offset, offset + session.chunk_bytes) });
  }
  const result = await (await request(`${base}/${file.id}/complete`, { method: "POST" })).json() as Partial<LocalProjectFile>;
  if (result.sha256 !== file.sha256 || result.size !== file.size) throw new ProjectApiError("Server nepotvrdil úplnost souboru.", 502);
}

export async function downloadServerFile(projectId: string, fileId: string): Promise<Blob> {
  return (await request(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/content`)).blob();
}

export async function deleteServerFile(projectId: string, fileId: string): Promise<void> {
  await request(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
}
