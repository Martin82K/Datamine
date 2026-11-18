import type { ModelObject } from "@datamine/contracts";
import type { XYZ } from "./civil-map.ts";

export type XY = readonly [number, number];
export interface DrawingControlPoint {
  readonly pixel: XY;
  readonly world: XY;
  readonly model_point_id?: string;
}
export interface StoredDrawingUnderlay {
  readonly version: 1;
  readonly source_name: string;
  readonly page_number: number | null;
  readonly pixel_width: number;
  readonly pixel_height: number;
  readonly image_data_url: string;
  readonly control_points: readonly DrawingControlPoint[];
  readonly elevation: number;
  readonly opacity: number;
  readonly visible: boolean;
}
export interface DrawingUnderlay extends StoredDrawingUnderlay {
  readonly image: HTMLImageElement;
}

const finiteXY = (p: unknown): p is XY => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));

/** Image pixels have Y down; survey coordinates have north/Y up. No mirroring or shear. */
export function drawingTransform(points: readonly DrawingControlPoint[]) {
  if (points.length < 2 || !points.every((p) => p && finiteXY(p.pixel) && finiteXY(p.world))) throw new Error("Vyberte dva odpovídající body v podkladu a modelu.");
  const first = points[0]!, second = points[1]!;
  const dx = second.pixel[0] - first.pixel[0], dy = first.pixel[1] - second.pixel[1];
  const wx = second.world[0] - first.world[0], wy = second.world[1] - first.world[1];
  const length2 = dx * dx + dy * dy;
  if (length2 < 25 || Math.hypot(wx, wy) < 0.01) throw new Error("Vazební body jsou příliš blízko. Vyberte vzdálené krajní body (alespoň 5 px a 1 cm).");
  const a = (dx * wx + dy * wy) / length2, b = (dx * wy - dy * wx) / length2;
  const scale = Math.hypot(a, b);
  if (!Number.isFinite(scale) || scale < 0.00001 || scale > 100) throw new Error("Měřítko podkladu je mimo povolený rozsah.");
  const apply = ([x, y]: XY): XY => {
    const u = x - first.pixel[0], v = first.pixel[1] - y;
    return [first.world[0] + a * u - b * v, first.world[1] + b * u + a * v];
  };
  const check = points[2];
  const predicted = check ? apply(check.pixel) : null;
  const residual = check && predicted ? Math.hypot(predicted[0] - check.world[0], predicted[1] - check.world[1]) : null;
  return { apply, scale, rotation: Math.atan2(b, a) * 180 / Math.PI, residual };
}

export function drawingUnderlayMesh(drawing: StoredDrawingUnderlay, origin: XYZ) {
  const transform = drawingTransform(drawing.control_points);
  const pixels: XY[] = [[0, 0], [drawing.pixel_width, 0], [drawing.pixel_width, drawing.pixel_height], [0, drawing.pixel_height]];
  const vertices: XYZ[] = pixels.map((p) => {
    const [x, y] = transform.apply(p);
    return [x - origin[0], y - origin[1], drawing.elevation - origin[2]];
  });
  return { vertices, faces: [[0, 2, 1], [0, 3, 2]] as const, uv: [[0, 1], [1, 1], [1, 0], [0, 0]] as const };
}

export function isStoredDrawingUnderlay(value: unknown): value is StoredDrawingUnderlay {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as StoredDrawingUnderlay;
  if (Object.keys(v).sort().join(",") !== "control_points,elevation,image_data_url,opacity,page_number,pixel_height,pixel_width,source_name,version,visible"
    || v.version !== 1 || typeof v.source_name !== "string" || !/^[^<>\u0000-\u001f\u007f/\\]{1,180}$/.test(v.source_name)
    || v.page_number !== null && (!Number.isInteger(v.page_number) || v.page_number < 1 || v.page_number > 1000)
    || !Number.isInteger(v.pixel_width) || v.pixel_width < 16 || v.pixel_width > 2048
    || !Number.isInteger(v.pixel_height) || v.pixel_height < 16 || v.pixel_height > 2048
    || typeof v.image_data_url !== "string" || v.image_data_url.length > 2_000_000
    || !v.image_data_url.startsWith("data:image/jpeg;base64,/9j/")
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.image_data_url.slice(23)) || v.image_data_url.slice(23).length % 4 !== 0
    || !Number.isFinite(v.elevation) || v.elevation < -100 || v.elevation > 2000
    || !Number.isFinite(v.opacity) || v.opacity < 0.05 || v.opacity > 1 || typeof v.visible !== "boolean"
    || !Array.isArray(v.control_points) || ![2, 3].includes(v.control_points.length)) return false;
  for (const p of v.control_points) {
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((key) => !["pixel", "world", "model_point_id"].includes(key))
      || !finiteXY(p.pixel) || !finiteXY(p.world)
      || p.pixel[0] < 0 || p.pixel[0] > v.pixel_width || p.pixel[1] < 0 || p.pixel[1] > v.pixel_height
      || p.world[0] < -904703.6 || p.world[0] > -431605.6 || p.world[1] < -1227414.12 || p.world[1] > -935118.12
      || p.model_point_id !== undefined && (typeof p.model_point_id !== "string" || !/^object_[A-Za-z0-9_-]{1,100}$/.test(p.model_point_id))) return false;
  }
  try {
    const { scale } = drawingTransform(v.control_points);
    if (Math.max(v.pixel_width, v.pixel_height) * scale > 10_000) return false;
    return drawingUnderlayMesh(v, [0, 0, 0]).vertices.every((p) => p.every(Number.isFinite));
  } catch { return false; }
}

export function drawingAnchorsChanged(drawing: StoredDrawingUnderlay, objects: readonly ModelObject[]): boolean {
  return drawing.control_points.some((p) => {
    if (!p.model_point_id) return false;
    const object = objects.find((o) => o.id === p.model_point_id);
    if (!object || (object.type !== "civil.point" && object.type !== "stakeout.point")) return true;
    return Math.hypot(object.geometry.point[0] - p.world[0], object.geometry.point[1] - p.world[1]) > 0.001;
  });
}

export function storedDrawingUnderlay(drawing: DrawingUnderlay): StoredDrawingUnderlay {
  const { image: _image, ...stored } = drawing;
  if (!isStoredDrawingUnderlay(stored)) throw new Error("Připnutí podkladu není platné. Ověřte body, souřadnice a rozměry.");
  return stored;
}

export async function restoreDrawingUnderlay(stored: StoredDrawingUnderlay): Promise<DrawingUnderlay> {
  if (!isStoredDrawingUnderlay(stored)) throw new Error("Uložené připnutí podkladu není platné.");
  const image = new Image(); image.src = stored.image_data_url; await image.decode();
  if (image.width !== stored.pixel_width || image.height !== stored.pixel_height) throw new Error("Rozměry uloženého podkladu nesouhlasí.");
  return { ...stored, image };
}
