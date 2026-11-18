import type { CivilPointObject, ModelObject } from "@datamine/contracts";

type XYZ = readonly [number, number, number];
export type SectionPoint = readonly [number, number]; // station, elevation
export type SectionSegment = readonly [SectionPoint, SectionPoint];
export interface SectionReference { readonly point: XYZ; readonly crs: CivilPointObject["properties"]["crs"] }
export interface SectionTrace {
  readonly objectId: string;
  readonly layerId: string;
  readonly name: string;
  readonly material: string | null;
  readonly thicknessM: number | null;
  readonly segments: readonly SectionSegment[];
  readonly rings: readonly (readonly SectionPoint[])[];
  readonly areaM2: number | null;
  readonly warning: string | null;
}
export interface CivilSection { readonly lengthM: number; readonly traces: readonly SectionTrace[] }

const EPS = 1e-7;
const MAX_FACES = 200_000;
const MAX_SEGMENTS = 20_000;
// Same coordinate envelope as the persisted survey model; this also bounds
// products and EPS quantization below the safe-integer limit.
const validXYZ = (point: readonly number[]): boolean => point.length === 3
  && point.every(Number.isFinite)
  && Math.abs(point[0]!) <= 100_000_000 && Math.abs(point[1]!) <= 100_000_000
  && Math.abs(point[2]!) <= 100_000;

const key = (p: SectionPoint): string => `${Math.round(p[0] / EPS)}:${Math.round(p[1] / EPS)}`;
const segmentKey = (s: SectionSegment): string => [key(s[0]), key(s[1])].sort().join("/");
const length = (s: SectionSegment): number => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
const mix = (a: SectionPoint, b: SectionPoint, t: number): SectionPoint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function clippedSegment(segment: SectionSegment, end: number): SectionSegment | null {
  let low = 0;
  let high = 1;
  const dx = segment[1][0] - segment[0][0];
  if (Math.abs(dx) < EPS) {
    if (segment[0][0] < -EPS || segment[0][0] > end + EPS) return null;
  } else {
    const t0 = -segment[0][0] / dx;
    const t1 = (end - segment[0][0]) / dx;
    low = Math.max(0, Math.min(t0, t1));
    high = Math.min(1, Math.max(t0, t1));
    if (high < low) return null;
  }
  const result: SectionSegment = [mix(segment[0], segment[1], low), mix(segment[0], segment[1], high)];
  return length(result) > EPS ? result : null;
}

function clipRing(ring: readonly SectionPoint[], end: number): readonly SectionPoint[] {
  let points = [...ring];
  for (const boundary of [0, end]) {
    const input = points;
    points = [];
    const inside = (p: SectionPoint) => boundary === 0 ? p[0] >= 0 : p[0] <= end;
    for (let index = 0; index < input.length; index += 1) {
      const a = input[index]!;
      const b = input[(index + 1) % input.length]!;
      if (inside(a)) points.push(a);
      if (inside(a) !== inside(b)) points.push(mix(a, b, (boundary - a[0]) / (b[0] - a[0])));
    }
  }
  return points;
}

function ringArea(ring: readonly SectionPoint[]): number {
  if (!ring.length) return 0;
  const origin = ring[0]!;
  return Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return sum + (p[0] - origin[0]) * (q[1] - origin[1]) - (q[0] - origin[0]) * (p[1] - origin[1]);
  }, 0)) / 2;
}

