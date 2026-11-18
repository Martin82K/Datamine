import { isStoredDrawingUnderlay, type StoredDrawingUnderlay } from "./drawing-underlay.ts";
import { isStoredMapContext, type StoredMapContext } from "./civil-map.ts";
import { isContract, type ModelObject } from "@datamine/contracts";
import type { ProjectType } from "./project-context";
import { inferredLegacyExtractedGroup, safeExtractedLayerId } from "./extracted-groups.ts";

export const LOCAL_PROJECTS_KEY = "datamine.local-projects.v1";
const MAX_PROJECTS = 100;
const MAX_OBJECTS_PER_PROJECT = 10_000;
const MAX_SERIALIZED_BYTES = 5_000_000;
const PROJECT_ID = /^project_local_[A-Za-z0-9_-]{8,64}$/;
const FILE_ID = /^file_local_[A-Za-z0-9_-]{8,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LEGACY_DEMO_OBJECT_IDS = new Set([
  "object_axis_demo", "object_profile_demo", "object_civil_point_a", "object_civil_point_b",
  "object_stakeout_demo_001", "object_stakeout_group_demo", "object_room_101",
  "object_wall_demo", "object_opening_demo", "object_floor_demo",
]);

export type ProjectFileRole = "drawing" | "data" | "other";

export interface LocalProjectFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly media_type: string;
  readonly role: ProjectFileRole;
  readonly sha256: string;
  readonly created_at: string;
}

export interface LocalProject {
  readonly drawing_underlay?: StoredDrawingUnderlay;
  readonly map_context?: StoredMapContext;
  readonly server_revision?: number;
  readonly view_settings?: ProjectViewSettings;
  readonly schema_version: "datamine.local-project.v1";
  readonly id: string;
  readonly name: string;
  readonly project_type: ProjectType;
  readonly status: "active" | "archived";
  readonly created_at: string;
  readonly updated_at: string;
  readonly objects: readonly ModelObject[];
  readonly files: readonly LocalProjectFile[];
}

export interface ProjectViewSettings {
  readonly names?: Readonly<Record<string, string>>;
  readonly colors?: Readonly<Record<string, string>>;
  readonly opacities?: Readonly<Record<string, number>>;
  readonly hidden?: readonly string[];
  readonly triangulation?: boolean;
}

export function isProjectViewSettings(value: unknown): value is ProjectViewSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  if (Object.keys(settings).some((key) => !["names", "colors", "opacities", "hidden", "triangulation"].includes(key))) return false;
  const layerId = /^layer_[A-Za-z0-9_-]{1,100}$/;
  for (const kind of ["names", "colors", "opacities"]) {
    const entries = settings[kind] ?? {};
    if (!entries || typeof entries !== "object" || Array.isArray(entries) || Object.keys(entries).length > 500) return false;
    if (!Object.entries(entries).every(([key, item]) => layerId.test(key) && (kind === "opacities"
      ? typeof item === "number" && Number.isFinite(item) && item >= 0.05 && item <= 1
      : typeof item === "string" && (kind === "colors" ? /^#[0-9a-fA-F]{6}$/.test(item)
        : item === item.trim() && /^[^<>\u0000-\u001f\u007f]{1,120}$/.test(item))))) return false;
  }
  return (settings.hidden === undefined || Array.isArray(settings.hidden) && settings.hidden.length <= 500 && settings.hidden.every((id) => typeof id === "string" && layerId.test(id)))
    && (settings.triangulation === undefined || typeof settings.triangulation === "boolean");
}

const validDate = (value: unknown): value is string => (
  typeof value === "string" && Number.isFinite(Date.parse(value))
);

