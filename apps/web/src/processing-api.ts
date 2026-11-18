import { isContract, type StakeoutPointObject } from "@datamine/contracts";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { extractStakeoutCsv, isStakeoutCsv } from "./stakeout-csv.ts";
import type { LocalProjectFile } from "./local-projects";
import { readableExtractedGroupName, safeExtractedLayerId } from "./extracted-groups.ts";
export { readableExtractedGroupName, safeExtractedLayerId } from "./extracted-groups.ts";

export const MAX_DESKTOP_PDF_BYTES = 2 * 1024 * 1024;
export const isStakeoutPdf = (file: LocalProjectFile) =>
  file.media_type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
export const usesDesktopPdfWorker = () => typeof window !== "undefined" && isTauri();
const SERVER_PROJECT_ID = "project_local";
const DOCUMENT_ID = /^document_[A-Za-z0-9_-]{1,63}$/;
const JOB_ID = /^job_[A-Za-z0-9_-]{1,67}$/;
const ARTIFACT_ID = /^artifact_[A-Za-z0-9_-]{1,62}$/;
const SHA256 = /^[a-f0-9]{64}$/;

interface DocumentRecord {
  readonly id: string;
  readonly sha256: string;
  readonly upload_state: "quarantined" | "ready" | "rejected";
}

interface JobRecord {
  readonly id: string;
  readonly status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  readonly error_code?: string;
}

interface StakeoutImportPoint {
  readonly code: string;
  readonly name: string;
  readonly point: readonly [number, number, number];
  readonly kind: string;
  readonly page: number;
  readonly row: number;
}

interface StakeoutImportPayload {
  readonly schema_version: "datamine.stakeout-import.v1";
  readonly document_id: string;
  readonly source_document_sha256: string;
  readonly source_job_id?: string;
  readonly algorithm_version: "stakeout-pdf-import-v1" | "stakeout-csv-import-v1" | "stakeout-desktop-pdf-v1";
  readonly points: readonly StakeoutImportPoint[];
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const errorMessage = async (response: Response, fallback: string) => {
  try {
    const value: unknown = await response.json();
    if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
    if (value && typeof value === "object" && "detail" in value && typeof value.detail === "string") return value.detail;
    if (value && typeof value === "object" && "error" in value && value.error && typeof value.error === "object"
      && "message" in value.error && typeof value.error.message === "string") return value.error.message;
  } catch { /* bezpečný obecný text */ }
  return fallback;
};

const isDocumentRecord = (value: unknown): value is DocumentRecord => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DocumentRecord>;
  return typeof item.id === "string" && DOCUMENT_ID.test(item.id)
    && typeof item.sha256 === "string" && SHA256.test(item.sha256)
    && (item.upload_state === "quarantined" || item.upload_state === "ready" || item.upload_state === "rejected");
};

const isJobRecord = (value: unknown): value is JobRecord => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<JobRecord>;
  return typeof item.id === "string" && JOB_ID.test(item.id)
    && ["queued", "running", "succeeded", "failed", "cancelled"].includes(item.status ?? "")
    && (item.error_code === undefined || typeof item.error_code === "string");
};

const isStakeoutImport = (
  value: unknown,
  algorithm: "stakeout-pdf-import-v1" | "stakeout-desktop-pdf-v1",
): value is StakeoutImportPayload => {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<StakeoutImportPayload>;
  return item.schema_version === "datamine.stakeout-import.v1"
    && typeof item.document_id === "string" && DOCUMENT_ID.test(item.document_id)
    && typeof item.source_document_sha256 === "string" && SHA256.test(item.source_document_sha256)
    && (algorithm === "stakeout-desktop-pdf-v1"
      ? item.source_job_id === undefined
      : typeof item.source_job_id === "string" && JOB_ID.test(item.source_job_id))
    && item.algorithm_version === algorithm
    && Array.isArray(item.points) && item.points.length > 0 && item.points.length <= 10_000
    && item.points.every((point) => point && typeof point === "object"
      && typeof point.code === "string" && point.code.length > 0 && point.code.length <= 200
      && typeof point.name === "string" && point.name.length > 0 && point.name.length <= 200
      && typeof point.kind === "string" && point.kind.length > 0 && point.kind.length <= 200
      && Number.isInteger(point.page) && point.page >= 1
      && Number.isInteger(point.row) && point.row >= 1
      && Array.isArray(point.point) && point.point.length === 3 && point.point.every(Number.isFinite));
};

