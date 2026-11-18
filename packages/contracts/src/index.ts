import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const utcPattern = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$";
const sha256Pattern = "^[a-f0-9]{64}$";
const storageKeyPattern = "^(?!/)(?!.*\\.\\.)(?!.*\\\\)[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$";

const id = (prefix: string) => Type.String({
  minLength: prefix.length + 2,
  maxLength: 72,
  pattern: `^${prefix}_[A-Za-z0-9_-]+$`,
});

const timestamp = Type.String({ pattern: utcPattern, maxLength: 40 });
const sha256 = Type.String({ pattern: sha256Pattern });
const storageKey = Type.String({ pattern: storageKeyPattern, maxLength: 512 });

export const ProjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.project.v1"),
  id: id("project"),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  created_at: timestamp,
  updated_at: timestamp,
}, {
  $id: "datamine.project.v1",
  additionalProperties: false,
});

export const DocumentSchema = Type.Object({
  schema_version: Type.Literal("datamine.document.v1"),
  id: id("document"),
  project_id: id("project"),
  display_name: Type.String({ minLength: 1, maxLength: 200 }),
  technical_name: Type.String({
    minLength: 5,
    maxLength: 100,
    pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*\\.(?:pdf|xml)$",
  }),
  role: Type.Union([
    Type.Literal("floor_plan"),
    Type.Literal("situation"),
    Type.Literal("landxml"),
    Type.Literal("stakeout"),
    Type.Literal("other"),
  ]),
  media_type: Type.String({ minLength: 3, maxLength: 100 }),
  sha256,
  size_bytes: Type.Integer({ minimum: 1, maximum: 2_147_483_648 }),
  storage_key: storageKey,
  upload_state: Type.Union([
    Type.Literal("quarantined"),
    Type.Literal("ready"),
    Type.Literal("rejected"),
  ]),
  created_at: timestamp,
}, {
  $id: "datamine.document.v1",
  additionalProperties: false,
});

export const Point2DSchema = Type.Tuple([
  Type.Number({ minimum: -100_000_000, maximum: 100_000_000 }),
  Type.Number({ minimum: -100_000_000, maximum: 100_000_000 }),
]);

export const Point3DSchema = Type.Tuple([
  Type.Number({ minimum: -100_000_000, maximum: 100_000_000 }),
  Type.Number({ minimum: -100_000_000, maximum: 100_000_000 }),
  Type.Number({ minimum: -100_000, maximum: 100_000 }),
]);

export const AffineMatrix2DSchema = Type.Tuple([
  Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
  Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
  Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
  Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
  Type.Number({ minimum: -100_000_000, maximum: 100_000_000 }),
  Type.Number({ minimum: -100_000_000, maximum: 100_000_000 }),
]);

export const DocumentViewSchema = Type.Object({
  schema_version: Type.Literal("datamine.document-view.v1"),
  source_document_id: id("document"),
  source_document_sha256: sha256,
  page_index: Type.Integer({ minimum: 0, maximum: 9_999 }),
  page_width_pt: Type.Number({ exclusiveMinimum: 0, maximum: 200_000 }),
  page_height_pt: Type.Number({ exclusiveMinimum: 0, maximum: 200_000 }),
  page_rotation_deg: Type.Union([
    Type.Literal(0),
    Type.Literal(90),
    Type.Literal(180),
    Type.Literal(270),
  ]),
  drawing_scale: Type.Number({ minimum: 5, maximum: 1_000 }),
  source_coordinate_space: Type.Literal("pdf_display_pt"),
  target_coordinate_space: Type.Literal("drawing_m"),
  pdf_to_drawing_m: AffineMatrix2DSchema,
}, {
  $id: "datamine.document-view.v1",
  additionalProperties: false,
});

export const PolygonGeometrySchema = Type.Object({
  kind: Type.Literal("polygon"),
  coordinate_space: Type.Union([
    Type.Literal("drawing_m"),
    Type.Literal("world_m"),
    Type.Literal("survey_crs"),
  ]),
  rings: Type.Array(
    Type.Array(Point2DSchema, { minItems: 3, maxItems: 100_000 }),
    { minItems: 1, maxItems: 128 },
  ),
}, { additionalProperties: false });

export const PolylineGeometrySchema = Type.Object({
  kind: Type.Literal("polyline"),
  coordinate_space: Type.Union([
    Type.Literal("drawing_m"),
    Type.Literal("world_m"),
    Type.Literal("survey_crs"),
  ]),
  points: Type.Array(Point2DSchema, { minItems: 2, maxItems: 100_000 }),
}, { additionalProperties: false });

export const Polyline3DGeometrySchema = Type.Object({
  kind: Type.Literal("polyline3d"),
  coordinate_space: Type.Literal("survey_crs"),
  points: Type.Array(Point3DSchema, { minItems: 2, maxItems: 20_000 }),
}, { additionalProperties: false });

const ReviewStateSchema = Type.Union([
  Type.Literal("unreviewed"),
  Type.Literal("confirmed"),
  Type.Literal("corrected"),
  Type.Literal("rejected"),
]);

const ObjectProvenanceSchema = Type.Object({
  source_document_id: id("document"),
  source_document_sha256: sha256,
  source_job_id: Type.Optional(id("job")),
  source_kind: Type.Union([
    Type.Literal("automatic"),
    Type.Literal("manual"),
    Type.Literal("imported"),
  ]),
  algorithm_version: Type.String({ minLength: 1, maxLength: 100 }),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  last_command_id: Type.Optional(id("command")),
}, { additionalProperties: false });

export const RoomPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.room-properties.v1"),
  number: Type.String({ minLength: 1, maxLength: 50 }),
  name: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
  floor_area_m2: Type.Number({ minimum: 0, maximum: 10_000_000 }),
  geometric_area_m2: Type.Number({ minimum: 0, maximum: 10_000_000 }),
  table_area_m2: Type.Union([
    Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000 }),
    Type.Null(),
  ]),
  perimeter_m: Type.Number({ minimum: 0, maximum: 1_000_000 }),
  height_m: Type.Number({ exclusiveMinimum: 0, maximum: 1_000 }),
  floor_level_m: Type.Number({ minimum: -1_000, maximum: 10_000 }),
  included: Type.Boolean(),
  quality: Type.Union([
    Type.Literal("ok"),
    Type.Literal("mismatch"),
    Type.Literal("leak"),
    Type.Literal("no_seed"),
    Type.Literal("unverified"),
  ]),
  area_source: Type.Union([
    Type.Literal("geometry"),
    Type.Literal("ocr_table"),
    Type.Literal("estimate"),
    Type.Literal("manual"),
  ]),
  shape_source: Type.Union([
    Type.Literal("measured"),
    Type.Literal("estimate"),
    Type.Literal("manual"),
  ]),
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const RoomObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.room-object.v1"),
  id: id("object"),
  type: Type.Literal("rooms.room"),
  layer_id: id("layer"),
  geometry: PolygonGeometrySchema,
  properties: RoomPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.room-object.v1",
  additionalProperties: false,
});

export const WallPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.wall-properties.v1"),
  name: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
  thickness_m: Type.Number({ exclusiveMinimum: 0, maximum: 10 }),
  height_m: Type.Number({ exclusiveMinimum: 0, maximum: 1_000 }),
  base_level_m: Type.Number({ minimum: -1_000, maximum: 10_000 }),
  length_m: Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000 }),
  gross_side_area_m2: Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000_000 }),
  volume_m3: Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000_000 }),
  structural: Type.Boolean(),
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const WallObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.wall-object.v1"),
  id: id("object"),
  type: Type.Literal("building.wall"),
  layer_id: id("layer"),
  geometry: PolylineGeometrySchema,
  properties: WallPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.wall-object.v1",
  additionalProperties: false,
});

export const OpeningPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.opening-properties.v1"),
  host_wall_id: id("object"),
  opening_type: Type.Union([
    Type.Literal("door"),
    Type.Literal("window"),
    Type.Literal("void"),
  ]),
  width_m: Type.Number({ exclusiveMinimum: 0, maximum: 100 }),
  height_m: Type.Number({ exclusiveMinimum: 0, maximum: 100 }),
  sill_height_m: Type.Number({ minimum: 0, maximum: 100 }),
  area_m2: Type.Number({ exclusiveMinimum: 0, maximum: 10_000 }),
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const OpeningObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.opening-object.v1"),
  id: id("object"),
  type: Type.Literal("building.opening"),
  layer_id: id("layer"),
  geometry: PolylineGeometrySchema,
  properties: OpeningPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.opening-object.v1",
  additionalProperties: false,
});

export const FloorPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.floor-properties.v1"),
  name: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
  thickness_m: Type.Number({ exclusiveMinimum: 0, maximum: 10 }),
  top_level_m: Type.Number({ minimum: -1_000, maximum: 10_000 }),
  area_m2: Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000_000 }),
  volume_m3: Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000_000 }),
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const FloorObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.floor-object.v1"),
  id: id("object"),
  type: Type.Literal("building.floor"),
  layer_id: id("layer"),
  geometry: PolygonGeometrySchema,
  properties: FloorPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.floor-object.v1",
  additionalProperties: false,
});

export const BuildingObjectSchema = Type.Union([
  WallObjectSchema,
  OpeningObjectSchema,
  FloorObjectSchema,
], {
  $id: "datamine.building-object.v1",
});

export const SurveyCrsSchema = Type.Object({
  kind: Type.Literal("epsg"),
  epsg: Type.Integer({ minimum: 1, maximum: 999_999 }),
  axis_order: Type.Literal("east_north_up"),
  horizontal_unit: Type.Literal("m"),
  vertical_unit: Type.Literal("m"),
  vertical_datum: Type.String({ minLength: 1, maxLength: 100 }),
}, { additionalProperties: false });

const Bounds3DSchema = Type.Object({
  min: Point3DSchema,
  max: Point3DSchema,
}, { additionalProperties: false });

export const IndexedTinGeometrySchema = Type.Object({
  kind: Type.Literal("indexed_tin"),
  coordinate_space: Type.Literal("survey_crs"),
  vertices: Type.Array(Point3DSchema, { minItems: 3, maxItems: 20_000 }),
  faces: Type.Array(Type.Tuple([
    Type.Integer({ minimum: 0, maximum: 19_999 }),
    Type.Integer({ minimum: 0, maximum: 19_999 }),
    Type.Integer({ minimum: 0, maximum: 19_999 }),
  ]), { minItems: 1, maxItems: 40_000 }),
  bounds: Bounds3DSchema,
}, { additionalProperties: false });

