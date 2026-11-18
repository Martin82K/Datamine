import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { demoCivilObjects } from "../src/demo-model.ts";
import { gridPoint, mapBoundsFor, orthoUrl, parseTerrainRow, terrainMesh, mapImageUrl, isStoredMapContext, storedMapContext, restoreMapContext } from "../src/civil-map.ts";

const point = (xyz = [-742000, -1043000, 194]) => {
  const p = structuredClone(demoCivilObjects.find((o) => o.type === "civil.point")!);
  p.geometry.point = xyz; return p;
};
test("mapa zachová původní záporné easting/northing souřadnice a čtvercový rozsah", () => {
  const p = point(); const before = structuredClone(p);
  const bounds = mapBoundsFor([p, point([-741980, -1043010, 196])], 50);
  assert.deepEqual(bounds, [-742050, -1043065, -741930, -1042945]);
  assert.deepEqual(p, before);
  const params = new URL(orthoUrl(bounds)).searchParams;
  assert.equal(params.get("bbox"), bounds.join(",")); assert.equal(params.get("bboxSR"), "5514"); assert.equal(params.get("imageSR"), "5514");
  assert.deepEqual(gridPoint(bounds, 3, 0), [bounds[0], bounds[1]]);
  assert.deepEqual(gridPoint(bounds, 3, 8), [bounds[2], bounds[3]]);
});
test("mapa odmítne lokální, prohozené, kladné, smíšené CRS a neznámé výšky", () => {
  for (const xyz of [[1000, 2000, 250], [742000, 1043000, 194], [-1043000, -742000, 194], [NaN, 0, 0]]) assert.throws(() => mapBoundsFor([point(xyz)], 50));
  for (const override of [{ epsg: 4326 }, { vertical_datum: "ellipsoid" }, { axis_order: "north_east_up" }, { horizontal_unit: "mm" }]) {
    const wrong = point(); Object.assign(wrong.properties.crs, override);
    assert.throws(() => mapBoundsFor([point(), wrong], 50));
  }
  assert.throws(() => mapBoundsFor([], 50));
  assert.throws(() => mapBoundsFor([point(), point([-740000, -1043000, 194])], 50));
  assert.throws(() => mapBoundsFor([point()], NaN));
});
test("terén a UV nemají převrácený sever, při odečtení počátku zůstanou Bpv výšky", () => {
  const mesh = terrainMesh({ bounds: [-742000, -1043000, -741990, -1042990], size: 2, elevations: [190, 191, 192, 193] }, [-742000, -1043000, 194]);
  assert.deepEqual(mesh.vertices, [[0, 0, -4], [10, 0, -3], [0, 10, -2], [10, 10, -1]]);
  assert.deepEqual(mesh.uv, [[0, 0], [1, 0], [0, 1], [1, 1]]);
  assert.deepEqual(mesh.faces, [[0, 1, 2], [1, 3, 2]]);
  // Both triangle normals point up; no false surface spans a missing corner.
  const missing = terrainMesh({ bounds: [0, 0, 10, 10], size: 2, elevations: [null, 191, 192, 193] }, [0, 0, 0]);
  assert.deepEqual(missing.faces, [[0, 2, 1]]);
  assert.equal(terrainMesh({ bounds: [0, 0, 10, 10], size: 2, elevations: [null, null, null, null] }, [0, 0, 0]).faces.length, 0);
});
test("výšková odpověď se páruje podle souřadnic, kontroluje Bpv a nechá NoData prázdné", () => {
  const sample = (x, value) => ({ value, location: { x, y: -1043000, spatialReference: { latestWkid: 5514, latestVcsWkid: 8357 } } });
  const points = [[-742000, -1043000], [-741990, -1043000]];
  assert.deepEqual(parseTerrainRow({ results: [sample(-741990, "NoData"), sample(-742000, "194.035")] }, points), [194.035, null]);
  for (const value of ["", "NaN", "1,2,3", {}, 5000]) assert.throws(() => parseTerrainRow({ results: [sample(-742000, value)] }, [points[0]]));
  assert.throws(() => parseTerrainRow({ results: [sample(-742000, "194"), sample(-742000, "194")] }, points));
  const wrong = sample(-742000, "194"); wrong.location.spatialReference.latestVcsWkid = 5773;
  assert.throws(() => parseTerrainRow({ results: [wrong] }, [points[0]]));
  assert.throws(() => parseTerrainRow({ error: { message: "Unavailable" } }, points));
});

const savedMap = () => JSON.parse(readFileSync(new URL("../../../fixtures/civil-map-context.json", import.meta.url), "utf8"));