async function uploadDocument(file: LocalProjectFile, blob: Blob): Promise<DocumentRecord> {
  const response = await fetch(`/v2/projects/${SERVER_PROJECT_ID}/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "X-Document-Name": encodeURIComponent(file.name),
      "X-Document-Role": "stakeout",
      "X-Document-Size": String(blob.size),
      "Idempotency-Key": `upload:${file.id}`,
    },
    body: blob,
  });
  if (!response.ok) throw new Error(await errorMessage(response, "PDF nelze předat ke zpracování."));
  const value: unknown = await response.json();
  if (!isDocumentRecord(value) || value.sha256 !== file.sha256) throw new Error("Server vrátil neplatný dokumentový manifest.");
  return value;
}

async function waitForDocument(document: DocumentRecord, onStatus: (message: string) => void): Promise<DocumentRecord> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`/v2/projects/${SERVER_PROJECT_ID}/documents/${document.id}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await errorMessage(response, "Stav bezpečnostní kontroly nelze načíst."));
    const value: unknown = await response.json();
    if (!isDocumentRecord(value) || value.id !== document.id || value.sha256 !== document.sha256) throw new Error("Server vrátil neplatný stav dokumentu.");
    if (value.upload_state === "ready") return value;
    if (value.upload_state === "rejected") throw new Error("Bezpečnostní kontrola PDF odmítla.");
    onStatus("Probíhá bezpečnostní kontrola PDF…");
    await wait(500);
  }
  throw new Error("Bezpečnostní kontrola PDF překročila časový limit.");
}