export function isLocalProject(value: unknown): value is LocalProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const project = value as Partial<LocalProject>;
  return (project.drawing_underlay === undefined || isStoredDrawingUnderlay(project.drawing_underlay))
    && (project.map_context === undefined || isStoredMapContext(project.map_context))
    && project.schema_version === "datamine.local-project.v1"
    && (project.server_revision === undefined || Number.isSafeInteger(project.server_revision) && project.server_revision > 0)
    && (project.view_settings === undefined || isProjectViewSettings(project.view_settings))
    && typeof project.id === "string" && PROJECT_ID.test(project.id)
    && typeof project.name === "string" && project.name.trim().length > 0 && project.name.length <= 120
    && (project.project_type === "building" || project.project_type === "civil")
    && (project.status === "active" || project.status === "archived")
    && validDate(project.created_at) && validDate(project.updated_at)
    && Array.isArray(project.objects) && project.objects.length <= MAX_OBJECTS_PER_PROJECT
    && project.objects.every((object) => isContract("model_object", object))
    && Array.isArray(project.files) && project.files.length <= 1_000
    && project.files.every(isLocalProjectFile)
    && new Set(project.files.map((file) => file.id)).size === project.files.length;
}

export function isLocalProjectFile(value: unknown): value is LocalProjectFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Partial<LocalProjectFile>;
  return typeof file.id === "string" && FILE_ID.test(file.id)
    && typeof file.name === "string" && file.name.length > 0 && file.name.length <= 180
    && !/[\\/\u0000-\u001f\u007f]/.test(file.name) && file.name !== "." && file.name !== ".."
    && typeof file.size === "number" && Number.isSafeInteger(file.size) && file.size > 0
    && typeof file.media_type === "string" && file.media_type.length > 0 && file.media_type.length <= 120
    && (file.role === "drawing" || file.role === "data" || file.role === "other")
    && typeof file.sha256 === "string" && SHA256.test(file.sha256)
    && validDate(file.created_at);
}

const migrateLocalProject = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const project = value as Record<string, unknown>;
  if (project.schema_version !== "datamine.local-project.v1") return project;
  const objects = Array.isArray(project.objects)
    ? project.objects.filter((object) => !(
      object && typeof object === "object" && "id" in object
      && typeof object.id === "string" && LEGACY_DEMO_OBJECT_IDS.has(object.id)
    )).map((object) => {
      if (!object || typeof object !== "object" || !("type" in object) || object.type !== "stakeout.point"
        || !("properties" in object) || !object.properties || typeof object.properties !== "object"
        || !("derivation" in object.properties) || !object.properties.derivation || typeof object.properties.derivation !== "object"
        || !("kind" in object.properties.derivation) || object.properties.derivation.kind !== "document_import"
        || !("name" in object.properties) || typeof object.properties.name !== "string") return object;
      const record = object as Record<string, unknown>;
      // Only migrate the old generic import bucket. A user may intentionally
      // merge/rename imported points; never infer over an explicit layer edit.
      if (object.properties.derivation.source_layer !== "Importované body"
        || (record.layer_id !== "layer_stakeout_import"
          && record.layer_id !== safeExtractedLayerId("Importované body"))) return object;
      const group = inferredLegacyExtractedGroup(object.properties.name);
      if (!group) return object;
      return {
        ...record,
        layer_id: safeExtractedLayerId(group),
        properties: { ...object.properties, derivation: { ...object.properties.derivation, source_layer: group } },
      };
    })
    : project.objects;
  return { ...project, files: project.files ?? [], objects };
};

export function readLocalProjects(storage: Pick<Storage, "getItem">): readonly LocalProject[] {
  const raw = storage.getItem(LOCAL_PROJECTS_KEY);
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > MAX_PROJECTS) return [];
    const migrated = value.map(migrateLocalProject);
    if (!migrated.every(isLocalProject)) return [];
    return Object.freeze([...migrated].sort((left, right) => right.updated_at.localeCompare(left.updated_at)));
  } catch {
    return [];
  }
}

