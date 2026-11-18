import type { CivilPointObject, StakeoutPointObject, ModelObject } from "@datamine/contracts";

import type { MeasurementSnap } from "@datamine/renderer";

export type MeasurementPoint = CivilPointObject | StakeoutPointObject;

export interface MeasurementAnchor {
  readonly id: string;
  readonly ownerId: string;
  readonly kind: "point" | "vertex" | "edge";
  readonly snap?: MeasurementSnap;
  readonly properties: { readonly name: string; readonly crs: CivilPointObject["properties"]["crs"] };
  readonly geometry: { readonly point: readonly [number, number, number] };
}

export function pointMeasurementAnchor(point: MeasurementPoint): MeasurementAnchor {
  return { id: point.id, ownerId: point.id, kind: "point", properties: { name: point.properties.name, crs: point.properties.crs },
    geometry: { point: [...point.geometry.point] } };
}

/** Resolve against source doubles, never rounded GPU geometry or an inverse display transform. */
export function resolveMeasurementSnap(objects: readonly ModelObject[], snap: MeasurementSnap): MeasurementAnchor | null {
  const owner = objects.find((object) => object.id === snap.objectId);
  if (!owner) return null;
  if (snap.kind === "point") return owner.type === "civil.point" || owner.type === "stakeout.point" ? pointMeasurementAnchor(owner) : null;
  if (owner.type !== "civil.tin_surface" && owner.type !== "civil.material_layer" && owner.type !== "civil.sweep") return null;
  const vertices = owner.geometry.vertices;
  const validIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < vertices.length;
  let coordinates: readonly [number, number, number];
  let label: string;
  let suffix: string;
  if (snap.kind === "vertex") {
    if (!validIndex(snap.vertexIndex)) return null;
    coordinates = [...vertices[snap.vertexIndex]!];
    label = `vrchol ${snap.vertexIndex + 1}`;
    suffix = `v:${snap.vertexIndex}`;
  } else {
    const [i, j] = snap.edgeIndices;
    const t = snap.edgeParameter;
    if (!validIndex(i) || !validIndex(j) || i === j || !Number.isFinite(t) || t < 0 || t > 1
      || !owner.geometry.faces.some((face) => face.includes(i) && face.includes(j))) return null;
    const a = vertices[i]!, b = vertices[j]!;
    coordinates = a.map((value, axis) => value + (b[axis]! - value) * t) as [number, number, number];
    label = `hrana ${i + 1}–${j + 1}`;
    suffix = `e:${i}:${j}:${t}`;
  }
  if (!coordinates.every(Number.isFinite)) return null;
  return { id: `snap:${owner.id}:${suffix}`, ownerId: owner.id, kind: snap.kind, snap,
    properties: { name: `${owner.properties.name} · ${label}`, crs: owner.properties.crs }, geometry: { point: coordinates } };
}

/** Keep section/measurement references attached to current source geometry after edits and undo. */
export function refreshMeasurementAnchors(
  anchors: readonly MeasurementAnchor[], objects: readonly ModelObject[], hiddenLayerIds: ReadonlySet<string>,
): readonly MeasurementAnchor[] {
  const refreshed = anchors.flatMap((anchor) => {
    const owner = objects.find((object) => object.id === anchor.ownerId && !hiddenLayerIds.has(object.layer_id));
    if (!owner) return [];
    const next = anchor.kind === "point"
      ? owner.type === "civil.point" || owner.type === "stakeout.point" ? pointMeasurementAnchor(owner) : null
      : anchor.snap ? resolveMeasurementSnap([owner], anchor.snap) : null;
    return next ? [next] : [];
  });
  return JSON.stringify(refreshed) === JSON.stringify(anchors) ? anchors : refreshed;
}

export function appendMeasurementAnchor(anchors: readonly MeasurementAnchor[], anchor: MeasurementAnchor): readonly MeasurementAnchor[] {
  if (!anchors.length || anchors[0]!.id === anchor.id) return [anchor];
  return [anchors[0]!, anchor];
}

export interface PointMeasurement {
  readonly horizontalM: number;
  readonly spatialM: number;
  readonly elevationM: number;
  readonly slopePercent: number | null;
  readonly angleDegrees: number | null;
}

/** Distances in the model CRS; camera transforms and display rounding are not inputs. */
export function measureSurveyPoints(a: Pick<MeasurementAnchor, "properties" | "geometry">, b: Pick<MeasurementAnchor, "properties" | "geometry">): PointMeasurement {
  const first = a.properties.crs;
  const second = b.properties.crs;
  if (first.kind !== second.kind || first.epsg !== second.epsg
    || first.axis_order !== second.axis_order || first.horizontal_unit !== second.horizontal_unit
    || first.vertical_unit !== second.vertical_unit || first.vertical_datum !== second.vertical_datum) {
    throw new TypeError("Body A a B nemají shodný souřadnicový a výškový systém.");
  }
  if (![...a.geometry.point, ...b.geometry.point].every(Number.isFinite)) {
    throw new TypeError("Souřadnice měřených bodů musí být konečná čísla.");
  }
  const [dx, dy, dz] = b.geometry.point.map((value, axis) => value - a.geometry.point[axis]!);
  const horizontalM = Math.hypot(dx!, dy!);
  const spatialM = Math.hypot(dx!, dy!, dz!);
  const slopePercent = horizontalM === 0 ? null : (dz! / horizontalM) * 100;
  if (![horizontalM, spatialM, dz].every(Number.isFinite) || (slopePercent !== null && !Number.isFinite(slopePercent))) {
    throw new RangeError("Rozsah souřadnic neumožňuje bezpečně vypočítat měření.");
  }
  return {
    horizontalM, spatialM, elevationM: dz!, slopePercent,
    angleDegrees: spatialM === 0 ? null : Math.atan2(dz!, horizontalM) * 180 / Math.PI,
  };
}

/** The first click selects A; following clicks select or replace B. */
export function measurementSelection(selection: readonly string[], pointId: string): readonly string[] {
  if (!selection.length) return [pointId];
  if (selection[0] === pointId) return [pointId];
  return [selection[0]!, pointId];
}
