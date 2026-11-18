import type { CadUnderlayView, DocumentView, ModelObject, RoomObject } from "@datamine/contracts";
import {
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  AxesHelper,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  GridHelper,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Plane,
  PerspectiveCamera,
  Points,
  Raycaster,
  Scene,
  ShaderMaterial,
  Texture,
  SRGBColorSpace,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Material,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { findMeasurementSnap, type MeasurementSnap } from "./measurement-snap.js";

export { findMeasurementSnap, type MeasurementSnap } from "./measurement-snap.js";

import { ControlsUpdateLoop } from "./controls-update-loop.js";

export { ControlsUpdateLoop } from "./controls-update-loop.js";

export type ViewMode = "2d" | "3d";
export type ViewPreset3D = "xy" | "xz" | "yz" | "iso";
export type ViewState3D = ViewPreset3D | "free";
export type ViewportInteractionMode = "navigate" | "box-select";

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function normalizeScreenRect(
  start: readonly [number, number],
  end: readonly [number, number],
): ScreenRect {
  return Object.freeze({
    left: Math.min(start[0], end[0]),
    top: Math.min(start[1], end[1]),
    right: Math.max(start[0], end[0]),
    bottom: Math.max(start[1], end[1]),
  });
}

export function pointerGestureIsClick(
  start: readonly [number, number],
  end: readonly [number, number],
  maximumDistancePx = 6,
): boolean {
  if (!Number.isFinite(maximumDistancePx) || maximumDistancePx < 0) return false;
  return Math.hypot(end[0] - start[0], end[1] - start[1]) <= maximumDistancePx;
}

export interface RenderableDescriptor {
  readonly id: string;
  readonly color?: string;
  readonly opacity?: number;
  readonly presentation?: "default" | "preview";
  readonly showTriangulation?: boolean;
  readonly ring: readonly (readonly [number, number])[];
  readonly heightM: number;
  readonly floorLevelM: number;
  readonly volumeM3: number;
  readonly parts?: readonly RenderablePart[];
  readonly mesh?: RenderableMesh;
  readonly polyline?: readonly Point3D[];
  readonly point?: Point3D;
  readonly pointRadiusM?: number;
}

export interface RenderableMesh {
  readonly vertices: readonly Point3D[];
  readonly faces: readonly (readonly [number, number, number])[];
}

export interface GeographicContextMesh extends RenderableMesh {
  readonly uv: readonly (readonly [number, number])[];
  readonly image: HTMLImageElement;
  readonly opacity: number;
}

export interface RenderablePart {
  readonly ring: readonly (readonly [number, number])[];
  readonly heightM: number;
  readonly floorLevelM: number;
}

export interface DatamineViewportOptions {
  readonly canvas: HTMLCanvasElement;
  readonly mode?: ViewMode;
  readonly documentView?: DocumentView;
  readonly cadUnderlayView?: CadUnderlayView;
  readonly maxObjects?: number;
  readonly onPick?: (objectId: string | null, additive: boolean) => void;
  readonly onViewStateChange?: (viewState: ViewState3D) => void;
}

export interface CameraPose3D {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up?: readonly [number, number, number];
}

export interface CadUnderlayDescriptor {
  readonly sourceDocumentId: string;
  readonly sourceDocumentSha256: string;
  readonly pageIndex: number;
  readonly cornersWorldM: readonly Point3D[];
}

const DEFAULT_MAX_OBJECTS = 10_000;
const DEFAULT_MAX_POINTS = 100_000;
const MAX_PIXEL_RATIO = 2;
const OBJECT_ID_KEY = "datamineObjectId";
const ORBIT_MIN_ELEVATION_RADIANS = 5 * Math.PI / 180;

export function initialPlanCameraPose(
  center: readonly [number, number, number],
  size: readonly [number, number, number],
  aspect: number,
  verticalFovDegrees = 38,
): CameraPose3D {
  const safeAspect = Math.max(0.1, aspect);
  const verticalFovRadians = verticalFovDegrees * Math.PI / 180;
  const halfHeight = Math.max(size[1] / 2, size[0] / (2 * safeAspect), 1) * 1.15;
  const distance = halfHeight / Math.tan(verticalFovRadians / 2);
  const position: readonly [number, number, number] = Object.freeze([
    center[0], center[1], center[2] + distance,
  ]);
  const target: readonly [number, number, number] = Object.freeze([
    center[0], center[1], center[2],
  ]);
  return Object.freeze({
    position,
    target,
  });
}

export function cameraPoseForPreset(
  preset: ViewPreset3D,
  center: readonly [number, number, number],
  size: readonly [number, number, number],
  aspect: number,
  verticalFovDegrees = 38,
): CameraPose3D {
  if (preset === "xy") {
    const pose = initialPlanCameraPose(center, size, aspect, verticalFovDegrees);
    return Object.freeze({ ...pose, up: Object.freeze([0, 0, 1] as [number, number, number]) });
  }
  const safeAspect = Math.max(0.1, aspect);
  const fov = verticalFovDegrees * Math.PI / 180;
  const dimensions: readonly [number, number] = preset === "xz" ? [size[0], size[2]]
    : preset === "yz" ? [size[1], size[2]]
      : [Math.max(...size) * 1.35, Math.max(...size) * 1.35];
  const halfHeight = Math.max(dimensions[1] / 2, dimensions[0] / (2 * safeAspect), 1) * 1.15;
  const distance = halfHeight / Math.tan(fov / 2);
  const direction: readonly [number, number, number] = preset === "xz" ? [0, -1, 0]
    : preset === "yz" ? [1, 0, 0]
      : [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  return Object.freeze({
    position: Object.freeze([
      center[0] + direction[0] * distance,
      center[1] + direction[1] * distance,
      center[2] + direction[2] * distance,
    ] as [number, number, number]),
    target: Object.freeze([...center] as [number, number, number]),
    up: Object.freeze([0, 0, 1] as [number, number, number]),
  });
}

export function isOrthographicViewPreset(preset: ViewPreset3D): boolean {
  return preset !== "iso";
}

export function orthographicHalfHeightForPreset(
  preset: ViewPreset3D,
  size: readonly [number, number, number],
  aspect: number,
): number {
  const safeAspect = Math.max(0.1, aspect);
  const dimensions: readonly [number, number] = preset === "xy" ? [size[0], size[1]]
    : preset === "xz" ? [size[0], size[2]]
      : preset === "yz" ? [size[1], size[2]]
        : [Math.hypot(size[0], size[1]), size[2] + Math.hypot(size[0], size[1]) * 0.5];
  return Math.max(dimensions[1] / 2, dimensions[0] / (2 * safeAspect), 1) * 1.15;
}

export function perspectiveFitDistance(
  size: readonly [number, number, number],
  aspect: number,
  verticalFovDegrees = 38,
): number {
  const safeAspect = Math.max(0.1, aspect);
  const verticalFov = verticalFovDegrees * Math.PI / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  const radius = Math.max(Math.hypot(size[0], size[1], size[2]) / 2, 1);
  return radius / Math.sin(limitingFov / 2) * 1.08;
}

export function shouldFitAfterGeometryChange(
  mode: ViewMode,
  hasInitial3dFit: boolean,
): boolean {
  return mode === "2d" || !hasInitial3dFit;
}

export type Point2D = readonly [number, number];
export type Point3D = readonly [number, number, number];
type Affine2D = readonly [number, number, number, number, number, number];

export * from "./geometry-stream.js";

export function roomVolumeM3(object: RoomObject): number {
  const properties = object.properties;
  const area = properties.geometric_area_m2;
  const height = properties.height_m;
  const floorLevel = properties.floor_level_m;
  if (
    !Number.isFinite(area) || area < 0
    || !Number.isFinite(height) || height <= 0
    || !Number.isFinite(floorLevel)
  ) {
    throw new TypeError(`Objekt ${object.id} nemá platné 3D vlastnosti.`);
  }
  const volume = area * height;
  if (!Number.isFinite(volume)) {
    throw new RangeError(`Objekt ${object.id} překročil číselný limit objemu.`);
  }
  return volume;
}

function applyAffine(matrix: Affine2D, point: Point2D): Point2D {
  const [a, b, c, d, e, f] = matrix;
  const [x, y] = point;
  return Object.freeze([a * x + c * y + e, b * x + d * y + f]);
}

export function invertAffine(
  matrix: Affine2D,
): Affine2D {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-15) {
    throw new RangeError("Transformace dokumentu není invertibilní.");
  }
  const inverse = [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ] as Affine2D;
  if (!inverse.every(Number.isFinite)) {
    throw new RangeError("Transformace dokumentu překročila číselný limit.");
  }
  return inverse;
}

export function documentPointToDrawing(view: DocumentView, point: Point2D): Point2D {
  return applyAffine(view.pdf_to_drawing_m, point);
}

export function drawingPointToDocument(view: DocumentView, point: Point2D): Point2D {
  return applyAffine(invertAffine(view.pdf_to_drawing_m), point);
}

export function documentCornersInDrawing(view: DocumentView): readonly Point2D[] {
  return Object.freeze([
    documentPointToDrawing(view, [0, 0]),
    documentPointToDrawing(view, [view.page_width_pt, 0]),
    documentPointToDrawing(view, [view.page_width_pt, view.page_height_pt]),
    documentPointToDrawing(view, [0, view.page_height_pt]),
  ]);
}

export function cadDocumentPointToWorld(view: CadUnderlayView, point: Point2D): Point3D {
  const survey = applyAffine(view.pdf_to_survey_xy, point);
  const world = applyAffine(view.survey_to_world_xy, survey);
  return Object.freeze([
    world[0], world[1], view.survey_plane_elevation_m + view.world_elevation_offset_m,
  ]);
}

export function cadWorldPointToDocument(view: CadUnderlayView, point: Point3D): Point2D {
  const expectedElevation = view.survey_plane_elevation_m + view.world_elevation_offset_m;
  if (Math.abs(point[2] - expectedElevation) > view.tolerance_m) {
    throw new RangeError("Bod neleží v rovině CAD podkladu.");
  }
  const survey = applyAffine(invertAffine(view.survey_to_world_xy), [point[0], point[1]]);
  return applyAffine(invertAffine(view.pdf_to_survey_xy), survey);
}

export function cadDocumentCornersInWorld(view: CadUnderlayView): readonly Point3D[] {
  return Object.freeze([
    cadDocumentPointToWorld(view, [0, 0]),
    cadDocumentPointToWorld(view, [view.page_width_pt, 0]),
    cadDocumentPointToWorld(view, [view.page_width_pt, view.page_height_pt]),
    cadDocumentPointToWorld(view, [0, view.page_height_pt]),
  ]);
}

export function describeCadUnderlay(view: CadUnderlayView): CadUnderlayDescriptor {
  return Object.freeze({
    sourceDocumentId: view.source_document_id,
    sourceDocumentSha256: view.source_document_sha256,
    pageIndex: view.page_index,
    cornersWorldM: cadDocumentCornersInWorld(view),
  });
}

export function describeObjects(
  objects: readonly ModelObject[],
  maxObjects = DEFAULT_MAX_OBJECTS,
  maxPoints = DEFAULT_MAX_POINTS,
): readonly RenderableDescriptor[] {
  if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 100_000) {
    throw new RangeError("Limit rendereru musí být celé číslo od 1 do 100 000.");
  }
  if (objects.length > maxObjects) {
    throw new RangeError(`Renderer odmítl více než ${maxObjects} objektů.`);
  }
  if (!Number.isInteger(maxPoints) || maxPoints < 3 || maxPoints > 1_000_000) {
    throw new RangeError("Limit bodů rendereru musí být celé číslo od 3 do 1 000 000.");
  }

  let pointCount = 0;
  return objects.map((object) => {
    if (object.type !== "rooms.room") {
      throw new TypeError(`Objekt ${object.id} nemá registrovaný render adapter.`);
    }
    const outerRing = object.geometry.rings[0];
    if (!outerRing || outerRing.length < 3) {
      throw new TypeError(`Objekt ${object.id} nemá vykreslitelný vnější polygon.`);
    }
    pointCount += outerRing.length;
    if (pointCount > maxPoints) {
      throw new RangeError(`Renderer odmítl více než ${maxPoints} bodů.`);
    }
    const ring = outerRing.map(([x, y]) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError(`Objekt ${object.id} obsahuje neplatnou souřadnici.`);
      }
      return Object.freeze([x, y] as const);
    });
    return Object.freeze({
      id: object.id,
      ring: Object.freeze(ring),
      heightM: object.properties.height_m,
      floorLevelM: object.properties.floor_level_m,
      volumeM3: roomVolumeM3(object),
    });
  });
}

