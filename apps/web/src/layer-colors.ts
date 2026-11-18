import { isProjectViewSettings, type ProjectViewSettings } from "./local-projects.ts";

export const LAYER_COLORS_KEY = "datamine.layer-colors.v1";
export const LAYER_OPACITIES_KEY = "datamine.layer-opacities.v1";
export const HIDDEN_LAYERS_KEY = "datamine.hidden-layers.v1";
export const LAYER_NAMES_KEY = "datamine.layer-names.v1";
export const TRIANGULATION_KEY = "datamine.triangulation.v1";

const MAX_SERIALIZED_BYTES = 100_000;
const MAX_SCOPES = 100;
const MAX_LAYERS_PER_SCOPE = 500;
const SCOPE_ID = /^[A-Za-z0-9:_-]{1,200}$/;
const LAYER_ID = /^layer_[A-Za-z0-9_-]{1,100}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const LAYER_NAME = /^[^<>\u0000-\u001f\u007f]{1,120}$/;
const DEFAULT_PALETTE = Object.freeze([
  "#5eead4", "#60a5fa", "#a78bfa", "#f59e0b", "#f472b6",
  "#34d399", "#fb7185", "#22d3ee", "#c084fc", "#facc15",
]);

type LayerColorStore = Readonly<Record<string, Readonly<Record<string, string>>>>;
type LayerOpacityStore = Readonly<Record<string, Readonly<Record<string, number>>>>;
type HiddenLayerStore = Readonly<Record<string, readonly string[]>>;
type LayerNameStore = Readonly<Record<string, Readonly<Record<string, string>>>>;

const readTriangulationStore = (storage: Pick<Storage, "getItem">): Readonly<Record<string, boolean>> => {
  try {
    const raw = storage.getItem(TRIANGULATION_KEY);
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value);
    if (entries.length > MAX_SCOPES || !entries.every(([scope, visible]) => SCOPE_ID.test(scope) && typeof visible === "boolean")) return {};
    return Object.fromEntries(entries);
  } catch { return {}; }
};

export function readTriangulationVisibility(storage: Pick<Storage, "getItem">, scope: string): boolean {
  return SCOPE_ID.test(scope) && readTriangulationStore(storage)[scope] === true;
}

export function setTriangulationVisibility(
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  visible: boolean,
): boolean {
  if (!SCOPE_ID.test(scope) || typeof visible !== "boolean") throw new TypeError("Volba triangulace není platná.");
  const updated = { ...readTriangulationStore(storage), [scope]: visible };
  if (Object.keys(updated).length > MAX_SCOPES) throw new RangeError("Úložiště překročilo limit projektů.");
  storage.setItem(TRIANGULATION_KEY, JSON.stringify(updated));
  return visible;
}

const validScopeColors = (value: unknown): value is Readonly<Record<string, string>> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_LAYERS_PER_SCOPE
    && entries.every(([layerId, color]) => LAYER_ID.test(layerId) && typeof color === "string" && HEX_COLOR.test(color));
};

const readStore = (storage: Pick<Storage, "getItem">): LayerColorStore => {
  const raw = storage.getItem(LAYER_COLORS_KEY);
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES) return Object.freeze({});
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
    const entries = Object.entries(value);
    if (entries.length > MAX_SCOPES || !entries.every(([scope, colors]) => SCOPE_ID.test(scope) && validScopeColors(colors))) {
      return Object.freeze({});
    }
    return Object.freeze(Object.fromEntries(entries.map(([scope, colors]) => [scope, Object.freeze({ ...colors })])));
  } catch {
    return Object.freeze({});
  }
};

const validScopeOpacities = (value: unknown): value is Readonly<Record<string, number>> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_LAYERS_PER_SCOPE
    && entries.every(([layerId, opacity]) => LAYER_ID.test(layerId)
      && typeof opacity === "number" && Number.isFinite(opacity) && opacity >= 0.05 && opacity <= 1);
};

const readOpacityStore = (storage: Pick<Storage, "getItem">): LayerOpacityStore => {
  const raw = storage.getItem(LAYER_OPACITIES_KEY);
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES) return Object.freeze({});
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
    const entries = Object.entries(value);
    if (entries.length > MAX_SCOPES || !entries.every(([scope, opacities]) => SCOPE_ID.test(scope) && validScopeOpacities(opacities))) {
      return Object.freeze({});
    }
    return Object.freeze(Object.fromEntries(entries.map(([scope, opacities]) => [scope, Object.freeze({ ...opacities })])));
  } catch {
    return Object.freeze({});
  }
};

