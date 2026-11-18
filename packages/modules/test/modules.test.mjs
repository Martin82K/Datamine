import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isContract } from "@datamine/contracts";
import { ModuleRegistry } from "@datamine/editor-core";
import {
  buildingModuleManifest,
  buildingQuantities,
  createFloorFromBoundary,
  createRoomBoundaryCapability,
  describeBuildingObjects,
  roomsModuleManifest,
  civilModuleManifest,
  buildCivilSweep,
  createCivilPointOnAxis,
  createCivilTinSurfaceFromBoundary,
  createCivilTinSurfaceFromPoints,
  createCivilSlopeSurface,
  civilTinSurfaceAreas,
  civilSlopeElevationDifference,
  suggestCivilTinMaximumEdgeLength,
  createCivilMaterialLayerFromSurface,
  createManualCivilPoint,
  densifyCivilSegment,
  interpolateSurveyPointCoordinates,
  selectCivilPointsAlongAxis,
  selectCivilPointsAlongLine,
  selectCivilPointsAlongSegment,
  selectCivilPointsInSeries,
  civilAxisPositionAt,
  civilAxisStations,
  civilProfileElevationAt,
  describeCivilObjects,
  describeStakeoutObjects,
  stakeoutModuleManifest,
} from "../dist/index.js";

const fixture = async (name) => JSON.parse(await readFile(
  new URL(`../../../fixtures/contracts/v1/${name}`, import.meta.url),
  "utf8",
));

test("building vyžaduje veřejnou rooms capability a rooms funguje samostatně", () => {
  const withoutRooms = new ModuleRegistry();
  assert.throws(() => withoutRooms.register(buildingModuleManifest), /chybí capability/);

  const registry = new ModuleRegistry();
  registry.register(roomsModuleManifest);
  assert.equal(registry.providerOf("rooms.boundary.v1"), "rooms");
  registry.register(buildingModuleManifest);
  assert.equal(registry.ownerOf("building.wall"), "building");

  const roomsOnly = new ModuleRegistry();
  roomsOnly.register(roomsModuleManifest);
  assert.equal(roomsOnly.manifests.length, 1);
});

test("civil modul registruje TIN bez závislosti na rooms nebo building", () => {
  const registry = new ModuleRegistry();
  registry.register(civilModuleManifest);
  assert.equal(registry.ownerOf("civil.tin_surface"), "civil");
  assert.equal(registry.ownerOf("civil.point"), "civil");
  assert.equal(registry.ownerOf("civil.axis"), "civil");
  assert.equal(registry.ownerOf("civil.profile"), "civil");
  assert.equal(registry.ownerOf("civil.sweep"), "civil");
  assert.equal(civilModuleManifest.commandTypes.includes("civil.sweep.commit"), true);
  assert.equal(registry.manifests.length, 1);
});

test("civil point tools vytvářejí ruční bod, bod na ose a bezpečně zhušťují úsek", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const axis = model.objects[0];
  const base = {
    layerId: "layer_points", sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64), algorithmVersion: "civil-point-tools-v1",
  };
  const start = createManualCivilPoint([0, 0, 100], axis.properties.crs, { ...base, objectId: "object_point_start", name: "Start" });
  const end = createManualCivilPoint([10, 0, 102], axis.properties.crs, { ...base, objectId: "object_point_end", name: "Konec" });
  assert.equal(isContract("model_object", start), true);

  const points = densifyCivilSegment(start, end, { internalPointCount: 3 }, (index) => ({
    ...base, objectId: `object_point_dense_${index}`, name: `Bod ${index + 1}`,
  }));
  assert.deepEqual(points.map((point) => point.geometry.point), [[2.5, 0, 100.5], [5, 0, 101], [7.5, 0, 101.5]]);
  assert.equal(points.every((point) => isContract("model_object", point)), true);

  const onAxis = createCivilPointOnAxis(axis, 1005, 2, 0.3, { ...base, objectId: "object_point_axis", name: "Bod na ose" });
  assert.deepEqual(onAxis.geometry.point, [5, 2, 100.8]);
  assert.equal(isContract("model_object", onAxis), true);
  assert.throws(() => densifyCivilSegment(start, end, { spacingM: 0 }, () => ({ ...base, objectId: "object_invalid", name: "Neplatný" })), /kladná/);
  assert.throws(() => densifyCivilSegment(start, end, { internalPointCount: 10_001 }, () => ({ ...base, objectId: "object_invalid", name: "Neplatný" })), /10 000/);
});

