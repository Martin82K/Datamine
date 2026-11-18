import {
  isModelObject,
  type ModelObject,
  type RoomObject,
} from "@datamine/contracts";

export interface EditorState {
  readonly revision: number;
  readonly objects: readonly ModelObject[];
  readonly selection: readonly string[];
}

interface CommandBase {
  readonly id: string;
  readonly baseRevision: number;
}

export interface UpsertObjectCommand extends CommandBase {
  readonly type: "object.upsert";
  readonly object: ModelObject;
}

export interface RemoveObjectCommand extends CommandBase {
  readonly type: "object.remove";
  readonly objectId: string;
}

export interface SetSelectionCommand extends CommandBase {
  readonly type: "selection.set";
  readonly objectIds: readonly string[];
}

export type EditorCommand =
  | UpsertObjectCommand
  | RemoveObjectCommand
  | SetSelectionCommand;

export interface ModuleManifest {
  readonly id: string;
  readonly version: string;
  readonly objectTypes: readonly string[];
  readonly commandTypes: readonly string[];
  readonly providesCapabilities?: readonly string[];
  readonly requiresCapabilities?: readonly string[];
}

export class RevisionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Příkaz očekává revizi ${expected}, aktuální revize je ${actual}.`);
    this.name = "RevisionConflictError";
  }
}

export class InvalidCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCommandError";
  }
}

export class HistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryError";
  }
}

const cloneObject = (value: ModelObject): ModelObject => structuredClone(value);

function copyState(state: EditorState): EditorState {
  return Object.freeze({
    revision: state.revision,
    objects: Object.freeze(state.objects.map(cloneObject)),
    selection: Object.freeze([...state.selection]),
  });
}

function validateUniqueObjects(objects: readonly ModelObject[]): void {
  const ids = new Set<string>();
  for (const object of objects) {
    if (!isModelObject(object)) {
      throw new InvalidCommandError("Model obsahuje objekt mimo registrovaný kontrakt.");
    }
    if (ids.has(object.id)) {
      throw new InvalidCommandError(`Model obsahuje duplicitní ID ${object.id}.`);
    }
    ids.add(object.id);
  }
}

function reduceCommand(state: EditorState, command: EditorCommand): EditorState {
  if (!command.id || command.id.length > 100) {
    throw new InvalidCommandError("Příkaz musí mít krátké stabilní ID.");
  }

  switch (command.type) {
    case "object.upsert": {
      if (!isModelObject(command.object)) {
        throw new InvalidCommandError("Objekt neodpovídá verzovanému kontraktu.");
      }
      const objects = state.objects.filter((item) => item.id !== command.object.id);
      objects.push(cloneObject(command.object));
      objects.sort((left, right) => left.id.localeCompare(right.id));
      return { ...state, objects };
    }
    case "object.remove": {
      if (!state.objects.some((item) => item.id === command.objectId)) {
        throw new InvalidCommandError(`Objekt ${command.objectId} neexistuje.`);
      }
      return {
        ...state,
        objects: state.objects.filter((item) => item.id !== command.objectId),
        selection: state.selection.filter((id) => id !== command.objectId),
      };
    }
    case "selection.set": {
      const selected = new Set(command.objectIds);
      if (selected.size !== command.objectIds.length) {
        throw new InvalidCommandError("Výběr obsahuje duplicitní ID.");
      }
      const known = new Set(state.objects.map((item) => item.id));
      for (const objectId of command.objectIds) {
        if (!known.has(objectId)) {
          throw new InvalidCommandError(`Nelze vybrat neznámý objekt ${objectId}.`);
        }
      }
      return { ...state, selection: [...command.objectIds] };
    }
  }
}

export class EditorStore {
  #state: EditorState;
  readonly #past: EditorState[] = [];
  readonly #future: EditorState[] = [];
  readonly #historyLimit: number;

  constructor(objects: readonly ModelObject[] = [], historyLimit = 100) {
    if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 10_000) {
      throw new RangeError("Limit historie musí být celé číslo od 1 do 10 000.");
    }
    validateUniqueObjects(objects);
    this.#historyLimit = historyLimit;
    this.#state = copyState({ revision: 0, objects, selection: [] });
  }

  get snapshot(): EditorState {
    return copyState(this.#state);
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  get undoCount(): number {
    return this.#past.length;
  }

  get redoCount(): number {
    return this.#future.length;
  }

  setSelection(objectIds: readonly string[]): EditorState {
    const reduced = reduceCommand(this.#state, {
      id: "selection_transient",
      type: "selection.set",
      baseRevision: this.#state.revision,
      objectIds,
    });
    this.#state = copyState(reduced);
    return this.snapshot;
  }

  execute(command: EditorCommand): EditorState {
    if (command.baseRevision !== this.#state.revision) {
      throw new RevisionConflictError(command.baseRevision, this.#state.revision);
    }
    const reduced = reduceCommand(this.#state, command);
    this.#past.push(this.#state);
    if (this.#past.length > this.#historyLimit) {
      this.#past.shift();
    }
    this.#future.length = 0;
    this.#state = copyState({ ...reduced, revision: this.#state.revision + 1 });
    return this.snapshot;
  }

  executeBatch(commands: readonly EditorCommand[]): EditorState {
    if (!commands.length || commands.length > 10_000) {
      throw new InvalidCommandError("Dávka musí obsahovat 1 až 10 000 příkazů.");
    }
    const baseRevision = this.#state.revision;
    if (commands.some((command) => command.baseRevision !== baseRevision)) {
      throw new RevisionConflictError(commands.find((command) => command.baseRevision !== baseRevision)!.baseRevision, baseRevision);
    }
    const commandIds = new Set(commands.map((command) => command.id));
    if (commandIds.size !== commands.length) {
      throw new InvalidCommandError("Dávka obsahuje duplicitní ID příkazů.");
    }
    let reduced = this.#state;
    for (const command of commands) reduced = reduceCommand(reduced, command);
    this.#past.push(this.#state);
    if (this.#past.length > this.#historyLimit) this.#past.shift();
    this.#future.length = 0;
    this.#state = copyState({ ...reduced, revision: baseRevision + 1 });
    return this.snapshot;
  }

  undo(): EditorState {
    const previous = this.#past.pop();
    if (!previous) {
      throw new HistoryError("Není co vrátit.");
    }
    this.#future.push(this.#state);
    this.#state = copyState({ ...previous, revision: this.#state.revision + 1 });
    return this.snapshot;
  }

  redo(): EditorState {
    const next = this.#future.pop();
    if (!next) {
      throw new HistoryError("Není co opakovat.");
    }
    this.#past.push(this.#state);
    this.#state = copyState({ ...next, revision: this.#state.revision + 1 });
    return this.snapshot;
  }
}

export function updateRoomVertex(
  object: RoomObject,
  pointIndex: number,
  point: readonly [number, number],
): RoomObject {
  const sourceRing = object.geometry.rings[0];
  if (
    !sourceRing
    || !Number.isInteger(pointIndex)
    || pointIndex < 0
    || pointIndex >= sourceRing.length
    || point.length !== 2
    || !point.every((value) => Number.isFinite(value) && Math.abs(value) <= 100_000_000)
  ) {
    throw new InvalidCommandError("Vrchol polygonu není platný.");
  }
  const updated = structuredClone(object);
  updated.geometry.rings[0]![pointIndex] = [point[0], point[1]];
  const ring = updated.geometry.rings[0];
  if (!ring) {
    throw new InvalidCommandError("Místnost nemá polygon k editaci.");
  }
  let twiceArea = 0;
  let perimeter = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const following = ring[(index + 1) % ring.length]!;
    twiceArea += current[0] * following[1] - following[0] * current[1];
    perimeter += Math.hypot(following[0] - current[0], following[1] - current[1]);
  }
  updated.properties.geometric_area_m2 = Math.abs(twiceArea) / 2;
  updated.properties.perimeter_m = perimeter;
  updated.properties.shape_source = "manual";
  updated.properties.review_state = "corrected";
  if (!isModelObject(updated)) {
    throw new InvalidCommandError("Úprava vytvořila neplatný polygon místnosti.");
  }
  return updated;
}

export class ModuleRegistry {
  readonly #modules = new Map<string, ModuleManifest>();
  readonly #objectOwners = new Map<string, string>();
  readonly #capabilityProviders = new Map<string, string>();

  register(manifest: ModuleManifest): void {
    if (this.#modules.has(manifest.id)) {
      throw new Error(`Modul ${manifest.id} je již registrovaný.`);
    }
    for (const objectType of manifest.objectTypes) {
      const owner = this.#objectOwners.get(objectType);
      if (owner) {
        throw new Error(`Typ ${objectType} již vlastní modul ${owner}.`);
      }
    }
    for (const capability of manifest.providesCapabilities ?? []) {
      const provider = this.#capabilityProviders.get(capability);
      if (provider) {
        throw new Error(`Capability ${capability} již poskytuje modul ${provider}.`);
      }
    }
    for (const capability of manifest.requiresCapabilities ?? []) {
      if (!this.#capabilityProviders.has(capability)) {
        throw new Error(`Modulu ${manifest.id} chybí capability ${capability}.`);
      }
    }
    const frozen = Object.freeze({
      ...manifest,
      objectTypes: Object.freeze([...manifest.objectTypes]),
      commandTypes: Object.freeze([...manifest.commandTypes]),
      providesCapabilities: Object.freeze([...(manifest.providesCapabilities ?? [])]),
      requiresCapabilities: Object.freeze([...(manifest.requiresCapabilities ?? [])]),
    });
    this.#modules.set(manifest.id, frozen);
    for (const objectType of manifest.objectTypes) {
      this.#objectOwners.set(objectType, manifest.id);
    }
    for (const capability of manifest.providesCapabilities ?? []) {
      this.#capabilityProviders.set(capability, manifest.id);
    }
  }

  get manifests(): readonly ModuleManifest[] {
    return [...this.#modules.values()];
  }

  ownerOf(objectType: string): string | undefined {
    return this.#objectOwners.get(objectType);
  }

  providerOf(capability: string): string | undefined {
    return this.#capabilityProviders.get(capability);
  }
}
