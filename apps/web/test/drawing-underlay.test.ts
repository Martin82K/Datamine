import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { drawingTransform, drawingUnderlayMesh, isStoredDrawingUnderlay, drawingAnchorsChanged } from "../src/drawing-underlay.ts";
const raster = JSON.parse(readFileSync(new URL("../../../fixtures/civil-map-context.json", import.meta.url), "utf8"));
const sample = () => ({ version: 1, source_name: "Situace.pdf", page_number: 2, pixel_width: 1024, pixel_height: 1024,
  image_data_url: raster.image_data_url, control_points: [
    { pixel: [100, 900], world: [-742000, -1043000] }, { pixel: [900, 900], world: [-741920, -1043000] },
    { pixel: [100, 100], world: [-742000, -1042920] }], elevation: 195, opacity: 0.6, visible: true });

test("dva páry určí měřítko a polohu; sever není převrácen a třetí bod jen kontroluje", () => {
  const drawing = sample(), before = structuredClone(drawing);
  const transform = drawingTransform(drawing.control_points);
  assert.equal(transform.scale, 0.1); assert.equal(transform.rotation, 0); assert.equal(transform.residual, 0);
  assert.deepEqual(transform.apply([500, 500]), [-741960, -1042960]);
  drawing.control_points[2]!.world[0] += 2;
  assert.equal(drawingTransform(drawing.control_points).residual, 2);
  assert.deepEqual(drawingTransform(drawing.control_points).apply([500, 500]), [-741960, -1042960]);
  assert.deepEqual(before.control_points.slice(0, 2), drawing.control_points.slice(0, 2));
});

test("otočení o 90 stupňů zachová oba vazební body a správné UV", () => {
  const drawing = sample(); drawing.control_points = [{ pixel: [100, 900], world: [-742000, -1043000] }, { pixel: [900, 900], world: [-742000, -1042920] }];
  const t = drawingTransform(drawing.control_points);
  assert.equal(t.rotation, 90);
  for (const point of drawing.control_points) assert.deepEqual(t.apply(point.pixel), point.world);
  const mesh = drawingUnderlayMesh(drawing, [-742000, -1043000, 190]);
  assert.deepEqual(mesh.uv, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  assert.deepEqual(mesh.vertices[0], [-90, -10, 5]);
  const [a,b,c] = mesh.faces[0].map(i=>mesh.vertices[i]!);
  assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]) > 0);
});

test("připnutí odmítne shodné body, extrémní měřítko, nesmyslná data a cizí URL", () => {
  assert.equal(isStoredDrawingUnderlay(sample()), true);
  for (const overrides of [{ pixel_width: 100000 }, { elevation: null }, { visible: 1 }, { image_data_url: "https://attacker.invalid" },
    { source_name: "../a.pdf" }, { page_number: 0 }, { control_points: [] }, { extra: true }]) assert.equal(isStoredDrawingUnderlay({ ...sample(), ...overrides }), false);
  const bad = sample(); bad.control_points[1] = structuredClone(bad.control_points[0]!);
  assert.throws(()=>drawingTransform(bad.control_points), /blízko/);
  assert.equal(isStoredDrawingUnderlay(bad), false);
  const outside = sample(); outside.control_points[0]!.world=[742000,1043000];
  assert.equal(isStoredDrawingUnderlay(outside),false);
});

test("uložené přiřazení upozorní na posun nebo odstranění bodu modelu", () => {
  const d = sample(); d.control_points[0]!.model_point_id = "object_anchor_a";
  const object = { id: "object_anchor_a", type: "civil.point", geometry: { point: [-742000, -1043000, 195] } };
  assert.equal(drawingAnchorsChanged(d, [object]), false);
  object.geometry.point[0] += 0.1;
  assert.equal(drawingAnchorsChanged(d, [object]), true);
  assert.equal(drawingAnchorsChanged(d, []), true);
});
