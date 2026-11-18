import assert from "node:assert/strict";
import test from "node:test";
import { createCivilMaterialLayerFromSurface, createCivilTinSurfaceFromPoints } from "@datamine/modules";
import { civilWorkbenchSummary } from "../src/civil-workbench.ts";
import { demoCivilObjects, demoStakeoutObjects } from "../src/demo-model.ts";
import { createCivilModelDxf, createSurveyPointsCsv } from "../src/survey-exports.ts";

test("souhrn pracovního exportu odpovídá skutečným entitám včetně profilu", () => {
  const objects = [...demoCivilObjects, ...demoStakeoutObjects];
  const summary = civilWorkbenchSummary(objects);
  const dxf = createCivilModelDxf(objects);
  for (const [entity, expected] of [["POINT", summary.points], ["LINE", summary.lines], ["3DFACE", summary.faces]] as const) {
    assert.equal(dxf.split(`0\n${entity}\n`).length - 1, expected);
  }
  assert.ok(!summary.omitted.includes("Profil: 1"));
  assert.ok(summary.hasDxfGeometry);
  assert.equal(civilWorkbenchSummary(objects.filter((object) => object.type === "civil.profile")).hasDxfGeometry, true);
  assert.equal(civilWorkbenchSummary([]).hasDxfGeometry, false);
});

test("souhrn nerozhodne za uživatele při více souřadnicových systémech", () => {
  const first = structuredClone(demoStakeoutObjects[0]!);
  const second = structuredClone(first);
  second.id = "object_workbench_other_crs";
  second.properties.crs.epsg = 4326;
  assert.equal(civilWorkbenchSummary([first, second]).coordinates, "Více souřadnicových systémů");
});

test("body → TIN → svislá vrstva → serializace → pracovní DXF a CSV zachovají referenční výsledek", () => {
  const points = [[1000, 2000, 250], [1010, 2000, 250], [1010, 2004, 250], [1000, 2004, 250]].map((xyz, index) => {
    const point = structuredClone(demoStakeoutObjects[0]!);
    point.id = `object_workbench_point_${index}`;
    point.properties.name = `B${index + 1}`;
    point.geometry.point = xyz as [number, number, number];
    return point;
  });
  const source = points[0]!.provenance;
  const input = {
    objectId: "object_workbench_tin", layerId: "layer_workbench_tin", name: "Referenční TIN",
    sourceDocumentId: source.source_document_id, sourceDocumentSha256: source.source_document_sha256,
  };
  const tin = createCivilTinSurfaceFromPoints(points, input);
  const layer = createCivilMaterialLayerFromSurface(tin, {
    ...input, objectId: "object_workbench_material", layerId: "layer_workbench_material",
    name: "Konstrukční vrstva", materialCode: "STERK", thicknessM: 0.3,
  });
  assert.ok(Math.abs(layer.properties.volume_m3 - 12) < 1e-6);
  assert.equal(layer.geometry.bounds.min[2], 249.7);
  const reopened = JSON.parse(JSON.stringify([...points, tin, layer]));
  const summary = civilWorkbenchSummary(reopened);
  assert.equal(summary.surfaces, 1);
  assert.equal(summary.materials, 1);
  const dxf = createCivilModelDxf(reopened);
  assert.equal(dxf.split("0\n3DFACE\n").length - 1, tin.geometry.faces.length + layer.geometry.faces.length);
  assert.ok(dxf.includes("9\n$INSUNITS\n70\n6\n"));
  const csv = createSurveyPointsCsv(reopened, [points[2]!.id]);
  assert.ok(csv.includes('"B3","1010.000","2004.000","250.000"'));
  assert.equal(csv.trim().split("\r\n").length, 2);
});