function createShape(id: string, ring: readonly (readonly [number, number])[]): Shape {
  const [first, ...rest] = ring;
  if (!first) {
    throw new TypeError(`Objekt ${id} nemá geometrii.`);
  }
  const shape = new Shape();
  shape.moveTo(first[0], first[1]);
  for (const point of rest) {
    shape.lineTo(point[0], point[1]);
  }
  shape.closePath();
  return shape;
}

function materialArray(material: Material | Material[]): readonly Material[] {
  return Array.isArray(material) ? material : [material];
}

export function disposeObjectResources(object: Object3D): void {
  object.traverse((child) => {
    const candidate = child as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    candidate.geometry?.dispose();
    if (candidate.material) {
      for (const material of materialArray(candidate.material)) {
        material.dispose();
      }
    }
  });
}

function createRenderable(
  descriptor: RenderableDescriptor,
  mode: ViewMode,
  selected: boolean,
): Group {
  const group = new Group();
  group.name = descriptor.id;
  group.userData[OBJECT_ID_KEY] = descriptor.id;
  const layerColor = new Color(descriptor.color ?? (descriptor.point ? "#5eead4" : "#26365d"));
  const layerOpacity = descriptor.opacity ?? 1;
  const fill = layerColor;
  if (descriptor.polyline) {
    const geometry = new BufferGeometry().setFromPoints(descriptor.polyline.map(([x, y, z]) => (
      new Vector3(x, y, mode === "2d" ? 0.03 : z)
    )));
    const line = new Line(
      geometry,
      new LineBasicMaterial({ color: selected ? 0xf8fafc : fill, transparent: layerOpacity < 1, opacity: layerOpacity }),
    );
    line.userData[OBJECT_ID_KEY] = descriptor.id;
    group.add(line);
    return group;
  }
  if (descriptor.point) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
    const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const material = new ShaderMaterial({
      uniforms: {
        pointColor: { value: layerColor },
        selectionColor: { value: new Color(0xfbbf24) },
        selected: { value: selected ? 1 : 0 },
        pointSize: { value: (selected ? 11 : 7) * pixelRatio },
        opacity: { value: layerOpacity },
      },
      vertexShader: "uniform float pointSize; void main(){ gl_PointSize = pointSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform vec3 pointColor; uniform vec3 selectionColor; uniform float selected; uniform float opacity; void main(){ vec2 p = gl_PointCoord - vec2(0.5); float d = dot(p,p); if(d > 0.25) discard; vec3 color = selected > 0.5 && d > 0.13 ? selectionColor : pointColor; gl_FragColor = vec4(color, opacity); }",
      transparent: true,
      depthWrite: false,
    });
    const marker = new Points(geometry, material);
    marker.position.set(descriptor.point[0], descriptor.point[1], mode === "2d" ? 0.02 : descriptor.point[2]);
    marker.userData[OBJECT_ID_KEY] = descriptor.id;
    group.add(marker);
    return group;
  }
  if (descriptor.mesh) {
    const positions = descriptor.mesh.vertices.flatMap(([x, y, z]) => [x, y, mode === "2d" ? 0 : z]);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setIndex(descriptor.mesh.faces.flatMap((face) => [...face]));
    geometry.computeVertexNormals();
    const preview = descriptor.presentation === "preview";
    const showEdges = preview || descriptor.showTriangulation === true;
    const material = preview
      ? new MeshBasicMaterial({ color: fill, transparent: true, opacity: 0.18 * layerOpacity, depthWrite: false, side: DoubleSide })
      : mode === "2d"
        ? new MeshBasicMaterial({ color: fill, transparent: true, opacity: (selected ? 0.78 : 0.55) * layerOpacity, side: DoubleSide })
        : new MeshStandardMaterial({ color: fill, roughness: 0.7, metalness: 0.03, side: DoubleSide, transparent: layerOpacity < 1, opacity: layerOpacity, depthWrite: layerOpacity >= 0.99, emissive: selected ? 0x607afb : 0x000000, emissiveIntensity: selected ? 0.28 : 0 });
    material.polygonOffset = showEdges;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    const mesh = new Mesh(geometry, material);
    mesh.userData[OBJECT_ID_KEY] = descriptor.id;
    group.add(mesh);
    if (showEdges) {
      const wireframe = new Mesh(
        geometry.clone(),
        new MeshBasicMaterial({
          color: preview ? fill : selected ? 0xfbbf24 : 0x64748b,
          transparent: true,
          opacity: preview ? 0.9 * layerOpacity : 0.9,
          wireframe: true, depthWrite: false, side: DoubleSide,
        }),
      );
      wireframe.userData[OBJECT_ID_KEY] = descriptor.id;
      group.add(wireframe);
    }
    return group;
  }
  const parts = descriptor.parts ?? [{
    ring: descriptor.ring,
    heightM: descriptor.heightM,
    floorLevelM: descriptor.floorLevelM,
  }];
  for (const part of parts) {
    const shape = createShape(descriptor.id, part.ring);
    const geometry = mode === "2d"
      ? new ShapeGeometry(shape)
      : new ExtrudeGeometry(shape, { depth: part.heightM, bevelEnabled: false });
    const material = mode === "2d"
      ? new MeshBasicMaterial({ color: fill, transparent: true, opacity: (selected ? 0.72 : 0.48) * layerOpacity })
      : new MeshStandardMaterial({ color: fill, roughness: 0.64, metalness: 0.05, transparent: layerOpacity < 1, opacity: layerOpacity, depthWrite: layerOpacity >= 0.99, emissive: selected ? 0x607afb : 0x000000, emissiveIntensity: selected ? 0.28 : 0 });
    const mesh = new Mesh(geometry, material);
    if (mode === "3d") mesh.position.z = part.floorLevelM;
    mesh.userData[OBJECT_ID_KEY] = descriptor.id;
    group.add(mesh);

    const outlinePoints = part.ring.map(([x, y]) => new Vector3(
      x,
      y,
      mode === "2d" ? 0.01 : part.floorLevelM + part.heightM + 0.01,
    ));
    const outline = new LineLoop(
      new BufferGeometry().setFromPoints(outlinePoints),
      new LineBasicMaterial({ color: selected ? 0x9aacff : layerColor.clone().offsetHSL(0, -0.05, 0.18), transparent: layerOpacity < 1, opacity: layerOpacity }),
    );
    outline.userData[OBJECT_ID_KEY] = descriptor.id;
    group.add(outline);
  }
  return group;
}

