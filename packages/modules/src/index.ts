import { constrainCivilTin, hasCivilTinConstraints, remapCivilTinConstraints, type CivilTinConstraints } from "./constrained-tin.js";
import type {
  BuildingObject,
  CadUnderlayView,
  CivilAxisObject,
  CivilMaterialLayerObject,
  CivilPointObject,
  CivilProfileObject,
  CivilSectionPoint,
  CivilSweepObject,
  CivilTools,
  FloorObject,
  ModelObject,
  ModelVersion,
  RoomObject,
  StakeoutPointObject,
  TinSurfaceObject,
} from "@datamine/contracts";
import type { ModuleManifest } from "@datamine/editor-core";
import type { RenderableDescriptor, RenderablePart } from "@datamine/renderer";

export const ROOM_BOUNDARY_CAPABILITY = "rooms.boundary.v1";

export interface RoomBoundaryV1 {
  readonly schemaVersion: "datamine.room-boundary.v1";
  readonly roomId: string;
  readonly sourceVersionId: string;
  readonly sourceRevision: number;
  readonly coordinateSpace: "drawing_m" | "world_m" | "survey_crs";
  readonly floorLevelM: number;
  readonly rings: readonly (readonly (readonly [number, number])[])[];
}

export interface RoomBoundaryCapabilityV1 {
  readonly id: typeof ROOM_BOUNDARY_CAPABILITY;
  project(model: ModelVersion): readonly RoomBoundaryV1[];
}

export interface FloorFromBoundaryInput {
  readonly objectId: string;
  readonly layerId: string;
  readonly name: string | null;
  readonly thicknessM: number;
  readonly sourceDocumentId: string;
  readonly sourceDocumentSha256: string;
  readonly sourceJobId?: string;
  readonly algorithmVersion: string;
}

const cloneRings = (
  rings: RoomObject["geometry"]["rings"],
): readonly (readonly (readonly [number, number])[])[] => Object.freeze(
  rings.map((ring) => Object.freeze(
    ring.map(([x, y]) => Object.freeze([x, y] as const)),
  )),
);

const signedArea = (ring: readonly (readonly [number, number])[]): number => {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const following = ring[(index + 1) % ring.length]!;
    twiceArea += current[0] * following[1] - following[0] * current[1];
  }
  return twiceArea / 2;
};

export const polygonAreaM2 = (
  rings: readonly (readonly (readonly [number, number])[])[],
): number => {
  const [outer, ...holes] = rings;
  if (!outer) throw new TypeError("Polygon nemá vnější ring.");
  const area = Math.abs(signedArea(outer))
    - holes.reduce((sum, ring) => sum + Math.abs(signedArea(ring)), 0);
  if (!Number.isFinite(area) || area <= 1e-9) {
    throw new TypeError("Polygon nemá kladnou konečnou plochu.");
  }
  return area;
};

export function createRoomBoundaryCapability(maxPoints = 100_000): RoomBoundaryCapabilityV1 {
  if (!Number.isInteger(maxPoints) || maxPoints < 3 || maxPoints > 1_000_000) {
    throw new RangeError("Limit capability musí být celé číslo od 3 do 1 000 000.");
  }
  return Object.freeze({
    id: ROOM_BOUNDARY_CAPABILITY,
    project(model: ModelVersion): readonly RoomBoundaryV1[] {
      if (model.status !== "validated") {
        throw new TypeError("Room boundary capability přijímá pouze validated verzi.");
      }
      let points = 0;
      const boundaries: RoomBoundaryV1[] = [];
      for (const object of model.objects) {
        if (
          object.type !== "rooms.room"
          || !object.properties.included
          || !["confirmed", "corrected"].includes(object.properties.review_state)
        ) continue;
        points += object.geometry.rings.reduce((sum, ring) => sum + ring.length, 0);
        if (points > maxPoints) throw new RangeError("Room boundary capability překročila limit bodů.");
        boundaries.push(Object.freeze({
          schemaVersion: "datamine.room-boundary.v1",
          roomId: object.id,
          sourceVersionId: model.id,
          sourceRevision: model.revision,
          coordinateSpace: object.geometry.coordinate_space,
          floorLevelM: object.properties.floor_level_m,
          rings: cloneRings(object.geometry.rings),
        }));
      }
      return Object.freeze(boundaries.sort((left, right) => left.roomId.localeCompare(right.roomId)));
    },
  });
}

export function createFloorFromBoundary(
  boundary: RoomBoundaryV1,
  input: FloorFromBoundaryInput,
): FloorObject {
  if (boundary.schemaVersion !== "datamine.room-boundary.v1") {
    throw new TypeError("Building modul nepodporuje tuto verzi boundary capability.");
  }
  if (!Number.isFinite(input.thicknessM) || input.thicknessM <= 0 || input.thicknessM > 10) {
    throw new RangeError("Tloušťka podlahy je mimo povolený rozsah.");
  }
  const area = polygonAreaM2(boundary.rings);
  const provenance = {
    source_document_id: input.sourceDocumentId,
    source_document_sha256: input.sourceDocumentSha256,
    source_kind: "automatic" as const,
    algorithm_version: input.algorithmVersion,
    ...(input.sourceJobId ? { source_job_id: input.sourceJobId } : {}),
  };
  return {
    schema_version: "datamine.floor-object.v1",
    id: input.objectId,
    type: "building.floor",
    layer_id: input.layerId,
    geometry: {
      kind: "polygon",
      coordinate_space: boundary.coordinateSpace,
      rings: boundary.rings.map((ring) => ring.map(([x, y]) => [x, y])),
    },
    properties: {
      schema_version: "datamine.floor-properties.v1",
      name: input.name,
      thickness_m: input.thicknessM,
      top_level_m: boundary.floorLevelM,
      area_m2: area,
      volume_m3: area * input.thicknessM,
      review_state: "unreviewed",
    },
    provenance,
  };
}

export const roomsModuleManifest: ModuleManifest = Object.freeze({
  id: "rooms",
  version: "1.0.0",
  objectTypes: Object.freeze(["rooms.room"]),
  commandTypes: Object.freeze(["rooms.object.upsert", "rooms.object.remove", "rooms.properties.patch"]),
  providesCapabilities: Object.freeze([ROOM_BOUNDARY_CAPABILITY]),
});

export const buildingModuleManifest: ModuleManifest = Object.freeze({
  id: "building",
  version: "1.0.0",
  objectTypes: Object.freeze(["building.wall", "building.opening", "building.floor"]),
  commandTypes: Object.freeze([
    "building.object.upsert",
    "building.object.remove",
    "building.review.set",
    "building.opening.assign-host",
  ]),
  requiresCapabilities: Object.freeze([ROOM_BOUNDARY_CAPABILITY]),
});

export const civilModuleManifest: ModuleManifest = Object.freeze({
  id: "civil",
  version: "1.0.0",
  objectTypes: Object.freeze(["civil.point", "civil.tin_surface", "civil.material_layer", "civil.axis", "civil.profile", "civil.sweep"]),
  commandTypes: Object.freeze([
    "civil.object.upsert",
    "civil.sweep.commit",
    "civil.object.remove",
    "civil.review.set",
  ]),
});

export const stakeoutModuleManifest: ModuleManifest = Object.freeze({
  id: "stakeout",
  version: "1.0.0",
  objectTypes: Object.freeze(["stakeout.point", "stakeout.group"]),
  commandTypes: Object.freeze([
    "stakeout.point.upsert",
    "stakeout.group.upsert",
    "stakeout.object.remove",
    "stakeout.group.members.set",
    "stakeout.review.set",
  ]),
});

export interface CivilAxisPosition {
  readonly stationM: number;
  readonly point: readonly [number, number, number];
  readonly tangentXY: readonly [number, number];
}

export interface CivilPointInput {
  readonly objectId: string;
  readonly layerId: string;
  readonly name: string;
  readonly sourceDocumentId: string;
  readonly sourceDocumentSha256: string;
  readonly algorithmVersion?: string;
}

export interface CivilTinTriangulationInput extends CivilPointInput, CivilTinConstraints {
  readonly maximumEdgeLengthM?: number;
}

export type CivilSlopeUnit = "percent" | "degrees" | "ratio" | "elevation";
export type CivilSlopeSide = "left" | "right";

export interface CivilSlopeSurfaceInput extends CivilPointInput {
  readonly widthM: number;
  readonly elevationDifferenceM: number;
  readonly side: CivilSlopeSide;
}

const civilPointProvenance = (input: CivilPointInput) => ({
  source_document_id: input.sourceDocumentId,
  source_document_sha256: input.sourceDocumentSha256,
  source_kind: "manual" as const,
  algorithm_version: input.algorithmVersion ?? "civil-point-tools-v1",
});

const validateCivilPointInput = (input: CivilPointInput): void => {
  if (!input.name.trim()) throw new TypeError("Název bodu nesmí být prázdný.");
};

export function createManualCivilPoint(
  point: readonly [number, number, number],
  crs: CivilAxisObject["properties"]["crs"],
  input: CivilPointInput,
): CivilPointObject {
  validateCivilPointInput(input);
  if (!point.every(Number.isFinite)) throw new TypeError("Souřadnice bodu musí být konečná čísla.");
  return {
    schema_version: "datamine.civil-point-object.v1",
    id: input.objectId,
    type: "civil.point",
    layer_id: input.layerId,
    geometry: { kind: "point3d", coordinate_space: "survey_crs", point: [...point] },
    properties: {
      schema_version: "datamine.civil-point-properties.v1",
      name: input.name.trim(), crs: structuredClone(crs),
      derivation: { kind: "manual_coordinates" }, review_state: "unreviewed",
    },
    provenance: civilPointProvenance(input),
  };
}

export type SurveyPointObject = CivilPointObject | StakeoutPointObject;
type RoutePointObject = SurveyPointObject;