export const TinSurfacePropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.tin-surface-properties.v1"),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  crs: SurveyCrsSchema,
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const TinSurfaceObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.tin-surface-object.v1"),
  id: id("object"),
  type: Type.Literal("civil.tin_surface"),
  layer_id: id("layer"),
  geometry: IndexedTinGeometrySchema,
  properties: TinSurfacePropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.tin-surface-object.v1",
  additionalProperties: false,
});

export const CivilAxisPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-axis-properties.v1"),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  crs: SurveyCrsSchema,
  start_station_m: Type.Number({ minimum: -1_000_000, maximum: 1_000_000 }),
  length_m: Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000 }),
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const CivilAxisObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-axis-object.v1"),
  id: id("object"),
  type: Type.Literal("civil.axis"),
  layer_id: id("layer"),
  geometry: Polyline3DGeometrySchema,
  properties: CivilAxisPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.civil-axis-object.v1",
  additionalProperties: false,
});

export const CivilProfileSampleSchema = Type.Object({
  station_m: Type.Number({ minimum: -1_000_000, maximum: 11_000_000 }),
  elevation_m: Type.Number({ minimum: -100_000, maximum: 100_000 }),
}, { additionalProperties: false });

export const CivilProfilePropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-profile-properties.v1"),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  axis_id: id("object"),
  crs: SurveyCrsSchema,
  samples: Type.Array(CivilProfileSampleSchema, { minItems: 2, maxItems: 20_000 }),
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const CivilProfileObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-profile-object.v1"),
  id: id("object"),
  type: Type.Literal("civil.profile"),
  layer_id: id("layer"),
  geometry: Polyline3DGeometrySchema,
  properties: CivilProfilePropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.civil-profile-object.v1",
  additionalProperties: false,
});

export const CivilSectionPointSchema = Type.Object({
  offset_m: Type.Number({ minimum: -1_000, maximum: 1_000 }),
  elevation_offset_m: Type.Number({ minimum: -1_000, maximum: 1_000 }),
}, { additionalProperties: false });

export const IndexedMeshGeometrySchema = Type.Object({
  kind: Type.Literal("indexed_mesh"),
  coordinate_space: Type.Literal("survey_crs"),
  vertices: Type.Array(Point3DSchema, { minItems: 4, maxItems: 100_000 }),
  faces: Type.Array(Type.Tuple([
    Type.Integer({ minimum: 0, maximum: 99_999 }),
    Type.Integer({ minimum: 0, maximum: 99_999 }),
    Type.Integer({ minimum: 0, maximum: 99_999 }),
  ]), { minItems: 2, maxItems: 200_000 }),
  bounds: Bounds3DSchema,
}, { additionalProperties: false });

export const GeometryStreamManifestSchema = Type.Object({
  schema_version: Type.Literal("datamine.geometry-stream-manifest.v1"),
  stream_id: id("stream"),
  project_id: id("project"),
  source_version_id: id("version"),
  source_revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  source_content_sha256: sha256,
  object_id: id("object"),
  geometry_kind: Type.Literal("indexed_mesh"),
  coordinate_space: Type.Literal("survey_crs"),
  vertex_count: Type.Integer({ minimum: 4, maximum: 100_000 }),
  face_count: Type.Integer({ minimum: 2, maximum: 200_000 }),
  chunk_count: Type.Integer({ minimum: 1, maximum: 4_096 }),
  total_payload_bytes: Type.Integer({ minimum: 1, maximum: 67_108_864 }),
  geometry_sha256: sha256,
}, {
  $id: "datamine.geometry-stream-manifest.v1",
  additionalProperties: false,
});

export const GeometryChunkSchema = Type.Object({
  schema_version: Type.Literal("datamine.geometry-chunk.v1"),
  stream_id: id("stream"),
  project_id: id("project"),
  source_version_id: id("version"),
  source_revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  source_content_sha256: sha256,
  object_id: id("object"),
  manifest_sha256: sha256,
  sequence: Type.Integer({ minimum: 0, maximum: 4_095 }),
  chunk_count: Type.Integer({ minimum: 1, maximum: 4_096 }),
  vertex_start: Type.Integer({ minimum: 0, maximum: 99_999 }),
  face_start: Type.Integer({ minimum: 0, maximum: 199_999 }),
  vertices: Type.Array(Point3DSchema, { maxItems: 4_096 }),
  faces: Type.Array(Type.Tuple([
    Type.Integer({ minimum: 0, maximum: 99_999 }),
    Type.Integer({ minimum: 0, maximum: 99_999 }),
    Type.Integer({ minimum: 0, maximum: 99_999 }),
  ]), { maxItems: 8_192 }),
  payload_bytes: Type.Integer({ minimum: 2, maximum: 1_048_576 }),
  payload_sha256: sha256,
}, {
  $id: "datamine.geometry-chunk.v1",
  additionalProperties: false,
});

export const CivilSweepPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-sweep-properties.v1"),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  axis_id: id("object"),
  profile_id: id("object"),
  crs: SurveyCrsSchema,
  section: Type.Array(CivilSectionPointSchema, { minItems: 2, maxItems: 64 }),
  sampling_spacing_m: Type.Number({ exclusiveMinimum: 0, maximum: 1_000 }),
  caps: Type.Boolean(),
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const CivilSweepObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-sweep-object.v1"),
  id: id("object"),
  type: Type.Literal("civil.sweep"),
  layer_id: id("layer"),
  geometry: IndexedMeshGeometrySchema,
  properties: CivilSweepPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.civil-sweep-object.v1",
  additionalProperties: false,
});

export const CivilMaterialLayerPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-material-layer-properties.v1"),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  material_code: Type.String({ minLength: 1, maxLength: 50, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" }),
  crs: SurveyCrsSchema,
  derivation: Type.Object({
    kind: Type.Literal("constant_thickness"),
    top_surface_id: id("object"),
    thickness_m: Type.Number({ exclusiveMinimum: 0, maximum: 1_000 }),
    top_offset_m: Type.Optional(Type.Number({ minimum: 0, maximum: 1_000 })),
    assembly: Type.Optional(Type.Object({ id: id("assembly"), order: Type.Integer({ minimum: 0, maximum: 19 }) }, { additionalProperties: false })),
  }, { additionalProperties: false }),
  volume_m3: Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000_000_000 }),
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const CivilMaterialLayerObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-material-layer-object.v1"),
  id: id("object"),
  type: Type.Literal("civil.material_layer"),
  layer_id: id("layer"),
  geometry: IndexedMeshGeometrySchema,
  properties: CivilMaterialLayerPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.civil-material-layer-object.v1",
  additionalProperties: false,
});

export const CivilToolsSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-tools.v1"),
  axis_id: id("object"),
  profile_id: id("object"),
  section: Type.Array(CivilSectionPointSchema, { minItems: 2, maxItems: 64 }),
  sampling_spacing_m: Type.Number({ exclusiveMinimum: 0, maximum: 1_000 }),
  caps: Type.Boolean(),
}, {
  $id: "datamine.civil-tools.v1",
  additionalProperties: false,
});

export const Point3DGeometrySchema = Type.Object({
  kind: Type.Literal("point3d"),
  coordinate_space: Type.Literal("survey_crs"),
  point: Point3DSchema,
}, { additionalProperties: false });

export const CivilPointDerivationSchema = Type.Union([
  Type.Object({ kind: Type.Literal("manual_coordinates") }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("segment_interpolation"),
    start_point_id: id("object"),
    end_point_id: id("object"),
    ratio: Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1 }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("axis_station_offset"),
    axis_id: id("object"),
    station_m: Type.Number({ minimum: -1_000_000, maximum: 11_000_000 }),
    lateral_offset_m: Type.Number({ minimum: -10_000, maximum: 10_000 }),
    elevation_offset_m: Type.Number({ minimum: -1_000, maximum: 1_000 }),
  }, { additionalProperties: false }),
]);

export const CivilPointPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-point-properties.v1"),
  name: Type.String({ minLength: 1, maxLength: 200, pattern: "^[^<>\\x00-\\x1F]+$" }),
  crs: SurveyCrsSchema,
  derivation: CivilPointDerivationSchema,
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const CivilPointObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-point-object.v1"),
  id: id("object"),
  type: Type.Literal("civil.point"),
  layer_id: id("layer"),
  geometry: Point3DGeometrySchema,
  properties: CivilPointPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.civil-point-object.v1",
  additionalProperties: false,
});

export const StakeoutDerivationSchema = Type.Union([
  Type.Object({ kind: Type.Literal("manual") }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("document_import"),
    page: Type.Integer({ minimum: 1, maximum: 100_000 }),
    row: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    source_code: Type.String({ minLength: 1, maxLength: 200, pattern: "^[^<>\\x00-\\x1F]+$" }),
    source_layer: Type.Optional(Type.String({ minLength: 1, maxLength: 200, pattern: "^[^<>\\x00-\\x1F]+$" })),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("axis_station_offset"),
    source_object_id: id("object"),
    station_m: Type.Number({ minimum: -1_000_000, maximum: 11_000_000 }),
    lateral_offset_m: Type.Number({ minimum: -10_000, maximum: 10_000 }),
    elevation_offset_m: Type.Number({ minimum: -1_000, maximum: 1_000 }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("profile_station_offset"),
    source_object_id: id("object"),
    station_m: Type.Number({ minimum: -1_000_000, maximum: 11_000_000 }),
    lateral_offset_m: Type.Number({ minimum: -10_000, maximum: 10_000 }),
    elevation_offset_m: Type.Number({ minimum: -1_000, maximum: 1_000 }),
  }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("sweep_vertex"),
    source_object_id: id("object"),
    vertex_index: Type.Integer({ minimum: 0, maximum: 99_999 }),
  }, { additionalProperties: false }),
]);

export const StakeoutAccuracySchema = Type.Object({
  horizontal_m: Type.Number({ exclusiveMinimum: 0, maximum: 100 }),
  vertical_m: Type.Number({ exclusiveMinimum: 0, maximum: 100 }),
  method: Type.Union([
    Type.Literal("manual"),
    Type.Literal("derived"),
    Type.Literal("surveyed"),
  ]),
}, { additionalProperties: false });

