import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ModelScene,
  documentCornersInDrawing,
  documentPointToDrawing,
  describeObjects,
  disposeObjectResources,
  drawingPointToDocument,
  invertAffine,
  objectIdFromNode,
  roomVolumeM3,
  validateDescriptors,
  cadDocumentPointToWorld,
  cadWorldPointToDocument,
  cadDocumentCornersInWorld,
  describeCadUnderlay,
  createGeometryStream,
  GeometryStreamAssembler,
  manifestBytes,
  sha256Hex,
  initialPlanCameraPose,
  cameraPoseForPreset,
  isOrthographicViewPreset,
  orthographicHalfHeightForPreset,
  perspectiveFitDistance,
  shouldFitAfterGeometryChange,
  ControlsUpdateLoop,
  normalizeScreenRect,
  pointerGestureIsClick,
} from "../dist/index.js";

test("renderer rozliší kliknutí od orbitování a normalizuje výběrové okno", () => {
  assert.equal(pointerGestureIsClick([100, 100], [104, 103]), true);
  assert.equal(pointerGestureIsClick([100, 100], [120, 100]), false);
  assert.deepEqual(normalizeScreenRect([90, 70], [20, 10]), {
    left: 20, top: 10, right: 90, bottom: 70,
  });
});

test("3D ovladač přepočítává kameru po dobu tažení a dokončí poslední změnu", () => {
  const frames = new Map();
  const cancelled = [];
  let nextFrame = 1;
  let updates = 0;
  const loop = new ControlsUpdateLoop(
    () => { updates += 1; },
    (callback) => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    },
    (handle) => { cancelled.push(handle); frames.delete(handle); },
  );

  loop.start();
  loop.start();
  assert.equal(frames.size, 1);
  const [firstHandle, firstFrame] = frames.entries().next().value;
  frames.delete(firstHandle);
  firstFrame(0);
  assert.equal(updates, 1);
  assert.equal(frames.size, 1);

  loop.stop();
  assert.equal(updates, 2);
  assert.equal(frames.size, 0);
  assert.equal(cancelled.length, 1);
  loop.dispose();
});

const foundation = JSON.parse(await readFile(
  new URL("../../../fixtures/contracts/v1/valid-foundation.json", import.meta.url),
  "utf8",
));
const room = foundation.model_version.objects[0];
const documentView = JSON.parse(await readFile(
  new URL("../../../fixtures/contracts/v1/valid-document-view.json", import.meta.url),
  "utf8",
));
const cadUnderlay = JSON.parse(await readFile(
  new URL("../../../fixtures/contracts/v1/valid-cad-underlay-view.json", import.meta.url),
  "utf8",
));

test("výchozí 3D kamera hledí kolmo na šachovnicovou rovinu a respektuje poměr stran", () => {
  const wide = initialPlanCameraPose([12, -4, 100], [40, 10, 3], 2);
  assert.deepEqual(wide.target, [12, -4, 100]);
  assert.equal(wide.position[0], wide.target[0]);
  assert.equal(wide.position[1], wide.target[1]);
  assert.ok(wide.position[2] > wide.target[2]);

  const narrow = initialPlanCameraPose([12, -4, 100], [40, 10, 3], 0.5);
  assert.ok(narrow.position[2] > wide.position[2]);
  assert.ok(Object.isFrozen(narrow));
});

test("pojmenované 3D pohledy mají jednoznačnou osu pohledu a Z směrem nahoru", () => {
  const center = [10, 20, 30];
  const size = [40, 20, 8];
  const xz = cameraPoseForPreset("xz", center, size, 1.5);
  assert.equal(xz.position[0], center[0]);
  assert.ok(xz.position[1] < center[1]);
  assert.equal(xz.position[2], center[2]);
  assert.deepEqual(xz.up, [0, 0, 1]);
  const yz = cameraPoseForPreset("yz", center, size, 1.5);
  assert.ok(yz.position[0] > center[0]);
  assert.equal(yz.position[1], center[1]);
  const iso = cameraPoseForPreset("iso", center, size, 1.5);
  assert.ok(iso.position[0] > center[0] && iso.position[1] < center[1] && iso.position[2] > center[2]);
  assert.deepEqual(cameraPoseForPreset("xy", center, size, 1.5).up, [0, 0, 1]);
});