const sameCivilCrs = (left: RoutePointObject, right: RoutePointObject): boolean => (
  left.properties.crs.epsg === right.properties.crs.epsg
  && left.properties.crs.vertical_datum === right.properties.crs.vertical_datum
);

const pointMatchesAxisCrs = (point: RoutePointObject, axis: CivilAxisObject): boolean => (
  point.properties.crs.epsg === axis.properties.crs.epsg
  && point.properties.crs.vertical_datum === axis.properties.crs.vertical_datum
);

export interface CivilPointRouteMatch {
  readonly pointId: string;
  readonly order: number;
  readonly stationM: number;
  readonly lateralOffsetM: number;
  readonly horizontalDistanceM: number;
}

export interface CivilPointRouteSelectionOptions {
  readonly toleranceM: number;
  readonly layerIds?: readonly string[];
  readonly elevationRangeM?: readonly [number, number];
  readonly maxResults?: number;
}

const validateRouteSelectionOptions = (
  candidates: readonly RoutePointObject[],
  options: CivilPointRouteSelectionOptions,
): { readonly layers: ReadonlySet<string> | null; readonly maxResults: number } => {
  if (candidates.length > 100_000) throw new RangeError("Výběr v trase podporuje nejvýše 100 000 kandidátů.");
  if (!Number.isFinite(options.toleranceM) || options.toleranceM < 0 || options.toleranceM > 10_000) {
    throw new RangeError("Tolerance výběru musí být od 0 do 10 000 m.");
  }
  const maxResults = options.maxResults ?? 10_000;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100_000) {
    throw new RangeError("Limit výsledků musí být celé číslo od 1 do 100 000.");
  }
  if (options.elevationRangeM) {
    const [minimum, maximum] = options.elevationRangeM;
    if (![minimum, maximum].every(Number.isFinite) || minimum > maximum) {
      throw new RangeError("Výškový rozsah není platný.");
    }
  }
  const layers = options.layerIds ? new Set(options.layerIds) : null;
  if (layers?.has("")) throw new TypeError("ID vrstvy nesmí být prázdné.");
  return Object.freeze({ layers, maxResults });
};

const pointPassesRouteFilters = (
  point: RoutePointObject,
  layers: ReadonlySet<string> | null,
  elevationRangeM?: readonly [number, number],
): boolean => (
  (!layers || layers.has(point.layer_id))
  && (!elevationRangeM || (
    point.geometry.point[2] >= elevationRangeM[0]
    && point.geometry.point[2] <= elevationRangeM[1]
  ))
);

const finalizeRouteMatches = (
  matches: readonly Omit<CivilPointRouteMatch, "order">[],
  maxResults: number,
): readonly CivilPointRouteMatch[] => {
  if (matches.length > maxResults) {
    throw new RangeError(`Výběr v trase překročil limit ${maxResults} bodů.`);
  }
  return Object.freeze([...matches]
    .sort((left, right) => left.stationM - right.stationM || left.pointId.localeCompare(right.pointId))
    .map((match, order) => Object.freeze({ ...match, order: order + 1 })));
};

const selectCivilPointsAlongReferenceLine = (
  start: RoutePointObject,
  end: RoutePointObject,
  candidates: readonly RoutePointObject[],
  options: CivilPointRouteSelectionOptions,
  bounded: boolean,
): readonly CivilPointRouteMatch[] => {
  if (start.id === end.id) throw new TypeError("Výběr v přímce vyžaduje dva různé body.");
  if (!sameCivilCrs(start, end)) throw new TypeError("Koncové body nemají shodné CRS.");
  const { layers, maxResults } = validateRouteSelectionOptions(candidates, options);
  const deltaE = end.geometry.point[0] - start.geometry.point[0];
  const deltaN = end.geometry.point[1] - start.geometry.point[1];
  const lengthSquared = deltaE * deltaE + deltaN * deltaN;
  if (!Number.isFinite(lengthSquared) || lengthSquared <= 1e-18) {
    throw new TypeError("Koncové body netvoří platný horizontální úsek.");
  }
  const length = Math.sqrt(lengthSquared);
  const matches: Omit<CivilPointRouteMatch, "order">[] = [];
  for (const point of candidates) {
    if (!sameCivilCrs(start, point)) throw new TypeError(`Bod ${point.id} nemá shodné CRS.`);
    if (!pointPassesRouteFilters(point, layers, options.elevationRangeM)) continue;
    const relativeE = point.geometry.point[0] - start.geometry.point[0];
    const relativeN = point.geometry.point[1] - start.geometry.point[1];
    const ratio = (relativeE * deltaE + relativeN * deltaN) / lengthSquared;
    if (bounded && (ratio < -1e-12 || ratio > 1 + 1e-12)) continue;
    const lateralOffsetM = (deltaE * relativeN - deltaN * relativeE) / length;
    const horizontalDistanceM = Math.abs(lateralOffsetM);
    if (horizontalDistanceM > options.toleranceM + 1e-9) continue;
    matches.push(Object.freeze({
      pointId: point.id,
      stationM: (bounded ? Math.min(1, Math.max(0, ratio)) : ratio) * length,
      lateralOffsetM,
      horizontalDistanceM,
    }));
  }
  return finalizeRouteMatches(matches, maxResults);
};

export function selectCivilPointsAlongSegment(
  start: RoutePointObject,
  end: RoutePointObject,
  candidates: readonly RoutePointObject[],
  options: CivilPointRouteSelectionOptions,
): readonly CivilPointRouteMatch[] {
  return selectCivilPointsAlongReferenceLine(start, end, candidates, options, true);
}

export function selectCivilPointsAlongLine(
  start: RoutePointObject,
  end: RoutePointObject,
  candidates: readonly RoutePointObject[],
  options: CivilPointRouteSelectionOptions,
): readonly CivilPointRouteMatch[] {
  return selectCivilPointsAlongReferenceLine(start, end, candidates, options, false);
}

const normalizedPointSeriesName = (name: string): string => name.normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("cs-CZ")
  .replace(/[^a-z0-9]+/g, " ").trim();

const civilPointSeriesKey = (point: RoutePointObject): string | null => {
  const normalized = normalizedPointSeriesName(point.properties.name);
  const match = normalized.match(/(?:^|\s)(levy okraj|pravy okraj|osa)(?:\s|$)/u);
  return match?.[1]?.replace(" ", "_") ?? null;
};

const civilPointSeriesStation = (point: RoutePointObject, fallback: number): number => {
  const station = point.properties.name.match(/(?:^|\s)km\s*(\d+(?:[.,]\d+)?)(?:\s|$)/iu);
  if (station?.[1]) {
    const value = Number(station[1].replace(",", ".")) * 1_000;
    if (Number.isFinite(value)) return value;
  }
  const derivation = point.properties.derivation;
  if (derivation.kind === "document_import") return derivation.row;
  if (derivation.kind === "axis_station_offset" || derivation.kind === "profile_station_offset") return derivation.station_m;
  return fallback;
};

export function selectCivilPointsInSeries(
  reference: RoutePointObject,
  candidates: readonly RoutePointObject[],
  options: Pick<CivilPointRouteSelectionOptions, "maxResults"> = {},
): readonly CivilPointRouteMatch[] {
  const { maxResults } = validateRouteSelectionOptions(candidates, { toleranceM: 0, ...options });
  const seriesKey = civilPointSeriesKey(reference);
  const matches: Omit<CivilPointRouteMatch, "order">[] = [];
  candidates.forEach((point, index) => {
    if (point.layer_id !== reference.layer_id || civilPointSeriesKey(point) !== seriesKey) return;
    if (!sameCivilCrs(reference, point)) throw new TypeError(`Bod ${point.id} nemá shodné CRS.`);
    matches.push(Object.freeze({
      pointId: point.id,
      stationM: civilPointSeriesStation(point, index),
      lateralOffsetM: 0,
      horizontalDistanceM: 0,
    }));
  });
  return finalizeRouteMatches(matches, maxResults);
}

export function selectCivilPointsAlongAxis(
  axis: CivilAxisObject,
  candidates: readonly RoutePointObject[],
  stationRangeM: readonly [number, number],
  options: CivilPointRouteSelectionOptions,
): readonly CivilPointRouteMatch[] {
  const { layers, maxResults } = validateRouteSelectionOptions(candidates, options);
  const [rangeStart, rangeEnd] = stationRangeM;
  if (![rangeStart, rangeEnd].every(Number.isFinite) || rangeStart > rangeEnd) {
    throw new RangeError("Rozsah staničení není platný.");
  }
  const stations = civilAxisStations(axis);
  if (rangeStart < stations[0]! - 1e-9 || rangeEnd > stations.at(-1)! + 1e-9) {
    throw new RangeError("Rozsah staničení leží mimo osu; extrapolace není povolena.");
  }
  const matches: Omit<CivilPointRouteMatch, "order">[] = [];
  for (const point of candidates) {
    if (!pointMatchesAxisCrs(point, axis)) throw new TypeError(`Bod ${point.id} nemá shodné CRS s osou.`);
    if (!pointPassesRouteFilters(point, layers, options.elevationRangeM)) continue;
    let closest: Omit<CivilPointRouteMatch, "order" | "pointId"> | null = null;
    for (let index = 0; index < axis.geometry.points.length - 1; index += 1) {
      const first = axis.geometry.points[index]!;
      const second = axis.geometry.points[index + 1]!;
      const deltaE = second[0] - first[0];
      const deltaN = second[1] - first[1];
      const segmentLength = stations[index + 1]! - stations[index]!;
      const relativeE = point.geometry.point[0] - first[0];
      const relativeN = point.geometry.point[1] - first[1];
      const ratio = (relativeE * deltaE + relativeN * deltaN) / (segmentLength * segmentLength);
      if (ratio < -1e-12 || ratio > 1 + 1e-12) continue;
      const stationM = stations[index]! + Math.min(1, Math.max(0, ratio)) * segmentLength;
      if (stationM < rangeStart - 1e-9 || stationM > rangeEnd + 1e-9) continue;
      const lateralOffsetM = (deltaE * relativeN - deltaN * relativeE) / segmentLength;
      const horizontalDistanceM = Math.abs(lateralOffsetM);
      const candidate = { stationM, lateralOffsetM, horizontalDistanceM };
      if (!closest || horizontalDistanceM < closest.horizontalDistanceM - 1e-9
        || Math.abs(horizontalDistanceM - closest.horizontalDistanceM) <= 1e-9 && stationM < closest.stationM) {
        closest = candidate;
      }
    }
    if (closest && closest.horizontalDistanceM <= options.toleranceM + 1e-9) {
      matches.push(Object.freeze({ pointId: point.id, ...closest }));
    }
  }
  return finalizeRouteMatches(matches, maxResults);
}

