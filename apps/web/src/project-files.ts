import type { LocalProject, LocalProjectFile, ProjectArchiveFile, ProjectFileRole } from "./local-projects";
import { deleteServerFile, downloadServerFile, isServerProject, uploadServerFile } from "./project-api.ts";

export const MAX_PROJECT_FILE_BYTES = 250 * 1024 * 1024;
export const MAX_PROJECT_TOTAL_BYTES = 1024 * 1024 * 1024;
export const PROJECT_FILE_ACCEPT = ".pdf,.dwg,.dxf,.ifc,.xml,.landxml,.csv,.xlsx,.docx,.png,.jpg,.jpeg,.tif,.tiff,.txt";
const ALLOWED_EXTENSIONS = new Set(PROJECT_FILE_ACCEPT.split(",").map((value) => value.slice(1)));
const DB_NAME = "datamine-local-files-v1";
const STORE_NAME = "files";

interface StoredProjectFile {
  readonly key: string;
  readonly project_id: string;
  readonly file_id: string;
  readonly blob: Blob;
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error ?? new Error("Lokální úložiště souborů selhalo.")), { once: true });
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.addEventListener("complete", () => resolve(), { once: true });
  transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Zápis souboru byl přerušen.")), { once: true });
  transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Zápis souboru selhal.")), { once: true });
});

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
  });
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error ?? new Error("Lokální úložiště souborů nelze otevřít.")), { once: true });
});

const storageKey = (projectId: string, fileId: string) => `${projectId}:${fileId}`;
const safeExtension = (name: string) => name.includes(".") ? name.split(".").pop()!.toLocaleLowerCase("en-US") : "";
const safeArchiveFilename = (file: LocalProjectFile) => {
  const name = file.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180) || "document";
  return `${file.id.slice(-12)}-${name}`;
};
const sha256Blob = async (blob: Blob) => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
};

export function validateProjectFile(file: Pick<File, "name" | "size" | "type">, currentBytes: number): void {
  const extension = safeExtension(file.name);
  if (!file.name || file.name.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(file.name)) throw new TypeError("Název souboru není bezpečný.");
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new TypeError(`Formát .${extension || "?"} není podporován.`);
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_PROJECT_FILE_BYTES) throw new RangeError("Jeden soubor musí mít 1 B až 250 MB.");
  if (currentBytes + file.size > MAX_PROJECT_TOTAL_BYTES) throw new RangeError("Projekt překročil limit 1 GB.");
  if (file.type.length > 120) throw new TypeError("Typ souboru není platný.");
}

export async function createProjectFileMetadata(file: File, role: ProjectFileRole, currentBytes: number): Promise<LocalProjectFile> {
  validateProjectFile(file, currentBytes);
  return {
    id: `file_local_${crypto.randomUUID().replaceAll("-", "").slice(0, 32)}`,
    name: file.name,
    size: file.size,
    media_type: file.type || "application/octet-stream",
    role,
    sha256: await sha256Blob(file),
    created_at: new Date().toISOString(),
  };
}

export async function putProjectFile(projectId: string, metadata: LocalProjectFile, blob: Blob): Promise<void> {
  if (blob.size !== metadata.size) throw new TypeError("Velikost uloženého souboru nesouhlasí s metadaty.");
  if (isServerProject(projectId)) {
    try { await uploadServerFile(projectId, metadata, blob); }
    catch (error) { await deleteServerFile(projectId, metadata.id).catch(() => {}); throw error; }
    return;
  }
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put({ key: storageKey(projectId, metadata.id), project_id: projectId, file_id: metadata.id, blob } satisfies StoredProjectFile);
    await done;
  } finally { database.close(); }
}

export async function getProjectFile(projectId: string, metadata: LocalProjectFile): Promise<Blob> {
  if (isServerProject(projectId)) {
    const blob = await downloadServerFile(projectId, metadata.id);
    if (blob.size !== metadata.size || await sha256Blob(blob) !== metadata.sha256) throw new Error(`Serverový soubor ${metadata.name} neprošel kontrolou úplnosti.`);
    return blob.slice(0, blob.size, metadata.media_type);
  }
  return getLocalProjectFile(projectId, metadata);
}

export async function getLocalProjectFile(projectId: string, metadata: LocalProjectFile): Promise<Blob> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(storageKey(projectId, metadata.id))) as StoredProjectFile | undefined;
    if (!record || record.project_id !== projectId || record.file_id !== metadata.id || record.blob.size !== metadata.size) {
      throw new Error(`Soubor ${metadata.name} v lokálním úložišti chybí nebo je poškozený.`);
    }
    if (await sha256Blob(record.blob) !== metadata.sha256) throw new Error(`Kontrolní součet souboru ${metadata.name} nesouhlasí.`);
    return record.blob;
  } finally { database.close(); }
}

export async function deleteProjectFile(projectId: string, fileId: string): Promise<void> {
  if (isServerProject(projectId)) return deleteServerFile(projectId, fileId);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(storageKey(projectId, fileId));
    await done;
  } finally { database.close(); }
}

export async function projectArchiveFiles(project: LocalProject): Promise<readonly ProjectArchiveFile[]> {
  return Promise.all(project.files.map(async (metadata) => {
    const blob = await getProjectFile(project.id, metadata);
    return { path: `files/${safeArchiveFilename(metadata)}`, content: new Uint8Array(await blob.arrayBuffer()) };
  }));
}

export function projectFileRole(name: string): ProjectFileRole {
  const extension = safeExtension(name);
  return new Set(["pdf", "dwg", "dxf", "ifc", "png", "jpg", "jpeg", "tif", "tiff"]).has(extension)
    ? "drawing"
    : new Set(["xml", "landxml", "csv", "xlsx"]).has(extension) ? "data" : "other";
}