test("civilní kamera používá ortografické osové pohledy a bezpečný fit", () => {
  assert.equal(isOrthographicViewPreset("xy"), true);
  assert.equal(isOrthographicViewPreset("xz"), true);
  assert.equal(isOrthographicViewPreset("yz"), true);
  assert.equal(isOrthographicViewPreset("iso"), false);

  const wide = orthographicHalfHeightForPreset("xy", [40, 10, 3], 2);
  const narrow = orthographicHalfHeightForPreset("xy", [40, 10, 3], 0.5);
  assert.ok(narrow > wide);
  assert.ok(orthographicHalfHeightForPreset("xz", [40, 10, 8], 2) >= 11.5);

  const landscapeDistance = perspectiveFitDistance([40, 10, 8], 2, 38);
  const portraitDistance = perspectiveFitDistance([40, 10, 8], 0.5, 38);
  assert.ok(portraitDistance > landscapeDistance);
});

test("aktualizace 3D geometrie po prvním fitu zachová uživatelskou kameru", () => {
  assert.equal(shouldFitAfterGeometryChange("3d", false), true);
  assert.equal(shouldFitAfterGeometryChange("3d", true), false);
  assert.equal(shouldFitAfterGeometryChange("2d", true), true);
});

test("document/drawing transformace má přesný roundtrip a rohy", () => {
  const point = [412.25, 88.5];
  const drawing = documentPointToDrawing(documentView, point);
  const roundtrip = drawingPointToDocument(documentView, drawing);
  assert.ok(Math.abs(roundtrip[0] - point[0]) <= 1e-9);
  assert.ok(Math.abs(roundtrip[1] - point[1]) <= 1e-9);

  const corners = documentCornersInDrawing(documentView);
  const documentCorners = [
    [0, 0],
    [documentView.page_width_pt, 0],
    [documentView.page_width_pt, documentView.page_height_pt],
    [0, documentView.page_height_pt],
  ];
  assert.deepEqual(
    corners,
    documentCorners.map((corner) => documentPointToDrawing(documentView, corner)),
  );
  corners.forEach((corner, index) => {
    const restored = drawingPointToDocument(documentView, corner);
    assert.ok(Math.abs(restored[0] - documentCorners[index][0]) <= 1e-9);
    assert.ok(Math.abs(restored[1] - documentCorners[index][1]) <= 1e-9);
  });
  assert.throws(() => invertAffine([1, 2, 2, 4, 0, 0]), RangeError);
});

