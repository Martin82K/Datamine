import assert from "node:assert/strict";
import test from "node:test";
import { measureSurveyPoints, measurementSelection, pointMeasurementAnchor, refreshMeasurementAnchors, resolveMeasurementSnap } from "../src/civil-measurement.ts";
import { demoCivilObjects } from "../src/demo-model.ts";

const point = (xyz: [number, number, number]) => {
  const value = structuredClone(demoCivilObjects[2]);
  value.geometry.point = xyz;
  return value;
};

test("kotvy řezu sledují posun bodů, vrcholů a hran, odstranění a skrytí zdroje", () => {
  const p = point([0, 0, 250]);
  const surface = { ...p, id: "surface", type: "civil.tin_surface", geometry: {
    vertices: [[0, 0, 250], [10, 0, 252], [0, 10, 250]], faces: [[0, 1, 2]],
  } } as unknown as import("@datamine/contracts").TinSurfaceObject;
  const anchors = [pointMeasurementAnchor(p),
    resolveMeasurementSnap([surface], { objectId: surface.id, kind: "vertex", vertexIndex: 0, screen: [0, 0], distancePx: 0 })!,
    resolveMeasurementSnap([surface], { objectId: surface.id, kind: "edge", edgeIndices: [0, 1], edgeParameter: 0.5, screen: [0, 0], distancePx: 0 })!];
  assert.equal(refreshMeasurementAnchors(anchors, [p, surface], new Set()), anchors);
  p.geometry.point[0] += 5;
  surface.geometry.vertices.forEach((vertex) => { vertex[0] += 5; });
  const updated = refreshMeasurementAnchors(anchors, [p, surface], new Set());
  assert.deepEqual(updated.map((a) => a.geometry.point), [[5, 0, 250], [5, 0, 250], [10, 0, 251]]);
  assert.deepEqual(anchors.map((a) => a.geometry.point), [[0, 0, 250], [0, 0, 250], [5, 0, 251]]);
  assert.deepEqual(refreshMeasurementAnchors(updated, [], new Set()), []);
  assert.deepEqual(refreshMeasurementAnchors(updated, [p, surface], new Set([p.layer_id])), []);
  surface.geometry.faces = [];
  assert.equal(refreshMeasurementAnchors(updated, [p, surface], new Set()).length, 2);
  p.geometry.point[0] -= 5;
  assert.deepEqual(refreshMeasurementAnchors(updated, [p], new Set())[0]!.geometry.point, [0, 0, 250]);
});

test("měření 12 m a převýšení 0,24 m odpovídá 2% sklonu bez zaokrouhlení vstupů", () => {
  const a = point([-800000, -1000000, 250]);
  const b = point([-799988, -1000000, 250.24]);
  const before = JSON.stringify([a, b]);
  const result = measureSurveyPoints(a, b);
  assert.equal(result.horizontalM, 12);
  assert.ok(Math.abs(result.spatialM - Math.hypot(12, 0.24)) < 1e-10);
  assert.ok(Math.abs(result.slopePercent! - 2) < 1e-10);
  assert.ok(Math.abs(result.angleDegrees! - Math.atan(0.02) * 180 / Math.PI) < 1e-10);
  assert.equal(JSON.stringify([a, b]), before);
  const reverse = measureSurveyPoints(b, a);
  assert.equal(reverse.spatialM, result.spatialM);
  assert.equal(reverse.elevationM, -result.elevationM);
  assert.equal(reverse.slopePercent, -result.slopePercent!);
});

test("vodorovný, svislý a nulový úsek nevrací falešný sklon ani NaN", () => {
  const a = point([0, 0, 0]);
  assert.equal(measureSurveyPoints(a, point([3, 4, 0])).spatialM, 5);
  const vertical = measureSurveyPoints(a, point([0, 0, -3]));
  assert.equal(vertical.spatialM, 3);
  assert.equal(vertical.slopePercent, null);
  assert.equal(vertical.angleDegrees, -90);
  assert.equal(measureSurveyPoints(a, a).angleDegrees, null);
  assert.equal(measureSurveyPoints(a, a).spatialM, 0);
});

test("neshodné CRS, výškový systém, nekonečné souřadnice a přetečení se odmítnou", () => {
  const a = point([0, 0, 0]);
  const b = point([1, 1, 1]);
  b.properties.crs.epsg = 4326;
  assert.throws(() => measureSurveyPoints(a, b), /shodný/);
  b.properties.crs.epsg = a.properties.crs.epsg;
  b.properties.crs.vertical_datum = "jiný";
  assert.throws(() => measureSurveyPoints(a, b), /shodný/);
  assert.throws(() => measureSurveyPoints(a, point([NaN, 0, 0])), /konečná/);
  assert.throws(() => measureSurveyPoints(point([-1e308, 0, 0]), point([1e308, 0, 0])), /Rozsah/);
});

test("výběr měření drží počátek A a nahrazuje konec B bez změny vstupního pole", () => {
  const selection = ["A", "B"];
  assert.deepEqual(measurementSelection([], "A"), ["A"]);
  assert.deepEqual(measurementSelection(["A"], "B"), selection);
  assert.deepEqual(measurementSelection(selection, "C"), ["A", "C"]);
  assert.deepEqual(measurementSelection(selection, "A"), ["A"]);
  assert.deepEqual(selection, ["A", "B"]);
});

test("uchopené vrcholy a hrany používají původní survey XYZ bez změny modelu", async () => {
  const { resolveMeasurementSnap, appendMeasurementAnchor } = await import("../src/civil-measurement.ts");
  const p = point([-800000, -1000000, 250]);
  const surface = { ...p, id: "surface", type: "civil.tin_surface", geometry: {
    kind: "mesh3d", coordinate_space: "survey_crs", vertices: [[-800000, -1000000, 250], [-799988, -1000000, 250.24], [-800000, -999990, 250]], faces: [[0, 1, 2]],
  } } as unknown as import("@datamine/contracts").ModelObject;
  const objects = [surface, p];
  const before = JSON.stringify(objects);
  const a = resolveMeasurementSnap(objects, { objectId: "surface", kind: "vertex", vertexIndex: 0, screen: [0, 0], distancePx: 0 })!;
  const b = resolveMeasurementSnap(objects, { objectId: "surface", kind: "edge", edgeIndices: [0, 1], edgeParameter: 0.5, screen: [2, 0], distancePx: 0 })!;
  assert.deepEqual(a.geometry.point, [-800000, -1000000, 250]);
  assert.deepEqual(b.geometry.point, [-799994, -1000000, 250.12]);
  assert.equal(measureSurveyPoints(a, b).horizontalM, 6);
  assert.ok(Math.abs(measureSurveyPoints(a, b).slopePercent! - 2) < 1e-9);
  assert.deepEqual(appendMeasurementAnchor([a], b), [a, b]);
  assert.deepEqual(appendMeasurementAnchor([a, b], a), [a]);
  assert.equal(JSON.stringify(objects), before);
  assert.equal(resolveMeasurementSnap(objects, { objectId: "missing", kind: "vertex", vertexIndex: 0, screen: [0, 0], distancePx: 0 }), null);
  for (const vertexIndex of [-1, 0.5, 10]) assert.equal(resolveMeasurementSnap(objects, { objectId: "surface", kind: "vertex", vertexIndex, screen: [0, 0], distancePx: 0 }), null);
  assert.equal(resolveMeasurementSnap(objects, { objectId: "surface", kind: "edge", edgeIndices: [0, 1], edgeParameter: NaN, screen: [0, 0], distancePx: 0 }), null);
});