export const StakeoutPointPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.stakeout-point-properties.v1"),
  name: Type.String({ minLength: 1, maxLength: 200, pattern: "^[^<>\\x00-\\x1F]+$" }),
  code: Type.String({ minLength: 1, maxLength: 50, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" }),
  crs: SurveyCrsSchema,
  derivation: StakeoutDerivationSchema,
  coordinate_tolerance_m: Type.Number({ exclusiveMinimum: 0, maximum: 0.1 }),
  accuracy: StakeoutAccuracySchema,
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const StakeoutPointObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.stakeout-point.v1"),
  id: id("object"),
  type: Type.Literal("stakeout.point"),
  layer_id: id("layer"),
  geometry: Point3DGeometrySchema,
  properties: StakeoutPointPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.stakeout-point.v1",
  additionalProperties: false,
});

export const StakeoutGroupPropertiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.stakeout-group-properties.v1"),
  name: Type.String({ minLength: 1, maxLength: 200, pattern: "^[^<>\\x00-\\x1F]+$" }),
  crs: SurveyCrsSchema,
  ordering: Type.Literal("explicit"),
  point_ids: Type.Array(id("object"), { minItems: 1, maxItems: 10_000 }),
  review_state: ReviewStateSchema,
}, { additionalProperties: false });

export const StakeoutGroupObjectSchema = Type.Object({
  schema_version: Type.Literal("datamine.stakeout-group.v1"),
  id: id("object"),
  type: Type.Literal("stakeout.group"),
  layer_id: id("layer"),
  properties: StakeoutGroupPropertiesSchema,
  provenance: ObjectProvenanceSchema,
}, {
  $id: "datamine.stakeout-group.v1",
  additionalProperties: false,
});

export const LandXmlTinSchema = Type.Object({
  schema_version: Type.Literal("datamine.landxml-tin.v1"),
  landxml_namespace: Type.Literal("http://www.landxml.org/schema/LandXML-1.2"),
  source_document_id: id("document"),
  source_document_sha256: sha256,
  surface: TinSurfaceObjectSchema,
}, {
  $id: "datamine.landxml-tin.v1",
  additionalProperties: false,
});

export const CadUnderlayViewSchema = Type.Object({
  schema_version: Type.Literal("datamine.cad-underlay-view.v1"),
  source_format: Type.Literal("cad_pdf"),
  source_document_id: id("document"),
  source_document_sha256: sha256,
  etag_sha256: sha256,
  page_index: Type.Integer({ minimum: 0, maximum: 9_999 }),
  page_width_pt: Type.Number({ exclusiveMinimum: 0, maximum: 200_000 }),
  page_height_pt: Type.Number({ exclusiveMinimum: 0, maximum: 200_000 }),
  source_crs: SurveyCrsSchema,
  pdf_to_survey_xy: AffineMatrix2DSchema,
  survey_to_world_xy: AffineMatrix2DSchema,
  survey_plane_elevation_m: Type.Number({ minimum: -100_000, maximum: 100_000 }),
  world_elevation_offset_m: Type.Number({ minimum: -100_000, maximum: 100_000 }),
  tolerance_m: Type.Number({ exclusiveMinimum: 0, maximum: 1 }),
  control_points: Type.Array(Type.Object({
    document_pt: Point2DSchema,
    survey_crs: Point3DSchema,
    world_m: Point3DSchema,
  }, { additionalProperties: false }), { minItems: 3, maxItems: 32 }),
}, {
  $id: "datamine.cad-underlay-view.v1",
  additionalProperties: false,
});

export const ModelObjectSchema = Type.Union([
  RoomObjectSchema,
  WallObjectSchema,
  OpeningObjectSchema,
  FloorObjectSchema,
  TinSurfaceObjectSchema,
  CivilAxisObjectSchema,
  CivilProfileObjectSchema,
  CivilSweepObjectSchema,
  CivilMaterialLayerObjectSchema,
  CivilPointObjectSchema,
  StakeoutPointObjectSchema,
  StakeoutGroupObjectSchema,
], {
  $id: "datamine.model-object.v1",
});

export const ModelVersionSchema = Type.Object({
  schema_version: Type.Literal("datamine.model-version.v1"),
  id: id("version"),
  project_id: id("project"),
  document_id: id("document"),
  parent_id: Type.Union([id("version"), Type.Null()]),
  revision: Type.Integer({ minimum: 0 }),
  status: Type.Union([
    Type.Literal("proposal"),
    Type.Literal("working"),
    Type.Literal("validated"),
  ]),
  document_view: Type.Optional(DocumentViewSchema),
  cad_underlay_view: Type.Optional(CadUnderlayViewSchema),
  objects: Type.Array(ModelObjectSchema, { maxItems: 100_000 }),
  created_at: timestamp,
}, {
  $id: "datamine.model-version.v1",
  additionalProperties: false,
});

const CommandIdSchema = id("command");

export const RoomObjectUpsertCommandSchema = Type.Object({
  id: CommandIdSchema,
  type: Type.Literal("rooms.object.upsert"),
  object: RoomObjectSchema,
}, { additionalProperties: false });

export const RoomObjectRemoveCommandSchema = Type.Object({
  id: CommandIdSchema,
  type: Type.Literal("rooms.object.remove"),
  object_id: id("object"),
}, { additionalProperties: false });

export const RoomPropertiesPatchCommandSchema = Type.Object({
  id: CommandIdSchema,
  type: Type.Literal("rooms.properties.patch"),
  object_id: id("object"),
  changes: Type.Partial(Type.Pick(RoomPropertiesSchema, [
    "name",
    "floor_area_m2",
    "height_m",
    "floor_level_m",
    "included",
    "quality",
    "area_source",
    "shape_source",
    "review_state",
  ]), { additionalProperties: false }),
}, { additionalProperties: false });

export const ModelVersionCommandSchema = Type.Union([
  RoomObjectUpsertCommandSchema,
  RoomObjectRemoveCommandSchema,
  RoomPropertiesPatchCommandSchema,
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("building.object.upsert"),
    object: BuildingObjectSchema,
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("building.object.remove"),
    object_id: id("object"),
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("building.review.set"),
    object_id: id("object"),
    review_state: Type.Union([
      Type.Literal("confirmed"),
      Type.Literal("corrected"),
      Type.Literal("rejected"),
    ]),
    reason_code: Type.String({
      minLength: 1,
      maxLength: 100,
      pattern: "^[A-Z][A-Z0-9_]*$",
    }),
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("building.opening.assign-host"),
    object_id: id("object"),
    host_wall_id: id("object"),
    reason_code: Type.String({
      minLength: 1,
      maxLength: 100,
      pattern: "^[A-Z][A-Z0-9_]*$",
    }),
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("civil.object.upsert"),
    object: Type.Union([CivilPointObjectSchema, TinSurfaceObjectSchema, CivilAxisObjectSchema, CivilProfileObjectSchema, CivilMaterialLayerObjectSchema]),
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("civil.sweep.commit"),
    object: CivilSweepObjectSchema,
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("civil.object.remove"),
    object_id: id("object"),
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("civil.review.set"),
    object_id: id("object"),
    review_state: Type.Union([
      Type.Literal("confirmed"),
      Type.Literal("corrected"),
      Type.Literal("rejected"),
    ]),
    reason_code: Type.String({
      minLength: 1,
      maxLength: 100,
      pattern: "^[A-Z][A-Z0-9_]*$",
    }),
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("stakeout.point.upsert"),
    object: StakeoutPointObjectSchema,
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("stakeout.group.upsert"),
    object: StakeoutGroupObjectSchema,
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("stakeout.object.remove"),
    object_id: id("object"),
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("stakeout.group.members.set"),
    object_id: id("object"),
    point_ids: Type.Array(id("object"), { minItems: 1, maxItems: 10_000 }),
  }, { additionalProperties: false }),
  Type.Object({
    id: CommandIdSchema,
    type: Type.Literal("stakeout.review.set"),
    object_id: id("object"),
    review_state: Type.Union([
      Type.Literal("confirmed"),
      Type.Literal("corrected"),
      Type.Literal("rejected"),
    ]),
    reason_code: Type.String({
      minLength: 1,
      maxLength: 100,
      pattern: "^[A-Z][A-Z0-9_]*$",
    }),
  }, { additionalProperties: false }),
]);

export const ModelVersionCommandBatchSchema = Type.Object({
  schema_version: Type.Literal("datamine.model-version-command-batch.v1"),
  project_id: id("project"),
  base_version_id: id("version"),
  base_revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  base_content_sha256: sha256,
  commands: Type.Array(ModelVersionCommandSchema, { maxItems: 1_000 }),
}, {
  $id: "datamine.model-version-command-batch.v1",
  additionalProperties: false,
});

export const RoomsExportSchema = Type.Object({
  schema_version: Type.Literal("datamine.rooms-export.v1"),
  exporter_version: Type.String({ minLength: 1, maxLength: 100 }),
  project_id: id("project"),
  document_id: id("document"),
  model_version_id: id("version"),
  model_revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  model_content_sha256: sha256,
  coordinate_space: Type.Literal("drawing_m"),
  units: Type.Object({
    length: Type.Literal("m"),
    area: Type.Literal("m2"),
    volume: Type.Literal("m3"),
    elevation: Type.Literal("m"),
  }, { additionalProperties: false }),
  rooms: Type.Array(RoomObjectSchema, { maxItems: 100_000 }),
  summary: Type.Object({
    rooms_total: Type.Integer({ minimum: 0, maximum: 100_000 }),
    rooms_included: Type.Integer({ minimum: 0, maximum: 100_000 }),
    floor_area_m2: Type.Number({ minimum: 0, maximum: 10_000_000_000 }),
    geometric_area_m2: Type.Number({ minimum: 0, maximum: 10_000_000_000 }),
    volume_m3: Type.Number({ minimum: 0, maximum: 10_000_000_000_000 }),
  }, { additionalProperties: false }),
}, {
  $id: "datamine.rooms-export.v1",
  additionalProperties: false,
});

