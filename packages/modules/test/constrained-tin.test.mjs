import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isContract } from "@datamine/contracts";
import {
  createCivilTinSurfaceFromPoints, createManualCivilPoint, civilTinSurfaceAreas,
  createCivilMaterialLayerFromSurface,
} from "../dist/index.js";

const fixture = JSON.parse(await readFile(new URL("../../../fixtures/contracts/v1/valid-civil-tools-model.json", import.meta.url), "utf8"));
const crs = fixture.objects[0].properties.crs;
const input = {
  layerId: "layer_surfaces", sourceDocumentId: "document_situation", sourceDocumentSha256: "d".repeat(64),
  objectId: "object_constrained_tin", name: "Omezený TIN",
};
const makePoints = (coordinates) => coordinates.map(([x, y, z = 100], index) => createManualCivilPoint([x, y, z], crs, {
  ...input, objectId: `object_point_${index}`, name: `Bod ${index}`,
}));
const tin = (coordinates, constraints = {}) => createCivilTinSurfaceFromPoints(makePoints(coordinates), { ...input, ...constraints });
const key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
const edgeCounts = (mesh) => {
  const edges = new Map();
  for (const [a, b, c] of mesh.geometry.faces) for (const [u, v] of [[a, b], [b, c], [c, a]]) {
    edges.set(key(u, v), (edges.get(key(u, v)) ?? 0) + 1);
  }
  return edges;
};
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const signedVolume = (mesh) => {
  const origin = mesh.geometry.vertices[0];
  return mesh.geometry.faces.reduce((sum, face) => {
    const [a, b, c] = face.map((index) => mesh.geometry.vertices[index].map((value, axis) => value - origin[axis]));
    return sum + (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }, 0);
};

test("TIN vynutí opačnou úhlopříčku oproti původní Delaunay triangulaci", () => {
  const points = [[0, 0], [7, 0], [6, 4], [0, 5]];
  const original = tin(points);
  const originalEdges = edgeCounts(original);
  const diagonal = originalEdges.has("0:2") ? [1, 3] : [0, 2];
  const result = tin(points, { breaklines: [diagonal] });
  assert.equal(edgeCounts(result).get(key(...diagonal)), 2);
  assert.equal(civilTinSurfaceAreas(result).planM2, 29);
  assert.equal(result.provenance.algorithm_version, "civil-constrained-edge-recovery-v1");
  assert.equal(isContract("model_object", result), true);
});

test("konkávní obvod vyřízne zářez, zachová vnitřní body a ignoruje vnější", () => {
  const coordinates = [[0, 0], [8, 0], [8, 3], [3, 3], [3, 8], [0, 8], [1, 1], [6, 6], [-1, 2]];
  const result = tin(coordinates, { boundary: [0, 1, 2, 3, 4, 5] });
  assert.equal(civilTinSurfaceAreas(result).planM2, 39);
  assert.ok(result.geometry.faces.some((face) => face.includes(6)));
  assert.ok(result.geometry.faces.every((face) => !face.includes(7) && !face.includes(8)));
  const edges = edgeCounts(result);
  for (let i = 0; i < 6; i++) assert.equal(edges.get(key(i, (i + 1) % 6)), 1);
  const reversed = tin(coordinates, { boundary: [5, 4, 3, 2, 1, 0] });
  assert.equal(civilTinSurfaceAreas(reversed).planM2, 39);
});

test("otvor zůstává prázdný a navázaná materiálová vrstva má uzavřené vnitřní boky a správný objem", () => {
  const coordinates = [[0, 0], [10, 0], [10, 10], [0, 10], [3, 3], [7, 3], [7, 7], [3, 7], [5, 5], [1, 5]];
  const surface = tin(coordinates, { boundary: [0, 1, 2, 3], holes: [[4, 5, 6, 7]], breaklines: [[0, 4], [1, 5]] });
  assert.equal(civilTinSurfaceAreas(surface).planM2, 84);
  assert.ok(surface.geometry.vertices.every(([x, y]) => x !== 5 || y !== 5));
  assert.equal(surface.geometry.vertices.length, 9);
  assert.ok(surface.geometry.faces.some((face) => face.includes(8)));
  for (const [a, b] of [[4, 5], [5, 6], [6, 7], [7, 4]]) assert.equal(edgeCounts(surface).get(key(a, b)), 1);
  const layer = createCivilMaterialLayerFromSurface(surface, { ...input, objectId: "object_layer", thicknessM: 0.5, materialCode: "STERK" });
  assert.equal(layer.properties.volume_m3, 42);
  assert.ok(Math.abs(signedVolume(layer) - 42) < 1e-9);
  assert.ok([...edgeCounts(layer).values()].every((count) => count === 2));
  assert.equal(isContract("model_object", layer), true);
});

test("kolineární body rozdělují obvod i lomovou hranu a křížení ve společném bodě funguje", () => {
  const coordinates = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 0], [5, 5], [5, 10], [0, 5], [10, 5]];
  const surface = tin(coordinates, { boundary: [0, 1, 2, 3], breaklines: [[4, 6], [7, 8]] });
  const edges = edgeCounts(surface);
  for (const [a, b] of [[0, 4], [4, 1], [2, 6], [6, 3], [3, 7], [7, 0], [1, 8], [8, 2]]) assert.equal(edges.get(key(a, b)), 1);
  for (const [a, b] of [[4, 5], [5, 6], [7, 5], [5, 8]]) assert.equal(edges.get(key(a, b)), 2);
  assert.equal(civilTinSurfaceAreas(surface).planM2, 100);
});