test("výběr bodů v přímce dodrží úsek, toleranci, pořadí a filtry", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const crs = model.objects[0].properties.crs;
  const base = {
    layerId: "layer_points", sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64), algorithmVersion: "civil-point-tools-v1",
  };
  const point = (id, coordinates, layerId = "layer_points") => createManualCivilPoint(coordinates, crs, {
    ...base, layerId, objectId: id, name: id,
  });
  const start = point("start", [0, 0, 100]);
  const end = point("end", [10, 0, 102]);
  const matches = selectCivilPointsAlongSegment(start, end, [
    point("after", [11, 0, 101]), point("right", [7, -0.5, 101]), end,
    point("outside", [4, 0.51, 101]), point("left", [3, 0.25, 101]), start,
    point("other-layer", [5, 0, 101], "layer_hidden"),
  ], { toleranceM: 0.5, layerIds: ["layer_points"], elevationRangeM: [100, 102] });
  assert.deepEqual(matches.map(({ pointId, order }) => [pointId, order]), [
    ["start", 1], ["left", 2], ["right", 3], ["end", 4],
  ]);
  assert.equal(matches[1].stationM, 3);
  assert.equal(matches[1].lateralOffsetM, 0.25);
  assert.equal(matches[2].lateralOffsetM, -0.5);
  assert.throws(() => selectCivilPointsAlongSegment(start, start, [], { toleranceM: 1 }), /dva různé/);
  assert.throws(() => selectCivilPointsAlongSegment(start, end, [start, end], { toleranceM: -1 }), /Tolerance/);
  assert.throws(() => selectCivilPointsAlongSegment(start, end, [start, end], { toleranceM: 1, maxResults: 1 }), /limit 1/);
});

test("výběr celé řady pokračuje před i za referenční body a zůstává ve vrstvě", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const crs = model.objects[0].properties.crs;
  const base = {
    layerId: "layer_row", sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64), algorithmVersion: "civil-point-tools-v1",
  };
  const point = (id, coordinates, layerId = "layer_row") => createManualCivilPoint(coordinates, crs, {
    ...base, layerId, objectId: id, name: id,
  });
  const start = point("start", [0, 0, 100]);
  const end = point("end", [10, 0, 100]);
  const matches = selectCivilPointsAlongLine(start, end, [
    point("after", [15, 0.1, 100]),
    point("before", [-5, -0.1, 100]),
    point("outside", [20, 0.51, 100]),
    point("same-position-other-layer", [5, 0, 100], "layer_other"),
    end,
    start,
  ], { toleranceM: 0.5, layerIds: ["layer_row"] });

  assert.deepEqual(matches.map(({ pointId, stationM, order }) => [pointId, stationM, order]), [
    ["before", -5, 1],
    ["start", 0, 2],
    ["end", 10, 3],
    ["after", 15, 4],
  ]);
  assert.equal(matches[0].lateralOffsetM, -0.1);
  assert.equal(matches[3].lateralOffsetM, 0.1);
  assert.throws(() => selectCivilPointsAlongLine(start, start, [], { toleranceM: 1 }), /dva různé/);
});