export const BuildingQuantityRowSchema = Type.Object({
  object_id: id("object"),
  object_type: Type.Union([
    Type.Literal("building.wall"),
    Type.Literal("building.opening"),
    Type.Literal("building.floor"),
  ]),
  length_m: Type.Union([
    Type.Number({ exclusiveMinimum: 0, maximum: 10_000_000 }),
    Type.Null(),
  ]),
  gross_area_m2: Type.Number({ minimum: 0, maximum: 10_000_000_000 }),
  net_area_m2: Type.Number({ minimum: 0, maximum: 10_000_000_000 }),
  volume_m3: Type.Number({ minimum: 0, maximum: 10_000_000_000 }),
  source_algorithm_version: Type.String({ minLength: 1, maxLength: 100 }),
}, { additionalProperties: false });

export const BuildingQuantitiesSchema = Type.Object({
  schema_version: Type.Literal("datamine.building-quantities.v1"),
  calculator_version: Type.Literal("building-quantities-v1"),
  project_id: id("project"),
  document_id: id("document"),
  model_version_id: id("version"),
  model_revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  model_content_sha256: sha256,
  coordinate_space: Type.Literal("drawing_m"),
  tolerance: Type.Object({
    linear_m: Type.Literal(0.000001),
    area_m2: Type.Literal(0.000001),
    volume_m3: Type.Literal(0.000001),
  }, { additionalProperties: false }),
  units: Type.Object({
    length: Type.Literal("m"),
    area: Type.Literal("m2"),
    volume: Type.Literal("m3"),
  }, { additionalProperties: false }),
  rows: Type.Array(BuildingQuantityRowSchema, { maxItems: 100_000 }),
  summary: Type.Object({
    objects_total: Type.Integer({ minimum: 0, maximum: 100_000 }),
    walls_total: Type.Integer({ minimum: 0, maximum: 100_000 }),
    openings_total: Type.Integer({ minimum: 0, maximum: 100_000 }),
    floors_total: Type.Integer({ minimum: 0, maximum: 100_000 }),
    length_m: Type.Number({ minimum: 0, maximum: 10_000_000_000 }),
    gross_area_m2: Type.Number({ minimum: 0, maximum: 10_000_000_000 }),
    net_area_m2: Type.Number({ minimum: 0, maximum: 10_000_000_000 }),
    volume_m3: Type.Number({ minimum: 0, maximum: 10_000_000_000 }),
  }, { additionalProperties: false }),
}, {
  $id: "datamine.building-quantities.v1",
  additionalProperties: false,
});

export const BuildingExportSchema = Type.Object({
  schema_version: Type.Literal("datamine.building-export.v1"),
  exporter_version: Type.Literal("building-export-v1"),
  project_id: id("project"),
  document_id: id("document"),
  source_document_sha256: sha256,
  model_version_id: id("version"),
  model_revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  model_content_sha256: sha256,
  coordinate_space: Type.Literal("drawing_m"),
  tolerance: BuildingQuantitiesSchema.properties.tolerance,
  units: BuildingQuantitiesSchema.properties.units,
  objects: Type.Array(BuildingObjectSchema, { minItems: 1, maxItems: 100_000 }),
  quantities: Type.Object({
    rows: BuildingQuantitiesSchema.properties.rows,
    summary: BuildingQuantitiesSchema.properties.summary,
  }, { additionalProperties: false }),
}, {
  $id: "datamine.building-export.v1",
  additionalProperties: false,
});

const CivilExportObjectSchema = Type.Union([
  CivilPointObjectSchema,
  CivilMaterialLayerObjectSchema,
  StakeoutPointObjectSchema,
  TinSurfaceObjectSchema,
  CivilAxisObjectSchema,
  CivilProfileObjectSchema,
  CivilSweepObjectSchema,
]);

export const CivilExportSchema = Type.Object({
  schema_version: Type.Literal("datamine.civil-export.v1"),
  exporter_version: Type.Literal("civil-export-v1"),
  project_id: id("project"),
  document_id: id("document"),
  source_document_sha256: sha256,
  model_version_id: id("version"),
  model_revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  model_content_sha256: sha256,
  coordinate_space: Type.Literal("survey_crs"),
  crs: SurveyCrsSchema,
  units: Type.Object({
    horizontal: Type.Literal("m"),
    vertical: Type.Literal("m"),
  }, { additionalProperties: false }),
  precision: Type.Object({
    coordinate_decimals: Type.Literal(3),
    tolerance_m: Type.Literal(0.001),
  }, { additionalProperties: false }),
  objects: Type.Array(CivilExportObjectSchema, { minItems: 1, maxItems: 100_000 }),
  summary: Type.Object({
    points: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
    material_layers: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
    objects_total: Type.Integer({ minimum: 1, maximum: 100_000 }),
    tin_surfaces: Type.Integer({ minimum: 0, maximum: 100_000 }),
    axes: Type.Integer({ minimum: 0, maximum: 100_000 }),
    profiles: Type.Integer({ minimum: 0, maximum: 100_000 }),
    sweeps: Type.Integer({ minimum: 0, maximum: 100_000 }),
  }, { additionalProperties: false }),
}, {
  $id: "datamine.civil-export.v1",
  additionalProperties: false,
});

export const StakeoutExportSchema = Type.Object({
  schema_version: Type.Literal("datamine.stakeout-export.v1"),
  exporter_version: Type.Literal("stakeout-export-v1"),
  project_id: id("project"),
  document_id: id("document"),
  source_document_sha256: sha256,
  model_version_id: id("version"),
  model_revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
  model_content_sha256: sha256,
  coordinate_space: Type.Literal("survey_crs"),
  crs: SurveyCrsSchema,
  units: Type.Object({
    horizontal: Type.Literal("m"),
    vertical: Type.Literal("m"),
    accuracy: Type.Literal("m"),
  }, { additionalProperties: false }),
  precision: Type.Object({
    coordinate_decimals: Type.Literal(3),
    tolerance_m: Type.Literal(0.001),
  }, { additionalProperties: false }),
  accuracy_gate: Type.Object({
    maximum_horizontal_m: Type.Literal(0.05),
    maximum_vertical_m: Type.Literal(0.05),
  }, { additionalProperties: false }),
  points: Type.Array(StakeoutPointObjectSchema, { minItems: 1, maxItems: 100_000 }),
  groups: Type.Array(StakeoutGroupObjectSchema, { maxItems: 10_000 }),
  summary: Type.Object({
    points_total: Type.Integer({ minimum: 1, maximum: 100_000 }),
    groups_total: Type.Integer({ minimum: 0, maximum: 10_000 }),
  }, { additionalProperties: false }),
}, {
  $id: "datamine.stakeout-export.v1",
  additionalProperties: false,
});

export const ModelVersionJobInputSchema = Type.Object({
  kind: Type.Literal("model_version"),
  id: id("version"),
  revision: Type.Integer({ minimum: 0, maximum: 2_147_483_647 }),
}, { additionalProperties: false });

export const DocumentJobInputSchema = Type.Object({
  kind: Type.Literal("document"),
  id: id("document"),
  sha256,
}, { additionalProperties: false });

export const JobInputSchema = Type.Union([
  ModelVersionJobInputSchema,
  DocumentJobInputSchema,
]);

export const JobSchema = Type.Object({
  schema_version: Type.Literal("datamine.job.v1"),
  id: id("job"),
  project_id: id("project"),
  input: JobInputSchema,
  job_type: Type.String({ minLength: 1, maxLength: 100, pattern: "^[a-z][a-z0-9._-]+$" }),
  algorithm_version: Type.String({ minLength: 1, maxLength: 100 }),
  parameters_hash: sha256,
  status: Type.Union([
    Type.Literal("queued"),
    Type.Literal("running"),
    Type.Literal("succeeded"),
    Type.Literal("failed"),
    Type.Literal("cancelled"),
  ]),
  error_code: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 80,
    pattern: "^[A-Z][A-Z0-9_]+$",
  })),
  created_at: timestamp,
}, {
  $id: "datamine.job.v1",
  additionalProperties: false,
});

export const JobCreateSchema = Type.Union([
  Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: ModelVersionJobInputSchema,
    job_type: Type.Literal("system.dummy"),
    algorithm_version: Type.Literal("dummy-v1"),
    parameters: Type.Object({
      label: Type.String({ minLength: 1, maxLength: 200 }),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: ModelVersionJobInputSchema,
    job_type: Type.Literal("civil.sweep.generate"),
    algorithm_version: Type.Literal("civil-sweep-v1"),
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 200 }),
      axis_id: id("object"),
      profile_id: id("object"),
      section: Type.Array(CivilSectionPointSchema, { minItems: 2, maxItems: 64 }),
      sampling_spacing_m: Type.Number({ exclusiveMinimum: 0, maximum: 1_000 }),
      caps: Type.Boolean(),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: ModelVersionJobInputSchema,
    job_type: Type.Literal("stakeout.derive.point"),
    algorithm_version: Type.Literal("stakeout-axis-profile-v1"),
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 200, pattern: "^[^<>\\x00-\\x1F]+$" }),
      code: Type.String({ minLength: 1, maxLength: 50, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" }),
      axis_id: id("object"),
      profile_id: id("object"),
      station_m: Type.Number({ minimum: -1_000_000, maximum: 11_000_000 }),
      lateral_offset_m: Type.Number({ minimum: -10_000, maximum: 10_000 }),
      elevation_offset_m: Type.Number({ minimum: -1_000, maximum: 1_000 }),
      horizontal_accuracy_m: Type.Number({ exclusiveMinimum: 0, maximum: 100 }),
      vertical_accuracy_m: Type.Number({ exclusiveMinimum: 0, maximum: 100 }),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: DocumentJobInputSchema,
    job_type: Type.Literal("stakeout.import.pdf"),
    algorithm_version: Type.Literal("stakeout-pdf-import-v1"),
    parameters: Type.Object({}, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: DocumentJobInputSchema,
    job_type: Type.Literal("rooms.detect"),
    algorithm_version: Type.Literal("rooms-v1-adapter"),
    parameters: Type.Object({
      default_height_m: Type.Number({ exclusiveMinimum: 0, maximum: 100 }),
      floor_level_m: Type.Number({ minimum: -1_000, maximum: 10_000 }),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: DocumentJobInputSchema,
    job_type: Type.Literal("civil.import.landxml"),
    algorithm_version: Type.Literal("landxml-tin-import-v1"),
    parameters: Type.Object({
      epsg: Type.Integer({ minimum: 1, maximum: 999_999 }),
      vertical_datum: Type.String({ minLength: 1, maxLength: 100 }),
      surface_name: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
    }, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: ModelVersionJobInputSchema,
    job_type: Type.Literal("rooms.export.json"),
    algorithm_version: Type.Literal("rooms-export-json-v1"),
    parameters: Type.Object({}, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: ModelVersionJobInputSchema,
    job_type: Type.Literal("rooms.export.xlsx"),
    algorithm_version: Type.Literal("rooms-export-xlsx-v1"),
    parameters: Type.Object({}, { additionalProperties: false }),
  }, { additionalProperties: false }),
  Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: ModelVersionJobInputSchema,
    job_type: Type.Literal("building.quantities.json"),
    algorithm_version: Type.Literal("building-quantities-v1"),
    parameters: Type.Object({}, { additionalProperties: false }),
  }, { additionalProperties: false }),
  ...(["json", "xlsx", "dxf"] as const).map((format) => Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: ModelVersionJobInputSchema,
    job_type: Type.Literal(`building.export.${format}`),
    algorithm_version: Type.Literal("building-export-v1"),
    parameters: Type.Object({}, { additionalProperties: false }),
  }, { additionalProperties: false })),
  ...(["json", "dxf", "csv"] as const).map((format) => Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: ModelVersionJobInputSchema,
    job_type: Type.Literal(`civil.export.${format}`),
    algorithm_version: Type.Literal("civil-export-v1"),
    parameters: Type.Object({}, { additionalProperties: false }),
  }, { additionalProperties: false })),
  ...(["json", "csv"] as const).map((format) => Type.Object({
    schema_version: Type.Literal("datamine.job-create.v1"),
    project_id: id("project"),
    input: ModelVersionJobInputSchema,
    job_type: Type.Literal(`stakeout.export.${format}`),
    algorithm_version: Type.Literal("stakeout-export-v1"),
    parameters: Type.Object({}, { additionalProperties: false }),
  }, { additionalProperties: false })),
], {
  $id: "datamine.job-create.v1",
});