test("TIN odmítá neplatné indexy, uzavření opakovaným bodem, křížení a degeneraci", () => {
  const coordinates = [[0, 0], [10, 0], [10, 10], [0, 10], [3, 0]];
  for (const constraints of [
    { boundary: [0, 1, 2.5] }, { boundary: [0, 1, 99] }, { boundary: [0, 1, -1] },
    { boundary: [0, 1, NaN] }, { boundary: [0, 1, 2, 0] }, { boundary: [0, 1] },
    { boundary: [0, 1, 4] }, { boundary: [0, 2, 1, 3] },
    { breaklines: [[0, 2], [1, 3]] }, { breaklines: [[0, 1, 4]] },
    { holes: [[0, 1, 2]] }, { boundary: null }, { holes: "bad" }, { breaklines: [[1]] },
  ]) assert.throws(() => tin(coordinates, constraints), undefined, JSON.stringify(constraints));
  const points = makePoints(coordinates);
  points[2].properties.crs = { ...points[2].properties.crs, epsg: "OTHER" };
  assert.throws(() => createCivilTinSurfaceFromPoints(points, { ...input, boundary: [0, 1, 2] }), /CRS/);
});

test("TIN odmítá dotýkající, vnější a vnořené otvory i lomové linie mimo oblast", () => {
  const coordinates = [[0, 0], [10, 0], [10, 10], [0, 10], [2, 2], [8, 2], [8, 8], [2, 8], [3, 3], [4, 3], [4, 4], [3, 4], [12, 2], [13, 2], [13, 3]];
  for (const constraints of [
    { holes: [[0, 4, 5]] }, { holes: [[12, 13, 14]] }, { holes: [[4, 5, 6, 7], [8, 9, 10, 11]] },
    { holes: [[4, 5, 6, 7]], breaklines: [[0, 2]] }, { breaklines: [[1, 12]] },
  ]) assert.throws(() => tin(coordinates, { boundary: [0, 1, 2, 3], ...constraints }));
});

test("max-edge u omezeného TIN nevytváří tiché díry a limity vstupů se vynucují", () => {
  const coordinates = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.throws(() => tin(coordinates, { boundary: [0, 1, 2, 3], maximumEdgeLengthM: 10 }), /porušil obvod/);
  assert.equal(civilTinSurfaceAreas(tin(coordinates, { boundary: [0, 1, 2, 3], maximumEdgeLengthM: 15 })).planM2, 100);
  assert.throws(() => tin(coordinates, { breaklines: Array.from({ length: 129 }, () => [0, 1]) }), /128/);
  assert.throws(() => tin(coordinates, { boundary: Array.from({ length: 513 }, (_, index) => index) }), /512/);
});

