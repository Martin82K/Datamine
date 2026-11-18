import type { ModelObject } from "@datamine/contracts";

type XY = readonly [number, number];
export interface SectionPlan {
  readonly a: XY;
  readonly b: XY;
  readonly points: readonly { readonly xy: XY; readonly layerId: string }[];
}

/** A bounded plan preview in survey XY: +X right, +Y up, equal scale on both axes. */
export function createSectionPlan(objects: readonly ModelObject[], a: XY, b: XY, focusOnCut = false): SectionPlan | null {
  const points: { xy: XY; layerId: string }[] = [];
  let minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
  let minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
  if (![...a, ...b].every(Number.isFinite)) return null;
  for (const object of objects) {
    const vertices = object.type === "civil.point" || object.type === "stakeout.point" ? [object.geometry.point]
      : object.type === "civil.tin_surface" || object.type === "civil.material_layer" || object.type === "civil.sweep" ? object.geometry.vertices : [];
    for (const [x, y] of vertices) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (points.length >= 100_000) return null;
      if (!focusOnCut) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      points.push({ xy: [x, y], layerId: object.layer_id });
    }
  }
  if (focusOnCut) {
    const padding = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, 0.01);
    minX -= padding; maxX += padding; minY -= padding; maxY += padding;
  }
  const scale = Math.min(276 / Math.max(maxX - minX, 0.01), 146 / Math.max(maxY - minY, 0.01));
  const screen = ([x, y]: XY): XY => [170 + (x - minX - (maxX - minX) / 2) * scale, 95 - (y - minY - (maxY - minY) / 2) * scale];
  // The complete geometry sets the bounds, only the context dots are simplified.
  const visible = points.filter(({ xy: [x, y] }) => x >= minX && x <= maxX && y >= minY && y <= maxY);
  const stride = Math.max(1, Math.ceil(visible.length / 2000));
  return { a: screen(a), b: screen(b), points: visible.filter((_, i) => i % stride === 0).map((p) => ({ ...p, xy: screen(p.xy) })) };
}
