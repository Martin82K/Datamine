import { validSurveyTerrain, surveyTerrainMesh, type SurveyTerrain } from "./terrain-reference.ts";
import type { ModelObject } from "@datamine/contracts";

export type XYZ = readonly [number, number, number];
export type MapBounds = readonly [number, number, number, number];
export interface TerrainGrid {
  readonly bounds: MapBounds;
  readonly size: number;
  readonly elevations: readonly (number | null)[];
}
export type ReferenceTerrain = TerrainGrid | SurveyTerrain;
export function isSurveyTerrain(terrain: ReferenceTerrain): terrain is SurveyTerrain { return "kind" in terrain && terrain.kind === "survey_tin"; }
export function terrainElevations(terrain: ReferenceTerrain): readonly (number | null)[] { return isSurveyTerrain(terrain) ? terrain.vertices.map((p) => p[2]) : terrain.elevations; }

export type MapLayer = "ortho" | "topographic" | "cadastral";
export const MAP_LAYERS: Readonly<Record<MapLayer, { label: string; source: string }>> = {
  ortho: { label: "Ortofoto", source: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO/MapServer" },
  topographic: { label: "Topografická mapa ZTM 10", source: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ZTM/ZTM10/MapServer" },
  cadastral: { label: "Katastrální mapa", source: "https://services.cuzk.gov.cz/wms/local-km-wms.asp" },
};
export interface StoredMapContext {
  readonly version: 1;
  readonly layer: MapLayer;
  readonly terrain: ReferenceTerrain;
  readonly image_data_url: string;
  readonly opacity: number;
  readonly visible: boolean;
  readonly margin: number;
  readonly loaded_at: string;
}
export interface MapContext extends StoredMapContext {
  readonly image: HTMLImageElement;
}
export const GRID_SIZE = 31;
export const MAX_GRID_SIZE = 151;
/** Sampling more densely than the two metre source does not add surveyed detail. */
export function terrainGridSize(bounds: MapBounds, detail: boolean): number {
  return detail ? Math.min(MAX_GRID_SIZE, Math.max(2, Math.ceil((bounds[2] - bounds[0]) / 2) + 1)) : GRID_SIZE;
}
export const MAX_MAP_IMAGE_CHARS = 2_000_000;
const COVERAGE = [-904703.6, -1227414.12, -431605.6, -935118.12] as const;

/** Saved input never supplies URLs to fetch or executable image formats. */
export function isStoredMapContext(value: unknown): value is StoredMapContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as StoredMapContext;
  if (Object.keys(v).sort().join(",") !== "image_data_url,layer,loaded_at,margin,opacity,terrain,version,visible"
    || v.version !== 1 || typeof v.layer !== "string" || !Object.hasOwn(MAP_LAYERS, v.layer)
    || typeof v.opacity !== "number" || !Number.isFinite(v.opacity) || v.opacity < 0.05 || v.opacity > 1
    || typeof v.visible !== "boolean" || !Number.isFinite(v.margin) || v.margin < 10 || v.margin > 200
    || typeof v.loaded_at !== "string" || v.loaded_at.length > 40 || !Number.isFinite(Date.parse(v.loaded_at))
    || typeof v.image_data_url !== "string" || v.image_data_url.length > MAX_MAP_IMAGE_CHARS
    || !v.image_data_url.startsWith("data:image/jpeg;base64,/9j/")
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.image_data_url.slice(23)) || v.image_data_url.slice(23).length % 4 !== 0) return false;
  const grid = v.terrain;
  if (grid && typeof grid === "object" && "kind" in grid) return validSurveyTerrain(grid);
  if (!grid || typeof grid !== "object" || Object.keys(grid).sort().join(",") !== "bounds,elevations,size"
    || !Array.isArray(grid.bounds) || grid.bounds.length !== 4 || !Array.isArray(grid.elevations)
    || grid.bounds[0] < COVERAGE[0] || grid.bounds[1] < COVERAGE[1] || grid.bounds[2] > COVERAGE[2] || grid.bounds[3] > COVERAGE[3]
    || grid.bounds[2] - grid.bounds[0] > 1000 || Math.abs((grid.bounds[2] - grid.bounds[0]) - (grid.bounds[3] - grid.bounds[1])) > 0.001) return false;
  try { return terrainMesh(grid, [0, 0, 0]).faces.length > 0; } catch { return false; }
}

export function storedMapContext(context: MapContext): StoredMapContext {
  const { image: _image, ...stored } = context;
  if (!isStoredMapContext(stored)) throw new Error("Mapový podklad nelze uložit: neplatná data nebo překročený limit.");
  return stored;
}

export function mapVertices(object: ModelObject): readonly XYZ[] {
  if (object.type === "civil.point" || object.type === "stakeout.point") return [object.geometry.point];
  if (object.type === "civil.axis" || object.type === "civil.profile") return object.geometry.points;
  if (object.type === "civil.tin_surface" || object.type === "civil.material_layer" || object.type === "civil.sweep") return object.geometry.vertices;
  return [];
}

