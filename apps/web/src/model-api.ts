import {
  isContract,
  type BuildingObject,
  type CivilAxisObject,
  type CivilMaterialLayerObject,
  type CivilPointObject,
  type CivilProfileObject,
  type ModelObject,
  type ModelVersion,
  type ModelVersionCommand,
  type ModelVersionCommandBatch,
  type StakeoutGroupObject,
  type StakeoutPointObject,
  type TinSurfaceObject,
} from "@datamine/contracts";

const PROJECT_ID_PATTERN = /^project_[A-Za-z0-9_-]+$/;
const VERSION_ID_PATTERN = /^version_[A-Za-z0-9_-]+$/;
const SHA_ETAG_PATTERN = /^"([a-f0-9]{64})"$/;

export interface ModelRoute {
  readonly projectId: string;
  readonly versionId: string;
}

export interface LoadedModel {
  readonly model: ModelVersion;
  readonly contentSha256: string;
}

interface ExpectedModel {
  readonly projectId: string;
  readonly versionId?: string;
  readonly parentId?: string;
  readonly revision?: number;
  readonly status?: "working" | "validated";
}

export class ModelApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelApiError";
  }
}

export function commandsForChanges(
  baseObjects: readonly ModelObject[],
  currentObjects: readonly ModelObject[],
  createCommandId: () => string,
): readonly ModelVersionCommand[] {
  const baseById = new Map(baseObjects.map((object) => [object.id, object]));
  const commands: ModelVersionCommand[] = [];
  for (const object of currentObjects) {
    const base = baseById.get(object.id);
    if (!base) {
      if (object.type === "civil.sweep") {
        commands.push({ id: createCommandId(), type: "civil.sweep.commit", object });
      } else if (object.type === "civil.point" || object.type === "civil.tin_surface" || object.type === "civil.material_layer" || object.type === "civil.axis" || object.type === "civil.profile") {
        commands.push({ id: createCommandId(), type: "civil.object.upsert", object });
      } else if (object.type === "stakeout.point") {
        commands.push({ id: createCommandId(), type: "stakeout.point.upsert", object });
      } else if (object.type === "stakeout.group") {
        commands.push({ id: createCommandId(), type: "stakeout.group.upsert", object });
      }
      continue;
    }
    if (JSON.stringify(object) === JSON.stringify(base)) continue;
    if (object.type === "rooms.room") {
      commands.push({ id: createCommandId(), type: "rooms.object.upsert", object });
      continue;
    }
    if (object.type.startsWith("civil.") && base.type.startsWith("civil.")) {
      const reviewChanged = object.properties.review_state !== base.properties.review_state;
      if ((object.type === "civil.point" || object.type === "civil.tin_surface" || object.type === "civil.material_layer" || object.type === "civil.axis" || object.type === "civil.profile")
        && (base.type === "civil.point" || base.type === "civil.tin_surface" || base.type === "civil.material_layer" || base.type === "civil.axis" || base.type === "civil.profile")) {
        const geometryChange = structuredClone(object) as CivilPointObject | TinSurfaceObject | CivilMaterialLayerObject | CivilAxisObject | CivilProfileObject;
        geometryChange.properties.review_state = base.properties.review_state;
        if (JSON.stringify(geometryChange) !== JSON.stringify(base)) {
          commands.push({ id: createCommandId(), type: "civil.object.upsert", object: geometryChange });
        }
      }
      if (reviewChanged) {
        if (object.properties.review_state === "unreviewed") {
          throw new ModelApiError("Civil review nelze vrátit do stavu neověřeno.");
        }
        commands.push({
          id: createCommandId(),
          type: "civil.review.set",
          object_id: object.id,
          review_state: object.properties.review_state,
          reason_code: "HUMAN_UI_REVIEW",
        });
      }
      continue;
    }
    if (object.type === "stakeout.point" && base.type === "stakeout.point") {
      const reviewChanged = object.properties.review_state !== base.properties.review_state;
      const editable = structuredClone(object) as StakeoutPointObject;
      editable.properties.review_state = base.properties.review_state;
      if (JSON.stringify(editable) !== JSON.stringify(base)) {
        if (base.properties.derivation.kind !== "manual") {
          throw new ModelApiError("Odvozený bod lze upravit až po explicitním převodu na ruční bod.");
        }
        commands.push({ id: createCommandId(), type: "stakeout.point.upsert", object: editable });
      }
      if (reviewChanged) {
        if (object.properties.review_state === "unreviewed") {
          throw new ModelApiError("Stakeout review nelze vrátit do stavu neověřeno.");
        }
        commands.push({
          id: createCommandId(), type: "stakeout.review.set", object_id: object.id,
          review_state: object.properties.review_state, reason_code: "HUMAN_UI_REVIEW",
        });
      }
      continue;
    }
    if (object.type === "stakeout.group" && base.type === "stakeout.group") {
      const reviewChanged = object.properties.review_state !== base.properties.review_state;
      const membersChanged = JSON.stringify(object.properties.point_ids) !== JSON.stringify(base.properties.point_ids);
      const editable = structuredClone(object) as StakeoutGroupObject;
      editable.properties.review_state = base.properties.review_state;
      editable.properties.point_ids = [...base.properties.point_ids];
      if (JSON.stringify(editable) !== JSON.stringify(base)) {
        commands.push({ id: createCommandId(), type: "stakeout.group.upsert", object: editable });
      }
      if (membersChanged) {
        commands.push({
          id: createCommandId(), type: "stakeout.group.members.set",
          object_id: object.id, point_ids: [...object.properties.point_ids],
        });
      }
      if (reviewChanged) {
        if (object.properties.review_state === "unreviewed") {
          throw new ModelApiError("Stakeout review nelze vrátit do stavu neověřeno.");
        }
        commands.push({
          id: createCommandId(), type: "stakeout.review.set", object_id: object.id,
          review_state: object.properties.review_state, reason_code: "HUMAN_UI_REVIEW",
        });
      }
      continue;
    }
    if (!object.type.startsWith("building.") || !base.type.startsWith("building.")) continue;
    const building = object as BuildingObject;
    const baseBuilding = base as BuildingObject;
    const reviewChanged = building.properties.review_state !== baseBuilding.properties.review_state;
    const geometryChange = structuredClone(building);
    geometryChange.properties.review_state = baseBuilding.properties.review_state;
    const hostChanged = (
      building.type === "building.opening"
      && baseBuilding.type === "building.opening"
      && building.properties.host_wall_id !== baseBuilding.properties.host_wall_id
    );
    if (hostChanged && geometryChange.type === "building.opening" && baseBuilding.type === "building.opening") {
      geometryChange.properties.host_wall_id = baseBuilding.properties.host_wall_id;
    }
    if (JSON.stringify(geometryChange) !== JSON.stringify(baseBuilding)) {
      commands.push({ id: createCommandId(), type: "building.object.upsert", object: geometryChange });
    }
    if (hostChanged && building.type === "building.opening") {
      commands.push({
        id: createCommandId(),
        type: "building.opening.assign-host",
        object_id: building.id,
        host_wall_id: building.properties.host_wall_id,
        reason_code: "HUMAN_UI_ASSIGN_HOST",
      });
    }
    if (reviewChanged) {
      if (building.properties.review_state === "unreviewed") {
        throw new ModelApiError("Building review nelze vrátit do stavu neověřeno.");
      }
      commands.push({
        id: createCommandId(),
        type: "building.review.set",
        object_id: building.id,
        review_state: building.properties.review_state,
        reason_code: "HUMAN_UI_REVIEW",
      });
    }
  }
  return Object.freeze(commands);
}

