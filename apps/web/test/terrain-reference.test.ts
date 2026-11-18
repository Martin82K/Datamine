import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validSurveyTerrain, surveyTerrainFrom, surveyTerrainChanged } from "../src/terrain-reference.ts";
import { terrainMesh, isStoredMapContext, storedMapContext } from "../src/civil-map.ts";
import { demoCivilObjects } from "../src/demo-model.ts";

export const terrain = () => ({ kind: "survey_tin", bounds: [-742050, -1043050, -741950, -1042950],
  source_object_id: "object_survey_terrain", source_name: "Zaměřený terén",
  vertices: [[-742020, -1043020, 190], [-741980, -1043020, 192], [-742020, -1042980, 194]], faces: [[0, 1, 2]] });
const object = () => ({ id: "object_survey_terrain", type: "civil.tin_surface", geometry: { vertices: terrain().vertices, faces: terrain().faces },
  properties: { name: terrain().source_name, crs: structuredClone(demoCivilObjects[0].properties.crs) } });
const saved = () => ({ ...JSON.parse(readFileSync(new URL("../../../fixtures/civil-map-context.json", import.meta.url), "utf8")), terrain: terrain() });

test("zaměřený TIN zachová nepravidelnou triangulaci, výšky i přesné mapové UV", () => {
  const source = object(), before = structuredClone(source);
  const reference = surveyTerrainFrom(source, terrain().bounds);
  assert.deepEqual(source, before); assert.deepEqual(reference, terrain());
  const mesh = terrainMesh(reference, [-742020, -1043020, 190]);
  assert.deepEqual(mesh.vertices, [[0, 0, 0], [40, 0, 2], [0, 40, 4]]);
  assert.deepEqual(mesh.faces, [[0, 1, 2]]); assert.deepEqual(mesh.uv, [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7]]);
  source.geometry.vertices[0][2] = 199;
  assert.equal(reference.vertices[0][2], 190); assert.equal(surveyTerrainChanged(reference, [source]), true);
  assert.equal(surveyTerrainChanged(reference, []), true); assert.equal(surveyTerrainChanged(reference, [before]), false);
});

test("zaměřený terén se uloží jako samostatný snapshot a neplatná geometrie je odmítnuta", () => {
  assert.equal(isStoredMapContext(saved()), true);
  assert.deepEqual(storedMapContext({ ...saved(), image: {} }), saved());
  for (const patch of [{ faces: [[0, 1, 99]] }, { faces: [[0, 0, 1]] }, { faces: [[0, 1, 1.5]] }, { faces: [] },
    { vertices: Array(10_001).fill(terrain().vertices[0]) }, { source_object_id: "https://bad.invalid" }, { source_name: " " },
    { bounds: [0, 0, 10, 10] }, { vertices: [[-742020, -1043020, 190], [-741980, -1043020, 192], [-742020, -1043020, 194]] },
    { vertices: [[-742020, -1043020, NaN], ...terrain().vertices.slice(1)] }, { extra: true }]) {
    assert.equal(validSurveyTerrain({ ...terrain(), ...patch }), false);
    assert.equal(isStoredMapContext({ ...saved(), terrain: { ...terrain(), ...patch } }), false);
  }
  const wrong = object(); wrong.properties.crs.vertical_datum = "ellipsoid";
  assert.throws(() => surveyTerrainFrom(wrong, terrain().bounds), /Bpv/);
});
