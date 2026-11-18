import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { contractSchemas, isContract } from "../dist/index.js";

const fixture = async (name) => JSON.parse(await readFile(
  new URL(`../../../fixtures/contracts/v1/${name}`, import.meta.url),
  "utf8",
));

test("validní foundation fixture projde všemi kontrakty", async () => {
  const value = await fixture("valid-foundation.json");

  for (const name of ["project", "document", "model_version", "job", "artifact"]) {
    assert.equal(isContract(name, value[name]), true, name);
  }
  assert.equal(isContract("model_object", value.model_version.objects[0]), true);
});

test("geometry stream manifest a chunk mají bounded cross-runtime kontrakt", async () => {
  const manifest = await fixture("valid-geometry-stream-manifest.json");
  const chunk = await fixture("valid-geometry-chunk.json");
  assert.equal(isContract("geometry_stream_manifest", manifest), true);
  assert.equal(isContract("geometry_chunk", chunk), true);

  const outOfRange = structuredClone(chunk);
  outOfRange.sequence = outOfRange.chunk_count;
  assert.equal(isContract("geometry_chunk", outOfRange), false);
  const empty = structuredClone(chunk);
  empty.vertices = [];
  empty.faces = [];
  assert.equal(isContract("geometry_chunk", empty), false);
  const oversized = structuredClone(chunk);
  oversized.vertices = Array.from({ length: 4_097 }, () => [0, 0, 0]);
  assert.equal(isContract("geometry_chunk", oversized), false);
});

test("absolutní storage key je odmítnut", async () => {
  const value = await fixture("invalid-absolute-storage-key.json");
  assert.equal(isContract("document", value), false);

  value.storage_key = "projects/project_demo/../secret.pdf";
  assert.equal(isContract("document", value), false);
});

test("neznámé pole a chybná verze jsou odmítnuty", async () => {
  const unknownField = await fixture("invalid-unknown-field.json");
  const wrongVersion = await fixture("invalid-schema-version.json");

  assert.equal(isContract("project", unknownField), false);
  assert.equal(isContract("project", wrongVersion), false);
});

test("audit event je bounded, redigovaný a nepřijímá klientská pole", () => {
  const event = {
    schema_version: "datamine.audit-event.v1",
    event_id: "event_abc",
    occurred_at: "2026-08-30T12:00:00.000Z",
    request_id: "request_abc",
    phase: "outcome",
    action: "document.upload",
    outcome: "succeeded",
    reason_code: "HTTP_201",
    actor_id: "actor_1",
    tenant_id: "tenant_company",
    project_id: "project_alpha",
    resource_kind: "document",
    resource_id: "document_abc",
    component: "api",
    redacted: true,
  };
  assert.equal(isContract("audit_event", event), true);
  assert.equal(isContract("audit_event", { ...event, token: "secret" }), false);
  assert.equal(isContract("audit_event", { ...event, redacted: false }), false);
  assert.equal(isContract("audit_event", { ...event, reason_code: "line\nbreak" }), false);
});

test("záporná velikost dokumentu je odmítnuta", async () => {
  const value = await fixture("invalid-negative-size.json");
  assert.equal(isContract("document", value), false);
});

