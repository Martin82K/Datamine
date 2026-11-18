import assert from "node:assert/strict";
import test from "node:test";
import { terrainHeightAt, triangleElevation } from "../src/terrain-height.ts";

const terrain = () => ({ kind: "survey_tin", bounds: [-742050, -1043050, -741950, -1042950],
  source_object_id: "object_survey_terrain", source_name: "Zaměřený terén",
  vertices: [[-742020, -1043020, 190], [-741980, -1043020, 192], [-742020, -1042980, 194]], faces: [[0, 1, 2]] });

test("výšková kontrola přesně interpoluje svah v zeměměřických souřadnicích", () => {
  const tin = terrain(); const before = structuredClone(tin);
  assert.deepEqual(terrainHeightAt(tin, -742010, -1043010), { status: "ok", elevation: 191.5 });
  assert.deepEqual(terrainHeightAt(tin, -742020, -1043020), { status: "ok", elevation: 190 });
  assert.deepEqual(terrainHeightAt(tin, -742000, -1043000), { status: "ok", elevation: 193 });
  assert.deepEqual(terrainHeightAt(tin, -741980, -1042980), { status: "missing" });
  assert.deepEqual(terrainHeightAt(tin, -741000, -1042980), { status: "outside" });
  assert.deepEqual(tin, before);
});

test("překryté výšky odmítá; společné hrany ani opačné pořadí vrcholů nejsou chyba", () => {
  const tin = terrain(); tin.faces.push([2, 1, 0]);
  assert.deepEqual(terrainHeightAt(tin, -742010, -1043010), { status: "ok", elevation: 191.5 });
  tin.vertices.push(...tin.vertices.map(([x, y, z]) => [x, y, z + 1])); tin.faces.push([3, 4, 5]);
  assert.deepEqual(terrainHeightAt(tin, -742010, -1043010), { status: "ambiguous" });
  assert.equal(triangleElevation([0, 0, 1], [1, 0, 2], [2, 0, 3], 0.5, 0), null);
});

test("rastr používá stejnou diagonálu jako renderer a nepřeklene NoData", () => {
  const grid = { bounds: [0, 0, 10, 10], size: 2, elevations: [0, 0, 0, 10] };
  assert.deepEqual(terrainHeightAt(grid, 5, 5), { status: "ok", elevation: 0 });
  assert.deepEqual(terrainHeightAt(grid, 7.5, 7.5), { status: "ok", elevation: 5 });
  assert.deepEqual(terrainHeightAt(grid, 10, 10), { status: "ok", elevation: 10 });
  grid.elevations[0] = null;
  assert.deepEqual(terrainHeightAt(grid, 2, 2), { status: "missing" });
  assert.deepEqual(terrainHeightAt(grid, 5, 5), { status: "ok", elevation: 0 });
  const adjacent = { bounds: [0, 0, 2, 2], size: 3, elevations: [1, 1, null, 1, 1, null, 1, 1, null] };
  assert.deepEqual(terrainHeightAt(adjacent, 1, 0.5), { status: "ok", elevation: 1 });
});
