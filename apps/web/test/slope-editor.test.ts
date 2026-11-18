import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = async (): Promise<string> => readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

test("kopírování používá zmrazený výběr a jednorázové potvrzení", async () => {
  const source = await appSource();
  assert.match(source, /copySourceIds/);
  assert.match(source, /copyCommitPendingRef\.current/);
  assert.match(source, /if \(event\.repeat\) return/);
  assert.match(source, /selectionAction === "copy"\) copySelectedPoints\(\)/);
  assert.doesNotMatch(source, /selectionAction === "copy" && event\.key === "Enter"/);
});

test("3D editor nabízí šikmou plochu z osy nebo dvojice bodů a export vrcholů", async () => {
  const source = await appSource();
  assert.match(source, />Šikmá plocha<\/button>/);
  assert.match(source, /selectedAxis \|\| selectedSurveyPoints\.length === 2/);
  assert.match(source, /civilSlopeElevationDifference/);
  assert.match(source, /createCivilSlopeSurface/);
  assert.match(source, /createTinVerticesCsv/);
  assert.match(source, /Kladná hodnota zvedá vnější hranu/);
});