export function validateDescriptors(
  descriptors: readonly RenderableDescriptor[],
  maxObjects = DEFAULT_MAX_OBJECTS,
  maxPoints = DEFAULT_MAX_POINTS,
): readonly RenderableDescriptor[] {
  if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 100_000) {
    throw new RangeError("Limit rendereru musí být celé číslo od 1 do 100 000.");
  }
  if (!Number.isInteger(maxPoints) || maxPoints < 3 || maxPoints > 1_000_000) {
    throw new RangeError("Limit bodů rendereru musí být celé číslo od 3 do 1 000 000.");
  }
  if (descriptors.length > maxObjects) throw new RangeError("Renderer překročil limit objektů.");
  const ids = new Set<string>();
  let points = 0;
  let meshFaces = 0;
  for (const descriptor of descriptors) {
    if (!descriptor.id || ids.has(descriptor.id)) throw new TypeError("Renderer descriptor nemá unikátní ID.");
    ids.add(descriptor.id);
    if (descriptor.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(descriptor.color)) {
      throw new TypeError(`Objekt ${descriptor.id} nemá platnou barvu vrstvy.`);
    }
    if (descriptor.opacity !== undefined && (
      !Number.isFinite(descriptor.opacity) || descriptor.opacity < 0.05 || descriptor.opacity > 1
    )) throw new TypeError(`Objekt ${descriptor.id} nemá platnou průhlednost vrstvy.`);
    if (descriptor.presentation !== undefined && !["default", "preview"].includes(descriptor.presentation)) {
      throw new TypeError(`Objekt ${descriptor.id} nemá platný způsob prezentace.`);
    }
    if (descriptor.showTriangulation !== undefined && typeof descriptor.showTriangulation !== "boolean") {
      throw new TypeError(`Objekt ${descriptor.id} nemá platnou volbu triangulace.`);
    }
    if (!Number.isFinite(descriptor.volumeM3) || descriptor.volumeM3 < 0) {
      throw new TypeError(`Objekt ${descriptor.id} nemá platný objem.`);
    }
    if (descriptor.polyline) {
      points += descriptor.polyline.length;
      if (points > maxPoints) throw new RangeError("Renderer překročil limit bodů.");
      if (descriptor.polyline.length < 2 || descriptor.polyline.some((point) => point.some((value) => !Number.isFinite(value)))) {
        throw new TypeError(`Objekt ${descriptor.id} obsahuje neplatnou 3D linii.`);
      }
      continue;
    } else if (descriptor.point) {
      points += 1;
      if (points > maxPoints) throw new RangeError("Renderer překročil limit bodů.");
      if (descriptor.point.some((value) => !Number.isFinite(value))) {
        throw new TypeError(`Objekt ${descriptor.id} obsahuje neplatný bod.`);
      }
      if (descriptor.pointRadiusM !== undefined && (
        !Number.isFinite(descriptor.pointRadiusM) || descriptor.pointRadiusM <= 0 || descriptor.pointRadiusM > 100
      )) throw new TypeError(`Objekt ${descriptor.id} má neplatnou velikost bodu.`);
      continue;
    } else if (descriptor.mesh) {
      meshFaces += descriptor.mesh.faces.length;
      if (meshFaces > 200_000) throw new RangeError("Renderer překročil limit 200 000 trojúhelníků.");
      points += descriptor.mesh.vertices.length;
      if (points > maxPoints) throw new RangeError("Renderer překročil limit bodů.");
      if (!descriptor.mesh.vertices.length || !descriptor.mesh.faces.length) {
        throw new TypeError(`Objekt ${descriptor.id} nemá vykreslitelný mesh.`);
      }
      if (descriptor.mesh.vertices.some((point) => point.some((value) => !Number.isFinite(value)))) {
        throw new TypeError(`Objekt ${descriptor.id} obsahuje neplatný mesh bod.`);
      }
      if (descriptor.mesh.faces.some((face) => (
        face.length !== 3 || new Set(face).size !== 3
        || face.some((index) => !Number.isInteger(index) || index < 0 || index >= descriptor.mesh!.vertices.length)
      ))) throw new TypeError(`Objekt ${descriptor.id} obsahuje neplatný mesh face.`);
      continue;
    }
    const parts = descriptor.parts ?? [{
      ring: descriptor.ring,
      heightM: descriptor.heightM,
      floorLevelM: descriptor.floorLevelM,
    }];
    if (!parts.length) throw new TypeError(`Objekt ${descriptor.id} nemá render části.`);
    for (const part of parts) {
      points += part.ring.length;
      if (points > maxPoints) throw new RangeError("Renderer překročil limit bodů.");
      let twiceArea = 0;
      for (let index = 0; index < part.ring.length; index += 1) {
        const current = part.ring[index];
        const following = part.ring[(index + 1) % part.ring.length];
        if (!current || !following) continue;
        twiceArea += current[0] * following[1] - following[0] * current[1];
      }
      if (
        part.ring.length < 3
        || !part.ring.every((point) => point.every(
          (value) => Number.isFinite(value) && Math.abs(value) <= 100_000_000,
        ))
        || !Number.isFinite(twiceArea)
        || Math.abs(twiceArea) <= 1e-9
        || !Number.isFinite(part.heightM)
        || part.heightM <= 0
        || part.heightM > 1_000
        || !Number.isFinite(part.floorLevelM)
        || part.floorLevelM < -1_000
        || part.floorLevelM > 10_000
      ) throw new TypeError(`Objekt ${descriptor.id} nemá platný render descriptor.`);
    }
  }
  return descriptors;
}

