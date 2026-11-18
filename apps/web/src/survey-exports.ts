import { isContract } from "@datamine/contracts";
import type { ModelObject, StakeoutPointObject, CivilPointObject, TinSurfaceObject } from "@datamine/contracts";

type SurveyPoint = StakeoutPointObject | CivilPointObject;

const controlCharacters = /[\u0000-\u001f\u007f]/g;

const safeSpreadsheetText = (value: string): string => {
  const normalized = value.replace(controlCharacters, " ").trim();
  return /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
};

const csvCell = (value: string | number): string => {
  const text = typeof value === "number" ? value.toFixed(3) : safeSpreadsheetText(value);
  return `"${text.replaceAll('"', '""')}"`;
};

export function createSurveyPointsCsv(
  objects: readonly ModelObject[],
  selectedPointIds: readonly string[] = [],
): string {
  const selected = new Set(selectedPointIds);
  const points = objects.filter((object): object is SurveyPoint => (
    (object.type === "stakeout.point" || object.type === "civil.point")
    && (!selected.size || selected.has(object.id))
  ));
  if (!points.length) throw new TypeError("CSV export neobsahuje žádné body.");
  validateSurveyObjects(points);
  const rows = points.map((point) => (
    [point.properties.name, ...point.geometry.point].map(csvCell).join(",")
  ));
  return `\uFEFF${["Název bodu", "X", "Y", "Z"].map(csvCell).join(",")}\r\n${rows.join("\r\n")}\r\n`;
}

export function createTinVerticesCsv(surface: TinSurfaceObject): string {
  validateSurveyObjects([surface]);
  if (!surface.geometry.vertices.length) throw new TypeError("Plocha neobsahuje žádné vrcholy.");
  const rows = surface.geometry.vertices.map((point, index) => (
    [`V${String(index + 1).padStart(3, "0")}`, ...point].map(csvCell).join(",")
  ));
  return `\uFEFF${["Vrchol", "X", "Y", "Z"].map(csvCell).join(",")}\r\n${rows.join("\r\n")}\r\n`;
}

const ascii = (value: string): string => value.normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");

const pair = (code: number, value: string | number): string => `${code}\n${value}\n`;

const lineEntity = (layer: string, first: readonly number[], second: readonly number[]): string => (
  pair(0, "LINE") + pair(8, layer)
  + pair(10, first[0]!) + pair(20, first[1]!) + pair(30, first[2]!)
  + pair(11, second[0]!) + pair(21, second[1]!) + pair(31, second[2]!)
);

const faceEntity = (layer: string, vertices: readonly (readonly number[])[]): string => {
  const [first, second, third] = vertices;
  if (!first || !second || !third) return "";
  return pair(0, "3DFACE") + pair(8, layer)
    + pair(10, first[0]!) + pair(20, first[1]!) + pair(30, first[2]!)
    + pair(11, second[0]!) + pair(21, second[1]!) + pair(31, second[2]!)
    + pair(12, third[0]!) + pair(22, third[1]!) + pair(32, third[2]!)
    + pair(13, third[0]!) + pair(23, third[1]!) + pair(33, third[2]!);
};

export function createCivilModelDxf(objects: readonly ModelObject[]): string {
  const civilObjects = objects.filter((object) => object.type.startsWith("civil.") || object.type === "stakeout.point");
  if (!civilObjects.length) throw new TypeError("DXF export neobsahuje žádné objekty inženýrské stavby.");
  validateSurveyObjects(civilObjects);
  // Stable technical layer IDs survive renaming and match the validated server DXF.
  const layerById = new Map(civilObjects.map((object) => [object.layer_id, object.layer_id]));
  if (new Set([...layerById.keys()].map((id) => id.toLowerCase())).size !== layerById.size) {
    throw new TypeError("DXF hladiny se nesmějí lišit pouze velikostí písmen.");
  }
  let output = pair(0, "SECTION") + pair(2, "HEADER") + pair(9, "$INSUNITS") + pair(70, 6)
    + pair(0, "ENDSEC") + pair(0, "SECTION") + pair(2, "TABLES")
    + pair(0, "TABLE") + pair(2, "LAYER") + pair(70, layerById.size);
  for (const layer of layerById.values()) {
    output += pair(0, "LAYER") + pair(2, layer) + pair(70, 0) + pair(62, 7) + pair(6, "CONTINUOUS");
  }
  output += pair(0, "ENDTAB") + pair(0, "ENDSEC") + pair(0, "SECTION") + pair(2, "ENTITIES");
  for (const object of civilObjects) {
    const layer = layerById.get(object.layer_id)!;
    if (object.type === "stakeout.point" || object.type === "civil.point") {
      const [east, north, elevation] = object.geometry.point;
      output += pair(0, "POINT") + pair(8, layer) + pair(10, east) + pair(20, north) + pair(30, elevation);
    } else if (object.type === "civil.axis" || object.type === "civil.profile") {
      for (let index = 0; index < object.geometry.points.length - 1; index += 1) {
        output += lineEntity(layer, object.geometry.points[index]!, object.geometry.points[index + 1]!);
      }
    } else if (object.type === "civil.tin_surface" || object.type === "civil.material_layer" || object.type === "civil.sweep") {
      for (const face of object.geometry.faces) {
        output += faceEntity(layer, face.map((index) => object.geometry.vertices[index]!));
      }
    }
  }
  return output + pair(0, "ENDSEC") + pair(0, "EOF");
}

export function safeSurveyExportStem(value: string): string {
  return ascii(value).replaceAll("_", "-").slice(0, 80) || "datamine-model";
}

function validateSurveyObjects(objects: readonly ModelObject[]): void {
  let firstCrs: string | undefined;
  for (const object of objects) {
    if (!isContract("model_object", object) || !("crs" in object.properties)) {
      throw new TypeError("Export obsahuje neplatnou geometrii nebo vlastnosti objektu.");
    }
    const crs = object.properties.crs;
    const key = [crs.kind, crs.epsg, crs.axis_order, crs.horizontal_unit, crs.vertical_unit, crs.vertical_datum].join("|");
    if (firstCrs !== undefined && firstCrs !== key) {
      throw new TypeError("Export vyžaduje shodný souřadnicový a výškový systém všech objektů.");
    }
    firstCrs = key;
  }
}
