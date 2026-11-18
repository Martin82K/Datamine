import { drawingUnderlayMesh, type DrawingUnderlay } from "./drawing-underlay";
import { useEffect, useRef, useState } from "react";
import type { CadUnderlayView, DocumentView, ModelObject, RoomObject } from "@datamine/contracts";
import type { DatamineViewport, ScreenRect, ViewMode } from "@datamine/renderer";
import type { ViewPreset3D, ViewState3D } from "@datamine/renderer";
import { describeBuildingObjects, describeCivilObjects, describeStakeoutObjects } from "@datamine/modules";
import { cameraCommandForKey } from "./camera-controls";
import { resolveMeasurementSnap, type MeasurementAnchor } from "./civil-measurement";
import { PdfUnderlay } from "./PdfUnderlay";
import { mapBoundsFor, terrainMesh, type MapContext } from "./civil-map";

interface EditorViewportProps {
  readonly objects: readonly ModelObject[];
  readonly mapContext?: MapContext | null;
  readonly drawingUnderlay?: DrawingUnderlay | null;
  readonly selection: readonly string[];
  readonly mode: ViewMode;
  readonly documentView: DocumentView;
  readonly pdfUrl?: string;
  readonly cadUnderlayView?: CadUnderlayView;
  readonly layerColors: Readonly<Record<string, string>>;
  readonly layerOpacities: Readonly<Record<string, number>>;
  readonly hiddenLayerIds: ReadonlySet<string>;
  readonly showTriangulation?: boolean;
  readonly selectionMode?: "single" | "box";
  readonly previewObjectIds?: readonly string[];
  readonly measurementEnabled?: boolean;
  readonly onMeasurementPick?: (anchor: MeasurementAnchor) => void;
  readonly onPick: (objectId: string | null, additive?: boolean) => void;
  readonly onBoxSelect?: (objectIds: readonly string[], additive: boolean) => void;
}

const normalizeSelectionRect = (
  start: readonly [number, number],
  end: readonly [number, number],
): ScreenRect => ({
  left: Math.min(start[0], end[0]),
  top: Math.min(start[1], end[1]),
  right: Math.max(start[0], end[0]),
  bottom: Math.max(start[1], end[1]),
});

const roomObjects = (objects: readonly ModelObject[]): readonly RoomObject[] => objects.filter(
  (object): object is RoomObject => object.type === "rooms.room",
);

const surveyOriginFor = (objects: readonly ModelObject[]): readonly [number, number, number] | undefined => {
  for (const object of objects) {
    if (object.type === "civil.point" || object.type === "stakeout.point") return object.geometry.point;
    if (object.type === "civil.axis" || object.type === "civil.profile") return object.geometry.points[0];
    if (object.type === "civil.sweep" || object.type === "civil.tin_surface" || object.type === "civil.material_layer") return object.geometry.vertices[0];
  }
  return undefined;
};

const descriptorsFor = async (
  objects: readonly ModelObject[],
  cadUnderlayView: CadUnderlayView | undefined,
  layerColors: Readonly<Record<string, string>>,
  layerOpacities: Readonly<Record<string, number>>,
  hiddenLayerIds: ReadonlySet<string>,
  previewObjectIds: ReadonlySet<string>,
  showTriangulation: boolean,
) => {
  const { describeObjects } = await import("@datamine/renderer");
  const visibleObjects = objects.filter((object) => !hiddenLayerIds.has(object.layer_id) || previewObjectIds.has(object.id));
  const surveyOrigin = cadUnderlayView ? undefined : surveyOriginFor(visibleObjects);
  const layerByObjectId = new Map(visibleObjects.map((object) => [object.id, object.layer_id]));
  const tinIds = new Set(visibleObjects.filter((object) => object.type === "civil.tin_surface").map((object) => object.id));
  return [
    ...describeObjects(roomObjects(visibleObjects)),
    ...describeBuildingObjects(visibleObjects),
    ...describeCivilObjects(visibleObjects, cadUnderlayView, 100_000, surveyOrigin),
    ...describeStakeoutObjects(visibleObjects, cadUnderlayView, 10_000, surveyOrigin),
  ].map((descriptor) => Object.freeze({
    ...descriptor,
    color: previewObjectIds.has(descriptor.id) ? "#0ea5e9" : layerColors[layerByObjectId.get(descriptor.id) ?? ""],
    opacity: layerOpacities[layerByObjectId.get(descriptor.id) ?? ""] ?? 1,
    presentation: previewObjectIds.has(descriptor.id) ? "preview" as const : "default" as const,
    showTriangulation: showTriangulation && tinIds.has(descriptor.id),
  }));
};

