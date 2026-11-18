import assert from "node:assert/strict";
import test from "node:test";
import { createCivilMaterialAssemblyFromSurface, createCivilMaterialLayerFromSurface, createCivilTinSurfaceFromPoints } from "@datamine/modules";
import { demoCivilObjects } from "../src/demo-model.ts";
import { createCivilSection } from "../src/civil-sections.ts";

const points = [[0, 0, 250], [10, 0, 250], [10, 4, 250], [0, 4, 250]].map((xyz, i) => {
  const point = structuredClone(demoCivilObjects[2]); point.id = `object_section_point_${i}`;
  point.geometry.point = xyz as [number, number, number]; return point;
});
const input = { objectId: "object_section_tin", layerId: "layer_section_tin", name: "Povrch", sourceDocumentId: points[0]!.provenance.source_document_id, sourceDocumentSha256: points[0]!.provenance.source_document_sha256 };
const tin = createCivilTinSurfaceFromPoints(points, input);
const material = createCivilMaterialLayerFromSurface(tin, { ...input, objectId: "object_section_material", materialCode: "STERK", thicknessM: 0.3 });
const ref = (x: number, y: number) => ({ point: [x, y, 0] as const, crs: points[0]!.properties.crs });
const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-7, `${actual} vs ${expected}`);

test("řez skladbou obsahuje samostatné navazující průřezy a přesné plochy", () => {
  const layers = createCivilMaterialAssemblyFromSurface(tin, "assembly_section", [0.04, 0.06, 0.2].map((thicknessM, i) => ({
    ...input, objectId: `object_section_assembly_${i}`, layerId: `layer_section_assembly_${i}`, materialCode: `MAT_${i}`, thicknessM,
  })));
  const section = createCivilSection(layers, ref(0, 2), ref(10, 2));
  assert.equal(section.traces.length, 3);
  section.traces.forEach((trace, i) => { near(trace.areaM2, [0.4, 0.6, 2][i]!); assert.equal(trace.warning, null); });
  const heights = section.traces.map((trace) => trace.segments.flat().map((point) => point[1]));
  near(Math.min(...heights[0]!), Math.max(...heights[1]!));
  near(Math.min(...heights[1]!), Math.max(...heights[2]!));
  near(Math.min(...heights[2]!), 249.7);
});

test("šikmý řez v XY respektuje rozsah a sklon plochy; Z konců rovinu nenaklání", () => {
  const slopedPoints = points.map((point) => {
    const copy = structuredClone(point);
    const [x, y] = copy.geometry.point;
    copy.geometry.point[2] = 250 + 0.1 * x + 0.2 * y;
    return copy;
  });
  const slope = createCivilTinSurfaceFromPoints(slopedPoints, input);
  const a = ref(2, 1), b = ref(8, 3), length = Math.hypot(6, 2);
  const forward = createCivilSection([slope], a, b);
  near(forward.lengthM, length);
  const profile = forward.traces[0]!.segments.flat();
  for (const [s, z] of profile) {
    assert.ok(s >= -1e-7 && s <= length + 1e-7);
    near(z, 250.4 + s / length);
  }
  near(Math.min(...profile.map((p) => p[0])), 0);
  near(Math.max(...profile.map((p) => p[0])), length);
  const reverse = createCivilSection([slope], b, a);
  for (const [s, z] of reverse.traces[0]!.segments.flat()) near(z, 251.4 - s / length);
  assert.deepEqual(createCivilSection([slope], { ...a, point: [2, 1, -100] }, { ...b, point: [8, 3, 800] }), forward);
});

test("body nad sebou neurčují svislý řez a samotné body netvoří průřez", () => {
  assert.throws(() => createCivilSection([tin], { ...ref(2, 1), point: [2, 1, 100] }, { ...ref(2, 1), point: [2, 1, 200] }), /rozdílnou polohou XY/);
  assert.deepEqual(createCivilSection(points, ref(0, 0), ref(10, 0)).traces, []);
});