test("výběr celé podélné osy sleduje pojmenovanou řadu i přes zakřivení", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const crs = model.objects[0].properties.crs;
  const base = {
    layerId: "layer_subgrade", sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64), algorithmVersion: "civil-point-tools-v1",
  };
  const point = (id, name, coordinates, layerId = "layer_subgrade") => createManualCivilPoint(coordinates, crs, {
    ...base, layerId, objectId: id, name,
  });
  const reference = point("left-330", "km 107,33000 levý okraj zemní pláň", [0, 0, 100]);
  const matches = selectCivilPointsInSeries(reference, [
    point("left-350", "km 107,35000 levý okraj zemní pláň", [20, 4, 100]),
    point("axis-340", "km 107,34000 osa zemní pláň", [10, 2, 100]),
    point("left-other-layer", "km 107,34000 levý okraj ACO", [10, 1, 100], "layer_aco"),
    reference,
    point("left-320", "km 107,32000 levý okraj zemní pláň", [-10, 3, 100]),
    point("right-340", "km 107,34000 pravý okraj zemní pláň", [10, -4, 100]),
    point("left-340", "km 107,34000 levý okraj zemní pláň", [10, 1, 100]),
  ]);

  assert.deepEqual(matches.map(({ pointId, stationM }) => [pointId, stationM]), [
    ["left-320", 107_320],
    ["left-330", 107_330],
    ["left-340", 107_340],
    ["left-350", 107_350],
  ]);
});

test("výběr podél lomené osy používá skutečné staničení, ne tětivu", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const sourceAxis = model.objects[0];
  const axis = structuredClone(sourceAxis);
  axis.geometry.points = [[0, 0, 100], [10, 0, 100], [10, 10, 101]];
  axis.properties.start_station_m = 1000;
  axis.properties.length_m = 20;
  const base = {
    layerId: "layer_points", sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64), algorithmVersion: "civil-point-tools-v1",
  };
  const point = (id, coordinates) => createManualCivilPoint(coordinates, axis.properties.crs, {
    ...base, objectId: id, name: id,
  });
  const matches = selectCivilPointsAlongAxis(axis, [
    point("near-second", [9.6, 7, 100]),
    point("on-first", [4, 0, 100]),
    point("near-chord-only", [5, 5, 100]),
    point("on-corner", [10, 0, 100]),
  ], [1000, 1020], { toleranceM: 0.5 });
  assert.deepEqual(matches.map(({ pointId, stationM }) => [pointId, stationM]), [
    ["on-first", 1004], ["on-corner", 1010], ["near-second", 1017],
  ]);
  assert.ok(Math.abs(matches[2].lateralOffsetM - 0.4) < 1e-9);
  assert.throws(() => selectCivilPointsAlongAxis(axis, [], [999, 1020], { toleranceM: 1 }), /extrapolace/);

  const foreign = point("foreign", [5, 0, 100]);
  foreign.properties.crs.epsg = 4326;
  assert.throws(() => selectCivilPointsAlongAxis(axis, [foreign], [1000, 1020], { toleranceM: 1 }), /shodné CRS/);
});

test("civil povrch trianguluje konkávní hranici a zachová přesné Z", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const crs = model.objects[0].properties.crs;
  const base = {
    layerId: "layer_surface", sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64), algorithmVersion: "civil-boundary-ear-clipping-v1",
  };
  const point = (id, coordinates) => createManualCivilPoint(coordinates, crs, {
    ...base, layerId: "layer_points", objectId: id, name: id,
  });
  const boundary = [
    point("a", [0, 0, 100]), point("b", [4, 0, 101]),
    point("c", [4, 4, 102]), point("d", [2, 2, 100.5]), point("e", [0, 4, 99]),
  ];
  const surface = createCivilTinSurfaceFromBoundary(boundary, {
    ...base, objectId: "object_surface_manual", name: "Výkopová plocha",
  });
  assert.equal(isContract("model_object", surface), true);
  assert.equal(surface.geometry.faces.length, boundary.length - 2);
  assert.deepEqual(surface.geometry.bounds, { min: [0, 0, 99], max: [4, 4, 102] });
  assert.deepEqual(surface.geometry.vertices[3], [2, 2, 100.5]);
  assert.equal(surface.properties.review_state, "unreviewed");

  const clockwise = createCivilTinSurfaceFromBoundary([...boundary].reverse(), {
    ...base, objectId: "object_surface_clockwise", name: "Obrácená hranice",
  });
  assert.equal(isContract("model_object", clockwise), true);
  assert.equal(clockwise.geometry.faces.length, 3);

  assert.throws(() => createCivilTinSurfaceFromBoundary([
    point("x1", [0, 0, 0]), point("x2", [3, 3, 0]),
    point("x3", [0, 3, 0]), point("x4", [3, 0, 0]),
  ], { ...base, objectId: "object_surface_cross", name: "Křížení" }), /sama protíná/);
  assert.throws(() => createCivilTinSurfaceFromBoundary([
    point("u1", [0, 0, 0]), point("u2", [2, 0, 0]), point("u3", [0, 0, 1]),
  ], { ...base, objectId: "object_surface_duplicate", name: "Duplicita" }), /duplicitní XY/);
});