test("CAD PDF podklad má přesný document/survey/world roundtrip a všechny rohy", () => {
  const points = [[0, 0], [100, 0], [100, 100], [0, 100], [37.5, 62.25]];
  for (const point of points) {
    const world = cadDocumentPointToWorld(cadUnderlay, point);
    const restored = cadWorldPointToDocument(cadUnderlay, world);
    assert.ok(Math.abs(restored[0] - point[0]) <= 1e-9);
    assert.ok(Math.abs(restored[1] - point[1]) <= 1e-9);
  }
  assert.deepEqual(cadDocumentCornersInWorld(cadUnderlay), [
    [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
  ]);
  assert.throws(() => cadWorldPointToDocument(cadUnderlay, [1, 1, 2]), RangeError);
  assert.deepEqual(describeCadUnderlay(cadUnderlay), {
    sourceDocumentId: "document_cad_pdf",
    sourceDocumentSha256: "e".repeat(64),
    pageIndex: 0,
    cornersWorldM: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
  });
});

test("2D a 3D scéna používají stejné stabilní object_id", () => {
  const descriptors = describeObjects([room]);
  const scene = new ModelScene("2d");
  scene.replace(descriptors);
  assert.equal(objectIdFromNode(scene.get(room.id).children[0]), room.id);

  scene.setMode("3d", descriptors);
  assert.equal(objectIdFromNode(scene.get(room.id).children[0]), room.id);
  assert.equal(scene.mode, "3d");

  scene.setSelection([room.id], descriptors);
  assert.equal(objectIdFromNode(scene.get(room.id).children[0]), room.id);
});

test("průhlednost vrstvy je validována a propsána do 3D materiálu", () => {
  const descriptor = { ...describeObjects([room])[0], opacity: 0.4 };
  assert.doesNotThrow(() => validateDescriptors([descriptor]));
  assert.throws(() => validateDescriptors([{ ...descriptor, opacity: 0.01 }]), /průhlednost/);
  assert.throws(() => validateDescriptors([{ ...descriptor, opacity: Number.NaN }]), /průhlednost/);
  const scene = new ModelScene("3d");
  scene.replace([descriptor]);
  const material = scene.get(room.id).children[0].material;
  assert.equal(material.opacity, 0.4);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
});

test("3D descriptor a těleso používají výšku, podlaží a autoritativní objem", () => {
  const elevated = structuredClone(room);
  elevated.properties.height_m = 3.2;
  elevated.properties.floor_level_m = 4.5;
  elevated.properties.geometric_area_m2 = 13.02;
  const [descriptor] = describeObjects([elevated]);

  assert.equal(descriptor.heightM, 3.2);
  assert.equal(descriptor.floorLevelM, 4.5);
  assert.equal(descriptor.volumeM3, 41.664);
  assert.equal(roomVolumeM3(elevated), 41.664);

  const scene = new ModelScene("3d");
  scene.replace([descriptor]);
  const mesh = scene.get(room.id).children[0];
  assert.equal(mesh.position.z, 4.5);
  assert.equal(mesh.geometry.parameters.options.depth, 3.2);
  scene.dispose();
});

test("renderer použije bezpečnou barvu vrstvy a výběr ji nepřepíše", () => {
  const [base] = describeObjects([room]);
  const descriptor = { ...base, color: "#f472b6" };
  const scene = new ModelScene("3d");
  scene.replace([descriptor]);
  assert.equal(scene.get(room.id).children[0].material.color.getHexString(), "f472b6");
  scene.setSelection([room.id], [descriptor]);
  assert.equal(scene.get(room.id).children[0].material.color.getHexString(), "f472b6");
  assert.equal(scene.get(room.id).children[0].material.emissive.getHexString(), "607afb");
  assert.throws(() => validateDescriptors([{ ...descriptor, color: "red" }]), TypeError);
  scene.dispose();
});

test("replace a dispose uvolní geometrie i materiály", () => {
  const descriptors = describeObjects([room]);
  const scene = new ModelScene();
  scene.replace(descriptors);
  const first = scene.get(room.id);
  let geometryDisposed = 0;
  let materialDisposed = 0;
  first.traverse((child) => {
    child.geometry?.addEventListener("dispose", () => { geometryDisposed += 1; });
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials.filter(Boolean)) {
      material.addEventListener("dispose", () => { materialDisposed += 1; });
    }
  });

  scene.replace(descriptors);
  assert.ok(geometryDisposed >= 2);
  assert.ok(materialDisposed >= 2);
  assert.notEqual(scene.get(room.id), first);
  scene.dispose();
  assert.equal(scene.size, 0);
});

test("renderer odmítne nadlimitní nebo nečíselnou geometrii", () => {
  assert.throws(() => describeObjects([room], 0), RangeError);
  assert.throws(() => describeObjects([room, room], 1), RangeError);
  assert.throws(() => describeObjects([room, room], 2, 7), RangeError);
  assert.throws(() => describeObjects([room], 1, 2), RangeError);
  const invalid = structuredClone(room);
  invalid.geometry.rings[0][0][0] = Number.NaN;
  assert.throws(() => describeObjects([invalid]), TypeError);
  const invalidHeight = structuredClone(room);
  invalidHeight.properties.height_m = Number.NaN;
  assert.throws(() => describeObjects([invalidHeight]), TypeError);
});

