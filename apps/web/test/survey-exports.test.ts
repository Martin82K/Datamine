import assert from "node:assert/strict";
import test from "node:test";

import { demoCivilObjects, demoStakeoutObjects } from "../src/demo-model.ts";
import { createCivilModelDxf, createSurveyPointsCsv, createTinVerticesCsv, safeSurveyExportStem } from "../src/survey-exports.ts";

test("CSV export obsahuje pouze název bodu a souřadnice a neutralizuje tabulkové formule", () => {
  const point = structuredClone(demoStakeoutObjects[0]!);
  point.properties.name = "=HYPERLINK(\"https://invalid\")";
  const csv = createSurveyPointsCsv([point]);
  const [header, row] = csv.slice(1).trim().split("\r\n");
  assert.equal(header, '"Název bodu","X","Y","Z"');
  assert.ok(csv.includes("\"'=HYPERLINK(\"\"https://invalid\"\")\""));
  assert.ok(csv.includes(point.geometry.point[0].toFixed(3)));
  assert.equal(row, `"'=HYPERLINK(""https://invalid"")","${point.geometry.point[0].toFixed(3)}","${point.geometry.point[1].toFixed(3)}","${point.geometry.point[2].toFixed(3)}"`);
  assert.ok(!csv.includes("layer"));
  assert.ok(!csv.includes("EPSG"));
  assert.ok(!csv.includes("review_state"));
});

test("CSV export omezený výběrem nepropustí jiné body", () => {
  const second = structuredClone(demoStakeoutObjects[0]!);
  second.id = "object_stakeout_export_second";
  second.properties.code = "EXPORT_SECOND";
  second.properties.name = "Druhý bod";
  const csv = createSurveyPointsCsv([demoStakeoutObjects[0]!, second], [second.id]);
  assert.ok(csv.includes(`"${second.properties.name}",`));
  assert.ok(!csv.includes(`"${demoStakeoutObjects[0]!.properties.name}",`));
  assert.ok(!csv.includes(second.properties.code));
});

test("DXF export oddělí body a civilní geometrii do bezpečných vrstev", () => {
  const dxf = createCivilModelDxf([...demoCivilObjects, ...demoStakeoutObjects]);
  assert.ok(dxf.includes("SECTION\n"));
  assert.ok(dxf.includes("0\nPOINT\n"));
  assert.ok(dxf.includes("0\nLINE\n"));
  assert.ok(dxf.endsWith("0\nEOF\n"));
  assert.equal(/[<>\r]/.test(dxf), false);
  assert.equal(safeSurveyExportStem("Opěrná stěna / Bečov"), "Operna-stena-Becov");
});

test("CSV export TIN vrcholů zachová přesné XYZ bez interních dat", () => {
  const surface = {
    schema_version: "datamine.tin-surface-object.v1",
    id: "object_surface_export",
    type: "civil.tin_surface",
    layer_id: "layer_surface",
    geometry: {
      kind: "indexed_tin", coordinate_space: "survey_crs",
      vertices: [[1000, 2000, 250], [1010, 2000, 251], [1000, 2004, 251]],
      faces: [[0, 1, 2]], bounds: { min: [1000, 2000, 250], max: [1010, 2004, 251] },
    },
    properties: {
      schema_version: "datamine.tin-surface-properties.v1", name: "Šikmá plocha",
      crs: demoCivilObjects[0]!.properties.crs, review_state: "unreviewed",
    },
    provenance: demoCivilObjects[0]!.provenance,
  } as const;
  const csv = createTinVerticesCsv(surface);
  assert.ok(csv.startsWith('\uFEFF"Vrchol","X","Y","Z"'));
  assert.ok(csv.includes('"V001","1000.000","2000.000","250.000"'));
  assert.ok(csv.includes('"V003","1000.000","2004.000","251.000"'));
  assert.ok(!csv.includes("layer_surface"));
});

test("pracovní DXF exportuje profil a zachová hladinu i po přejmenování a změně pořadí", () => {
  const objects = structuredClone(demoCivilObjects);
  const profile = objects.find((object) => object.type === "civil.profile")!;
  const dxf = createCivilModelDxf([profile]);
  assert.equal(dxf.split("0\nLINE\n").length - 1, profile.geometry.points.length - 1);
  assert.ok(dxf.includes(`8\n${profile.layer_id}\n`));
  profile.properties.name = "Jiné jméno";
  assert.equal(createCivilModelDxf([profile]), dxf);
});

test("pracovní export odmítne neplatnou geometrii a smíšené CRS", () => {
  const first = structuredClone(demoStakeoutObjects[0]!);
  const second = structuredClone(first);
  second.id = "object_export_other_crs";
  second.properties.crs.vertical_datum = "Jiný výškový systém";
  assert.throws(() => createSurveyPointsCsv([first, second]), /shodný/);
  assert.throws(() => createCivilModelDxf([first, second]), /shodný/);
  first.geometry.point[0] = Number.NaN;
  assert.throws(() => createSurveyPointsCsv([first]), /neplatnou/);
  assert.throws(() => createCivilModelDxf([first]), /neplatnou/);
});


test("DXF odmítne kolizi hladin lišících se pouze velikostí písmen", () => {
  const first = structuredClone(demoStakeoutObjects[0]!);
  const second = structuredClone(first);
  second.id = "object_export_case_layer";
  first.layer_id = "layer_COLLISION";
  second.layer_id = "layer_collision";
  assert.throws(() => createCivilModelDxf([first, second]), /velikostí písmen/);
});
