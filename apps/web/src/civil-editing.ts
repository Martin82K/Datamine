import type { CivilAxisObject, CivilPointObject, StakeoutPointObject } from "@datamine/contracts";

export type SurveyPointObject = CivilPointObject | StakeoutPointObject;
export type CopyDirection = "selection" | "x" | "negative-x" | "y" | "negative-y" | "z" | "negative-z";

export function safeManualLayerId(name: string): string {
  const normalized = name.trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  if (!normalized) throw new TypeError("Název vrstvy musí obsahovat alespoň jedno písmeno nebo číslo.");
  return `layer_${normalized}`;
}

const sameCrs = (left: SurveyPointObject, right: SurveyPointObject): boolean => (
  left.properties.crs.epsg === right.properties.crs.epsg
  && left.properties.crs.vertical_datum === right.properties.crs.vertical_datum
);

export function createAxisFromSelectedPoints(
  points: readonly SurveyPointObject[],
  input: { readonly objectId: string; readonly name: string },
): CivilAxisObject {
  const name = input.name.trim();
  if (!name || name.length > 200) throw new TypeError("Název osy musí mít 1 až 200 znaků.");
  if (points.length < 2 || points.length > 10_000) throw new TypeError("Osa vyžaduje 2 až 10 000 bodů v pořadí.");
  const start = points[0]!;
  if (new Set(points.map((point) => point.id)).size !== points.length || points.some((point) => !sameCrs(start, point))) {
    throw new TypeError("Osa vyžaduje různé body ve shodném CRS.");
  }
  const length = points.slice(1).reduce((sum, point, index) => {
    const previous = points[index]!;
    return sum + Math.hypot(
      point.geometry.point[0] - previous.geometry.point[0],
      point.geometry.point[1] - previous.geometry.point[1],
    );
  }, 0);
  if (!Number.isFinite(length) || length <= 1e-9) throw new TypeError("Vybrané body netvoří platnou horizontální osu.");
  return {
    schema_version: "datamine.civil-axis-object.v1",
    id: input.objectId,
    type: "civil.axis",
    layer_id: "layer_axes",
    geometry: { kind: "polyline3d", coordinate_space: "survey_crs", points: points.map((point) => [...point.geometry.point]) },
    properties: {
      schema_version: "datamine.civil-axis-properties.v1",
      name,
      crs: structuredClone(start.properties.crs),
      start_station_m: 0,
      length_m: length,
      review_state: "unreviewed",
    },
    provenance: {
      source_document_id: start.provenance.source_document_id,
      source_document_sha256: start.provenance.source_document_sha256,
      source_kind: "manual",
      algorithm_version: "civil-axis-selected-points-v2",
    },
  };
}

export function copyVector(
  direction: CopyDirection,
  distanceM: number,
  reference?: readonly [SurveyPointObject, SurveyPointObject],
): readonly [number, number, number] {
  if (!Number.isFinite(distanceM) || Math.abs(distanceM) > 100_000 || distanceM === 0) {
    throw new RangeError("Vzdálenost kopie musí být nenulová a nejvýše 100 000 m.");
  }
  if (direction === "x") return [distanceM, 0, 0];
  if (direction === "negative-x") return [-distanceM, 0, 0];
  if (direction === "y") return [0, distanceM, 0];
  if (direction === "negative-y") return [0, -distanceM, 0];
  if (direction === "z") return [0, 0, distanceM];
  if (direction === "negative-z") return [0, 0, -distanceM];
  if (!reference || reference[0].id === reference[1].id || !sameCrs(reference[0], reference[1])) {
    throw new TypeError("Směr podle výběru vyžaduje dva různé body ve shodném CRS.");
  }
  const delta = reference[0].geometry.point.map((value, index) => reference[1].geometry.point[index]! - value);
  const length = Math.hypot(...delta);
  if (!Number.isFinite(length) || length <= 1e-9) throw new TypeError("Směr výběru je degenerovaný.");
  return delta.map((value) => value / length * distanceM) as [number, number, number];
}

export function translatedPointCopies(
  points: readonly SurveyPointObject[],
  vector: readonly [number, number, number],
  layerId: string,
  idFor: (point: SurveyPointObject, index: number) => string,
): readonly SurveyPointObject[] {
  if (!points.length || points.length > 10_000 || !vector.every(Number.isFinite)) throw new TypeError("Výběr bodů pro kopii není platný.");
  return Object.freeze(points.map((source, index): SurveyPointObject => {
    const point = source.geometry.point.map((value, axis) => value + vector[axis]!) as [number, number, number];
    const id = idFor(source, index);
    if (source.type === "civil.point") return {
      ...structuredClone(source), id, layer_id: layerId,
      geometry: { ...structuredClone(source.geometry), point },
      properties: { ...structuredClone(source.properties), name: `${source.properties.name} – kopie`.slice(0, 200), derivation: { kind: "manual_coordinates" }, review_state: "unreviewed" },
      provenance: { source_document_id: source.provenance.source_document_id, source_document_sha256: source.provenance.source_document_sha256, source_kind: "manual", algorithm_version: "civil-point-copy-v1" },
    };
    const suffix = `_K${index + 1}`;
    const code = `${source.properties.code.slice(0, 50 - suffix.length)}${suffix}`;
    return {
      ...structuredClone(source), id, layer_id: layerId,
      geometry: { ...structuredClone(source.geometry), point },
      properties: {
        ...structuredClone(source.properties),
        name: `${source.properties.name} – kopie`.slice(0, 200),
        code,
        derivation: { kind: "manual" },
        accuracy: { ...structuredClone(source.properties.accuracy), method: "manual" },
        review_state: "unreviewed",
      },
      provenance: { source_document_id: source.provenance.source_document_id, source_document_sha256: source.provenance.source_document_sha256, source_kind: "manual", algorithm_version: "stakeout-point-copy-v1" },
    };
  }));
}

export function transformedPointCopies(
  points: readonly SurveyPointObject[],
  vector: readonly [number, number, number],
  angleDegrees: number,
  layerId: string,
  idFor: (point: SurveyPointObject, index: number) => string,
): readonly SurveyPointObject[] {
  if (!Number.isFinite(angleDegrees) || Math.abs(angleDegrees) > 360_000) {
    throw new RangeError("Úhel kopie musí být konečné číslo v rozsahu ±360 000°.");
  }
  const anchor = points[0]?.geometry.point;
  if (!anchor) throw new TypeError("Výběr bodů pro kopii není platný.");
  const radians = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotated = points.map((source) => {
    const x = source.geometry.point[0] - anchor[0];
    const y = source.geometry.point[1] - anchor[1];
    return {
      ...structuredClone(source),
      geometry: {
        ...structuredClone(source.geometry),
        point: [
          anchor[0] + x * cosine - y * sine,
          anchor[1] + x * sine + y * cosine,
          source.geometry.point[2],
        ] as [number, number, number],
      },
    } as SurveyPointObject;
  });
  return translatedPointCopies(rotated, vector, layerId, idFor);
}
