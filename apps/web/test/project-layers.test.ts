import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { demoCivilObjects, demoStakeoutObjects } from "../src/demo-model.ts";
import { groupProjectLayers, prepareLayerRename } from "../src/project-layers.ts";
import { EditorStore } from "@datamine/editor-core";
import { createLocalProject, readLocalProjects, updateLocalProject, writeLocalProjects } from "../src/local-projects.ts";
import { readLayerNames, setLayerName } from "../src/layer-colors.ts";
import { readableExtractedGroupName, safeExtractedLayerId, stakeoutObjectsFromProposal } from "../src/processing-api.ts";

test("technické skupiny extrakce se přenesou do editoru s čitelným názvem", () => {
  assert.equal(readableExtractedGroupName("micropile_inner_row"), "Mikropiloty – vnitřní řada");
  assert.equal(readableExtractedGroupName("micropile_outer_row"), "Mikropiloty – vnější řada");
  assert.equal(readableExtractedGroupName("Most SO 201"), "Most SO 201");
  assert.equal(readableExtractedGroupName("<>\u0000"), "Importované body");
});

test("vytěžené skupiny dostanou stabilní oddělené layer ID a zachovají čitelný název", () => {
  const file = {
    id: "file_local_12345678", name: "body.pdf", size: 100, media_type: "application/pdf",
    role: "data", sha256: "a".repeat(64), created_at: "2026-09-01T00:00:00Z",
  } as const;
  const payload = {
    schema_version: "datamine.stakeout-import.v1", document_id: "document_import",
    source_document_sha256: file.sha256, source_job_id: "job_import_12345678",
    algorithm_version: "stakeout-pdf-import-v1",
    points: [
      { code: "A1", name: "A1", point: [1, 2, 3], kind: "8–9 horní hrana", page: 1, row: 1 },
      { code: "A2", name: "A2", point: [2, 3, 4], kind: "8–9 horní hrana", page: 1, row: 2 },
      { code: "B1", name: "B1", point: [3, 4, 5], kind: "Základová spára", page: 2, row: 1 },
    ],
  } as const;
  const objects = stakeoutObjectsFromProposal(payload, file);
  assert.equal(objects[0]!.layer_id, objects[1]!.layer_id);
  assert.notEqual(objects[0]!.layer_id, objects[2]!.layer_id);
  assert.equal(objects[0]!.properties.derivation.source_layer, "8–9 horní hrana");
  assert.match(safeExtractedLayerId("8–9 horní hrana"), /^layer_[A-Za-z0-9_-]+$/);
  assert.deepEqual(groupProjectLayers(objects).map((layer) => [layer.name, layer.objectIds.length]), [
    ["8–9 horní hrana", 2], ["Základová spára", 1],
  ]);
  assert.ok(groupProjectLayers(objects).every((layer) => layer.origin === "imported"));
});

test("starší model bez názvu vytěžené vrstvy má bezpečný fallback", () => {
  const layers = groupProjectLayers([...demoCivilObjects, ...demoStakeoutObjects]);
  assert.deepEqual(layers.map((layer) => layer.name), ["Civilní model", "Body", "Vytyčovací body"]);
});

test("TIN vrstva používá uživatelský název objektu místo technického layer ID", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/contracts/v1/valid-landxml-tin.json", import.meta.url), "utf8"));
  const surface = structuredClone(fixture.surface);
  surface.layer_id = "layer_surfaces";
  assert.equal(groupProjectLayers([surface])[0]?.name, "Syntetický terén");
  assert.equal(groupProjectLayers([surface])[0]?.origin, "created");
});

test("ručně vytvořené body jsou oddělené od importovaných podkladů", () => {
  const manual = structuredClone(demoStakeoutObjects[0]);
  manual.id = "object_stakeout_manual";
  manual.layer_id = "layer_Pracovni_body";
  manual.properties.derivation = { kind: "manual" };
  manual.provenance.source_kind = "manual";
  assert.equal(groupProjectLayers([manual])[0]?.origin, "created");
  assert.equal(groupProjectLayers([manual], { layer_Pracovni_body: "Pracovní body" })[0]?.name, "Pracovní body");
});

test("přejmenování hotové bodové vrstvy zachová geometrii, uloží název a podporuje Zpět", () => {
  const point = structuredClone(demoStakeoutObjects[0]);
  point.id = "object_rename_manual_001";
  point.layer_id = "layer_Nova_vrstva_bodu";
  point.properties.derivation = { kind: "manual" };
  point.provenance.source_kind = "manual";
  const project = createLocalProject("Přejmenování", "civil", [point]);
  const store = new EditorStore(project.objects);
  const renamed = prepareLayerRename(store.snapshot.objects, point.layer_id, " Nová osa bodů ");
  store.executeBatch(renamed.objects.map((object, index) => ({
    id: `rename_${index}`, type: "object.upsert", baseRevision: 0, object,
  })));
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  setLayerName(storage, project.id, renamed.layerId, renamed.name);
  writeLocalProjects(storage, [updateLocalProject(project, { objects: store.snapshot.objects })]);
  const reopened = readLocalProjects(storage)[0]!;
  assert.equal(groupProjectLayers(reopened.objects, readLayerNames(storage, project.id))[0]?.name, "Nová osa bodů");
  assert.equal(reopened.objects[0]?.id, point.id);
  assert.deepEqual(reopened.objects[0]?.geometry, point.geometry);
  assert.deepEqual(reopened.objects[0]?.provenance, point.provenance);
  assert.equal(project.objects[0]?.layer_id, "layer_Nova_vrstva_bodu");
  assert.deepEqual(store.undo().objects, project.objects);
  assert.equal(store.redo().objects[0]?.layer_id, renamed.layerId);
});

test("přejmenování TIN zachová identitu povrchu a uloží čitelný název do modelu", () => {
  const { surface } = JSON.parse(readFileSync(new URL("../../../fixtures/contracts/v1/valid-landxml-tin.json", import.meta.url), "utf8"));
  const renamed = prepareLayerRename([surface], surface.layer_id, "Hotová plocha");
  assert.equal(groupProjectLayers(renamed.objects)[0]?.name, "Hotová plocha");
  assert.equal(renamed.objects[0]?.id, surface.id);
  assert.deepEqual(renamed.objects[0]?.geometry, surface.geometry);
});

test("neplatný název a kolize se odmítnou před změnou vrstvy", () => {
  const points = structuredClone(demoCivilObjects.slice(2));
  const before = structuredClone(points);
  for (const name of ["", "  ", "Nová <vrstva>", "Nová\u0000vrstva", "x".repeat(121)]) {
    assert.throws(() => prepareLayerRename(points, "layer_points", name), /Název vrstvy/);
    assert.deepEqual(points, before);
  }
  const occupied = { ...points[0]!, id: "object_occupied", layer_id: "layer_Nova_osa" };
  assert.throws(() => prepareLayerRename([...points, occupied], "layer_points", "Nová osa"), /již existuje/);
  assert.throws(() => prepareLayerRename(points, "layer_missing", "Nová osa"), /neexistuje/);
});