test("job create rozlišuje modelovou verzi a dokument", () => {
  const dummy = {
    schema_version: "datamine.job-create.v1",
    project_id: "project_demo",
    input: { kind: "model_version", id: "version_demo", revision: 3 },
    job_type: "system.dummy",
    algorithm_version: "dummy-v1",
    parameters: { label: "test" },
  };
  const rooms = {
    schema_version: "datamine.job-create.v1",
    project_id: "project_demo",
    input: { kind: "document", id: "document_demo", sha256: "a".repeat(64) },
    job_type: "rooms.detect",
    algorithm_version: "rooms-v1-adapter",
    parameters: { default_height_m: 3, floor_level_m: 0 },
  };

  assert.equal(isContract("job_create", dummy), true);
  assert.equal(isContract("job_create", rooms), true);
  rooms.input.kind = "model_version";
  assert.equal(isContract("job_create", rooms), false);

  const landxml = {
    schema_version: "datamine.job-create.v1",
    project_id: "project_demo",
    input: { kind: "document", id: "document_landxml", sha256: "c".repeat(64) },
    job_type: "civil.import.landxml",
    algorithm_version: "landxml-tin-import-v1",
    parameters: { epsg: 5514, vertical_datum: "Bpv", surface_name: "Terrain" },
  };
  assert.equal(isContract("job_create", landxml), true);
  landxml.parameters.epsg = 0;
  assert.equal(isContract("job_create", landxml), false);

  const civilSweep = {
    schema_version: "datamine.job-create.v1",
    project_id: "project_demo",
    input: { kind: "model_version", id: "version_civil", revision: 4 },
    job_type: "civil.sweep.generate",
    algorithm_version: "civil-sweep-v1",
    parameters: {
      name: "Koridor",
      axis_id: "object_axis_main",
      profile_id: "object_profile_main",
      section: [
        { offset_m: -1, elevation_offset_m: 0 },
        { offset_m: 1, elevation_offset_m: 0 },
      ],
      sampling_spacing_m: 5,
      caps: false,
    },
  };
  assert.equal(isContract("job_create", civilSweep), true);
  civilSweep.parameters.section.reverse();
  assert.equal(isContract("job_create", civilSweep), false);

  const stakeoutPoint = {
    schema_version: "datamine.job-create.v1",
    project_id: "project_demo",
    input: { kind: "model_version", id: "version_civil", revision: 4 },
    job_type: "stakeout.derive.point",
    algorithm_version: "stakeout-axis-profile-v1",
    parameters: {
      name: "Bod B001", code: "B001", axis_id: "object_axis_main",
      profile_id: "object_profile_main", station_m: 1005, lateral_offset_m: 2,
      elevation_offset_m: 0.2, horizontal_accuracy_m: 0.02, vertical_accuracy_m: 0.03,
    },
  };
  assert.equal(isContract("job_create", stakeoutPoint), true);
  stakeoutPoint.parameters.code = "../B001";
  assert.equal(isContract("job_create", stakeoutPoint), false);
});

test("document kontrakt váže roli LandXML na XML media type a příponu", () => {
  const document = {
    schema_version: "datamine.document.v1",
    id: "document_landxml",
    project_id: "project_demo",
    display_name: "terrain.landxml",
    technical_name: "document_landxml.xml",
    role: "landxml",
    media_type: "application/xml",
    sha256: "c".repeat(64),
    size_bytes: 100,
    storage_key: `blobs/sha256/cc/${"c".repeat(64)}.xml`,
    upload_state: "ready",
    created_at: "2026-08-30T12:00:00Z",
  };
  assert.equal(isContract("document", document), true);
  document.media_type = "application/pdf";
  assert.equal(isContract("document", document), false);
});

test("command batch je typovaný a nepřijímá cestu ani cizí properties", async () => {
  const valid = await fixture("valid-model-version-command-batch.json");
  const invalid = await fixture("invalid-model-version-command-path.json");

  assert.equal(isContract("model_version_command_batch", valid), true);
  assert.equal(isContract("model_version_command_batch", invalid), false);
});

test("document view vyžaduje invertibilní explicitní transformaci", async () => {
  const valid = await fixture("valid-document-view.json");
  const singular = await fixture("invalid-document-view-singular.json");

  assert.equal(isContract("document_view", valid), true);
  assert.equal(isContract("document_view", singular), false);
  valid.page_rotation_deg = 45;
  assert.equal(isContract("document_view", valid), false);
});

