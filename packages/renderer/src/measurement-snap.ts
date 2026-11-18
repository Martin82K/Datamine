import { Vector3, Vector4, type Camera } from "three";
import type { RenderableDescriptor } from "./index.js";

export type MeasurementSnap = {
  readonly objectId: string;
  readonly screen: readonly [number, number];
  readonly distancePx: number;
} & ({ readonly kind: "point" } | { readonly kind: "vertex"; readonly vertexIndex: number }
  | { readonly kind: "edge"; readonly edgeIndices: readonly [number, number]; readonly edgeParameter: number });

type Projected = { screen: readonly [number, number]; z: number; w: number };

/** CSS-pixel snapping; original descriptor indices survive GPU float conversion and origin shifts. */
export function findMeasurementSnap(
  descriptors: readonly RenderableDescriptor[], camera: Camera,
  pointer: readonly [number, number], width: number, height: number, tolerancePx = 12,
  isVisible?: (candidate: MeasurementSnap, clipDepth: number) => boolean,
): MeasurementSnap | null {
  if (![...pointer, width, height, tolerancePx].every(Number.isFinite)
    || width <= 0 || height <= 0 || tolerancePx <= 0 || tolerancePx > 64) return null;
  camera.updateMatrixWorld();
  const project = (xyz: readonly [number, number, number]): Projected | null => {
    if (xyz.length !== 3 || !xyz.every(Number.isFinite)) return null;
    const clip = new Vector4(...xyz, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    if (clip.w <= 0 || ![clip.x, clip.y, clip.z, clip.w].every(Number.isFinite)) return null;
    const ndc = new Vector3(clip.x / clip.w, clip.y / clip.w, clip.z / clip.w);
    if (ndc.z < -1 || ndc.z > 1) return null;
    return { screen: [(ndc.x + 1) * width / 2, (1 - ndc.y) * height / 2], z: ndc.z, w: clip.w };
  };
  let vertex: MeasurementSnap | null = null;
  let edge: MeasurementSnap | null = null;
  let vertexDepth = Infinity;
  let edgeDepth = Infinity;
  let vertexMinimumDistance = Infinity;
  let edgeMinimumDistance = Infinity;
  let visitedVertices = 0;
  let visitedFaces = 0;
  const distance = (p: readonly [number, number]) => Math.hypot(p[0] - pointer[0], p[1] - pointer[1]);
  const accept = (candidate: MeasurementSnap, depth: number) => {
    if (candidate.distancePx > tolerancePx) return;
    const previous = candidate.kind === "edge" ? edge : vertex;
    const previousDepth = candidate.kind === "edge" ? edgeDepth : vertexDepth;
    const previousMinimum = candidate.kind === "edge" ? edgeMinimumDistance : vertexMinimumDistance;
    if (candidate.distancePx > previousMinimum + 0.5) return;
    if (isVisible && !isVisible(candidate, depth)) return;
    const minimumDistance = Math.min(previousMinimum, candidate.distancePx);
    if (candidate.kind === "edge") edgeMinimumDistance = minimumDistance;
    else vertexMinimumDistance = minimumDistance;
    // Subpixel differences at a nominal plan view must not pick the hidden lower skin.
    // Anchor the tolerance to the global minimum to prevent drifting through successive ties.
    if (previous && previous.distancePx <= minimumDistance + 0.5 && depth >= previousDepth) return;
    if (candidate.kind === "edge") { edge = candidate; edgeDepth = depth; }
    else { vertex = candidate; vertexDepth = depth; }
  };
  for (const descriptor of descriptors) {
    if (descriptor.presentation === "preview") continue;
    if (descriptor.point) {
      if (++visitedVertices > 100_000) return null;
      const p = project(descriptor.point);
      if (p) accept({ objectId: descriptor.id, kind: "point", screen: p.screen, distancePx: distance(p.screen) }, p.z);
    }
    if (!descriptor.mesh) continue;
    const { vertices, faces } = descriptor.mesh;
    visitedVertices += vertices.length;
    visitedFaces += faces.length;
    if (visitedVertices > 100_000 || visitedFaces > 200_000) return null;
    const projected = vertices.map(project);
    projected.forEach((p, vertexIndex) => {
      if (p) accept({ objectId: descriptor.id, kind: "vertex", vertexIndex, screen: p.screen, distancePx: distance(p.screen) }, p.z);
    });
    const seen = new Set<string>();
    for (const face of faces) {
      if (face.length !== 3 || face.some((index) => !Number.isInteger(index) || index < 0 || index >= vertices.length)) continue;
      for (let side = 0; side < 3; side++) {
        const i = Math.min(face[side]!, face[(side + 1) % 3]!);
        const j = Math.max(face[side]!, face[(side + 1) % 3]!);
        const key = `${i}:${j}`;
        if (i === j || seen.has(key)) continue;
        seen.add(key);
        const a = projected[i], b = projected[j];
        if (!a || !b) continue;
        const dx = b.screen[0] - a.screen[0], dy = b.screen[1] - a.screen[1];
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq < 1e-12) continue;
        const t = Math.max(0, Math.min(1, ((pointer[0] - a.screen[0]) * dx + (pointer[1] - a.screen[1]) * dy) / lengthSq));
        const screen = [a.screen[0] + t * dx, a.screen[1] + t * dy] as const;
        // Perspective-correct interpolation, not the linear screen-space fraction.
        const parameter = (t / b.w) / ((1 - t) / a.w + t / b.w);
        accept({ objectId: descriptor.id, kind: "edge", edgeIndices: [i, j], edgeParameter: parameter,
          screen, distancePx: distance(screen) }, a.z + t * (b.z - a.z));
      }
    }
  }
  return vertex ?? edge;
}
