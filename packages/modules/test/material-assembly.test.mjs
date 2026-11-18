import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isContract } from "@datamine/contracts";
import { EditorStore } from "@datamine/editor-core";
import { createCivilMaterialAssemblyFromSurface } from "../dist/index.js";

const fixture = JSON.parse(await readFile(new URL("../../../fixtures/contracts/v1/valid-civil-export-model.json", import.meta.url), "utf8"));
const surface = fixture.objects.find((o) => o.type === "civil.tin_surface");
const inputs = [0.04, 0.06, 0.2].map((thicknessM, i) => ({
  objectId: `object_assembly_${i}`, layerId: `layer_assembly_${i}`, name: `Testovací vrstva ${i}`, materialCode: `MAT_${i}`, thicknessM,
  sourceDocumentId: surface.provenance.source_document_id, sourceDocumentSha256: surface.provenance.source_document_sha256,
}));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} vs ${b}`);
const model = (layers) => ({ ...fixture, objects: [surface, ...layers] });

test("skladba vytváří uzavřené navazující objemy se zachováním TIN a platných vazeb", () => {
  const before = JSON.stringify(surface);
  const layers = createCivilMaterialAssemblyFromSurface(surface, "assembly_test", inputs);
  assert.equal(isContract("model_version", model(layers)), true);
  const count = surface.geometry.vertices.length;
  let offset = 0;
  for (const [i, layer] of layers.entries()) {
    assert.equal(isContract("model_object", layer), true);
    near(layer.properties.derivation.top_offset_m, offset);
    for (let v = 0; v < count; v += 1) {
      near(layer.geometry.vertices[v][2], surface.geometry.vertices[v][2] - offset);
      if (i) near(layer.geometry.vertices[v][2], layers[i - 1].geometry.vertices[v + count][2]);
    }
    offset += inputs[i].thicknessM;
  }
  const area = layers[0].properties.volume_m3 / inputs[0].thicknessM;
  near(layers.reduce((sum, layer) => sum + layer.properties.volume_m3, 0), area * 0.3);
  assert.equal(JSON.stringify(surface), before);
  assert.equal(isContract("model_version", JSON.parse(JSON.stringify(model(layers)))), true);
});

test("úprava tloušťky posune nižší vrstvy a celá změna se vrátí jedním undo", () => {
  const layers = createCivilMaterialAssemblyFromSurface(surface, "assembly_test", inputs);
  const changed = createCivilMaterialAssemblyFromSurface(surface, "assembly_test", inputs.map((input, i) => i === 0 ? { ...input, thicknessM: 0.1 } : input));
  near(changed[1].properties.derivation.top_offset_m, 0.1);
  near(changed[2].properties.derivation.top_offset_m, 0.16);
  assert.deepEqual(changed.map((o) => o.id), layers.map((o) => o.id));
  assert.equal(isContract("model_version", model(changed)), true);
  const store = new EditorStore([surface, ...layers]);
  store.executeBatch(changed.map((object, i) => ({ id: `command_${i}`, type: "object.upsert", baseRevision: 0, object })));
  const sorted = (objects) => [...objects].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(sorted(store.undo().objects), sorted([surface, ...layers]));
  assert.deepEqual(sorted(store.redo().objects), sorted([surface, ...changed]));
});

test("kontrola modelu odmítne mezeru, překrytí, chybějící vrstvu a nesouvislé pořadí", () => {
  const layers = createCivilMaterialAssemblyFromSurface(surface, "assembly_test", inputs);
  for (const dz of [-0.01, 0.01]) {
    const bad = structuredClone(layers);
    bad[1].properties.derivation.top_offset_m += dz;
    bad[1].geometry.vertices.forEach((point) => { point[2] -= dz; });
    bad[1].geometry.bounds.min[2] -= dz; bad[1].geometry.bounds.max[2] -= dz;
    assert.equal(isContract("model_object", bad[1]), true);
    assert.equal(isContract("model_version", model(bad)), false);
  }
  assert.equal(isContract("model_version", model([layers[0], layers[2]])), false);
  const duplicate = structuredClone(layers); duplicate[1].properties.derivation.assembly.order = 0;
  assert.equal(isContract("model_version", model(duplicate)), false);
});

test("neplatné hodnoty, identifikace a příliš rozsáhlá skladba se odmítnou před uložením", () => {
  for (const thicknessM of [0, -1, NaN, Infinity, 1001]) assert.throws(() => createCivilMaterialAssemblyFromSurface(surface, "assembly_test", [{ ...inputs[0], thicknessM }]));
  assert.throws(() => createCivilMaterialAssemblyFromSurface(surface, "assembly_test", []));
  assert.throws(() => createCivilMaterialAssemblyFromSurface(surface, "assembly_test", Array(21).fill(inputs[0])));
  assert.throws(() => createCivilMaterialAssemblyFromSurface(surface, "assembly_test", [inputs[0], inputs[0]]));
  assert.throws(() => createCivilMaterialAssemblyFromSurface(surface, "../invalid", inputs));
  assert.throws(() => createCivilMaterialAssemblyFromSurface(surface, "assembly_test", [{ ...inputs[0], materialCode: "../invalid" }]));
  const dense = structuredClone(surface); dense.geometry.vertices = Array(20000).fill([0, 0, 0]);
  assert.throws(() => createCivilMaterialAssemblyFromSurface(dense, "assembly_test", inputs), /100 000/);
  const low = structuredClone(surface); low.geometry.vertices.forEach((p) => { p[2] = -100000; });
  assert.throws(() => createCivilMaterialAssemblyFromSurface(low, "assembly_test", inputs), /rozsah souřadnic/);
});