test("NaN a nekonečno nejsou platná geometrie", async () => {
  const value = await fixture("valid-foundation.json");
  const room = structuredClone(value.model_version.objects[0]);
  room.geometry.rings[0][0][0] = Number.NaN;
  assert.equal(isContract("model_object", room), false);
  room.geometry.rings[0][0][0] = Number.POSITIVE_INFINITY;
  assert.equal(isContract("model_object", room), false);
});

test("produkční room fixtures mají shodné strukturální a sémantické hranice", async () => {
  for (const name of ["valid-room-minimal.json", "valid-room-realistic.json"]) {
    assert.equal(isContract("model_object", await fixture(name)), true, name);
  }

  for (const name of [
    "invalid-room-degenerate-ring.json",
    "invalid-room-review-state.json",
    "invalid-room-missing-units.json",
    "invalid-room-unknown-field.json",
    "invalid-room-limit.json",
  ]) {
    assert.equal(isContract("model_object", await fixture(name)), false, name);
  }
});

test("degenerovaný room objekt je odmítnut i uvnitř modelové verze", async () => {
  const foundation = await fixture("valid-foundation.json");
  foundation.model_version.objects[0] = await fixture("invalid-room-degenerate-ring.json");
  assert.equal(isContract("model_version", foundation.model_version), false);
});

test("room major verze a confidence mimo interval jsou odmítnuty", async () => {
  const room = await fixture("valid-room-realistic.json");
  room.schema_version = "datamine.room-object.v2";
  assert.equal(isContract("model_object", room), false);

  room.schema_version = "datamine.room-object.v1";
  room.provenance.confidence = 1.01;
  assert.equal(isContract("model_object", room), false);
});

test("commitnutá JSON schémata odpovídají TypeBox zdroji", async () => {
  for (const [name, schema] of Object.entries(contractSchemas)) {
    const generated = JSON.parse(await readFile(
      new URL(`../../../schemas/v1/${name}.schema.json`, import.meta.url),
      "utf8",
    ));
    const expected = JSON.parse(JSON.stringify({
      $schema: "http://json-schema.org/draft-07/schema#",
      ...schema,
    }));
    assert.deepEqual(generated, expected, name);
  }
});

test("rooms export vyžaduje stabilní pořadí a autoritativní souhrn", async () => {
  const value = await fixture("valid-rooms-export.json");
  assert.equal(isContract("rooms_export", value), true);
  const wrongSummary = structuredClone(value);
  wrongSummary.summary.volume_m3 = 1;
  assert.equal(isContract("rooms_export", wrongSummary), false);
  const duplicate = structuredClone(value);
  duplicate.rooms.push(structuredClone(duplicate.rooms[0]));
  duplicate.summary.rooms_total = 2;
  duplicate.summary.rooms_included = 2;
  duplicate.summary.floor_area_m2 *= 2;
  duplicate.summary.geometric_area_m2 *= 2;
  duplicate.summary.volume_m3 *= 2;
  assert.equal(isContract("rooms_export", duplicate), false);
});

test("building quantities vyžadují stabilní pořadí a autoritativní souhrn", async () => {
  const value = await fixture("valid-building-quantities.json");
  assert.equal(isContract("building_quantities", value), true);
  const wrongSummary = structuredClone(value);
  wrongSummary.summary.net_area_m2 += 1;
  assert.equal(isContract("building_quantities", wrongSummary), false);
  const invalidLength = structuredClone(value);
  invalidLength.rows[0].length_m = 20;
  assert.equal(isContract("building_quantities", invalidLength), false);
});

