import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cameraCommandForKey } from "../src/camera-controls.ts";

test("klávesy civilní kamery jsou jednoznačné a nerozbíjejí ostatní vstupy", () => {
  assert.equal(cameraCommandForKey("f"), "fit");
  assert.equal(cameraCommandForKey("F"), "fit");
  assert.equal(cameraCommandForKey("h"), "level");
  assert.equal(cameraCommandForKey("Home"), "level");
  assert.equal(cameraCommandForKey("0"), "iso");
  assert.equal(cameraCommandForKey("ArrowUp"), null);
});

test("3D panel nabízí samostatné povely a oznamuje volný pohled", async () => {
  const source = await readFile(new URL("../src/EditorViewport.tsx", import.meta.url), "utf8");
  assert.match(source, /Zarámovat/);
  assert.match(source, /Srovnat horizont/);
  assert.match(source, /Volný pohled/);
  assert.match(source, /onViewStateChange/);
});

test("renderer používá OrbitControls místo ovladače dovolujícího roll", async () => {
  const source = await readFile(new URL("../../../packages/renderer/src/index.ts", import.meta.url), "utf8");
  assert.match(source, /OrbitControls/);
  assert.doesNotMatch(source, /TrackballControls/);
  assert.match(source, /maxPolarAngle/);
});
