import type { BuildingObject, CadUnderlayView, CivilAxisObject, CivilPointObject, CivilProfileObject, DocumentView, RoomObject, StakeoutGroupObject, StakeoutPointObject } from "@datamine/contracts";

export const demoDocumentView: DocumentView = {
  schema_version: "datamine.document-view.v1",
  source_document_id: "document_plan_1np",
  source_document_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  page_index: 0,
  page_width_pt: 800,
  page_height_pt: 600,
  page_rotation_deg: 0,
  drawing_scale: 75,
  source_coordinate_space: "pdf_display_pt",
  target_coordinate_space: "drawing_m",
  pdf_to_drawing_m: [0.026458333333333334, 0, 0, 0.026458333333333334, 0, 0],
};

export const demoCadUnderlayView: CadUnderlayView = {
  schema_version: "datamine.cad-underlay-view.v1",
  source_format: "cad_pdf",
  source_document_id: "document_cad_demo",
  source_document_sha256: "e".repeat(64),
  etag_sha256: "e".repeat(64),
  page_index: 0,
  page_width_pt: 100,
  page_height_pt: 100,
  source_crs: {
    kind: "epsg", epsg: 5514, axis_order: "east_north_up",
    horizontal_unit: "m", vertical_unit: "m", vertical_datum: "Bpv",
  },
  pdf_to_survey_xy: [0.1, 0, 0, 0.1, 1000, 2000],
  survey_to_world_xy: [1, 0, 0, 1, -1000, -2000],
  survey_plane_elevation_m: 250,
  world_elevation_offset_m: -250,
  tolerance_m: 0.000001,
  control_points: [
    { document_pt: [0, 0], survey_crs: [1000, 2000, 250], world_m: [0, 0, 0] },
    { document_pt: [100, 0], survey_crs: [1010, 2000, 250], world_m: [10, 0, 0] },
    { document_pt: [100, 100], survey_crs: [1010, 2010, 250], world_m: [10, 10, 0] },
  ],
};

const demoCivilProvenance = {
  source_document_id: demoCadUnderlayView.source_document_id,
  source_document_sha256: demoCadUnderlayView.source_document_sha256,
  source_kind: "manual" as const,
  algorithm_version: "civil-demo-v1",
};

const demoCivilCrs = demoCadUnderlayView.source_crs;

export const demoCivilObjects: readonly [CivilAxisObject, CivilProfileObject, CivilPointObject, CivilPointObject] = Object.freeze([
  {
    schema_version: "datamine.civil-axis-object.v1",
    id: "object_axis_demo",
    type: "civil.axis",
    layer_id: "layer_civil",
    geometry: { kind: "polyline3d", coordinate_space: "survey_crs", points: [[1000, 2000, 250], [1010, 2000, 251]] },
    properties: {
      schema_version: "datamine.civil-axis-properties.v1", name: "Demo osa", crs: demoCivilCrs,
      start_station_m: 0, length_m: 10, review_state: "confirmed",
    },
    provenance: demoCivilProvenance,
  },
  {
    schema_version: "datamine.civil-profile-object.v1",
    id: "object_profile_demo",
    type: "civil.profile",
    layer_id: "layer_civil",
    geometry: { kind: "polyline3d", coordinate_space: "survey_crs", points: [[1000, 2000, 250], [1010, 2000, 251]] },
    properties: {
      schema_version: "datamine.civil-profile-properties.v1", name: "Demo profil",
      axis_id: "object_axis_demo", crs: demoCivilCrs,
      samples: [{ station_m: 0, elevation_m: 250 }, { station_m: 10, elevation_m: 251 }],
      review_state: "confirmed",
    },
    provenance: demoCivilProvenance,
  },
  {
    schema_version: "datamine.civil-point-object.v1", id: "object_civil_point_a", type: "civil.point", layer_id: "layer_points",
    geometry: { kind: "point3d", coordinate_space: "survey_crs", point: [1002, 2002, 250.2] },
    properties: { schema_version: "datamine.civil-point-properties.v1", name: "Bod A", crs: demoCivilCrs, derivation: { kind: "manual_coordinates" }, review_state: "unreviewed" },
    provenance: { ...demoCivilProvenance, source_kind: "manual", algorithm_version: "civil-point-tools-v1" },
  },
  {
    schema_version: "datamine.civil-point-object.v1", id: "object_civil_point_b", type: "civil.point", layer_id: "layer_points",
    geometry: { kind: "point3d", coordinate_space: "survey_crs", point: [1008, 2002, 250.8] },
    properties: { schema_version: "datamine.civil-point-properties.v1", name: "Bod B", crs: demoCivilCrs, derivation: { kind: "manual_coordinates" }, review_state: "unreviewed" },
    provenance: { ...demoCivilProvenance, source_kind: "manual", algorithm_version: "civil-point-tools-v1" },
  },
]);

