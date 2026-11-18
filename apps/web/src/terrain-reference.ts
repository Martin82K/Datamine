import type { ModelObject } from "@datamine/contracts";
import type { MapBounds, XYZ } from "./civil-map";

export interface SurveyTerrain {
  readonly kind: "survey_tin";
  readonly bounds: MapBounds;
  readonly source_object_id: string;
  readonly source_name: string;
  readonly vertices: readonly XYZ[];
  readonly faces: readonly (readonly [number, number, number])[];
}
export const MAX_TERRAIN_VERTICES = 10_000;
export const MAX_TERRAIN_FACES = 20_000;

/** A reference must be a bounded, single-valued triangle mesh in survey XY. */
export function validSurveyTerrain(value: unknown): value is SurveyTerrain {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as SurveyTerrain;
  if (Object.keys(v).sort().join(",") !== "bounds,faces,kind,source_name,source_object_id,vertices"
    || v.kind !== "survey_tin" || typeof v.source_name !== "string" || !v.source_name.trim() || v.source_name.length > 200
    || typeof v.source_object_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(v.source_object_id)
    || !Array.isArray(v.bounds) || v.bounds.length !== 4 || !v.bounds.every(Number.isFinite)
    || v.bounds[0] < -904703.6 || v.bounds[1] < -1227414.12 || v.bounds[2] > -431605.6 || v.bounds[3] > -935118.12
    || v.bounds[2] <= v.bounds[0] || v.bounds[3] <= v.bounds[1] || v.bounds[2] - v.bounds[0] > 1000
    || Math.abs(v.bounds[2] - v.bounds[0] - (v.bounds[3] - v.bounds[1])) > 0.001
    || !Array.isArray(v.vertices) || v.vertices.length < 3 || v.vertices.length > MAX_TERRAIN_VERTICES
    || !Array.isArray(v.faces) || !v.faces.length || v.faces.length > MAX_TERRAIN_FACES) return false;
  if (!v.vertices.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
    && p[0] >= v.bounds[0] && p[0] <= v.bounds[2] && p[1] >= v.bounds[1] && p[1] <= v.bounds[3] && p[2] >= -100 && p[2] <= 2000)) return false;
  return v.faces.every((f) => {
    if (!Array.isArray(f) || f.length !== 3 || !f.every((i) => Number.isInteger(i) && i >= 0 && i < v.vertices.length)) return false;
    const [a, b, c] = f.map((i) => v.vertices[i]!);
    return Math.abs((b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0])) > 1e-8;
  });
}

export function surveyTerrainFrom(object: ModelObject, bounds: MapBounds): SurveyTerrain {
  if (object.type !== "civil.tin_surface") throw new Error("Vyberte TIN stávajícího zaměřeného terénu.");
  const crs = object.properties.crs;
  if (crs.kind !== "epsg" || crs.epsg !== 5514 || crs.axis_order !== "east_north_up"
    || crs.horizontal_unit !== "m" || crs.vertical_unit !== "m" || crs.vertical_datum !== "Bpv") throw new Error("Terén vyžaduje EPSG:5514 a výšky Bpv.");
  const terrain: SurveyTerrain = { kind: "survey_tin", bounds, source_object_id: object.id,
    source_name: object.properties.name, vertices: structuredClone(object.geometry.vertices), faces: structuredClone(object.geometry.faces) };
  if (!validSurveyTerrain(terrain)) throw new Error("TIN nelze použít: vyžaduje platné trojúhelníky v XY, nejvýše 10 000 vrcholů, 20 000 trojúhelníků a oblast do 1 km.");
  return terrain;
}

export function surveyTerrainMesh(terrain: SurveyTerrain, origin: XYZ) {
  if (!validSurveyTerrain(terrain) || !origin.every(Number.isFinite)) throw new Error("Neplatný referenční terén.");
  const [minX, minY, maxX, maxY] = terrain.bounds;
  return {
    vertices: terrain.vertices.map(([x, y, z]): XYZ => [x - origin[0], y - origin[1], z - origin[2]]),
    faces: terrain.faces,
    uv: terrain.vertices.map(([x, y]): readonly [number, number] => [(x - minX) / (maxX - minX), (y - minY) / (maxY - minY)]),
  };
}

export function surveyTerrainChanged(terrain: SurveyTerrain, objects: readonly ModelObject[]): boolean {
  const source = objects.find((object) => object.id === terrain.source_object_id);
  return !source || source.type !== "civil.tin_surface"
    || JSON.stringify(source.geometry.vertices) !== JSON.stringify(terrain.vertices)
    || JSON.stringify(source.geometry.faces) !== JSON.stringify(terrain.faces);
}
