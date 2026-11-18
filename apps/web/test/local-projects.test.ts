import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { demoBuildingObjects, demoCivilObjects, demoRoom, demoStakeoutObjects } from "../src/demo-model.ts";
import {
  LOCAL_PROJECTS_KEY,
  createLocalProject,
  createProjectArchive,
  localProjectIdFromLocation,
  readLocalProjects,
  safeProjectArchiveName,
  updateLocalProject,
  workspaceProjectIdFromLocation,
  writeLocalProjects,
} from "../src/local-projects.ts";
import { createProjectFileMetadata, projectFileRole, validateProjectFile } from "../src/project-files.ts";
import { stakeoutObjectsFromProposal } from "../src/processing-api.ts";
import { createCivilMaterialAssemblyFromSurface, createCivilTinSurfaceFromPoints } from "@datamine/modules";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    raw: values,
  };
};

test("lokální projekt zachová geometrii, pořadí i hloubky skladby po uložení a načtení", () => {
  const points = [[0, 0, 250], [10, 0, 251], [0, 4, 250]].map((xyz, i) => {
    const p = structuredClone(demoCivilObjects[2]); p.id = `object_assembly_point_${i}`; p.geometry.point = xyz as [number, number, number]; return p;
  });
  const base = { sourceDocumentId: points[0]!.provenance.source_document_id, sourceDocumentSha256: points[0]!.provenance.source_document_sha256 };
  const surface = createCivilTinSurfaceFromPoints(points, { ...base, objectId: "object_assembly_tin", layerId: "layer_assembly_tin", name: "Horní povrch" });
  const layers = createCivilMaterialAssemblyFromSurface(surface, "assembly_saved", [0.04, 0.06, 0.2].map((thicknessM, i) => ({
    ...base, objectId: `object_saved_layer_${i}`, layerId: `layer_saved_${i}`, name: `Vrstva ${i}`, materialCode: `M_${i}`, thicknessM,
  })));
  const project = createLocalProject("Skladba", "civil", [surface, ...layers]);
  const storage = memoryStorage(); writeLocalProjects(storage, [project]);
  const restored = readLocalProjects(storage)[0]!;
  assert.deepEqual(restored.objects, project.objects);
  assert.ok(new TextDecoder().decode(createProjectArchive(restored)).includes("assembly_saved"));
});

test("lokální katalog vytvoří, uloží, archivuje a znovu načte typovaný projekt", () => {
  const storage = memoryStorage();
  const project = createLocalProject(
    "Administrativní budova",
    "building",
    [demoRoom, ...demoBuildingObjects],
    new Date("2026-08-31T12:00:00Z"),
    "01234567-89ab-cdef-0123-456789abcdef",
  );
  writeLocalProjects(storage, [project]);
  assert.equal(storage.raw.has(LOCAL_PROJECTS_KEY), true);
  assert.equal(readLocalProjects(storage)[0]?.name, "Administrativní budova");
  const archived = updateLocalProject(project, { status: "archived" }, new Date("2026-08-31T13:00:00Z"));
  assert.equal(archived.status, "archived");
  assert.equal(archived.objects.length, project.objects.length);
});

test("poškozený, nadlimitní nebo nevalidní katalog se fail-closed nenačte", () => {
  const storage = memoryStorage();
  storage.setItem(LOCAL_PROJECTS_KEY, "{broken");
  assert.deepEqual(readLocalProjects(storage), []);
  storage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify([{ schema_version: "datamine.local-project.v1" }]));
  assert.deepEqual(readLocalProjects(storage), []);
  assert.throws(() => createLocalProject("", "civil", []), /Název/);
});