test("deterministické bodové mraky zachovají dlouhou lomovou hranu přes mnoho trojúhelníků", () => {
  let state = 74623;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let trial = 0; trial < 30; trial++) {
    const coordinates = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 43], [100, 57],
      ...Array.from({ length: 30 }, () => [1 + random() * 98, 1 + random() * 98, 90 + random() * 20])];
    const surface = tin(coordinates, { boundary: [0, 1, 2, 3], breaklines: [[4, 5]] });
    assert.equal(edgeCounts(surface).get("4:5"), 2);
    assert.ok(Math.abs(civilTinSurfaceAreas(surface).planM2 - 10_000) < 1e-8);
    assert.equal(new Set(surface.geometry.faces.flat()).size, coordinates.length);
    for (const face of surface.geometry.faces) {
      assert.ok(cross(...face.map((index) => coordinates[index])) > 0);
      for (let offset = 0; offset < 3; offset++) {
        const a = coordinates[face[offset]], b = coordinates[face[(offset + 1) % 3]], c = coordinates[4], d = coordinates[5];
        assert.ok(!(cross(a, b, c) * cross(a, b, d) < -1e-9 && cross(c, d, a) * cross(c, d, b) < -1e-9));
      }
    }
  }
});

test("velké geodetické souřadnice se stejnou lokální geometrií zachovají oblast a objem", () => {
  const coordinates = [[0, 0], [10, 0], [10, 10], [0, 10], [3, 3], [7, 3], [7, 7], [3, 7], [1, 6]]
    .map(([x, y]) => [-750000 + x, -1050000 + y, 200 + x / 10]);
  const surface = tin(coordinates, { boundary: [0, 1, 2, 3], holes: [[4, 5, 6, 7]], breaklines: [[0, 4]] });
  const layer = createCivilMaterialLayerFromSurface(surface, { ...input, objectId: "object_layer", thicknessM: 0.25, materialCode: "STERK" });
  assert.equal(civilTinSurfaceAreas(surface).planM2, 84);
  assert.ok(Math.abs(signedVolume(layer) - 21) < 1e-8);
});

test("dva oddělené otvory a členitá lomová linie zachovají přesnou oblast", () => {
  const coordinates = [[0, 0], [20, 0], [20, 10], [0, 10], [2, 2], [4, 2], [4, 4], [2, 4], [12, 2], [17, 2], [17, 6], [12, 6], [8, 0], [10, 5], [8, 10]];
  const result = tin(coordinates, {
    boundary: [0, 1, 2, 3], holes: [[4, 5, 6, 7], [11, 10, 9, 8]], breaklines: [[12, 13, 14], [4, 5]],
  });
  assert.equal(civilTinSurfaceAreas(result).planM2, 176);
  assert.equal(edgeCounts(result).get("12:13"), 2);
  assert.equal(edgeCounts(result).get("13:14"), 2);
  assert.equal(edgeCounts(result).get("4:5"), 1);
});