test("dispose helper je bezpečný i pro prázdnou větev", () => {
  const scene = new ModelScene();
  assert.doesNotThrow(() => disposeObjectResources(scene.root));
});

test("renderer ověří multipart descriptor a zachová picking ID", () => {
  const descriptor = {
    id: "object_multipart",
    ring: [[0, 0], [1, 0], [1, 0.2], [0, 0.2]],
    heightM: 3,
    floorLevelM: 0,
    volumeM3: 1.2,
    parts: [
      { ring: [[0, 0], [1, 0], [1, 0.2], [0, 0.2]], heightM: 3, floorLevelM: 0 },
      { ring: [[1, 0], [1.2, 0], [1.2, 1], [1, 1]], heightM: 3, floorLevelM: 0 },
    ],
  };
  assert.equal(validateDescriptors([descriptor]).length, 1);
  const scene = new ModelScene("3d");
  scene.replace([descriptor]);
  assert.equal(scene.get(descriptor.id).children.length, 4);
  for (const child of scene.get(descriptor.id).children) {
    assert.equal(objectIdFromNode(child), descriptor.id);
  }
  assert.throws(() => validateDescriptors([descriptor, descriptor]), /unikátní ID/);
  assert.throws(() => validateDescriptors([{ ...descriptor, parts: [] }]), /nemá render části/);
  const degenerate = structuredClone(descriptor);
  degenerate.parts[0].ring = [[0, 0], [1, 0], [2, 0]];
  assert.throws(() => validateDescriptors([degenerate]), /platný render descriptor/);
  scene.dispose();
});

test("indexed mesh zachová picking ID a přepíná 2D/3D bez ztráty geometrie", () => {
  const descriptor = {
    id: "object_civil_sweep",
    ring: [[0, -1], [10, -1], [10, 1], [0, 1]],
    heightM: 1,
    floorLevelM: 100,
    volumeM3: 0,
    mesh: {
      vertices: [[0, -1, 100], [0, 1, 100], [10, -1, 101], [10, 1, 101]],
      faces: [[0, 2, 1], [1, 2, 3]],
    },
  };
  assert.equal(validateDescriptors([descriptor]).length, 1);
  const scene = new ModelScene("2d");
  scene.replace([descriptor]);
  assert.equal(objectIdFromNode(scene.get(descriptor.id).children[0]), descriptor.id);
  assert.equal(scene.get(descriptor.id).children[0].geometry.attributes.position.getZ(0), 0);
  scene.setMode("3d", [descriptor]);
  assert.equal(scene.get(descriptor.id).children[0].geometry.attributes.position.getZ(0), 100);
  const invalid = structuredClone(descriptor);
  invalid.mesh.faces[0][2] = 99;
  assert.throws(() => validateDescriptors([invalid]), /mesh face/);
  scene.dispose();
});

test("náhled TIN používá průhlednou výplň a viditelnou triangulační síť", () => {
  const descriptor = {
    id: "object_tin_preview",
    color: "#0ea5e9",
    presentation: "preview",
    ring: [],
    heightM: 0,
    floorLevelM: 0,
    volumeM3: 0,
    mesh: {
      vertices: [[0, 0, 100], [1, 0, 100], [0, 1, 100]],
      faces: [[0, 1, 2]],
    },
  };
  assert.equal(validateDescriptors([descriptor]).length, 1);
  const scene = new ModelScene("3d");
  scene.replace([descriptor]);
  const preview = scene.get(descriptor.id);
  assert.equal(preview.children.length, 2);
  assert.equal(preview.children[0].material.transparent, true);
  assert.equal(preview.children[0].material.opacity, 0.18);
  assert.equal(preview.children[1].material.wireframe, true);
  assert.throws(() => validateDescriptors([{ ...descriptor, presentation: "unknown" }]), /způsob prezentace/);
  scene.dispose();
});

