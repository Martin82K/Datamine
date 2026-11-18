import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EditorStore,
  HistoryError,
  InvalidCommandError,
  ModuleRegistry,
  RevisionConflictError,
  updateRoomVertex,
} from "../dist/index.js";

const foundation = JSON.parse(await readFile(
  new URL("../../../fixtures/contracts/v1/valid-foundation.json", import.meta.url),
  "utf8",
));
const room = foundation.model_version.objects[0];

test("příkaz, výběr, undo a redo zachovají deterministický model", () => {
  const store = new EditorStore();

  store.execute({ id: "cmd_add", type: "object.upsert", baseRevision: 0, object: room });
  store.execute({
    id: "cmd_select",
    type: "selection.set",
    baseRevision: 1,
    objectIds: [room.id],
  });
  assert.deepEqual(store.snapshot.selection, [room.id]);

  const undone = store.undo();
  assert.deepEqual(undone.selection, []);
  assert.equal(undone.revision, 3);

  const redone = store.redo();
  assert.deepEqual(redone.selection, [room.id]);
  assert.equal(redone.revision, 4);
});

test("zastaralá revize nezmění stav", () => {
  const store = new EditorStore([room]);
  const before = store.snapshot;

  assert.throws(() => store.execute({
    id: "cmd_stale",
    type: "selection.set",
    baseRevision: 1,
    objectIds: [room.id],
  }), RevisionConflictError);
  assert.deepEqual(store.snapshot, before);
});

test("neznámý výběr a prázdná historie jsou explicitní chyby", () => {
  const store = new EditorStore([room]);
  assert.throws(() => store.execute({
    id: "cmd_unknown",
    type: "selection.set",
    baseRevision: 0,
    objectIds: ["object_missing"],
  }), InvalidCommandError);
  assert.throws(() => store.undo(), HistoryError);
});

test("transientní výběr nemění revizi ani undo historii", () => {
  const store = new EditorStore([room]);
  const selected = store.setSelection([room.id]);

  assert.equal(selected.revision, 0);
  assert.deepEqual(selected.selection, [room.id]);
  assert.equal(store.canUndo, false);
  assert.throws(() => store.setSelection(["object_missing"]), InvalidCommandError);
});

test("atomická dávka je jeden krok historie a limit zachová posledních 15 kroků", () => {
  const first = structuredClone(room);
  first.id = "object_room_batch_01";
  const second = structuredClone(room);
  second.id = "object_room_batch_02";
  const store = new EditorStore([], 15);
  store.executeBatch([
    { id: "cmd_batch_01", type: "object.upsert", baseRevision: 0, object: first },
    { id: "cmd_batch_02", type: "object.upsert", baseRevision: 0, object: second },
  ]);
  assert.equal(store.snapshot.objects.length, 2);
  assert.equal(store.snapshot.revision, 1);
  assert.equal(store.undo().objects.length, 0);
  store.redo();
  for (let index = 0; index < 16; index += 1) {
    const updated = structuredClone(first);
    updated.properties.name = `Změna ${index}`;
    store.execute({ id: `cmd_limit_${index}`, type: "object.upsert", baseRevision: store.snapshot.revision, object: updated });
  }
  for (let index = 0; index < 15; index += 1) store.undo();
  assert.throws(() => store.undo(), HistoryError);
});

test("editace vrcholu přepočítá geometrii a označí ruční korekci", () => {
  const updated = updateRoomVertex(room, 1, [6, 0]);

  assert.deepEqual(updated.geometry.rings[0][1], [6, 0]);
  assert.ok(Math.abs(updated.properties.geometric_area_m2 - 15.81) <= 1e-9);
  assert.ok(Math.abs(updated.properties.perimeter_m - 16.8846896658) <= 1e-9);
  assert.equal(updated.properties.shape_source, "manual");
  assert.equal(updated.properties.review_state, "corrected");
  assert.throws(() => updateRoomVertex(room, 99, [0, 0]), InvalidCommandError);
  assert.deepEqual(room, foundation.model_version.objects[0]);
});

test("statický registr odmítne dva vlastníky stejného typu", () => {
  const registry = new ModuleRegistry();
  registry.register({
    id: "rooms",
    version: "1.0.0",
    objectTypes: ["rooms.room"],
    commandTypes: ["rooms.rename"],
  });

  assert.equal(registry.ownerOf("rooms.room"), "rooms");
  assert.throws(() => registry.register({
    id: "other",
    version: "1.0.0",
    objectTypes: ["rooms.room"],
    commandTypes: [],
  }));
});