test("building export vyžaduje paritu objektů a výměr", async () => {
  const model = await fixture("valid-building-model.json");
  const quantities = await fixture("valid-building-quantities.json");
  const value = {
    schema_version: "datamine.building-export.v1",
    exporter_version: "building-export-v1",
    project_id: model.project_id,
    document_id: model.document_id,
    source_document_sha256: model.objects[0].provenance.source_document_sha256,
    model_version_id: model.id,
    model_revision: model.revision,
    model_content_sha256: quantities.model_content_sha256,
    coordinate_space: "drawing_m",
    tolerance: quantities.tolerance,
    units: quantities.units,
    objects: model.objects.toSorted((left, right) => left.id.localeCompare(right.id)),
    quantities: { rows: quantities.rows, summary: quantities.summary },
  };
  assert.equal(isContract("building_export", value), true);
  value.quantities.rows = value.quantities.rows.slice(1);
  assert.equal(isContract("building_export", value), false);
});

test("civil a stakeout exporty mají explicitní CRS, gate a stabilní paritu", async () => {
  const model = await fixture("valid-stakeout-model.json");
  for (const object of model.objects) object.properties.review_state = "confirmed";
  const common = {
    project_id: model.project_id,
    document_id: model.document_id,
    source_document_sha256: model.objects[0].provenance.source_document_sha256,
    model_version_id: model.id,
    model_revision: model.revision,
    model_content_sha256: "e".repeat(64),
    coordinate_space: "survey_crs",
    crs: model.objects[0].properties.crs,
    precision: { coordinate_decimals: 3, tolerance_m: 0.001 },
  };
  const civilObjects = model.objects
    .filter((object) => object.type.startsWith("civil."))
    .sort((left, right) => left.id.localeCompare(right.id));
  const civil = {
    schema_version: "datamine.civil-export.v1",
    exporter_version: "civil-export-v1",
    ...common,
    units: { horizontal: "m", vertical: "m" },
    objects: civilObjects,
    summary: {
      objects_total: civilObjects.length, tin_surfaces: 0,
      axes: 1, profiles: 1, sweeps: 0,
    },
  };
  assert.equal(isContract("civil_export", civil), true);
  civil.objects[0].properties.review_state = "corrected";
  assert.equal(isContract("civil_export", civil), false);
  civil.objects[0].properties.review_state = "confirmed";

  const points = model.objects
    .filter((object) => object.type === "stakeout.point")
    .sort((left, right) => left.properties.code.localeCompare(right.properties.code));
  const groups = model.objects.filter((object) => object.type === "stakeout.group");
  const stakeout = {
    schema_version: "datamine.stakeout-export.v1",
    exporter_version: "stakeout-export-v1",
    ...common,
    units: { horizontal: "m", vertical: "m", accuracy: "m" },
    accuracy_gate: { maximum_horizontal_m: 0.05, maximum_vertical_m: 0.05 },
    points,
    groups,
    summary: { points_total: points.length, groups_total: groups.length },
  };
  assert.equal(isContract("stakeout_export", stakeout), true);
  stakeout.points[0].properties.accuracy.horizontal_m = 0.051;
  assert.equal(isContract("stakeout_export", stakeout), false);

  for (const [module, format] of [
    ["civil", "json"], ["civil", "dxf"],
    ["stakeout", "json"], ["stakeout", "csv"],
  ]) {
    assert.equal(isContract("job_create", {
      schema_version: "datamine.job-create.v1",
      project_id: model.project_id,
      input: { kind: "model_version", id: model.id, revision: model.revision },
      job_type: `${module}.export.${format}`,
      algorithm_version: `${module}-export-v1`,
      parameters: {},
    }), true);
  }
});

test("building model váže otvor na existující stěnu a autoritativní výměry", async () => {
  const model = await fixture("valid-building-model.json");
  assert.equal(isContract("model_version", model), true);
  for (const object of model.objects) {
    assert.equal(isContract("model_object", object), true, object.type);
  }

  const orphan = structuredClone(model);
  orphan.objects[1].properties.host_wall_id = "object_missing";
  assert.equal(isContract("model_version", orphan), false);

  const offHost = structuredClone(model);
  offHost.objects[1].geometry.points[0][1] = 0.2;
  assert.equal(isContract("model_version", offHost), false);

  const wrongQuantity = structuredClone(model);
  wrongQuantity.objects[0].properties.volume_m3 = 1;
  assert.equal(isContract("model_version", wrongQuantity), false);
  assert.equal(isContract("model_object", wrongQuantity.objects[0]), false);
});