test("civil povrch přijímá také potvrzené vytěžené vytyčovací body", async () => {
  const model = await fixture("valid-stakeout-model.json");
  const points = model.objects.filter((object) => object.type === "stakeout.point");
  const third = structuredClone(points[0]);
  third.id = "object_stakeout_surface_third";
  third.geometry.point = [points[0].geometry.point[0] + 1, points[0].geometry.point[1] + 4, points[0].geometry.point[2] + 0.5];
  const surface = createCivilTinSurfaceFromBoundary([...points, third], {
    objectId: "object_surface_from_stakeout",
    layerId: "layer_surfaces",
    name: "Plocha z vytyčovacích bodů",
    sourceDocumentId: points[0].provenance.source_document_id,
    sourceDocumentSha256: points[0].provenance.source_document_sha256,
    algorithmVersion: "civil-boundary-ear-clipping-v1",
  });
  assert.equal(isContract("model_object", surface), true);
  assert.equal(surface.geometry.faces.length, 1);
  assert.deepEqual(surface.geometry.vertices, points.map((point) => point.geometry.point).concat([third.geometry.point]));
});

test("civil TIN trianguluje neuspořádaný bodový mrak Delaunayovým algoritmem", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const crs = model.objects[0].properties.crs;
  const base = {
    layerId: "layer_points", sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64), algorithmVersion: "civil-delaunay-v1",
  };
  const points = [[0, 0, 100], [4, 4, 104], [0, 4, 102], [4, 0, 101], [2, 2, 103]]
    .map((coordinates, index) => createManualCivilPoint(coordinates, crs, {
      ...base, objectId: `object_point_cloud_${index}`, name: `Bod ${index}`,
    }));
  const surface = createCivilTinSurfaceFromPoints(points, {
    ...base, layerId: "layer_surfaces", objectId: "object_surface_cloud", name: "TIN bodového mraku",
  });
  assert.equal(isContract("model_object", surface), true);
  assert.equal(surface.geometry.vertices.length, 5);
  assert.equal(surface.geometry.faces.length, 4);
  assert.equal(surface.provenance.algorithm_version, "civil-delaunay-v1");
  assert.throws(() => createCivilTinSurfaceFromPoints([
    points[0], points[3], { ...points[0], id: "object_duplicate_xy", geometry: { ...points[0].geometry, point: [0, 0, 200] } },
  ], { ...base, objectId: "object_duplicate_surface", name: "Duplicita" }), /duplicitní XY/);
});