export function interpolateCivilPoint(
  start: CivilPointObject,
  end: CivilPointObject,
  ratio: number,
  input: CivilPointInput,
): CivilPointObject {
  validateCivilPointInput(input);
  const point = interpolateSurveyPointCoordinates(start, end, ratio);
  const result = createManualCivilPoint(point, start.properties.crs, input);
  return {
    ...result,
    properties: {
      ...result.properties,
      derivation: { kind: "segment_interpolation", start_point_id: start.id, end_point_id: end.id, ratio },
    },
  };
}

export function interpolateSurveyPointCoordinates(
  start: SurveyPointObject,
  end: SurveyPointObject,
  ratio: number,
): readonly [number, number, number] {
  if (start.id === end.id) throw new TypeError("Zhuštění vyžaduje dva různé body.");
  if (!sameCivilCrs(start, end)) throw new TypeError("Body nemají shodné CRS.");
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) throw new RangeError("Poměr musí ležet uvnitř úseku.");
  return Object.freeze(start.geometry.point.map((coordinate, index) => (
    coordinate + (end.geometry.point[index]! - coordinate) * ratio
  )) as [number, number, number]);
}

export type CivilDensifyOptions =
  | { readonly internalPointCount: number }
  | { readonly spacingM: number };

export function densifyCivilSegment(
  start: CivilPointObject,
  end: CivilPointObject,
  options: CivilDensifyOptions,
  inputForIndex: (index: number) => CivilPointInput,
): readonly CivilPointObject[] {
  const length = Math.hypot(...start.geometry.point.map((coordinate, index) => end.geometry.point[index]! - coordinate));
  if (!Number.isFinite(length) || length <= 1e-9) throw new TypeError("Nelze zhustit degenerovaný úsek.");
  let count: number;
  if ("internalPointCount" in options) {
    count = options.internalPointCount;
    if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new RangeError("Počet nových bodů musí být od 1 do 10 000.");
  } else {
    if (!Number.isFinite(options.spacingM) || options.spacingM <= 0) throw new RangeError("Rozteč musí být kladná.");
    count = Math.ceil(length / options.spacingM) - 1;
    if (count < 1) return Object.freeze([]);
    if (count > 10_000) throw new RangeError("Zhuštění by vytvořilo více než 10 000 bodů.");
  }
  return Object.freeze(Array.from({ length: count }, (_, index) => (
    interpolateCivilPoint(start, end, (index + 1) / (count + 1), inputForIndex(index))
  )));
}

export function createCivilPointOnAxis(
  axis: CivilAxisObject,
  stationM: number,
  lateralOffsetM: number,
  elevationOffsetM: number,
  input: CivilPointInput,
): CivilPointObject {
  validateCivilPointInput(input);
  if (![stationM, lateralOffsetM, elevationOffsetM].every(Number.isFinite)) throw new TypeError("Parametry bodu na ose musí být konečná čísla.");
  if (Math.abs(lateralOffsetM) > 10_000 || Math.abs(elevationOffsetM) > 1_000) throw new RangeError("Odsazení bodu je mimo povolený rozsah.");
  const position = civilAxisPositionAt(axis, stationM);
  const point: [number, number, number] = [
    position.point[0] - position.tangentXY[1] * lateralOffsetM,
    position.point[1] + position.tangentXY[0] * lateralOffsetM,
    position.point[2] + elevationOffsetM,
  ];
  const result = createManualCivilPoint(point, axis.properties.crs, input);
  return {
    ...result,
    properties: {
      ...result.properties,
      derivation: { kind: "axis_station_offset", axis_id: axis.id, station_m: stationM, lateral_offset_m: lateralOffsetM, elevation_offset_m: elevationOffsetM },
    },
  };
}

const signedBoundaryArea = (vertices: readonly (readonly [number, number, number])[]): number => {
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const following = vertices[(index + 1) % vertices.length]!;
    twiceArea += current[0] * following[1] - following[0] * current[1];
  }
  return twiceArea / 2;
};

const orientationXY = (
  first: readonly [number, number, number],
  second: readonly [number, number, number],
  third: readonly [number, number, number],
): number => (second[0] - first[0]) * (third[1] - first[1])
  - (second[1] - first[1]) * (third[0] - first[0]);

const pointInTriangleXY = (
  point: readonly [number, number, number],
  first: readonly [number, number, number],
  second: readonly [number, number, number],
  third: readonly [number, number, number],
): boolean => (
  orientationXY(first, second, point) >= -1e-12
  && orientationXY(second, third, point) >= -1e-12
  && orientationXY(third, first, point) >= -1e-12
);

const segmentsIntersectXY = (
  firstStart: readonly [number, number, number],
  firstEnd: readonly [number, number, number],
  secondStart: readonly [number, number, number],
  secondEnd: readonly [number, number, number],
): boolean => {
  const firstA = orientationXY(firstStart, firstEnd, secondStart);
  const firstB = orientationXY(firstStart, firstEnd, secondEnd);
  const secondA = orientationXY(secondStart, secondEnd, firstStart);
  const secondB = orientationXY(secondStart, secondEnd, firstEnd);
  return firstA * firstB <= 1e-18 && secondA * secondB <= 1e-18;
};

const triangulateSimpleCivilBoundary = (
  vertices: readonly (readonly [number, number, number])[],
): readonly (readonly [number, number, number])[] => {
  for (let first = 0; first < vertices.length; first += 1) {
    const firstNext = (first + 1) % vertices.length;
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondNext = (second + 1) % vertices.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersectXY(vertices[first]!, vertices[firstNext]!, vertices[second]!, vertices[secondNext]!)) {
        throw new TypeError("Hranice povrchu se sama protíná.");
      }
    }
  }
  const area = signedBoundaryArea(vertices);
  if (!Number.isFinite(area) || Math.abs(area) <= 1e-9) throw new TypeError("Hranice povrchu nemá kladnou plochu.");
  const remaining = Array.from({ length: vertices.length }, (_, index) => index);
  if (area < 0) remaining.reverse();
  const faces: [number, number, number][] = [];
  while (remaining.length > 3) {
    let earIndex = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index - 1 + remaining.length) % remaining.length]!;
      const current = remaining[index]!;
      const following = remaining[(index + 1) % remaining.length]!;
      if (orientationXY(vertices[previous]!, vertices[current]!, vertices[following]!) <= 1e-12) continue;
      const containsPoint = remaining.some((candidate) => (
        candidate !== previous && candidate !== current && candidate !== following
        && pointInTriangleXY(vertices[candidate]!, vertices[previous]!, vertices[current]!, vertices[following]!)
      ));
      if (!containsPoint) { earIndex = index; break; }
    }
    if (earIndex < 0) throw new TypeError("Hranici povrchu nelze bezpečně triangulovat.");
    const previous = remaining[(earIndex - 1 + remaining.length) % remaining.length]!;
    const current = remaining[earIndex]!;
    const following = remaining[(earIndex + 1) % remaining.length]!;
    faces.push([previous, current, following]);
    remaining.splice(earIndex, 1);
  }
  faces.push([remaining[0]!, remaining[1]!, remaining[2]!]);
  return Object.freeze(faces.map((face) => Object.freeze(face)));
};

export function createCivilTinSurfaceFromBoundary(
  boundaryPoints: readonly RoutePointObject[],
  input: CivilPointInput,
): TinSurfaceObject {
  validateCivilPointInput(input);
  if (boundaryPoints.length < 3 || boundaryPoints.length > 2_000) {
    throw new RangeError("Povrch vyžaduje 3 až 2 000 uspořádaných hraničních bodů.");
  }
  const reference = boundaryPoints[0]!;
  if (boundaryPoints.some((point) => !sameCivilCrs(reference, point))) {
    throw new TypeError("Body povrchu nemají shodné CRS.");
  }
  const vertices = boundaryPoints.map((point) => [...point.geometry.point] as [number, number, number]);
  if (new Set(vertices.map((point) => `${point[0]}:${point[1]}`)).size !== vertices.length) {
    throw new TypeError("Hranice povrchu obsahuje duplicitní XY souřadnice.");
  }
  const faces = triangulateSimpleCivilBoundary(vertices);
  const minimum = [0, 1, 2].map((axis) => Math.min(...vertices.map((point) => point[axis]!))) as [number, number, number];
  const maximum = [0, 1, 2].map((axis) => Math.max(...vertices.map((point) => point[axis]!))) as [number, number, number];
  return {
    schema_version: "datamine.tin-surface-object.v1",
    id: input.objectId,
    type: "civil.tin_surface",
    layer_id: input.layerId,
    geometry: {
      kind: "indexed_tin", coordinate_space: "survey_crs",
      vertices, faces: faces.map((face) => [...face]), bounds: { min: minimum, max: maximum },
    },
    properties: {
      schema_version: "datamine.tin-surface-properties.v1",
      name: input.name.trim(), crs: structuredClone(reference.properties.crs), review_state: "unreviewed",
    },
    provenance: {
      ...civilPointProvenance(input),
      algorithm_version: input.algorithmVersion ?? "civil-boundary-ear-clipping-v1",
    },
  };
}

