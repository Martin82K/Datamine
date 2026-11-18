import assert from "node:assert/strict";
import test from "node:test";
import { createSectionPlan } from "../src/civil-section-plan.ts";
import { demoCivilObjects } from "../src/demo-model.ts";

test("půdorys zachová XY orientaci, jednotné měřítko a prohození A/B i při velkých souřadnicích", () => {
  for (const [x, y] of [[0, 0], [-700000, -1000000]]) {
    const a = [x!, y!] as const, b = [x! + 6, y! + 2] as const;
    const plan = createSectionPlan([], a, b)!;
    assert.ok(plan.a[0] < plan.b[0]); assert.ok(plan.a[1] > plan.b[1]);
    assert.ok(Math.abs((plan.b[0] - plan.a[0]) / (plan.a[1] - plan.b[1]) - 3) < 1e-9);
    const reverse = createSectionPlan([], b, a)!;
    assert.deepEqual(reverse.a, plan.b); assert.deepEqual(reverse.b, plan.a);
  }
});

test("půdorys zahrne celý model do rozsahu, ale omezí počet SVG bodů", () => {
  const points = Array.from({ length: 4001 }, (_, i) => {
    const p = structuredClone(demoCivilObjects[2]); p.geometry.point = [i, i, 250]; return p;
  });
  const plan = createSectionPlan(points, [0, 0], [1, 0])!;
  assert.ok(plan.points.length <= 2000);
  for (const point of plan.points) {
    assert.ok(point.xy[0] >= 32 && point.xy[0] <= 308);
    assert.ok(point.xy[1] >= 22 && point.xy[1] <= 168);
  }
  assert.equal(createSectionPlan([], [NaN, 0], [1, 0]), null);
  assert.equal(createSectionPlan(Array(100001).fill(points[0]), [0, 0], [1, 0]), null);
});

test("detail krátkého řezu zůstane čitelný i v dlouhém modelu a ořízne vzdálený kontext", () => {
  const distant = structuredClone(demoCivilObjects[2]); distant.geometry.point = [0, 10000, 250];
  const nearby = structuredClone(distant); nearby.geometry.point = [2, 1, 250];
  const overview = createSectionPlan([distant, nearby], [0, 0], [5, 0])!;
  const detail = createSectionPlan([distant, nearby], [0, 0], [5, 0], true)!;
  assert.ok(overview.b[0] - overview.a[0] < 1);
  assert.ok(detail.b[0] - detail.a[0] > 100);
  assert.equal(detail.points.length, 1);
  const reverse = createSectionPlan([distant, nearby], [5, 0], [0, 0], true)!;
  assert.deepEqual(reverse.a, detail.b); assert.deepEqual(reverse.b, detail.a);
});