export function writeLocalProjects(
  storage: Pick<Storage, "setItem">,
  projects: readonly LocalProject[],
): void {
  if (projects.length > MAX_PROJECTS || !projects.every(isLocalProject)) {
    throw new TypeError("Katalog projektů není platný.");
  }
  const encoded = JSON.stringify(projects);
  if (new TextEncoder().encode(encoded).byteLength > MAX_SERIALIZED_BYTES) {
    throw new RangeError("Lokální katalog překročil bezpečný limit 5 MB.");
  }
  storage.setItem(LOCAL_PROJECTS_KEY, encoded);
}

export function createLocalProject(
  name: string,
  projectType: ProjectType,
  objects: readonly ModelObject[],
  now = new Date(),
  randomId = crypto.randomUUID(),
): LocalProject {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 120) throw new TypeError("Název projektu musí mít 1 až 120 znaků.");
  const project: LocalProject = {
    schema_version: "datamine.local-project.v1",
    id: `project_local_${randomId.replaceAll("-", "").slice(0, 32)}`,
    name: normalizedName,
    project_type: projectType,
    status: "active",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    objects: structuredClone(objects),
    files: [],
  };
  if (!isLocalProject(project)) throw new TypeError("Nový projekt neprošel kontrolou.");
  return project;
}

export function updateLocalProject(
  project: LocalProject,
  changes: { readonly status?: LocalProject["status"]; readonly objects?: readonly ModelObject[]; readonly files?: readonly LocalProjectFile[] },
  now = new Date(),
): LocalProject {
  const updated: LocalProject = {
    ...project,
    status: changes.status ?? project.status,
    objects: changes.objects ? structuredClone(changes.objects) : project.objects,
    files: changes.files ? structuredClone(changes.files) : project.files,
    updated_at: now.toISOString(),
  };
  if (!isLocalProject(updated)) throw new TypeError("Aktualizovaný projekt neprošel kontrolou.");
  return updated;
}

export function localProjectIdFromLocation(location: Pick<Location, "search">): string | null {
  const value = new URLSearchParams(location.search).get("localProject");
  return value && PROJECT_ID.test(value) ? value : null;
}

export function workspaceProjectIdFromLocation(location: Pick<Location, "search">): string | null {
  const value = new URLSearchParams(location.search).get("workspace");
  return value && PROJECT_ID.test(value) ? value : null;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const u16 = (value: number) => Uint8Array.of(value & 0xff, value >>> 8 & 0xff);
const u32 = (value: number) => Uint8Array.of(value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff, value >>> 24 & 0xff);
const join = (parts: readonly Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
};

export interface ProjectArchiveFile {
  readonly path: string;
  readonly content: Uint8Array;
}

export function createProjectArchive(project: LocalProject, projectFiles: readonly ProjectArchiveFile[] = []): Uint8Array {
  if (!isLocalProject(project)) throw new TypeError("Projekt nelze archivovat.");
  if (projectFiles.length !== project.files.length || projectFiles.some((file) => !/^files\/[A-Za-z0-9._-]{1,240}$/.test(file.path))) {
    throw new TypeError("Soubory projektu nejsou úplné nebo mají nebezpečnou cestu.");
  }
  const encoder = new TextEncoder();
  const files = [
    ["project.json", encoder.encode(JSON.stringify({ ...project, objects: undefined }, null, 2))],
    ["model.json", encoder.encode(JSON.stringify({ objects: project.objects }, null, 2))],
    ...projectFiles.map((file) => [file.path, file.content] as const),
  ] as const;
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const [filename, content] of files) {
    const name = encoder.encode(filename);
    const crc = crc32(content);
    const local = join([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(content.length), u32(content.length), u16(name.length), u16(0), name, content,
    ]);
    localParts.push(local);
    centralParts.push(join([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(content.length), u32(content.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length;
  }
  const central = join(centralParts);
  return join([
    ...localParts,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0),
  ]);
}

export function safeProjectArchiveName(project: LocalProject): string {
  const stem = project.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "datamine-project";
  return `${stem}.datamine.zip`;
}