const delaunayCivilPointCloud = (
  vertices: readonly (readonly [number, number, number])[],
): readonly (readonly [number, number, number])[] => {
  const originX = Math.min(...vertices.map((point) => point[0]));
  const originY = Math.min(...vertices.map((point) => point[1]));
  const coordinates = vertices.map((point) => [point[0] - originX, point[1] - originY] as const);
  const maximumX = Math.max(...coordinates.map((point) => point[0]));
  const maximumY = Math.max(...coordinates.map((point) => point[1]));
  const extent = Math.max(maximumX, maximumY);
  if (!Number.isFinite(extent) || extent <= 1e-9) throw new TypeError("Body povrchu neleží v ploše XY.");
  const centerX = maximumX / 2;
  const centerY = maximumY / 2;
  const allCoordinates: [number, number][] = [
    ...coordinates.map((point) => [point[0], point[1]] as [number, number]),
    [centerX - 20 * extent, centerY - extent],
    [centerX, centerY + 20 * extent],
    [centerX + 20 * extent, centerY - extent],
  ];
  type Triangle = [number, number, number];
  let triangles: Triangle[] = [[vertices.length, vertices.length + 1, vertices.length + 2]];

  const circumcircle = (triangle: Triangle): readonly [number, number, number] | null => {
    const [first, second, third] = triangle.map((index) => allCoordinates[index]!) as [
      [number, number], [number, number], [number, number],
    ];
    const divisor = 2 * (first[0] * (second[1] - third[1])
      + second[0] * (third[1] - first[1]) + third[0] * (first[1] - second[1]));
    if (Math.abs(divisor) <= 1e-12) return null;
    const firstSquared = first[0] ** 2 + first[1] ** 2;
    const secondSquared = second[0] ** 2 + second[1] ** 2;
    const thirdSquared = third[0] ** 2 + third[1] ** 2;
    const centerCircleX = (firstSquared * (second[1] - third[1])
      + secondSquared * (third[1] - first[1]) + thirdSquared * (first[1] - second[1])) / divisor;
    const centerCircleY = (firstSquared * (third[0] - second[0])
      + secondSquared * (first[0] - third[0]) + thirdSquared * (second[0] - first[0])) / divisor;
    return [centerCircleX, centerCircleY, (first[0] - centerCircleX) ** 2 + (first[1] - centerCircleY) ** 2];
  };

  for (let pointIndex = 0; pointIndex < vertices.length; pointIndex += 1) {
    const point = allCoordinates[pointIndex]!;
    const rejected = triangles.filter((triangle) => {
      const circle = circumcircle(triangle);
      return circle !== null
        && (point[0] - circle[0]) ** 2 + (point[1] - circle[1]) ** 2 <= circle[2] + 1e-9;
    });
    const edges = new Map<string, { edge: [number, number]; count: number }>();
    for (const triangle of rejected) {
      for (const edge of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]] as const) {
        const key = edge[0] < edge[1] ? `${edge[0]}:${edge[1]}` : `${edge[1]}:${edge[0]}`;
        const existing = edges.get(key);
        if (existing) existing.count += 1;
        else edges.set(key, { edge: [edge[0], edge[1]], count: 1 });
      }
    }
    const rejectedSet = new Set(rejected);
    triangles = triangles.filter((triangle) => !rejectedSet.has(triangle));
    for (const { edge, count } of edges.values()) {
      if (count === 1) triangles.push([edge[0], edge[1], pointIndex]);
    }
  }

  const faces = triangles
    .filter((triangle) => triangle.every((index) => index < vertices.length))
    .map((triangle): Triangle => orientationXY(vertices[triangle[0]]!, vertices[triangle[1]]!, vertices[triangle[2]]!) > 0
      ? triangle : [triangle[0], triangle[2], triangle[1]])
    .filter((triangle) => orientationXY(vertices[triangle[0]]!, vertices[triangle[1]]!, vertices[triangle[2]]!) > 1e-12);
  if (!faces.length) throw new TypeError("Vybrané body nelze triangulovat; jsou pravděpodobně kolineární.");
  return Object.freeze(faces.map((face) => Object.freeze(face)));
};

const horizontalEdgeLength = (
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number => Math.hypot(second[0] - first[0], second[1] - first[1]);

export function suggestCivilTinMaximumEdgeLength(points: readonly RoutePointObject[]): number {
  if (points.length < 3) throw new RangeError("Návrh limitu hrany vyžaduje nejméně tři body.");
  const nearestDistances = points.map((point, index) => Math.min(...points
    .filter((_, candidateIndex) => candidateIndex !== index)
    .map((candidate) => horizontalEdgeLength(point.geometry.point, candidate.geometry.point))
    .filter((distance) => distance > 1e-9)));
  if (nearestDistances.some((distance) => !Number.isFinite(distance))) {
    throw new TypeError("Pro body nelze určit bezpečnou místní rozteč.");
  }
  const sorted = [...nearestDistances].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return Math.max(median * 4, 0.001);
}

export function civilTinSurfaceAreas(surface: TinSurfaceObject): Readonly<{ planM2: number; surfaceM2: number }> {
  let planM2 = 0;
  let surfaceM2 = 0;
  for (const [firstIndex, secondIndex, thirdIndex] of surface.geometry.faces) {
    const first = surface.geometry.vertices[firstIndex]!;
    const second = surface.geometry.vertices[secondIndex]!;
    const third = surface.geometry.vertices[thirdIndex]!;
    planM2 += Math.abs(orientationXY(first, second, third)) / 2;
    const ab = [second[0] - first[0], second[1] - first[1], second[2] - first[2]] as const;
    const ac = [third[0] - first[0], third[1] - first[1], third[2] - first[2]] as const;
    surfaceM2 += Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ) / 2;
  }
  return Object.freeze({ planM2, surfaceM2 });
}

export function civilSlopeElevationDifference(
  widthM: number,
  unit: CivilSlopeUnit,
  value: number,
): number {
  if (!Number.isFinite(widthM) || widthM <= 0 || widthM > 10_000) {
    throw new RangeError("Šířka šikmé plochy musí být větší než 0 a nejvýše 10 000 m.");
  }
  if (!Number.isFinite(value)) throw new TypeError("Sklon musí být konečné číslo.");
  if (!["percent", "degrees", "ratio", "elevation"].includes(unit)) {
    throw new TypeError("Vyjádření sklonu není podporované.");
  }
  let difference: number;
  if (unit === "percent") {
    if (Math.abs(value) > 100_000) throw new RangeError("Sklon v procentech je mimo povolený rozsah.");
    difference = widthM * value / 100;
  } else if (unit === "degrees") {
    if (Math.abs(value) >= 89) throw new RangeError("Úhel musí být větší než −89° a menší než 89°.");
    difference = widthM * Math.tan(value * Math.PI / 180);
  } else if (unit === "ratio") {
    if (Math.abs(value) < 0.001 || Math.abs(value) > 1_000_000) {
      throw new RangeError("Poměr 1:n vyžaduje nenulové n v rozsahu ±0,001 až ±1 000 000.");
    }
    difference = widthM / value;
  } else {
    difference = value;
  }
  if (!Number.isFinite(difference) || Math.abs(difference) > 1_000) {
    throw new RangeError("Výškový rozdíl šikmé plochy musí být nejvýše ±1 000 m.");
  }
  return difference;
}

const offsetCivilPolyline = (
  points: readonly (readonly [number, number, number])[],
  signedOffsetM: number,
  elevationDifferenceM: number,
): readonly (readonly [number, number, number])[] => {
  if (points.length < 2 || points.length > 10_000) {
    throw new RangeError("Referenční hrana vyžaduje 2 až 10 000 bodů.");
  }
  if (points.some((point) => !point.every(Number.isFinite))) {
    throw new TypeError("Referenční hrana obsahuje neplatné souřadnice.");
  }
  const normals = points.slice(1).map((point, index) => {
    const previous = points[index]!;
    const deltaX = point[0] - previous[0];
    const deltaY = point[1] - previous[1];
    const length = Math.hypot(deltaX, deltaY);
    if (length <= 1e-9) throw new TypeError("Referenční hrana obsahuje degenerovaný horizontální segment.");
    return Object.freeze([-deltaY / length, deltaX / length] as const);
  });
  return Object.freeze(points.map((point, index) => {
    const previousNormal = normals[Math.max(0, index - 1)]!;
    const nextNormal = normals[Math.min(normals.length - 1, index)]!;
    let normalX = previousNormal[0] + nextNormal[0];
    let normalY = previousNormal[1] + nextNormal[1];
    let length = Math.hypot(normalX, normalY);
    if (index === 0) {
      normalX = nextNormal[0];
      normalY = nextNormal[1];
      length = 1;
    } else if (index === points.length - 1) {
      normalX = previousNormal[0];
      normalY = previousNormal[1];
      length = 1;
    } else if (length <= 1e-6) {
      throw new TypeError("Referenční osa se obrací o 180°; šikmou plochu nelze bezpečně odsadit.");
    }
    const miterX = normalX / length;
    const miterY = normalY / length;
    const alignment = miterX * nextNormal[0] + miterY * nextNormal[1];
    if (alignment <= 0.1) throw new TypeError("Lom referenční osy je pro zadanou šířku příliš ostrý.");
    const miterOffset = signedOffsetM / alignment;
    if (Math.abs(miterOffset) > Math.abs(signedOffsetM) * 10) {
      throw new TypeError("Odsazení v ostrém lomu by vytvořilo nestabilní geometrii.");
    }
    return Object.freeze([
      point[0] + miterX * miterOffset,
      point[1] + miterY * miterOffset,
      point[2] + elevationDifferenceM,
    ] as const);
  }));
};