export const ArtifactSchema = Type.Object({
  schema_version: Type.Literal("datamine.artifact.v1"),
  id: id("artifact"),
  project_id: id("project"),
  job_id: id("job"),
  model_version_id: id("version"),
  kind: Type.String({ minLength: 1, maxLength: 100, pattern: "^[a-z][a-z0-9._-]+$" }),
  media_type: Type.String({ minLength: 3, maxLength: 100 }),
  storage_key: storageKey,
  sha256,
  size_bytes: Type.Integer({ minimum: 0, maximum: 10_737_418_240 }),
  created_at: timestamp,
}, {
  $id: "datamine.artifact.v1",
  additionalProperties: false,
});

export const ErrorSchema = Type.Object({
  schema_version: Type.Literal("datamine.error.v1"),
  code: Type.String({ minLength: 1, maxLength: 80, pattern: "^[A-Z][A-Z0-9_]+$" }),
  message: Type.String({ minLength: 1, maxLength: 500 }),
  correlation_id: Type.String({ minLength: 1, maxLength: 100 }),
  retryable: Type.Boolean(),
}, {
  $id: "datamine.error.v1",
  additionalProperties: false,
});

const auditValue = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z0-9_.:-]+$",
});

export const AuditEventSchema = Type.Object({
  schema_version: Type.Literal("datamine.audit-event.v1"),
  event_id: auditValue,
  occurred_at: timestamp,
  request_id: auditValue,
  phase: Type.Union([Type.Literal("intent"), Type.Literal("outcome")]),
  action: auditValue,
  outcome: auditValue,
  reason_code: auditValue,
  actor_id: Type.Union([auditValue, Type.Null()]),
  tenant_id: Type.Union([auditValue, Type.Null()]),
  project_id: Type.Union([auditValue, Type.Null()]),
  resource_kind: Type.Union([auditValue, Type.Null()]),
  resource_id: Type.Union([auditValue, Type.Null()]),
  component: auditValue,
  redacted: Type.Literal(true),
}, {
  $id: "datamine.audit-event.v1",
  additionalProperties: false,
});

export type Project = Static<typeof ProjectSchema>;
export type Document = Static<typeof DocumentSchema>;
export type DocumentView = Static<typeof DocumentViewSchema>;
export type RoomObject = Static<typeof RoomObjectSchema>;
export type WallObject = Static<typeof WallObjectSchema>;
export type OpeningObject = Static<typeof OpeningObjectSchema>;
export type FloorObject = Static<typeof FloorObjectSchema>;
export type BuildingObject = Static<typeof BuildingObjectSchema>;
export type TinSurfaceObject = Static<typeof TinSurfaceObjectSchema>;
export type CivilAxisObject = Static<typeof CivilAxisObjectSchema>;
export type CivilProfileObject = Static<typeof CivilProfileObjectSchema>;
export type CivilSweepObject = Static<typeof CivilSweepObjectSchema>;
export type CivilMaterialLayerObject = Static<typeof CivilMaterialLayerObjectSchema>;
export type CivilPointObject = Static<typeof CivilPointObjectSchema>;
export type CivilSectionPoint = Static<typeof CivilSectionPointSchema>;
export type CivilTools = Static<typeof CivilToolsSchema>;
export type GeometryStreamManifest = Static<typeof GeometryStreamManifestSchema>;
export type GeometryChunk = Static<typeof GeometryChunkSchema>;
export type StakeoutPointObject = Static<typeof StakeoutPointObjectSchema>;
export type StakeoutGroupObject = Static<typeof StakeoutGroupObjectSchema>;
export type LandXmlTin = Static<typeof LandXmlTinSchema>;
export type CadUnderlayView = Static<typeof CadUnderlayViewSchema>;
export type ModelObject = Static<typeof ModelObjectSchema>;
export type ModelVersion = Static<typeof ModelVersionSchema>;
export type ModelVersionCommand = Static<typeof ModelVersionCommandSchema>;
export type ModelVersionCommandBatch = Static<typeof ModelVersionCommandBatchSchema>;
export type RoomsExport = Static<typeof RoomsExportSchema>;
export type BuildingQuantities = Static<typeof BuildingQuantitiesSchema>;
export type BuildingExport = Static<typeof BuildingExportSchema>;
export type CivilExport = Static<typeof CivilExportSchema>;
export type StakeoutExport = Static<typeof StakeoutExportSchema>;
export type Job = Static<typeof JobSchema>;
export type JobCreate = Static<typeof JobCreateSchema>;
export type Artifact = Static<typeof ArtifactSchema>;
export type DatamineError = Static<typeof ErrorSchema>;
export type AuditEvent = Static<typeof AuditEventSchema>;

export const contractSchemas = {
  project: ProjectSchema,
  document: DocumentSchema,
  document_view: DocumentViewSchema,
  model_object: ModelObjectSchema,
  model_version: ModelVersionSchema,
  model_version_command_batch: ModelVersionCommandBatchSchema,
  rooms_export: RoomsExportSchema,
  building_quantities: BuildingQuantitiesSchema,
  building_export: BuildingExportSchema,
  civil_export: CivilExportSchema,
  stakeout_export: StakeoutExportSchema,
  landxml_tin: LandXmlTinSchema,
  cad_underlay_view: CadUnderlayViewSchema,
  civil_tools: CivilToolsSchema,
  geometry_stream_manifest: GeometryStreamManifestSchema,
  geometry_chunk: GeometryChunkSchema,
  stakeout_point: StakeoutPointObjectSchema,
  stakeout_group: StakeoutGroupObjectSchema,
  job: JobSchema,
  job_create: JobCreateSchema,
  artifact: ArtifactSchema,
  error: ErrorSchema,
  audit_event: AuditEventSchema,
} as const satisfies Record<string, TSchema>;

export type ContractName = keyof typeof contractSchemas;

export function isContract<Name extends ContractName>(
  name: Name,
  value: unknown,
): boolean {
  if (!Value.Check(contractSchemas[name], value)) {
    return false;
  }
  if (name === "model_object") {
    return hasValidModelObjectSemantics(value as ModelObject);
  }
  if (name === "stakeout_point" || name === "stakeout_group") {
    return hasValidModelObjectSemantics(value as StakeoutPointObject | StakeoutGroupObject);
  }
  if (name === "model_version") {
    const model = value as ModelVersion;
    return (!model.document_view || hasValidDocumentViewSemantics(model.document_view))
      && (!model.cad_underlay_view || hasValidCadUnderlaySemantics(model.cad_underlay_view))
      && hasValidModelVersionSemantics(model);
  }
  if (name === "document_view") {
    return hasValidDocumentViewSemantics(value as DocumentView);
  }
  if (name === "civil_tools") {
    return hasValidCivilSectionSemantics((value as CivilTools).section);
  }
  if (name === "geometry_chunk") {
    const chunk = value as GeometryChunk;
    return chunk.sequence < chunk.chunk_count
      && chunk.vertices.length + chunk.faces.length > 0;
  }
  if (name === "job_create") {
    const job = value as JobCreate;
    return job.job_type !== "civil.sweep.generate"
      || hasValidCivilSectionSemantics(job.parameters.section);
  }
  if (name === "document") {
    const document = value as Document;
    return document.role === "landxml"
      ? document.media_type === "application/xml" && document.technical_name.endsWith(".xml")
      : document.media_type === "application/pdf" && document.technical_name.endsWith(".pdf");
  }
  if (name === "model_version_command_batch") {
    return (value as ModelVersionCommandBatch).commands.every((command) => (
      !("object" in command) || hasValidModelObjectSemantics(command.object)
    ));
  }
  if (name === "rooms_export") {
    return hasValidRoomsExportSemantics(value as RoomsExport);
  }
  if (name === "building_quantities") {
    return hasValidBuildingQuantitiesSemantics(value as BuildingQuantities);
  }
  if (name === "building_export") {
    return hasValidBuildingExportSemantics(value as BuildingExport);
  }
  if (name === "civil_export") {
    return hasValidCivilExportSemantics(value as CivilExport);
  }
  if (name === "stakeout_export") {
    return hasValidStakeoutExportSemantics(value as StakeoutExport);
  }
  if (name === "landxml_tin") {
    const landxml = value as LandXmlTin;
    return hasValidTinSurfaceSemantics(landxml.surface)
      && landxml.surface.provenance.source_document_id === landxml.source_document_id
      && landxml.surface.provenance.source_document_sha256 === landxml.source_document_sha256;
  }
  if (name === "cad_underlay_view") {
    return hasValidCadUnderlaySemantics(value as CadUnderlayView);
  }
  return true;
}