test("ZIP export obsahuje dva bezpečné store entries a stabilní název", () => {
  const project = createLocalProject(
    "Opěrná stěna Bečov",
    "building",
    [demoRoom, ...demoBuildingObjects],
    new Date("2026-08-31T12:00:00Z"),
    "01234567-89ab-cdef-0123-456789abcdef",
  );
  const archive = createProjectArchive(project);
  const decoded = new TextDecoder().decode(archive);
  assert.equal(archive[0], 0x50);
  assert.equal(archive[1], 0x4b);
  assert.equal(decoded.includes("project.json"), true);
  assert.equal(decoded.includes("model.json"), true);
  assert.equal(safeProjectArchiveName(project), "Operna-stena-Becov.datamine.zip");
});

test("localProject route přijme jen přesně omezené technické ID", () => {
  assert.equal(localProjectIdFromLocation({ search: "?localProject=project_local_01234567" } as Location), "project_local_01234567");
  assert.equal(localProjectIdFromLocation({ search: "?localProject=../../etc" } as Location), null);
});

test("starý lokální katalog se migruje na prázdný seznam souborů", () => {
  const storage = memoryStorage();
  const project = createLocalProject("Migrace", "civil", [], new Date("2026-08-31T12:00:00Z"), "01234567-89ab-cdef-0123-456789abcdef");
  const { files: _files, ...legacy } = project;
  storage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify([legacy]));
  assert.deepEqual(readLocalProjects(storage)[0]?.files, []);
});

test("migrace odstraní pouze známé ukázkové objekty a zachová skutečná data", () => {
  const storage = memoryStorage();
  const actual = structuredClone(demoStakeoutObjects[0]);
  actual.id = "object_stakeout_actual_001";
  const project = createLocalProject(
    "Projekt po ukázce",
    "civil",
    [...demoCivilObjects, ...demoStakeoutObjects, actual],
    new Date("2026-08-31T12:00:00Z"),
    "01234567-89ab-cdef-0123-456789abcdef",
  );
  storage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify([project]));
  assert.deepEqual(readLocalProjects(storage)[0]?.objects.map((object) => object.id), ["object_stakeout_actual_001"]);
});

test("migrace rozdělí starou obecnou vrstvu podle zachovaného názvu bodu", () => {
  const storage = memoryStorage();
  const file = { id: "file_local_12345678", name: "body.pdf", size: 100, media_type: "application/pdf", role: "data", sha256: "a".repeat(64), created_at: "2026-09-01T00:00:00Z" } as const;
  const [point] = stakeoutObjectsFromProposal({ schema_version: "datamine.stakeout-import.v1", document_id: "document_import", source_document_sha256: file.sha256, source_job_id: "job_stakeout_legacy_mp_001", algorithm_version: "stakeout-pdf-import-v1", points: [{ code: "MP1-1", name: "MP1-1 vnitřní řada", point: [1, 2, 3], kind: "Importované body", page: 1, row: 1 }] }, file);
  const legacy = structuredClone(point) as any;
  legacy.id = "object_stakeout_legacy_mp_001";
  legacy.layer_id = "layer_stakeout_import";
  legacy.properties.derivation.source_layer = "Importované body";
  const project = createLocalProject("Starý import", "civil", [legacy], new Date("2026-08-31T12:00:00Z"), "01234567-89ab-cdef-0123-456789abcdef");
  storage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify([project]));
  const [migrated] = readLocalProjects(storage)[0]!.objects as any[];
  assert.equal(migrated.properties.derivation.source_layer, "Mikropiloty – vnitřní řada");
  assert.match(migrated.layer_id, /^layer_extracted_Mikropiloty/);
});