test("šikmá plocha vytvoří přesný pás vlevo od referenční hrany", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const crs = model.objects[0].properties.crs;
  const elevationDifferenceM = civilSlopeElevationDifference(4, "percent", 25);
  assert.equal(elevationDifferenceM, 1);
  assert.ok(Math.abs(civilSlopeElevationDifference(4, "degrees", Math.atan(0.25) * 180 / Math.PI) - 1) < 1e-9);
  assert.equal(civilSlopeElevationDifference(4, "ratio", -4), -1);
  assert.equal(civilSlopeElevationDifference(4, "elevation", 0.6), 0.6);

  const surface = createCivilSlopeSurface([[0, 0, 100], [10, 0, 101]], crs, {
    objectId: "object_slope_surface",
    layerId: "layer_slope_surface",
    name: "Svah vlevo",
    sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64),
    algorithmVersion: "civil-slope-strip-v1",
    widthM: 4,
    elevationDifferenceM,
    side: "left",
  });

  assert.equal(isContract("model_object", surface), true);
  assert.deepEqual(surface.geometry.vertices, [
    [0, 0, 100], [10, 0, 101], [0, 4, 101], [10, 4, 102],
  ]);
  assert.deepEqual(surface.geometry.faces, [[0, 1, 3], [0, 3, 2]]);
  assert.deepEqual(surface.geometry.bounds, { min: [0, 0, 100], max: [10, 4, 102] });
  const areas = civilTinSurfaceAreas(surface);
  assert.equal(areas.planM2, 40);
  assert.ok(Math.abs(areas.surfaceM2 - Math.sqrt(1716)) < 1e-12);
});

test("šikmá plocha podporuje pravou stranu a odmítne nebezpečnou geometrii", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const crs = model.objects[0].properties.crs;
  const base = {
    objectId: "object_slope_surface_right", layerId: "layer_slope_surface", name: "Svah vpravo",
    sourceDocumentId: "document_situation", sourceDocumentSha256: "e".repeat(64),
    widthM: 2, elevationDifferenceM: -0.5, side: "right",
  };
  const surface = createCivilSlopeSurface([[0, 0, 100], [5, 0, 100]], crs, base);
  assert.deepEqual(surface.geometry.vertices.slice(2), [[0, -2, 99.5], [5, -2, 99.5]]);
  assert.equal(isContract("model_object", surface), true);
  assert.throws(() => civilSlopeElevationDifference(0, "percent", 2), /Šířka/);
  assert.throws(() => civilSlopeElevationDifference(2, "degrees", 89), /Úhel/);
  assert.throws(() => civilSlopeElevationDifference(2, "ratio", 0), /Poměr/);
  assert.throws(() => civilSlopeElevationDifference(2, "unknown", 1), /podporované/);
  assert.throws(() => createCivilSlopeSurface([[0, 0, 0], [1, 0, 0]], crs, { ...base, side: "inside" }), /Strana/);
  assert.throws(() => createCivilSlopeSurface([[0, 0, 0], [0, 0, 1]], crs, base), /degenerovaný/);
  assert.throws(() => createCivilSlopeSurface([[0, 0, 0], [1, 0, 0], [0, 0, 0]], crs, base), /180°/);
});

test("civil TIN nepřemosťuje oddělené shluky hranami nad povolený limit", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const crs = model.objects[0].properties.crs;
  const base = {
    layerId: "layer_points", sourceDocumentId: "document_situation",
    sourceDocumentSha256: "e".repeat(64), algorithmVersion: "civil-delaunay-max-edge-v2",
  };
  const coordinates = [
    [0, 0, 100], [1, 0, 100], [0, 1, 100], [1, 1, 100],
    [100, 0, 100], [101, 0, 100], [100, 1, 100], [101, 1, 100],
  ];
  const points = coordinates.map((coordinates, index) => createManualCivilPoint(coordinates, crs, {
    ...base, objectId: `object_cluster_${index}`, name: `Shluk ${index}`,
  }));
  assert.equal(suggestCivilTinMaximumEdgeLength(points), 4);
  const surface = createCivilTinSurfaceFromPoints(points, {
    ...base, objectId: "object_surface_clusters", layerId: "layer_surfaces", name: "Oddělené plochy",
    maximumEdgeLengthM: 4,
  });
  assert.equal(surface.geometry.faces.length, 4);
  assert.equal(surface.geometry.faces.every((face) => {
    const xs = face.map((index) => surface.geometry.vertices[index][0]);
    return Math.max(...xs) - Math.min(...xs) <= 1;
  }), true);
  assert.deepEqual(civilTinSurfaceAreas(surface), { planM2: 2, surfaceM2: 2 });
  assert.throws(() => createCivilTinSurfaceFromPoints(points, {
    ...base, objectId: "object_surface_too_strict", layerId: "layer_surfaces", name: "Příliš přísné",
    maximumEdgeLengthM: 0.5,
  }), /nezůstal žádný trojúhelník/);
});

