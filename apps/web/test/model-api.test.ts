import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { CivilMaterialLayerObject, CivilPointObject, ModelVersion, TinSurfaceObject } from "@datamine/contracts";
import {
  ModelApiError,
  commandsForChanges,
  loadModel,
  routeFromLocation,
  saveWorkingModel,
  scopedDocumentContentUrl,
  validateWorkingModel,
} from "../src/model-api.ts";

const foundation = JSON.parse(await readFile(
  new URL("../../../fixtures/contracts/v1/valid-foundation.json", import.meta.url),
  "utf8",
));
const documentView = JSON.parse(await readFile(
  new URL("../../../fixtures/contracts/v1/valid-document-view.json", import.meta.url),
  "utf8",
));
const proposal: ModelVersion = { ...foundation.model_version, document_view: documentView };
const etag = `"${"a".repeat(64)}"`;

const response = (model: ModelVersion, responseEtag = etag) => new Response(
  JSON.stringify(model),
  { status: 200, headers: { "Content-Type": "application/json", ETag: responseEtag } },
);

test("route přijme jen úplnou dvojici typovaných ID", () => {
  assert.deepEqual(
    routeFromLocation({ search: "?project=project_demo&version=version_initial" } as Location),
    { projectId: "project_demo", versionId: "version_initial" },
  );
  assert.equal(routeFromLocation({ search: "" } as Location), null);
  assert.throws(
    () => routeFromLocation({ search: "?project=../../etc&version=version_initial" } as Location),
    ModelApiError,
  );
});

test("CAD underlay content URL je same-origin a typovaně scoped", () => {
  assert.equal(
    scopedDocumentContentUrl("project_demo", "document_cad_pdf"),
    "/v2/projects/project_demo/documents/document_cad_pdf/content",
  );
  assert.throws(() => scopedDocumentContentUrl("../../etc", "document_cad_pdf"), ModelApiError);
  assert.throws(() => scopedDocumentContentUrl("project_demo", "https://evil.invalid"), ModelApiError);
});