test("migrace rozdělí staré body vozovky do konstrukčních vrstev", () => {
  const storage = memoryStorage();
  const file = { id: "file_local_12345678", name: "vozovka.pdf", size: 100, media_type: "application/pdf", role: "data", sha256: "a".repeat(64), created_at: "2026-09-01T00:00:00Z" } as const;
  const source = [
    { code: "P1", name: "km 107,16000 levý okraj ACO", point: [1, 2, 3] as const, kind: "Importované body", page: 1, row: 1 },
    { code: "P2", name: "km 107,16000 osa ŠD 150", point: [2, 3, 4] as const, kind: "Importované body", page: 1, row: 1 },
    { code: "P3", name: "km 107,16000 pravý okraj ŠD", point: [3, 4, 5] as const, kind: "Importované body", page: 1, row: 1 },
    { code: "P4", name: "km 107,16000 pravý okraj zemní pláň", point: [4, 5, 6] as const, kind: "Importované body", page: 1, row: 1 },
  ];
  const legacyPoints = stakeoutObjectsFromProposal({ schema_version: "datamine.stakeout-import.v1", document_id: "document_import", source_document_sha256: file.sha256, source_job_id: "job_stakeout_legacy_road_001", algorithm_version: "stakeout-pdf-import-v1", points: source }, file)
    .map((point) => ({ ...point, layer_id: "layer_stakeout_import", properties: { ...point.properties, derivation: { ...point.properties.derivation, source_layer: "Importované body" } } }));
  const project = createLocalProject("Starší vozovka", "civil", legacyPoints, new Date("2026-08-31T12:00:00Z"), "01234567-89ab-cdef-0123-456789abcdef");
  storage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify([project]));
  const groups = (readLocalProjects(storage)[0]!.objects as any[]).map((point) => point.properties.derivation.source_layer);
  assert.deepEqual(groups, ["Vozovka – ACO (40 mm)", "Vozovka – ŠD (150 mm)", "Vozovka – ŠD", "Vozovka – zemní pláň"]);
});

test("projektové soubory mají whitelist, limity a SHA-256 metadata", async () => {
  const pdf = new File([new Uint8Array([1, 2, 3, 4])], "Půdorys 1.NP.pdf", { type: "application/pdf" });
  validateProjectFile(pdf, 0);
  const metadata = await createProjectFileMetadata(pdf, projectFileRole(pdf.name), 0);
  assert.equal(metadata.role, "drawing");
  assert.equal(metadata.size, 4);
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => validateProjectFile(new File(["x"], "payload.html", { type: "text/html" }), 0), /podporován/);
  assert.throws(() => validateProjectFile({ name: "../plan.pdf", size: 10, type: "application/pdf" }, 0), /bezpečný/);
});

test("úplný ZIP obsahuje bezpečně pojmenovaný projektový soubor", async () => {
  const base = createLocalProject("Projekt se souborem", "civil", [], new Date("2026-08-31T12:00:00Z"), "01234567-89ab-cdef-0123-456789abcdef");
  const metadata = await createProjectFileMetadata(new File(["DATA"], "Zaměření Žďár.xml", { type: "application/xml" }), "data", 0);
  const project = updateLocalProject(base, { files: [metadata] });
  const archive = createProjectArchive(project, [{ path: `files/${metadata.id.slice(-12)}-Zamereni-Zdar.xml`, content: new TextEncoder().encode("DATA") }]);
  const decoded = new TextDecoder().decode(archive);
  assert.equal(decoded.includes("files/"), true);
  assert.equal(decoded.includes("Zamereni-Zdar.xml"), true);
  assert.throws(() => createProjectArchive(project, [{ path: "../escape.xml", content: new Uint8Array() }]), /nebezpečnou/);
});

test("workspace route přijme jen omezené technické ID", () => {
  assert.equal(workspaceProjectIdFromLocation({ search: "?workspace=project_local_01234567" } as Location), "project_local_01234567");
  assert.equal(workspaceProjectIdFromLocation({ search: "?workspace=javascript:alert(1)" } as Location), null);
});