/** EPSG:5514 is east/north with negative coordinates, not traditional positive S-JTSK X/Y. */
export function mapBoundsFor(objects: readonly ModelObject[], margin: number): MapBounds {
  if (!Number.isFinite(margin) || margin < 10 || margin > 200) throw new Error("Okolí musí být 10 až 200 m.");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  for (const object of objects) {
    const vertices = mapVertices(object);
    if (!vertices.length) continue;
    const crs = "crs" in object.properties ? object.properties.crs : undefined;
    if (!crs || crs.kind !== "epsg" || crs.epsg !== 5514 || crs.axis_order !== "east_north_up"
      || crs.horizontal_unit !== "m" || crs.vertical_unit !== "m" || crs.vertical_datum !== "Bpv") {
      throw new Error("Mapa a terén nyní vyžadují EPSG:5514, osy východ/sever, metry a výšky Bpv u všech zobrazených objektů.");
    }
    for (const [x, y, z] of vertices) {
      if (++count > 100_000) throw new Error("Pro mapový podklad zobrazte nejvýše 100 000 vrcholů.");
      if (![x, y, z].every(Number.isFinite) || x < COVERAGE[0] || x > COVERAGE[2] || y < COVERAGE[1] || y > COVERAGE[3]) {
        throw new Error("Souřadnice leží mimo rozsah podkladu ČR. Ověřte EPSG:5514, znaménka a pořadí os; ukázkové lokální souřadnice nelze osadit do mapy.");
      }
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (!count) throw new Error("Zobrazte alespoň jeden bod nebo povrch se souřadnicemi.");
  const side = Math.max(maxX - minX, maxY - minY) + margin * 2;
  if (side > 1000) throw new Error("Podklad je omezen na 1 × 1 km. Skryjte vzdálené vrstvy nebo zmenšete okolí.");
  const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
  const bounds: MapBounds = [x - side / 2, y - side / 2, x + side / 2, y + side / 2];
  if (bounds[0] < COVERAGE[0] || bounds[1] < COVERAGE[1] || bounds[2] > COVERAGE[2] || bounds[3] > COVERAGE[3]) throw new Error("Okolí přesahuje rozsah výškového podkladu.");
  return bounds;
}

export function gridPoint(bounds: MapBounds, size: number, index: number): readonly [number, number] {
  return [bounds[0] + (index % size) / (size - 1) * (bounds[2] - bounds[0]), bounds[1] + Math.floor(index / size) / (size - 1) * (bounds[3] - bounds[1])];
}

export function terrainMesh(grid: ReferenceTerrain, origin: XYZ) {
  if (isSurveyTerrain(grid)) return surveyTerrainMesh(grid, origin);
  const { size, elevations, bounds } = grid;
  if (!Number.isInteger(size) || size < 2 || size > MAX_GRID_SIZE || elevations.length !== size * size
    || ![...bounds, ...origin].every(Number.isFinite) || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]
    || elevations.some((z) => z !== null && (!Number.isFinite(z) || z < -100 || z > 2000))) throw new Error("Neplatná síť terénu.");
  const vertices: XYZ[] = [], uv: (readonly [number, number])[] = [];
  const indices = new Map<number, number>();
  elevations.forEach((z, i) => {
    if (z === null) return;
    const [x, y] = gridPoint(bounds, size, i);
    indices.set(i, vertices.length);
    vertices.push([x - origin[0], y - origin[1], z - origin[2]]);
    uv.push([(x - bounds[0]) / (bounds[2] - bounds[0]), (y - bounds[1]) / (bounds[3] - bounds[1])]);
  });
  const faces: [number, number, number][] = [];
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const i = y * size + x;
    for (const triangle of [[i, i + 1, i + size], [i + 1, i + size + 1, i + size]]) {
      const ids = triangle.map((j) => indices.get(j));
      if (ids.every((j) => j !== undefined)) faces.push(ids as [number, number, number]);
    }
  }
  return { vertices, faces, uv };
}

/** Validate returned locations and datum; never assume response ordering, or interpret NoData as zero. */
export function parseTerrainRow(payload: unknown, points: readonly (readonly [number, number])[]): (number | null)[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results) || results.length !== points.length) throw new Error("ČÚZK nevrátil očekávaný počet výšek.");
  return points.map(([x, y]) => {
    const matches = results.filter((r) => r && Math.abs(r.location?.x - x) < 0.001 && Math.abs(r.location?.y - y) < 0.001);
    if (matches.length !== 1) throw new Error("Výšky ČÚZK neodpovídají požadovaným souřadnicím.");
    const r = matches[0], sr = r.location.spatialReference;
    if ((sr?.latestWkid ?? sr?.wkid) !== 5514 || (sr?.latestVcsWkid ?? sr?.vcsWkid) !== 8357) throw new Error("ČÚZK vrátil jiný souřadnicový nebo výškový systém.");
    if (r.value === null || r.value === "NoData") return null;
    if ((typeof r.value !== "string" && typeof r.value !== "number") || String(r.value).trim() === "") throw new Error("Neplatná výška ČÚZK.");
    const value = Number(r.value);
    if (!Number.isFinite(value) || value < -100 || value > 2000) throw new Error("Neplatná výška ČÚZK.");
    return value;
  });
}

