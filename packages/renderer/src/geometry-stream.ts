import { isContract, type GeometryChunk, type GeometryStreamManifest } from "@datamine/contracts";
import type { Point3D, RenderableMesh } from "./index.js";

type Face = readonly [number, number, number];
type Sha256 = (bytes: Uint8Array) => Promise<string>;

const encoder = new TextEncoder();

export const sha256Hex: Sha256 = async (bytes) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
};

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

export function manifestBytes(manifest: GeometryStreamManifest): Uint8Array {
  return encoder.encode(stable(manifest));
}

export function chunkPayloadBytes(
  vertexStart: number,
  faceStart: number,
  vertices: readonly Point3D[],
  faces: readonly Face[],
): Uint8Array {
  const bytes = new Uint8Array(8 + vertices.length * 24 + faces.length * 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, vertexStart, false);
  view.setUint32(4, faceStart, false);
  let offset = 8;
  for (const vertex of vertices) {
    for (const coordinate of vertex) {
      view.setFloat64(offset, coordinate, false);
      offset += 8;
    }
  }
  for (const face of faces) {
    for (const index of face) {
      view.setUint32(offset, index, false);
      offset += 4;
    }
  }
  return bytes;
}

export function geometryBytes(vertices: readonly Point3D[], faces: readonly Face[]): Uint8Array {
  return chunkPayloadBytes(vertices.length, faces.length, vertices, faces);
}

export interface GeometryStreamScope {
  readonly streamId: string;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly sourceRevision: number;
  readonly sourceContentSha256: string;
  readonly objectId: string;
}

export async function createGeometryStream(
  mesh: RenderableMesh,
  scope: GeometryStreamScope,
  digest: Sha256 = sha256Hex,
  maxVertices = 4_096,
  maxFaces = 8_192,
): Promise<{ readonly manifest: GeometryStreamManifest; readonly chunks: readonly GeometryChunk[] }> {
  if (!Number.isInteger(maxVertices) || maxVertices < 1 || maxVertices > 4_096
    || !Number.isInteger(maxFaces) || maxFaces < 1 || maxFaces > 8_192) {
    throw new RangeError("Geometry stream používá neplatný chunk limit.");
  }
  if (mesh.vertices.length < 4 || mesh.vertices.length > 100_000
    || mesh.faces.length < 2 || mesh.faces.length > 200_000) {
    throw new RangeError("Geometry stream překročil celkový limit geometrie.");
  }
  const chunkCount = Math.max(
    Math.ceil(mesh.vertices.length / maxVertices),
    Math.ceil(mesh.faces.length / maxFaces),
  );
  if (chunkCount < 1 || chunkCount > 4_096) throw new RangeError("Geometry stream překročil počet chunků.");
  const payloads = await Promise.all(Array.from({ length: chunkCount }, async (_, sequence) => {
    const vertexStart = sequence * maxVertices;
    const faceStart = sequence * maxFaces;
    const vertices = mesh.vertices.slice(vertexStart, vertexStart + maxVertices);
    const faces = mesh.faces.slice(faceStart, faceStart + maxFaces);
    const bytes = chunkPayloadBytes(vertexStart, faceStart, vertices, faces);
    return { sequence, vertexStart, faceStart, vertices, faces, bytes, sha256: await digest(bytes) };
  }));
  const manifest: GeometryStreamManifest = {
    schema_version: "datamine.geometry-stream-manifest.v1",
    stream_id: scope.streamId, project_id: scope.projectId,
    source_version_id: scope.sourceVersionId, source_revision: scope.sourceRevision,
    source_content_sha256: scope.sourceContentSha256, object_id: scope.objectId,
    geometry_kind: "indexed_mesh", coordinate_space: "survey_crs",
    vertex_count: mesh.vertices.length, face_count: mesh.faces.length,
    chunk_count: chunkCount,
    total_payload_bytes: payloads.reduce((sum, payload) => sum + payload.bytes.byteLength, 0),
    geometry_sha256: await digest(geometryBytes(mesh.vertices, mesh.faces)),
  };
  if (!isContract("geometry_stream_manifest", manifest)) throw new TypeError("Geometry manifest není platný.");
  const manifestSha256 = await digest(manifestBytes(manifest));
  const chunks = payloads.map((payload): GeometryChunk => ({
    schema_version: "datamine.geometry-chunk.v1",
    stream_id: manifest.stream_id, project_id: manifest.project_id,
    source_version_id: manifest.source_version_id, source_revision: manifest.source_revision,
    source_content_sha256: manifest.source_content_sha256, object_id: manifest.object_id,
    manifest_sha256: manifestSha256, sequence: payload.sequence, chunk_count: chunkCount,
    vertex_start: payload.vertexStart, face_start: payload.faceStart,
    vertices: payload.vertices.map((point) => [...point]),
    faces: payload.faces.map((face) => [...face]),
    payload_bytes: payload.bytes.byteLength, payload_sha256: payload.sha256,
  }));
  if (chunks.some((chunk) => !isContract("geometry_chunk", chunk))) throw new TypeError("Geometry chunk není platný.");
  return Object.freeze({
    manifest: Object.freeze(manifest),
    chunks: Object.freeze(chunks.map((chunk) => Object.freeze(chunk))),
  });
}