export const demoStakeoutObjects: readonly [StakeoutPointObject, StakeoutGroupObject] = Object.freeze([
  {
    schema_version: "datamine.stakeout-point.v1",
    id: "object_stakeout_demo_001",
    type: "stakeout.point",
    layer_id: "layer_stakeout",
    geometry: { kind: "point3d", coordinate_space: "survey_crs", point: [1005, 2002, 250.7] },
    properties: {
      schema_version: "datamine.stakeout-point-properties.v1",
      name: "Kontrolní bod P001", code: "P001", crs: demoCivilCrs,
      derivation: { kind: "manual" }, coordinate_tolerance_m: 0.001,
      accuracy: { horizontal_m: 0.02, vertical_m: 0.03, method: "surveyed" },
      review_state: "unreviewed",
    },
    provenance: {
      source_document_id: demoCadUnderlayView.source_document_id,
      source_document_sha256: demoCadUnderlayView.source_document_sha256,
      source_kind: "manual", algorithm_version: "stakeout-manual-v1",
    },
  },
  {
    schema_version: "datamine.stakeout-group.v1",
    id: "object_stakeout_group_demo",
    type: "stakeout.group",
    layer_id: "layer_stakeout",
    properties: {
      schema_version: "datamine.stakeout-group-properties.v1",
      name: "Demo vytyčení", crs: demoCivilCrs, ordering: "explicit",
      point_ids: ["object_stakeout_demo_001"], review_state: "unreviewed",
    },
    provenance: {
      source_document_id: demoCadUnderlayView.source_document_id,
      source_document_sha256: demoCadUnderlayView.source_document_sha256,
      source_kind: "manual", algorithm_version: "stakeout-group-v1",
    },
  },
]);

export const demoRoom: RoomObject = {
  schema_version: "datamine.room-object.v1",
  id: "object_room_101",
  type: "rooms.room",
  layer_id: "layer_rooms",
  geometry: {
    kind: "polygon",
    coordinate_space: "drawing_m",
    rings: [[[5, 4], [9.2, 4], [9.2, 7.1], [5, 7.1]]],
  },
  properties: {
    schema_version: "datamine.room-properties.v1",
    number: "1.01",
    name: "Místnost 1.01",
    floor_area_m2: 13.02,
    geometric_area_m2: 13.02,
    table_area_m2: 13.02,
    perimeter_m: 14.6,
    height_m: 3,
    floor_level_m: 0,
    included: true,
    quality: "ok",
    area_source: "ocr_table",
    shape_source: "measured",
    review_state: "unreviewed",
  },
  provenance: {
    source_document_id: "document_plan_1np",
    source_document_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    source_job_id: "job_rooms_1",
    source_kind: "automatic",
    algorithm_version: "rooms-v1-baseline",
    confidence: 0.92,
  },
};

const demoProvenance = {
  source_document_id: demoDocumentView.source_document_id,
  source_document_sha256: demoDocumentView.source_document_sha256,
  source_job_id: "job_building_demo",
  source_kind: "automatic" as const,
  algorithm_version: "building-candidates-v1",
  confidence: 0.86,
};

export const demoBuildingObjects: readonly BuildingObject[] = Object.freeze([
  {
    schema_version: "datamine.wall-object.v1",
    id: "object_wall_demo",
    type: "building.wall",
    layer_id: "layer_building",
    geometry: {
      kind: "polyline",
      coordinate_space: "drawing_m",
      points: [[4.5, 3.5], [9.7, 3.5], [9.7, 7.6]],
    },
    properties: {
      schema_version: "datamine.wall-properties.v1",
      name: "Kandidát obvodové stěny",
      thickness_m: 0.3,
      height_m: 3,
      base_level_m: 0,
      length_m: 9.3,
      gross_side_area_m2: 27.9,
      volume_m3: 8.37,
      structural: true,
      review_state: "unreviewed",
    },
    provenance: demoProvenance,
  },
  {
    schema_version: "datamine.opening-object.v1",
    id: "object_opening_demo",
    type: "building.opening",
    layer_id: "layer_building",
    geometry: {
      kind: "polyline",
      coordinate_space: "drawing_m",
      points: [[6.2, 3.5], [7.2, 3.5]],
    },
    properties: {
      schema_version: "datamine.opening-properties.v1",
      host_wall_id: "object_wall_demo",
      opening_type: "door",
      width_m: 1,
      height_m: 2.1,
      sill_height_m: 0,
      area_m2: 2.1,
      review_state: "unreviewed",
    },
    provenance: demoProvenance,
  },
  {
    schema_version: "datamine.floor-object.v1",
    id: "object_floor_demo",
    type: "building.floor",
    layer_id: "layer_building",
    geometry: {
      kind: "polygon",
      coordinate_space: "drawing_m",
      rings: [[[5, 4], [9.2, 4], [9.2, 7.1], [5, 7.1]]],
    },
    properties: {
      schema_version: "datamine.floor-properties.v1",
      name: "Kandidát podlahy 1.01",
      thickness_m: 0.2,
      top_level_m: 0,
      area_m2: 13.02,
      volume_m3: 2.604,
      review_state: "unreviewed",
    },
    provenance: demoProvenance,
  },
]);