export function objectIdFromNode(node: Object3D | null): string | null {
  let current = node;
  while (current) {
    const value = current.userData[OBJECT_ID_KEY];
    if (typeof value === "string") {
      return value;
    }
    current = current.parent;
  }
  return null;
}

export class ModelScene {
  readonly root = new Group();
  readonly #objects = new Map<string, Group>();
  #mode: ViewMode;
  #selection = new Set<string>();

  constructor(mode: ViewMode = "2d") {
    this.#mode = mode;
    this.root.name = "datamine-model";
  }

  get mode(): ViewMode {
    return this.#mode;
  }

  get size(): number {
    return this.#objects.size;
  }

  get(id: string): Group | undefined {
    return this.#objects.get(id);
  }

  replace(descriptors: readonly RenderableDescriptor[]): void {
    this.clear();
    for (const descriptor of descriptors) {
      const group = createRenderable(descriptor, this.#mode, this.#selection.has(descriptor.id));
      this.#objects.set(descriptor.id, group);
      this.root.add(group);
    }
  }

  setMode(mode: ViewMode, descriptors: readonly RenderableDescriptor[]): void {
    if (mode === this.#mode) {
      return;
    }
    this.#mode = mode;
    this.replace(descriptors);
  }

  setSelection(ids: readonly string[], descriptors: readonly RenderableDescriptor[]): void {
    this.#selection = new Set(ids);
    this.replace(descriptors);
  }

  clear(): void {
    for (const object of this.#objects.values()) {
      this.root.remove(object);
      disposeObjectResources(object);
    }
    this.#objects.clear();
  }

  dispose(): void {
    this.clear();
  }
}

export class DatamineViewport {
  readonly #canvas: HTMLCanvasElement;
  readonly #renderer: WebGLRenderer;
  readonly #scene = new Scene();
  readonly #model: ModelScene;
  #geographicMesh: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  #drawingMesh: Mesh<BufferGeometry, MeshBasicMaterial> | null = null;
  readonly #raycaster = new Raycaster();
  readonly #pointer = new Vector2();
  readonly #rotationPlane = new Plane(new Vector3(0, 0, 1));
  readonly #maxObjects: number;
  readonly #onPick: ((objectId: string | null, additive: boolean) => void) | undefined;
  readonly #onViewStateChange: ((viewState: ViewState3D) => void) | undefined;
  readonly #camera2d = new OrthographicCamera();
  readonly #camera3d = new PerspectiveCamera(38, 1, 0.01, 10_000);
  readonly #camera3dOrthographic = new OrthographicCamera(-1, 1, 1, -1, 0.01, 100_000);
  readonly #controls: OrbitControls<Camera>;
  readonly #grid = new GridHelper(10, 20, 0x52659c, 0x28344f);
  readonly #axes = new AxesHelper(1);
  #descriptors: readonly RenderableDescriptor[] = [];
  #documentView: DocumentView | undefined;
  #cadUnderlayView: CadUnderlayView | undefined;
  #mode: ViewMode;
  #hasInitial3dFit = false;
  #viewPreset: ViewPreset3D = "xy";
  #viewState: ViewState3D = "xy";
  #usesOrthographic3dCamera = true;
  #controlsInteractionActive = false;
  #controlsPointerButton: number | null = null;
  #switching3dCamera = false;
  #interactionMode: ViewportInteractionMode = "navigate";
  #pointerStart: { readonly pointerId: number; readonly point: readonly [number, number] } | null = null;
  #disposed = false;