test("building sdílené minimální a negativní fixtures mají shodnou hranici", async () => {
  assert.equal(isContract("model_object", await fixture("valid-building-wall-minimal.json")), true);
  assert.equal(isContract("model_version", await fixture("invalid-building-orphan-opening.json")), false);
  assert.equal(isContract("model_object", await fixture("invalid-building-wall-quantity.json")), false);
});

test("building review command je namespaced a vyžaduje bezpečný reason code", async () => {
  const model = await fixture("valid-building-model.json");
  const batch = {
    schema_version: "datamine.model-version-command-batch.v1",
    project_id: model.project_id,
    base_version_id: model.id,
    base_revision: model.revision,
    base_content_sha256: "a".repeat(64),
    commands: [{
      id: "command_review_wall",
      type: "building.review.set",
      object_id: model.objects[0].id,
      review_state: "confirmed",
      reason_code: "HUMAN_CONFIRMED",
    }],
  };
  assert.equal(isContract("model_version_command_batch", batch), true);
  batch.commands[0].reason_code = "../../secret";
  assert.equal(isContract("model_version_command_batch", batch), false);
});

test("civil osa, profil a derived sweep mají explicitní CRS a vazby", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const tools = await fixture("valid-civil-tools.json");
  assert.equal(isContract("model_version", model), true);
  assert.equal(isContract("civil_tools", tools), true);
  for (const object of model.objects) assert.equal(isContract("model_object", object), true, object.type);

  const extrapolated = structuredClone(model);
  extrapolated.objects[1].properties.samples[1].station_m = 1011;
  assert.equal(isContract("model_version", extrapolated), false);

  const reviewedDerived = structuredClone(model.objects[2]);
  reviewedDerived.properties.review_state = "confirmed";
  assert.equal(isContract("model_object", reviewedDerived), true);

  tools.section.reverse();
  assert.equal(isContract("civil_tools", tools), false);
});

test("všechny civilní a vytyčovací body sdílejí autoritativní CRS modelu", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const axis = model.objects[0];
  const point = {
    schema_version: "datamine.civil-point-object.v1", id: "object_civil_point_manual",
    type: "civil.point", layer_id: "layer_points",
    geometry: { kind: "point3d", coordinate_space: "survey_crs", point: [5, 0, 100.5] },
    properties: {
      schema_version: "datamine.civil-point-properties.v1", name: "Ruční bod",
      crs: structuredClone(axis.properties.crs), derivation: { kind: "manual_coordinates" }, review_state: "unreviewed",
    },
    provenance: {
      source_document_id: "document_situation", source_document_sha256: "d".repeat(64),
      source_kind: "manual", algorithm_version: "civil-point-tools-v1",
    },
  };
  model.objects.push(point);
  assert.equal(isContract("model_version", model), true);
  point.properties.crs.epsg = 4326;
  assert.equal(isContract("model_version", model), false);
});

test("vytyčovací body a skupiny vážou CRS, zdroj, souřadnice a unikátní kódy", async () => {
  const model = await fixture("valid-stakeout-model.json");
  assert.equal(isContract("model_version", model), true);
  assert.equal(isContract("stakeout_point", model.objects[2]), true);
  assert.equal(isContract("stakeout_group", model.objects[4]), true);

  const outsideTolerance = structuredClone(model);
  outsideTolerance.objects[2].geometry.point[0] += 0.01;
  assert.equal(isContract("model_version", outsideTolerance), false);

  const duplicateCode = structuredClone(model);
  duplicateCode.objects[3].properties.code = "A001";
  assert.equal(isContract("model_version", duplicateCode), false);

  const duplicateMember = structuredClone(model);
  duplicateMember.objects[4].properties.point_ids[1] = "object_stakeout_a001";
  assert.equal(isContract("model_version", duplicateMember), false);

  const missingMember = structuredClone(model);
  missingMember.objects[4].properties.point_ids[1] = "object_missing";
  assert.equal(isContract("model_version", missingMember), false);

  const unsafeCode = structuredClone(model.objects[3]);
  unsafeCode.properties.code = "../M001";
  assert.equal(isContract("stakeout_point", unsafeCode), false);

  const wrongAccuracy = structuredClone(model.objects[2]);
  wrongAccuracy.properties.accuracy.method = "manual";
  assert.equal(isContract("stakeout_point", wrongAccuracy), false);
});