export function createCivilSlopeSurface(
  referencePoints: readonly (readonly [number, number, number])[],
  crs: CivilAxisObject["properties"]["crs"],
  input: CivilSlopeSurfaceInput,
): TinSurfaceObject {
  validateCivilPointInput(input);
  if (input.side !== "left" && input.side !== "right") {
    throw new TypeError("Strana šikmé plochy musí být vlevo nebo vpravo.");
  }
  if (!Number.isFinite(input.widthM) || input.widthM <= 0 || input.widthM > 10_000) {
    throw new RangeError("Šířka šikmé plochy musí být větší než 0 a nejvýše 10 000 m.");
  }
  if (!Number.isFinite(input.elevationDifferenceM) || Math.abs(input.elevationDifferenceM) > 1_000) {
    throw new RangeError("Výškový rozdíl šikmé plochy musí být nejvýše ±1 000 m.");
  }
  const base = referencePoints.map((point) => Object.freeze([...point] as [number, number, number]));
  const signedOffsetM = input.side === "left" ? input.widthM : -input.widthM;
  const outer = offsetCivilPolyline(base, signedOffsetM, input.elevationDifferenceM);
  const vertices = [...base, ...outer].map((point) => [...point] as [number, number, number]);
  if (new Set(vertices.map((point) => `${point[0]}:${point[1]}`)).size !== vertices.length) {
    throw new TypeError("Šikmá plocha vytváří duplicitní XY souřadnice; změňte stranu nebo šířku.");
  }
  const faces: [number, number, number][] = [];
  const normalizedFace = (face: [number, number, number]): [number, number, number] => {
    const orientation = orientationXY(vertices[face[0]]!, vertices[face[1]]!, vertices[face[2]]!);
    if (Math.abs(orientation) <= 1e-12) throw new TypeError("Šikmá plocha obsahuje degenerovaný trojúhelník.");
    return orientation > 0 ? face : [face[0], face[2], face[1]];
  };
  for (let index = 0; index < base.length - 1; index += 1) {
    const outerIndex = base.length + index;
    faces.push(
      normalizedFace([index, index + 1, outerIndex + 1]),
      normalizedFace([index, outerIndex + 1, outerIndex]),
    );
  }
  const minimum = [0, 1, 2].map((axis) => Math.min(...vertices.map((point) => point[axis]!))) as [number, number, number];
  const maximum = [0, 1, 2].map((axis) => Math.max(...vertices.map((point) => point[axis]!))) as [number, number, number];
  return {
    schema_version: "datamine.tin-surface-object.v1",
    id: input.objectId,
    type: "civil.tin_surface",
    layer_id: input.layerId,
    geometry: { kind: "indexed_tin", coordinate_space: "survey_crs", vertices, faces, bounds: { min: minimum, max: maximum } },
    properties: {
      schema_version: "datamine.tin-surface-properties.v1",
      name: input.name.trim(), crs: structuredClone(crs), review_state: "unreviewed",
    },
    provenance: {
      ...civilPointProvenance(input),
      algorithm_version: input.algorithmVersion ?? "civil-slope-strip-v1",
    },
  };
}

export function createCivilTinSurfaceFromPoints(
  points: readonly RoutePointObject[],
  input: CivilTinTriangulationInput,
): TinSurfaceObject {
  validateCivilPointInput(input);
  if (points.length < 3 || points.length > 2_000) {
    throw new RangeError("Triangulace vyžaduje 3 až 2 000 bodů.");
  }
  const reference = points[0]!;
  if (points.some((point) => !sameCivilCrs(reference, point))) {
    throw new TypeError("Body povrchu nemají shodné CRS.");
  }
  // Imported segment endpoints may describe the very same survey point twice.
  // Merge exact XYZ only for triangulation; never move/delete model objects or
  // average elevations. Original indexes remain authoritative for constraints.
  const vertices: [number, number, number][] = [];
  const byXY = new Map<string, number>();
  const vertexIndexes = points.map((point, sourceIndex) => {
    const xyz = point.geometry.point;
    if (!xyz.every(Number.isFinite)) throw new TypeError("Body povrchu obsahují neplatné souřadnice.");
    const key = `${xyz[0]}:${xyz[1]}`;
    const existing = byXY.get(key);
    if (existing !== undefined) {
      if (vertices[existing]![2] !== xyz[2]) {
        throw new TypeError(`Triangulace obsahuje duplicitní XY souřadnice s rozdílnou výškou u bodu ${sourceIndex + 1} (${point.properties.name}). Jeden TIN může mít v každé poloze XY jen jednu výšku; konstrukční vrstvy nad sebou triangulujte samostatně.`);
      }
      return existing;
    }
    byXY.set(key, vertices.length);
    vertices.push([...xyz]);
    return vertices.length - 1;
  });
  if (vertices.length < 3) throw new RangeError("Triangulace vyžaduje nejméně tři různé polohy XY.");
  if (input.maximumEdgeLengthM !== undefined
    && (!Number.isFinite(input.maximumEdgeLengthM) || input.maximumEdgeLengthM <= 0 || input.maximumEdgeLengthM > 10_000_000)) {
    throw new RangeError("Maximální délka hrany musí být větší než 0 a nejvýše 10 000 000 m.");
  }
  if (vertices.some((point) => !point.every(Number.isFinite))) throw new TypeError("Body povrchu obsahují neplatné souřadnice.");
  const constrained = hasCivilTinConstraints(input);
  const constraints = vertices.length === points.length ? input : remapCivilTinConstraints(input, vertexIndexes);
  const candidateFaces = constrained ? constrainCivilTin(vertices, constraints) : delaunayCivilPointCloud(vertices);
  const faces = input.maximumEdgeLengthM === undefined ? candidateFaces : candidateFaces.filter((face) => (
    [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]].every(([first, second]) => (
      horizontalEdgeLength(vertices[first!]!, vertices[second!]!) <= input.maximumEdgeLengthM! + 1e-9
    ))
  ));
  if (constrained && faces.length !== candidateFaces.length) {
    throw new TypeError("Limit délky hrany by porušil obvod nebo lomové hrany TIN. Zvyšte limit nebo zahustěte vstupní body.");
  }
  if (!faces.length) {
    throw new TypeError("Po použití maximální délky hrany nezůstal žádný trojúhelník. Zvyšte limit nebo upravte výběr vrstev.");
  }
  // Constraints refer to original point indexes while triangulating. The final
  // mesh, bounds and vertex exports must contain only the resulting surface.
  const usedIndexes = new Set(faces.flat());
  const originalIndexes = vertices.map((_, index) => index).filter((index) => !constrained || usedIndexes.has(index));
  const compactIndexes = new Map(originalIndexes.map((originalIndex, compactIndex) => [originalIndex, compactIndex]));
  const surfaceVertices = originalIndexes.map((index) => vertices[index]!);
  const surfaceFaces = faces.map((face) => face.map((index) => compactIndexes.get(index)!) as [number, number, number]);
  const minimum = [0, 1, 2].map((axis) => Math.min(...surfaceVertices.map((point) => point[axis]!))) as [number, number, number];
  const maximum = [0, 1, 2].map((axis) => Math.max(...surfaceVertices.map((point) => point[axis]!))) as [number, number, number];
  return {
    schema_version: "datamine.tin-surface-object.v1",
    id: input.objectId,
    type: "civil.tin_surface",
    layer_id: input.layerId,
    geometry: { kind: "indexed_tin", coordinate_space: "survey_crs", vertices: surfaceVertices, faces: surfaceFaces, bounds: { min: minimum, max: maximum } },
    properties: {
      schema_version: "datamine.tin-surface-properties.v1",
      name: input.name.trim(), crs: structuredClone(reference.properties.crs), review_state: "unreviewed",
    },
    provenance: { ...civilPointProvenance(input), algorithm_version: input.algorithmVersion ?? (constrained ? "civil-constrained-edge-recovery-v1" : "civil-delaunay-max-edge-v2") },
  };
}

export interface CivilMaterialLayerInput extends CivilPointInput {
  readonly materialCode: string;
  readonly thicknessM: number;
  readonly topOffsetM?: number;
  readonly assembly?: { readonly id: string; readonly order: number };
}