function insideRing(point: SectionPoint, ring: readonly SectionPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function closedRings(segments: readonly SectionSegment[]): readonly (readonly SectionPoint[])[] | null {
  const nodes = new Map<string, { point: SectionPoint; neighbours: string[] }>();
  for (const [a, b] of segments) {
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const entry = nodes.get(key(p)) ?? { point: p, neighbours: [] };
      entry.neighbours.push(key(q));
      nodes.set(key(p), entry);
    }
  }
  if ([...nodes.values()].some((node) => node.neighbours.length !== 2)) return null;
  const visited = new Set<string>();
  const rings: SectionPoint[][] = [];
  for (const first of nodes.keys()) {
    if (visited.has(first)) continue;
    const ring: SectionPoint[] = [];
    let previous = "";
    let current = first;
    do {
      if (visited.has(current)) return null;
      visited.add(current);
      const node = nodes.get(current)!;
      ring.push(node.point);
      const next = node.neighbours.find((id) => id !== previous)!;
      previous = current;
      current = next;
    } while (current !== first);
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Exact triangle/vertical-plane intersections, clipped to the A–B horizontal extent. */
export function createCivilSection(objects: readonly ModelObject[], a: SectionReference, b: SectionReference): CivilSection {
  if (!validXYZ(a.point) || !validXYZ(b.point)) throw new TypeError("Body řezu musí mít konečné souřadnice v rozsahu modelu.");
  const sameCrs = (crs: SectionReference["crs"]) => crs.kind === a.crs.kind && crs.epsg === a.crs.epsg && crs.vertical_datum === a.crs.vertical_datum
    && crs.axis_order === a.crs.axis_order && crs.horizontal_unit === a.crs.horizontal_unit && crs.vertical_unit === a.crs.vertical_unit;
  if (!sameCrs(b.crs)) throw new TypeError("Body řezu nemají shodný souřadnicový a výškový systém.");
  const dx = b.point[0] - a.point[0];
  const dy = b.point[1] - a.point[1];
  const extent = Math.hypot(dx, dy);
  if (!Number.isFinite(extent) || extent <= EPS) throw new TypeError("Řez vyžaduje dva body s rozdílnou polohou XY.");
  const ux = dx / extent;
  const uy = dy / extent;
  const project = (p: XYZ): SectionPoint => [(p[0] - a.point[0]) * ux + (p[1] - a.point[1]) * uy, p[2]];
  const distance = (p: XYZ) => (p[1] - a.point[1]) * ux - (p[0] - a.point[0]) * uy;
  const traces: SectionTrace[] = [];
  let faceCount = 0;
  let segmentCount = 0;
  for (const object of objects) {
    if (object.type !== "civil.tin_surface" && object.type !== "civil.material_layer" && object.type !== "civil.sweep") continue;
    if (!sameCrs(object.properties.crs)) throw new TypeError("Plochy řezu nemají shodný souřadnicový a výškový systém.");
    faceCount += object.geometry.faces.length;
    if (faceCount > MAX_FACES) throw new RangeError("Řez překročil limit 200 000 trojúhelníků. Omezte viditelné vrstvy.");
    const intersections = new Map<string, SectionSegment>();
    const coplanar = new Map<string, { segment: SectionSegment; count: number }>();
    const planeEdges = new Map<string, { segment: SectionSegment; positive: number; negative: number }>();
    for (const face of object.geometry.faces) {
      if (face.length !== 3 || face.some((index) => !Number.isInteger(index) || index < 0 || index >= object.geometry.vertices.length)) throw new TypeError("Řez obsahuje neplatný index trojúhelníku.");
      const vertices = face.map((index) => object.geometry.vertices[index]!);
      if (vertices.some((p) => !validXYZ(p))) throw new TypeError("Řez obsahuje neplatné souřadnice trojúhelníku.");
      const distances = vertices.map(distance);
      const points: SectionPoint[] = [];
      for (let i = 0; i < 3; i += 1) {
        const j = (i + 1) % 3;
        const p = vertices[i]!;
        const q = vertices[j]!;
        const dp = distances[i]!;
        const dq = distances[j]!;
        if (distances.every((d) => Math.abs(d) <= EPS)) {
          const segment: SectionSegment = [project(p), project(q)];
          if (length(segment) > EPS) {
            const id = segmentKey(segment);
            coplanar.set(id, { segment, count: (coplanar.get(id)?.count ?? 0) + 1 });
          }
        } else {
          if (Math.abs(dp) <= EPS) points.push(project(p));
          if ((dp > EPS && dq < -EPS) || (dp < -EPS && dq > EPS)) points.push(mix(project(p), project(q), dp / (dp - dq)));
        }
      }
      const unique = [...new Map(points.map((p) => [key(p), p])).values()];
      if (unique.length === 2) {
        const segment: SectionSegment = [unique[0]!, unique[1]!];
        if (length(segment) > EPS) {
          const id = segmentKey(segment);
          if (distances.filter((d) => Math.abs(d) <= EPS).length === 2) {
            const entry = planeEdges.get(id) ?? { segment, positive: 0, negative: 0 };
            if (distances.some((d) => d > EPS)) entry.positive += 1;
            else entry.negative += 1;
            planeEdges.set(id, entry);
          } else intersections.set(id, segment);
        }
      }
      if (segmentCount + intersections.size + coplanar.size + planeEdges.size > MAX_SEGMENTS) throw new RangeError("Řez překročil limit 20 000 úseček. Omezte viditelné vrstvy.");
    }
    for (const [id, edge] of planeEdges) {
      // Two incident triangles on the same side only touch the section plane.
      // Their shared edge is not an interior cross-section boundary. Keep
      // unmatched edges so an actually open mesh cannot gain a false closure.
      if (object.type !== "civil.material_layer" || edge.positive + edge.negative !== 2
        || (edge.positive > 0 && edge.negative > 0)) {
        intersections.set(id, edge.segment);
      }
    }
    for (const { segment, count } of coplanar.values()) if (count === 1) intersections.set(segmentKey(segment), segment);
    const original = [...intersections.values()];
    segmentCount += original.length;
    const clipped = original.map((segment) => clippedSegment(segment, extent)).filter((segment): segment is SectionSegment => segment !== null);
    if (!clipped.length) continue;
    const closed = object.type === "civil.material_layer" ? closedRings(original) : null;
    if (closed && closed.length > 512) throw new RangeError("Řez překročil limit 512 uzavřených obrysů.");
    const rings = closed?.map((ring) => clipRing(ring, extent)).filter((ring) => ring.length >= 3 && ringArea(ring) > EPS * EPS) ?? [];
    let areaM2: number | null = null;
    if (closed) {
      areaM2 = closed.reduce((sum, ring, i) => {
        const depth = closed.filter((other, j) => i !== j && insideRing(ring[0]!, other)).length;
        return sum + (depth % 2 === 0 ? 1 : -1) * ringArea(clipRing(ring, extent));
      }, 0);
      if (!Number.isFinite(areaM2)) throw new TypeError("Plocha řezu není konečné číslo.");
      areaM2 = Math.max(0, areaM2);
    }
    traces.push({
      objectId: object.id, layerId: object.layer_id, name: object.properties.name,
      material: object.type === "civil.material_layer" ? object.properties.material_code : null,
      thicknessM: object.type === "civil.material_layer" ? object.properties.derivation.thickness_m : null,
      segments: clipped, rings, areaM2,
      warning: object.type === "civil.material_layer" && !closed
        ? coplanar.size > 0
          ? "Řez leží v rovině stěny vrstvy a nemá jednoznačný uzavřený obrys; posuňte řez mimo hranu. Plocha se nevykazuje."
          : "Průřez není uzavřený; plocha se nevykazuje."
        : null,
    });
  }
  return { lengthM: extent, traces };
}