function hasValidCivilExportSemantics(value: CivilExport): boolean {
  if (!hasValidModelVersionSemantics({ objects: value.objects })) return false;
  if (value.objects.some((object) => object.type === "stakeout.point"
    && (object.properties.accuracy.horizontal_m > 0.05 || object.properties.accuracy.vertical_m > 0.05))) return false;
  const ids = value.objects.map((object) => object.id);
  if (new Set(ids).size !== ids.length || ids.some((idValue, index) => (
    index > 0 && ids[index - 1]! > idValue
  ))) return false;
  if (value.objects.some((object) => (
    object.properties.review_state !== "confirmed"
    || object.geometry.coordinate_space !== "survey_crs"
    || !sameSurveyCrs(object.properties.crs, value.crs)
    || object.provenance.source_document_id !== value.document_id
    || object.provenance.source_document_sha256 !== value.source_document_sha256
  ))) return false;
  const pointCount = value.objects.filter((object) => object.type === "civil.point" || object.type === "stakeout.point").length;
  const materialCount = value.objects.filter((object) => object.type === "civil.material_layer").length;
  if ((value.summary.points ?? 0) !== pointCount || (value.summary.material_layers ?? 0) !== materialCount) return false;
  const expected = {
    objects_total: value.objects.length,
    tin_surfaces: value.objects.filter((object) => object.type === "civil.tin_surface").length,
    axes: value.objects.filter((object) => object.type === "civil.axis").length,
    profiles: value.objects.filter((object) => object.type === "civil.profile").length,
    sweeps: value.objects.filter((object) => object.type === "civil.sweep").length,
  };
  return Object.entries(expected).every(([key, count]) => (
    value.summary[key as keyof typeof expected] === count
  ));
}

function hasValidStakeoutExportSemantics(value: StakeoutExport): boolean {
  if (!value.points.every(hasValidModelObjectSemantics)
    || !value.groups.every(hasValidModelObjectSemantics)) return false;
  const pointIds = value.points.map((point) => point.id);
  const pointSet = new Set(pointIds);
  if (pointSet.size !== pointIds.length || pointIds.some((idValue, index) => (
    index > 0 && value.points[index - 1]!.properties.code > value.points[index]!.properties.code
      || index > 0
        && value.points[index - 1]!.properties.code === value.points[index]!.properties.code
        && pointIds[index - 1]! > idValue
  ))) return false;
  const groupIds = value.groups.map((group) => group.id);
  if (new Set(groupIds).size !== groupIds.length || groupIds.some((idValue, index) => (
    index > 0 && groupIds[index - 1]! > idValue
  ))) return false;
  const allObjects = [...value.points, ...value.groups];
  if (allObjects.some((object) => (
    object.properties.review_state !== "confirmed"
    || !sameSurveyCrs(object.properties.crs, value.crs)
    || object.provenance.source_document_id !== value.document_id
    || object.provenance.source_document_sha256 !== value.source_document_sha256
  ))) return false;
  if (value.points.some((point) => (
    point.geometry.coordinate_space !== "survey_crs"
    || point.properties.accuracy.horizontal_m > value.accuracy_gate.maximum_horizontal_m
    || point.properties.accuracy.vertical_m > value.accuracy_gate.maximum_vertical_m
  ))) return false;
  if (value.groups.some((group) => group.properties.point_ids.some((pointId) => !pointSet.has(pointId)))) {
    return false;
  }
  return value.summary.points_total === value.points.length
    && value.summary.groups_total === value.groups.length;
}

function hasValidBuildingExportSemantics(value: BuildingExport): boolean {
  if (!value.objects.every(hasValidModelObjectSemantics)) return false;
  const objectIds = value.objects.map((object) => object.id);
  if (objectIds.some((idValue, index) => index > 0 && objectIds[index - 1]! > idValue)) {
    return false;
  }
  if (new Set(objectIds).size !== objectIds.length) return false;
  if (value.objects.some((object) => (
    object.properties.review_state === "rejected"
    || object.provenance.source_document_id !== value.document_id
    || object.provenance.source_document_sha256 !== value.source_document_sha256
    || object.geometry.coordinate_space !== value.coordinate_space
  ))) return false;
  const quantities: BuildingQuantities = {
    schema_version: "datamine.building-quantities.v1",
    calculator_version: "building-quantities-v1",
    project_id: value.project_id,
    document_id: value.document_id,
    model_version_id: value.model_version_id,
    model_revision: value.model_revision,
    model_content_sha256: value.model_content_sha256,
    coordinate_space: value.coordinate_space,
    tolerance: value.tolerance,
    units: value.units,
    rows: value.quantities.rows,
    summary: value.quantities.summary,
  };
  return hasValidBuildingQuantitiesSemantics(quantities)
    && objectIds.length === quantities.rows.length
    && objectIds.every((idValue, index) => idValue === quantities.rows[index]!.object_id);
}

function hasValidBuildingQuantitiesSemantics(value: BuildingQuantities): boolean {
  const ids = new Set<string>();
  for (let index = 0; index < value.rows.length; index += 1) {
    const row = value.rows[index]!;
    if (ids.has(row.object_id)) return false;
    ids.add(row.object_id);
    if (index > 0 && value.rows[index - 1]!.object_id > row.object_id) return false;
    if (row.object_type !== "building.wall" && row.length_m !== null) return false;
    if (row.net_area_m2 > row.gross_area_m2 + value.tolerance.area_m2) return false;
  }
  const expected = {
    objects_total: value.rows.length,
    walls_total: value.rows.filter((row) => row.object_type === "building.wall").length,
    openings_total: value.rows.filter((row) => row.object_type === "building.opening").length,
    floors_total: value.rows.filter((row) => row.object_type === "building.floor").length,
    length_m: value.rows.reduce((sum, row) => sum + (row.length_m ?? 0), 0),
    gross_area_m2: value.rows.reduce((sum, row) => sum + row.gross_area_m2, 0),
    net_area_m2: value.rows.reduce((sum, row) => sum + row.net_area_m2, 0),
    volume_m3: value.rows.reduce((sum, row) => sum + row.volume_m3, 0),
  };
  return Object.entries(expected).every(([key, expectedValue]) => (
    Math.abs(value.summary[key as keyof typeof expected] - expectedValue) <= 1e-6
  ));
}

function hasValidRoomsExportSemantics(value: RoomsExport): boolean {
  if (!value.rooms.every(hasValidModelObjectSemantics)) return false;
  const ids = new Set<string>();
  for (let index = 0; index < value.rooms.length; index += 1) {
    const room = value.rooms[index]!;
    if (ids.has(room.id)) return false;
    ids.add(room.id);
    const previous = value.rooms[index - 1];
    if (previous && (
      previous.properties.number > room.properties.number
      || previous.properties.number === room.properties.number && previous.id > room.id
    )) return false;
  }
  const included = value.rooms.filter((room) => room.properties.included);
  const expected = {
    rooms_total: value.rooms.length,
    rooms_included: included.length,
    floor_area_m2: included.reduce((sum, room) => sum + room.properties.floor_area_m2, 0),
    geometric_area_m2: included.reduce((sum, room) => sum + room.properties.geometric_area_m2, 0),
    volume_m3: included.reduce(
      (sum, room) => sum + room.properties.geometric_area_m2 * room.properties.height_m,
      0,
    ),
  };
  return value.summary.rooms_total === expected.rooms_total
    && value.summary.rooms_included === expected.rooms_included
    && Math.abs(value.summary.floor_area_m2 - expected.floor_area_m2) <= 1e-6
    && Math.abs(value.summary.geometric_area_m2 - expected.geometric_area_m2) <= 1e-6
    && Math.abs(value.summary.volume_m3 - expected.volume_m3) <= 1e-6;
}

function hasValidDocumentViewSemantics(view: DocumentView): boolean {
  const [a, b, c, d] = view.pdf_to_drawing_m;
  const determinant = a * d - b * c;
  return Number.isFinite(determinant) && Math.abs(determinant) > 1e-15;
}

export function isModelObject(value: unknown): value is ModelObject {
  return Value.Check(ModelObjectSchema, value)
    && hasValidModelObjectSemantics(value as ModelObject);
}

function ringHasArea(ring: readonly (readonly [number, number])[]): boolean {
  const distinct = new Set(ring.map(([x, y]) => `${x}:${y}`));
  if (distinct.size < 3) {
    return false;
  }
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    if (!current || !next) {
      return false;
    }
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Number.isFinite(twiceArea) && Math.abs(twiceArea) > 1e-9;
}

function ringArea(ring: readonly (readonly [number, number])[]): number {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    if (!current || !next) return Number.NaN;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) / 2;
}

function polylineLength(points: readonly (readonly [number, number])[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) return Number.NaN;
    length += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
  }
  return length;
}

function nearlyEqual(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right)
    && Math.abs(left - right) <= Math.max(1e-6, Math.abs(right) * 1e-9);
}

function pointOnSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): boolean {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-18) return false;
  const cross = (point[0] - start[0]) * dy - (point[1] - start[1]) * dx;
  if (Math.abs(cross) > 1e-6 * Math.sqrt(lengthSquared)) return false;
  const dot = (point[0] - start[0]) * dx + (point[1] - start[1]) * dy;
  return dot >= -1e-6 && dot <= lengthSquared + 1e-6;
}

function pointOnPolyline(
  point: readonly [number, number],
  points: readonly (readonly [number, number])[],
): boolean {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start && end && pointOnSegment(point, start, end)) return true;
  }
  return false;
}

