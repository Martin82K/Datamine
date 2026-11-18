import assert from "node:assert/strict";
import test from "node:test";
import { createLocalProject, LOCAL_PROJECTS_KEY, writeLocalProjects } from "../src/local-projects.ts";
import { initializeProjectApi, saveServerProject, isServerProject, usesServerStorage, uploadServerFile, ProjectApiError } from "../src/project-api.ts";
import { completeProject, migrateProject, saveProject } from "../src/project-repository.ts";
import { applyProjectViewSettings, captureProjectViewSettings } from "../src/layer-colors.ts";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("serverové projekty: revize, úplný model při archivaci a bezpečný převod kopie", async (t) => {
  const storage = memoryStorage();
  t.mock.method(globalThis, "fetch", async () => json({ storage: "server" }));
  Object.defineProperty(globalThis, "window", { value: { localStorage: storage, location: { hostname: "datamine.example.invalid", search: "" } }, configurable: true });
  const project = { ...createLocalProject("Existující projekt", "civil", []), view_settings: { triangulation: true } };
  let current = project;
  let revision = 1;
  let rejectSave = false;
  const requests: { path: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit = {}) => {
    requests.push({ path, init });
    if (path.endsWith("/status")) return json({ storage: "server" });
    if (path.endsWith("/projects")) return json({ items: [{ project: { ...project, view_settings: undefined }, revision }] });
    if (init.method === "PUT") {
      if (rejectSave) return json({ message: "Konflikt revize" }, 409);
      current = JSON.parse(init.body as string);
      revision += 1;
    }
    return json({ project: current, revision });
  });
  await initializeProjectApi();
  assert.equal(usesServerStorage(), true);
  assert.equal(isServerProject(project.id), true);
  const full = await completeProject({ ...project, view_settings: undefined, server_revision: 1 });
  const archived = await saveProject({ ...full, status: "archived" });
  assert.equal(archived.view_settings?.triangulation, true, "archivace nesmí nahradit serverové preference prázdným lokálním úložištěm");
  const put = requests.find((item) => item.init.method === "PUT")!;
  assert.equal((put.init.headers as Record<string, string>)["If-Match"], '"1"');
  assert.equal("server_revision" in JSON.parse(put.init.body as string), false);
  rejectSave = true;
  await assert.rejects(saveServerProject(archived), (error: unknown) => error instanceof ProjectApiError && error.status === 409);
  rejectSave = false;
  writeLocalProjects(storage, [project]);
  const original = storage.getItem(LOCAL_PROJECTS_KEY);
  const migrated = await migrateProject(project, () => {});
  assert.notEqual(migrated.id, project.id);
  assert.match(migrated.name, /místní kopie/);
  assert.equal(storage.getItem(LOCAL_PROJECTS_KEY), original);
});

test("blokový upload čeká na potvrzení kontrolního součtu", async (t) => {
  const blob = new Blob([new Uint8Array(4 * 1024 * 1024 + 3)]);
  const metadata = { id: "file_local_12345678", name: "data.ifc", size: blob.size, sha256: "a".repeat(64), media_type: "application/octet-stream", role: "other" as const, created_at: new Date().toISOString() };
  const sizes: number[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
    if (path.endsWith("/files")) return json({ ready: false, chunk_bytes: 4 * 1024 * 1024 });
    if (path.includes("/chunks/")) { sizes.push((init.body as Blob).size); return new Response(null, { status: 204 }); }
    return json({ size: metadata.size, sha256: "b".repeat(64) });
  });
  await assert.rejects(uploadServerFile("project_local_12345678", metadata, blob), /úplnost/);
  assert.deepEqual(sizes, [4 * 1024 * 1024, 3]);
});

test("chyba serveru nesmí přepnout veřejnou aplikaci na místní ukládání", async (t) => {
  Object.defineProperty(globalThis, "window", { value: { location: { hostname: "datamine.example.invalid" } }, configurable: true });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(initializeProjectApi(), /Server není dostupný/);
  t.mock.method(globalThis, "fetch", async () => json({}, 404));
  await assert.rejects(initializeProjectApi(), (error: unknown) => error instanceof ProjectApiError && error.status === 404);
});

test("nastavení zobrazení se přenáší kompletně a nepoškodí další projekt", () => {
  const storage = memoryStorage();
  applyProjectViewSettings(storage, "project_local_other123", { triangulation: true });
  const settings = { names: { layer_points: "Osa" }, colors: { layer_points: "#abcdef" }, opacities: { layer_points: 0.3 }, hidden: ["layer_hidden"], triangulation: true };
  applyProjectViewSettings(storage, "project_local_12345678", settings);
  assert.deepEqual(captureProjectViewSettings(storage, "project_local_12345678"), settings);
  applyProjectViewSettings(storage, "project_local_12345678", {});
  assert.equal(captureProjectViewSettings(storage, "project_local_other123").triangulation, true);
  assert.equal(captureProjectViewSettings(storage, "project_local_12345678").triangulation, false);
});

test("lokální režim vynechá požadavky na server a vyčistí jeho stav", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (url: string) =>
    url.endsWith("/status") ? json({ storage: "server" }) : json({ items: [] })
  );
  await initializeProjectApi();
  assert.equal(usesServerStorage(), true);
  assert.equal(fetchMock.mock.callCount(), 2);

  await initializeProjectApi(true);
  assert.equal(usesServerStorage(), false);
  assert.equal(fetchMock.mock.callCount(), 2);
});