export function createCivilMaterialLayerFromSurface(
  topSurface: TinSurfaceObject,
  input: CivilMaterialLayerInput,
): CivilMaterialLayerObject {
  validateCivilPointInput(input);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/.test(input.materialCode)) {
    throw new TypeError("Kód materiálu není platný.");
  }
  if (!Number.isFinite(input.thicknessM) || input.thicknessM <= 0 || input.thicknessM > 1_000) {
    throw new RangeError("Tloušťka vrstvy musí být větší než 0 a nejvýše 1 000 m.");
  }
  const topCount = topSurface.geometry.vertices.length;
  const offset = input.topOffsetM ?? 0;
  if (!Number.isFinite(offset) || offset < 0 || offset > 1_000) throw new RangeError("Hloubka horní hrany musí být mezi 0 a 1 000 m.");
  if (input.assembly && (!/^assembly_[A-Za-z0-9_-]{1,63}$/.test(input.assembly.id)
    || !Number.isInteger(input.assembly.order) || input.assembly.order < 0 || input.assembly.order > 19)) {
    throw new TypeError("Identifikace nebo pořadí skladby není platné.");
  }
  if (topCount * 2 > 100_000) throw new RangeError("Triangulovaná vrstva by překročila limit 100 000 vrcholů.");
  const vertices: [number, number, number][] = [
    ...topSurface.geometry.vertices.map((point) => [point[0], point[1], point[2] - offset] as [number, number, number]),
    ...topSurface.geometry.vertices.map((point) => [point[0], point[1], point[2] - offset - input.thicknessM] as [number, number, number]),
  ];
  if (vertices.some((point) => !point.every(Number.isFinite) || Math.abs(point[0]) > 100_000_000
    || Math.abs(point[1]) > 100_000_000 || Math.abs(point[2]) > 100_000)) throw new RangeError("Objemová vrstva leží mimo povolený rozsah souřadnic modelu.");
  const faces: [number, number, number][] = [];
  for (const [first, second, third] of topSurface.geometry.faces) {
    faces.push([first, second, third], [third + topCount, second + topCount, first + topCount]);
  }
  const edges = new Map<string, { count: number; directed: readonly [number, number] }>();
  for (const face of topSurface.geometry.faces) {
    for (const directed of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] as const) {
      const key = directed[0] < directed[1] ? `${directed[0]}:${directed[1]}` : `${directed[1]}:${directed[0]}`;
      const current = edges.get(key);
      edges.set(key, { count: (current?.count ?? 0) + 1, directed });
    }
  }
  for (const { count, directed: [first, second] } of edges.values()) {
    if (count !== 1) continue;
    faces.push([first, first + topCount, second], [second, first + topCount, second + topCount]);
  }
  if (faces.length > 200_000) throw new RangeError("Triangulovaná vrstva by překročila limit 200 000 faces.");
  const minimum = [0, 1, 2].map((axis) => Math.min(...vertices.map((point) => point[axis]!))) as [number, number, number];
  const maximum = [0, 1, 2].map((axis) => Math.max(...vertices.map((point) => point[axis]!))) as [number, number, number];
  const projectedAreaM2 = topSurface.geometry.faces.reduce((sum, face) => (
    sum + orientationXY(
      topSurface.geometry.vertices[face[0]]!,
      topSurface.geometry.vertices[face[1]]!,
      topSurface.geometry.vertices[face[2]]!,
    ) / 2
  ), 0);
  return {
    schema_version: "datamine.civil-material-layer-object.v1",
    id: input.objectId, type: "civil.material_layer", layer_id: input.layerId,
    geometry: { kind: "indexed_mesh", coordinate_space: "survey_crs", vertices, faces, bounds: { min: minimum, max: maximum } },
    properties: {
      schema_version: "datamine.civil-material-layer-properties.v1",
      name: input.name.trim(), material_code: input.materialCode,
      crs: structuredClone(topSurface.properties.crs),
      derivation: { kind: "constant_thickness", top_surface_id: topSurface.id, thickness_m: input.thicknessM,
        ...(input.topOffsetM !== undefined ? { top_offset_m: offset } : {}), ...(input.assembly ? { assembly: { ...input.assembly } } : {}) },
      volume_m3: projectedAreaM2 * input.thicknessM,
      review_state: "unreviewed",
    },
    provenance: {
      ...civilPointProvenance(input),
      algorithm_version: input.algorithmVersion ?? "civil-material-layer-v1",
    },
  };
}

/** Ordered, closed solids beneath one reference surface. Thickness is vertical, in metres. */
export function createCivilMaterialAssemblyFromSurface(
  surface: TinSurfaceObject, assemblyId: string, inputs: readonly CivilMaterialLayerInput[],
): readonly CivilMaterialLayerObject[] {
  if (!inputs.length || inputs.length > 20) throw new RangeError("Skladba musí obsahovat 1 až 20 vrstev.");
  if (new Set(inputs.map((input) => input.objectId)).size !== inputs.length
    || new Set(inputs.map((input) => input.layerId)).size !== inputs.length
    || inputs.some((input) => input.objectId === surface.id)) throw new TypeError("Každá vrstva skladby musí mít vlastní identifikaci.");
  if (surface.geometry.vertices.length * inputs.length * 2 > 100_000) throw new RangeError("Skladba překročila limit 100 000 vrcholů. Zjednodušte TIN nebo omezte počet vrstev.");
  const total = inputs.reduce((sum, input) => sum + input.thicknessM, 0);
  if (!Number.isFinite(total) || total <= 0 || total > 1_000) throw new RangeError("Celková tloušťka skladby musí být větší než 0 a nejvýše 1 000 m.");
  let offset = 0, faces = 0;
  return inputs.map((input, order) => {
    const layer = createCivilMaterialLayerFromSurface(surface, { ...input, topOffsetM: offset, assembly: { id: assemblyId, order }, algorithmVersion: "civil-material-assembly-v1" });
    offset += input.thicknessM;
    faces += layer.geometry.faces.length;
    if (faces > 200_000) throw new RangeError("Skladba překročila limit 200 000 trojúhelníků.");
    return layer;
  });
}

const horizontalSegmentLength = (
  start: readonly [number, number, number],
  end: readonly [number, number, number],
): number => Math.hypot(end[0] - start[0], end[1] - start[1]);

export function civilAxisStations(axis: CivilAxisObject): readonly number[] {
  const stations = [axis.properties.start_station_m];
  for (let index = 1; index < axis.geometry.points.length; index += 1) {
    const length = horizontalSegmentLength(axis.geometry.points[index - 1]!, axis.geometry.points[index]!);
    if (!Number.isFinite(length) || length <= 1e-9) throw new TypeError("Osa obsahuje degenerovaný horizontální segment.");
    stations.push(stations[index - 1]! + length);
  }
  if (Math.abs(stations.at(-1)! - axis.properties.start_station_m - axis.properties.length_m) > 1e-6) {
    throw new TypeError("Délka osy neodpovídá její geometrii.");
  }
  return Object.freeze(stations);
}

export function civilAxisPositionAt(axis: CivilAxisObject, stationM: number): CivilAxisPosition {
  if (!Number.isFinite(stationM)) throw new RangeError("Staničení musí být konečné číslo.");
  const stations = civilAxisStations(axis);
  const start = stations[0]!;
  const end = stations.at(-1)!;
  if (stationM < start - 1e-9 || stationM > end + 1e-9) {
    throw new RangeError("Staničení leží mimo osu; extrapolace není povolena.");
  }
  const clamped = Math.min(end, Math.max(start, stationM));
  let segment = stations.length - 2;
  for (let index = 0; index < stations.length - 1; index += 1) {
    if (clamped <= stations[index + 1]! + 1e-9) {
      segment = index;
      break;
    }
  }
  const first = axis.geometry.points[segment]!;
  const second = axis.geometry.points[segment + 1]!;
  const segmentLength = stations[segment + 1]! - stations[segment]!;
  const ratio = (clamped - stations[segment]!) / segmentLength;
  return Object.freeze({
    stationM: clamped,
    point: Object.freeze([
      first[0] + (second[0] - first[0]) * ratio,
      first[1] + (second[1] - first[1]) * ratio,
      first[2] + (second[2] - first[2]) * ratio,
    ] as const),
    tangentXY: Object.freeze([
      (second[0] - first[0]) / segmentLength,
      (second[1] - first[1]) / segmentLength,
    ] as const),
  });
}

export function civilProfileElevationAt(profile: CivilProfileObject, stationM: number): number {
  if (!Number.isFinite(stationM)) throw new RangeError("Staničení profilu musí být konečné číslo.");
  const samples = profile.properties.samples;
  if (stationM < samples[0]!.station_m - 1e-9 || stationM > samples.at(-1)!.station_m + 1e-9) {
    throw new RangeError("Staničení leží mimo profil; extrapolace není povolena.");
  }
  const clamped = Math.min(samples.at(-1)!.station_m, Math.max(samples[0]!.station_m, stationM));
  let segment = samples.length - 2;
  for (let index = 0; index < samples.length - 1; index += 1) {
    if (clamped <= samples[index + 1]!.station_m + 1e-9) {
      segment = index;
      break;
    }
  }
  const first = samples[segment]!;
  const second = samples[segment + 1]!;
  const ratio = (clamped - first.station_m) / (second.station_m - first.station_m);
  return first.elevation_m + (second.elevation_m - first.elevation_m) * ratio;
}

const validateSection = (section: readonly CivilSectionPoint[]): void => {
  if (section.length < 2 || section.length > 64) throw new RangeError("Sekce musí obsahovat 2 až 64 bodů.");
  for (let index = 1; index < section.length; index += 1) {
    if (section[index]!.offset_m <= section[index - 1]!.offset_m) {
      throw new TypeError("Offsety sekce musí být striktně rostoucí; self-intersection není povolena.");
    }
  }
};

const uniqueSortedStations = (values: readonly number[]): number[] => (
  [...values].sort((left, right) => left - right).filter((value, index, sorted) => (
    index === 0 || Math.abs(value - sorted[index - 1]!) > 1e-9
  ))
);

export interface BuildCivilSweepInput {
  readonly objectId: string;
  readonly layerId: string;
  readonly name: string;
  readonly sourceDocumentId: string;
  readonly sourceDocumentSha256: string;
  readonly sourceJobId?: string;
  readonly algorithmVersion: string;
  readonly tools: CivilTools;
}