  constructor(options: DatamineViewportOptions) {
    this.#canvas = options.canvas;
    this.#mode = options.mode ?? "2d";
    this.#documentView = options.documentView;
    this.#cadUnderlayView = options.cadUnderlayView;
    this.#maxObjects = options.maxObjects ?? DEFAULT_MAX_OBJECTS;
    this.#onPick = options.onPick;
    this.#onViewStateChange = options.onViewStateChange;
    this.#renderer = new WebGLRenderer({ canvas: this.#canvas, antialias: true, alpha: true });
    this.#renderer.setClearColor(0x000000, 0);
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.#syncBackground();
    this.#scene.add(new AmbientLight(0xffffff, 1.25));
    const key = new DirectionalLight(0xffffff, 2.3);
    key.position.set(4, -6, 10);
    this.#scene.add(key);
    this.#grid.rotation.x = Math.PI / 2;
    this.#grid.visible = this.#mode === "3d";
    this.#axes.visible = this.#mode === "3d";
    this.#scene.add(this.#grid, this.#axes);
    this.#model = new ModelScene(this.#mode);
    this.#scene.add(this.#model.root);
    this.#camera3d.up.set(0, 0, 1);
    this.#camera3dOrthographic.up.set(0, 0, 1);
    this.#controls = new OrbitControls<Camera>(this.#camera3dOrthographic, this.#canvas);
    this.#controls.rotateSpeed = 0.85;
    this.#controls.zoomSpeed = 1;
    this.#controls.panSpeed = 0.7;
    this.#controls.screenSpacePanning = true;
    this.#controls.zoomToCursor = true;
    this.#controls.minPolarAngle = 0;
    this.#controls.maxPolarAngle = Math.PI / 2 - ORBIT_MIN_ELEVATION_RADIANS;
    this.#controls.minDistance = 0.01;
    this.#controls.maxDistance = 100_000;
    this.#controls.minZoom = 0.01;
    this.#controls.maxZoom = 10_000;
    this.#controls.enabled = this.#mode === "3d";
    this.#controls.addEventListener("change", this.#handleControlsChange);
    this.#controls.addEventListener("start", this.#handleControlsStart);
    this.#controls.addEventListener("end", this.#handleControlsEnd);
    this.#canvas.addEventListener("pointerdown", this.#handlePointerDown);
    this.#canvas.addEventListener("pointerup", this.#handlePointerUp);
    this.#canvas.addEventListener("pointercancel", this.#handlePointerCancel);
    this.#canvas.addEventListener("dblclick", this.#handleRotationPivot);
    this.#raycaster.params.Points = { threshold: 1 };
    this.#raycaster.params.Line = { threshold: 0.25 };
    this.#fitPresetView();
  }

  setViewPreset(preset: ViewPreset3D): void {
    this.#assertActive();
    this.#viewPreset = preset;
    this.#setViewState(preset);
    if (this.#mode === "3d") {
      this.#fitPresetView();
      this.#hasInitial3dFit = this.#descriptors.length > 0;
      this.#render();
    }
  }

  resetView(): void {
    this.#assertActive();
    this.#setViewState(this.#viewPreset);
    this.#fitPresetView();
    this.#render();
  }