export function EditorViewport({
  objects, selection, mode, documentView, pdfUrl, cadUnderlayView, layerColors, layerOpacities, hiddenLayerIds,
  selectionMode = "single", previewObjectIds = [], measurementEnabled = false, onMeasurementPick, onPick, onBoxSelect,
  mapContext = null, drawingUnderlay = null, showTriangulation = false,
}: EditorViewportProps) {
  const measurementEnabledRef = useRef(measurementEnabled);
  measurementEnabledRef.current = measurementEnabled;
  const measureStartRef = useRef<readonly [number, number] | null>(null);
  const snapFrameRef = useRef<number | null>(null);
  const [snapTarget, setSnapTarget] = useState<{ anchor: MeasurementAnchor; screen: readonly [number, number] } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<DatamineViewport | null>(null);
  const mapContextRef = useRef(mapContext);
  mapContextRef.current = mapContext;
  const drawingUnderlayRef = useRef(drawingUnderlay);
  drawingUnderlayRef.current = drawingUnderlay;
  const onPickRef = useRef(onPick);
  const objectsRef = useRef(objects);
  const selectionRef = useRef(selection);
  const modeRef = useRef(mode);
  const documentViewRef = useRef(documentView);
  const layerColorsRef = useRef(layerColors);
  const layerOpacitiesRef = useRef(layerOpacities);
  const hiddenLayerIdsRef = useRef(hiddenLayerIds);
  const previewObjectIdsRef = useRef(previewObjectIds);
  const showTriangulationRef = useRef(showTriangulation);
  const boxStartRef = useRef<readonly [number, number] | null>(null);
  const [selectionBox, setSelectionBox] = useState<{
    readonly start: readonly [number, number];
    readonly end: readonly [number, number];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState3D>("xy");
  const roomLabel = objects.find((object): object is RoomObject => object.type === "rooms.room");
  const civilAxisLabel = objects.find((object) => object.type === "civil.axis");

  objectsRef.current = objects;
  selectionRef.current = selection;
  modeRef.current = mode;
  documentViewRef.current = documentView;
  layerColorsRef.current = layerColors;
  layerOpacitiesRef.current = layerOpacities;
  hiddenLayerIdsRef.current = hiddenLayerIds;
  previewObjectIdsRef.current = previewObjectIds;
  showTriangulationRef.current = showTriangulation;

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    void import("@datamine/renderer")
      .then(({ DatamineViewport: Viewport }) => {
        if (cancelled) {
          return;
        }
        const viewport = new Viewport({
          canvas,
          mode: modeRef.current,
          documentView: documentViewRef.current,
          cadUnderlayView,
          onPick: (objectId, additive) => { if (!measurementEnabledRef.current) onPickRef.current(objectId, additive); },
          onViewStateChange: setViewState,
        });
        viewportRef.current = viewport;
        return descriptorsFor(objectsRef.current, cadUnderlayView, layerColorsRef.current, layerOpacitiesRef.current, hiddenLayerIdsRef.current, new Set(previewObjectIdsRef.current), showTriangulationRef.current).then((descriptors) => {
          if (!cancelled) {
            viewport.setDescriptors(descriptors);
            const visible = objectsRef.current.filter((object) => !hiddenLayerIdsRef.current.has(object.layer_id) || previewObjectIdsRef.current.includes(object.id));
            const origin = surveyOriginFor(visible);
            const context = mapContextRef.current;
            let supported = false;
            try { mapBoundsFor(visible, 10); supported = true; } catch { /* Local and mixed coordinates cannot use the map. */ }
            if (supported && context && origin && !cadUnderlayView && modeRef.current === "3d") viewport.setGeographicContext({ ...terrainMesh(context.terrain, origin), image: context.image, opacity: context.opacity });
            const drawing = drawingUnderlayRef.current;
            if (supported && drawing && origin && !cadUnderlayView && modeRef.current === "3d") viewport.setDrawingUnderlay({ ...drawingUnderlayMesh(drawing, origin), image: drawing.image, opacity: drawing.opacity });
          }
        });
      })
      .then(() => {
        const viewport = viewportRef.current;
        const canvas = canvasRef.current;
        if (!viewport || !canvas || cancelled) return;
        viewport.setSelection(selectionRef.current);
        resizeObserver = new ResizeObserver(() => viewport.resize());
        resizeObserver.observe(canvas);
        viewport.resize();
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("3D renderer se nepodařilo načíst.");
        }
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (snapFrameRef.current !== null) cancelAnimationFrame(snapFrameRef.current);
      viewportRef.current?.dispose();
      viewportRef.current = null;
    };
    // Renderer se vytváří jednou; model, výběr a režim aktualizují samostatné efekty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    void descriptorsFor(objects, cadUnderlayView, layerColors, layerOpacities, hiddenLayerIds, new Set(previewObjectIds), showTriangulation).then((descriptors) => {
      if (active && viewportRef.current) {
        viewportRef.current.setDescriptors(descriptors);
        viewportRef.current.setSelection(selectionRef.current);
      }
    }).catch(() => setLoadError("Model nelze bezpečně vykreslit."));
    return () => { active = false; };
  }, [objects, cadUnderlayView, layerColors, layerOpacities, hiddenLayerIds, previewObjectIds, showTriangulation]);

  useEffect(() => {
    viewportRef.current?.setSelection(selection);
  }, [selection]);

  useEffect(() => {
    viewportRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    const visible = objects.filter((object) => !hiddenLayerIds.has(object.layer_id) || previewObjectIds.includes(object.id));
    const origin = surveyOriginFor(visible);
    if (!viewportRef.current) return;
    let supported = false;
    try { mapBoundsFor(visible, 10); supported = true; } catch { /* A changed or mixed CRS must not retain an incorrectly positioned context. */ }
    try {
      viewportRef.current.setGeographicContext(supported && mapContext && origin && !cadUnderlayView && mode === "3d"
        ? { ...terrainMesh(mapContext.terrain, origin), image: mapContext.image, opacity: mapContext.opacity } : null);
      viewportRef.current.setDrawingUnderlay(supported && drawingUnderlay && origin && !cadUnderlayView && mode === "3d"
        ? { ...drawingUnderlayMesh(drawingUnderlay, origin), image: drawingUnderlay.image, opacity: drawingUnderlay.opacity } : null);
    } catch { setLoadError("Mapový podklad nelze bezpečně vykreslit."); }
  }, [mapContext, drawingUnderlay, objects, hiddenLayerIds, previewObjectIds, cadUnderlayView, mode]);

  useEffect(() => {
    viewportRef.current?.setInteractionMode(selectionMode === "box" ? "box-select" : "navigate");
    if (selectionMode !== "box") {
      boxStartRef.current = null;
      setSelectionBox(null);
    }
  }, [selectionMode]);

  useEffect(() => {
    viewportRef.current?.setDocumentView(documentView);
  }, [documentView]);

  useEffect(() => {
    viewportRef.current?.setCadUnderlayView(cadUnderlayView);
  }, [cadUnderlayView]);

  useEffect(() => { setSnapTarget(null); }, [measurementEnabled, objects, hiddenLayerIds, mode, viewState]);

  const snapAt = (point: readonly [number, number]) => {
    const snap = viewportRef.current?.measurementSnapAt(point[0], point[1]);
    if (!snap || previewObjectIdsRef.current.includes(snap.objectId)) return null;
    const anchor = resolveMeasurementSnap(objectsRef.current.filter((object) => !hiddenLayerIdsRef.current.has(object.layer_id)), snap);
    return anchor ? { anchor, screen: snap.screen } : null;
  };

  const chooseView = (preset: ViewPreset3D) => {
    setViewState(preset);
    viewportRef.current?.setViewPreset(preset);
  };

  const handleCameraKey = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (mode !== "3d" || event.repeat) return;
    const command = cameraCommandForKey(event.key);
    if (!command) return;
    event.preventDefault();
    if (command === "fit") viewportRef.current?.fitView();
    else if (command === "level") viewportRef.current?.levelView();
    else chooseView("iso");
  };

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): readonly [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const beginBoxSelection = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.focus();
    if (measurementEnabled && event.button === 0) { measureStartRef.current = canvasPoint(event); setSnapTarget(null); return; }
    if (selectionMode !== "box" || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    boxStartRef.current = point;
    setSelectionBox({ start: point, end: point });
  };

  const updateBoxSelection = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (measurementEnabled) {
      if (snapFrameRef.current !== null) cancelAnimationFrame(snapFrameRef.current);
      const point = canvasPoint(event);
      if (event.buttons !== 0) { setSnapTarget(null); return; }
      snapFrameRef.current = requestAnimationFrame(() => { snapFrameRef.current = null; setSnapTarget(snapAt(point)); });
      return;
    }
    const start = boxStartRef.current;
    if (!start || selectionMode !== "box") return;
    setSelectionBox({ start, end: canvasPoint(event) });
  };

  const finishBoxSelection = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (measurementEnabled) {
      const start = measureStartRef.current;
      measureStartRef.current = null;
      const point = canvasPoint(event);
      if (event.button === 0 && start && Math.hypot(point[0] - start[0], point[1] - start[1]) <= 6) {
        const target = snapAt(point);
        setSnapTarget(target);
        if (target) onMeasurementPick?.(target.anchor);
      }
      return;
    }
    const start = boxStartRef.current;
    if (!start || selectionMode !== "box") return;
    const end = canvasPoint(event);
    boxStartRef.current = null;
    setSelectionBox(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const ids = viewportRef.current?.pointIdsInScreenRect(normalizeSelectionRect(start, end)) ?? [];
    onBoxSelect?.(ids, event.shiftKey || event.metaKey || event.ctrlKey);
  };

  return (
    <div className="v2-viewport-frame">
      <PdfUnderlay documentView={cadUnderlayView ?? documentView} url={pdfUrl} visible={mode === "2d"} />
      <canvas
        ref={canvasRef}
        className="v2-canvas"
        aria-label={`Interaktivní ${mode === "2d" ? "2D" : "3D"} pohled modelu`}
        data-selection-mode={selectionMode}
        tabIndex={0}
        onKeyDown={handleCameraKey}
        onPointerDown={beginBoxSelection}
        onPointerMove={updateBoxSelection}
        onPointerUp={finishBoxSelection}
        onPointerLeave={() => { if (snapFrameRef.current !== null) cancelAnimationFrame(snapFrameRef.current); setSnapTarget(null); }}
        onWheel={() => setSnapTarget(null)}
        onPointerCancel={() => { measureStartRef.current = null; setSnapTarget(null); boxStartRef.current = null; setSelectionBox(null); }}
      />
      {measurementEnabled && snapTarget && <div data-measurement-snap={snapTarget.anchor.kind} aria-hidden="true" style={{ position: "absolute", pointerEvents: "none", zIndex: 4, left: snapTarget.screen[0], top: snapTarget.screen[1] }}>
        <span style={{ position: "absolute", width: 14, height: 14, left: -7, top: -7, border: "2px solid #f59e0b", borderRadius: snapTarget.anchor.kind === "edge" ? "50%" : 2, background: "#0f172a99", boxShadow: "0 0 0 1px #0f172a" }} />
        <span style={{ position: "absolute", left: 12, top: 12, maxWidth: 220, padding: "4px 8px", borderRadius: 4, background: "#0f172a", color: "#fff", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{snapTarget.anchor.properties.name}</span>
      </div>}
      {selectionBox ? <div
        className="v2-selection-box"
        aria-hidden="true"
        style={{
          left: Math.min(selectionBox.start[0], selectionBox.end[0]),
          top: Math.min(selectionBox.start[1], selectionBox.end[1]),
          width: Math.abs(selectionBox.end[0] - selectionBox.start[0]),
          height: Math.abs(selectionBox.end[1] - selectionBox.start[1]),
        }}
      /> : null}
      {roomLabel && <div className="v2-model-label" aria-hidden="true" hidden={mode !== "2d"}>
        <strong>{roomLabel.properties.number ?? roomLabel.properties.name ?? "Místnost"}</strong>
        <span>{roomLabel.properties.geometric_area_m2.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} m²</span>
      </div>}
      {civilAxisLabel && <div className="v2-model-label v2-model-label--civil" aria-hidden="true" hidden={mode !== "2d"}>
        <strong>{civilAxisLabel.properties.name}</strong>
        <span>staničení {civilAxisLabel.properties.start_station_m.toLocaleString("cs-CZ")}–{(civilAxisLabel.properties.start_station_m + civilAxisLabel.properties.length_m).toLocaleString("cs-CZ")} m</span>
      </div>}
      {mode === "3d" ? <div className="v2-view-controls" aria-label="Orientace 3D pohledu">
        <div className="v2-view-controls__buttons">
          {([['xy', 'Půdorys'], ['xz', 'Zepředu · jih'], ['yz', 'Zprava · východ'], ['iso', 'Izometrie']] as const).map(([preset, label]) => <button key={preset} type="button" className={viewState === preset ? "v2-view-control v2-view-control--active" : "v2-view-control"} aria-pressed={viewState === preset} aria-keyshortcuts={preset === "iso" ? "0" : undefined} title={preset === "iso" ? "Výchozí izometrie (0)" : `${label} · ortografický pohled`} onClick={() => chooseView(preset)}>{label}</button>)}
          <button type="button" className="v2-view-control" aria-keyshortcuts="F" title="Zobrazit celý model bez změny směru (F)" onClick={() => viewportRef.current?.fitView()}>Zarámovat · F</button>
          <button type="button" className="v2-view-control" aria-keyshortcuts="H Home" title="Odstranit náklon horizontu (H nebo Home)" onClick={() => viewportRef.current?.levelView()}>Srovnat horizont · H</button>
          {viewState === "free" ? <span className="v2-view-state" role="status">Volný pohled</span> : null}
        </div>
        <div className="v2-axis-legend" aria-label="Barvy os"><span><i className="v2-axis-legend__x" />X · východ</span><span><i className="v2-axis-legend__y" />Y · sever</span><span><i className="v2-axis-legend__z" />Z · výška</span></div>
        <p>Levé tažení: orbit se stabilním horizontem · pravé: posun · dvojklik: nový střed · kolečko: přiblížení · 0: izometrie</p>
      </div> : null}
      {!objects.length ? <div className="v2-canvas-empty" role="status"><strong>Model je zatím prázdný</strong><span>Vraťte se do souborů projektu, vytěžte podklad a potvrďte objekty.</span></div> : null}
      {loadError ? <p className="v2-renderer-error" role="alert">{loadError}</p> : null}
    </div>
  );
}