test("svislý řez prochází TIN i uzavřenou vrstvou a zachová model", () => {
  const objects = [tin, material]; const before = JSON.stringify(objects);
  const result = createCivilSection(objects, ref(-2, 2), ref(12, 2));
  assert.equal(result.lengthM, 14); assert.equal(result.traces.length, 2);
  near(result.traces[1]!.areaM2, 3);
  assert.equal(result.traces[0]!.areaM2, null);
  assert.ok(result.traces[1]!.segments.flat().some((p) => p[1] === 249.7));
  assert.equal(JSON.stringify(objects), before);
});
test("omezený rozsah, opačný směr, shoda s hranou a řez mimo model", () => {
  near(createCivilSection([material], ref(2, 2), ref(8, 2)).traces[0]!.areaM2, 1.8);
  near(createCivilSection([material], ref(8, 2), ref(2, 2)).traces[0]!.areaM2, 1.8);
  near(createCivilSection([material], ref(0, 0), ref(10, 0)).traces[0]!.areaM2, 3);
  assert.equal(createCivilSection([material], ref(0, 10), ref(10, 10)).traces.length, 0);
});
function hollowLayer() {
  const hollow = structuredClone(tin);
  hollow.geometry.vertices = [[0,0,250],[10,0,250],[10,4,250],[0,4,250],[4,1,250],[6,1,250],[6,3,250],[4,3,250]];
  hollow.geometry.faces = [[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return createCivilMaterialLayerFromSurface(hollow, { ...input, objectId: "object_section_hollow", materialCode: "STERK", thicknessM: 0.3 });
}

test("otvor v TIN vytvoří oddělené průřezy bez falešné výplně", () => {
  const layer = hollowLayer();
  const result = createCivilSection([layer], ref(0,2), ref(10,2));
  near(result.traces[0]!.areaM2, 2.4);
  assert.equal(result.traces[0]!.rings.length, 2);
});
test("neplatný řez, nesoulad CRS a otevřený materiál se nevykazují jako platná plocha", () => {
  assert.throws(() => createCivilSection([material], ref(0,0), ref(0,0)), /rozdílnou polohou/);
  const other = { ...ref(10,0), crs: { ...ref(10,0).crs, epsg: 4326 } };
  assert.throws(() => createCivilSection([material], ref(0,0), other), /shodný/);
  const broken = structuredClone(material); broken.geometry.faces = broken.geometry.faces.slice(0, 2);
  const result = createCivilSection([broken], ref(0,2), ref(10,2));
  assert.equal(result.traces[0]!.areaM2, null); assert.ok(result.traces[0]!.warning);
  broken.geometry.faces[0] = [0, 1, 0.5];
  assert.throws(() => createCivilSection([broken], ref(0,2), ref(10,2)), /index/);
});


test("tečný dotyk rohu otvoru nezneplatní plochu a nezahladí chybějící stěnu", () => {
  const layer = hollowLayer();
  for (const [a, b] of [[ref(1,4), ref(5,0)], [ref(5,0), ref(1,4)], [ref(5,4), ref(9,0)]]) {
    const trace = createCivilSection([layer], a!, b!).traces[0]!;
    near(trace.areaM2, Math.sqrt(32) * 0.3);
    assert.equal(trace.warning, null);
  }
  // Remove only one of the two faces incident to the touched vertical edge.
  // The unmatched edge must remain, exposing the broken section topology.
  const faceIndex = layer.geometry.faces.findIndex((face) => face.includes(4) && face.includes(12));
  assert.ok(faceIndex >= 0);
  layer.geometry.faces.splice(faceIndex, 1);
  const broken = createCivilSection([layer], ref(1,4), ref(5,0)).traces[0]!;
  assert.equal(broken.areaM2, null);
  assert.ok(broken.warning);
});

test("řez ve stěně otvoru přizná degenerovanou polohu bez falešné plochy", () => {
  const layer = hollowLayer();
  for (const y of [1, 3]) {
    const trace = createCivilSection([layer], ref(0,y), ref(10,y)).traces[0]!;
    assert.equal(trace.areaM2, null);
    assert.match(trace.warning!, /rovině stěny/);
  }
  near(createCivilSection([layer], ref(0,1 - 2e-7), ref(10,1 - 2e-7)).traces[0]!.areaM2, 3);
  near(createCivilSection([layer], ref(0,1 + 2e-7), ref(10,1 + 2e-7)).traces[0]!.areaM2, 2.4);
});

test("limit úseček platí přes všechny objekty, ne pro každý zvlášť", () => {
  const dense = structuredClone(tin);
  dense.geometry.vertices = [];
  dense.geometry.faces = [];
  for (let i = 0; i < 3000; i += 1) {
    dense.geometry.vertices.push([i*2,-1,250], [i*2+1,-1,250], [i*2+0.5,1,250]);
    dense.geometry.faces.push([i*3, i*3+1, i*3+2]);
  }
  const copies = Array.from({ length: 7 }, (_, i) => ({ ...dense, id: `object_dense_${i}` }));
  assert.throws(() => createCivilSection(copies, ref(-1,0), ref(6000,0)), /20 000 úseček/);
});

test("souřadnice a trojúhelníky mimo číselný kontrakt se odmítnou", () => {
  assert.throws(() => createCivilSection([tin], ref(1e308,0), ref(0,0)), /rozsahu modelu/);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1e308]) {
    const invalid = structuredClone(tin);
    invalid.geometry.vertices[0]![0] = value;
    assert.throws(() => createCivilSection([invalid], ref(0,2), ref(10,2)), /souřadnice/);
  }
  const invalid = structuredClone(tin);
  invalid.geometry.faces[0] = [0, 1] as unknown as [number, number, number];
  assert.throws(() => createCivilSection([invalid], ref(0,2), ref(10,2)), /index/);
});

test("deterministické řezy ve velkých souřadnicích souhlasí s analytickým ořezem", () => {
  let seed = 1;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2**32; };
  for (const [ox, oy] of [[0, 0], [-700000, -1000000], [99000000, 99000000]]) {
    const layer = structuredClone(material);
    layer.geometry.vertices = layer.geometry.vertices.map(([x,y,z]) => [x + ox!, y + oy!, z]);
    for (let i = 0; i < 100; i += 1) {
      const a = [-5 + random()*20, -5 + random()*14];
      const b = [-5 + random()*20, -5 + random()*14];
      const delta = b.map((value, axis) => value - a[axis]!);
      let low = 0; let high = 1;
      for (let axis = 0; axis < 2; axis += 1) {
        const bounds = [-a[axis]! / delta[axis]!, ([10,4][axis]! - a[axis]!) / delta[axis]!].sort((x,y) => x-y);
        low = Math.max(low, bounds[0]!); high = Math.min(high, bounds[1]!);
      }
      const expected = Math.max(0, high-low) * Math.hypot(...delta) * 0.3;
      const trace = createCivilSection([layer], ref(a[0]!+ox!,a[1]!+oy!), ref(b[0]!+ox!,b[1]!+oy!)).traces[0];
      near(trace?.areaM2 ?? (expected === 0 ? 0 : null), expected);
    }
  }
});
