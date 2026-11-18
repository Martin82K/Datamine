import assert from "node:assert/strict";
import test from "node:test";
import { demoBuildingObjects, demoCivilObjects, demoRoom, demoStakeoutObjects } from "../src/demo-model.ts";
import {
  inferProjectType,
  modelMatchesProjectType,
  objectBelongsToProjectType,
  projectTypeFromLocation,
} from "../src/project-context.ts";

test("project type route accepts only supported domains", () => {
  assert.equal(projectTypeFromLocation({ search: "?projectType=civil" } as Location), "civil");
  assert.equal(projectTypeFromLocation({ search: "?projectType=building" } as Location), "building");
  assert.equal(projectTypeFromLocation({ search: "?projectType=unknown" } as Location), "building");
});

test("building and civil editors receive disjoint domain objects", () => {
  const objects = [demoRoom, ...demoBuildingObjects, ...demoCivilObjects, ...demoStakeoutObjects];
  const buildingObjects = objects.filter((object) => objectBelongsToProjectType(object, "building"));
  const civilObjects = objects.filter((object) => objectBelongsToProjectType(object, "civil"));

  assert.ok(buildingObjects.every((object) => object.type === "rooms.room" || object.type.startsWith("building.")));
  assert.ok(civilObjects.every((object) => object.type.startsWith("civil.") || object.type.startsWith("stakeout.")));
  const civilIds = new Set(civilObjects.map((object) => object.id));
  assert.ok(buildingObjects.every((object) => !civilIds.has(object.id)));
});

test("project type is inferred from a server model without mixing editors", () => {
  assert.equal(inferProjectType([demoRoom, ...demoBuildingObjects], "civil"), "building");
  assert.equal(inferProjectType([...demoCivilObjects, ...demoStakeoutObjects], "building"), "civil");
  assert.equal(inferProjectType([], "civil"), "civil");
});

test("a mixed server model is rejected instead of being hidden by the UI", () => {
  assert.equal(modelMatchesProjectType([demoRoom, ...demoBuildingObjects], "building"), true);
  assert.equal(modelMatchesProjectType([...demoCivilObjects, ...demoStakeoutObjects], "civil"), true);
  assert.equal(modelMatchesProjectType([demoRoom, ...demoCivilObjects], "building"), false);
  assert.equal(modelMatchesProjectType([demoRoom, ...demoCivilObjects], "civil"), false);
});