function hasValidModelVersionSemantics(model: Pick<ModelVersion, "objects" | "cad_underlay_view">): boolean {
  if (!model.objects.every(hasValidModelObjectSemantics)) return false;
  const byId = new Map<string, ModelObject>();
  for (const object of model.objects) {
    if (byId.has(object.id)) return false;
    byId.set(object.id, object);
  }
  type SurveyModelObject = TinSurfaceObject | CivilPointObject | CivilAxisObject
    | CivilProfileObject | CivilSweepObject | CivilMaterialLayerObject | StakeoutPointObject | StakeoutGroupObject;
  const objectsWithSurveyCrs = model.objects.filter((object): object is SurveyModelObject => (
    object.type === "civil.tin_surface" || object.type === "civil.point"
    || object.type === "civil.axis" || object.type === "civil.profile"
    || object.type === "civil.sweep" || object.type === "civil.material_layer" || object.type === "stakeout.point"
    || object.type === "stakeout.group"
  ));
  const referenceCrs = model.cad_underlay_view?.source_crs
    ?? objectsWithSurveyCrs[0]?.properties.crs;
  if (referenceCrs && objectsWithSurveyCrs.some((object) => !sameSurveyCrs(object.properties.crs, referenceCrs))) {
    return false;
  }
  for (const object of model.objects) {
    if (object.type !== "building.opening") continue;
    const host = byId.get(object.properties.host_wall_id);
    if (!host || host.type !== "building.wall") return false;
    if (host.geometry.coordinate_space !== object.geometry.coordinate_space) return false;
    if (object.properties.sill_height_m + object.properties.height_m > host.properties.height_m + 1e-6) {
      return false;
    }
    if (!object.geometry.points.every((point) => pointOnPolyline(point, host.geometry.points))) {
      return false;
    }
  }
  for (const object of model.objects) {
    if (object.type === "civil.profile") {
      const axis = byId.get(object.properties.axis_id);
      if (!axis || axis.type !== "civil.axis" || !sameSurveyCrs(axis.properties.crs, object.properties.crs)) {
        return false;
      }
      const start = axis.properties.start_station_m;
      const end = start + axis.properties.length_m;
      if (object.properties.samples.some((sample) => sample.station_m < start - 1e-6 || sample.station_m > end + 1e-6)) {
        return false;
      }
      if (object.properties.samples.some((sample, index) => {
        const expected = axisPointAtStation(axis, sample.station_m);
        const point = object.geometry.points[index]!;
        return !nearlyEqual(point[0], expected[0]) || !nearlyEqual(point[1], expected[1]);
      })) return false;
    }
    if (object.type === "civil.point") {
      const derivation = object.properties.derivation;
      if (derivation.kind === "segment_interpolation") {
        const start = byId.get(derivation.start_point_id);
        const end = byId.get(derivation.end_point_id);
        if (!start || start.type !== "civil.point" || !end || end.type !== "civil.point" || start.id === end.id) return false;
        if (!sameSurveyCrs(start.properties.crs, object.properties.crs) || !sameSurveyCrs(end.properties.crs, object.properties.crs)) return false;
        const expected = start.geometry.point.map((coordinate, index) => (
          coordinate + (end.geometry.point[index]! - coordinate) * derivation.ratio
        ));
        if (Math.hypot(...object.geometry.point.map((coordinate, index) => coordinate - expected[index]!)) > 1e-6) return false;
      }
      if (derivation.kind === "axis_station_offset") {
        const axis = byId.get(derivation.axis_id);
        if (!axis || axis.type !== "civil.axis" || !sameSurveyCrs(axis.properties.crs, object.properties.crs)) return false;
        const frame = axisFrameAtStation(axis, derivation.station_m);
        const expected = [
          frame[0] - frame[4] * derivation.lateral_offset_m,
          frame[1] + frame[3] * derivation.lateral_offset_m,
          frame[2] + derivation.elevation_offset_m,
        ];
        if (Math.hypot(...object.geometry.point.map((coordinate, index) => coordinate - expected[index]!)) > 1e-6) return false;
      }
    }
    if (object.type === "civil.sweep") {
      const axis = byId.get(object.properties.axis_id);
      const profile = byId.get(object.properties.profile_id);
      if (!axis || axis.type !== "civil.axis" || !profile || profile.type !== "civil.profile") return false;
      if (profile.properties.axis_id !== axis.id) return false;
      if (!sameSurveyCrs(axis.properties.crs, object.properties.crs)
        || !sameSurveyCrs(profile.properties.crs, object.properties.crs)) return false;
    }
    if (object.type === "civil.material_layer") {
      const top = byId.get(object.properties.derivation.top_surface_id);
      const thickness = object.properties.derivation.thickness_m;
      const offset = object.properties.derivation.top_offset_m ?? 0;
      if (!top || top.type !== "civil.tin_surface" || !sameSurveyCrs(top.properties.crs, object.properties.crs)) return false;
      if (object.geometry.vertices.length !== top.geometry.vertices.length * 2) return false;
      if (top.geometry.vertices.some((vertex, index) => {
        const upper = object.geometry.vertices[index]!;
        const lower = object.geometry.vertices[index + top.geometry.vertices.length]!;
        return !vertex.every((value, axis) => nearlyEqual(upper[axis]!, value - (axis === 2 ? offset : 0)))
          || !nearlyEqual(lower[0], vertex[0]) || !nearlyEqual(lower[1], vertex[1])
          || !nearlyEqual(lower[2], vertex[2] - offset - thickness);
      })) return false;
      const projectedArea = top.geometry.faces.reduce((sum, face) => {
        const first = top.geometry.vertices[face[0]]!;
        const second = top.geometry.vertices[face[1]]!;
        const third = top.geometry.vertices[face[2]]!;
        return sum + orientation2D(first, second, third) / 2;
      }, 0);
      if (!nearlyEqual(object.properties.volume_m3, projectedArea * thickness)) return false;
    }
    if (object.type === "stakeout.point") {
      if (!hasValidStakeoutPointBinding(object, byId)) return false;
    }
    if (object.type === "stakeout.group") {
      if (object.properties.point_ids.some((pointId) => {
        const point = byId.get(pointId);
        return !point || point.type !== "stakeout.point" || !sameSurveyCrs(point.properties.crs, object.properties.crs);
      })) return false;
    }
  }
  const assemblies = new Map<string, CivilMaterialLayerObject[]>();
  for (const object of model.objects) {
    if (object.type !== "civil.material_layer" || !object.properties.derivation.assembly) continue;
    const group = assemblies.get(object.properties.derivation.assembly.id) ?? [];
    group.push(object); assemblies.set(object.properties.derivation.assembly.id, group);
  }
  for (const group of assemblies.values()) {
    group.sort((a, b) => a.properties.derivation.assembly!.order - b.properties.derivation.assembly!.order);
    let offset = 0;
    for (const [index, layer] of group.entries()) {
      const d = layer.properties.derivation;
      if (d.assembly!.order !== index || d.top_surface_id !== group[0]!.properties.derivation.top_surface_id
        || !nearlyEqual(d.top_offset_m ?? 0, offset)) return false;
      offset += d.thickness_m;
    }
    if (offset > 1_000) return false;
  }
  const pointCodes = model.objects
    .filter((object): object is StakeoutPointObject => object.type === "stakeout.point")
    .map((object) => object.properties.code);
  if (new Set(pointCodes).size !== pointCodes.length) return false;
  return true;
}

function axisPointAtStation(axis: CivilAxisObject, station: number): readonly [number, number] {
  let currentStation = axis.properties.start_station_m;
  for (let index = 1; index < axis.geometry.points.length; index += 1) {
    const first = axis.geometry.points[index - 1]!;
    const second = axis.geometry.points[index]!;
    const segmentLength = Math.hypot(second[0] - first[0], second[1] - first[1]);
    const nextStation = currentStation + segmentLength;
    if (station <= nextStation + 1e-9) {
      const ratio = Math.min(1, Math.max(0, (station - currentStation) / segmentLength));
      return [first[0] + (second[0] - first[0]) * ratio, first[1] + (second[1] - first[1]) * ratio];
    }
    currentStation = nextStation;
  }
  const finalPoint = axis.geometry.points.at(-1)!;
  return [finalPoint[0], finalPoint[1]];
}

export function hasValidModelObjectSemantics(object: ModelObject): boolean {
  if (object.type === "rooms.room") {
    return object.geometry.rings.every(ringHasArea);
  }
  if (object.type === "building.wall") {
    const length = polylineLength(object.geometry.points);
    return length > 1e-9
      && nearlyEqual(object.properties.length_m, length)
      && nearlyEqual(object.properties.gross_side_area_m2, length * object.properties.height_m)
      && nearlyEqual(
        object.properties.volume_m3,
        length * object.properties.height_m * object.properties.thickness_m,
      );
  }
  if (object.type === "building.opening") {
    const length = polylineLength(object.geometry.points);
    return object.geometry.points.length === 2
      && length > 1e-9
      && nearlyEqual(object.properties.width_m, length)
      && nearlyEqual(object.properties.area_m2, length * object.properties.height_m);
  }
  if (object.type === "civil.tin_surface") {
    return hasValidTinSurfaceSemantics(object);
  }
  if (object.type === "civil.axis") {
    const horizontalLength = polyline3DHorizontalLength(object.geometry.points);
    return horizontalLength > 1e-9 && nearlyEqual(object.properties.length_m, horizontalLength);
  }
  if (object.type === "civil.profile") {
    const { samples } = object.properties;
    return samples.length === object.geometry.points.length
      && samples.every((sample, index) => (
        index === 0 || sample.station_m > samples[index - 1]!.station_m
      ))
      && samples.every((sample, index) => nearlyEqual(sample.elevation_m, object.geometry.points[index]![2]));
  }
  if (object.type === "civil.sweep") {
    return hasValidCivilSectionSemantics(object.properties.section)
      && hasValidIndexedMeshSemantics(object.geometry);
  }
  if (object.type === "civil.material_layer") {
    return hasValidIndexedMeshSemantics(object.geometry)
      && hasClosedMeshSemantics(object.geometry)
      && nearlyEqual(object.properties.volume_m3, closedMeshVolume(object.geometry));
  }
  if (object.type === "civil.point") {
    return object.properties.derivation.kind === "manual_coordinates"
      ? object.provenance.source_kind === "manual"
      : object.provenance.source_kind !== "imported";
  }
  if (object.type === "stakeout.point") {
    if (object.properties.derivation.kind === "document_import"
      && object.provenance.source_kind === "imported") {
      return object.properties.accuracy.method === "derived";
    }
    const derived = object.properties.derivation.kind !== "manual";
    return derived
      ? object.properties.accuracy.method === "derived"
        && object.provenance.source_kind === "automatic"
        && object.provenance.source_job_id !== undefined
      : object.properties.accuracy.method !== "derived"
        && object.provenance.source_kind !== "automatic";
  }
  if (object.type === "stakeout.group") {
    return new Set(object.properties.point_ids).size === object.properties.point_ids.length;
  }
  const [outer, ...holes] = object.geometry.rings;
  if (!outer || !object.geometry.rings.every(ringHasArea)) return false;
  const area = ringArea(outer) - holes.reduce((sum, ring) => sum + ringArea(ring), 0);
  if (area <= 1e-9) return false;
  return nearlyEqual(object.properties.area_m2, area)
    && nearlyEqual(object.properties.volume_m3, area * object.properties.thickness_m);
}