test("prázdná omezení zachovávají původní Delaunay a kolineární nebo nečíselná data selžou", () => {
  const coordinates = [[0, 0], [5, 1], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(tin(coordinates).geometry, tin(coordinates, { holes: [], breaklines: [] }).geometry);
  assert.throws(() => tin([[0, 0], [5, 0], [10, 0]], { breaklines: [[0, 2]] }), /degenerovaný/);
  const badPoints = makePoints(coordinates);
  badPoints[0].geometry.point[0] = Infinity;
  assert.throws(() => createCivilTinSurfaceFromPoints(badPoints, { ...input, boundary: [0, 2, 3, 4] }), /neplatné souřadnice/);
});

test("TIN bezpečně omezuje součet hran a odmítá křížení nestejně velkých otvorů", () => {
  const coordinates = Array.from({ length: 6 }, (_, index) => [Math.cos(index * Math.PI / 3), Math.sin(index * Math.PI / 3)]);
  assert.throws(() => tin(coordinates, { breaklines: Array.from({ length: 128 }, () => [0, 1, 2, 3, 4, 5]) }), /512/);
  const overlapping = [[0, 0], [10, 0], [10, 10], [0, 10], [2, 2], [6, 2], [6, 6], [2, 6], [4, 1], [8, 1], [8, 4], [4, 4]];
  assert.throws(() => tin(overlapping, { boundary: [0, 1, 2, 3], holes: [[4, 5, 6, 7], [8, 9, 10, 11]] }), /protínají/);
});


test("kompakce odstraní vnější a otvorové vrcholy před bounds/exportem a přemapuje původní indexy", () => {
  const coordinates = [[-100, -100, -999], [0, 0, 101.125], [5, 5, 999], [10, 0, 102.375],
    [10, 10, 103.625], [0, 10, 104.875], [3, 3, 102], [7, 3, 103], [7, 7, 104], [3, 7, 105], [200, 200, 2000]];
  const points = makePoints(coordinates);
  const original = structuredClone(points);
  const surface = createCivilTinSurfaceFromPoints(points, { ...input, boundary: [1, 3, 4, 5], holes: [[6, 7, 8, 9]] });
  const expectedVertices = coordinates.filter((_, index) => ![0, 2, 10].includes(index));
  assert.deepEqual(surface.geometry.vertices, expectedVertices);
  assert.deepEqual(surface.geometry.bounds, { min: [0, 0, 101.125], max: [10, 10, 105] });
  assert.deepEqual([...new Set(surface.geometry.faces.flat())].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(surface.geometry.faces.every((face) => cross(...face.map((index) => surface.geometry.vertices[index])) > 0));
  assert.equal(civilTinSurfaceAreas(surface).planM2, 84);
  assert.equal(isContract("model_object", surface), true);
  assert.deepEqual(points, original);
  const saved = JSON.parse(JSON.stringify(surface));
  assert.deepEqual(saved.geometry.vertices, expectedVertices);
  const layer = createCivilMaterialLayerFromSurface(saved, { ...input, objectId: "object_compact_layer", thicknessM: 0.5, materialCode: "STERK" });
  assert.equal(layer.geometry.vertices.length, 16);
  assert.deepEqual(layer.geometry.bounds, { min: [0, 0, 100.625], max: [10, 10, 105] });
  assert.ok(Math.abs(signedVolume(layer) - 42) < 1e-8);
});

test("totožné XYZ se spojí i když obvod, otvor a hrany odkazují na pozdější kopie", () => {
  const coordinates = [[0,0], [10,0], [10,10], [0,10], [4,4], [6,4], [6,6], [4,6]];
  const originals = makePoints(coordinates);
  const copies = originals.map((p, i) => ({ ...structuredClone(p), id: `object_duplicate_${i}` }));
  const before = structuredClone([...originals, ...copies]);
  const surface = createCivilTinSurfaceFromPoints([...originals, ...copies], {
    ...input, boundary: [8,9,10,11], holes: [[12,13,14,15]], breaklines: [[8,12]],
  });
  assert.equal(isContract("model_object", surface), true);
  assert.equal(surface.geometry.vertices.length, 8);
  assert.equal(civilTinSurfaceAreas(surface).planM2, 96);
  assert.deepEqual([...originals, ...copies], before);
  assert.equal(edgeCounts(surface).has(key(0,4)), true);
});

test("sloučení XYZ nepřijme vadné indexy, zhroucený obvod ani rozdílné výšky", () => {
  const coordinates = [[0,0], [10,0], [0,10], [0,0]];
  for (const value of [-1, 4, 1.5, NaN]) assert.throws(() => tin(coordinates, { boundary: [0,1,value] }), /index bodu/);
  assert.throws(() => tin(coordinates, { boundary: [0,3,1] }), /nesmí opakovat/);
  assert.throws(() => tin([[0,0], [0,0], [1,1]]), /tři různé polohy/);
  assert.throws(() => tin([[0,0,100], [10,0], [0,10], [0,0,100.000001]]), /rozdílnou výškou/);
  const invalid = makePoints(coordinates);
  invalid[3].geometry.point[0] = NaN;
  assert.throws(() => createCivilTinSurfaceFromPoints(invalid, input), /neplatné souřadnice/);
});
