import assert from "node:assert/strict";
import test from "node:test";
import { stakeoutObjectsFromProposal, type StakeoutImportPayload } from "../src/processing-api.ts";
import type { LocalProjectFile } from "../src/local-projects.ts";

test("desktopové PDF vytvoří platný import s původem v PDF bez serverové úlohy", () => {
  const file: LocalProjectFile = {
    id: "file_local_12345678901234567890123456789012",
    name: "synthetic.pdf",
    media_type: "application/pdf",
    role: "drawing",
    sha256: "a".repeat(64),
    size: 100,
    created_at: "2026-01-01T00:00:00Z",
  };
  const payload: StakeoutImportPayload = {
    schema_version: "datamine.stakeout-import.v1",
    document_id: "document_synthetic",
    source_document_sha256: file.sha256,
    algorithm_version: "stakeout-desktop-pdf-v1",
    points: [{ code: "P01", name: "P01", point: [1000.125, 2000.25, 95.125], kind: "Vytyčovací body", page: 1, row: 4 }],
  };
  const [point] = stakeoutObjectsFromProposal(payload, file);
  assert.deepEqual(point?.geometry.point, [1000.125, 2000.25, 95.125]);
  assert.deepEqual(point?.provenance, {
    source_document_id: payload.document_id,
    source_document_sha256: file.sha256,
    source_kind: "imported",
    algorithm_version: "stakeout-desktop-pdf-v1",
  });
  assert.equal(point?.properties.derivation.kind, "document_import");
});