test("materiálová vrstva vytváří uzavřený triangulovaný mesh a přesný objem", async () => {
  const landxml = await fixture("valid-landxml-tin.json");
  const surface = structuredClone(landxml.surface);
  surface.id = "object_tin_top";
  surface.properties.review_state = "unreviewed";
  surface.provenance.source_kind = "manual";
  delete surface.provenance.source_job_id;
  const layer = createCivilMaterialLayerFromSurface(surface, {
    objectId: "object_material_layer_01", layerId: "layer_materials", name: "Štěrkodrť 0/63",
    materialCode: "STERKODRT_0_63", thicknessM: 0.5,
    sourceDocumentId: surface.provenance.source_document_id,
    sourceDocumentSha256: surface.provenance.source_document_sha256,
    algorithmVersion: "civil-material-layer-v1",
  });
  assert.equal(isContract("model_object", layer), true);
  assert.equal(layer.geometry.vertices.length, surface.geometry.vertices.length * 2);
  assert.equal(layer.properties.volume_m3, 50);
  const edgeCounts = new Map();
  for (const face of layer.geometry.faces) for (const [a, b] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]]) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }
  assert.equal([...edgeCounts.values()].every((count) => count === 2), true);
  assert.equal(isContract("model_version", { ...await fixture("valid-civil-tools-model.json"), objects: [surface, layer] }), true);

  const tampered = structuredClone(layer);
  tampered.properties.volume_m3 += 1;
  assert.equal(isContract("model_object", tampered), false);
  const reversedFace = structuredClone(layer);
  reversedFace.geometry.faces[2] = [
    reversedFace.geometry.faces[2][0],
    reversedFace.geometry.faces[2][2],
    reversedFace.geometry.faces[2][1],
  ];
  reversedFace.properties.volume_m3 = Math.abs(reversedFace.geometry.faces.reduce((sum, face) => {
    const [first, second, third] = face.map((index) => reversedFace.geometry.vertices[index]);
    return sum + (
      first[0] * (second[1] * third[2] - second[2] * third[1])
      + first[1] * (second[2] * third[0] - second[0] * third[2])
      + first[2] * (second[0] * third[1] - second[1] * third[0])
    ) / 6;
  }, 0));
  assert.equal(isContract("model_object", reversedFace), false);
  assert.throws(() => createCivilMaterialLayerFromSurface(surface, {
    objectId: "object_bad_layer", layerId: "layer_materials", name: "Neplatná",
    materialCode: "../bad", thicknessM: 0.5,
    sourceDocumentId: surface.provenance.source_document_id,
    sourceDocumentSha256: surface.provenance.source_document_sha256,
  }), /Kód materiálu/);
});

test("stakeout modul registruje body a skupiny bez závislosti na jiném modulu", () => {
  const registry = new ModuleRegistry();
  registry.register(stakeoutModuleManifest);
  assert.equal(registry.ownerOf("stakeout.point"), "stakeout");
  assert.equal(registry.ownerOf("stakeout.group"), "stakeout");
  assert.equal(stakeoutModuleManifest.commandTypes.includes("stakeout.group.members.set"), true);
});

