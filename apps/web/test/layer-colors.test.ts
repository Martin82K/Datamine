import assert from "node:assert/strict";
import test from "node:test";
import { TRIANGULATION_KEY, readTriangulationVisibility, setTriangulationVisibility } from "../src/layer-colors.ts";

import { HIDDEN_LAYERS_KEY, LAYER_COLORS_KEY, LAYER_NAMES_KEY, LAYER_OPACITIES_KEY, defaultLayerColor, defaultLayerColors, readHiddenLayerIds, readLayerColors, readLayerNames, readLayerOpacities, setLayerColor, setLayerName, setLayerOpacity, setLayerVisibility } from "../src/layer-colors.ts";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

test("triangulace se pamatuje po projektu a nepřepíná ostatní projekty", () => {
  const storage = memoryStorage();
  const scope = "project_local_12345678";
  assert.equal(readTriangulationVisibility(storage, scope), false);
  setTriangulationVisibility(storage, scope, true);
  assert.equal(readTriangulationVisibility(storage, scope), true);
  assert.equal(readTriangulationVisibility(storage, "project_local_other123"), false);
  setTriangulationVisibility(storage, scope, false);
  assert.equal(readTriangulationVisibility(storage, scope), false);
});

test("poškozená a nadlimitní volba triangulace se bezpečně odmítne", () => {
  const storage = memoryStorage();
  const scope = "project_local_12345678";
  for (const raw of ["{", "[]", JSON.stringify({ [scope]: "true" }), "x".repeat(100_001)]) {
    storage.setItem(TRIANGULATION_KEY, raw);
    assert.equal(readTriangulationVisibility(storage, scope), false);
  }
  assert.throws(() => setTriangulationVisibility(storage, "../invalid", true), /platná/);
  storage.setItem(TRIANGULATION_KEY, JSON.stringify(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`project_${i}`, true]))));
  const before = storage.getItem(TRIANGULATION_KEY);
  assert.throws(() => setTriangulationVisibility(storage, scope, true), /limit/);
  assert.equal(storage.getItem(TRIANGULATION_KEY), before);
  assert.equal(readTriangulationVisibility({ getItem: () => { throw new Error("unavailable"); } }, scope), false);
});

test("vrstvy mají stabilní výchozí barvy a uživatelská změna se bezpečně uloží", () => {
  assert.equal(defaultLayerColor("layer_points"), defaultLayerColor("layer_points"));
  assert.match(defaultLayerColor("layer_points"), /^#[0-9a-f]{6}$/);
  const storage = memoryStorage();
  const colors = setLayerColor(storage, "project_local_12345678", "layer_points", "#AABBCC");
  assert.equal(colors.layer_points, "#aabbcc");
  assert.equal(readLayerColors(storage, "project_local_12345678").layer_points, "#aabbcc");
});

test("sada výchozích barev řeší kolize deterministicky", () => {
  const layers = ["layer_a", "layer_b", "layer_c", "layer_d", "layer_e", "layer_f"];
  const colors = defaultLayerColors(layers);
  assert.equal(new Set(Object.values(colors)).size, layers.length);
  assert.deepEqual(defaultLayerColors([...layers].reverse()), colors);
});

test("poškozené nebo nebezpečné nastavení barev se nenačte", () => {
  const storage = memoryStorage();
  storage.setItem(LAYER_COLORS_KEY, JSON.stringify({ "../projekt": { "__proto__": "red" } }));
  assert.deepEqual(readLayerColors(storage, "project_local_12345678"), {});
  assert.throws(() => setLayerColor(storage, "project_local_12345678", "../layer", "#ffffff"), TypeError);
  assert.throws(() => setLayerColor(storage, "project_local_12345678", "layer_points", "url(javascript:1)"), TypeError);
});

test("průhlednost vrstvy je omezená, perzistentní a fail-closed", () => {
  const storage = memoryStorage();
  assert.equal(setLayerOpacity(storage, "project_local_12345678", "layer_surface", 0.45).layer_surface, 0.45);
  assert.equal(readLayerOpacities(storage, "project_local_12345678").layer_surface, 0.45);
  assert.throws(() => setLayerOpacity(storage, "project_local_12345678", "layer_surface", 0), TypeError);
  storage.setItem(LAYER_OPACITIES_KEY, JSON.stringify({ "project_local_12345678": { layer_surface: "1" } }));
  assert.deepEqual(readLayerOpacities(storage, "project_local_12345678"), {});
});

test("viditelnost vrstvy se ukládá po projektu a neplatný obsah selže bezpečně", () => {
  const storage = memoryStorage();
  assert.deepEqual(setLayerVisibility(storage, "project_local_12345678", "layer_surface", false), ["layer_surface"]);
  assert.deepEqual(readHiddenLayerIds(storage, "project_local_12345678"), ["layer_surface"]);
  assert.deepEqual(setLayerVisibility(storage, "project_local_12345678", "layer_surface", true), []);
  assert.throws(() => setLayerVisibility(storage, "project_local_12345678", "../layer", false), TypeError);
  storage.setItem(HIDDEN_LAYERS_KEY, JSON.stringify({ "project_local_12345678": ["../layer"] }));
  assert.deepEqual(readHiddenLayerIds(storage, "project_local_12345678"), []);
});

test("uživatelský název vrstvy zachová diakritiku a neplatný obsah selže bezpečně", () => {
  const storage = memoryStorage();
  assert.equal(setLayerName(storage, "project_local_12345678", "layer_Pracovni_body", " Pracovní body ").layer_Pracovni_body, "Pracovní body");
  assert.equal(readLayerNames(storage, "project_local_12345678").layer_Pracovni_body, "Pracovní body");
  assert.throws(() => setLayerName(storage, "project_local_12345678", "layer_Pracovni_body", "<script>"), TypeError);
  storage.setItem(LAYER_NAMES_KEY, JSON.stringify({ "project_local_12345678": { layer_Pracovni_body: "Neplatný\u0000název" } }));
  assert.deepEqual(readLayerNames(storage, "project_local_12345678"), {});
});