export function buildCivilSweep(
  axis: CivilAxisObject,
  profile: CivilProfileObject,
  input: BuildCivilSweepInput,
): CivilSweepObject {
  if (input.tools.axis_id !== axis.id || input.tools.profile_id !== profile.id || profile.properties.axis_id !== axis.id) {
    throw new TypeError("Sweep neodkazuje na zadanou osu a profil.");
  }
  if (axis.properties.crs.epsg !== profile.properties.crs.epsg
    || axis.properties.crs.vertical_datum !== profile.properties.crs.vertical_datum) {
    throw new TypeError("Osa a profil nemají shodné CRS.");
  }
  validateSection(input.tools.section);
  const axisStations = civilAxisStations(axis);
  const start = axisStations[0]!;
  const end = axisStations.at(-1)!;
  const profileSamples = profile.properties.samples;
  if (Math.abs(profileSamples[0]!.station_m - start) > 1e-6
    || Math.abs(profileSamples.at(-1)!.station_m - end) > 1e-6) {
    throw new RangeError("Profil musí bez extrapolace pokrýt celou osu.");
  }
  const spacing = input.tools.sampling_spacing_m;
  if (!Number.isFinite(spacing) || spacing <= 0 || spacing > 1_000) throw new RangeError("Sampling je mimo povolený rozsah.");
  const regularCount = Math.ceil((end - start) / spacing);
  if ((regularCount + axisStations.length + profileSamples.length + 1) * input.tools.section.length > 100_000) {
    throw new RangeError("Sweep by překročil limit 100 000 vrcholů.");
  }
  const regular = Array.from({ length: regularCount + 1 }, (_, index) => Math.min(end, start + index * spacing));
  const stations = uniqueSortedStations([
    ...regular,
    ...axisStations,
    ...profileSamples.map((sample) => sample.station_m),
    end,
  ]);
  const vertices: [number, number, number][] = [];
  for (const station of stations) {
    const position = civilAxisPositionAt(axis, station);
    const elevation = civilProfileElevationAt(profile, station);
    const left = [-position.tangentXY[1], position.tangentXY[0]] as const;
    for (const sectionPoint of input.tools.section) {
      vertices.push([
        position.point[0] + left[0] * sectionPoint.offset_m,
        position.point[1] + left[1] * sectionPoint.offset_m,
        elevation + sectionPoint.elevation_offset_m,
      ]);
    }
  }
  const width = input.tools.section.length;
  const faces: [number, number, number][] = [];
  for (let row = 0; row < stations.length - 1; row += 1) {
    for (let column = 0; column < width - 1; column += 1) {
      const current = row * width + column;
      const next = current + width;
      faces.push([current, next, current + 1], [current + 1, next, next + 1]);
    }
  }
  if (input.tools.caps) {
    if (width < 3) throw new TypeError("Caps vyžadují nejméně tři body sekce.");
    for (const base of [0, (stations.length - 1) * width]) {
      for (let index = 1; index < width - 1; index += 1) {
        faces.push(base === 0 ? [base, base + index + 1, base + index] : [base, base + index, base + index + 1]);
      }
    }
  }
  const minimum = [0, 1, 2].map((coordinate) => Math.min(...vertices.map((point) => point[coordinate]!))) as [number, number, number];
  const maximum = [0, 1, 2].map((coordinate) => Math.max(...vertices.map((point) => point[coordinate]!))) as [number, number, number];
  return {
    schema_version: "datamine.civil-sweep-object.v1",
    id: input.objectId,
    type: "civil.sweep",
    layer_id: input.layerId,
    geometry: { kind: "indexed_mesh", coordinate_space: "survey_crs", vertices, faces, bounds: { min: minimum, max: maximum } },
    properties: {
      schema_version: "datamine.civil-sweep-properties.v1",
      name: input.name,
      axis_id: axis.id,
      profile_id: profile.id,
      crs: axis.properties.crs,
      section: input.tools.section.map((point) => ({ ...point })),
      sampling_spacing_m: spacing,
      caps: input.tools.caps,
      review_state: "unreviewed",
    },
    provenance: {
      source_document_id: input.sourceDocumentId,
      source_document_sha256: input.sourceDocumentSha256,
      ...(input.sourceJobId ? { source_job_id: input.sourceJobId } : {}),
      source_kind: "automatic",
      algorithm_version: input.algorithmVersion,
    },
  };
}

export function describeCivilObjects(
  objects: readonly ModelObject[],
  cadUnderlayView?: CadUnderlayView,
  maxVertices = 100_000,
  surveyOrigin?: readonly [number, number, number],
): readonly RenderableDescriptor[] {
  const axes = objects.filter((object): object is CivilAxisObject => object.type === "civil.axis");
  const sweeps = objects.filter((object): object is CivilSweepObject => object.type === "civil.sweep");
  const surfaces = objects.filter((object): object is TinSurfaceObject => object.type === "civil.tin_surface");
  const materialLayers = objects.filter((object): object is CivilMaterialLayerObject => object.type === "civil.material_layer");
  const points = objects.filter((object): object is CivilPointObject => object.type === "civil.point");
  const totalVertices = points.length
    + axes.reduce((sum, axis) => sum + axis.geometry.points.length, 0)
    + sweeps.reduce((sum, sweep) => sum + sweep.geometry.vertices.length, 0)
    + surfaces.reduce((sum, surface) => sum + surface.geometry.vertices.length, 0)
    + materialLayers.reduce((sum, layer) => sum + layer.geometry.vertices.length, 0);
  if (!Number.isInteger(maxVertices) || maxVertices < 4 || totalVertices > maxVertices) {
    throw new RangeError("Civil renderer překročil limit vrcholů.");
  }
  const transform = (point: readonly [number, number, number]): readonly [number, number, number] => {
    if (!cadUnderlayView) return Object.freeze([
      point[0] - (surveyOrigin?.[0] ?? 0),
      point[1] - (surveyOrigin?.[1] ?? 0),
      point[2] - (surveyOrigin?.[2] ?? 0),
    ] as [number, number, number]);
    const [a, b, c, d, e, f] = cadUnderlayView.survey_to_world_xy;
    return Object.freeze([
      a * point[0] + c * point[1] + e,
      b * point[0] + d * point[1] + f,
      point[2] + cadUnderlayView.world_elevation_offset_m,
    ] as const);
  };
  const axisDescriptors = axes.map((axis) => {
    if (cadUnderlayView && (
      cadUnderlayView.source_crs.epsg !== axis.properties.crs.epsg
      || cadUnderlayView.source_crs.vertical_datum !== axis.properties.crs.vertical_datum
    )) throw new TypeError("Civilní osa a CAD underlay nemají shodné CRS.");
    const polyline = Object.freeze(axis.geometry.points.map(transform));
    const minX = Math.min(...polyline.map((point) => point[0]));
    const maxX = Math.max(...polyline.map((point) => point[0]));
    const minY = Math.min(...polyline.map((point) => point[1]));
    const maxY = Math.max(...polyline.map((point) => point[1]));
    const elevations = polyline.map((point) => point[2]);
    return Object.freeze({
      id: axis.id,
      ring: Object.freeze([[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]] as const),
      heightM: Math.max(1e-6, Math.max(...elevations) - Math.min(...elevations)),
      floorLevelM: Math.min(...elevations),
      volumeM3: 0,
      polyline,
    });
  });
  const sweepDescriptors = sweeps.map((sweep) => {
    if (cadUnderlayView && (
      cadUnderlayView.source_crs.epsg !== sweep.properties.crs.epsg
      || cadUnderlayView.source_crs.vertical_datum !== sweep.properties.crs.vertical_datum
    )) throw new TypeError("Civil sweep a CAD underlay nemají shodné CRS.");
    const vertices = Object.freeze(sweep.geometry.vertices.map(transform));
    const minX = Math.min(...vertices.map((point) => point[0]));
    const maxX = Math.max(...vertices.map((point) => point[0]));
    const minY = Math.min(...vertices.map((point) => point[1]));
    const maxY = Math.max(...vertices.map((point) => point[1]));
    return Object.freeze({
      id: sweep.id,
      ring: Object.freeze([
        Object.freeze([minX, minY] as const), Object.freeze([maxX, minY] as const),
        Object.freeze([maxX, maxY] as const), Object.freeze([minX, maxY] as const),
      ]),
      heightM: Math.max(1e-6, sweep.geometry.bounds.max[2] - sweep.geometry.bounds.min[2]),
      floorLevelM: Math.min(...vertices.map((point) => point[2])),
      volumeM3: 0,
      mesh: Object.freeze({ vertices, faces: Object.freeze(sweep.geometry.faces.map((face) => Object.freeze([...face] as [number, number, number]))) }),
    });
  });
  const surfaceDescriptors = surfaces.map((surface) => {
    if (cadUnderlayView && (
      cadUnderlayView.source_crs.epsg !== surface.properties.crs.epsg
      || cadUnderlayView.source_crs.vertical_datum !== surface.properties.crs.vertical_datum
    )) throw new TypeError("Civil povrch a CAD underlay nemají shodné CRS.");
    const vertices = Object.freeze(surface.geometry.vertices.map(transform));
    const minX = Math.min(...vertices.map((point) => point[0]));
    const maxX = Math.max(...vertices.map((point) => point[0]));
    const minY = Math.min(...vertices.map((point) => point[1]));
    const maxY = Math.max(...vertices.map((point) => point[1]));
    return Object.freeze({
      id: surface.id,
      ring: Object.freeze([
        Object.freeze([minX, minY] as const), Object.freeze([maxX, minY] as const),
        Object.freeze([maxX, maxY] as const), Object.freeze([minX, maxY] as const),
      ]),
      heightM: Math.max(1e-6, surface.geometry.bounds.max[2] - surface.geometry.bounds.min[2]),
      floorLevelM: Math.min(...vertices.map((point) => point[2])), volumeM3: 0,
      mesh: Object.freeze({ vertices, faces: Object.freeze(surface.geometry.faces.map((face) => Object.freeze([...face] as [number, number, number]))) }),
    });
  });
  const materialLayerDescriptors = materialLayers.map((layer) => {
    if (cadUnderlayView && (
      cadUnderlayView.source_crs.epsg !== layer.properties.crs.epsg
      || cadUnderlayView.source_crs.vertical_datum !== layer.properties.crs.vertical_datum
    )) throw new TypeError("Materiálová vrstva a CAD underlay nemají shodné CRS.");
    const vertices = Object.freeze(layer.geometry.vertices.map(transform));
    const minX = Math.min(...vertices.map((point) => point[0]));
    const maxX = Math.max(...vertices.map((point) => point[0]));
    const minY = Math.min(...vertices.map((point) => point[1]));
    const maxY = Math.max(...vertices.map((point) => point[1]));
    return Object.freeze({
      id: layer.id,
      ring: Object.freeze([[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]] as const),
      heightM: layer.geometry.bounds.max[2] - layer.geometry.bounds.min[2],
      floorLevelM: Math.min(...vertices.map((point) => point[2])), volumeM3: layer.properties.volume_m3,
      mesh: Object.freeze({ vertices, faces: Object.freeze(layer.geometry.faces.map((face) => Object.freeze([...face] as [number, number, number]))) }),
    });
  });
  const transformedPoints = points.map((point) => transform(point.geometry.point));
  const pointSpan = transformedPoints.length < 2 ? 0 : Math.max(
    Math.max(...transformedPoints.map((point) => point[0])) - Math.min(...transformedPoints.map((point) => point[0])),
    Math.max(...transformedPoints.map((point) => point[1])) - Math.min(...transformedPoints.map((point) => point[1])),
  );
  const pointRadiusM = Math.min(5, Math.max(0.2, pointSpan / 180));
  const pointDescriptors = points.map((point, index) => {
    if (cadUnderlayView && (
      cadUnderlayView.source_crs.epsg !== point.properties.crs.epsg
      || cadUnderlayView.source_crs.vertical_datum !== point.properties.crs.vertical_datum
    )) throw new TypeError("Civil bod a CAD underlay nemají shodné CRS.");
    const world = transformedPoints[index]!;
    return Object.freeze({
      id: point.id,
      ring: Object.freeze([
        Object.freeze([world[0] - 0.08, world[1] - 0.08] as const),
        Object.freeze([world[0] + 0.08, world[1] - 0.08] as const),
        Object.freeze([world[0] + 0.08, world[1] + 0.08] as const),
        Object.freeze([world[0] - 0.08, world[1] + 0.08] as const),
      ]),
      heightM: 0, floorLevelM: world[2], volumeM3: 0, point: world, pointRadiusM,
    });
  });
  return Object.freeze([...axisDescriptors, ...pointDescriptors, ...surfaceDescriptors, ...materialLayerDescriptors, ...sweepDescriptors]);
}