test("civil stationing a profil neextrapolují a sweep je deterministický", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const tools = await fixture("valid-civil-tools.json");
  const axis = model.objects[0];
  const profile = model.objects[1];
  assert.deepEqual(civilAxisStations(axis), [1000, 1010]);
  assert.deepEqual(civilAxisPositionAt(axis, 1005).point, [5, 0, 100.5]);
  assert.equal(civilProfileElevationAt(profile, 1005), 100.5);
  assert.throws(() => civilAxisPositionAt(axis, 999), /extrapolace/);
  assert.throws(() => civilProfileElevationAt(profile, 1011), /extrapolace/);

  const generated = buildCivilSweep(axis, profile, {
    objectId: "object_sweep_main",
    layerId: "layer_civil",
    name: "Koridor",
    sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64),
    sourceJobId: "job_civil_sweep",
    algorithmVersion: "civil-sweep-v1",
    tools,
  });
  assert.deepEqual(generated, model.objects[2]);
  assert.equal(isContract("model_object", generated), true);
  assert.deepEqual(buildCivilSweep(axis, profile, {
    objectId: "object_sweep_main",
    layerId: "layer_civil",
    name: "Koridor",
    sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64),
    sourceJobId: "job_civil_sweep",
    algorithmVersion: "civil-sweep-v1",
    tools,
  }), generated);
});

test("civil sweep odmítne self-intersection a limit vrcholů před alokací", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const tools = await fixture("valid-civil-tools.json");
  tools.section.reverse();
  assert.throws(() => buildCivilSweep(model.objects[0], model.objects[1], {
    objectId: "object_sweep_invalid",
    layerId: "layer_civil",
    name: "Neplatný",
    sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64),
    algorithmVersion: "civil-sweep-v1",
    tools,
  }), /self-intersection/);
  tools.section.reverse();
  tools.sampling_spacing_m = 0.00001;
  assert.throws(() => buildCivilSweep(model.objects[0], model.objects[1], {
    objectId: "object_sweep_too_large",
    layerId: "layer_civil",
    name: "Příliš velký",
    sourceDocumentId: "document_situation",
    sourceDocumentSha256: "d".repeat(64),
    algorithmVersion: "civil-sweep-v1",
    tools,
  }), /100 000/);
});

test("civil sweep renderer mapuje survey CRS do stejného world prostoru jako CAD", async () => {
  const model = await fixture("valid-civil-tools-model.json");
  const cad = await fixture("valid-cad-underlay-view.json");
  cad.source_crs.epsg = 5514;
  cad.source_crs.vertical_datum = "Bpv";
  const descriptors = describeCivilObjects(model.objects, cad);
  const axisDescriptor = descriptors.find((descriptor) => descriptor.id === "object_axis_main");
  const sweepDescriptor = descriptors.find((descriptor) => descriptor.id === "object_sweep_main");
  assert.deepEqual(axisDescriptor.polyline[0], [-1000, -2000, -150]);
  assert.deepEqual(sweepDescriptor.mesh.vertices[0], [-1000, -2001, -150]);
  assert.deepEqual(sweepDescriptor.mesh.faces[0], [0, 2, 1]);
});

test("stakeout renderer mapuje body do stejného world prostoru jako CAD", async () => {
  const model = await fixture("valid-stakeout-model.json");
  const cad = await fixture("valid-cad-underlay-view.json");
  cad.source_crs.epsg = 5514;
  cad.source_crs.vertical_datum = "Bpv";
  const descriptors = describeStakeoutObjects(model.objects, cad);
  assert.deepEqual(descriptors.map((item) => item.id), ["object_stakeout_a001", "object_stakeout_m001"]);
  assert.deepEqual(descriptors[0].point, [-995, -1998, -149.3]);
  assert.equal(descriptors[0].volumeM3, 0);
});

test("stakeout body bez CAD podkladu používají lokální počátek a adaptivní marker", async () => {
  const model = await fixture("valid-stakeout-model.json");
  const points = model.objects.filter((object) => object.type === "stakeout.point");
  const origin = points[0].geometry.point;
  const descriptors = describeStakeoutObjects(model.objects, undefined, 10_000, origin);
  assert.deepEqual(descriptors[0].point, [0, 0, 0]);
  assert.deepEqual(descriptors[1].point, points[1].geometry.point.map((value, index) => value - origin[index]));
  assert.ok(descriptors.every((descriptor) => descriptor.pointRadiusM > 0));
});