export function orthoUrl(bounds: MapBounds): string {
  return mapImageUrl(bounds, "ortho");
}

export function mapImageUrl(bounds: MapBounds, layer: MapLayer): string {
  if (!Object.hasOwn(MAP_LAYERS, layer)) throw new Error("Neznámá mapová vrstva.");
  if (layer === "cadastral") return MAP_LAYERS[layer].source + "?" + new URLSearchParams({
    SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.1.1", LAYERS: "KN", STYLES: "", SRS: "EPSG:5514",
    BBOX: bounds.join(","), WIDTH: "1024", HEIGHT: "1024", FORMAT: "image/jpeg",
  });
  return MAP_LAYERS[layer].source + "/export?" + new URLSearchParams({
    bbox: bounds.join(","), bboxSR: "5514", imageSR: "5514", size: "1024,1024", format: "jpg", f: "image",
  });
}

async function boundedBody(response: Response, maximumBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) throw new Error("ČÚZK vrátil prázdnou odpověď.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximumBytes) throw new Error("Podklad ČÚZK překračuje limit velikosti.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const body = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

export async function loadTerrain(bounds: MapBounds, signal: AbortSignal, progress: (rows: number) => void, size = GRID_SIZE): Promise<TerrainGrid> {
  if (!Number.isInteger(size) || size < 2 || size > MAX_GRID_SIZE) throw new Error("Neplatná podrobnost terénu.");
  const elevations: (number | null)[] = Array(size * size).fill(null);
  let nextRow = 0, complete = 0;
  const worker = async () => { while (nextRow < size) {
    signal.throwIfAborted();
    const row = nextRow++;
    const points = Array.from({ length: size }, (_, x) => gridPoint(bounds, size, row * size + x));
    const params = new URLSearchParams({ f: "json", geometryType: "esriGeometryMultipoint",
      geometry: JSON.stringify({ points, spatialReference: { wkid: 5514 } }),
      renderingRule: JSON.stringify({ rasterFunction: "None" }), pixelSize: "2,2",
      returnCatalogItems: "false", returnGeometry: "false", returnPixelValues: "false" });
    const response = await fetch("https://ags.cuzk.gov.cz/arcgis2/rest/services/dmr5g/ImageServer/identify?" + params, {
      signal, credentials: "omit", referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`Výškový podklad ČÚZK není dostupný (HTTP ${response.status}).`);
    const body = new TextDecoder().decode(await boundedBody(response, 100_000));
    const values = parseTerrainRow(JSON.parse(body), points);
    values.forEach((value, x) => { elevations[row * size + x] = value; });
    progress(++complete);
  } };
  await Promise.all(Array.from({ length: Math.min(4, size) }, worker));
  const grid = { bounds, size, elevations };
  if (!terrainMesh(grid, [0, 0, 0]).faces.length) throw new Error("ČÚZK nemá v této oblasti použitelná výšková data.");
  return grid;
}

async function decodeMapImage(url: string): Promise<HTMLImageElement> {
  const image = new Image(); image.src = url;
  await image.decode();
  if (image.width !== 1024 || image.height !== 1024) throw new Error("Mapa má neočekávané rozměry.");
  return image;
}

export async function restoreMapContext(stored: StoredMapContext): Promise<MapContext> {
  if (!isStoredMapContext(stored)) throw new Error("Uložený mapový podklad není platný.");
  return { ...stored, image: await decodeMapImage(stored.image_data_url) };
}

export async function loadMapImage(bounds: MapBounds, layer: MapLayer, signal: AbortSignal): Promise<Pick<MapContext, "image" | "image_data_url">> {
  const response = await fetch(mapImageUrl(bounds, layer), { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error("Mapa ČÚZK není dostupná.");
  const blob = new Blob([await boundedBody(response, 8_000_000)], { type: "image/jpeg" });
  const url = URL.createObjectURL(blob);
  try {
    const image = await decodeMapImage(url);
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 1024;
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("Mapu nelze připravit k uložení.");
    drawing.drawImage(image, 0, 0);
    const image_data_url = canvas.toDataURL("image/jpeg", 0.9);
    if (image_data_url.length > MAX_MAP_IMAGE_CHARS) throw new Error("Obrázek mapy překračuje limit pro uložení.");
    signal.throwIfAborted();
    return { image, image_data_url };
  } finally { URL.revokeObjectURL(url); }
}