  fitView(): void {
    this.#assertActive();
    if (this.#mode === "3d") this.#fitCurrent3dView();
    else this.#fitPresetView();
    this.#render();
  }

  levelView(): void {
    this.#assertActive();
    if (this.#mode !== "3d") return;
    const camera = this.#active3dCamera();
    camera.up.set(0, 0, 1);
    camera.lookAt(this.#controls.target);
    camera.updateProjectionMatrix();
    this.#controls.update();
    this.#render();
  }

  setObjects(objects: readonly ModelObject[]): void {
    this.#assertActive();
    this.#descriptors = validateDescriptors(describeObjects(objects, this.#maxObjects), this.#maxObjects);
    this.#model.replace(this.#renderDescriptors());
    this.#fitAfterGeometryChange();
    this.#render();
  }

  setDescriptors(descriptors: readonly RenderableDescriptor[]): void {
    this.#assertActive();
    this.#descriptors = validateDescriptors(descriptors, this.#maxObjects);
    this.#model.replace(this.#renderDescriptors());
    this.#fitAfterGeometryChange();
    this.#render();
  }

  /** Context only: excluded from model selection, snapping, exports and quantities. */
  setGeographicContext(context: GeographicContextMesh | null): void {
    this.#geographicMesh = this.#setContextMesh(this.#geographicMesh, context, "cuzk-geographic-context");
  }

  /** A separately aligned sheet; never participates in picking or model exports. */
  setDrawingUnderlay(context: GeographicContextMesh | null): void {
    this.#drawingMesh = this.#setContextMesh(this.#drawingMesh, context, "drawing-underlay");
  }

  #setContextMesh(mesh: Mesh<BufferGeometry, MeshBasicMaterial> | null, context: GeographicContextMesh | null, name: string): Mesh<BufferGeometry, MeshBasicMaterial> | null {
    this.#assertActive();
    if (mesh) {
      this.#scene.remove(mesh);
      mesh.material.map?.dispose();
      disposeObjectResources(mesh);
      mesh = null;
    }
    if (context) {
      if (context.vertices.length > 22_801 || context.faces.length > 45_000 || context.uv.length !== context.vertices.length
        || !Number.isFinite(context.opacity) || context.opacity < 0 || context.opacity > 1
        || context.vertices.some((p) => p.some((n) => !Number.isFinite(n)))
        || context.uv.some((p) => p.some((n) => !Number.isFinite(n) || n < 0 || n > 1))
        || context.faces.some((f) => f.some((i) => !Number.isInteger(i) || i < 0 || i >= context.vertices.length))) throw new Error("Neplatný mapový podklad.");
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(context.vertices.flatMap((p) => [...p]), 3));
      geometry.setAttribute("uv", new Float32BufferAttribute(context.uv.flatMap((p) => [...p]), 2));
      geometry.setIndex(context.faces.flatMap((f) => [...f]));
      const texture = new Texture(context.image); texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true;
      const material = new MeshBasicMaterial({ map: texture, side: DoubleSide, transparent: context.opacity < 1,
        opacity: context.opacity, depthWrite: context.opacity >= 0.99,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      mesh = new Mesh(geometry, material);
      mesh.name = name;
      mesh.visible = this.#mode === "3d";
      this.#scene.add(mesh);
    }
    this.#render();
    return mesh;
  }

  measurementSnapAt(x: number, y: number, tolerancePx = 12): MeasurementSnap | null {
    this.#assertActive();
    if (this.#mode !== "3d") return null;
    const camera = this.#activeCamera();
    const width = this.#canvas.clientWidth, height = this.#canvas.clientHeight;
    this.#model.root.updateMatrixWorld(true);
    const opaqueIds = new Set(this.#descriptors.filter((descriptor) => descriptor.presentation !== "preview" && (descriptor.opacity ?? 1) === 1).map((descriptor) => descriptor.id));
    return findMeasurementSnap(this.#descriptors, camera, [x, y], width, height, tolerancePx, (candidate, clipDepth) => {
      const ndc = new Vector2(candidate.screen[0] / width * 2 - 1, 1 - candidate.screen[1] / height * 2);
      this.#raycaster.setFromCamera(ndc, camera);
      const target = new Vector3(ndc.x, ndc.y, clipDepth).unproject(camera);
      const distance = target.distanceTo(this.#raycaster.ray.origin);
      const hit = this.#raycaster.intersectObject(this.#model.root, true).find((entry) => entry.object instanceof Mesh && opaqueIds.has(objectIdFromNode(entry.object) ?? ""));
      // Screen snapping never selects the hidden underside of an opaque mesh.
      return !hit || hit.distance >= distance - Math.max(1e-5, distance * 1e-6);
    });
  }

  setSelection(ids: readonly string[]): void {
    this.#assertActive();
    this.#model.setSelection(ids, this.#renderDescriptors());
    this.#render();
  }

  setInteractionMode(mode: ViewportInteractionMode): void {
    this.#assertActive();
    this.#interactionMode = mode;
    this.#pointerStart = null;
    this.#controls.enabled = this.#mode === "3d" && mode === "navigate";
  }

  pointIdsInScreenRect(rect: ScreenRect): readonly string[] {
    this.#assertActive();
    const width = Math.max(1, this.#canvas.clientWidth);
    const height = Math.max(1, this.#canvas.clientHeight);
    const camera = this.#activeCamera();
    const ids: string[] = [];
    for (const descriptor of this.#renderDescriptors()) {
      if (!descriptor.point) continue;
      const projected = new Vector3(
        descriptor.point[0],
        descriptor.point[1],
        this.#mode === "2d" ? 0.02 : descriptor.point[2],
      ).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const x = (projected.x + 1) * width / 2;
      const y = (1 - projected.y) * height / 2;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) ids.push(descriptor.id);
    }
    return Object.freeze(ids);
  }

  setMode(mode: ViewMode): void {
    this.#assertActive();
    this.#mode = mode;
    if (mode !== "3d") this.#controlsInteractionActive = false;
    this.#model.setMode(mode, this.#renderDescriptors());
    if (this.#geographicMesh) this.#geographicMesh.visible = mode === "3d";
    if (this.#drawingMesh) this.#drawingMesh.visible = mode === "3d";
    this.#controls.enabled = mode === "3d" && this.#interactionMode === "navigate";
    this.#grid.visible = mode === "3d";
    this.#axes.visible = mode === "3d";
    this.#syncBackground();
    this.#fitPresetView();
    if (mode === "3d" && this.#descriptors.length > 0) {
      this.#hasInitial3dFit = true;
    }
    this.#render();
  }

  setDocumentView(documentView: DocumentView | undefined): void {
    this.#assertActive();
    this.#documentView = documentView;
    if (this.#mode === "2d") {
      this.#model.replace(this.#renderDescriptors());
    }
    this.#syncBackground();
    this.#render();
  }

  setCadUnderlayView(cadUnderlayView: CadUnderlayView | undefined): void {
    this.#assertActive();
    this.#cadUnderlayView = cadUnderlayView;
    if (this.#mode === "2d") this.#model.replace(this.#renderDescriptors());
    this.#syncBackground();
    this.#render();
  }

  resize(): void {
    this.#assertActive();
    const width = Math.max(1, this.#canvas.clientWidth);
    const height = Math.max(1, this.#canvas.clientHeight);
    this.#renderer.setSize(width, height, false);
    this.#updateProjection();
    this.#render();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#canvas.removeEventListener("pointerdown", this.#handlePointerDown);
    this.#canvas.removeEventListener("pointerup", this.#handlePointerUp);
    this.#canvas.removeEventListener("pointercancel", this.#handlePointerCancel);
    this.#canvas.removeEventListener("dblclick", this.#handleRotationPivot);
    this.#controls.removeEventListener("change", this.#handleControlsChange);
    this.#controls.removeEventListener("start", this.#handleControlsStart);
    this.#controls.removeEventListener("end", this.#handleControlsEnd);
    this.#controls.dispose();
    if (this.#geographicMesh) {
      this.#geographicMesh.material.map?.dispose();
      disposeObjectResources(this.#geographicMesh);
    }
    if (this.#drawingMesh) {
      this.#drawingMesh.material.map?.dispose();
      disposeObjectResources(this.#drawingMesh);
    }
    disposeObjectResources(this.#grid);
    disposeObjectResources(this.#axes);
    this.#model.dispose();
    this.#renderer.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("Renderer byl již uvolněn.");
    }
  }

  #activeCamera(): Camera {
    return this.#mode === "2d" ? this.#camera2d : this.#active3dCamera();
  }

  #active3dCamera(): PerspectiveCamera | OrthographicCamera {
    return this.#usesOrthographic3dCamera ? this.#camera3dOrthographic : this.#camera3d;
  }

  #setViewState(viewState: ViewState3D): void {
    if (this.#viewState === viewState) return;
    this.#viewState = viewState;
    this.#onViewStateChange?.(viewState);
  }

  #activate3dCamera(useOrthographic: boolean): PerspectiveCamera | OrthographicCamera {
    this.#usesOrthographic3dCamera = useOrthographic;
    const camera = this.#active3dCamera();
    this.#controls.object = camera;
    return camera;
  }

  #fitAfterGeometryChange(): void {
    if (shouldFitAfterGeometryChange(this.#mode, this.#hasInitial3dFit)) {
      this.#fitPresetView();
      if (this.#mode === "3d" && this.#descriptors.length > 0) {
        this.#hasInitial3dFit = true;
      }
      return;
    }
    this.#sync3dHelpers();
  }

  #sceneBounds(): { readonly bounds: Box3; readonly center: Vector3; readonly size: Vector3 } {
    const bounds = new Box3().setFromObject(this.#model.root);
    return {
      bounds,
      center: bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3()),
      size: bounds.isEmpty() ? new Vector3(4, 4, 1) : bounds.getSize(new Vector3()),
    };
  }

  #sync3dHelpers(): void {
    const { bounds, center, size } = this.#sceneBounds();
    const gridScale = Math.max(size.x, size.y, 10) * 0.15;
    this.#grid.scale.setScalar(gridScale);
    this.#grid.position.set(center.x, center.y, bounds.isEmpty() ? 0 : bounds.min.z);
    this.#axes.scale.setScalar(Math.max(size.x, size.y, size.z, 10) * 0.12);
    this.#axes.position.set(center.x, center.y, bounds.isEmpty() ? 0 : bounds.min.z);
  }

  #fitPresetView(): void {
    const underlay = this.#cadUnderlayView ?? this.#documentView;
    if (this.#mode === "2d" && underlay) {
      const width = underlay.page_width_pt;
      const height = underlay.page_height_pt;
      const aspect = Math.max(0.1, this.#canvas.clientWidth / Math.max(1, this.#canvas.clientHeight));
      const pageAspect = width / height;
      const halfWidth = aspect >= pageAspect ? height * aspect / 2 : width / 2;
      const halfHeight = aspect >= pageAspect ? height / 2 : width / aspect / 2;
      Object.assign(this.#camera2d, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight, near: 0.01, far: 1_000 });
      this.#camera2d.position.set(width / 2, height / 2, 10);
      this.#camera2d.lookAt(width / 2, height / 2, 0);
      this.#camera2d.updateProjectionMatrix();
      return;
    }
    const { center, size } = this.#sceneBounds();
    const aspect = Math.max(0.1, this.#canvas.clientWidth / Math.max(1, this.#canvas.clientHeight));

    if (this.#mode === "2d") {
      const halfHeight = Math.max(size.y / 2, size.x / Math.max(aspect, 0.1) / 2, 1) * 1.15;
      Object.assign(this.#camera2d, { left: -halfHeight * aspect, right: halfHeight * aspect, top: halfHeight, bottom: -halfHeight, near: 0.01, far: 1_000 });
      this.#camera2d.position.set(center.x, center.y, 10);
      this.#camera2d.lookAt(center.x, center.y, 0);
      this.#camera2d.updateProjectionMatrix();
      return;
    }

    const pose = cameraPoseForPreset(
      this.#viewPreset,
      [center.x, center.y, center.z],
      [size.x, size.y, size.z],
      aspect,
      this.#camera3d.fov,
    );
    const target = new Vector3(...pose.target);
    const useOrthographic = isOrthographicViewPreset(this.#viewPreset);
    const camera = this.#activate3dCamera(useOrthographic);
    this.#controls.maxPolarAngle = useOrthographic
      ? Math.PI / 2
      : Math.PI / 2 - ORBIT_MIN_ELEVATION_RADIANS;
    camera.up.set(...(pose.up ?? [0, 0, 1]));
    camera.position.set(...pose.position);
    camera.lookAt(target);
    if (camera instanceof OrthographicCamera) {
      const halfHeight = orthographicHalfHeightForPreset(
        this.#viewPreset,
        [size.x, size.y, size.z],
        aspect,
      );
      Object.assign(camera, {
        left: -halfHeight * aspect,
        right: halfHeight * aspect,
        top: halfHeight,
        bottom: -halfHeight,
        near: 0.01,
        far: 100_000,
        zoom: 1,
      });
    } else {
      camera.aspect = aspect;
    }
    camera.updateProjectionMatrix();
    this.#controls.target.copy(target);
    this.#controls.update();
    this.#sync3dHelpers();
  }

  #fitCurrent3dView(): void {
    const { center, size } = this.#sceneBounds();
    const aspect = Math.max(0.1, this.#canvas.clientWidth / Math.max(1, this.#canvas.clientHeight));
    const camera = this.#active3dCamera();
    const direction = camera.position.clone().sub(this.#controls.target);
    if (direction.lengthSq() < 1e-12) direction.set(1, -1, 1);
    direction.normalize();
    const diagonal = Math.max(size.length(), 2);

    if (camera instanceof OrthographicCamera) {
      const halfHeight = Math.max(diagonal / 2, 1) * 1.15;
      Object.assign(camera, {
        left: -halfHeight * aspect,
        right: halfHeight * aspect,
        top: halfHeight,
        bottom: -halfHeight,
        near: 0.01,
        far: 100_000,
        zoom: 1,
      });
      camera.position.copy(center).addScaledVector(direction, Math.max(diagonal * 2, 10));
      camera.up.set(0, 0, 1);
    } else {
      camera.aspect = aspect;
      const distance = perspectiveFitDistance([size.x, size.y, size.z], aspect, camera.fov);
      camera.position.copy(center).addScaledVector(direction, distance);
      camera.up.set(0, 0, 1);
    }
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    this.#controls.target.copy(center);
    this.#controls.update();
    this.#sync3dHelpers();
  }

  #switchToPerspectiveFromOrthographic(): void {
    if (!this.#usesOrthographic3dCamera || this.#switching3dCamera) return;
    const orthographic = this.#camera3dOrthographic;
    const target = this.#controls.target.clone();
    const direction = orthographic.position.clone().sub(target);
    if (direction.lengthSq() < 1e-12) direction.set(1, -1, 1);
    direction.normalize();
    const visibleHalfHeight = Math.max((orthographic.top - orthographic.bottom) / (2 * orthographic.zoom), 0.01);
    const distance = visibleHalfHeight / Math.tan(this.#camera3d.fov * Math.PI / 360);
    this.#camera3d.aspect = Math.max(0.1, this.#canvas.clientWidth / Math.max(1, this.#canvas.clientHeight));
    this.#camera3d.up.set(0, 0, 1);
    this.#camera3d.position.copy(target).addScaledVector(direction, distance);
    this.#camera3d.lookAt(target);
    this.#camera3d.updateProjectionMatrix();
    this.#switching3dCamera = true;
    try {
      this.#activate3dCamera(false);
      this.#controls.maxPolarAngle = Math.PI / 2 - ORBIT_MIN_ELEVATION_RADIANS;
      this.#controls.target.copy(target);
      this.#controls.update();
    } finally {
      this.#switching3dCamera = false;
    }
  }

  #updateProjection(): void {
    if (this.#mode === "2d") {
      this.#fitPresetView();
      return;
    }
    const aspect = Math.max(0.1, this.#canvas.clientWidth / Math.max(1, this.#canvas.clientHeight));
    const camera = this.#active3dCamera();
    if (camera instanceof OrthographicCamera) {
      const halfHeight = Math.max((camera.top - camera.bottom) / 2, 0.01);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
    } else {
      camera.aspect = aspect;
    }
    camera.updateProjectionMatrix();
  }

  #render(): void {
    this.#renderer.render(this.#scene, this.#activeCamera());
  }

  #syncBackground(): void {
    // Pozadí zůstává transparentní, aby sdílené CSS tokeny motivu řídily
    // 2D i 3D plátno bez vytváření druhého systému barev ve WebGL vrstvě.
    this.#scene.background = null;
  }

  #renderDescriptors(): readonly RenderableDescriptor[] {
    if (this.#mode !== "2d" || (!this.#documentView && !this.#cadUnderlayView)) {
      return this.#descriptors;
    }
    return this.#descriptors.map((descriptor) => Object.freeze({
      ...descriptor,
      ring: Object.freeze(
        descriptor.ring.map((point) => this.#cadUnderlayView
          ? cadWorldPointToDocument(this.#cadUnderlayView, [point[0], point[1], this.#cadUnderlayView.survey_plane_elevation_m + this.#cadUnderlayView.world_elevation_offset_m])
          : drawingPointToDocument(this.#documentView!, point)),
      ),
    }));
  }

  readonly #handlePointerDown = (event: PointerEvent): void => {
    if (this.#disposed || this.#interactionMode !== "navigate") return;
    this.#controlsPointerButton = event.button;
    if (!this.#onPick || event.button !== 0) return;
    this.#pointerStart = { pointerId: event.pointerId, point: [event.clientX, event.clientY] };
  };

  readonly #handlePointerUp = (event: PointerEvent): void => {
    const start = this.#pointerStart;
    this.#pointerStart = null;
    this.#controlsPointerButton = null;
    if (!start || start.pointerId !== event.pointerId || !this.#onPick || this.#disposed
      || this.#interactionMode !== "navigate" || event.button !== 0
      || !pointerGestureIsClick(start.point, [event.clientX, event.clientY])) return;
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.#pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.#raycaster.setFromCamera(this.#pointer, this.#activeCamera());
    const hit = this.#raycaster.intersectObject(this.#model.root, true)[0];
    this.#onPick(objectIdFromNode(hit?.object ?? null), event.shiftKey || event.metaKey || event.ctrlKey);
  };

  readonly #handlePointerCancel = (): void => {
    this.#pointerStart = null;
    this.#controlsPointerButton = null;
  };

  readonly #handleRotationPivot = (event: MouseEvent): void => {
    if (this.#disposed || this.#mode !== "3d") return;
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.#pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.#raycaster.setFromCamera(this.#pointer, this.#active3dCamera());
    const modelHit = this.#raycaster.intersectObject(this.#model.root, true)[0];
    this.#rotationPlane.constant = -this.#grid.position.z;
    const pivot = modelHit?.point.clone()
      ?? this.#raycaster.ray.intersectPlane(this.#rotationPlane, new Vector3());
    if (!pivot) return;
    this.#controls.target.copy(pivot);
    this.#axes.position.copy(pivot);
    this.#controls.update();
    this.#render();
  };

  readonly #handleControlsChange = (): void => {
    if (!this.#disposed && this.#mode === "3d") {
      if (this.#controlsInteractionActive && this.#usesOrthographic3dCamera && this.#controlsPointerButton === 0) {
        this.#switchToPerspectiveFromOrthographic();
      }
      if (this.#controlsInteractionActive) this.#setViewState("free");
      this.#axes.position.copy(this.#controls.target);
      this.#render();
    }
  };

  readonly #handleControlsStart = (): void => {
    if (!this.#disposed && this.#mode === "3d") this.#controlsInteractionActive = true;
  };

  readonly #handleControlsEnd = (): void => {
    this.#controlsInteractionActive = false;
    this.#controlsPointerButton = null;
  };
}