test("load odmítne cizí model, chybějící ETag a rozvázanou kalibraci", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => response(proposal);
    const loaded = await loadModel({ projectId: "project_demo", versionId: "version_initial" });
    assert.equal(loaded.model.id, "version_initial");
    assert.equal(loaded.contentSha256, "a".repeat(64));

    global.fetch = async () => response({ ...proposal, id: "version_foreign" });
    await assert.rejects(
      loadModel({ projectId: "project_demo", versionId: "version_initial" }),
      ModelApiError,
    );
    global.fetch = async () => response(proposal, "invalid");
    await assert.rejects(
      loadModel({ projectId: "project_demo", versionId: "version_initial" }),
      ModelApiError,
    );
    const unbound = structuredClone(proposal);
    unbound.document_view!.source_document_id = "document_foreign";
    global.fetch = async () => response(unbound);
    await assert.rejects(
      loadModel({ projectId: "project_demo", versionId: "version_initial" }),
      ModelApiError,
    );
    const cadOnly = structuredClone(proposal);
    delete cadOnly.document_view;
    cadOnly.cad_underlay_view = JSON.parse(await readFile(
      new URL("../../../fixtures/contracts/v1/valid-cad-underlay-view.json", import.meta.url),
      "utf8",
    ));
    global.fetch = async () => response(cadOnly);
    assert.equal(
      (await loadModel({ projectId: "project_demo", versionId: "version_initial" })).model.id,
      "version_initial",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("save váže command batch na base SHA a přijme jen přesný working child", async () => {
  const originalFetch = global.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  const child: ModelVersion = {
    ...structuredClone(proposal),
    id: "version_working_1",
    parent_id: proposal.id,
    revision: 1,
    status: "working",
  };
  try {
    global.fetch = async (url, init) => {
      request = { url: String(url), init };
      return response(child, `"${"b".repeat(64)}"`);
    };
    const loaded = { model: proposal, contentSha256: "a".repeat(64) };
    const result = await saveWorkingModel(loaded, [{
      id: "command_test_1",
      type: "rooms.object.upsert",
      object: proposal.objects[0],
    }], "save-test-0001");

    assert.equal(result.model.status, "working");
    assert.match(request!.url, /\/version_initial\/commands$/);
    const body = JSON.parse(String(request!.init!.body));
    assert.equal(body.base_content_sha256, "a".repeat(64));
    assert.equal(body.base_revision, 0);
    assert.equal(new Headers(request!.init!.headers).get("Idempotency-Key"), "save-test-0001");

    global.fetch = async () => response({ ...child, parent_id: "version_foreign" });
    await assert.rejects(
      saveWorkingModel(loaded, [], "save-test-0002"),
      ModelApiError,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("validate přijme jen přesný validated child pracovní verze", async () => {
  const originalFetch = global.fetch;
  const working: ModelVersion = {
    ...structuredClone(proposal),
    id: "version_working_1",
    parent_id: proposal.id,
    revision: 1,
    status: "working",
  };
  const validated: ModelVersion = {
    ...structuredClone(working),
    id: "version_validated_2",
    parent_id: working.id,
    revision: 2,
    status: "validated",
  };
  let request: { url: string; init?: RequestInit } | undefined;
  try {
    global.fetch = async (url, init) => {
      request = { url: String(url), init };
      return response(validated, `"${"c".repeat(64)}"`);
    };
    const base = { model: working, contentSha256: "b".repeat(64) };
    const result = await validateWorkingModel(base, "validate-test-0001");

    assert.equal(result.model.status, "validated");
    assert.match(request!.url, /\/version_working_1\/validate$/);
    const body = JSON.parse(String(request!.init!.body));
    assert.deepEqual(body.commands, []);
    assert.equal(body.base_revision, 1);
    assert.equal(body.base_content_sha256, "b".repeat(64));

    global.fetch = async () => response({ ...validated, status: "working" });
    await assert.rejects(
      validateWorkingModel(base, "validate-test-0002"),
      ModelApiError,
    );
    await assert.rejects(
      validateWorkingModel({ model: proposal, contentSha256: "a".repeat(64) }, "validate-test-0003"),
      ModelApiError,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("building změny se serializují do odděleného upsert a review commandu", async () => {
  const building = JSON.parse(await readFile(
    new URL("../../../fixtures/contracts/v1/valid-building-model.json", import.meta.url),
    "utf8",
  )) as ModelVersion;
  const current = structuredClone(building.objects);
  const wall = current.find((object) => object.type === "building.wall")!;
  if (wall.type !== "building.wall") throw new Error("Fixture nemá stěnu.");
  wall.properties.thickness_m = 0.4;
  wall.properties.volume_m3 = 6;
  wall.properties.review_state = "corrected";
  let sequence = 0;
  const commands = commandsForChanges(
    building.objects,
    current,
    () => `command_building_${sequence += 1}`,
  );
  assert.equal(commands.length, 2);
  assert.equal(commands[0].type, "building.object.upsert");
  assert.equal(commands[0].object.properties.review_state, "confirmed");
  assert.equal(commands[1].type, "building.review.set");
  assert.equal(commands[1].review_state, "corrected");

  wall.properties.review_state = "unreviewed";
  assert.throws(
    () => commandsForChanges(building.objects, current, () => "command_invalid"),
    ModelApiError,
  );
});

test("změna hostitele otvoru používá explicitní auditovatelný command", async () => {
  const building = JSON.parse(await readFile(
    new URL("../../../fixtures/contracts/v1/valid-building-model.json", import.meta.url),
    "utf8",
  )) as ModelVersion;
  const current = structuredClone(building.objects);
  const opening = current.find((object) => object.type === "building.opening")!;
  if (opening.type !== "building.opening") throw new Error("Fixture nemá otvor.");
  opening.properties.host_wall_id = "object_wall_02";
  const commands = commandsForChanges(building.objects, current, () => "command_assign_host");
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], {
    id: "command_assign_host",
    type: "building.opening.assign-host",
    object_id: opening.id,
    host_wall_id: "object_wall_02",
    reason_code: "HUMAN_UI_ASSIGN_HOST",
  });
});

test("civil preview commit a review se serializují odděleně", async () => {
  const civil = JSON.parse(await readFile(
    new URL("../../../fixtures/contracts/v1/valid-civil-tools-model.json", import.meta.url),
    "utf8",
  )) as ModelVersion;
  const base = civil.objects.slice(0, 2);
  const current = structuredClone(civil.objects);
  let sequence = 0;
  const commands = commandsForChanges(base, current, () => `command_civil_${sequence += 1}`);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "civil.sweep.commit");

  const reviewed = structuredClone(civil.objects);
  const sweep = reviewed.find((object) => object.type === "civil.sweep")!;
  sweep.properties.review_state = "confirmed";
  const reviewCommands = commandsForChanges(civil.objects, reviewed, () => "command_civil_review");
  assert.deepEqual(reviewCommands, [{
    id: "command_civil_review",
    type: "civil.review.set",
    object_id: sweep.id,
    review_state: "confirmed",
    reason_code: "HUMAN_UI_REVIEW",
  }]);
});

test("stakeout editace, členství a review používají oddělené commandy", async () => {
  const stakeout = JSON.parse(await readFile(
    new URL("../../../fixtures/contracts/v1/valid-stakeout-model.json", import.meta.url),
    "utf8",
  )) as ModelVersion;
  const current = structuredClone(stakeout.objects);
  const point = current.find((object) => object.type === "stakeout.point" && object.properties.code === "M001")!;
  const group = current.find((object) => object.type === "stakeout.group")!;
  if (point.type !== "stakeout.point" || group.type !== "stakeout.group") throw new Error("Fixture není úplná.");
  point.properties.name = "Upravený bod";
  point.properties.review_state = "corrected";
  group.properties.point_ids = [point.id];
  let sequence = 0;
  const commands = commandsForChanges(stakeout.objects, current, () => `command_stakeout_${sequence += 1}`);
  assert.deepEqual(commands.map((command) => command.type), [
    "stakeout.point.upsert", "stakeout.review.set", "stakeout.group.members.set",
  ]);
  assert.equal(commands[0].object.properties.review_state, "confirmed");
  assert.deepEqual(commands[2].point_ids, [point.id]);

  const newPoint = structuredClone(point);
  newPoint.id = "object_stakeout_new";
  newPoint.properties.code = "NEW1";
  newPoint.properties.review_state = "unreviewed";
  newPoint.provenance = {
    source_document_id: point.provenance.source_document_id,
    source_document_sha256: point.provenance.source_document_sha256,
    source_kind: "manual", algorithm_version: "stakeout-manual-v1",
  };
  const create = commandsForChanges(stakeout.objects, [...stakeout.objects, newPoint], () => "command_stakeout_new");
  assert.equal(create.at(-1)?.type, "stakeout.point.upsert");
});

test("nový civil bod se serializuje jako auditovatelný civil upsert", async () => {
  const civil = JSON.parse(await readFile(
    new URL("../../../fixtures/contracts/v1/valid-civil-tools-model.json", import.meta.url),
    "utf8",
  )) as ModelVersion;
  const axis = civil.objects.find((object) => object.type === "civil.axis")!;
  if (axis.type !== "civil.axis") throw new Error("Fixture nemá osu.");
  const point: CivilPointObject = {
    schema_version: "datamine.civil-point-object.v1", id: "object_civil_point_new",
    type: "civil.point", layer_id: "layer_points",
    geometry: { kind: "point3d", coordinate_space: "survey_crs", point: [5, 0, 100.5] },
    properties: {
      schema_version: "datamine.civil-point-properties.v1", name: "Nový bod",
      crs: axis.properties.crs, derivation: { kind: "manual_coordinates" }, review_state: "unreviewed",
    },
    provenance: {
      source_document_id: axis.provenance.source_document_id,
      source_document_sha256: axis.provenance.source_document_sha256,
      source_kind: "manual", algorithm_version: "civil-point-tools-v1",
    },
  };
  const commands = commandsForChanges(civil.objects, [...civil.objects, point], () => "command_civil_point_new");
  assert.equal(commands.at(-1)?.type, "civil.object.upsert");
});

test("nový civil TIN se serializuje jako auditovatelný civil upsert", async () => {
  const civil = JSON.parse(await readFile(
    new URL("../../../fixtures/contracts/v1/valid-civil-tools-model.json", import.meta.url),
    "utf8",
  )) as ModelVersion;
  const axis = civil.objects.find((object) => object.type === "civil.axis")!;
  if (axis.type !== "civil.axis") throw new Error("Fixture nemá osu.");
  const surface: TinSurfaceObject = {
    schema_version: "datamine.tin-surface-object.v1", id: "object_surface_manual",
    type: "civil.tin_surface", layer_id: "layer_surface",
    geometry: {
      kind: "indexed_tin", coordinate_space: "survey_crs",
      vertices: [[0, 0, 100], [1, 0, 100], [0, 1, 101]], faces: [[0, 1, 2]],
      bounds: { min: [0, 0, 100], max: [1, 1, 101] },
    },
    properties: {
      schema_version: "datamine.tin-surface-properties.v1", name: "Ruční povrch",
      crs: structuredClone(axis.properties.crs), review_state: "unreviewed",
    },
    provenance: {
      source_document_id: axis.provenance.source_document_id,
      source_document_sha256: axis.provenance.source_document_sha256,
      source_kind: "manual", algorithm_version: "civil-boundary-ear-clipping-v1",
    },
  };
  const commands = commandsForChanges(civil.objects, [...civil.objects, surface], () => "command_surface_upsert");
  assert.deepEqual(commands, [{ id: "command_surface_upsert", type: "civil.object.upsert", object: surface }]);
});

test("nová triangulovaná materiálová vrstva se serializuje jako civil upsert", async () => {
  const civil = JSON.parse(await readFile(
    new URL("../../../fixtures/contracts/v1/valid-civil-tools-model.json", import.meta.url),
    "utf8",
  )) as ModelVersion;
  const axis = civil.objects.find((object) => object.type === "civil.axis")!;
  if (axis.type !== "civil.axis") throw new Error("Fixture nemá osu.");
  const surface: TinSurfaceObject = {
    schema_version: "datamine.tin-surface-object.v1", id: "object_surface_for_layer",
    type: "civil.tin_surface", layer_id: "layer_surface",
    geometry: {
      kind: "indexed_tin", coordinate_space: "survey_crs",
      vertices: [[0, 0, 100], [2, 0, 100], [0, 2, 100]], faces: [[0, 1, 2]],
      bounds: { min: [0, 0, 100], max: [2, 2, 100] },
    },
    properties: {
      schema_version: "datamine.tin-surface-properties.v1", name: "Horní povrch",
      crs: structuredClone(axis.properties.crs), review_state: "unreviewed",
    },
    provenance: {
      source_document_id: axis.provenance.source_document_id,
      source_document_sha256: axis.provenance.source_document_sha256,
      source_kind: "manual", algorithm_version: "civil-boundary-ear-clipping-v1",
    },
  };
  const layer: CivilMaterialLayerObject = {
    schema_version: "datamine.civil-material-layer-object.v1", id: "object_material_layer",
    type: "civil.material_layer", layer_id: "layer_materials",
    geometry: {
      kind: "indexed_mesh", coordinate_space: "survey_crs",
      vertices: [[0, 0, 100], [2, 0, 100], [0, 2, 100], [0, 0, 99.5], [2, 0, 99.5], [0, 2, 99.5]],
      faces: [[0, 1, 2], [5, 4, 3], [0, 3, 1], [1, 3, 4], [1, 4, 2], [2, 4, 5], [2, 5, 0], [0, 5, 3]],
      bounds: { min: [0, 0, 99.5], max: [2, 2, 100] },
    },
    properties: {
      schema_version: "datamine.civil-material-layer-properties.v1", name: "Štěrkodrť",
      material_code: "STERKODRT_0_63", crs: structuredClone(axis.properties.crs),
      derivation: { kind: "constant_thickness", top_surface_id: surface.id, thickness_m: 0.5 },
      volume_m3: 1, review_state: "unreviewed",
    },
    provenance: {
      source_document_id: surface.provenance.source_document_id,
      source_document_sha256: surface.provenance.source_document_sha256,
      source_kind: "manual", algorithm_version: "civil-material-layer-v1",
    },
  };
  let commandIndex = 0;
  const commands = commandsForChanges(
    civil.objects,
    [...civil.objects, surface, layer],
    () => `command_civil_upsert_${++commandIndex}`,
  );
  assert.deepEqual(commands.map((command) => command.type), ["civil.object.upsert", "civil.object.upsert"]);
  assert.deepEqual(commands.at(-1), { id: "command_civil_upsert_2", type: "civil.object.upsert", object: layer });
});