export function describeStakeoutObjects(
  objects: readonly ModelObject[],
  cadUnderlayView?: CadUnderlayView,
  maxPoints = 10_000,
  surveyOrigin?: readonly [number, number, number],
): readonly RenderableDescriptor[] {
  const stakeout = objects.filter((object): object is StakeoutPointObject => object.type === "stakeout.point");
  if (!Number.isInteger(maxPoints) || maxPoints < 1 || stakeout.length > maxPoints) {
    throw new RangeError("Stakeout renderer překročil limit bodů.");
  }
  const transform = (point: readonly [number, number, number]): readonly [number, number, number] => {
    if (!cadUnderlayView) return Object.freeze([
      point[0] - (surveyOrigin?.[0] ?? 0),
      point[1] - (surveyOrigin?.[1] ?? 0),
      point[2] - (surveyOrigin?.[2] ?? 0),
    ] as [number, number, number]);
    const [a, b, c, d, e, f] = cadUnderlayView.survey_to_world_xy;
    return Object.freeze([
      a * point[0] + c * point[1] + e,
      b * point[0] + d * point[1] + f,
      point[2] + cadUnderlayView.world_elevation_offset_m,
    ] as const);
  };
  const transformedPoints = stakeout.map((point) => transform(point.geometry.point));
  const pointSpan = transformedPoints.length < 2 ? 0 : Math.max(
    Math.max(...transformedPoints.map((point) => point[0])) - Math.min(...transformedPoints.map((point) => point[0])),
    Math.max(...transformedPoints.map((point) => point[1])) - Math.min(...transformedPoints.map((point) => point[1])),
  );
  const pointRadiusM = Math.min(5, Math.max(0.2, pointSpan / 180));
  return Object.freeze(stakeout.map((point, index) => {
    if (cadUnderlayView && (
      cadUnderlayView.source_crs.epsg !== point.properties.crs.epsg
      || cadUnderlayView.source_crs.vertical_datum !== point.properties.crs.vertical_datum
    )) throw new TypeError("Vytyčovací bod a CAD underlay nemají shodné CRS.");
    const world = transformedPoints[index]!;
    return Object.freeze({
      id: point.id,
      ring: Object.freeze([
        Object.freeze([world[0] - 0.1, world[1] - 0.1] as const),
        Object.freeze([world[0] + 0.1, world[1] - 0.1] as const),
        Object.freeze([world[0] + 0.1, world[1] + 0.1] as const),
        Object.freeze([world[0] - 0.1, world[1] + 0.1] as const),
      ]),
      heightM: 0,
      floorLevelM: world[2],
      volumeM3: 0,
      point: world,
      pointRadiusM,
    });
  }));
}

const segmentPart = (
  start: readonly [number, number],
  end: readonly [number, number],
  thicknessM: number,
  heightM: number,
  floorLevelM: number,
): RenderablePart => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 1e-9) throw new TypeError("Segment není vykreslitelný.");
  const ox = (-dy / length) * thicknessM / 2;
  const oy = (dx / length) * thicknessM / 2;
  return Object.freeze({
    ring: Object.freeze([
      Object.freeze([start[0] + ox, start[1] + oy] as const),
      Object.freeze([end[0] + ox, end[1] + oy] as const),
      Object.freeze([end[0] - ox, end[1] - oy] as const),
      Object.freeze([start[0] - ox, start[1] - oy] as const),
    ]),
    heightM,
    floorLevelM,
  });
};

export function describeBuildingObjects(
  objects: readonly ModelObject[],
  maxObjects = 10_000,
): readonly RenderableDescriptor[] {
  const building = objects.filter((object): object is BuildingObject => (
    object.type === "building.wall"
    || object.type === "building.opening"
    || object.type === "building.floor"
  ));
  if (!Number.isInteger(maxObjects) || maxObjects < 1 || building.length > maxObjects) {
    throw new RangeError("Building renderer překročil limit objektů.");
  }
  const byId = new Map(objects.map((object) => [object.id, object]));
  return Object.freeze(building.map((object): RenderableDescriptor => {
    let parts: readonly RenderablePart[];
    let volumeM3: number;
    if (object.type === "building.wall") {
      parts = Object.freeze(object.geometry.points.slice(1).map((end, index) => segmentPart(
        object.geometry.points[index]!, end, object.properties.thickness_m,
        object.properties.height_m, object.properties.base_level_m,
      )));
      volumeM3 = object.properties.volume_m3;
    } else if (object.type === "building.opening") {
      const host = byId.get(object.properties.host_wall_id);
      if (!host || host.type !== "building.wall") throw new TypeError("Otvor nemá hostitelskou stěnu.");
      parts = Object.freeze([segmentPart(
        object.geometry.points[0]!, object.geometry.points[1]!,
        Math.min(host.properties.thickness_m * 1.05, 10), object.properties.height_m,
        host.properties.base_level_m + object.properties.sill_height_m,
      )]);
      volumeM3 = object.properties.area_m2 * host.properties.thickness_m;
    } else {
      parts = Object.freeze([Object.freeze({
        ring: cloneRings(object.geometry.rings)[0]!,
        heightM: object.properties.thickness_m,
        floorLevelM: object.properties.top_level_m - object.properties.thickness_m,
      })]);
      volumeM3 = object.properties.volume_m3;
    }
    const first = parts[0];
    if (!first) throw new TypeError("Building objekt nemá render části.");
    return Object.freeze({
      id: object.id,
      ring: first.ring,
      heightM: first.heightM,
      floorLevelM: first.floorLevelM,
      volumeM3,
      parts,
    });
  }));
}

export interface BuildingQuantityRowV1 {
  readonly objectId: string;
  readonly objectType: "building.wall" | "building.opening" | "building.floor";
  readonly lengthM?: number;
  readonly grossAreaM2: number;
  readonly netAreaM2: number;
  readonly volumeM3: number;
}

export function buildingQuantities(model: ModelVersion): readonly BuildingQuantityRowV1[] {
  if (model.status !== "validated") throw new TypeError("Výměry vyžadují validated verzi.");
  const openingAreaByHost = new Map<string, number>();
  for (const object of model.objects) {
    if (object.type === "building.opening" && object.properties.review_state !== "rejected") {
      openingAreaByHost.set(
        object.properties.host_wall_id,
        (openingAreaByHost.get(object.properties.host_wall_id) ?? 0) + object.properties.area_m2,
      );
    }
  }
  const rows: BuildingQuantityRowV1[] = [];
  for (const object of model.objects) {
    if (
      object.type !== "building.wall"
      && object.type !== "building.opening"
      && object.type !== "building.floor"
    ) continue;
    if (object.properties.review_state === "rejected") continue;
    if (object.type === "building.wall") {
      const openingArea = openingAreaByHost.get(object.id) ?? 0;
      const net = object.properties.gross_side_area_m2 - openingArea;
      if (net < -1e-6) throw new RangeError("Otvory překračují plochu hostitelské stěny.");
      rows.push(Object.freeze({
        objectId: object.id,
        objectType: object.type,
        lengthM: object.properties.length_m,
        grossAreaM2: object.properties.gross_side_area_m2,
        netAreaM2: Math.max(0, net),
        volumeM3: object.properties.volume_m3,
      }));
    } else {
      const area = object.properties.area_m2;
      rows.push(Object.freeze({
        objectId: object.id,
        objectType: object.type,
        grossAreaM2: area,
        netAreaM2: area,
        volumeM3: object.type === "building.floor" ? object.properties.volume_m3 : 0,
      }));
    }
  }
  return Object.freeze(rows.sort((left, right) => left.objectId.localeCompare(right.objectId)));
}