test("triangulace hotového TIN se přepíná v 2D i 3D bez změny geometrie a výběru", () => {
  const descriptor = {
    id: "object_saved_tin", color: "#c084fc", opacity: 0.05,
    ring: [], heightM: 0, floorLevelM: 0, volumeM3: 0,
    mesh: { vertices: [[0, 0, 100], [1, 0, 101], [0, 1, 100], [1, 1, 101]], faces: [[0, 1, 2], [1, 3, 2]] },
  };
  const original = structuredClone(descriptor);
  for (const mode of ["2d", "3d"]) {
    const scene = new ModelScene(mode);
    scene.replace([descriptor]);
    assert.equal(scene.get(descriptor.id).children.length, 1);
    scene.replace([{ ...descriptor, showTriangulation: true }]);
    const [fill, edges] = scene.get(descriptor.id).children;
    assert.equal(edges.material.wireframe, true);
    assert.equal(edges.material.depthTest, true);
    assert.equal(edges.material.depthWrite, false);
    assert.equal(edges.material.side, 2); // DoubleSide: síť je vidět také zespodu.
    assert.ok(edges.material.opacity > fill.material.opacity);
    assert.equal(fill.material.polygonOffset, true);
    assert.equal(objectIdFromNode(edges), descriptor.id);
    assert.deepEqual([...edges.geometry.index.array], descriptor.mesh.faces.flat());
    assert.equal(edges.geometry.attributes.position.getZ(0), mode === "2d" ? 0 : 100);
    scene.setSelection([descriptor.id], [{ ...descriptor, showTriangulation: true }]);
    assert.equal(objectIdFromNode(scene.get(descriptor.id).children[1]), descriptor.id);
    scene.replace([{ ...descriptor, showTriangulation: false }]);
    assert.equal(scene.get(descriptor.id).children.length, 1);
    scene.dispose();
  }
  assert.deepEqual(descriptor, original);
  assert.throws(() => validateDescriptors([{ ...descriptor, showTriangulation: "true" }]), /triangulace/);
});

test("bodový marker zachová picking ID a přepíná 2D/3D souřadnici Z", () => {
  const descriptor = {
    id: "object_stakeout_a001",
    ring: [[4.9, 1.9], [5.1, 1.9], [5.1, 2.1], [4.9, 2.1]],
    heightM: 0,
    floorLevelM: 100.7,
    volumeM3: 0,
    point: [5, 2, 100.7],
  };
  assert.equal(validateDescriptors([descriptor]).length, 1);
  const scene = new ModelScene("2d");
  scene.replace([descriptor]);
  assert.equal(objectIdFromNode(scene.get(descriptor.id).children[0]), descriptor.id);
  assert.equal(scene.get(descriptor.id).children[0].position.z, 0.02);
  scene.setMode("3d", [descriptor]);
  assert.equal(scene.get(descriptor.id).children[0].position.z, 100.7);
  const invalid = { ...descriptor, point: [Number.NaN, 2, 100.7] };
  assert.throws(() => validateDescriptors([invalid]), /neplatný bod/);
  assert.throws(() => validateDescriptors([{ ...descriptor, pointRadiusM: 0 }]), /velikost bodu/);
  scene.dispose();
});