const readHiddenLayerStore = (storage: Pick<Storage, "getItem">): HiddenLayerStore => {
  const raw = storage.getItem(HIDDEN_LAYERS_KEY);
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES) return Object.freeze({});
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
    const entries = Object.entries(value);
    if (entries.length > MAX_SCOPES || !entries.every(([scope, layers]) => (
      SCOPE_ID.test(scope) && Array.isArray(layers) && layers.length <= MAX_LAYERS_PER_SCOPE
      && layers.every((layerId) => typeof layerId === "string" && LAYER_ID.test(layerId))
    ))) return Object.freeze({});
    return Object.freeze(Object.fromEntries(entries.map(([scope, layers]) => [
      scope,
      Object.freeze([...new Set(layers as string[])]),
    ])));
  } catch {
    return Object.freeze({});
  }
};

const validScopeNames = (value: unknown): value is Readonly<Record<string, string>> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_LAYERS_PER_SCOPE
    && entries.every(([layerId, name]) => LAYER_ID.test(layerId)
      && typeof name === "string" && LAYER_NAME.test(name) && name === name.trim());
};

const readLayerNameStore = (storage: Pick<Storage, "getItem">): LayerNameStore => {
  const raw = storage.getItem(LAYER_NAMES_KEY);
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_SERIALIZED_BYTES) return Object.freeze({});
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
    const entries = Object.entries(value);
    if (entries.length > MAX_SCOPES || !entries.every(([scope, names]) => SCOPE_ID.test(scope) && validScopeNames(names))) {
      return Object.freeze({});
    }
    return Object.freeze(Object.fromEntries(entries.map(([scope, names]) => [scope, Object.freeze({ ...names })])));
  } catch {
    return Object.freeze({});
  }
};

export const defaultLayerColor = (layerId: string): string => {
  let hash = 0x811c9dc5;
  for (const character of layerId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return DEFAULT_PALETTE[hash % DEFAULT_PALETTE.length]!;
};

export const defaultLayerColors = (layerIds: readonly string[]): Readonly<Record<string, string>> => {
  const resolved: Record<string, string> = {};
  const occupied = new Set<string>();
  for (const layerId of [...new Set(layerIds)].sort()) {
    const preferred = DEFAULT_PALETTE.indexOf(defaultLayerColor(layerId));
    let index = preferred;
    while (occupied.has(DEFAULT_PALETTE[index]!) && occupied.size < DEFAULT_PALETTE.length) {
      index = (index + 1) % DEFAULT_PALETTE.length;
    }
    const color = DEFAULT_PALETTE[index]!;
    occupied.add(color);
    resolved[layerId] = color;
  }
  return Object.freeze(resolved);
};

export const readLayerColors = (
  storage: Pick<Storage, "getItem">,
  scope: string,
): Readonly<Record<string, string>> => (
  SCOPE_ID.test(scope) ? readStore(storage)[scope] ?? Object.freeze({}) : Object.freeze({})
);

export const setLayerColor = (
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  layerId: string,
  color: string,
): Readonly<Record<string, string>> => {
  if (!SCOPE_ID.test(scope) || !LAYER_ID.test(layerId) || !HEX_COLOR.test(color)) {
    throw new TypeError("Barva vrstvy nebo její identifikátor nejsou platné.");
  }
  const store = readStore(storage);
  const scopeColors = Object.freeze({ ...(store[scope] ?? {}), [layerId]: color.toLowerCase() });
  if (Object.keys(scopeColors).length > MAX_LAYERS_PER_SCOPE) throw new RangeError("Projekt překročil limit barev vrstev.");
  const updated = { ...store, [scope]: scopeColors };
  if (Object.keys(updated).length > MAX_SCOPES) throw new RangeError("Úložiště překročilo limit projektů.");
  const serialized = JSON.stringify(updated);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) throw new RangeError("Úložiště barev překročilo bezpečný limit.");
  storage.setItem(LAYER_COLORS_KEY, serialized);
  return scopeColors;
};

export const readLayerOpacities = (
  storage: Pick<Storage, "getItem">,
  scope: string,
): Readonly<Record<string, number>> => (
  SCOPE_ID.test(scope) ? readOpacityStore(storage)[scope] ?? Object.freeze({}) : Object.freeze({})
);

export const setLayerOpacity = (
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  layerId: string,
  opacity: number,
): Readonly<Record<string, number>> => {
  if (!SCOPE_ID.test(scope) || !LAYER_ID.test(layerId)
    || !Number.isFinite(opacity) || opacity < 0.05 || opacity > 1) {
    throw new TypeError("Průhlednost vrstvy nebo její identifikátor nejsou platné.");
  }
  const store = readOpacityStore(storage);
  const scopeOpacities = Object.freeze({ ...(store[scope] ?? {}), [layerId]: Math.round(opacity * 100) / 100 });
  if (Object.keys(scopeOpacities).length > MAX_LAYERS_PER_SCOPE) throw new RangeError("Projekt překročil limit vzhledů vrstev.");
  const updated = { ...store, [scope]: scopeOpacities };
  if (Object.keys(updated).length > MAX_SCOPES) throw new RangeError("Úložiště překročilo limit projektů.");
  const serialized = JSON.stringify(updated);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) throw new RangeError("Úložiště průhlednosti překročilo bezpečný limit.");
  storage.setItem(LAYER_OPACITIES_KEY, serialized);
  return scopeOpacities;
};