test("vytěžený návrh vytvoří typované neověřené body s úplnou proveniencí", async () => {
  const file = await createProjectFileMetadata(new File(["%PDF-test"], "vytyceni.pdf", { type: "application/pdf" }), "drawing", 0);
  const payload = {
    schema_version: "datamine.stakeout-import.v1" as const,
    document_id: "document_stakeout_import",
    source_document_sha256: file.sha256,
    source_job_id: "job_stakeout_import",
    algorithm_version: "stakeout-pdf-import-v1" as const,
    points: [{ code: "S1", name: "Bod S1", point: [-745123.45, -1043210.98, 312.45] as const, kind: "kanalizace", page: 1, row: 2 }],
  };
  const [point] = stakeoutObjectsFromProposal(payload, file, 5514, "Bpv");
  assert.equal(point?.type, "stakeout.point");
  assert.equal(point?.properties.review_state, "unreviewed");
  assert.equal(point?.properties.crs.epsg, 5514);
  assert.equal(point?.provenance.source_document_sha256, file.sha256);
  assert.equal(point?.provenance.algorithm_version, "stakeout-pdf-import-v1");
});

test("uložení a opakované načtení zachová ručně sloučenou vrstvu importovaných bodů", () => {
  const storage = memoryStorage();
  const file = { id: "file_local_12345678", name: "body.pdf", size: 100, media_type: "application/pdf", role: "data", sha256: "a".repeat(64), created_at: "2026-09-01T00:00:00Z" } as const;
  const points = stakeoutObjectsFromProposal({ schema_version: "datamine.stakeout-import.v1", document_id: "document_import", source_document_sha256: file.sha256, source_job_id: "job_stakeout_merged_001", algorithm_version: "stakeout-pdf-import-v1", points: [{ code: "P1", name: "0-1 horní hrana", point: [1, 2, 3], kind: "wall_top", page: 1, row: 1 }] }, file);
  const edited = points.map((point) => ({ ...point, layer_id: "layer_Nova_vrstva_bodu", properties: { ...point.properties, derivation: { ...point.properties.derivation, source_layer: "Nová vrstva bodů" } } }));
  const project = createLocalProject("Sloučená vrstva", "civil", edited, new Date("2026-09-06T12:00:00Z"), "01234567-89ab-cdef-0123-456789abcdef");
  storage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify([project]));
  const loaded = readLocalProjects(storage)[0]!;
  assert.deepEqual(loaded.objects, edited);
  storage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify([loaded]));
  assert.deepEqual(readLocalProjects(storage)[0]!.objects, edited);
});

test("mapa přežije místní uložení, archivaci i ZIP export včetně skrytí", () => {
  const map_context = JSON.parse(readFileSync(new URL("../../../fixtures/civil-map-context.json", import.meta.url), "utf8"));
  map_context.visible = false;
  const project = { ...createLocalProject("Uložená mapa", "civil", []), map_context };
  const storage = memoryStorage();
  writeLocalProjects(storage, [project]);
  const restored = readLocalProjects(storage)[0]!;
  assert.deepEqual(restored.map_context, map_context);
  const archived = updateLocalProject(restored, { status: "archived" });
  assert.deepEqual(archived.map_context, map_context);
  assert.ok(new TextDecoder().decode(createProjectArchive(archived)).includes(map_context.image_data_url));
});

test("připnutá situace se uloží s mapou, archivuje a zahrne do ZIP", () => {
  const drawing_underlay = JSON.parse(readFileSync(new URL("../../../fixtures/drawing-underlay.json", import.meta.url), "utf8"));
  const map_context = JSON.parse(readFileSync(new URL("../../../fixtures/civil-map-context.json", import.meta.url), "utf8"));
  const storage = memoryStorage();
  const project = { ...createLocalProject("Připnutá situace", "civil", []), drawing_underlay, map_context };
  writeLocalProjects(storage, [project]);
  const restored = readLocalProjects(storage)[0]!;
  assert.deepEqual(restored.drawing_underlay, drawing_underlay);
  assert.deepEqual(restored.map_context, map_context);
  const archived = updateLocalProject(restored, { status: "archived" });
  assert.deepEqual(archived.drawing_underlay, drawing_underlay);
  assert.ok(new TextDecoder().decode(createProjectArchive(archived)).includes('"control_points"'));
});