test("civilní osa se renderuje jako jediná volitelná 3D linie", () => {
  const descriptor = {
    id: "object_axis_render",
    ring: [[0, 0], [10, 0], [10, 5], [0, 5]],
    heightM: 1,
    floorLevelM: 100,
    volumeM3: 0,
    polyline: [[0, 0, 100], [10, 0, 101], [10, 5, 102]],
  };
  assert.equal(validateDescriptors([descriptor]).length, 1);
  const scene = new ModelScene("3d");
  scene.replace([descriptor]);
  const axis = scene.get(descriptor.id).children[0];
  assert.equal(axis.type, "Line");
  assert.equal(axis.geometry.attributes.position.getZ(2), 102);
  assert.equal(objectIdFromNode(axis), descriptor.id);
  assert.throws(() => validateDescriptors([{ ...descriptor, polyline: [[0, 0, 0]] }]), /3D linii/);
  scene.dispose();
});

const streamMesh = {
  vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 1, 0], [2, 2, 0]],
  faces: [[0, 1, 2], [0, 2, 3], [2, 4, 5], [2, 5, 3]],
};
const streamScope = {
  streamId: "stream_renderer",
  projectId: "project_demo",
  sourceVersionId: "version_demo",
  sourceRevision: 2,
  sourceContentSha256: "a".repeat(64),
  objectId: "object_mesh_demo",
};

test("geometry stream sestaví stejný mesh až po finálním checksumu", async () => {
  const stream = await createGeometryStream(streamMesh, streamScope, undefined, 3, 2);
  assert.equal(stream.chunks.length, 2);
  assert.equal(
    stream.manifest.geometry_sha256,
    "8d804ed903b940d65a3be7197491e493a1e5ec9db27425b00027551a2970e77c",
  );
  const assembler = new GeometryStreamAssembler(stream.manifest);
  await assembler.accept(stream.chunks[0]);
  await assembler.accept(stream.chunks[0]);
  assert.equal(assembler.progress, 0.5);
  await assembler.accept(stream.chunks[1]);
  assert.deepEqual(await assembler.finalize(), streamMesh);
});

test("geometry stream fail-closed odmítne gap, tamper a cancel", async () => {
  const stream = await createGeometryStream(streamMesh, streamScope, undefined, 3, 2);
  const gap = new GeometryStreamAssembler(stream.manifest);
  await assert.rejects(gap.accept(stream.chunks[1]), /pořadí/);
  await assert.rejects(gap.accept(stream.chunks[0]), /zrušen/);

  const tampered = structuredClone(stream.chunks[0]);
  tampered.vertices[0][0] = 99;
  const checksum = new GeometryStreamAssembler(stream.manifest);
  await assert.rejects(checksum.accept(tampered), /checksumu/);
  await assert.rejects(checksum.finalize(), /zrušen/);

  const cancelled = new GeometryStreamAssembler(stream.manifest);
  await cancelled.accept(stream.chunks[0]);
  cancelled.cancel();
  assert.equal(cancelled.progress, 0);
  await assert.rejects(cancelled.finalize(), /zrušen/);
});

test("geometry stream váže každý chunk na project/version/manifest scope", async () => {
  const stream = await createGeometryStream(streamMesh, streamScope, undefined, 3, 2);
  const foreign = structuredClone(stream.chunks[0]);
  foreign.project_id = "project_foreign";
  const assembler = new GeometryStreamAssembler(stream.manifest);
  await assert.rejects(assembler.accept(foreign), /scoped manifestu/);
  assert.equal(assembler.progress, 0);
});

test("geometry stream odmítne celkový limit před materializací a aggregate při accept", async () => {
  await assert.rejects(
    createGeometryStream({ vertices: { length: 100_001 }, faces: { length: 2 } }, streamScope),
    /celkový limit/,
  );

  const stream = await createGeometryStream(streamMesh, streamScope, undefined, 3, 2);
  const manifest = { ...stream.manifest, vertex_count: 4 };
  const manifestSha = await sha256Hex(manifestBytes(manifest));
  const chunks = stream.chunks.map((chunk) => ({ ...chunk, manifest_sha256: manifestSha }));
  const assembler = new GeometryStreamAssembler(manifest);
  await assembler.accept(chunks[0]);
  await assert.rejects(assembler.accept(chunks[1]), /průběžný manifest/);
  assert.equal(assembler.progress, 0);
});