export function routeFromLocation(location: Location): ModelRoute | null {
  const parameters = new URLSearchParams(location.search);
  const projectId = parameters.get("project");
  const versionId = parameters.get("version");
  if (!projectId && !versionId) {
    return null;
  }
  if (!projectId || !versionId || !PROJECT_ID_PATTERN.test(projectId) || !VERSION_ID_PATTERN.test(versionId)) {
    throw new ModelApiError("URL editoru neobsahuje platný projekt a modelovou verzi.");
  }
  return Object.freeze({ projectId, versionId });
}

export function documentContentUrl(model: ModelVersion): string {
  return `/v2/projects/${encodeURIComponent(model.project_id)}/documents/${encodeURIComponent(model.document_id)}/content`;
}

export function scopedDocumentContentUrl(projectId: string, documentId: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId) || !/^document_[A-Za-z0-9_-]+$/.test(documentId)) {
    throw new ModelApiError("Dokumentový content odkaz nemá platný scope.");
  }
  return `/v2/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/content`;
}

export async function loadModel(route: ModelRoute, signal?: AbortSignal): Promise<LoadedModel> {
  return requestModel(
    `/v2/projects/${encodeURIComponent(route.projectId)}/model-versions/${encodeURIComponent(route.versionId)}`,
    { method: "GET", credentials: "same-origin", signal },
    { projectId: route.projectId, versionId: route.versionId },
  );
}

