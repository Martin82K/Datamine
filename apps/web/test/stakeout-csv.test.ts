import assert from "node:assert/strict";
import test from "node:test";
import { isContract } from "@datamine/contracts";
import { extractStakeoutProposal, stakeoutObjectsFromProposal } from "../src/processing-api.ts";
import { isStakeoutCsv, MAX_STAKEOUT_CSV_BYTES, parseStakeoutCsv } from "../src/stakeout-csv.ts";
import { createSurveyPointsCsv } from "../src/survey-exports.ts";
import type { LocalProjectFile } from "../src/local-projects.ts";

const sample = 'bod,X,Y,Z\nVytyčovací body 1,-123456.789,-987654.321,123.450\nVytyčovací body 2,-123457.001,-987655.002,123.490\n';
async function source(text = sample) {
  const blob = new Blob([text]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
  const file: LocalProjectFile = {
    id: "file_local_csv_test_12345678", name: "Body s výškami.CSV", size: blob.size,
    media_type: "application/octet-stream", role: "data", created_at: new Date().toISOString(),
    sha256: [...digest].map((value) => value.toString(16).padStart(2, "0")).join(""),
  };
  return { file, blob };
}

test("CSV zachová názvy, záporné XY, výšky a zdrojové řádky", () => {
  const points = parseStakeoutCsv(sample);
  assert.equal(points.length, 2);
  assert.equal(points[0]!.name, "Vytyčovací body 1");
  assert.deepEqual(points[0]!.point, [-123456.789, -987654.321, 123.45]);
  assert.deepEqual(points.map((point) => point.row), [2, 3]);
});

test("CSV podporuje BOM, CRLF, uvozovky, středník a desetinné čárky", () => {
  const points = parseStakeoutCsv('\uFEFF"bod";"X";"Y";"Z"\r\n"Bod ""A"", sever";-12,345;-98,765;0,000\r\n\r\n');
  assert.equal(points[0]!.name, 'Bod "A", sever');
  assert.deepEqual(points[0]!.point, [-12.345, -98.765, 0]);
});

for (const invalid of [
  "", "bod,X,Y,Z\n", "bod,Y,X,Z\na,1,2,3", "bod,X,Y\na,1,2",
  "bod,X,Y,Z\na,1,2,", "bod,X,Y,Z\na,1,2", "bod,X,Y,Z\n,1,2,3",
  "bod,X,Y,Z\na,1,2,3,4", "bod,X,Y,Z\na,1,2,NaN", "bod,X,Y,Z\na,1,2,Infinity",
  "bod,X,Y,Z\na,1,2,1e999", "bod,X,Y,Z\na,1,2,0x10", "bod,X,Y,Z\na,1,2,=1+2",
  'bod,X,Y,Z\n"a,1,2,3', 'bod,X,Y,Z\n"a"b,1,2,3', 'bod,X,Y,Z\n"a\nb",1,2,3',
  "bod,X,Y,Z\na\u0000,1,2,3", `bod,X,Y,Z\n${"a".repeat(201)},1,2,3`,
]) test(`CSV bezpečně odmítne chybný vstup ${JSON.stringify(invalid).slice(0, 70)}`, () => {
  assert.throws(() => parseStakeoutCsv(invalid), /CSV/);
});

test("CSV neignoruje chybný řádek mezi platnými body", () => {
  assert.throws(() => parseStakeoutCsv(`${sample}Chyba,1,2,\nDalší,4,5,6`), /řádku 4/);
});

test("CSV vynucuje hranici počtu bodů a velikost", () => {
  assert.equal(parseStakeoutCsv(`bod,X,Y,Z\n${"A,1,2,3\n".repeat(10_000)}`).length, 10_000);
  assert.throws(() => parseStakeoutCsv(`bod,X,Y,Z\n${"A,1,2,3\n".repeat(10_001)}`), /10 000/);
  assert.throws(() => parseStakeoutCsv(" ".repeat(MAX_STAKEOUT_CSV_BYTES + 1)), /4 MB/);
});

test("vytěžení CSV nepotřebuje server a vytváří platné body s ověřeným původem", async (context) => {
  context.mock.method(globalThis, "fetch", () => { throw new Error("CSV nesmí volat server"); });
  const { file, blob } = await source();
  assert.equal(isStakeoutCsv(file), true);
  const payload = await extractStakeoutProposal(file, blob, () => {});
  const points = stakeoutObjectsFromProposal(payload, file, 5514, "Bpv");
  assert.equal(payload.source_job_id, undefined);
  assert.equal(points.length, 2);
  assert.ok(points.every((point) => isContract("model_object", point)));
  assert.deepEqual(points[1]!.geometry.point, [-123457.001, -987655.002, 123.49]);
  assert.equal(points[0]!.provenance.source_kind, "imported");
  assert.equal(points[0]!.provenance.source_document_sha256, file.sha256);
  assert.equal(points[0]!.properties.review_state, "unreviewed");
  assert.deepEqual(stakeoutObjectsFromProposal(await extractStakeoutProposal(file, blob, () => {}), file), points);
  const roundTrip = parseStakeoutCsv(createSurveyPointsCsv(points));
  assert.deepEqual(roundTrip.map((point) => [point.name, point.point]), payload.points.map((point) => [point.name, point.point]));
});

test("podobné i duplicitní názvy nevytvoří duplicitní interní kódy", async () => {
  const { file, blob } = await source('bod,X,Y,Z\nA a,1,2,3\nA_a,4,5,6\nA a,7,8,9');
  const objects = stakeoutObjectsFromProposal(await extractStakeoutProposal(file, blob, () => {}), file);
  assert.equal(new Set(objects.map((point) => point.properties.code)).size, 3);
});

test("import odmítne poškozené metadata, příliš velké CSV a neplatné UTF-8", async () => {
  const { file, blob } = await source();
  await assert.rejects(extractStakeoutProposal({ ...file, sha256: "0".repeat(64) }, blob, () => {}), /součet/);
  await assert.rejects(extractStakeoutProposal({ ...file, size: 1 }, blob, () => {}), /Velikost/);
  await assert.rejects(extractStakeoutProposal(file, new Blob([new Uint8Array(MAX_STAKEOUT_CSV_BYTES + 1)]), () => {}), /4 MB/);
  const invalid = new Blob([new Uint8Array([0xff, 0xfe])]);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await invalid.arrayBuffer()));
  await assert.rejects(extractStakeoutProposal({ ...file, size: 2, sha256: [...hash].map((n) => n.toString(16).padStart(2, "0")).join("") }, invalid, () => {}), /UTF-8/);
});

test("CSV původ nerozvolní pravidla automaticky odvozených a ručních bodů", async () => {
  const { file, blob } = await source();
  const [point] = stakeoutObjectsFromProposal(await extractStakeoutProposal(file, blob, () => {}), file);
  const automatic = structuredClone(point!);
  automatic.provenance.source_kind = "automatic";
  assert.equal(isContract("model_object", automatic), false);
  const manual = structuredClone(point!);
  manual.properties.derivation = { kind: "manual" };
  assert.equal(isContract("model_object", manual), false);
  const surveyed = structuredClone(point!);
  surveyed.properties.accuracy.method = "surveyed";
  assert.equal(isContract("model_object", surveyed), false);
});