test("stakeout commandy jsou namespaced, typované a bezpečně omezené", async () => {
  const model = await fixture("valid-stakeout-model.json");
  const batch = {
    schema_version: "datamine.model-version-command-batch.v1",
    project_id: model.project_id,
    base_version_id: model.id,
    base_revision: model.revision,
    base_content_sha256: "a".repeat(64),
    commands: [
      { id: "command_stakeout_point", type: "stakeout.point.upsert", object: model.objects[3] },
      { id: "command_stakeout_group", type: "stakeout.group.upsert", object: model.objects[4] },
      {
        id: "command_stakeout_members", type: "stakeout.group.members.set",
        object_id: model.objects[4].id, point_ids: [model.objects[3].id],
      },
      {
        id: "command_stakeout_review", type: "stakeout.review.set",
        object_id: model.objects[3].id, review_state: "confirmed", reason_code: "SURVEY_VERIFIED",
      },
      { id: "command_stakeout_remove", type: "stakeout.object.remove", object_id: model.objects[3].id },
    ],
  };
  assert.equal(isContract("model_version_command_batch", batch), true);
  batch.commands[3].reason_code = "../review";
  assert.equal(isContract("model_version_command_batch", batch), false);
});

test("building host assignment je explicitní a nepřijímá nebezpečný reason code", async () => {
  const model = await fixture("valid-building-model.json");
  const batch = {
    schema_version: "datamine.model-version-command-batch.v1",
    project_id: model.project_id,
    base_version_id: model.id,
    base_revision: model.revision,
    base_content_sha256: "a".repeat(64),
    commands: [{
      id: "command_assign_host",
      type: "building.opening.assign-host",
      object_id: "object_opening_01",
      host_wall_id: "object_wall_02",
      reason_code: "HUMAN_ASSIGNED_HOST",
    }],
  };
  assert.equal(isContract("model_version_command_batch", batch), true);
  batch.commands[0].reason_code = "../host";
  assert.equal(isContract("model_version_command_batch", batch), false);
});

test("LandXML TIN vyžaduje explicitní CRS, orientaci faces, bounds a provenienci", async () => {
  const value = await fixture("valid-landxml-tin.json");
  assert.equal(isContract("landxml_tin", value), true);
  assert.equal(isContract("model_object", value.surface), true);
  const manual = structuredClone(value.surface);
  manual.id = "object_tin_manual";
  manual.properties.review_state = "unreviewed";
  manual.provenance = {
    source_document_id: value.source_document_id,
    source_document_sha256: value.source_document_sha256,
    source_kind: "manual", algorithm_version: "civil-boundary-ear-clipping-v1",
  };
  assert.equal(isContract("model_version_command_batch", {
    schema_version: "datamine.model-version-command-batch.v1",
    project_id: "project_civil_demo", base_version_id: "version_civil_demo",
    base_revision: 0, base_content_sha256: "a".repeat(64),
    commands: [{ id: "command_tin_manual", type: "civil.object.upsert", object: manual }],
  }), true);

  const reversed = structuredClone(value);
  reversed.surface.geometry.faces[0] = [0, 2, 1];
  assert.equal(isContract("landxml_tin", reversed), false);

  const invalidIndex = structuredClone(value);
  invalidIndex.surface.geometry.faces[0] = [0, 1, 9];
  assert.equal(isContract("landxml_tin", invalidIndex), false);

  const wrongBounds = structuredClone(value);
  wrongBounds.surface.geometry.bounds.max[2] = 999;
  assert.equal(isContract("landxml_tin", wrongBounds), false);

  const mismatchedSource = structuredClone(value);
  mismatchedSource.source_document_sha256 = "d".repeat(64);
  assert.equal(isContract("landxml_tin", mismatchedSource), false);

  const missingCrs = structuredClone(value);
  delete missingCrs.surface.properties.crs;
  assert.equal(isContract("landxml_tin", missingCrs), false);

  const foundation = await fixture("valid-foundation.json");
  foundation.model_version.document_id = value.source_document_id;
  foundation.model_version.objects = [value.surface];
  assert.equal(isContract("model_version", foundation.model_version), true);
});

