import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APP_THEME_KEY, applyAppTheme, nextAppTheme, readAppTheme, writeAppTheme } from "../src/app-theme.ts";
import { formatWelcomeDate, formatWelcomeTime } from "../src/welcome-format.ts";
import { WORKSPACE_SECTION_LABELS, adjacentWorkspaceSection, workspaceSectionMessage } from "../src/workspace-section.ts";
import { DATAMINE_HOME_PATH } from "../src/app-navigation.ts";

test("motiv je omezený na tři bezpečné hodnoty a zapisuje se na kořen", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  const root = { dataset: {} as DOMStringMap };
  assert.equal(readAppTheme(storage), "system");
  writeAppTheme(storage, root, "light");
  assert.equal(values.get(APP_THEME_KEY), "light");
  assert.equal(root.dataset.datamineTheme, "light");
  values.set(APP_THEME_KEY, "url(javascript:alert(1))");
  assert.equal(readAppTheme(storage), "system");
  applyAppTheme(root, "dark");
  assert.equal(root.dataset.datamineTheme, "dark");
});

test("jednotný přepínač motivu střídá světlý a tmavý stav", () => {
  assert.equal(nextAppTheme("light", false), "dark");
  assert.equal(nextAppTheme("dark", true), "light");
  assert.equal(nextAppTheme("system", true), "dark");
  assert.equal(nextAppTheme("system", false), "light");
});

test("uvítací datum a čas používají český formát bez sekund", () => {
  const date = new Date(2026, 8, 1, 21, 35, 42);
  assert.equal(formatWelcomeDate(date), "úterý 1. září 2026");
  assert.equal(formatWelcomeTime(date), "21:35");
});

test("přepnutí sekce workspace vrací jednoznačnou stavovou zprávu", () => {
  assert.deepEqual(Object.keys(WORKSPACE_SECTION_LABELS), ["files", "data", "model"]);
  assert.equal(workspaceSectionMessage("files"), "Zobrazena sekce Soubory.");
  assert.equal(workspaceSectionMessage("data"), "Zobrazena sekce Vytěžená data.");
  assert.equal(workspaceSectionMessage("model"), "Zobrazena sekce Model.");
  assert.equal(adjacentWorkspaceSection("files", -1), "model");
  assert.equal(adjacentWorkspaceSection("files", 1), "data");
  assert.equal(adjacentWorkspaceSection("model", 1), "files");
});

test("značka Datamine vždy odkazuje na úvodní obrazovku", () => {
  assert.equal(DATAMINE_HOME_PATH, "/");
});

test("projektový workspace používá pro navigaci a stav společné tokeny motivu", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.v2-project-workspace__topbar\s*\{[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.v2-workspace-tabs\s*\{[^}]*background:\s*var\(--v2-toolbar-bg\);/s);
  assert.match(styles, /\.v2-workspace-status\s*\{[^}]*background:\s*var\(--v2-toolbar-bg\);/s);
});

test("souhrn projektu je jeden zaoblený tematický celek", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.v2-project-overview\s*\{[^}]*overflow:\s*hidden;[^}]*border:\s*1px solid var\(--dm-color-border\);[^}]*border-radius:\s*14px;/s);
  assert.doesNotMatch(styles, /\.v2-project-overview\s*\{[^}]*border-bottom:/s);
});

test("datové, modelové a 3D plochy používají tokeny pro oba motivy", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const requiredRules = [
    /\.v2-workspace\s*\{[^}]*background:\s*var\(--v2-canvas-bg\);/s,
    /\.v2-editor-data\s*\{[^}]*var\(--v2-canvas-bg\)/s,
    /\.v2-data-layout\s*\{[^}]*background:\s*var\(--v2-panel-soft\);/s,
    /\.v2-data-sources\s*\{[^}]*background:\s*var\(--v2-panel-bg\);/s,
    /\.v2-model-workspace__intro\s*\{[^}]*background:\s*var\(--v2-panel-emphasis\);/s,
    /\.v2-model-metrics\s*>\s*div\s*\{[^}]*background:\s*var\(--v2-panel-soft\);/s,
    /\.v2-view-controls\s*\{[^}]*background:\s*var\(--v2-floating-bg\);/s,
    /\.v2-view-control\s*\{[^}]*background:\s*var\(--v2-control-bg\);/s,
  ];
  for (const rule of requiredRules) assert.match(styles, rule);
  assert.equal(styles.match(/\.v2-view-controls\s*\{/g)?.length, 1, "3D legenda nesmí mít duplicitní dark-only přepis");
  assert.equal(styles.match(/\.v2-view-control\s*\{/g)?.length, 1, "3D tlačítka nesmí mít duplicitní dark-only přepis");
  assert.doesNotMatch(styles, /3D pracovní plocha zůstává záměrně tmavá/);
  for (const token of ["--v2-panel-emphasis", "--v2-table-head-bg", "--v2-floating-bg", "--v2-control-bg"]) {
    assert.equal(styles.match(new RegExp(`${token}:`, "g"))?.length, 3, `${token} musí mít tmavou, světlou a systémovou hodnotu`);
  }
});

test("jeden ThemeToggle je zapojený také do workspace a editoru", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../src/ProjectWorkspace.tsx", import.meta.url), "utf8");
  assert.match(app, /<ProjectWorkspace theme=\{theme\} onThemeChange=\{setTheme\}/);
  assert.match(app, /<EditorApp theme=\{theme\} onThemeChange=\{setTheme\}/);
  assert.match(app, /<ThemeToggle value=\{theme\} onChange=\{onThemeChange\}/);
  assert.match(workspace, /<ThemeToggle value=\{theme\} onChange=\{onThemeChange\}/);
});

test("WebGL renderer ponechává pozadí na společném CSS motivu", async () => {
  const renderer = await readFile(new URL("../../../packages/renderer/src/index.ts", import.meta.url), "utf8");
  assert.match(renderer, /setClearColor\(0x000000, 0\)/);
  assert.match(renderer, /#scene\.background = null;/);
  assert.doesNotMatch(renderer, /#opaqueBackground/);
});