test("vrstvy používají pouze pevné ČÚZK endpointy se shodným XY rozsahem", () => {
  const bounds = savedMap().terrain.bounds;
  for (const layer of ["ortho", "topographic", "cadastral"]) {
    const url = new URL(mapImageUrl(bounds, layer));
    assert.equal(url.protocol, "https:");
    assert.ok(["ags.cuzk.gov.cz", "services.cuzk.gov.cz"].includes(url.hostname));
    assert.equal(url.searchParams.get(layer === "cadastral" ? "BBOX" : "bbox"), bounds.join(","));
    if (layer === "cadastral") {
      assert.equal(url.searchParams.get("VERSION"), "1.1.1");
      assert.equal(url.searchParams.get("SRS"), "EPSG:5514");
      assert.equal(url.searchParams.get("LAYERS"), "KN");
    }
  }
  for (const layer of ["__proto__", "constructor", "https://attacker.invalid"]) assert.throws(() => mapImageUrl(bounds, layer));
});

test("snapshot uchová mapu, NoData a nastavení bez DOM objektu", () => {
  const saved = savedMap();
  assert.equal(isStoredMapContext(saved), true);
  const serialized = storedMapContext({ ...saved, image: { src: "blob:temporary" } });
  assert.deepEqual(serialized, saved);
  assert.equal("image" in serialized, false);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)), saved);
});

test("uložená mapa odmítá URL, SVG, nadlimitní obraz, neplatné vrstvy, výšky a rozsah", () => {
  for (const override of [{ image_data_url: "https://attacker.invalid/track" }, { image_data_url: "data:image/svg+xml;base64,/9j/" },
    { image_data_url: "data:image/jpeg;base64,/9j/" + "A".repeat(2_000_000) }, { image_data_url: "data:image/jpeg;base64,/9j/<>" },
    { layer: "__proto__" }, { layer: {} }, { version: 2 }, { margin: null }, { opacity: NaN }, { visible: 1 }, { loaded_at: "bad" }, { extra: true }]) {
    assert.equal(isStoredMapContext({ ...savedMap(), ...override }), false);
  }
  for (const override of [{ bounds: [0, 0, 100, 100] }, { bounds: [-742050, -1043050, -740050, -1041050] },
    { bounds: [-742050, -1043050, -741950, -1042850] }, { size: 32 }, { elevations: [null, null, null, null] },
    { elevations: [190, 191, 5000, null] }, { elevations: [190, 191, "192", null] }, { extra: true }]) {
    const saved = savedMap();
    assert.equal(isStoredMapContext({ ...saved, terrain: { ...saved.terrain, ...override } }), false);
  }
});

test("obnova mapy nepoužije síť a kontroluje rozměry obrázku", async (t) => {
  const saved = savedMap();
  t.mock.method(globalThis, "fetch", () => { throw new Error("Obnova nesmí stahovat"); });
  const old = globalThis.Image;
  class FakeImage { width = 1024; height = 1024; src = ""; async decode() {} }
  globalThis.Image = FakeImage;
  try {
    const result = await restoreMapContext(saved);
    assert.equal(result.image.src, saved.image_data_url);
    FakeImage.prototype.decode = async function () { this.width = 2048; };
    await assert.rejects(restoreMapContext(saved), /rozměry/);
  } finally { globalThis.Image = old; }
});

test("podrobná síť respektuje dvoumetrový rastr i maximální počet bodů", async () => {
  const { terrainGridSize } = await import("../src/civil-map.ts");
  assert.equal(terrainGridSize([0, 0, 190, 190], true), 96);
  assert.equal(terrainGridSize([0, 0, 1000, 1000], true), 151);
  assert.equal(terrainGridSize([0, 0, 190, 190], false), 31);
  const saved = savedMap();
  saved.terrain.size = 151;
  saved.terrain.elevations = Array(151 * 151).fill(195);
  assert.equal(isStoredMapContext(saved), true);
  saved.terrain.size = 152;
  saved.terrain.elevations = Array(152 * 152).fill(195);
  assert.equal(isStoredMapContext(saved), false);
});

test("souběžné výškové řádky zachovají pořadí, mají limit a podporují zrušení", async (t) => {
  const { loadTerrain } = await import("../src/civil-map.ts");
  let active = 0, peak = 0, calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.credentials, "omit"); assert.equal(options.referrerPolicy, "no-referrer");
    calls++; active++; peak = Math.max(peak, active);
    const { points } = JSON.parse(new URL(url).searchParams.get("geometry")!);
    await new Promise((resolve) => setTimeout(resolve, points[0][1] % 2 ? 2 : 8));
    active--;
    return new Response(JSON.stringify({ results: points.toReversed().map(([x, y]) => ({ value: 195 + y + x,
      location: { x, y, spatialReference: { wkid: 5514, vcsWkid: 8357 } } })) }));
  });
  const progress: number[] = [];
  const result = await loadTerrain([0, 0, 4, 4], new AbortController().signal, (n) => progress.push(n), 5);
  assert.deepEqual(result.elevations, Array.from({ length: 25 }, (_, i) => 195 + i % 5 + Math.floor(i / 5)));
  assert.deepEqual(progress, [1, 2, 3, 4, 5]); assert.equal(peak, 4);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(loadTerrain([0, 0, 4, 4], aborted.signal, () => {}, 5));
  assert.equal(calls, 5);
});