test("CAD underlay váže PDF, CRS, dvě transformace a kontrolní body", async () => {
  const value = await fixture("valid-cad-underlay-view.json");
  assert.equal(isContract("cad_underlay_view", value), true);

  const singular = structuredClone(value);
  singular.survey_to_world_xy = [1, 2, 2, 4, 0, 0];
  assert.equal(isContract("cad_underlay_view", singular), false);

  const outsideTolerance = structuredClone(value);
  outsideTolerance.control_points[2].world_m[0] += 0.01;
  assert.equal(isContract("cad_underlay_view", outsideTolerance), false);

  const tampered = structuredClone(value);
  tampered.etag_sha256 = "f".repeat(64);
  assert.equal(isContract("cad_underlay_view", tampered), false);

  const foundation = await fixture("valid-foundation.json");
  foundation.model_version.cad_underlay_view = value;
  assert.equal(isContract("model_version", foundation.model_version), true);
});

test("civil export zahrne body a materiály, hlídá referenční TIN, review a accuracy", async () => {
  const model = await fixture("valid-civil-export-model.json");
  const objects = model.objects.filter((object) => object.type !== "stakeout.group")
    .sort((left, right) => left.id.localeCompare(right.id));
  const payload = {
    schema_version: "datamine.civil-export.v1", exporter_version: "civil-export-v1",
    project_id: model.project_id, document_id: model.document_id,
    source_document_sha256: objects[0].provenance.source_document_sha256,
    model_version_id: model.id, model_revision: model.revision,
    model_content_sha256: "f".repeat(64), coordinate_space: "survey_crs",
    crs: objects[0].properties.crs, units: { horizontal: "m", vertical: "m" },
    precision: { coordinate_decimals: 3, tolerance_m: 0.001 }, objects,
    summary: { objects_total: objects.length, points: 6, material_layers: 1, tin_surfaces: 1, axes: 1, profiles: 1, sweeps: 0 },
  };
  assert.equal(isContract("civil_export", payload), true);
  for (const mutate of [
    (value) => { value.summary.points = 5; },
    (value) => { delete value.summary.material_layers; },
    (value) => { value.objects.find((o) => o.type === "civil.material_layer").properties.review_state = "unreviewed"; },
    (value) => { value.objects.find((o) => o.type === "civil.material_layer").properties.derivation.top_surface_id = "object_missing"; },
    (value) => { value.objects.find((o) => o.type === "stakeout.point").properties.accuracy.vertical_m = 0.051; },
  ]) {
    const invalid = structuredClone(payload);
    mutate(invalid);
    assert.equal(isContract("civil_export", invalid), false);
  }
  assert.equal(isContract("job_create", {
    schema_version: "datamine.job-create.v1", project_id: model.project_id,
    input: { kind: "model_version", id: model.id, revision: model.revision },
    job_type: "civil.export.csv", algorithm_version: "civil-export-v1", parameters: {},
  }), true);
});