export class GeometryStreamAssembler {
  readonly manifest: GeometryStreamManifest;
  private readonly digest: Sha256;
  private readonly chunks = new Map<number, GeometryChunk>();
  private vertexCount = 0;
  private faceCount = 0;
  private totalBytes = 0;
  private cancelled = false;

  constructor(manifest: GeometryStreamManifest, digest: Sha256 = sha256Hex) {
    if (!isContract("geometry_stream_manifest", manifest)) throw new TypeError("Geometry manifest není platný.");
    this.manifest = Object.freeze(structuredClone(manifest));
    this.digest = digest;
  }

  get progress(): number {
    return this.chunks.size / this.manifest.chunk_count;
  }

  private fail(message: string): never {
    this.cancel();
    throw new TypeError(message);
  }

  async accept(chunk: GeometryChunk): Promise<void> {
    if (this.cancelled) throw new Error("Geometry stream byl zrušen.");
    if (!isContract("geometry_chunk", chunk)) this.fail("Geometry chunk není platný.");
    const bound = chunk.stream_id === this.manifest.stream_id
      && chunk.project_id === this.manifest.project_id
      && chunk.source_version_id === this.manifest.source_version_id
      && chunk.source_revision === this.manifest.source_revision
      && chunk.source_content_sha256 === this.manifest.source_content_sha256
      && chunk.object_id === this.manifest.object_id
      && chunk.chunk_count === this.manifest.chunk_count
      && chunk.manifest_sha256 === await this.digest(manifestBytes(this.manifest));
    if (!bound) this.fail("Geometry chunk neodpovídá scoped manifestu.");
    const bytes = chunkPayloadBytes(chunk.vertex_start, chunk.face_start, chunk.vertices, chunk.faces);
    if (bytes.byteLength !== chunk.payload_bytes || await this.digest(bytes) !== chunk.payload_sha256) {
      this.fail("Geometry chunk neodpovídá checksumu nebo velikosti.");
    }
    const previous = this.chunks.get(chunk.sequence);
    if (previous) {
      if (previous.payload_sha256 !== chunk.payload_sha256) {
        this.fail("Geometry chunk koliduje s přijatou sekvencí.");
      }
      return;
    }
    if (chunk.sequence !== this.chunks.size) {
      this.fail("Geometry chunk přišel mimo očekávané pořadí.");
    }
    if (chunk.vertex_start !== this.vertexCount || chunk.face_start !== this.faceCount
      || this.vertexCount + chunk.vertices.length > this.manifest.vertex_count
      || this.faceCount + chunk.faces.length > this.manifest.face_count
      || this.totalBytes + chunk.payload_bytes > this.manifest.total_payload_bytes) {
      this.fail("Geometry chunk překročil průběžný manifest nebo není souvislý.");
    }
    this.chunks.set(chunk.sequence, Object.freeze(structuredClone(chunk)));
    this.vertexCount += chunk.vertices.length;
    this.faceCount += chunk.faces.length;
    this.totalBytes += chunk.payload_bytes;
  }

  cancel(): void {
    this.cancelled = true;
    this.chunks.clear();
    this.vertexCount = 0;
    this.faceCount = 0;
    this.totalBytes = 0;
  }

  async finalize(): Promise<RenderableMesh> {
    if (this.cancelled) throw new Error("Geometry stream byl zrušen.");
    if (this.chunks.size !== this.manifest.chunk_count) this.fail("Geometry stream obsahuje mezeru.");
    const vertices: Point3D[] = [];
    const faces: Face[] = [];
    let totalBytes = 0;
    for (let sequence = 0; sequence < this.manifest.chunk_count; sequence += 1) {
      const chunk = this.chunks.get(sequence);
      if (!chunk || chunk.vertex_start !== vertices.length || chunk.face_start !== faces.length) {
        this.fail("Geometry stream není souvislý nebo seřazený.");
      }
      vertices.push(...chunk.vertices);
      faces.push(...chunk.faces);
      totalBytes += chunk.payload_bytes;
    }
    if (vertices.length !== this.manifest.vertex_count || faces.length !== this.manifest.face_count
      || totalBytes !== this.manifest.total_payload_bytes
      || faces.some((face) => face.some((index) => index >= vertices.length))
      || await this.digest(geometryBytes(vertices, faces)) !== this.manifest.geometry_sha256) {
      this.fail("Geometry stream neodpovídá finálnímu manifestu.");
    }
    const result = Object.freeze({
      vertices: Object.freeze(vertices.map((point) => Object.freeze([...point] as [number, number, number]))),
      faces: Object.freeze(faces.map((face) => Object.freeze([...face] as [number, number, number]))),
    });
    this.cancel();
    return result;
  }
}