test("výběr v přímce pracuje i s vytěženými vytyčovacími body", async () => {
  const model = await fixture("valid-stakeout-model.json");
  const points = model.objects.filter((object) => object.type === "stakeout.point");
  const matches = selectCivilPointsAlongSegment(points[0], points[1], points, { toleranceM: 0.001 });
  assert.deepEqual(matches.map((match) => match.pointId), points.map((point) => point.id));
});

test("zhuštění vytěžených bodů kontroluje CRS a přesně dopočítá E/N/Z", async () => {
  const model = await fixture("valid-stakeout-model.json");
  const points = model.objects.filter((object) => object.type === "stakeout.point");
  assert.deepEqual(interpolateSurveyPointCoordinates(points[0], points[1], 0.25), [4.25, 2.25, 100.275]);
  const foreign = structuredClone(points[1]);
  foreign.properties.crs.epsg = 4326;
  assert.throws(() => interpolateSurveyPointCoordinates(points[0], foreign, 0.5), /shodné CRS/);
  assert.throws(() => interpolateSurveyPointCoordinates(points[0], points[1], 1), /uvnitř úseku/);
});

test("building 2D/3D descriptors a výměry používají stejný validated model", async () => {
  const model = await fixture("valid-building-model.json");
  model.status = "validated";
  const descriptors = describeBuildingObjects(model.objects);
  assert.equal(descriptors.length, 3);
  assert.deepEqual(descriptors.map((item) => item.id).sort(), model.objects.map((item) => item.id).sort());
  assert.equal(descriptors.find((item) => item.id === "object_wall_01").parts.length, 1);
  assert.equal(descriptors.find((item) => item.id === "object_opening_01").floorLevelM, 0);

  const rows = buildingQuantities(model);
  const wall = rows.find((item) => item.objectId === "object_wall_01");
  assert.equal(wall.grossAreaM2, 15);
  assert.equal(wall.netAreaM2, 12.9);
  assert.throws(() => buildingQuantities({ ...model, status: "working" }), /validated/);
});

test("lomená stěna se renderuje po segmentech pod jedním stabilním ID", async () => {
  const model = await fixture("valid-building-model.json");
  const wall = model.objects[0];
  wall.geometry.points.push([5, 2]);
  wall.properties.length_m = 7;
  wall.properties.gross_side_area_m2 = 21;
  wall.properties.volume_m3 = 6.3;
  const descriptor = describeBuildingObjects([wall])[0];
  assert.equal(descriptor.id, wall.id);
  assert.equal(descriptor.parts.length, 2);
});

test("validated rooms capability vrací read-only hranici a building podlahu", async () => {
  const source = await fixture("valid-foundation.json");
  const model = structuredClone(source.model_version);
  model.status = "validated";
  model.objects[0].properties.review_state = "confirmed";
  const capability = createRoomBoundaryCapability();
  const boundaries = capability.project(model);
  assert.equal(boundaries.length, 1);
  assert.equal(Object.isFrozen(boundaries[0].rings[0]), true);

  const floor = createFloorFromBoundary(boundaries[0], {
    objectId: "object_floor_from_room",
    layerId: "layer_building",
    name: "Podlaha z místnosti",
    thicknessM: 0.15,
    sourceDocumentId: model.document_id,
    sourceDocumentSha256: model.objects[0].provenance.source_document_sha256,
    algorithmVersion: "building-floor-v1",
  });
  assert.equal(floor.properties.review_state, "unreviewed");
  assert.equal(isContract("model_object", floor), true);
});

test("capability odmítne proposal a limituje nedůvěryhodnou geometrii", async () => {
  const source = await fixture("valid-foundation.json");
  const capability = createRoomBoundaryCapability(3);
  assert.throws(() => capability.project(source.model_version), /validated/);
  source.model_version.status = "validated";
  source.model_version.objects[0].properties.review_state = "confirmed";
  assert.throws(() => capability.project(source.model_version), /limit bodů/);
});
