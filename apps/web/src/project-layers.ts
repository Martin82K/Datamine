import type { ModelObject } from "@datamine/contracts";
import { safeManualLayerId } from "./civil-editing.ts";
import { normalizeLayerName } from "./layer-colors.ts";

export function prepareLayerRename(
  objects: readonly ModelObject[],
  sourceLayerId: string,
  input: string,
): { readonly name: string; readonly layerId: string; readonly objects: readonly ModelObject[] } {
  const name = normalizeLayerName(input);
  const layerId = safeManualLayerId(name);
  const members = objects.filter((object) => object.layer_id === sourceLayerId);
  if (!members.length) throw new TypeError("Vrstva již neexistuje.");
  if (layerId !== sourceLayerId && objects.some((object) => object.layer_id === layerId)) {
    throw new TypeError("Vrstva s tímto názvem již existuje.");
  }
  return { name, layerId, objects: members.map((object): ModelObject => {
    const copy = structuredClone(object);
    copy.layer_id = layerId;
    if (copy.type === "civil.tin_surface" || copy.type === "civil.material_layer") copy.properties.name = name;
    if (copy.type === "stakeout.point" && copy.properties.derivation.kind === "document_import") {
      copy.properties.derivation.source_layer = name;
    }
    return copy;
  }) };
}

export interface ProjectLayer {
  readonly id: string;
  readonly name: string;
  readonly objectIds: readonly string[];
  readonly origin: "imported" | "created";
}

const KNOWN_LAYER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  layer_civil: "Civilní model",
  layer_points: "Body",
  layer_stakeout: "Vytyčovací body",
  layer_stakeout_import: "Importované body",
  layer_terrain: "Terén",
});

const readableLayerName = (object: ModelObject): string => {
  if (
    (object.type === "civil.tin_surface" || object.type === "civil.material_layer")
    && object.properties.name.trim()
  ) return object.properties.name.trim();
  if (object.type === "stakeout.point" && object.properties.derivation.kind === "document_import") {
    const sourceLayer = object.properties.derivation.source_layer?.trim();
    if (sourceLayer) return sourceLayer;
  }
  return KNOWN_LAYER_NAMES[object.layer_id]
    ?? object.layer_id.replace(/^layer_/, "").replaceAll("_", " ");
};

const isCreatedObject = (object: ModelObject): boolean => (
  object.provenance.source_kind === "manual"
  || object.type === "civil.axis"
  || object.type === "civil.profile"
  || object.type === "civil.sweep"
  || object.type === "civil.tin_surface"
  || object.type === "civil.material_layer"
);

export function groupProjectLayers(
  objects: readonly ModelObject[],
  layerNames: Readonly<Record<string, string>> = Object.freeze({}),
): readonly ProjectLayer[] {
  const layers = new Map<string, { name: string; objectIds: string[]; createdObjects: number }>();
  for (const object of objects) {
    const existing = layers.get(object.layer_id);
    if (existing) {
      existing.objectIds.push(object.id);
      if (isCreatedObject(object)) existing.createdObjects += 1;
      continue;
    }
    layers.set(object.layer_id, {
      name: layerNames[object.layer_id] ?? readableLayerName(object),
      objectIds: [object.id],
      createdObjects: isCreatedObject(object) ? 1 : 0,
    });
  }
  return Object.freeze([...layers].map(([id, layer]) => Object.freeze({
    id,
    name: layer.name,
    objectIds: Object.freeze(layer.objectIds),
    origin: layer.createdObjects === layer.objectIds.length ? "created" : "imported",
  })));
}
