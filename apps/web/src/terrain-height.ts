import { gridPoint, isSurveyTerrain, type ReferenceTerrain, type XYZ } from "./civil-map.ts";

export type TerrainHeight = { readonly status: "ok"; readonly elevation: number }
  | { readonly status: "outside" | "missing" | "ambiguous" };

/** Barycentric interpolation in local XY; preserves the source triangle's plane. */
export function triangleElevation(a: XYZ, b: XYZ, c: XYZ, x: number, y: number): number | null {
  const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1];
  const det = bx * cy - by * cx;
  if (Math.abs(det) <= 1e-8) return null;
  const dx = x - a[0], dy = y - a[1];
  const u = (dx * cy - dy * cx) / det, v = (bx * dy - by * dx) / det;
  if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) return null;
  return a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]);
}

/** Input is an already validated project snapshot; never extrapolate beyond measured faces. */
export function terrainHeightAt(terrain: ReferenceTerrain, x: number, y: number): TerrainHeight {
  const [minX, minY, maxX, maxY] = terrain.bounds;
  if (![x, y].every(Number.isFinite) || x < minX || y < minY || x > maxX || y > maxY) return { status: "outside" };
  let elevation: number | null = null;
  const accept = (a: XYZ, b: XYZ, c: XYZ): boolean => {
    if (x < Math.min(a[0], b[0], c[0]) || x > Math.max(a[0], b[0], c[0])
      || y < Math.min(a[1], b[1], c[1]) || y > Math.max(a[1], b[1], c[1])) return true;
    const found = triangleElevation(a, b, c, x, y);
    if (found === null) return true;
    if (elevation !== null && Math.abs(elevation - found) > 1e-5) return false;
    elevation = found; return true;
  };
  if (isSurveyTerrain(terrain)) {
    for (const [a, b, c] of terrain.faces) if (!accept(terrain.vertices[a]!, terrain.vertices[b]!, terrain.vertices[c]!)) return { status: "ambiguous" };
  } else {
    const { size, elevations } = terrain;
    // Include adjacent cells at exact boundaries so an existing triangle beside NoData remains usable.
    const fx = (x - minX) / (maxX - minX) * (size - 1), fy = (y - minY) / (maxY - minY) * (size - 1);
    const ix = Math.min(size - 2, Math.floor(fx)), iy = Math.min(size - 2, Math.floor(fy));
    const xs = Math.abs(fx - Math.round(fx)) < 1e-9 && ix > 0 ? [ix - 1, ix] : [ix];
    const ys = Math.abs(fy - Math.round(fy)) < 1e-9 && iy > 0 ? [iy - 1, iy] : [iy];
    for (const row of ys) for (const column of xs) {
      const i = row * size + column;
      for (const ids of [[i, i + 1, i + size], [i + 1, i + size + 1, i + size]]) {
        if (ids.some((j) => elevations[j] === null)) continue;
        const vertices = ids.map((j): XYZ => [...gridPoint(terrain.bounds, size, j), elevations[j]!]);
        if (!accept(vertices[0]!, vertices[1]!, vertices[2]!)) return { status: "ambiguous" };
      }
    }
  }
  return elevation === null ? { status: "missing" } : { status: "ok", elevation };
}