async function createJob(document: DocumentRecord): Promise<JobRecord> {
  const response = await fetch("/v2/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": `stakeout:${document.id}` },
    body: JSON.stringify({
      schema_version: "datamine.job-create.v1",
      project_id: SERVER_PROJECT_ID,
      input: { kind: "document", id: document.id, sha256: document.sha256 },
      job_type: "stakeout.import.pdf",
      algorithm_version: "stakeout-pdf-import-v1",
      parameters: {},
    }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Extrakční úlohu nelze založit."));
  const value: unknown = await response.json();
  if (!isJobRecord(value)) throw new Error("Server vrátil neplatný manifest úlohy.");
  return value;
}

async function waitForJob(job: JobRecord, onStatus: (message: string) => void): Promise<JobRecord> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const response = await fetch(`/v2/jobs/${job.id}?project_id=${SERVER_PROJECT_ID}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await errorMessage(response, "Stav extrakční úlohy nelze načíst."));
    const value: unknown = await response.json();
    if (!isJobRecord(value) || value.id !== job.id) throw new Error("Server vrátil neplatný stav úlohy.");
    if (value.status === "succeeded") return value;
    if (value.status === "failed" || value.status === "cancelled") throw new Error(`Extrakce skončila bez výsledku (${value.error_code ?? value.status}).`);
    onStatus(value.status === "running" ? "Vytěžuji souřadnice z PDF…" : "Extrakce čeká ve frontě…");
    await wait(500);
  }
  throw new Error("Extrakce souřadnic překročila časový limit.");
}

async function extractDesktopPdf(file: LocalProjectFile, blob: Blob): Promise<StakeoutImportPayload> {
  if (!isStakeoutPdf(file) || blob.size !== file.size || blob.size > MAX_DESKTOP_PDF_BYTES) {
    throw new Error("Lokální worker přijímá PDF do 2 MiB.");
  }
  let result: unknown;
  try {
    result = await invoke("extract_stakeout_pdf", await blob.arrayBuffer());
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "Spuštění lokálního workeru selhalo.");
  }
  if (!result || typeof result !== "object" || !("points" in result)
    || !("source_document_sha256" in result) || result.source_document_sha256 !== file.sha256) {
    throw new Error("Výsledek lokálního workeru neodpovídá zdrojovému PDF.");
  }
  const payload = {
    schema_version: "datamine.stakeout-import.v1",
    document_id: `document_pdf_${file.sha256.slice(0, 32)}`,
    source_document_sha256: result.source_document_sha256,
    algorithm_version: "stakeout-desktop-pdf-v1",
    points: result.points,
  };
  if (!isStakeoutImport(payload, "stakeout-desktop-pdf-v1")) {
    throw new Error("Lokální worker vrátil neplatné souřadnice.");
  }
  return payload;
}

export async function extractStakeoutProposal(
  file: LocalProjectFile,
  blob: Blob,
  onStatus: (message: string) => void,
): Promise<StakeoutImportPayload> {
  if (isStakeoutCsv(file)) {
    onStatus("Načítám souřadnice a výšky z CSV…");
    return extractStakeoutCsv(file, blob);
  }
  if (usesDesktopPdfWorker()) {
    onStatus("Vytěžuji souřadnice z PDF místně…");
    return extractDesktopPdf(file, blob);
  }
  onStatus("Předávám PDF do karantény…");
  const document = await waitForDocument(await uploadDocument(file, blob), onStatus);
  onStatus("Zakládám extrakční úlohu…");
  const job = await waitForJob(await createJob(document), onStatus);
  const artifactResponse = await fetch(`/v2/jobs/${job.id}/artifact?project_id=${SERVER_PROJECT_ID}`, { cache: "no-store" });
  if (!artifactResponse.ok) throw new Error(await errorMessage(artifactResponse, "Výsledek extrakce nelze načíst."));
  const artifact: unknown = await artifactResponse.json();
  if (!artifact || typeof artifact !== "object" || !("id" in artifact) || typeof artifact.id !== "string" || !ARTIFACT_ID.test(artifact.id)) throw new Error("Server vrátil neplatný artefakt.");
  const contentResponse = await fetch(`/v2/projects/${SERVER_PROJECT_ID}/artifacts/${artifact.id}/content`, { cache: "no-store" });
  if (!contentResponse.ok) throw new Error(await errorMessage(contentResponse, "Obsah extrakce nelze načíst."));
  const payload: unknown = await contentResponse.json();
  if (!isStakeoutImport(payload, "stakeout-pdf-import-v1") || payload.document_id !== document.id || payload.source_document_sha256 !== file.sha256 || payload.source_job_id !== job.id) {
    throw new Error("Výsledek extrakce není svázaný se zdrojovým PDF.");
  }
  return payload;
}

const safeCode = (value: string, suffix: string) => {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[^A-Za-z0-9]+/, "").slice(0, 34) || "POINT";
  return `${normalized}_${suffix}`.slice(0, 50);
};

export function stakeoutObjectsFromProposal(
  payload: StakeoutImportPayload,
  file: LocalProjectFile,
  epsg = 5514,
  verticalDatum = "Bpv",
): readonly StakeoutPointObject[] {
  const suffix = file.id.slice(-8);
  const objects = payload.points.map((point, index): StakeoutPointObject => {
    const groupName = readableExtractedGroupName(point.kind);
    return {
      schema_version: "datamine.stakeout-point.v1",
      id: `object_stakeout_${suffix}_${String(index + 1).padStart(5, "0")}`,
      type: "stakeout.point",
      layer_id: safeExtractedLayerId(groupName),
      geometry: { kind: "point3d", coordinate_space: "survey_crs", point: [...point.point] },
      properties: {
        schema_version: "datamine.stakeout-point-properties.v1",
        name: point.name.replace(/[<>\u0000-\u001f]/g, " ").trim().slice(0, 200) || `Vytyčovací bod ${index + 1}`,
        code: safeCode(point.code, `${suffix}_${index + 1}`),
        crs: { kind: "epsg", epsg, axis_order: "east_north_up", horizontal_unit: "m", vertical_unit: "m", vertical_datum: verticalDatum },
        derivation: {
          kind: "document_import",
          page: point.page,
          row: point.row,
          source_code: point.code.replace(/[<>\u0000-\u001f]/g, " ").trim().slice(0, 200) || `Bod ${index + 1}`,
          source_layer: groupName,
        },
        coordinate_tolerance_m: 0.001,
        accuracy: { horizontal_m: 0.02, vertical_m: 0.03, method: "derived" },
        review_state: "unreviewed",
      },
      provenance: {
        source_document_id: payload.document_id,
        source_document_sha256: payload.source_document_sha256,
        ...(payload.source_job_id ? { source_job_id: payload.source_job_id } : {}),
        source_kind: payload.source_job_id ? "automatic" : "imported",
        algorithm_version: payload.algorithm_version,
      },
    };
  });
  if (!objects.every((object) => isContract("model_object", object))) throw new Error("Vytěžené body neprošly kontrolou modelového kontraktu.");
  return objects;
}

export type { StakeoutImportPayload };