function hasValidStakeoutPointBinding(
  point: StakeoutPointObject,
  byId: ReadonlyMap<string, ModelObject>,
): boolean {
  const derivation = point.properties.derivation;
  if (derivation.kind === "manual" || derivation.kind === "document_import") return true;
  const source = byId.get(derivation.source_object_id);
  if (!source || !(
    source.type === "civil.axis"
    || source.type === "civil.profile"
    || source.type === "civil.sweep"
  )) return false;
  if (!sameSurveyCrs(source.properties.crs, point.properties.crs)) return false;
  if (source.properties.review_state !== "confirmed" && source.properties.review_state !== "corrected") return false;
  let expected: readonly [number, number, number];
  if (derivation.kind === "sweep_vertex") {
    if (source.type !== "civil.sweep" || derivation.vertex_index >= source.geometry.vertices.length) return false;
    expected = source.geometry.vertices[derivation.vertex_index]!;
  } else {
    let axis: CivilAxisObject;
    let elevation: number;
    if (derivation.kind === "axis_station_offset") {
      if (source.type !== "civil.axis") return false;
      axis = source;
      const start = axis.properties.start_station_m;
      if (derivation.station_m < start - 1e-6 || derivation.station_m > start + axis.properties.length_m + 1e-6) return false;
      elevation = axisFrameAtStation(axis, derivation.station_m)[2] + derivation.elevation_offset_m;
    } else {
      if (source.type !== "civil.profile") return false;
      const axisObject = byId.get(source.properties.axis_id);
      if (!axisObject || axisObject.type !== "civil.axis") return false;
      axis = axisObject;
      const samples = source.properties.samples;
      if (derivation.station_m < samples[0]!.station_m - 1e-6 || derivation.station_m > samples.at(-1)!.station_m + 1e-6) return false;
      elevation = interpolateProfileSamples(samples, derivation.station_m) + derivation.elevation_offset_m;
    }
    const frame = axisFrameAtStation(axis, derivation.station_m);
    expected = [
      frame[0] - frame[4] * derivation.lateral_offset_m,
      frame[1] + frame[3] * derivation.lateral_offset_m,
      elevation,
    ];
  }
  return Math.hypot(
    point.geometry.point[0] - expected[0],
    point.geometry.point[1] - expected[1],
    point.geometry.point[2] - expected[2],
  ) <= point.properties.coordinate_tolerance_m;
}

function axisFrameAtStation(axis: CivilAxisObject, station: number): readonly [number, number, number, number, number] {
  let currentStation = axis.properties.start_station_m;
  for (let index = 1; index < axis.geometry.points.length; index += 1) {
    const first = axis.geometry.points[index - 1]!;
    const second = axis.geometry.points[index]!;
    const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
    const nextStation = currentStation + length;
    if (station <= nextStation + 1e-9) {
      const ratio = Math.min(1, Math.max(0, (station - currentStation) / length));
      return [
        first[0] + (second[0] - first[0]) * ratio,
        first[1] + (second[1] - first[1]) * ratio,
        first[2] + (second[2] - first[2]) * ratio,
        (second[0] - first[0]) / length,
        (second[1] - first[1]) / length,
      ];
    }
    currentStation = nextStation;
  }
  throw new RangeError("Stakeout station leží mimo osu.");
}

function interpolateProfileSamples(
  samples: CivilProfileObject["properties"]["samples"],
  station: number,
): number {
  for (let index = 1; index < samples.length; index += 1) {
    const first = samples[index - 1]!;
    const second = samples[index]!;
    if (station <= second.station_m + 1e-9) {
      const ratio = Math.min(1, Math.max(0, (station - first.station_m) / (second.station_m - first.station_m)));
      return first.elevation_m + (second.elevation_m - first.elevation_m) * ratio;
    }
  }
  throw new RangeError("Stakeout station leží mimo profil.");
}

function polyline3DHorizontalLength(points: readonly (readonly [number, number, number])[]): number {
  return points.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(point[0] - points[index]![0], point[1] - points[index]![1])
  ), 0);
}

function hasValidCivilSectionSemantics(section: readonly { readonly offset_m: number }[]): boolean {
  return section.every((point, index) => index === 0 || point.offset_m > section[index - 1]!.offset_m);
}

function hasValidIndexedMeshSemantics(geometry: CivilSweepObject["geometry"]): boolean {
  const { vertices, faces, bounds } = geometry;
  for (const face of faces) {
    if (new Set(face).size !== 3 || face.some((index) => index >= vertices.length)) return false;
    const a = vertices[face[0]]!;
    const b = vertices[face[1]]!;
    const c = vertices[face[2]]!;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [
      ab[1]! * ac[2]! - ab[2]! * ac[1]!,
      ab[2]! * ac[0]! - ab[0]! * ac[2]!,
      ab[0]! * ac[1]! - ab[1]! * ac[0]!,
    ];
    if (Math.hypot(...cross) <= 1e-12) return false;
  }
  const expectedMin = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis]!)));
  const expectedMax = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis]!)));
  return [0, 1, 2].every((axis) => (
    nearlyEqual(bounds.min[axis]!, expectedMin[axis]!)
    && nearlyEqual(bounds.max[axis]!, expectedMax[axis]!)
  ));
}

function hasClosedMeshSemantics(geometry: CivilSweepObject["geometry"]): boolean {
  const edges = new Map<string, { count: number; direction: number }>();
  for (const face of geometry.faces) {
    for (const [first, second] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]]) {
      const key = first! < second! ? `${first}:${second}` : `${second}:${first}`;
      const current = edges.get(key) ?? { count: 0, direction: 0 };
      edges.set(key, {
        count: current.count + 1,
        direction: current.direction + (first! < second! ? 1 : -1),
      });
    }
  }
  return edges.size > 0 && [...edges.values()].every(({ count, direction }) => count === 2 && direction === 0);
}

function closedMeshVolume(geometry: CivilSweepObject["geometry"]): number {
  const signed = geometry.faces.reduce((sum, face) => {
    const first = geometry.vertices[face[0]]!;
    const second = geometry.vertices[face[1]]!;
    const third = geometry.vertices[face[2]]!;
    return sum + (
      first[0] * (second[1] * third[2] - second[2] * third[1])
      + first[1] * (second[2] * third[0] - second[0] * third[2])
      + first[2] * (second[0] * third[1] - second[1] * third[0])
    ) / 6;
  }, 0);
  return Math.abs(signed);
}

function orientation2D(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
  third: readonly [number, number, number],
): number {
  return (second[0] - first[0]) * (third[1] - first[1])
    - (second[1] - first[1]) * (third[0] - first[0]);
}

function sameSurveyCrs(left: Static<typeof SurveyCrsSchema>, right: Static<typeof SurveyCrsSchema>): boolean {
  return left.epsg === right.epsg
    && left.axis_order === right.axis_order
    && left.horizontal_unit === right.horizontal_unit
    && left.vertical_unit === right.vertical_unit
    && left.vertical_datum === right.vertical_datum;
}

function hasValidTinSurfaceSemantics(object: TinSurfaceObject): boolean {
  const { vertices, faces, bounds } = object.geometry;
  if (new Set(vertices.map((vertex) => vertex.join(":"))).size !== vertices.length) {
    return false;
  }
  for (const face of faces) {
    if (new Set(face).size !== 3 || face.some((index) => index >= vertices.length)) {
      return false;
    }
    const first = vertices[face[0]]!;
    const second = vertices[face[1]]!;
    const third = vertices[face[2]]!;
    const signedArea = (second[0] - first[0]) * (third[1] - first[1])
      - (second[1] - first[1]) * (third[0] - first[0]);
    if (!Number.isFinite(signedArea) || signedArea <= 1e-12) return false;
  }
  const expectedMin = [0, 1, 2].map((axis) => Math.min(...vertices.map((vertex) => vertex[axis]!)));
  const expectedMax = [0, 1, 2].map((axis) => Math.max(...vertices.map((vertex) => vertex[axis]!)));
  return [0, 1, 2].every((axis) => (
    nearlyEqual(bounds.min[axis]!, expectedMin[axis]!)
    && nearlyEqual(bounds.max[axis]!, expectedMax[axis]!)
  ));
}

function hasValidCadUnderlaySemantics(view: CadUnderlayView): boolean {
  if (view.etag_sha256 !== view.source_document_sha256) return false;
  let inversePdf: readonly number[];
  let inverseWorld: readonly number[];
  try {
    inversePdf = invertAffineValues(view.pdf_to_survey_xy);
    inverseWorld = invertAffineValues(view.survey_to_world_xy);
  } catch {
    return false;
  }
  if (!inversePdf.every(Number.isFinite) || !inverseWorld.every(Number.isFinite)) return false;
  return view.control_points.every((control) => {
    const survey = applyAffineValues(view.pdf_to_survey_xy, control.document_pt);
    const world = applyAffineValues(view.survey_to_world_xy, [control.survey_crs[0], control.survey_crs[1]]);
    return Math.hypot(survey[0] - control.survey_crs[0], survey[1] - control.survey_crs[1]) <= view.tolerance_m
      && Math.abs(control.survey_crs[2] - view.survey_plane_elevation_m) <= view.tolerance_m
      && Math.hypot(world[0] - control.world_m[0], world[1] - control.world_m[1]) <= view.tolerance_m
      && Math.abs(control.survey_crs[2] + view.world_elevation_offset_m - control.world_m[2]) <= view.tolerance_m
      && control.document_pt[0] >= 0 && control.document_pt[0] <= view.page_width_pt
      && control.document_pt[1] >= 0 && control.document_pt[1] <= view.page_height_pt;
  });
}

function applyAffineValues(matrix: readonly number[], point: readonly [number, number]): [number, number] {
  return [matrix[0]! * point[0] + matrix[2]! * point[1] + matrix[4]!, matrix[1]! * point[0] + matrix[3]! * point[1] + matrix[5]!];
}

function invertAffineValues(matrix: readonly number[]): readonly number[] {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a! * d! - b! * c!;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-15) throw new RangeError();
  return [d! / determinant, -b! / determinant, -c! / determinant, a! / determinant, (c! * f! - d! * e!) / determinant, (b! * e! - a! * f!) / determinant];
}