export const readHiddenLayerIds = (
  storage: Pick<Storage, "getItem">,
  scope: string,
): readonly string[] => (
  SCOPE_ID.test(scope) ? readHiddenLayerStore(storage)[scope] ?? Object.freeze([]) : Object.freeze([])
);

export const setLayerVisibility = (
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  layerId: string,
  visible: boolean,
): readonly string[] => {
  if (!SCOPE_ID.test(scope) || !LAYER_ID.test(layerId) || typeof visible !== "boolean") {
    throw new TypeError("Viditelnost vrstvy nebo její identifikátor nejsou platné.");
  }
  const store = readHiddenLayerStore(storage);
  const hidden = new Set(store[scope] ?? []);
  if (visible) hidden.delete(layerId);
  else hidden.add(layerId);
  if (hidden.size > MAX_LAYERS_PER_SCOPE) throw new RangeError("Projekt překročil limit viditelností vrstev.");
  const scopeHidden = Object.freeze([...hidden].sort());
  const updated = { ...store, [scope]: scopeHidden };
  if (Object.keys(updated).length > MAX_SCOPES) throw new RangeError("Úložiště překročilo limit projektů.");
  const serialized = JSON.stringify(updated);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) throw new RangeError("Úložiště viditelnosti překročilo bezpečný limit.");
  storage.setItem(HIDDEN_LAYERS_KEY, serialized);
  return scopeHidden;
};

export const readLayerNames = (
  storage: Pick<Storage, "getItem">,
  scope: string,
): Readonly<Record<string, string>> => (
  SCOPE_ID.test(scope) ? readLayerNameStore(storage)[scope] ?? Object.freeze({}) : Object.freeze({})
);

export function normalizeLayerName(name: string): string {
  const normalized = name.trim();
  if (!LAYER_NAME.test(normalized)) {
    throw new TypeError("Název vrstvy musí mít 1 až 120 znaků a nesmí obsahovat řídicí znaky ani < >.");
  }
  return normalized;
}

export function captureProjectViewSettings(storage: Pick<Storage, "getItem">, scope: string): ProjectViewSettings {
  return { names: readLayerNames(storage, scope), colors: readLayerColors(storage, scope), opacities: readLayerOpacities(storage, scope), hidden: readHiddenLayerIds(storage, scope), triangulation: readTriangulationVisibility(storage, scope) };
}

export function applyProjectViewSettings(storage: Pick<Storage, "getItem" | "setItem">, scope: string, settings: ProjectViewSettings): void {
  if (!SCOPE_ID.test(scope) || !isProjectViewSettings(settings)) throw new TypeError("Nastavení projektu není platné.");
  const entries = [
    [LAYER_NAMES_KEY, readLayerNameStore(storage), settings.names ?? {}],
    [LAYER_COLORS_KEY, readStore(storage), settings.colors ?? {}],
    [LAYER_OPACITIES_KEY, readOpacityStore(storage), settings.opacities ?? {}],
    [HIDDEN_LAYERS_KEY, readHiddenLayerStore(storage), settings.hidden ?? []],
    [TRIANGULATION_KEY, readTriangulationStore(storage), settings.triangulation ?? false],
  ] as const;
  const encoded = entries.map(([key, store, value]) => {
    const updated = { ...store, [scope]: value };
    const json = JSON.stringify(updated);
    if (Object.keys(updated).length > MAX_SCOPES || new TextEncoder().encode(json).byteLength > MAX_SERIALIZED_BYTES) throw new RangeError("Nastavení projektů překročilo limit úložiště.");
    return [key, json] as const;
  });
  encoded.forEach(([key, json]) => storage.setItem(key, json));
}

export const setLayerName = (
  storage: Pick<Storage, "getItem" | "setItem">,
  scope: string,
  layerId: string,
  name: string,
): Readonly<Record<string, string>> => {
  const normalizedName = normalizeLayerName(name);
  if (!SCOPE_ID.test(scope) || !LAYER_ID.test(layerId)) {
    throw new TypeError("Název vrstvy nebo její identifikátor nejsou platné.");
  }
  const store = readLayerNameStore(storage);
  const scopeNames = Object.freeze({ ...(store[scope] ?? {}), [layerId]: normalizedName });
  if (Object.keys(scopeNames).length > MAX_LAYERS_PER_SCOPE) throw new RangeError("Projekt překročil limit názvů vrstev.");
  const updated = { ...store, [scope]: scopeNames };
  if (Object.keys(updated).length > MAX_SCOPES) throw new RangeError("Úložiště překročilo limit projektů.");
  const serialized = JSON.stringify(updated);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) throw new RangeError("Úložiště názvů překročilo bezpečný limit.");
  storage.setItem(LAYER_NAMES_KEY, serialized);
  return scopeNames;
};
