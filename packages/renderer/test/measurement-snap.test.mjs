import assert from "node:assert/strict";
import test from "node:test";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { findMeasurementSnap, validateDescriptors } from "../dist/index.js";

const descriptor = (mesh) => ({ id: "terrain", ring: [], heightM: 0, floorLevelM: 0, volumeM3: 0, mesh });
const camera = () => {
  const value = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  value.position.set(0, 0, 10); value.lookAt(0, 0, 0); value.updateMatrixWorld(); return value;
};
const mesh = { vertices: [[-4, -4, 0], [4, -4, 2], [-4, 4, 0]], faces: [[0, 1, 2]] };

test("snap uses CSS pixel tolerance and prefers vertices over incident edges", () => {
  const descriptors = [descriptor(mesh)];
  const before = JSON.stringify(descriptors);
  const vertex = findMeasurementSnap(descriptors, camera(), [14, 91], 100, 100);
  assert.equal(vertex.kind, "vertex"); assert.equal(vertex.vertexIndex, 0);
  assert.equal(findMeasurementSnap(descriptors, camera(), [0, 100], 100, 100), null);
  const edge = findMeasurementSnap(descriptors, camera(), [50, 93], 100, 100);
  assert.equal(edge.kind, "edge"); assert.deepEqual(edge.edgeIndices, [0, 1]);
  assert.equal(edge.edgeParameter, 0.5); assert.deepEqual(edge.screen, [50, 90]);
  assert.equal(JSON.stringify(descriptors), before);
});

test("point, preview, outside clip and untrusted indices have safe behavior", () => {
  const point = { ...descriptor(undefined), point: [0, 0, 0] };
  assert.equal(findMeasurementSnap([point], camera(), [50, 50], 100, 100).kind, "point");
  assert.equal(findMeasurementSnap([{ ...point, presentation: "preview" }], camera(), [50, 50], 100, 100), null);
  assert.equal(findMeasurementSnap([{ ...point, point: [0, 0, 20] }], camera(), [50, 50], 100, 100), null);
  assert.equal(findMeasurementSnap([point], camera(), [50, 50], 0, 100), null);
  assert.equal(findMeasurementSnap([point], camera(), [NaN, 50], 100, 100), null);
  assert.throws(() => validateDescriptors([descriptor({ ...mesh, faces: [[0, 0.5, 2]] })]), /neplatný mesh face/);
  assert.equal(findMeasurementSnap([descriptor({ ...mesh, faces: [[0, 0.5, 2]] })], camera(), [50, 93], 100, 100), null);
});

test("perspective edge interpolation recovers original 3D segment fraction", () => {
  const value = new PerspectiveCamera(60, 1, 0.1, 100);
  value.position.set(0, 0, 10); value.lookAt(0, 0, 0); value.updateMatrixWorld();
  const perspectiveMesh = { vertices: [[-3, 0, 0], [3, 0, 5], [-3, 4, 0]], faces: [[0, 1, 2]] };
  const expectedPoint = new Vector3(-0.6, 0, 2).project(value);
  const pointer = [(expectedPoint.x + 1) * 500, (1 - expectedPoint.y) * 500];
  const result = findMeasurementSnap([descriptor(perspectiveMesh)], value, pointer, 1000, 1000);
  assert.equal(result.kind, "edge"); assert.deepEqual(result.edgeIndices, [0, 1]);
  assert.ok(Math.abs(result.edgeParameter - 0.4) < 1e-12);
});

test("coincident projected vertices select nearer surface and geometry budgets fail closed", () => {
  const low = descriptor(mesh);
  const high = { ...descriptor({ ...mesh, vertices: mesh.vertices.map(([x, y, z]) => [x, y, z + 3]) }), id: "high" };
  assert.equal(findMeasurementSnap([low, high], camera(), [10, 90], 100, 100).objectId, "high");
  const tooLarge = descriptor({ vertices: Array.from({ length: 100001 }, () => [0, 0, 0]), faces: [] });
  assert.equal(findMeasurementSnap([tooLarge], camera(), [50, 50], 100, 100), null);
});

test("occlusion predicate skips hidden candidate without masking visible edge alternatives", () => {
  const low = descriptor(mesh);
  const high = { ...descriptor({ ...mesh, vertices: mesh.vertices.map(([x, y, z]) => [x, y, z + 3]) }), id: "high" };
  const result = findMeasurementSnap([low, high], camera(), [10, 90], 100, 100, 12, (candidate) => candidate.objectId === "high");
  assert.equal(result.objectId, "high");
  assert.equal(findMeasurementSnap([low], camera(), [10, 90], 100, 100, 12, () => false), null);
});

test("subpixel plan tilt prefers the top skin over an almost coincident lower edge", () => {
  const value = camera();
  value.position.y = -0.00001; value.lookAt(0, 0, 0); value.updateMatrixWorld();
  const thickMesh = { vertices: [...mesh.vertices, ...mesh.vertices.map(([x, y, z]) => [x, y, z - 2])], faces: [[0, 1, 2], [3, 5, 4]] };
  const vertex = findMeasurementSnap([descriptor(thickMesh)], value, [10, 91], 100, 100);
  assert.equal(vertex.vertexIndex, 0);
  const edge = findMeasurementSnap([descriptor(thickMesh)], value, [50, 91], 100, 100);
  assert.equal(edge.kind, "edge"); assert.deepEqual(edge.edgeIndices, [0, 1]);
});

test("renderer caps aggregate mesh faces before allocating render buffers", () => {
  const dense = descriptor({ vertices: mesh.vertices, faces: Array(100_001).fill([0, 1, 2]) });
  assert.throws(() => validateDescriptors([dense, { ...dense, id: "second" }]), /limit 200 000/);
});