export async function saveWorkingModel(
  base: LoadedModel,
  commands: readonly ModelVersionCommand[],
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<LoadedModel> {
  const batch: ModelVersionCommandBatch = {
    schema_version: "datamine.model-version-command-batch.v1",
    project_id: base.model.project_id,
    base_version_id: base.model.id,
    base_revision: base.model.revision,
    base_content_sha256: base.contentSha256,
    commands: [...commands],
  };
  if (!isContract("model_version_command_batch", batch)) {
    throw new ModelApiError("Lokální změny nelze bezpečně serializovat.");
  }
  return requestModel(
    `/v2/projects/${encodeURIComponent(base.model.project_id)}/model-versions/${encodeURIComponent(base.model.id)}/commands`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(batch),
      signal,
    },
    {
      projectId: base.model.project_id,
      parentId: base.model.id,
      revision: base.model.revision + 1,
      status: "working",
    },
  );
}

export async function validateWorkingModel(
  base: LoadedModel,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<LoadedModel> {
  if (base.model.status !== "working") {
    throw new ModelApiError("Potvrdit lze pouze uloženou pracovní verzi.");
  }
  const batch: ModelVersionCommandBatch = {
    schema_version: "datamine.model-version-command-batch.v1",
    project_id: base.model.project_id,
    base_version_id: base.model.id,
    base_revision: base.model.revision,
    base_content_sha256: base.contentSha256,
    commands: [],
  };
  if (!isContract("model_version_command_batch", batch)) {
    throw new ModelApiError("Pracovní verzi nelze bezpečně potvrdit.");
  }
  return requestModel(
    `/v2/projects/${encodeURIComponent(base.model.project_id)}/model-versions/${encodeURIComponent(base.model.id)}/validate`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(batch),
      signal,
    },
    {
      projectId: base.model.project_id,
      parentId: base.model.id,
      revision: base.model.revision + 1,
      status: "validated",
    },
  );
}

async function requestModel(
  url: string,
  init: RequestInit,
  expected: ExpectedModel,
): Promise<LoadedModel> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ModelApiError("Datamine API není dostupné.");
  }
  if (!response.ok) {
    throw new ModelApiError(response.status === 409
      ? "Model mezitím změnil jiný požadavek. Lokální změny zůstaly zachované."
      : "Datamine API odmítlo požadavek.");
  }
  const match = response.headers.get("ETag")?.match(SHA_ETAG_PATTERN);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ModelApiError("Datamine API vrátilo neplatnou odpověď.");
  }
  if (!match || !isContract("model_version", payload)) {
    throw new ModelApiError("Datamine API vrátilo neověřitelnou modelovou verzi.");
  }
  const model = payload as ModelVersion;
  const view = model.document_view;
  const cadView = model.cad_underlay_view;
  if (
    (!view && !cadView)
    || model.project_id !== expected.projectId
    || expected.versionId !== undefined && model.id !== expected.versionId
    || expected.parentId !== undefined && model.parent_id !== expected.parentId
    || expected.revision !== undefined && model.revision !== expected.revision
    || expected.status !== undefined && model.status !== expected.status
    || view !== undefined && view.source_document_id !== model.document_id
    || model.objects.some((object) => (
      object.provenance.source_document_id !== model.document_id
      || view !== undefined && object.provenance.source_document_sha256 !== view.source_document_sha256
    ))
  ) {
    throw new ModelApiError("Modelová verze neodpovídá požadované serverové větvi.");
  }
  return Object.freeze({ model, contentSha256: match[1]! });
}
