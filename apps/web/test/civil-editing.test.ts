import assert from "node:assert/strict";
import test from "node:test";
import { isModelObject } from "@datamine/contracts";

import { demoCivilObjects, demoStakeoutObjects } from "../src/demo-model.ts";
import { copyVector, createAxisFromSelectedPoints, safeManualLayerId, transformedPointCopies, translatedPointCopies } from "../src/civil-editing.ts";

const start = demoCivilObjects[2];
const end = demoCivilObjects[3];

test("ruční vrstva používá přenositelné technické ID", () => {
  assert.equal(safeManualLayerId("Opěrná stěna Bečov"), "layer_Operna_stena_Becov");
  assert.throws(() => safeManualLayerId("<>"), /Název vrstvy/);
});

test("kopie bodů se otáčí kolem prvního bodu v globální rovině XY", () => {
  const copies = transformedPointCopies([start, end], [1, 0, 0], 90, "layer_Kopie", (_, index) => `object_copy_${index}`);
  assert.deepEqual(copies[0].geometry.point, [start.geometry.point[0] + 1, start.geometry.point[1], start.geometry.point[2]]);
  assert.ok(Math.abs(copies[1].geometry.point[0] - (start.geometry.point[0] + 1)) < 1e-9);
  assert.ok(Math.abs(copies[1].geometry.point[1] - (start.geometry.point[1] + 6)) < 1e-9);
});

test("dva body vytvoří orientovanou osu s vodorovnou délkou", () => {
  const axis = createAxisFromSelectedPoints([start, end], { objectId: "object_axis_new", name: "Nová osa" });
  assert.equal(axis.properties.length_m, 6);
  assert.deepEqual(axis.geometry.points, [start.geometry.point, end.geometry.point]);
});

test("uložená osa zachová celou vybranou zakřivenou řadu", () => {
  const middle = structuredClone(start);
  middle.id = "object_civil_point_middle";
  middle.geometry.point = [start.geometry.point[0] + 3, start.geometry.point[1] + 2, start.geometry.point[2]];
  const axis = createAxisFromSelectedPoints([start, middle, end], { objectId: "object_axis_curve", name: "Zakřivená osa" });
  assert.equal(axis.geometry.points.length, 3);
  assert.ok(axis.properties.length_m > 6);
});

test("kopie bodů používá podepsaný směr a mění import na ruční objekt", () => {
  assert.deepEqual(copyVector("x", -3), [-3, 0, 0]);
  assert.deepEqual(copyVector("negative-y", 3), [0, -3, 0]);
  const vector = copyVector("selection", 12, [start, end]);
  assert.ok(Math.abs(Math.hypot(...vector) - 12) < 1e-9);
  const [copy] = translatedPointCopies([demoStakeoutObjects[0]], [1, 2, 3], "layer_Kopie", () => "object_stakeout_copy");
  assert.deepEqual(copy.geometry.point, demoStakeoutObjects[0].geometry.point.map((value, index) => value + [1, 2, 3][index]));
  assert.equal(copy.properties.derivation.kind, "manual");
  assert.equal(copy.provenance.source_kind, "manual");
});

test("kopie importovaného vytyčovacího bodu splní verzovaný kontrakt", () => {
  const imported = structuredClone(demoStakeoutObjects[0]);
  imported.properties.derivation = { kind: "document_import", page: 1, row: 1, source_code: "P001", source_layer: "Vozovka" };
  imported.properties.accuracy.method = "derived";
  imported.provenance.source_kind = "automatic";
  imported.provenance.source_job_id = "job_import_12345678";
  const [copy] = translatedPointCopies([imported], [1, 0, 0], "layer_Kopie", () => "object_stakeout_copy_imported");
  assert.equal(copy.properties.accuracy.method, "manual");
  assert.equal(isModelObject(copy), true);
});

test("kopie +X uloží skutečný posun a TIN i objem fungují přes totožné konce úseků", async () => {
  const { createCivilTinSurfaceFromPoints, createCivilMaterialLayerFromSurface, civilTinSurfaceAreas } = await import("@datamine/modules");
  // Repeated endpoint at the junction of two imported segments (synthetic CRS).
  const points = [[0, 0, 100], [0, 10, 101], [0, 10, 101], [0, 20, 102]].map((xyz, index) => ({
    ...structuredClone(demoStakeoutObjects[0]), id: `object_source_${index}`,
    geometry: { ...structuredClone(demoStakeoutObjects[0].geometry), point: xyz as [number, number, number] },
  }));
  const before = structuredClone(points);
  const copies = transformedPointCopies(points, copyVector("x", 5), 0, "layer_Copy", (_, i) => `object_copy_${i}`);
  copies.forEach((point, i) => assert.deepEqual(point.geometry.point, [5, points[i].geometry.point[1], points[i].geometry.point[2]]));
  assert.deepEqual(points, before);
  const input = { objectId: "object_surface_copies", layerId: "layer_tin", name: "Pás",
    sourceDocumentId: start.provenance.source_document_id, sourceDocumentSha256: start.provenance.source_document_sha256 };
  const surface = createCivilTinSurfaceFromPoints([...points, ...copies], input);
  assert.equal(isModelObject(surface), true);
  assert.equal(surface.geometry.vertices.length, 6);
  assert.equal(civilTinSurfaceAreas(surface).planM2, 100);
  const material = createCivilMaterialLayerFromSurface(surface, { ...input, objectId: "object_material_copies", materialCode: "TEST", thicknessM: 0.5 });
  assert.equal(material.properties.volume_m3, 50);
  assert.equal(isModelObject(material), true);
  const raised = transformedPointCopies(points, copyVector("z", 2), 0, "layer_Raised", (_, i) => `object_raised_${i}`);
  assert.throws(() => createCivilTinSurfaceFromPoints([...points, ...raised], input), /rozdílnou výškou/);
});

for (const [direction, delta] of [["x", [3, 0, 0]], ["negative-x", [-3, 0, 0]], ["y", [0, 3, 0]], ["negative-y", [0, -3, 0]], ["z", [0, 0, 3]], ["negative-z", [0, 0, -3]]] as const) {
  test(`kopie ${direction} posune právě zadanou osu i po serializaci`, () => {
    const copies = transformedPointCopies([start, end], copyVector(direction, 3), 0, "layer_Copy", (_, i) => `object_copy_${i}`);
    const restored = JSON.parse(JSON.stringify(copies));
    [start, end].forEach((source, i) => assert.deepEqual(restored[i].geometry.point, source.geometry.point.map((v, axis) => v + delta[axis])));
  });
}
