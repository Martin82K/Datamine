import { DrawingUnderlayDialog } from "./DrawingUnderlayDialog";
import { drawingAnchorsChanged, restoreDrawingUnderlay, storedDrawingUnderlay, type DrawingUnderlay } from "./drawing-underlay";
import { WorkspaceGate } from "./WorkspaceGate";
import { findProject, saveProject } from "./project-repository";
import { isServerProject } from "./project-api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  EditorStore,
  InvalidCommandError,
  updateRoomVertex,
  type EditorState,
} from "@datamine/editor-core";
import type {
  BuildingObject,
  CivilAxisObject,
  CivilMaterialLayerObject,
  CivilPointObject,
  CivilProfileObject,
  CivilSweepObject,
  ModelObject,
  ModelVersionCommand,
  RoomObject,
  StakeoutGroupObject,
  StakeoutPointObject,
  TinSurfaceObject,
} from "@datamine/contracts";
import {
  buildCivilSweep,
  createCivilPointOnAxis,
  createCivilMaterialLayerFromSurface,
  createCivilSlopeSurface,
  createCivilTinSurfaceFromPoints,
  civilSlopeElevationDifference,
  civilTinSurfaceAreas,
  createManualCivilPoint,
  densifyCivilSegment,
  interpolateSurveyPointCoordinates,
  selectCivilPointsAlongAxis,
  selectCivilPointsAlongLine,
  selectCivilPointsAlongSegment,
  selectCivilPointsInSeries,
  suggestCivilTinMaximumEdgeLength,
  type CivilPointRouteMatch,
  type CivilSlopeSide,
  type CivilSlopeUnit,
} from "@datamine/modules";
import type { ViewMode } from "@datamine/renderer";
import { demoBuildingObjects, demoCadUnderlayView, demoCivilObjects, demoDocumentView, demoRoom, demoStakeoutObjects } from "./demo-model";
import { EditorViewport } from "./EditorViewport";
import { CivilWorkbenchToolbar } from "./CivilWorkbenchToolbar";
import { CivilMeasurementPanel } from "./CivilMeasurementPanel";
import { CivilMapPanel } from "./CivilMapPanel";
import { isSurveyTerrain, MAP_LAYERS, restoreMapContext, storedMapContext, type MapContext } from "./civil-map";
import { CivilSectionPanel } from "./CivilSectionPanel";
import { CivilAssemblyPanel, ASSEMBLY_COLORS } from "./CivilAssemblyPanel";
import { TinConstraintsEditor } from "./TinConstraintsEditor";
import { emptyTinConstraints, parseTinConstraints } from "./tin-constraints";
import { pointMeasurementAnchor, appendMeasurementAnchor, refreshMeasurementAnchors, type MeasurementAnchor } from "./civil-measurement";
import { civilWorkbenchSummary, civilObjectLabels, reviewStateLabels } from "./civil-workbench";
import { ProjectHub } from "./ProjectHub";
import { ProjectWorkspace } from "./ProjectWorkspace";
import { BrandHomeLink } from "./BrandHomeLink";
import { ThemeToggle } from "./ThemeToggle";
import {
  localProjectIdFromLocation,
  updateLocalProject,
  type LocalProject,
} from "./local-projects";
import { getProjectFile } from "./project-files";
import { groupProjectLayers, prepareLayerRename, type ProjectLayer } from "./project-layers";
import { createCivilModelDxf, createSurveyPointsCsv, createTinVerticesCsv, safeSurveyExportStem } from "./survey-exports";
import { defaultLayerColors, readHiddenLayerIds, readLayerColors, readLayerNames, readLayerOpacities, setLayerColor, setLayerName, setLayerOpacity, setLayerVisibility } from "./layer-colors";
import { readTriangulationVisibility, setTriangulationVisibility } from "./layer-colors";
import {
  copyVector,
  createAxisFromSelectedPoints,
  safeManualLayerId,
  transformedPointCopies,
  type CopyDirection,
} from "./civil-editing";
import {
  PROJECT_TYPE_LABELS,
  inferProjectType,
  isProjectType,
  modelMatchesProjectType,
  objectBelongsToProjectType,
  projectTypeFromLocation,
  type ProjectType,
} from "./project-context";
import { applyAppTheme, readAppTheme, writeAppTheme, type AppTheme } from "./app-theme";
import { WelcomeScreen } from "./WelcomeScreen";
import { localOnly } from "./runtime-mode";
import {
  ModelApiError,
  commandsForChanges,
  documentContentUrl,
  loadModel,
  routeFromLocation,
  saveWorkingModel,
  scopedDocumentContentUrl,
  validateWorkingModel,
  type LoadedModel,
} from "./model-api";

type ConnectionState = "demo" | "loading" | "ready" | "saving" | "validating" | "error";
type EditorPane = "canvas" | "data" | "3d";
type SelectionAction = "axis" | "layer" | "copy" | "slope";

interface SlopeSourceSnapshot {
  readonly previewId: string;
  readonly label: string;
  readonly points: readonly (readonly [number, number, number])[];
  readonly crs: CivilAxisObject["properties"]["crs"];
  readonly sourceDocumentId: string;
  readonly sourceDocumentSha256: string;
}

const MAX_INTERACTIVE_VERTICES = 500;
const MAX_REVIEW_CANDIDATES = 500;
const commandId = () => `command_${crypto.randomUUID().replaceAll("-", "")}`;
const objectsEqual = (left: readonly unknown[], right: readonly unknown[]) => (
  JSON.stringify(left) === JSON.stringify(right)
);

const downloadText = (content: string, filename: string, mediaType: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

interface EditorAppProps {
  readonly theme: AppTheme;
  readonly onThemeChange: (theme: AppTheme) => void;
}

function EditorApp({ theme, onThemeChange }: EditorAppProps) {
  const requestedProjectType = useMemo(() => projectTypeFromLocation(window.location), []);
  const localProjectId = useMemo(() => localProjectIdFromLocation(window.location), []);
  const initialLocalProject = useMemo(() => (
    localProjectId ? findProject(localProjectId) : null
  ), [localProjectId]);
  const routeResult = useMemo(() => {
    if (localOnly) return { route: null, error: null };
    try {
      return { route: routeFromLocation(window.location), error: null };
    } catch (error) {
      return {
        route: null,
        error: error instanceof Error ? error.message : "URL editoru není platná.",
      };
    }
  }, []);
  const demoObjects = useMemo(() => initialLocalProject?.objects ?? (
    [demoRoom, ...demoBuildingObjects, ...demoCivilObjects, ...demoStakeoutObjects]
      .filter((object) => objectBelongsToProjectType(object, requestedProjectType))
  ), [initialLocalProject, requestedProjectType]);
  const store = useRef(new EditorStore(demoObjects, 15));
  const [state, setState] = useState<EditorState>(store.current.snapshot);
  const materialFormRef = useRef<HTMLDivElement>(null);
  const [layerSearch, setLayerSearch] = useState("");
  const [measuring, setMeasuring] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [drawingUnderlay, setDrawingUnderlay] = useState<DrawingUnderlay | null>(null);
  const [drawingRestoring, setDrawingRestoring] = useState(!!initialLocalProject?.drawing_underlay);
  const drawingChanged = useRef(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapContext, setMapContext] = useState<MapContext | null>(null);
  const [mapRestoring, setMapRestoring] = useState(!!initialLocalProject?.map_context);
  const [measurementAnchors, setMeasurementAnchors] = useState<readonly MeasurementAnchor[]>([]);
  const measurementRevision = useRef(state.revision);
  useEffect(() => {
    if (measurementRevision.current !== state.revision) {
      measurementRevision.current = state.revision;
      setMeasurementAnchors([]);
    }
  }, [state.revision]);
  const workbenchSummary = useMemo(() => civilWorkbenchSummary(state.objects), [state.objects]);
  const [loaded, setLoaded] = useState<LoadedModel | null>(null);
  const [localProject, setLocalProject] = useState<LocalProject | null>(initialLocalProject);
  const [connection, setConnection] = useState<ConnectionState>(
    routeResult.error ? "error" : routeResult.route ? "loading" : localProjectId && !initialLocalProject ? "error" : initialLocalProject ? "ready" : "demo",
  );
  const [message, setMessage] = useState<string | null>(routeResult.error ?? (localProjectId && !initialLocalProject ? "Lokální projekt nebyl nalezen." : null));
  const [editorPane, setEditorPane] = useState<EditorPane>(() => new URLSearchParams(window.location.search).get("view") === "3d" ? "3d" : "canvas");
  const [tool, setTool] = useState<"select" | "box-select" | "polygon">("select");
  const [previewSweep, setPreviewSweep] = useState<CivilSweepObject | null>(null);
  const [previewSurface, setPreviewSurface] = useState<TinSurfaceObject | null>(null);
  const [previewMaterialLayer, setPreviewMaterialLayer] = useState<CivilMaterialLayerObject | null>(null);
  const [assemblyDraft, setAssemblyDraft] = useState<{ surface: TinSurfaceObject; existing: readonly CivilMaterialLayerObject[]; revision: number } | null>(null);
  const [assemblyPreview, setAssemblyPreview] = useState<readonly CivilMaterialLayerObject[]>([]);
  const [projectType, setProjectType] = useState<ProjectType>(requestedProjectType);
  const initialLayerColorScope = initialLocalProject?.id ?? `demo:${requestedProjectType}`;
  const viewGeneration = useRef(0);
  const markViewDirty = () => { viewGeneration.current += 1; setViewSettingsDirty(true); };
  const [viewSettingsDirty, setViewSettingsDirty] = useState(false);
  useEffect(() => {
    const saved = initialLocalProject?.map_context;
    if (!saved) return;
    let active = true;
    void restoreMapContext(saved).then((context) => {
      if (active) setMapContext(context);
    }).catch(() => {
      if (active) setMessage("Uložený obrázek mapy nelze obnovit. Otevřete Mapa a terén a načtěte nový podklad.");
    }).finally(() => { if (active) setMapRestoring(false); });
    return () => { active = false; };
  }, [initialLocalProject]);
  useEffect(() => {
    const saved = initialLocalProject?.drawing_underlay;
    if (!saved) return;
    let active = true;
    void restoreDrawingUnderlay(saved).then((drawing) => { if (active) setDrawingUnderlay(drawing); })
      .catch(() => { if (active) setMessage("Uloženou situaci nelze obnovit. Otevřete Připnout situaci a načtěte ji znovu."); })
      .finally(() => { if (active) setDrawingRestoring(false); });
    return () => { active = false; };
  }, [initialLocalProject]);
  const changeDrawingUnderlay = (drawing: DrawingUnderlay | null) => {
    drawingChanged.current = true;
    setDrawingUnderlay(drawing);
    markViewDirty();
    setMessage(drawing ? "Situace byla připnuta. Změnu potvrďte tlačítkem Uložit projekt." : "Připnutí bylo odebráno. Změnu potvrďte tlačítkem Uložit projekt.");
  };
  const mapChanged = useRef(false);
  const changeMapContext = (context: MapContext | null) => {
    mapChanged.current = true;
    setMapContext(context);
    markViewDirty();
  };

  const [showTriangulation, setShowTriangulation] = useState(() => readTriangulationVisibility(window.localStorage, initialLayerColorScope));
  const [layerColors, setLayerColors] = useState<Readonly<Record<string, string>>>(() => (
    readLayerColors(window.localStorage, initialLayerColorScope)
  ));
  const [layerOpacities, setLayerOpacities] = useState<Readonly<Record<string, number>>>(() => (
    readLayerOpacities(window.localStorage, initialLayerColorScope)
  ));
  const [hiddenLayerIds, setHiddenLayerIds] = useState<readonly string[]>(() => (
    readHiddenLayerIds(window.localStorage, initialLayerColorScope)
  ));
  const [layerNames, setLayerNames] = useState<Readonly<Record<string, string>>>(() => (
    readLayerNames(window.localStorage, initialLayerColorScope)
  ));
  const [layerContextMenu, setLayerContextMenu] = useState<{ layerId: string; x: number; y: number } | null>(null);
  const [layerContextName, setLayerContextName] = useState("");
  const [civilPointPanel, setCivilPointPanel] = useState<"coordinates" | "axis" | "densify" | "select-segment" | "select-line" | "select-series" | "select-axis" | null>(null);
  const [pointName, setPointName] = useState("Nový bod");
  const [pointCoordinates, setPointCoordinates] = useState({ e: "1005", n: "2001", z: "250.5" });
  const [axisPoint, setAxisPoint] = useState({ station: "5", offset: "0", elevationOffset: "0" });
  const [densifyCount, setDensifyCount] = useState("1");
  const [routeTolerance, setRouteTolerance] = useState("0.5");
  const [routeAxisId, setRouteAxisId] = useState("");
  const [routeStationRange, setRouteStationRange] = useState({ start: "", end: "" });
  const [routeMatches, setRouteMatches] = useState<readonly CivilPointRouteMatch[]>([]);
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [selectionLayerName, setSelectionLayerName] = useState("Nová vrstva bodů");
  const [selectionAxisName, setSelectionAxisName] = useState("Nová osa");
  const [copyInput, setCopyInput] = useState<{ direction: CopyDirection; distance: string; angle: string }>({ direction: "selection", distance: "1", angle: "0" });
  const [copySourceIds, setCopySourceIds] = useState<readonly string[]>([]);
  const copyCommitPendingRef = useRef(false);
  const [slopeSource, setSlopeSource] = useState<SlopeSourceSnapshot | null>(null);
  const slopeCommitPendingRef = useRef(false);
  const [slopeInput, setSlopeInput] = useState<{
    name: string; side: CivilSlopeSide; width: string; unit: CivilSlopeUnit; value: string;
  }>({ name: "Šikmá plocha", side: "left", width: "3", unit: "percent", value: "2" });
  const [tinMaximumEdgeLength, setTinMaximumEdgeLength] = useState("");
  const [tinSourcePoints, setTinSourcePoints] = useState<readonly (CivilPointObject | StakeoutPointObject)[]>([]);
  const [tinConstraints, setTinConstraints] = useState(emptyTinConstraints);
  const [tinPreviewDirty, setTinPreviewDirty] = useState(false);
  const tinDraftOpen = tinSourcePoints.length > 0;
  const tinSourceRevision = useRef(state.revision);
  useEffect(() => {
    if (tinDraftOpen && tinSourceRevision.current !== state.revision) {
      setPreviewSurface(null); setTinSourcePoints([]); setTinPreviewDirty(true);
      setMessage("Model se změnil; vyberte aktuální body a otevřete nový náhled TIN.");
    }
  }, [state.revision, tinDraftOpen]);
  const [materialLayerInput, setMaterialLayerInput] = useState({ name: "Konstrukční vrstva", code: "VRSTVA_01", thickness: "0.3" });
  const [layerDeleteConfirmation, setLayerDeleteConfirmation] = useState<string | null>(null);
  const [objectDeleteConfirmation, setObjectDeleteConfirmation] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [localPdfUrl, setLocalPdfUrl] = useState<string | undefined>();
  const viewMode: ViewMode = editorPane === "3d" ? "3d" : "2d";
  const layerColorScope = localProject?.id
    ?? (loaded ? `server:${loaded.model.project_id}:${loaded.model.document_id}` : `demo:${projectType}`);

  useEffect(() => {
    setLayerColors(readLayerColors(window.localStorage, layerColorScope));
    setLayerOpacities(readLayerOpacities(window.localStorage, layerColorScope));
    setHiddenLayerIds(readHiddenLayerIds(window.localStorage, layerColorScope));
    setLayerNames(readLayerNames(window.localStorage, layerColorScope));
    setShowTriangulation(readTriangulationVisibility(window.localStorage, layerColorScope));
  }, [layerColorScope]);

  useEffect(() => {
    if (!layerContextMenu) return;
    const close = () => setLayerContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [layerContextMenu]);

  useEffect(() => {
    const pdf = initialLocalProject?.files.find((file) => file.media_type === "application/pdf" || file.name.toLocaleLowerCase("en-US").endsWith(".pdf"));
    if (!initialLocalProject || !pdf) { setLocalPdfUrl(undefined); return; }
    let active = true;
    let objectUrl: string | undefined;
    void getProjectFile(initialLocalProject.id, pdf).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setLocalPdfUrl(objectUrl);
    }, () => { if (active) setMessage(`PDF podklad ${pdf.name} nelze načíst z projektového úložiště.`); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [initialLocalProject]);

  useEffect(() => {
    if (!routeResult.route) return;
    const controller = new AbortController();
    void loadModel(routeResult.route, controller.signal).then(
      (result) => {
        const resolvedProjectType = inferProjectType(result.model.objects, requestedProjectType);
        if (!modelMatchesProjectType(result.model.objects, resolvedProjectType)) {
          setConnection("error");
          setMessage("Server vrátil model se smíšenými doménami. Editor jej z bezpečnostních důvodů neotevřel.");
          return;
        }
        store.current = new EditorStore(result.model.objects, 15);
        setState(store.current.snapshot);
        setLoaded(result);
        setProjectType(resolvedProjectType);
        setConnection("ready");
        setMessage("Modelová verze byla bezpečně načtena.");
      },
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setConnection("error");
          setMessage(error instanceof ModelApiError ? error.message : "Model nelze načíst.");
        }
      },
    );
    return () => controller.abort();
  }, [routeResult.route]);

  const selectedId = state.selection[0];
  const selected = state.objects.find((object) => object.id === selectedId);
  const selectedCivilPoints = state.selection.map((id) => state.objects.find((object) => object.id === id))
    .filter((object): object is CivilPointObject => object?.type === "civil.point");
  const selectedSurveyPoints = state.selection.map((id) => state.objects.find((object) => object.id === id))
    .filter((object): object is CivilPointObject | StakeoutPointObject => object?.type === "civil.point" || object?.type === "stakeout.point");
  const selectedAxes = state.selection.map((id) => state.objects.find((object) => object.id === id))
    .filter((object): object is CivilAxisObject => object?.type === "civil.axis");
  const selectedAxis = selectedAxes.length === 1 && selectedSurveyPoints.length === 0 ? selectedAxes[0]! : null;
  const canCreateSlopeSurface = Boolean(selectedAxis || selectedSurveyPoints.length === 2);
  const copySourcePoints = copySourceIds.map((id) => state.objects.find((object) => object.id === id))
    .filter((object): object is CivilPointObject | StakeoutPointObject => object?.type === "civil.point" || object?.type === "stakeout.point");
  const slopePreview = useMemo(() => {
    if (!slopeSource || selectionAction !== "slope") {
      return { surface: null as TinSurfaceObject | null, elevationDifferenceM: null as number | null, error: null as string | null };
    }
    try {
      const widthM = Number(slopeInput.width);
      const elevationDifferenceM = civilSlopeElevationDifference(widthM, slopeInput.unit, Number(slopeInput.value));
      const surface = createCivilSlopeSurface(slopeSource.points, slopeSource.crs, {
        objectId: slopeSource.previewId,
        layerId: safeManualLayerId(slopeInput.name),
        name: slopeInput.name,
        sourceDocumentId: slopeSource.sourceDocumentId,
        sourceDocumentSha256: slopeSource.sourceDocumentSha256,
        algorithmVersion: "civil-slope-strip-v1",
        widthM,
        elevationDifferenceM,
        side: slopeInput.side,
      });
      return { surface, elevationDifferenceM, error: null };
    } catch (error) {
      return {
        surface: null as TinSurfaceObject | null,
        elevationDifferenceM: null as number | null,
        error: error instanceof Error ? error.message : "Náhled šikmé plochy nelze vytvořit.",
      };
    }
  }, [selectionAction, slopeSource, slopeInput.name, slopeInput.side, slopeInput.width, slopeInput.unit, slopeInput.value]);
  const polygonEditable = Boolean(
    selected?.type === "rooms.room"
    && (selected.geometry.rings[0]?.length ?? 0) <= MAX_INTERACTIVE_VERTICES,
  );
  const dirty = viewSettingsDirty || (loaded ? !objectsEqual(loaded.model.objects, state.objects)
    : localProject ? !objectsEqual(localProject.objects, state.objects) : false);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty || connection === "saving") { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty, connection]);
  const documentView = loaded?.model.document_view ?? demoDocumentView;
  const cadUnderlayView = loaded?.model.cad_underlay_view
    ?? (loaded || localProject || projectType === "building" ? undefined : demoCadUnderlayView);
  const pdfUrl = loaded
    ? cadUnderlayView
      ? scopedDocumentContentUrl(loaded.model.project_id, cadUnderlayView.source_document_id)
      : documentContentUrl(loaded.model)
    : localProject
      ? projectType === "building" ? localPdfUrl : undefined
      : localPdfUrl ?? (import.meta.env.DEV ? import.meta.env.VITE_DATAMINE_DEMO_PDF_URL : undefined);

  const selectObject = (objectId: string | null, additive = false) => {
    if (measuring || sectionOpen) {
      const point = state.objects.find((object): object is CivilPointObject | StakeoutPointObject => object.id === objectId && (object.type === "civil.point" || object.type === "stakeout.point"));
      if (!point || hiddenLayerIds.includes(point.layer_id)) { setMessage(sectionOpen ? "Pro řez vyberte bod, vrchol nebo hranu v modelu či bod ze seznamu v panelu řezu." : "Pro měření klikněte na existující bod nebo jej vyberte v panelu měření."); return; }
      setMeasurementAnchors((current) => appendMeasurementAnchor(current, pointMeasurementAnchor(point)));
      setMessage(sectionOpen ? "Řez používá aktuální polohu A–B v XY a všechny výšky viditelných ploch." : "Měření používá přesné souřadnice vybraných bodů modelu.");
      return;
    }
    const known = objectId && state.objects.some((object) => object.id === objectId);
    const objectIds = !known ? (additive ? state.selection : [])
      : additive
        ? state.selection.includes(objectId) ? state.selection.filter((id) => id !== objectId) : [...state.selection, objectId]
        : [objectId];
    setState(store.current.setSelection(objectIds));
    if (!objectId) setTool("select");
  };

  const civilPointBase = (objectId: string, name: string) => {
    const source = state.objects.find((object): object is CivilAxisObject => object.type === "civil.axis");
    if (!source) throw new TypeError("Projekt musí mít osu s definovaným CRS a zdrojovým dokumentem.");
    return {
      objectId, layerId: "layer_points", name,
      sourceDocumentId: source.provenance.source_document_id,
      sourceDocumentSha256: source.provenance.source_document_sha256,
      algorithmVersion: "civil-point-tools-v1",
    } as const;
  };

  const commitCivilPoints = (points: readonly CivilPointObject[]) => {
    applyObjects(points);
    setCivilPointPanel(null);
  };

  const openPointCreation = () => {
    const reference = selectedSurveyPoints[0] ?? state.objects.find(
      (object): object is CivilPointObject | StakeoutPointObject => object.type === "civil.point" || object.type === "stakeout.point",
    );
    if (reference) {
      const [e, n, z] = reference.geometry.point;
      setPointCoordinates({ e: String(e), n: String(n), z: String(z) });
    }
    setRouteMatches([]);
    setCivilPointPanel(["coordinates", "axis", "densify"].includes(civilPointPanel ?? "") ? null : "coordinates");
  };

  const addCivilPointByCoordinates = () => {
    const axis = state.objects.find((object): object is CivilAxisObject => object.type === "civil.axis");
    const stakeoutTemplate = state.objects.find((object): object is StakeoutPointObject => object.type === "stakeout.point");
    if (!axis && !stakeoutTemplate) { setMessage("Nový bod vyžaduje model s definovaným souřadnicovým systémem."); return; }
    try {
      const coordinates = [Number(pointCoordinates.e), Number(pointCoordinates.n), Number(pointCoordinates.z)] as const;
      if (!coordinates.every(Number.isFinite)) throw new TypeError("Souřadnice musí být konečná čísla.");
      if (!axis && stakeoutTemplate) {
        const sequence = stakeoutPointsCount + 1;
        const code = `P${String(sequence).padStart(3, "0")}`;
        const point: StakeoutPointObject = {
          schema_version: "datamine.stakeout-point.v1",
          id: `object_stakeout_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
          type: "stakeout.point",
          layer_id: stakeoutTemplate.layer_id,
          geometry: { kind: "point3d", coordinate_space: "survey_crs", point: [...coordinates] },
          properties: {
            schema_version: "datamine.stakeout-point-properties.v1",
            name: pointName.trim() || `Vytyčovací bod ${code}`,
            code,
            crs: stakeoutTemplate.properties.crs,
            derivation: { kind: "manual" },
            coordinate_tolerance_m: 0.001,
            accuracy: { horizontal_m: 0.02, vertical_m: 0.03, method: "manual" },
            review_state: "unreviewed",
          },
          provenance: {
            source_document_id: stakeoutTemplate.provenance.source_document_id,
            source_document_sha256: stakeoutTemplate.provenance.source_document_sha256,
            source_kind: "manual",
            algorithm_version: "stakeout-manual-coordinates-v1",
          },
        };
        applyObject(point);
        setState(store.current.setSelection([point.id]));
        setCivilPointPanel(null);
        setMessage("Vytyčovací bod byl přidán podle souřadnic.");
        return;
      }
      const id = `object_civil_point_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
      commitCivilPoints([createManualCivilPoint(
        [...coordinates],
        axis!.properties.crs, civilPointBase(id, pointName),
      )]);
      setMessage("Bod byl přidán do pracovní verze.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bod nelze vytvořit."); }
  };

  const addCivilPointOnAxis = () => {
    const axis = state.objects.find((object): object is CivilAxisObject => object.type === "civil.axis");
    if (!axis) { setMessage("Bod na ose vyžaduje vybranou osu."); return; }
    try {
      const station = axis.properties.start_station_m + Number(axisPoint.station);
      const id = `object_civil_point_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
      commitCivilPoints([createCivilPointOnAxis(axis, station, Number(axisPoint.offset), Number(axisPoint.elevationOffset), civilPointBase(id, pointName))]);
      setMessage("Bod na ose byl přidán do pracovní verze.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bod na ose nelze vytvořit."); }
  };

  const densifySelectedCivilPoints = () => {
    if (selectedSurveyPoints.length !== 2) { setMessage("Pro zhuštění vyberte přesně dva body pomocí Shift + kliknutí."); return; }
    try {
      if (selectedSurveyPoints.every((point): point is CivilPointObject => point.type === "civil.point")) {
        const points = densifyCivilSegment(selectedSurveyPoints[0]!, selectedSurveyPoints[1]!, { internalPointCount: Number(densifyCount) }, (index) => {
          const id = `object_civil_point_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
          return civilPointBase(id, `${pointName} ${index + 1}`);
        });
        commitCivilPoints(points);
        setMessage(`Úsek byl zhuštěn o ${points.length} bodů.`);
        return;
      }
      if (!selectedSurveyPoints.every((point): point is StakeoutPointObject => point.type === "stakeout.point")) {
        throw new TypeError("Zhuštění nelze provést mezi různými typy bodů.");
      }
      const start = selectedSurveyPoints[0]!;
      const end = selectedSurveyPoints[1]!;
      if (start.properties.crs.epsg !== end.properties.crs.epsg
        || start.properties.crs.vertical_datum !== end.properties.crs.vertical_datum) {
        throw new TypeError("Body nemají shodné CRS.");
      }
      const count = Number(densifyCount);
      if (!Number.isInteger(count) || count < 1 || count > 10_000) {
        throw new RangeError("Počet nových bodů musí být od 1 do 10 000.");
      }
      const length = Math.hypot(...start.geometry.point.map((coordinate, index) => end.geometry.point[index]! - coordinate));
      if (!Number.isFinite(length) || length <= 1e-9) throw new TypeError("Nelze zhustit degenerovaný úsek.");
      const points = Array.from({ length: count }, (_, index): StakeoutPointObject => {
        const ratio = (index + 1) / (count + 1);
        const sequence = stakeoutPointsCount + index + 1;
        const code = `P${String(sequence).padStart(3, "0")}`;
        return {
          schema_version: "datamine.stakeout-point.v1",
          id: `object_stakeout_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
          type: "stakeout.point",
          layer_id: start.layer_id,
          geometry: {
            kind: "point3d",
            coordinate_space: "survey_crs",
            point: [...interpolateSurveyPointCoordinates(start, end, ratio)],
          },
          properties: {
            schema_version: "datamine.stakeout-point-properties.v1",
            name: `${pointName.trim() || "Zhuštěný bod"} ${index + 1}`,
            code,
            crs: structuredClone(start.properties.crs),
            derivation: { kind: "manual" },
            coordinate_tolerance_m: Math.max(start.properties.coordinate_tolerance_m, end.properties.coordinate_tolerance_m),
            accuracy: {
              horizontal_m: Math.max(start.properties.accuracy.horizontal_m, end.properties.accuracy.horizontal_m),
              vertical_m: Math.max(start.properties.accuracy.vertical_m, end.properties.accuracy.vertical_m),
              method: "derived",
            },
            review_state: "unreviewed",
          },
          provenance: {
            source_document_id: start.provenance.source_document_id,
            source_document_sha256: start.provenance.source_document_sha256,
            source_kind: "manual",
            algorithm_version: "stakeout-segment-interpolation-v1",
          },
        };
      });
      applyObjects(points);
      setCivilPointPanel(null);
      setMessage(`Úsek byl zhuštěn o ${points.length} bodů.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Úsek nelze zhustit."); }
  };

  const createSurfacePreview = () => {
    const points = tinDraftOpen ? tinSourcePoints : selectedSurveyPoints;
    const draft = tinDraftOpen ? tinConstraints : emptyTinConstraints();
    if (points.length < 3) { setMessage("Triangulace vyžaduje nejméně tři vybrané body."); return; }
    if (tinDraftOpen && tinSourceRevision.current !== state.revision) { setMessage("Zdrojový model se změnil. Otevřete nový náhled TIN."); return; }
    if (!tinDraftOpen) {
      setTinSourcePoints(points); setTinConstraints(draft); setTinMaximumEdgeLength("");
      tinSourceRevision.current = state.revision;
    }
    try {
      const constraints = parseTinConstraints(draft, points.length);
      const constrained = Object.keys(constraints).length > 0;
      const edgeText = tinDraftOpen ? tinMaximumEdgeLength : "";
      const maximumEdgeLengthM = edgeText.trim() ? Number(edgeText)
        : constrained ? undefined : suggestCivilTinMaximumEdgeLength(points);
      const source = points[0]!;
      const selectedLayer = points.every((point) => point.layer_id === source.layer_id)
        ? groupProjectLayers(points)[0]?.name : null;
      const surfaceName = selectedLayer ? `TIN – ${selectedLayer}`.slice(0, 200)
        : `TIN plocha ${state.objects.filter((object) => object.type === "civil.tin_surface").length + 1}`;
      const surface = createCivilTinSurfaceFromPoints(points, {
        objectId: `object_civil_surface_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`,
        layerId: safeManualLayerId(surfaceName), name: surfaceName,
        sourceDocumentId: source.provenance.source_document_id,
        sourceDocumentSha256: source.provenance.source_document_sha256,
        ...(source.provenance.source_job_id ? { sourceJobId: source.provenance.source_job_id } : {}),
        ...constraints, ...(maximumEdgeLengthM !== undefined ? { maximumEdgeLengthM } : {}),
      });
      setTinSourcePoints(points); setTinConstraints(draft); setTinPreviewDirty(false);
      setPreviewSurface(surface);
      setTinMaximumEdgeLength(maximumEdgeLengthM?.toFixed(3) ?? "");
      const coincidentCount = points.length - new Set(points.map((point) => point.geometry.point.join(":"))).size;
      setMessage(`Náhled TIN: ${surface.geometry.faces.length} trojúhelníků. ${coincidentCount ? `Shodné XYZ sloučeny pro výpočet: ${coincidentCount}. Zdrojové body zůstaly zachované. ` : ""}${constrained ? "Obvod, otvory a povinné hrany byly ověřeny." : "Delší hrany byly vyloučeny podle limitu."}`);
    } catch (error) { setTinPreviewDirty(true); setMessage(error instanceof Error ? error.message : "Plochu nelze vytvořit."); }
  };

  const commitSurfacePreview = () => {
    if (!previewSurface || tinPreviewDirty || tinSourceRevision.current !== store.current.snapshot.revision) return;
    applyObject(previewSurface);
    setState(store.current.setSelection([previewSurface.id]));
    setPreviewSurface(null); setTinSourcePoints([]);
  };

  const createMaterialLayerPreview = () => {
    if (!selected || selected.type !== "civil.tin_surface") { setMessage("Nejprve vyberte horní TIN povrch."); return; }
    try {
      const id = `object_civil_material_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
      const base = {
        objectId: id,
        layerId: safeManualLayerId(materialLayerInput.name),
        name: materialLayerInput.name,
        sourceDocumentId: selected.provenance.source_document_id,
        sourceDocumentSha256: selected.provenance.source_document_sha256,
        algorithmVersion: "civil-material-layer-v1",
      };
      const layer = createCivilMaterialLayerFromSurface(selected, {
        ...base,
        materialCode: materialLayerInput.code,
        thicknessM: Number(materialLayerInput.thickness),
      });
      setPreviewMaterialLayer(layer);
      setMessage(`Náhled vrstvy: ${layer.geometry.faces.length} trojúhelníků, objem ${layer.properties.volume_m3.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m³.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Vrstvu nelze vytvořit."); }
  };

  const closeAssembly = () => { setAssemblyDraft(null); setAssemblyPreview([]); };
  const openAssembly = () => {
    const assemblyId = selected?.type === "civil.material_layer" ? selected.properties.derivation.assembly?.id : undefined;
    const surface = selected?.type === "civil.tin_surface" ? selected : selected?.type === "civil.material_layer"
      ? state.objects.find((object): object is TinSurfaceObject => object.type === "civil.tin_surface" && object.id === selected.properties.derivation.top_surface_id) : undefined;
    if (!surface) { setMessage("Nejprve vyberte horní TIN nebo vrstvu existující skladby."); return; }
    const existing = assemblyId ? state.objects.filter((object): object is CivilMaterialLayerObject => object.type === "civil.material_layer" && object.properties.derivation.assembly?.id === assemblyId)
      .sort((a, b) => a.properties.derivation.assembly!.order - b.properties.derivation.assembly!.order) : [];
    setAssemblyDraft({ surface: structuredClone(surface), existing: structuredClone(existing), revision: state.revision });
    setAssemblyPreview([]); setCivilPointPanel(null); setMeasuring(false); setSectionOpen(false); setEditorPane("3d"); setFocusMode(false);
  };
  const previewAssembly = (layers: readonly CivilMaterialLayerObject[]) => {
    if (layers.length) {
      const remaining = state.objects.filter((object) => !assemblyDraft?.existing.some((old) => old.id === object.id));
      const all = [...remaining, ...layers];
      const count = all.reduce((sum, object) => sum + (object.type === "civil.point" || object.type === "stakeout.point" ? 1
        : "geometry" in object && "vertices" in object.geometry ? object.geometry.vertices.length : "geometry" in object && "points" in object.geometry ? object.geometry.points.length : 0), 0);
      if (count > 100_000 || civilWorkbenchSummary(all).faces > 200_000) throw new RangeError("Model se skladbou by překročil limit 100 000 vrcholů nebo 200 000 trojúhelníků.");
    }
    setAssemblyPreview(layers);
  };
  const commitAssembly = (layers: readonly CivilMaterialLayerObject[], hideSource: boolean) => {
    if (!assemblyDraft || assemblyDraft.revision !== store.current.snapshot.revision) throw new Error("Model se během přípravy změnil. Zavřete skladbu a otevřete ji znovu.");
    const baseRevision = store.current.snapshot.revision;
    const removed = assemblyDraft.existing.filter((old) => !layers.some((layer) => layer.id === old.id));
    setState(store.current.executeBatch([
      ...removed.map((old) => ({ id: commandId(), type: "object.remove" as const, baseRevision, objectId: old.id })),
      ...layers.map((object) => ({ id: commandId(), type: "object.upsert" as const, baseRevision, object })),
    ]));
    layers.forEach((layer, index) => {
      if (!layerColors[layer.layer_id]) changeProjectLayerColor(layer.layer_id, ASSEMBLY_COLORS[index % ASSEMBLY_COLORS.length]!);
      if (layerOpacities[layer.layer_id] === undefined) changeProjectLayerOpacity(layer.layer_id, 1);
    });
    if (hideSource) {
      setHiddenLayerIds(setLayerVisibility(window.localStorage, layerColorScope, assemblyDraft.surface.layer_id, false));
      if (localProject) markViewDirty();
    }
    setState(store.current.setSelection(layers.map((layer) => layer.id)));
    closeAssembly(); setMessage(`Skladba uložena: ${layers.length} navazujících objemových vrstev. Projekt uložte tlačítkem nahoře.`);
  };

  const commitMaterialLayerPreview = () => {
    if (!previewMaterialLayer) return;
    applyObject(previewMaterialLayer);
    setState(store.current.setSelection([previewMaterialLayer.id]));
    setPreviewMaterialLayer(null);
  };

  const openRouteSelection = () => {
    const axis = state.objects.find((object): object is CivilAxisObject => object.type === "civil.axis");
    if (axis && !routeAxisId) {
      setRouteAxisId(axis.id);
      setRouteStationRange({
        start: String(axis.properties.start_station_m),
        end: String(axis.properties.start_station_m + axis.properties.length_m),
      });
    }
    setRouteMatches([]);
    setCivilPointPanel(["select-segment", "select-line", "select-series", "select-axis"].includes(civilPointPanel ?? "") ? null : "select-segment");
  };

  const previewRouteSelection = () => {
    try {
      const visibleCandidates = surveyPoints.filter((point) => !hiddenLayerIdSet.has(point.layer_id));
      const selectedLayerIds = [...new Set(selectedSurveyPoints.map((point) => point.layer_id))];
      const options = {
        toleranceM: Number(routeTolerance),
        maxResults: MAX_REVIEW_CANDIDATES,
        ...(civilPointPanel === "select-axis" || civilPointPanel === "select-series" ? {} : { layerIds: selectedLayerIds }),
      } as const;
      const matches = civilPointPanel === "select-series"
        ? (() => {
          if (selectedSurveyPoints.length !== 1) {
            throw new TypeError("Pro celou osu vyberte právě jeden referenční bod.");
          }
          return selectCivilPointsInSeries(selectedSurveyPoints[0]!, visibleCandidates, options);
        })()
        : civilPointPanel === "select-segment" || civilPointPanel === "select-line"
        ? (() => {
          if (selectedSurveyPoints.length !== 2) {
            throw new TypeError("Vyberte přesně dva referenční body v pořadí pomocí Shift + kliknutí.");
          }
          const selector = civilPointPanel === "select-line" ? selectCivilPointsAlongLine : selectCivilPointsAlongSegment;
          return selector(selectedSurveyPoints[0]!, selectedSurveyPoints[1]!, visibleCandidates, options);
        })()
        : (() => {
          const axis = state.objects.find((object): object is CivilAxisObject => object.type === "civil.axis" && object.id === routeAxisId);
          if (!axis) throw new TypeError("Vyberte platnou osu.");
          return selectCivilPointsAlongAxis(
            axis,
            visibleCandidates,
            [Number(routeStationRange.start), Number(routeStationRange.end)],
            options,
          );
        })();
      setRouteMatches(matches);
      setMessage(`Náhled výběru obsahuje ${matches.length} viditelných bodů v pořadí trasy.`);
    } catch (error) {
      setRouteMatches([]);
      setMessage(error instanceof Error ? error.message : "Body v trase nelze vybrat.");
    }
  };

  const confirmRouteSelection = (additive = false) => {
    if (!routeMatches.length) { setMessage("Náhled neobsahuje žádné body k výběru."); return; }
    const matchedIds = routeMatches.map((match) => match.pointId);
    setState(store.current.setSelection(additive ? [...new Set([...state.selection, ...matchedIds])] : matchedIds));
    setCivilPointPanel(null);
    setRouteMatches([]);
    setMessage(additive ? "Body byly přidány k výběru a seřazeny podle trasy." : "Body byly vybrány a seřazeny podle trasy.");
  };

  const createAxisFromSelection = () => {
    if (selectedSurveyPoints.length < 2) { setMessage("Osa vyžaduje nejméně dva body v pořadí začátek → konec."); return; }
    try {
      const axis = createAxisFromSelectedPoints(selectedSurveyPoints, {
        objectId: `object_axis_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
        name: selectionAxisName,
      });
      applyObject(axis);
      setState(store.current.setSelection([axis.id]));
      setSelectionAction(null);
      setMessage(`Orientovaná osa byla vytvořena z ${selectedSurveyPoints.length} bodů. Směr vede od prvního k poslednímu bodu.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Osu nelze vytvořit."); }
  };

  const moveSelectionToLayer = () => {
    if (!selectedSurveyPoints.length) { setMessage("Nejprve vyberte body pro novou vrstvu."); return; }
    try {
      const layerId = safeManualLayerId(selectionLayerName);
      const updated = selectedSurveyPoints.map((point) => {
        const copy = { ...structuredClone(point), layer_id: layerId };
        if (copy.type === "stakeout.point" && copy.properties.derivation.kind === "document_import") {
          copy.properties.derivation.source_layer = selectionLayerName.trim();
        }
        return copy;
      });
      applyObjects(updated);
      setLayerNames(setLayerName(window.localStorage, layerColorScope, layerId, selectionLayerName));
      if (localProject) markViewDirty();
      setSelectionAction(null);
      setMessage(`${updated.length} bodů bylo přesunuto do vrstvy „${selectionLayerName.trim()}“.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Novou vrstvu nelze vytvořit."); }
  };

  const openCopyOperation = (
    points: readonly (CivilPointObject | StakeoutPointObject)[] = selectedSurveyPoints,
  ) => {
    if (tinDraftOpen) { setMessage("Nejprve dokončete nebo zrušte náhled TIN."); return; }
    setMeasuring(false);
    setSectionOpen(false);
    if (!points.length) { setMessage("Nejprve vyberte body ke kopírování."); return; }
    copyCommitPendingRef.current = false;
    setCopySourceIds(points.map((point) => point.id));
    setCivilPointPanel(null);
    setSelectionAction("copy");
    setMessage(`Kopie pracuje se zmrazeným výběrem ${points.length.toLocaleString("cs-CZ")} bodů. Nastavte směr a vzdálenost.`);
  };

  const openSlopeSurface = () => {
    let source: SlopeSourceSnapshot | null = null;
    const previewId = `object_civil_surface_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
    if (selectedAxis) {
      source = {
        previewId,
        label: `osa „${selectedAxis.properties.name}“`,
        points: selectedAxis.geometry.points.map((point) => [...point] as [number, number, number]),
        crs: structuredClone(selectedAxis.properties.crs),
        sourceDocumentId: selectedAxis.provenance.source_document_id,
        sourceDocumentSha256: selectedAxis.provenance.source_document_sha256,
      };
    } else if (selectedSurveyPoints.length === 2) {
      const [start, end] = selectedSurveyPoints;
      if (!start || !end || start.properties.crs.epsg !== end.properties.crs.epsg
        || start.properties.crs.vertical_datum !== end.properties.crs.vertical_datum) {
        setMessage("Referenční body šikmé plochy musí mít shodné CRS.");
        return;
      }
      source = {
        previewId,
        label: `body „${start.properties.name}“ → „${end.properties.name}“`,
        points: [[...start.geometry.point], [...end.geometry.point]],
        crs: structuredClone(start.properties.crs),
        sourceDocumentId: start.provenance.source_document_id,
        sourceDocumentSha256: start.provenance.source_document_sha256,
      };
    }
    if (!source) {
      setMessage("Šikmá plocha vyžaduje jednu vybranou osu nebo přesně dva body v pořadí začátek → konec.");
      return;
    }
    const sequence = state.objects.filter((object) => (
      object.type === "civil.tin_surface" && object.provenance.algorithm_version === "civil-slope-strip-v1"
    )).length + 1;
    slopeCommitPendingRef.current = false;
    setSlopeInput((current) => ({ ...current, name: `Šikmá plocha ${sequence}` }));
    setSlopeSource(source);
    setCivilPointPanel(null);
    setSelectionAction("slope");
    setMessage("Náhled šikmé plochy je připnutý ke zdrojové hraně. Kladný sklon zvedá vnější hranu.");
  };

  const closeSelectionOperation = () => {
    setSelectionAction(null);
    setCopySourceIds([]);
    setSlopeSource(null);
  };

  const copySelectedPoints = () => {
    if (copyCommitPendingRef.current) return;
    if (!copySourcePoints.length || copySourcePoints.length !== copySourceIds.length) {
      setMessage("Zdroj zmrazeného výběru již není úplný. Operaci kopie otevřete znovu.");
      return;
    }
    copyCommitPendingRef.current = true;
    try {
      const reference = copySourcePoints.length >= 2
        ? [copySourcePoints[0]!, copySourcePoints.at(-1)!] as const
        : undefined;
      const vector = copyVector(copyInput.direction, Number(copyInput.distance), reference);
      const layerId = safeManualLayerId(selectionLayerName);
      const copies = transformedPointCopies(copySourcePoints, vector, Number(copyInput.angle), layerId, (point) => (
        `${point.type === "civil.point" ? "object_civil_point" : "object_stakeout"}_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`
      ));
      applyObjects(copies);
      setLayerNames(setLayerName(window.localStorage, layerColorScope, layerId, selectionLayerName));
      if (localProject) markViewDirty();
      closeSelectionOperation();
      setMessage(`${copies.length} bodů bylo zkopírováno o [${vector.map((value) => value.toFixed(3)).join(", ")}] m a otočeno o ${Number(copyInput.angle).toLocaleString("cs-CZ")}° kolem prvního bodu.`);
    } catch (error) {
      copyCommitPendingRef.current = false;
      setMessage(error instanceof Error ? error.message : "Body nelze zkopírovat.");
    }
  };

  const commitSlopeSurface = () => {
    if (slopeCommitPendingRef.current || !slopePreview.surface) return;
    slopeCommitPendingRef.current = true;
    const surface = slopePreview.surface;
    applyObject(surface);
    setState(store.current.setSelection([surface.id]));
    closeSelectionOperation();
    setMessage(`Šikmá plocha „${surface.properties.name}“ byla vytvořena z ${surface.geometry.vertices.length} vrcholů.`);
  };

  const applyObject = (object: ModelObject) => {
    try {
      setState(store.current.execute({
        id: commandId(),
        type: "object.upsert",
        baseRevision: store.current.snapshot.revision,
        object,
      }));
      setMessage("Lokální změna čeká na uložení nové verze.");
    } catch (error) {
      setMessage(error instanceof InvalidCommandError ? error.message : "Změnu nelze použít.");
    }
  };

  const applyObjects = (objects: readonly ModelObject[]) => {
    if (!objects.length) return;
    const baseRevision = store.current.snapshot.revision;
    setState(store.current.executeBatch(objects.map((object) => ({
      id: commandId(), type: "object.upsert" as const, baseRevision, object,
    }))));
    setState(store.current.setSelection(objects.map((object) => object.id)));
    setMessage("Lokální změna čeká na uložení nové verze.");
  };

  const deleteSelectedPointLayer = () => {
    if (!selectedProjectLayer || selectedSurveyPoints.length !== selectedProjectLayer.objectIds.length) {
      setMessage("Odstranit lze pouze jednu celou bodovou vrstvu.");
      return;
    }
    if (layerDeleteConfirmation !== selectedProjectLayer.id) {
      setLayerDeleteConfirmation(selectedProjectLayer.id);
      setMessage(`Potvrďte znovu odstranění vrstvy „${selectedProjectLayer.name}“ a jejích ${selectedProjectLayer.objectIds.length} bodů.`);
      return;
    }
    try {
      const baseRevision = store.current.snapshot.revision;
      setState(store.current.executeBatch(selectedProjectLayer.objectIds.map((objectId) => ({
        id: commandId(), type: "object.remove" as const, baseRevision, objectId,
      }))));
      setLayerDeleteConfirmation(null);
      setMessage(`Vrstva „${selectedProjectLayer.name}“ byla odstraněna. Změna se projeví až po uložení projektu.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Vrstvu nelze odstranit."); }
  };

  const deleteSelectedCivilObject = () => {
    if (!selected || (selected.type !== "civil.tin_surface" && selected.type !== "civil.material_layer")) return;
    const assemblyId = selected.type === "civil.material_layer" ? selected.properties.derivation.assembly?.id : undefined;
    if (selected.type === "civil.tin_surface" && state.objects.some((object) => (
      object.type === "civil.material_layer" && object.properties.derivation.top_surface_id === selected.id
    ))) {
      setMessage("TIN nelze odstranit, dokud na něj odkazuje objemová vrstva. Nejprve odstraňte závislou vrstvu.");
      return;
    }
    if (objectDeleteConfirmation !== selected.id) {
      setObjectDeleteConfirmation(selected.id);
      setMessage(assemblyId ? "Potvrďte znovu odstranění všech vrstev této skladby." : `Potvrďte znovu odstranění objektu „${selected.properties.name}“.`);
      return;
    }
    try {
      if (assemblyId) {
        const baseRevision = store.current.snapshot.revision;
        setState(store.current.executeBatch(state.objects.filter((object) => object.type === "civil.material_layer" && object.properties.derivation.assembly?.id === assemblyId)
          .map((object) => ({ id: commandId(), type: "object.remove" as const, baseRevision, objectId: object.id }))));
        setObjectDeleteConfirmation(null); setMessage("Skladba byla odstraněna; změnu lze vrátit akcí Zpět."); return;
      }
      setState(store.current.execute({
        id: commandId(), type: "object.remove", baseRevision: store.current.snapshot.revision, objectId: selected.id,
      }));
      setObjectDeleteConfirmation(null);
      setMessage(`Objekt „${selected.properties.name}“ byl odstraněn. Změna čeká na uložení projektu.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Objekt nelze odstranit."); }
  };

  const updateSelectedMaterialThickness = (value: string) => {
    if (!selected || selected.type !== "civil.material_layer") return;
    if (selected.properties.derivation.assembly) { setMessage("Tloušťky upravte přes Upravit skladbu, aby navazovaly všechny vrstvy."); return; }
    const topSurface = state.objects.find((object): object is TinSurfaceObject => (
      object.type === "civil.tin_surface" && object.id === selected.properties.derivation.top_surface_id
    ));
    if (!topSurface) { setMessage("Zdrojový TIN povrch materiálové vrstvy nebyl nalezen."); return; }
    try {
      applyObject(createCivilMaterialLayerFromSurface(topSurface, {
        objectId: selected.id,
        layerId: selected.layer_id,
        name: selected.properties.name,
        materialCode: selected.properties.material_code,
        thicknessM: Number(value),
        topOffsetM: selected.properties.derivation.top_offset_m,
        sourceDocumentId: selected.provenance.source_document_id,
        sourceDocumentSha256: selected.provenance.source_document_sha256,
        algorithmVersion: "civil-material-layer-v1",
      }));
      setMessage("Tloušťka, geometrie a kubatura vrstvy byly přepočítány.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Tloušťku vrstvy nelze změnit."); }
  };

  const createSweepPreview = () => {
    const axis = state.objects.find((object): object is CivilAxisObject => object.type === "civil.axis");
    const profile = state.objects.find((object): object is CivilProfileObject => (
      object.type === "civil.profile" && object.properties.axis_id === axis?.id
    ));
    if (!axis || !profile) {
      setMessage("Náhled sweepu vyžaduje osu a její podélný profil.");
      return;
    }
    try {
      const preview = buildCivilSweep(axis, profile, {
        objectId: `object_sweep_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
        layerId: axis.layer_id,
        name: "Náhled koridoru",
        sourceDocumentId: axis.provenance.source_document_id,
        sourceDocumentSha256: axis.provenance.source_document_sha256,
        algorithmVersion: "civil-sweep-v1",
        tools: {
          schema_version: "datamine.civil-tools.v1",
          axis_id: axis.id,
          profile_id: profile.id,
          section: [
            { offset_m: -1, elevation_offset_m: 0 },
            { offset_m: 1, elevation_offset_m: 0 },
          ],
          sampling_spacing_m: 5,
          caps: false,
        },
      });
      setPreviewSweep(preview);
      setMessage(`Náhled: ${preview.geometry.vertices.length} vrcholů; revision se nezměnila.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sweep náhled nelze vytvořit.");
    }
  };

  const commitSweepPreview = () => {
    if (!previewSweep) return;
    applyObject(previewSweep);
    setPreviewSweep(null);
  };

  const patchSelected = (changes: Partial<RoomObject["properties"]>) => {
    if (!selected || selected.type !== "rooms.room") return;
    const updated = structuredClone(selected);
    Object.assign(updated.properties, changes);
    applyObject(updated);
  };

  const patchBuildingReview = (reviewState: BuildingObject["properties"]["review_state"]) => {
    if (!selected || !selected.type.startsWith("building.")) return;
    const updated = structuredClone(selected) as BuildingObject;
    updated.properties.review_state = reviewState;
    applyObject(updated);
  };

  const patchStakeoutReview = (
    reviewState: StakeoutPointObject["properties"]["review_state"],
  ) => {
    if (!selected || !selected.type.startsWith("stakeout.")) return;
    const updated = structuredClone(selected) as StakeoutPointObject | StakeoutGroupObject;
    updated.properties.review_state = reviewState;
    applyObject(updated);
  };

  const patchStakeoutPoint = (mutate: (point: StakeoutPointObject) => void) => {
    if (!selected || selected.type !== "stakeout.point") return;
    if (selected.properties.derivation.kind !== "manual") {
      setMessage("Odvozený bod je read-only; nejprve jej potvrďte nebo vytvořte ruční kopii.");
      return;
    }
    const updated = structuredClone(selected);
    mutate(updated);
    applyObject(updated);
  };

  const createManualStakeoutPoint = () => {
    const axis = state.objects.find((object): object is CivilAxisObject => object.type === "civil.axis");
    if (!axis) {
      setMessage("Nový vytyčovací bod vyžaduje projekt s explicitním CRS.");
      return;
    }
    const sequence = state.objects.filter((object) => object.type === "stakeout.point").length + 1;
    const code = `P${String(sequence).padStart(3, "0")}`;
    const [x, y, z] = axis.geometry.points[0]!;
    const point: StakeoutPointObject = {
      schema_version: "datamine.stakeout-point.v1",
      id: `object_stakeout_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
      type: "stakeout.point", layer_id: "layer_stakeout",
      geometry: { kind: "point3d", coordinate_space: "survey_crs", point: [x, y + sequence * 0.25, z] },
      properties: {
        schema_version: "datamine.stakeout-point-properties.v1",
        name: `Vytyčovací bod ${code}`, code, crs: axis.properties.crs,
        derivation: { kind: "manual" }, coordinate_tolerance_m: 0.001,
        accuracy: { horizontal_m: 0.02, vertical_m: 0.03, method: "manual" },
        review_state: "unreviewed",
      },
      provenance: {
        source_document_id: axis.provenance.source_document_id,
        source_document_sha256: axis.provenance.source_document_sha256,
        source_kind: "manual", algorithm_version: "stakeout-manual-v1",
      },
    };
    applyObject(point);
    setState(store.current.setSelection([point.id]));
  };

  const createStakeoutGroup = () => {
    const points = state.objects.filter((object): object is StakeoutPointObject => object.type === "stakeout.point");
    const first = points[0];
    if (!first) {
      setMessage("Skupina vyžaduje alespoň jeden vytyčovací bod.");
      return;
    }
    const group: StakeoutGroupObject = {
      schema_version: "datamine.stakeout-group.v1",
      id: `object_stakeout_group_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`,
      type: "stakeout.group", layer_id: "layer_stakeout",
      properties: {
        schema_version: "datamine.stakeout-group-properties.v1",
        name: `Vytyčovací skupina ${state.objects.filter((item) => item.type === "stakeout.group").length + 1}`,
        crs: first.properties.crs, ordering: "explicit", point_ids: points.map((point) => point.id),
        review_state: "unreviewed",
      },
      provenance: {
        source_document_id: first.provenance.source_document_id,
        source_document_sha256: first.provenance.source_document_sha256,
        source_kind: "manual", algorithm_version: "stakeout-group-v1",
      },
    };
    applyObject(group);
    setState(store.current.setSelection([group.id]));
  };

  const editVertex = (index: number, axis: 0 | 1, raw: string) => {
    if (!selected || selected.type !== "rooms.room") return;
    const value = Number(raw);
    const current = selected.geometry.rings[0]?.[index];
    if (!current || !Number.isFinite(value)) {
      setMessage("Souřadnice vrcholu musí být konečné číslo.");
      return;
    }
    const point: [number, number] = [current[0], current[1]];
    point[axis] = value;
    try {
      applyObject(updateRoomVertex(selected, index, point));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Vrchol nelze změnit.");
    }
  };

  const undo = () => {
    setState(store.current.undo());
    setMessage("Lokální změna byla vrácena.");
  };
  const redo = () => {
    setState(store.current.redo());
    setMessage("Lokální změna byla znovu použita.");
  };

  const save = async () => {
    if (connection !== "ready" || mapRestoring || drawingRestoring) return;
    if (pendingLayerRename && !renameContextLayer()) return;
    // Přejmenování mění store synchronně, React state až v dalším renderu.
    const savingViewGeneration = viewGeneration.current;
    const objectsToSave = store.current.snapshot.objects;
    const hasChanges = pendingLayerRename || dirty;
    if (localProject && hasChanges) {
      setConnection("saving");
      try {
        const updated = { ...updateLocalProject(localProject, { objects: objectsToSave }),
          map_context: mapContext ? storedMapContext(mapContext) : mapChanged.current ? undefined : localProject.map_context,
          drawing_underlay: drawingUnderlay ? storedDrawingUnderlay(drawingUnderlay) : drawingChanged.current ? undefined : localProject.drawing_underlay };
        setLocalProject(await saveProject(updated, true));
        if (viewGeneration.current === savingViewGeneration) setViewSettingsDirty(false);
        setConnection("ready");
        setMessage(isServerProject(localProject.id) ? "Projekt včetně nastavení vrstev byl uložen na server." : "Projekt byl uložen v tomto prohlížeči.");
      } catch (error) {
        setConnection("ready");
        setMessage(error instanceof Error ? error.message : "Projekt nelze uložit.");
      }
      return;
    }
    if (!loaded || !hasChanges) return;
    let commands: readonly ModelVersionCommand[];
    try {
      commands = commandsForChanges(loaded.model.objects, objectsToSave, commandId);
    } catch (error) {
      setMessage(error instanceof ModelApiError ? error.message : "Změny nelze serializovat.");
      return;
    }
    if (!commands.length) return;
    setConnection("saving");
    setMessage("Ukládám immutable working verzi…");
    try {
      const result = await saveWorkingModel(loaded, commands, `save-${crypto.randomUUID()}`);
      const selection = state.selection.filter((id) => result.model.objects.some((item) => item.id === id));
      store.current = new EditorStore(result.model.objects, 15);
      setState(store.current.setSelection(selection));
      setLoaded(result);
      setConnection("ready");
      setMessage(`Uložena working verze, revize ${result.model.revision}.`);
    } catch (error) {
      setConnection("ready");
      setMessage(error instanceof ModelApiError ? error.message : "Verzi nelze uložit.");
    }
  };

  const confirmVersion = async () => {
    if (!loaded || loaded.model.status !== "working" || dirty || connection !== "ready") return;
    setConnection("validating");
    setMessage("Server ověřuje geometrii a vytváří immutable validated verzi…");
    try {
      const result = await validateWorkingModel(loaded, `validate-${crypto.randomUUID()}`);
      const selection = state.selection.filter((id) => result.model.objects.some((item) => item.id === id));
      store.current = new EditorStore(result.model.objects, 15);
      setState(store.current.setSelection(selection));
      setLoaded(result);
      setConnection("ready");
      setMessage(`Verze byla potvrzena jako validated, revize ${result.model.revision}.`);
    } catch (error) {
      setConnection("ready");
      setMessage(error instanceof ModelApiError ? error.message : "Verzi nelze potvrdit.");
    }
  };

  const statusLabel = localProject ? (isServerProject(localProject.id) ? "Projekt na serveru" : "Místní projekt")
    : connection === "demo" ? "Lokální ukázka"
      : connection === "loading" ? "Načítám server"
      : connection === "saving" ? "Ukládám"
        : connection === "validating" ? "Potvrzuji"
        : connection === "error" ? "Chyba připojení" : "Serverová verze";
  const modelRevision = loaded?.model.revision ?? localProject?.server_revision ?? 0;
  const roomsCount = state.objects.filter((object) => object.type === "rooms.room").length;
  const wallsCount = state.objects.filter((object) => object.type === "building.wall").length;
  const openingsCount = state.objects.filter((object) => object.type === "building.opening").length;
  const floorsCount = state.objects.filter((object) => object.type === "building.floor").length;
  const axesCount = state.objects.filter((object) => object.type === "civil.axis").length;
  const civilPointsCount = state.objects.filter((object) => object.type === "civil.point").length;
  const civilPoints = state.objects.filter((object): object is CivilPointObject => object.type === "civil.point");
  const surveyPoints = state.objects.filter((object): object is CivilPointObject | StakeoutPointObject => object.type === "civil.point" || object.type === "stakeout.point");
  const profilesCount = state.objects.filter((object) => object.type === "civil.profile").length;
  const stakeoutPointsCount = state.objects.filter((object) => object.type === "stakeout.point").length;
  const projectLayers = useMemo(() => groupProjectLayers(state.objects, layerNames), [state.objects, layerNames]);
  const importedProjectLayers = useMemo(
    () => projectLayers.filter((layer) => layer.origin === "imported"),
    [projectLayers],
  );
  const createdProjectLayers = useMemo(
    () => projectLayers.filter((layer) => layer.origin === "created"),
    [projectLayers],
  );
  const normalizedLayerSearch = layerSearch.trim().toLocaleLowerCase("cs-CZ");
  const visibleImportedLayers = importedProjectLayers.filter((layer) => layer.name.toLocaleLowerCase("cs-CZ").includes(normalizedLayerSearch));
  const visibleCreatedLayers = createdProjectLayers.filter((layer) => layer.name.toLocaleLowerCase("cs-CZ").includes(normalizedLayerSearch));
  const selectedObjectIds = useMemo(() => new Set(state.selection), [state.selection]);
  const hiddenLayerIdSet = useMemo(() => new Set(hiddenLayerIds), [hiddenLayerIds]);
  useEffect(() => {
    setMeasurementAnchors((current) => refreshMeasurementAnchors(current, state.objects, hiddenLayerIdSet));
  }, [hiddenLayerIdSet, state.revision]);
  const resolvedLayerColors = useMemo(() => {
    const defaults = defaultLayerColors(projectLayers.map((layer) => layer.id));
    return Object.freeze(Object.fromEntries(
      projectLayers.map((layer) => [layer.id, layerColors[layer.id] ?? defaults[layer.id]!]),
    ));
  }, [projectLayers, layerColors]);
  const resolvedLayerOpacities = useMemo(() => {
    const surfaceLayers = new Set(state.objects.filter((object) => (
      object.type === "civil.tin_surface" || object.type === "civil.material_layer"
    )).map((object) => object.layer_id));
    return Object.freeze(Object.fromEntries(projectLayers.map((layer) => (
      [layer.id, layerOpacities[layer.id] ?? (surfaceLayers.has(layer.id) ? 0.45 : 1)]
    ))));
  }, [projectLayers, layerOpacities, state.objects]);
  const copyPreview = useMemo(() => {
    if (selectionAction !== "copy" || !copySourcePoints.length || copySourcePoints.length !== copySourceIds.length) {
      return { objects: [] as readonly (CivilPointObject | StakeoutPointObject)[], vector: null as readonly [number, number, number] | null, error: null as string | null };
    }
    try {
      const reference = copySourcePoints.length >= 2
        ? [copySourcePoints[0]!, copySourcePoints.at(-1)!] as const
        : undefined;
      const vector = copyVector(copyInput.direction, Number(copyInput.distance), reference);
      const layerId = safeManualLayerId(selectionLayerName);
      const objects = transformedPointCopies(
        copySourcePoints,
        vector,
        Number(copyInput.angle),
        layerId,
        (point, index) => `object_preview_copy_${index}_${point.id.slice(-12)}`,
      );
      return { objects, vector, error: null };
    } catch (error) {
      return {
        objects: [] as readonly (CivilPointObject | StakeoutPointObject)[],
        vector: null as readonly [number, number, number] | null,
        error: error instanceof Error ? error.message : "Náhled kopie nelze vytvořit.",
      };
    }
  }, [selectionAction, state.objects, copySourceIds, copyInput.direction, copyInput.distance, copyInput.angle, selectionLayerName]);
  const previewObjectIds = useMemo(() => [
    ...(previewSurface ? [previewSurface.id] : []),
    ...(previewMaterialLayer ? [previewMaterialLayer.id] : []),
    ...(previewSweep ? [previewSweep.id] : []),
    ...(slopePreview.surface ? [slopePreview.surface.id] : []),
    ...copyPreview.objects.map((object) => object.id),
  ], [previewSurface, previewMaterialLayer, previewSweep, slopePreview.surface, copyPreview.objects]);
  const selectedProjectLayers = projectLayers.filter((layer) => (
    layer.objectIds.length > 0 && layer.objectIds.every((objectId) => selectedObjectIds.has(objectId))
  ));
  const selectedLayerObjectCount = new Set(selectedProjectLayers.flatMap((layer) => [...layer.objectIds])).size;
  const exactSelectedProjectLayers = selectedLayerObjectCount === state.selection.length ? selectedProjectLayers : [];
  const selectedProjectLayer = exactSelectedProjectLayers.length === 1 ? exactSelectedProjectLayers[0] : undefined;
  const stakeoutPoints = state.objects.filter((object): object is StakeoutPointObject => object.type === "stakeout.point");
  const selectedTitle = selected?.type === "rooms.room"
    ? selected.properties.name
    : selected?.type === "building.opening"
      ? `${selected.properties.opening_type} · ${selected.id}`
      : selected?.properties.name;
  const previewSurfaceAreas = previewSurface ? civilTinSurfaceAreas(previewSurface) : null;
  const slopePreviewAreas = slopePreview.surface ? civilTinSurfaceAreas(slopePreview.surface) : null;
  const selectedSurfaceAreas = selected?.type === "civil.tin_surface" ? civilTinSurfaceAreas(selected) : null;
  const contextLayer = layerContextMenu ? projectLayers.find((layer) => layer.id === layerContextMenu.layerId) : undefined;
  const pendingLayerRename = Boolean(contextLayer && layerContextName.trim() !== contextLayer.name);
  const contextLayerObjects = contextLayer
    ? state.objects.filter((object) => contextLayer.objectIds.includes(object.id)) : [];
  const contextTinAreas = contextLayerObjects
    .filter((object): object is TinSurfaceObject => object.type === "civil.tin_surface")
    .map(civilTinSurfaceAreas);
  const contextPlanAreaM2 = contextTinAreas.reduce((sum, areas) => sum + areas.planM2, 0)
    || contextLayerObjects.filter((object): object is CivilMaterialLayerObject => object.type === "civil.material_layer")
      .reduce((sum, layer) => sum + layer.properties.volume_m3 / layer.properties.derivation.thickness_m, 0);
  const contextSurfaceAreaM2 = contextTinAreas.reduce((sum, areas) => sum + areas.surfaceM2, 0);

  const selectProjectLayer = (layerName: string, objectIds: readonly string[], additive: boolean) => {
    const layerIds = new Set(objectIds);
    const allSelected = objectIds.every((objectId) => selectedObjectIds.has(objectId));
    const target = additive
      ? allSelected
        ? state.selection.filter((objectId) => !layerIds.has(objectId))
        : state.objects.map((object) => object.id).filter((objectId) => selectedObjectIds.has(objectId) || layerIds.has(objectId))
      : [...objectIds];
    setState(store.current.setSelection(target));
    setLayerDeleteConfirmation(null);
    setTool("select");
    setMessage(additive
      ? `${allSelected ? "Odebrána" : "Přidána"} vrstva „${layerName}“ z vícevrstvého výběru.`
      : `Vybrána celá vrstva „${layerName}“ · ${objectIds.length.toLocaleString("cs-CZ")} objektů.`);
  };

  const changeProjectLayerColor = (layerId: string, color: string) => {
    try {
      setLayerColors(setLayerColor(window.localStorage, layerColorScope, layerId, color));
      if (localProject) markViewDirty();
      setMessage(localProject && isServerProject(localProject.id) ? "Barva vrstvy byla změněna. Změnu potvrďte tlačítkem Uložit projekt." : "Barva vrstvy byla změněna a uložena v tomto prohlížeči.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Barvu vrstvy nelze uložit.");
    }
  };

  const changeProjectLayerOpacity = (layerId: string, opacity: number) => {
    try {
      setLayerOpacities(setLayerOpacity(window.localStorage, layerColorScope, layerId, opacity));
      if (localProject) markViewDirty();
      setMessage(`Průhlednost vrstvy: ${Math.round((1 - opacity) * 100)} %. ${localProject && isServerProject(localProject.id) ? "Změnu potvrďte tlačítkem Uložit projekt." : "Nastavení bylo uloženo v tomto prohlížeči."}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Průhlednost vrstvy nelze uložit.");
    }
  };

  const toggleProjectLayerVisibility = (layerName: string, layerId: string, objectIds: readonly string[]) => {
    try {
      const visible = hiddenLayerIdSet.has(layerId);
      setHiddenLayerIds(setLayerVisibility(window.localStorage, layerColorScope, layerId, visible));
      if (localProject) markViewDirty();
      if (!visible) {
        const hiddenObjects = new Set(objectIds);
        setState(store.current.setSelection(state.selection.filter((objectId) => !hiddenObjects.has(objectId))));
      }
      setMessage(`Vrstva „${layerName}“ byla ${visible ? "zobrazena" : "skryta"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Viditelnost vrstvy nelze změnit.");
    }
  };

  const selectObjectsInBox = (objectIds: readonly string[], additive: boolean) => {
    const allowed = new Set(objectIds.filter((objectId) => state.objects.some((object) => (
      object.id === objectId && !hiddenLayerIdSet.has(object.layer_id)
      && (object.type === "civil.point" || object.type === "stakeout.point")
    ))));
    const target = additive
      ? state.objects.map((object) => object.id).filter((objectId) => selectedObjectIds.has(objectId) || allowed.has(objectId))
      : [...allowed];
    setState(store.current.setSelection(target));
    setMessage(allowed.size
      ? `Výběrové okno označilo ${allowed.size.toLocaleString("cs-CZ")} bodů${additive ? " a přidalo je k výběru" : ""}.`
      : additive ? "Výběrové okno nenalezlo další body." : "Výběrové okno neobsahuje žádné viditelné body.");
  };

  const renameContextLayer = (): boolean => {
    if (!contextLayer) return false;
    try {
      const { name, layerId, objects: updated } = prepareLayerRename(state.objects, contextLayer.id, layerContextName);
      if (layerId !== contextLayer.id) {
        setLayerColors(setLayerColor(window.localStorage, layerColorScope, layerId, resolvedLayerColors[contextLayer.id]!));
        setLayerOpacities(setLayerOpacity(window.localStorage, layerColorScope, layerId, resolvedLayerOpacities[contextLayer.id]!));
        if (localProject) markViewDirty();
      }
      applyObjects(updated);
      setLayerNames(setLayerName(window.localStorage, layerColorScope, layerId, name));
      if (localProject) markViewDirty();
      setLayerContextMenu(null);
      setMessage(`Vrstva „${contextLayer.name}“ byla přejmenována na „${name}“.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Vrstvu nelze přejmenovat.");
      return false;
    }
  };

  const deleteContextLayer = () => {
    if (!contextLayer) return;
    if (contextLayerObjects.some((object) => object.type === "civil.material_layer" && object.properties.derivation.assembly)) {
      setMessage("Vrstvu odeberte přes Upravit skladbu; celou skladbu lze odstranit ve vlastnostech její vrstvy."); setLayerContextMenu(null); return;
    }
    const dependentMaterial = contextLayerObjects.some((object) => object.type === "civil.tin_surface" && state.objects.some((candidate) => (
      candidate.type === "civil.material_layer" && candidate.properties.derivation.top_surface_id === object.id
    )));
    if (dependentMaterial) { setMessage("TIN vrstvu nelze odstranit, dokud na ni odkazuje objemová vrstva."); return; }
    if (layerDeleteConfirmation !== contextLayer.id) {
      setLayerDeleteConfirmation(contextLayer.id);
      setMessage(`Potvrďte znovu odstranění vrstvy „${contextLayer.name}“ a jejích ${contextLayer.objectIds.length} objektů.`);
      return;
    }
    const baseRevision = store.current.snapshot.revision;
    setState(store.current.executeBatch(contextLayer.objectIds.map((objectId) => ({
      id: commandId(), type: "object.remove" as const, baseRevision, objectId,
    }))));
    setLayerDeleteConfirmation(null);
    setLayerContextMenu(null);
    setMessage(`Vrstva „${contextLayer.name}“ byla odstraněna; lze ji obnovit akcí Zpět.`);
  };

  const exportSurveyCsv = () => {
    try {
      const selectedPointIds = selectedSurveyPoints.map((point) => point.id);
      const stem = safeSurveyExportStem(localProject?.name ?? "datamine-model");
      downloadText(createSurveyPointsCsv(state.objects, selectedPointIds), `${stem}-body.csv`, "text/csv;charset=utf-8");
      setMessage(selectedPointIds.length ? `CSV obsahuje ${selectedPointIds.length} vybraných bodů.` : "CSV obsahuje všechny body modelu.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "CSV export nelze vytvořit."); }
  };

  const exportCivilDxf = () => {
    try {
      const stem = safeSurveyExportStem(localProject?.name ?? "datamine-model");
      downloadText(createCivilModelDxf(state.objects), `${stem}-model.dxf`, "application/dxf;charset=utf-8");
      setMessage(`Pracovní DXF byl připraven v metrech.${workbenchSummary.omitted.length ? ` Vynecháno: ${workbenchSummary.omitted.join("; ")}.` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "DXF export nelze vytvořit."); }
  };

  useEffect(() => {
    if (projectType !== "civil") return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      if (mapOpen) {
        if (event.key === "Escape") { event.preventDefault(); setMapOpen(false); }
        return;
      }
      if (assemblyDraft) {
        if (event.key === "Escape") { event.preventDefault(); closeAssembly(); }
        return;
      }
      if (measuring || sectionOpen) {
        if (event.key === "Escape") { event.preventDefault(); setMeasuring(false); setSectionOpen(false); setMessage("Měření / řez byl ukončen; model se nezměnil."); }
        return;
      }
      if (editorPane !== "3d") return;
      if (event.key === "Escape" && (selectionAction || civilPointPanel || tinDraftOpen)) {
        event.preventDefault();
        closeSelectionOperation();
        setCivilPointPanel(null);
        setPreviewSurface(null); setTinSourcePoints([]);
        setRouteMatches([]);
        setMessage("Operace byla zrušena; model se nezměnil.");
        return;
      }
      if (tinDraftOpen) return;
      if (!editing && event.shiftKey && event.key.toLocaleLowerCase("en-US") === "d" && selectedSurveyPoints.length) {
        event.preventDefault();
        openCopyOperation();
        return;
      }
      if (!editing && selectionAction === "copy" && ["x", "y", "z"].includes(event.key.toLocaleLowerCase("en-US"))) {
        event.preventDefault();
        setCopyInput((current) => ({ ...current, direction: event.key.toLocaleLowerCase("en-US") as CopyDirection }));
        return;
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [editorPane, projectType, mapOpen, assemblyDraft, measuring, sectionOpen, selectionAction, civilPointPanel, tinDraftOpen, selectedSurveyPoints, openCopyOperation, closeSelectionOperation]);

  const renderProjectLayerRows = (layers: readonly ProjectLayer[]) => layers.map((layer) => {
    const active = layer.objectIds.length > 0 && layer.objectIds.every((objectId) => selectedObjectIds.has(objectId));
    const color = resolvedLayerColors[layer.id]!;
    const visible = !hiddenLayerIdSet.has(layer.id);
    return <div key={layer.id} className={`${active ? "v2-layer-row v2-layer-row--active" : "v2-layer-row"}${visible ? "" : " v2-layer-row--hidden"}`} onContextMenu={(event) => {
      event.preventDefault();
      selectProjectLayer(layer.name, layer.objectIds, false);
      setLayerContextName(layer.name);
      setLayerContextMenu({ layerId: layer.id, x: event.clientX, y: event.clientY });
    }}>
      <label className="v2-layer-color" title={`Změnit barvu vrstvy ${layer.name}`}>
        <input type="color" value={color} aria-label={`Barva vrstvy ${layer.name}`} onChange={(event) => changeProjectLayerColor(layer.id, event.currentTarget.value)} />
      </label>
      <button className="v2-layer-visibility" type="button" aria-pressed={visible} aria-label={`${visible ? "Skrýt" : "Zobrazit"} vrstvu ${layer.name}`} title={`${visible ? "Skrýt" : "Zobrazit"} vrstvu ${layer.name}`} onClick={() => toggleProjectLayerVisibility(layer.name, layer.id, layer.objectIds)}>
        {visible
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.75" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.6 3.3M6.2 6.2C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a10 10 0 0 0 2.2-.2M9.9 9.9A3 3 0 0 0 14.1 14" /></svg>}
      </button>
      <button className="v2-layer-select" type="button" aria-pressed={active} onClick={(event) => selectProjectLayer(layer.name, layer.objectIds, event.shiftKey || event.metaKey || event.ctrlKey)} title={`Vybrat vrstvu ${layer.name}; Ctrl/Cmd/Shift přidá další`}><span>{layer.name}</span><span className="dm-mono">{layer.objectIds.length}</span></button>
    </div>;
  });

  return (
    <main className={`v2-shell${focusMode ? " v2-shell--focus" : ""}${projectType === "civil" ? " v2-shell--civil" : ""}`} aria-label="Datamine V2 editor">
      <header className="v2-topbar">
        <BrandHomeLink />
        <div className="v2-document-title">
          <strong>{localProject?.name ?? (loaded ? `${loaded.model.project_id} · ${loaded.model.document_id}` : projectType === "building" ? "Syntetická stavba · Půdorys" : "Obchvat Bečov · Situace SO 201")}</strong>
          <span>{PROJECT_TYPE_LABELS[projectType]} · {loaded?.model.status ?? "Pracovní model"} · revize {modelRevision}{dirty ? " · neuloženo" : ""}</span>
        </div>
        <div className="v2-actions" aria-label="Historie změn">
          <ThemeToggle value={theme} onChange={onThemeChange} />
          <button className="dm-btn dm-btn--ghost" type="button" onClick={() => window.location.assign(localProject ? `/?workspace=${encodeURIComponent(localProject.id)}` : `/?projects=${projectType}`)}>{localProject ? "Soubory projektu" : "Projekty"}</button>
          <button className="dm-btn dm-btn--ghost" title="Historie uchovává nejvýše 15 kroků" onClick={undo} disabled={!store.current.canUndo}>Zpět · {store.current.undoCount}</button>
          <button className="dm-btn dm-btn--ghost" title="Historie uchovává nejvýše 15 kroků" onClick={redo} disabled={!store.current.canRedo}>Znovu · {store.current.redoCount}</button>
          <button className="dm-btn dm-btn--primary" onPointerDown={(event) => event.stopPropagation()} onClick={() => void save()} disabled={(!dirty && !pendingLayerRename) || connection !== "ready"}>{localProject ? "Uložit projekt" : "Uložit verzi"}</button>
          {!localProject && <button className="dm-btn dm-btn--primary" onClick={() => void confirmVersion()} disabled={!loaded || loaded.model.status !== "working" || dirty || connection !== "ready"}>Potvrdit verzi</button>}
        </div>
      </header>

      <aside className="v2-sidebar" aria-label="Projekty a vrstvy">
        <section><p className="dm-label">Projekt</p><h1>{localProject?.name ?? loaded?.model.project_id ?? "Syntetický projekt"}</h1><p className="v2-muted">{localProject ? (isServerProject(localProject.id) ? "Projekt uložený na serveru" : "Místní projekt v tomto prohlížeči") : loaded ? "Projekt připojený k serveru" : "Ukázkový model · změny se neukládají"}</p></section>
        <section className="v2-layer-list" aria-label="Vrstvy">
          <p className="dm-label">Model a vrstvy</p>
          {projectType === "civil" && <><label className="v2-layer-search">Hledat vrstvu<input type="search" placeholder="Název vrstvy…" value={layerSearch} onChange={(event) => setLayerSearch(event.currentTarget.value)} /></label><p className="v2-muted">Skupiny organizují objekty. Materiálová vrstva má tloušťku a objem.</p></>}
          {projectType === "building" && <><button className={selected?.type === "rooms.room" ? "v2-layer v2-layer--active" : "v2-layer"} type="button" disabled={!roomsCount} onClick={() => selectObject(state.objects.find((object) => object.type === "rooms.room")?.id ?? null)}><span className="v2-layer__dot" aria-hidden="true" />Místnosti<span className="dm-mono">{roomsCount}</span></button>
          <button className={selected?.type === "building.wall" ? "v2-layer v2-layer--active" : "v2-layer"} type="button" disabled={!wallsCount} onClick={() => selectObject(state.objects.find((object) => object.type === "building.wall")?.id ?? null)}><span className="v2-layer__dot v2-layer__dot--wall" aria-hidden="true" />Stěny<span className="dm-mono">{wallsCount}</span></button>
          <button className={selected?.type === "building.opening" ? "v2-layer v2-layer--active" : "v2-layer"} type="button" disabled={!openingsCount} onClick={() => selectObject(state.objects.find((object) => object.type === "building.opening")?.id ?? null)}><span className="v2-layer__dot v2-layer__dot--opening" aria-hidden="true" />Otvory<span className="dm-mono">{openingsCount}</span></button>
          <button className={selected?.type === "building.floor" ? "v2-layer v2-layer--active" : "v2-layer"} type="button" disabled={!floorsCount} onClick={() => selectObject(state.objects.find((object) => object.type === "building.floor")?.id ?? null)}><span className="v2-layer__dot v2-layer__dot--floor" aria-hidden="true" />Podlahy<span className="dm-mono">{floorsCount}</span></button></>}
          {projectType === "civil" && <>
            {visibleImportedLayers.length > 0 && <div className="v2-layer-group"><p className="v2-layer-group__title">Importované podklady</p>{renderProjectLayerRows(visibleImportedLayers)}</div>}
            {visibleCreatedLayers.length > 0 && <div className="v2-layer-group"><p className="v2-layer-group__title">Vytvořené objekty</p>{renderProjectLayerRows(visibleCreatedLayers)}</div>}
            {!visibleImportedLayers.length && !visibleCreatedLayers.length && <p className="v2-muted" role="status">{normalizedLayerSearch ? "Žádná vrstva neodpovídá hledání." : "Zatím nejsou vytvořené žádné vrstvy."}</p>}
          </>}
        </section>
        {projectType === "civil" && (civilPointsCount > 0 || stakeoutPointsCount > 0) && <button className="v2-sidebar-data-link" type="button" onClick={() => setEditorPane("data")}><span>Projektová data</span><strong>{(civilPointsCount + stakeoutPointsCount).toLocaleString("cs-CZ")} bodů</strong></button>}
        {projectType === "civil" && <section className="v2-model-summary" aria-label="Souhrn modelu"><p className="dm-label">Souhrn modelu</p><dl className="v2-derived-values"><div><dt>Body</dt><dd>{workbenchSummary.points}</dd></div><div><dt>TIN povrchy</dt><dd>{workbenchSummary.surfaces}</dd></div><div><dt>Materiálové vrstvy</dt><dd>{workbenchSummary.materials}</dd></div></dl><p>{workbenchSummary.coordinates} · metry</p></section>}
        <footer><span className="v2-status-dot" aria-hidden="true" />{statusLabel}</footer>
      </aside>

      {contextLayer && layerContextMenu && <section
        className="v2-layer-context"
        role="menu"
        aria-label={`Akce vrstvy ${contextLayer.name}`}
        style={{ left: Math.min(layerContextMenu.x, window.innerWidth - 310), top: Math.min(layerContextMenu.y, window.innerHeight - 430) }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header><div><p className="dm-label">Vrstva</p><strong>{contextLayer.name}</strong></div><span className="dm-mono">{contextLayer.objectIds.length}</span></header>
        <dl className="v2-derived-values">
          <div><dt>Plocha XY</dt><dd>{contextPlanAreaM2 > 0 ? `${contextPlanAreaM2.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²` : "—"}</dd></div>
          <div><dt>Skutečná plocha</dt><dd>{contextSurfaceAreaM2 > 0 ? `${contextSurfaceAreaM2.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²` : "—"}</dd></div>
        </dl>
        <label>Název<input value={layerContextName} maxLength={120} onChange={(event) => setLayerContextName(event.currentTarget.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            renameContextLayer();
          }
        }} /></label>
        <button type="button" role="menuitem" onClick={renameContextLayer}>Přejmenovat vrstvu</button>
        <label>Barva<input type="color" value={resolvedLayerColors[contextLayer.id]!} onChange={(event) => changeProjectLayerColor(contextLayer.id, event.currentTarget.value)} /></label>
        <label>Krytí · {Math.round(resolvedLayerOpacities[contextLayer.id]! * 100)} %<input type="range" min="5" max="100" step="1" value={Math.round(resolvedLayerOpacities[contextLayer.id]! * 100)} onInput={(event) => changeProjectLayerOpacity(contextLayer.id, Number(event.currentTarget.value) / 100)} /></label>
        <button type="button" role="menuitem" disabled={!contextLayerObjects.some((object) => object.type === "civil.point" || object.type === "stakeout.point")} onClick={() => {
          setSelectionLayerName(`${contextLayer.name} – kopie`);
          openCopyOperation(contextLayerObjects.filter((object): object is CivilPointObject | StakeoutPointObject => object.type === "civil.point" || object.type === "stakeout.point"));
          setLayerContextMenu(null);
        }}>Vytvořit kopii vrstvy…</button>
        <button className={layerDeleteConfirmation === contextLayer.id ? "v2-danger-action v2-danger-action--confirm" : "v2-danger-action"} type="button" role="menuitem" onClick={deleteContextLayer}>{layerDeleteConfirmation === contextLayer.id ? "Potvrdit odstranění" : "Odstranit vrstvu"}</button>
        <small>{contextPlanAreaM2 > 0 ? "Plocha je odvozena z triangulované geometrie." : "Plocha vznikne po triangulaci bodů."}</small>
      </section>}

      <section className={projectType === "civil" ? "v2-workspace v2-workspace--civil" : "v2-workspace"} aria-label="Editor výkresu">
        <nav className="v2-editor-tabs" aria-label="Pohled editoru">
          <button className={editorPane === "canvas" ? "v2-editor-tab v2-editor-tab--active" : "v2-editor-tab"} type="button" onClick={() => setEditorPane("canvas")}>Plátno 2D</button>
          <button className={editorPane === "data" ? "v2-editor-tab v2-editor-tab--active" : "v2-editor-tab"} type="button" onClick={() => setEditorPane("data")}>Projektová data <span>{state.objects.length}</span></button>
          <button className={editorPane === "3d" ? "v2-editor-tab v2-editor-tab--active" : "v2-editor-tab"} type="button" onClick={() => setEditorPane("3d")}>3D model</button>
        </nav>
        {projectType === "civil" && <CivilWorkbenchToolbar
          summary={workbenchSummary} selectedPoints={selectedSurveyPoints.length} selectionCount={state.selection.length}
          surfaceVertices={state.selection.length === 1 && selected?.type === "civil.tin_surface" ? selected.geometry.vertices.length : 0}
          canSlope={canCreateSlopeSurface} canSweep={axesCount > 0 && profilesCount > 0} canGroup={stakeoutPointsCount > 0}
          busy={Boolean(mapOpen || assemblyDraft || measuring || sectionOpen || selectionAction || tinDraftOpen || previewMaterialLayer || previewSweep)}
          measuring={measuring} onMeasure={() => {
            if (measuring) { setMeasuring(false); setMessage("Měření bylo ukončeno; model se nezměnil."); return; }
            setSectionOpen(false); setMeasuring(true); setFocusMode(false); setEditorPane("3d"); setTool("select"); setCivilPointPanel(null);
            setMeasurementAnchors(selectedSurveyPoints.length <= 2 ? selectedSurveyPoints.filter((point) => !hiddenLayerIdSet.has(point.layer_id)).map(pointMeasurementAnchor) : []);
            setMessage("Vyberte A a B: bod, viditelný vrchol nebo hranu. Měření nemění model.");
          }}
          sectioning={sectionOpen} onSection={() => {
            if (sectionOpen) { setSectionOpen(false); return; }
            setMeasuring(false); setSectionOpen(true); setFocusMode(false); setEditorPane("3d"); setTool("select"); setCivilPointPanel(null);
            setMeasurementAnchors(selectedSurveyPoints.length <= 2 ? selectedSurveyPoints.filter((point) => !hiddenLayerIdSet.has(point.layer_id)).map(pointMeasurementAnchor) : []);
            setMessage("Řez A–B: vyberte dva body, viditelné vrcholy nebo hrany modelu.");
          }}
          canDrawing={!!localProject && !cadUnderlayView && !drawingRestoring}
          onDrawing={() => { if (!drawingRestoring) { setDrawingOpen(true); setEditorPane("3d"); } }}
          onMap={localOnly ? undefined : () => { setMapOpen(true); setFocusMode(false); setEditorPane("3d"); }}
          showTriangulation={showTriangulation} onToggleTriangulation={() => {
            try {
              const visible = setTriangulationVisibility(window.localStorage, layerColorScope, !showTriangulation);
              setShowTriangulation(visible);
              if (localProject) markViewDirty();
              setMessage(visible ? "Triangulace TIN je zobrazena. Geometrie se nezměnila." : "Triangulace TIN je skryta. Geometrie se nezměnila.");
            } catch (error) { setMessage(error instanceof Error ? error.message : "Volbu triangulace nelze uložit."); }
          }}
          is3d={editorPane === "3d"} boxSelection={tool === "box-select"} focusMode={focusMode}
          onPoint={() => { setFocusMode(false); if (editorPane === "data") setEditorPane("3d"); openPointCreation(); }}
          onRoute={() => { setFocusMode(false); if (editorPane === "data") setEditorPane("3d"); openRouteSelection(); }}
          onTin={() => { setEditorPane("3d"); setFocusMode(false); setCivilPointPanel(null); createSurfacePreview(); }}
          onSlope={() => { setEditorPane("3d"); setFocusMode(false); openSlopeSurface(); }}
          onMaterial={() => { setEditorPane("3d"); setFocusMode(false); requestAnimationFrame(() => { materialFormRef.current?.scrollIntoView({ block: "nearest" }); materialFormRef.current?.querySelector("input")?.focus(); }); }}
          onCopy={() => { setEditorPane("3d"); setFocusMode(false); openCopyOperation(); }}
          onSweep={() => { setEditorPane("3d"); setFocusMode(false); createSweepPreview(); }} onGroup={createStakeoutGroup}
          onSelect={() => { setMeasuring(false); setSectionOpen(false); setTool("select"); }} onBox={() => { setMeasuring(false); setSectionOpen(false); setTool((value) => value === "box-select" ? "select" : "box-select"); }}
          onFocus={() => setFocusMode((value) => !value)} onCsv={exportSurveyCsv} onDxf={exportCivilDxf}
          onVerticesCsv={() => { if (state.selection.length === 1 && selected?.type === "civil.tin_surface") {
            try {
              downloadText(createTinVerticesCsv(selected), `${safeSurveyExportStem(selected.properties.name)}-vrcholy.csv`, "text/csv;charset=utf-8");
              setMessage("CSV se souřadnicemi vrcholů plochy bylo připraveno.");
            } catch (error) { setMessage(error instanceof Error ? error.message : "CSV vrcholů nelze vytvořit."); }
          } }}
        />}
        {editorPane !== "data" && projectType === "building" && <div className="v2-toolbar" aria-label="Nástroje editoru">
          <button className="v2-tool" type="button" aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}>{focusMode ? "Zobrazit panely" : "Celá plocha"}</button>
          <button className={tool === "select" ? "v2-tool v2-tool--active" : "v2-tool"} type="button" aria-pressed={tool === "select"} onClick={() => setTool("select")}>Výběr</button>
          <button className={tool === "polygon" ? "v2-tool v2-tool--active" : "v2-tool"} type="button" aria-pressed={tool === "polygon"} disabled={!polygonEditable} title={selected && !polygonEditable ? `Interaktivní limit je ${MAX_INTERACTIVE_VERTICES} vrcholů.` : undefined} onClick={() => setTool("polygon")}>Polygon místnosti</button>
          <span className="v2-toolbar__meta dm-mono">{viewMode.toUpperCase()} · drawing_m</span>
        </div>}
        {editorPane !== "data" ? <div className="v2-canvas-wrap">
          <EditorViewport drawingUnderlay={drawingUnderlay?.visible ? drawingUnderlay : null} showTriangulation={showTriangulation} mapContext={mapContext?.visible ? mapContext : null} objects={[...state.objects.filter((object) => !assemblyPreview.length || (object.id !== assemblyDraft?.surface.id && !assemblyDraft?.existing.some((old) => old.id === object.id))), ...assemblyPreview, ...(previewSweep ? [previewSweep] : []), ...(previewSurface ? [previewSurface] : []), ...(previewMaterialLayer ? [previewMaterialLayer] : []), ...(slopePreview.surface ? [slopePreview.surface] : []), ...copyPreview.objects]} selection={assemblyPreview.length ? [] : copyPreview.objects.length ? copyPreview.objects.map((object) => object.id) : slopePreview.surface ? [slopePreview.surface.id] : previewMaterialLayer ? [previewMaterialLayer.id] : previewSurface ? [previewSurface.id] : previewSweep ? [previewSweep.id] : state.selection} mode={viewMode} documentView={documentView} pdfUrl={pdfUrl} cadUnderlayView={cadUnderlayView} layerColors={{ ...resolvedLayerColors, ...Object.fromEntries(assemblyPreview.map((layer, index) => [layer.layer_id, layerColors[layer.layer_id] ?? ASSEMBLY_COLORS[index % ASSEMBLY_COLORS.length]!])) }} layerOpacities={{ ...resolvedLayerOpacities, ...Object.fromEntries(assemblyPreview.map((layer) => [layer.layer_id, 1])) }} hiddenLayerIds={hiddenLayerIdSet} selectionMode={tool === "box-select" ? "box" : "single"} previewObjectIds={previewObjectIds} measurementEnabled={(measuring || sectionOpen) && editorPane === "3d"} onMeasurementPick={(anchor) => setMeasurementAnchors((current) => appendMeasurementAnchor(current, anchor))} onPick={selectObject} onBoxSelect={selectObjectsInBox} />
          {mapContext?.visible && editorPane === "3d" && <div className="v2-map-attribution">{MAP_LAYERS[mapContext.layer].label} © ČÚZK · {isSurveyTerrain(mapContext.terrain) ? `TIN: ${mapContext.terrain.source_name}` : "DMR 5G · orientační terén"} · Bpv <button type="button" onClick={() => { setMapOpen(true); setFocusMode(false); }}>Nastavení podkladu</button></div>}
          {drawingUnderlay && editorPane === "3d" && <div className={`v2-map-attribution${mapContext?.visible ? " v2-drawing-attribution" : ""}`}>Situace: {drawingUnderlay.source_name}{!drawingUnderlay.visible ? " · skrytá" : ""}{drawingAnchorsChanged(drawingUnderlay, state.objects) ? " · vazební body se změnily" : ""}<button type="button" onClick={() => setDrawingOpen(true)}>Nastavení situace</button></div>}
          <div className="v2-canvas-hint" hidden={projectType === "civil"}>{tool === "box-select" ? "Tažením označte viditelné body · Shift/Ctrl/Cmd přidá další" : localProject ? "Kliknutí: výběr · tažení: otáčení · změny uložíte do projektu" : "Kliknutí: výběr · tažení: otáčení"}</div>
        </div> : <section className="v2-editor-data" aria-label="Projektová data">
          <header><div><p className="dm-label">Projektová data</p><h2>{projectType === "civil" ? "Body a objekty modelu" : "Objekty pozemní stavby"}</h2></div><p>Vyberte řádek pro zobrazení vlastností. Stav kontroly je vlastnost objektu, nikoli samostatný pracovní režim.</p></header>
          {projectType === "civil" && <div className="v2-editor-data__table" role="table" aria-label="Souřadnice bodů">
            <div className="v2-editor-data__row v2-editor-data__row--head" role="row"><span>Kód / název</span><span>E [m]</span><span>N [m]</span><span>Z [m]</span><span>Zdroj</span></div>
            {[...stakeoutPoints, ...civilPoints].slice(0, 10_000).map((point) => {
              const name = point.type === "stakeout.point" ? `${point.properties.code} · ${point.properties.name}` : point.properties.name;
              return <button className={selected?.id === point.id ? "v2-editor-data__row v2-editor-data__row--active" : "v2-editor-data__row"} role="row" type="button" key={point.id} onClick={(event) => selectObject(point.id, event.shiftKey || event.metaKey || event.ctrlKey)}><strong>{name}</strong>{point.geometry.point.map((value, index) => <span className="dm-mono" key={index}>{value.toLocaleString("cs-CZ", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</span>)}<span>{["manual", "manual_coordinates"].includes(point.properties.derivation.kind) ? "Vytvořeno v editoru" : "Vytěženo / odvozeno"}</span></button>;
            })}
            {!stakeoutPoints.length && !civilPoints.length && <div className="v2-editor-data__empty"><strong>Zatím nejsou žádné body</strong><span>Vraťte se do souborů projektu, spusťte vytěžení a potvrďte nalezené objekty.</span></div>}
          </div>}
          {projectType === "building" && <div className="v2-editor-data__cards">{state.objects.map((object) => <button type="button" key={object.id} onClick={() => selectObject(object.id)}><strong>{"name" in object.properties ? object.properties.name ?? object.type : object.type}</strong><span>{object.type}</span></button>)}</div>}
        </section>}
        {editorPane !== "data" && projectType === "civil" && civilPointPanel && <form className="v2-point-panel" onSubmit={(event) => event.preventDefault()}>
          <div className="v2-point-panel__tabs"><strong>Práce s body</strong><button className="v2-tool" type="button" onClick={() => { setCivilPointPanel(null); setRouteMatches([]); }}>Zavřít</button></div>
          {["select-segment", "select-line", "select-series", "select-axis"].includes(civilPointPanel) ? <div className="v2-point-panel__tabs"><button type="button" className={civilPointPanel === "select-segment" ? "v2-tool v2-tool--active" : "v2-tool"} onClick={() => { setRouteMatches([]); setCivilPointPanel("select-segment"); }}>Úsek</button><button type="button" className={civilPointPanel === "select-line" ? "v2-tool v2-tool--active" : "v2-tool"} onClick={() => { setRouteMatches([]); setCivilPointPanel("select-line"); }}>Přímá řada</button><button type="button" className={civilPointPanel === "select-series" ? "v2-tool v2-tool--active" : "v2-tool"} onClick={() => { setRouteMatches([]); setCivilPointPanel("select-series"); }}>Celá osa</button><button type="button" className={civilPointPanel === "select-axis" ? "v2-tool v2-tool--active" : "v2-tool"} disabled={!axesCount} onClick={() => { setRouteMatches([]); setCivilPointPanel("select-axis"); }}>Podél osy</button></div> : <div className="v2-point-panel__tabs"><button type="button" className={civilPointPanel === "coordinates" ? "v2-tool v2-tool--active" : "v2-tool"} onClick={() => setCivilPointPanel("coordinates")}>Souřadnice</button><button type="button" className={civilPointPanel === "axis" ? "v2-tool v2-tool--active" : "v2-tool"} onClick={() => setCivilPointPanel("axis")}>Na ose</button><button type="button" className={civilPointPanel === "densify" ? "v2-tool v2-tool--active" : "v2-tool"} onClick={() => setCivilPointPanel("densify")}>Zhustit</button></div>}
          {["coordinates", "axis", "densify"].includes(civilPointPanel) && <label>Název<input value={pointName} maxLength={200} onChange={(event) => setPointName(event.currentTarget.value)} /></label>}
          {civilPointPanel === "coordinates" && <><p className="v2-muted">Souřadnice se předvyplní podle vybraného bodu a nový bod zdědí CRS projektu.</p><div className="v2-point-panel__grid">{(["e", "n", "z"] as const).map((coordinate) => <label key={coordinate}>{coordinate.toUpperCase()} [m]<input type="number" step="0.001" value={pointCoordinates[coordinate]} onChange={(event) => setPointCoordinates({ ...pointCoordinates, [coordinate]: event.currentTarget.value })} /></label>)}</div><button className="dm-btn dm-btn--primary" type="button" onClick={addCivilPointByCoordinates}>Přidat bod</button></>}
          {civilPointPanel === "axis" && <><div className="v2-point-panel__grid"><label>Staničení od začátku [m]<input type="number" step="0.001" value={axisPoint.station} onChange={(event) => setAxisPoint({ ...axisPoint, station: event.currentTarget.value })} /></label><label>Odsazení [m]<input type="number" step="0.001" value={axisPoint.offset} onChange={(event) => setAxisPoint({ ...axisPoint, offset: event.currentTarget.value })} /></label><label>Výškový rozdíl [m]<input type="number" step="0.001" value={axisPoint.elevationOffset} onChange={(event) => setAxisPoint({ ...axisPoint, elevationOffset: event.currentTarget.value })} /></label></div><button className="dm-btn dm-btn--primary" type="button" onClick={addCivilPointOnAxis}>Přidat bod na osu</button></>}
          {civilPointPanel === "densify" && <><p className="v2-muted">Vyberte dva body v pořadí pomocí Shift + kliknutí.</p><label>Počet nových bodů<input type="number" min="1" max="10000" step="1" value={densifyCount} onChange={(event) => setDensifyCount(event.currentTarget.value)} /></label><button className="dm-btn dm-btn--primary" type="button" onClick={densifySelectedCivilPoints}>Zhustit mezi body</button></>}
          {civilPointPanel === "select-segment" && <p className="v2-muted">Vyberte startovní a koncový bod v pořadí pomocí Shift + kliknutí. Zahrnuty budou jen body uvnitř úseku.</p>}
          {civilPointPanel === "select-line" && <p className="v2-muted">Dva body určí směr celé nekonečné řady. Vyberou se odpovídající viditelné body ve stejných vrstvách i před a za referenčními body.</p>}
          {civilPointPanel === "select-series" && <p className="v2-muted">Jeden bod určí logickou podélnou osu podle vrstvy a role v řezu. Vyberou se všechny její viditelné body ve všech staničeních, i když osa zatáčí.</p>}
          {civilPointPanel === "select-axis" && <><label>Osa<select value={routeAxisId} onChange={(event) => { setRouteAxisId(event.currentTarget.value); setRouteMatches([]); }}>{state.objects.filter((object): object is CivilAxisObject => object.type === "civil.axis").map((axis) => <option key={axis.id} value={axis.id}>{axis.properties.name}</option>)}</select></label><div className="v2-point-panel__grid"><label>Od staničení [m]<input type="number" step="0.001" value={routeStationRange.start} onChange={(event) => setRouteStationRange({ ...routeStationRange, start: event.currentTarget.value })} /></label><label>Do staničení [m]<input type="number" step="0.001" value={routeStationRange.end} onChange={(event) => setRouteStationRange({ ...routeStationRange, end: event.currentTarget.value })} /></label></div></>}
          {["select-segment", "select-line", "select-series", "select-axis"].includes(civilPointPanel) && <>{civilPointPanel !== "select-series" && <label>Boční tolerance [m]<input type="number" min="0" max="10000" step="0.001" value={routeTolerance} onChange={(event) => setRouteTolerance(event.currentTarget.value)} /></label>}<div className="v2-point-panel__actions"><button className="dm-btn dm-btn--primary" type="button" onClick={previewRouteSelection}>Najít body</button><button className="dm-btn dm-btn--primary" type="button" disabled={!routeMatches.length} title="Shift, Ctrl nebo Cmd zachová dosavadní výběr" onClick={(event) => confirmRouteSelection(event.shiftKey || event.metaKey || event.ctrlKey)}>Potvrdit výběr</button></div>{routeMatches.length > 0 && <ol className="v2-route-preview" aria-label="Náhled bodů v trase">{routeMatches.map((match) => { const point = surveyPoints.find((candidate) => candidate.id === match.pointId); return <li key={match.pointId}><strong>{point?.properties.name ?? match.pointId}</strong><span className="dm-mono">{match.stationM.toFixed(3)} m · offset {match.lateralOffsetM.toFixed(3)} m</span></li>; })}</ol>}</>}
        </form>}
        {projectType === "civil" && <footer className="v2-workbench-status"><span>{workbenchSummary.coordinates} · m</span><span role="status">{message ?? "Vyberte objekty v modelu nebo ve stromu vrstev."}</span></footer>}
      </section>

      {drawingOpen && <DrawingUnderlayDialog context={drawingUnderlay} objects={state.objects.filter((object) => !hiddenLayerIdSet.has(object.layer_id))} project={localProject} onApply={changeDrawingUnderlay} onClose={() => setDrawingOpen(false)} />}
      <aside className="v2-inspector" aria-label="Vlastnosti objektu">
        {mapOpen && mapRestoring ? <p role="status">Obnovuji uloženou mapu a terén…</p> : mapOpen ? <CivilMapPanel allObjects={state.objects} objects={state.objects.filter((object) => !hiddenLayerIdSet.has(object.layer_id))} context={mapContext} onContext={changeMapContext} canSave={!!localProject} hasCadTransform={!!cadUnderlayView} onClose={() => setMapOpen(false)} /> : assemblyDraft ? <CivilAssemblyPanel key={assemblyDraft.surface.id + ":" + assemblyDraft.revision} surface={assemblyDraft.surface} existing={assemblyDraft.existing} colors={resolvedLayerColors} onPreview={previewAssembly} onCommit={commitAssembly} onClose={closeAssembly} /> : measuring ? <CivilMeasurementPanel points={surveyPoints.filter((point) => !hiddenLayerIdSet.has(point.layer_id))} selection={state.selection} anchors={measurementAnchors} onAnchors={setMeasurementAnchors}
          onSelection={(ids) => setState(store.current.setSelection(ids))}
          onClose={() => { setMeasuring(false); setMessage("Měření bylo ukončeno; model se nezměnil."); }}
        /> : sectionOpen ? <CivilSectionPanel objects={state.objects} points={surveyPoints.filter((point) => !hiddenLayerIdSet.has(point.layer_id))}
          anchors={measurementAnchors} onAnchors={setMeasurementAnchors} hiddenLayerIds={hiddenLayerIdSet} colors={resolvedLayerColors}
          onClose={() => setSectionOpen(false)} /> : <>
        <div><p className="dm-label">Vlastnosti a operace</p><h2>{selectionAction === "copy" ? "Kopie · náhled" : selectionAction === "slope" ? "Šikmá plocha · náhled" : selectionAction === "axis" ? "Vytvořit osu" : selectionAction === "layer" ? "Sloučit do vrstvy" : previewSweep ? "Náhled koridoru" : previewMaterialLayer ? "Náhled objemové vrstvy" : tinDraftOpen ? "Náhled TIN povrchu" : exactSelectedProjectLayers.length > 1 ? `${exactSelectedProjectLayers.length} vybrané vrstvy` : selectedProjectLayer ? selectedProjectLayer.name : selectedSurveyPoints.length > 1 ? `Vybráno ${selectedSurveyPoints.length} bodů` : selectedTitle ?? "Bez výběru"}</h2><p className="v2-muted">{selectionAction || previewMaterialLayer || tinDraftOpen || previewSweep ? "Dočasný náhled · model zatím nebyl změněn." : exactSelectedProjectLayers.length > 1 ? `Vícevrstvý výběr · ${selectedSurveyPoints.length.toLocaleString("cs-CZ")} bodů. Další vrstvu přidáte Ctrl/Cmd/Shift + kliknutím.` : selectedProjectLayer ? `Vybrána celá vrstva · ${selectedProjectLayer.objectIds.length.toLocaleString("cs-CZ")} objektů.` : selected ? "Změny jsou lokální do uložení verze." : "Vyberte objekt ve výkresu."}</p></div>
        {projectType === "civil" && selectedProjectLayer && !selectionAction && !tinDraftOpen && !previewMaterialLayer && !previewSweep && <section className="v2-layer-appearance" aria-label="Vzhled vrstvy">
          <label className="v2-layer-appearance__color">Barva vrstvy<input type="color" aria-label="Barva vybrané vrstvy" value={resolvedLayerColors[selectedProjectLayer.id]!} onChange={(event) => changeProjectLayerColor(selectedProjectLayer.id, event.currentTarget.value)} /></label>
          <label className="v2-layer-appearance__slider"><span>Průhlednost <output>{Math.round((1 - resolvedLayerOpacities[selectedProjectLayer.id]!) * 100)} %</output></span><input type="range" aria-label="Průhlednost vybrané vrstvy" min="0" max="95" step="1" value={Math.round((1 - resolvedLayerOpacities[selectedProjectLayer.id]!) * 100)} onChange={(event) => changeProjectLayerOpacity(selectedProjectLayer.id, (100 - Number(event.currentTarget.value)) / 100)} /></label>
          <small>0 % plná barva · 95 % téměř průhledná</small>
        </section>}
        {selectionAction && <form className="v2-point-panel v2-selection-panel v2-inspector-operation" onSubmit={(event) => {
          event.preventDefault();
          if (selectionAction === "copy") copySelectedPoints();
          if (selectionAction === "slope") commitSlopeSurface();
        }}>
          <div className="v2-point-panel__tabs"><strong>{selectionAction === "copy" ? "Nastavení kopie" : selectionAction === "slope" ? "Parametry plochy" : "Práce s výběrem"}</strong><button className="v2-tool" type="button" onClick={closeSelectionOperation}>Zrušit</button></div>
          {selectionAction === "axis" && <><p className="v2-muted">Body budou uloženy jako jedna orientovaná osa v aktuálním pořadí. První bod určuje začátek a poslední směr.</p><label>Název osy<input value={selectionAxisName} maxLength={200} onChange={(event) => setSelectionAxisName(event.currentTarget.value)} /></label><button className="dm-btn dm-btn--primary" type="button" onClick={createAxisFromSelection}>Vytvořit osu z {selectedSurveyPoints.length} bodů</button></>}
          {selectionAction === "layer" && <><p className="v2-muted">Vybrané vrstvy nebo body se sloučí do jedné cílové vrstvy. Zdrojový dokument zůstane zachován.</p><label>Název cílové vrstvy<input value={selectionLayerName} maxLength={120} onChange={(event) => setSelectionLayerName(event.currentTarget.value)} /></label><button className="dm-btn dm-btn--primary" type="button" onClick={moveSelectionToLayer}>Sloučit do vrstvy</button></>}
          {selectionAction === "copy" && <>
            <p className="v2-muted">Zdroj je zmrazený na {copySourceIds.length.toLocaleString("cs-CZ")} bodů. Průhledné body jsou pouze jeden náhled.</p>
            <label>Směr posunu<select value={copyInput.direction} onChange={(event) => setCopyInput({ ...copyInput, direction: event.currentTarget.value as CopyDirection })}><option value="selection">Od prvního k poslednímu bodu</option><option value="x">+X · východ</option><option value="negative-x">−X · západ</option><option value="y">+Y · sever</option><option value="negative-y">−Y · jih</option><option value="z">+Z · nahoru</option><option value="negative-z">−Z · dolů</option></select></label>
            <div className="v2-point-panel__grid"><label>Vzdálenost [m]<input type="number" min="0.001" max="100000" step="0.001" value={copyInput.distance} onChange={(event) => setCopyInput({ ...copyInput, distance: event.currentTarget.value })} /></label><label>Otočení kolem Z [°]<input type="number" min="-360000" max="360000" step="0.1" value={copyInput.angle} onChange={(event) => setCopyInput({ ...copyInput, angle: event.currentTarget.value })} /></label></div>
            <label>Cílová vrstva<input value={selectionLayerName} maxLength={120} onChange={(event) => setSelectionLayerName(event.currentTarget.value)} /></label>
            {copyPreview.vector && <dl className="v2-derived-values"><div><dt>Nové body</dt><dd>{copyPreview.objects.length}</dd></div><div><dt>Posun XYZ</dt><dd>{copyPreview.vector.map((value) => value.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })).join(" / ")} m</dd></div></dl>}
            {copyPreview.error && <p className="v2-operation-error" role="alert">{copyPreview.error}</p>}
            <p className="v2-shortcut-help"><kbd>Shift</kbd>+<kbd>D</kbd> kopie · <kbd>X</kbd>/<kbd>Y</kbd>/<kbd>Z</kbd> směr · <kbd>Enter</kbd> potvrdit · <kbd>Esc</kbd> zrušit</p>
            <button className="dm-btn dm-btn--primary" type="submit" disabled={!copyPreview.objects.length}>Vytvořit kopii</button>
          </>}
          {selectionAction === "slope" && <>
            <p className="v2-muted">Zdroj: {slopeSource?.label}. Kladná hodnota zvedá vnější hranu, záporná ji snižuje.</p>
            <label>Název plochy<input value={slopeInput.name} maxLength={200} onChange={(event) => setSlopeInput({ ...slopeInput, name: event.currentTarget.value })} /></label>
            <label>Strana od směru osy<select value={slopeInput.side} onChange={(event) => setSlopeInput({ ...slopeInput, side: event.currentTarget.value as CivilSlopeSide })}><option value="left">Vlevo</option><option value="right">Vpravo</option></select></label>
            <div className="v2-point-panel__grid"><label>Šířka [m]<input type="number" min="0.001" max="10000" step="0.001" value={slopeInput.width} onChange={(event) => setSlopeInput({ ...slopeInput, width: event.currentTarget.value })} /></label><label>Vyjádření sklonu<select value={slopeInput.unit} onChange={(event) => setSlopeInput({ ...slopeInput, unit: event.currentTarget.value as CivilSlopeUnit })}><option value="percent">Procenta [%]</option><option value="degrees">Úhel [°]</option><option value="ratio">Poměr 1:n</option><option value="elevation">Převýšení [m]</option></select></label></div>
            <label>{slopeInput.unit === "percent" ? "Sklon [%]" : slopeInput.unit === "degrees" ? "Úhel [°]" : slopeInput.unit === "ratio" ? "Poměr n · záporný = klesání" : "Převýšení [m]"}<input type="number" step={slopeInput.unit === "ratio" ? "0.1" : "0.001"} value={slopeInput.value} onChange={(event) => setSlopeInput({ ...slopeInput, value: event.currentTarget.value })} /></label>
            {slopePreview.surface && slopePreviewAreas && <dl className="v2-derived-values"><div><dt>Převýšení</dt><dd>{slopePreview.elevationDifferenceM?.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m</dd></div><div><dt>Vrcholy</dt><dd>{slopePreview.surface.geometry.vertices.length}</dd></div><div><dt>Trojúhelníky</dt><dd>{slopePreview.surface.geometry.faces.length}</dd></div><div><dt>Plocha XY</dt><dd>{slopePreviewAreas.planM2.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²</dd></div><div><dt>Skutečná plocha</dt><dd>{slopePreviewAreas.surfaceM2.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²</dd></div></dl>}
            {slopePreview.error && <p className="v2-operation-error" role="alert">{slopePreview.error}</p>}
            <p className="v2-preview-help"><strong>Orientace:</strong> směr vede od prvního k poslednímu bodu osy. Změnou strany převrátíte plochu bez změny výšek zdrojové hrany.</p>
            <div className="v2-preview-actions"><button className="dm-btn dm-btn--primary" type="submit" disabled={!slopePreview.surface}>Vytvořit plochu</button><button className="dm-btn dm-btn--ghost" type="button" disabled={!slopePreview.surface} onClick={() => {
              if (!slopePreview.surface) return;
              downloadText(createTinVerticesCsv(slopePreview.surface), `${safeSurveyExportStem(slopePreview.surface.properties.name)}-vrcholy.csv`, "text/csv;charset=utf-8");
              setMessage("CSV s dopočtenými souřadnicemi vrcholů bylo připraveno.");
            }}>CSV vrcholy</button></div>
          </>}
        </form>}
        {previewSweep && <section className="v2-preview-inspector" aria-label="Informace o náhledu koridoru"><span className="v2-preview-badge">NÁHLED · KORIDOR</span><p>Koridor je dočasný. Potvrzením jej přidáte do pracovního modelu.</p><dl className="v2-derived-values"><div><dt>Vrcholy</dt><dd>{previewSweep.geometry.vertices.length}</dd></div><div><dt>Trojúhelníky</dt><dd>{previewSweep.geometry.faces.length}</dd></div></dl><div className="v2-preview-actions"><button className="dm-btn dm-btn--primary" type="button" onClick={commitSweepPreview}>Uložit koridor</button><button className="dm-btn dm-btn--ghost" type="button" onClick={() => { setPreviewSweep(null); setMessage("Náhled koridoru byl zrušen; revize se nezměnila."); }}>Zrušit náhled</button></div></section>}
        {tinDraftOpen && <section className="v2-preview-inspector" aria-label="Informace o náhledu TIN">
          <span className="v2-preview-badge">NÁHLED · TIN</span>
          <p>Zdroj: {tinSourcePoints.length} bodů s pevným číslováním. Obvod, otvory a povinné hrany můžete zadat níže.</p>
          <p className="v2-muted">Totožné souřadnice XYZ se pro výpočet spojí. Body se shodným XY a různou výškou patří do samostatných TIN povrchů.</p>
          {previewSurface && previewSurfaceAreas && <dl className="v2-derived-values">
            <div><dt>Body</dt><dd>{previewSurface.geometry.vertices.length}</dd></div>
            <div><dt>Trojúhelníky</dt><dd>{previewSurface.geometry.faces.length}</dd></div>
            <div><dt>Plocha XY</dt><dd>{previewSurfaceAreas.planM2.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²</dd></div>
            <div><dt>Skutečná plocha</dt><dd>{previewSurfaceAreas.surfaceM2.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²</dd></div>
            <div><dt>Tloušťka</dt><dd>Nemá · 0 m</dd></div>
          </dl>}
          <label>Max. délka hrany [m]<input type="number" min="0.001" max="10000000" step="0.001" value={tinMaximumEdgeLength} onChange={(event) => { setTinMaximumEdgeLength(event.currentTarget.value); setTinPreviewDirty(true); }} /></label>
          <TinConstraintsEditor points={tinSourcePoints} value={tinConstraints} onChange={(value) => { setTinConstraints(value); setTinPreviewDirty(true); }} />
          {tinPreviewDirty && <p role="status">Zadání se změnilo nebo výpočet selhal. Před uložením přepočítejte náhled.</p>}
          <button className="dm-btn dm-btn--ghost" type="button" onClick={createSurfacePreview}>Přepočítat náhled</button>
          <p className="v2-preview-help">TIN s omezeními zachovává celou zadanou oblast. Tloušťku přidáte vytvořením objemové vrstvy nad uloženým TIN.</p>
          <div className="v2-preview-actions"><button className="dm-btn dm-btn--primary" type="button" disabled={!previewSurface || tinPreviewDirty} onClick={commitSurfacePreview}>Uložit TIN</button><button className="dm-btn dm-btn--ghost" type="button" onClick={() => { setPreviewSurface(null); setTinSourcePoints([]); setMessage("Náhled TIN byl zrušen; revize se nezměnila."); }}>Zrušit náhled</button></div>
        </section>}
        {previewMaterialLayer && <section className="v2-preview-inspector" aria-label="Informace o náhledu objemové vrstvy"><span className="v2-preview-badge">NÁHLED · OBJEM</span><p>Objemová vrstva vzniká svislým odsazením uloženého TIN směrem dolů o zadanou tloušťku.</p><dl className="v2-derived-values"><div><dt>Materiál</dt><dd>{previewMaterialLayer.properties.material_code}</dd></div><div><dt>Plocha XY</dt><dd>{(previewMaterialLayer.properties.volume_m3 / previewMaterialLayer.properties.derivation.thickness_m).toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²</dd></div><div><dt>Tloušťka</dt><dd>{previewMaterialLayer.properties.derivation.thickness_m.toLocaleString("cs-CZ")} m</dd></div><div><dt>Objem</dt><dd>{previewMaterialLayer.properties.volume_m3.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m³</dd></div></dl><div className="v2-preview-actions"><button className="dm-btn dm-btn--primary" type="button" onClick={commitMaterialLayerPreview}>Uložit vrstvu</button><button className="dm-btn dm-btn--ghost" type="button" onClick={() => setPreviewMaterialLayer(null)}>Zrušit náhled</button></div></section>}
        <div className={selectionAction || tinDraftOpen || previewMaterialLayer || previewSweep ? "v2-inspector-content v2-inspector-content--hidden" : "v2-inspector-content"}>
        {selectedSurveyPoints.length === 1 && <div className="v2-selection-actions"><p className="dm-label">Práce s bodem</p><button type="button" onClick={() => { setSelectionAction(null); setRouteMatches([]); setCivilPointPanel("select-series"); }}>Vybrat celou osu</button></div>}
        {selectedProjectLayer && selectedSurveyPoints.length === selectedProjectLayer.objectIds.length && <div className="v2-selection-actions"><p className="dm-label">Správa bodové vrstvy</p><button type="button" onClick={() => { setSelectionLayerName(selectedProjectLayer.name); setCivilPointPanel(null); setSelectionAction("layer"); }}>Přejmenovat / přesunout</button><button className={layerDeleteConfirmation === selectedProjectLayer.id ? "v2-danger-action v2-danger-action--confirm" : "v2-danger-action"} type="button" onClick={deleteSelectedPointLayer}>{layerDeleteConfirmation === selectedProjectLayer.id ? "Potvrdit odstranění vrstvy" : "Odstranit vrstvu"}</button></div>}
        {selectedSurveyPoints.length === 2 && <dl className="v2-derived-values"><div><dt>Vodorovná délka</dt><dd>{Math.hypot(selectedSurveyPoints[1]!.geometry.point[0] - selectedSurveyPoints[0]!.geometry.point[0], selectedSurveyPoints[1]!.geometry.point[1] - selectedSurveyPoints[0]!.geometry.point[1]).toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m</dd></div><div><dt>Prostorová délka</dt><dd>{Math.hypot(...selectedSurveyPoints[1]!.geometry.point.map((value, index) => value - selectedSurveyPoints[0]!.geometry.point[index]!)).toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m</dd></div></dl>}
        {selectedSurveyPoints.length >= 2 && <div className="v2-selection-actions"><p className="dm-label">Práce s výběrem</p><button type="button" disabled={selectedSurveyPoints.length !== 2} title="Vyžaduje přesně dva referenční body" onClick={() => { closeSelectionOperation(); setRouteMatches([]); setCivilPointPanel("select-segment"); }}>Vybrat body mezi</button><button type="button" disabled={selectedSurveyPoints.length !== 2} title="Vyžaduje přesně dva body určující směr přímé řady" onClick={() => { closeSelectionOperation(); setRouteMatches([]); setCivilPointPanel("select-line"); }}>Vybrat přímou řadu</button><button type="button" onClick={() => { setCivilPointPanel(null); setSelectionAction("axis"); }}>Vytvořit osu</button><button type="button" onClick={() => { setCivilPointPanel(null); setSelectionAction("layer"); }}>Sloučit do vrstvy</button><button type="button" aria-keyshortcuts="Shift+D" onClick={() => openCopyOperation()}>Kopírovat</button><button type="button" disabled={selectedSurveyPoints.length !== 2} onClick={openSlopeSurface}>Šikmá plocha</button>{selectedSurveyPoints.length >= 3 && <button type="button" onClick={createSurfacePreview}>TIN z bodů</button>}</div>}
        {selected?.type === "rooms.room" && (
          <div className="v2-properties-form">
            <label>Název<input defaultValue={selected.properties.name ?? ""} key={`name-${selected.id}-${state.revision}`} maxLength={200} onBlur={(event) => patchSelected({ name: event.currentTarget.value.trim() || null })} /></label>
            <label>Výška [m]<input type="number" min="0.01" max="1000" step="0.01" defaultValue={selected.properties.height_m} key={`height-${selected.id}-${state.revision}`} onBlur={(event) => patchSelected({ height_m: Number(event.currentTarget.value) })} /></label>
            <label>Stav kontroly<select value={selected.properties.review_state} onChange={(event) => patchSelected({ review_state: event.currentTarget.value as RoomObject["properties"]["review_state"] })}><option value="unreviewed">Neověřeno</option><option value="confirmed">Potvrzeno</option><option value="corrected">Opraveno</option><option value="rejected">Vyřazeno</option></select></label>
            <label className="v2-check"><input type="checkbox" checked={selected.properties.included} onChange={(event) => patchSelected({ included: event.currentTarget.checked })} />Zahrnout do výkazu</label>
            <dl className="v2-derived-values">
              <div><dt>Objem</dt><dd>{(selected.properties.geometric_area_m2 * selected.properties.height_m).toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m³</dd></div>
              <div><dt>Úroveň podlahy</dt><dd>{selected.properties.floor_level_m.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m</dd></div>
            </dl>
            {tool === "polygon" && polygonEditable && (
              <div className="v2-vertices"><p className="dm-label">Vrcholy polygonu [m]</p>
                {selected.geometry.rings[0]?.map((point, index) => (
                  <div key={`${selected.id}-${index}`}><span className="dm-mono">{index + 1}</span><input aria-label={`Vrchol ${index + 1} X`} type="number" step="0.01" defaultValue={point[0]} key={`x-${state.revision}`} onBlur={(event) => editVertex(index, 0, event.currentTarget.value)} /><input aria-label={`Vrchol ${index + 1} Y`} type="number" step="0.01" defaultValue={point[1]} key={`y-${state.revision}`} onBlur={(event) => editVertex(index, 1, event.currentTarget.value)} /></div>
                ))}
              </div>
            )}
          </div>
        )}
        {selected && selected.type.startsWith("building.") && (
          <div className="v2-properties-form">
            <label>Typ<input readOnly value={selected.type} /></label>
            <label>Stav kontroly<select value={selected.properties.review_state} onChange={(event) => patchBuildingReview(event.currentTarget.value as BuildingObject["properties"]["review_state"])}>
              <option value="unreviewed" disabled>Neověřeno</option>
              <option value="confirmed" disabled={selected.properties.review_state === "rejected"}>Potvrzeno</option>
              <option value="corrected" disabled={selected.properties.review_state === "unreviewed" || selected.properties.review_state === "rejected"}>Opraveno</option>
              <option value="rejected" disabled={selected.properties.review_state === "rejected"}>Vyřazeno</option>
            </select></label>
            {selected.type === "building.wall" && <dl className="v2-derived-values"><div><dt>Délka</dt><dd>{selected.properties.length_m.toLocaleString("cs-CZ")} m</dd></div><div><dt>Hrubá plocha</dt><dd>{selected.properties.gross_side_area_m2.toLocaleString("cs-CZ")} m²</dd></div></dl>}
            {selected.type === "building.opening" && <dl className="v2-derived-values"><div><dt>Host stěna</dt><dd className="dm-mono">{selected.properties.host_wall_id}</dd></div><div><dt>Plocha</dt><dd>{selected.properties.area_m2.toLocaleString("cs-CZ")} m²</dd></div></dl>}
            {selected.type === "building.floor" && <dl className="v2-derived-values"><div><dt>Plocha</dt><dd>{selected.properties.area_m2.toLocaleString("cs-CZ")} m²</dd></div><div><dt>Objem</dt><dd>{selected.properties.volume_m3.toLocaleString("cs-CZ")} m³</dd></div></dl>}
          </div>
        )}
        {state.selection.length === 1 && selected && selected.type.startsWith("civil.") && (
          <div className="v2-properties-form">
            <label>Typ<input readOnly value={civilObjectLabels[selected.type] ?? selected.type} /></label>
            <label>Stav kontroly<input readOnly value={reviewStateLabels[selected.properties.review_state] ?? selected.properties.review_state} /></label>
            {selected.type === "civil.point" && <dl className="v2-derived-values"><div><dt>E / N / Z</dt><dd className="dm-mono">{selected.geometry.point.map((value) => value.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })).join(" / ")}</dd></div><div><dt>Původ</dt><dd>{selected.properties.derivation.kind}</dd></div></dl>}
            {selected.type === "civil.tin_surface" && selectedSurfaceAreas && <><div className="v2-object-explanation"><strong>TIN povrch</strong><p>Triangulovaná geometrická plocha bez tloušťky a bez objemu. Je odvozena ze zdrojových bodů; po jejich změně vytvořte TIN znovu.</p></div><dl className="v2-derived-values"><div><dt>Vrcholy</dt><dd>{selected.geometry.vertices.length}</dd></div><div><dt>Trojúhelníky</dt><dd>{selected.geometry.faces.length}</dd></div><div><dt>Plocha XY</dt><dd>{selectedSurfaceAreas.planM2.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²</dd></div><div><dt>Skutečná plocha</dt><dd>{selectedSurfaceAreas.surfaceM2.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²</dd></div><div><dt>Výškový rozsah</dt><dd>{(selected.geometry.bounds.max[2] - selected.geometry.bounds.min[2]).toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m</dd></div><div><dt>Tloušťka</dt><dd>Nemá · 0 m</dd></div></dl></>}
            {selected.type === "civil.tin_surface" && <div className="v2-properties-form" ref={materialFormRef}><button className="dm-btn dm-btn--ghost" type="button" onClick={() => {
              downloadText(createTinVerticesCsv(selected), `${safeSurveyExportStem(selected.properties.name)}-vrcholy.csv`, "text/csv;charset=utf-8");
              setMessage("CSV se souřadnicemi vrcholů plochy bylo připraveno.");
            }}>Exportovat CSV vrcholů</button><button className="dm-btn dm-btn--primary" type="button" onClick={openAssembly}>Skladba vozovky / souvrství</button><p className="dm-label">Vytvořit objemovou vrstvu</p><label>Název vrstvy<input value={materialLayerInput.name} onChange={(event) => setMaterialLayerInput({ ...materialLayerInput, name: event.currentTarget.value })} /></label><label>Kód materiálu<input value={materialLayerInput.code} onChange={(event) => setMaterialLayerInput({ ...materialLayerInput, code: event.currentTarget.value })} /></label><label>Svislá tloušťka [m]<input type="number" min="0.001" max="1000" step="0.001" value={materialLayerInput.thickness} onChange={(event) => setMaterialLayerInput({ ...materialLayerInput, thickness: event.currentTarget.value })} /></label><button className="dm-btn dm-btn--primary" type="button" disabled={Boolean(previewMaterialLayer)} onClick={createMaterialLayerPreview}>Vytvořit náhled vrstvy</button><button className={objectDeleteConfirmation === selected.id ? "dm-btn v2-danger-action v2-danger-action--confirm" : "dm-btn v2-danger-action"} type="button" onClick={deleteSelectedCivilObject}>{objectDeleteConfirmation === selected.id ? "Potvrdit odstranění TIN" : "Odstranit TIN"}</button></div>}
            {selected.type === "civil.material_layer" && <><dl className="v2-derived-values"><div><dt>Materiál</dt><dd>{selected.properties.material_code}</dd></div><div><dt>Směr tloušťky</dt><dd>Svisle dolů</dd></div><div><dt>Zdrojový TIN</dt><dd>{state.objects.find((object): object is TinSurfaceObject => object.type === "civil.tin_surface" && object.id === selected.properties.derivation.top_surface_id)?.properties.name ?? "Zdroj nenalezen"}</dd></div><div><dt>Plocha XY</dt><dd>{(selected.properties.volume_m3 / selected.properties.derivation.thickness_m).toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m²</dd></div><div><dt>Tloušťka</dt><dd>{selected.properties.derivation.thickness_m.toLocaleString("cs-CZ")} m</dd></div><div><dt>Objem</dt><dd>{selected.properties.volume_m3.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m³</dd></div><div><dt>Trojúhelníky</dt><dd>{selected.geometry.faces.length}</dd></div></dl><p className="v2-muted">Hloubka pod horním TIN: {(selected.properties.derivation.top_offset_m ?? 0).toLocaleString("cs-CZ", { maximumFractionDigits: 3 })} m</p>{selected.properties.derivation.assembly ? <button className="dm-btn dm-btn--primary" type="button" onClick={openAssembly}>Upravit skladbu</button> : <label>Svislá tloušťka [m] · přepočítá objem<input type="number" min="0.001" max="1000" step="0.001" defaultValue={selected.properties.derivation.thickness_m} key={`material-thickness-${selected.id}-${state.revision}`} onBlur={(event) => updateSelectedMaterialThickness(event.currentTarget.value)} /></label>}<button className={objectDeleteConfirmation === selected.id ? "dm-btn v2-danger-action v2-danger-action--confirm" : "dm-btn v2-danger-action"} type="button" onClick={deleteSelectedCivilObject}>{objectDeleteConfirmation === selected.id ? "Potvrdit odstranění" : selected.properties.derivation.assembly ? "Odstranit celou skladbu" : "Odstranit objemovou vrstvu"}</button></>}
            {selected.type === "civil.axis" && <><dl className="v2-derived-values"><div><dt>Začátek</dt><dd>{selected.properties.start_station_m.toLocaleString("cs-CZ")} m</dd></div><div><dt>Délka</dt><dd>{selected.properties.length_m.toLocaleString("cs-CZ")} m</dd></div></dl><button className="dm-btn dm-btn--primary" type="button" onClick={openSlopeSurface}>Vytvořit šikmou plochu</button></>}
            {selected.type === "civil.profile" && <dl className="v2-derived-values"><div><dt>Osa</dt><dd className="dm-mono">{selected.properties.axis_id}</dd></div><div><dt>Vzorky</dt><dd>{selected.properties.samples.length}</dd></div></dl>}
            {selected.type === "civil.sweep" && <dl className="v2-derived-values"><div><dt>Vrcholů</dt><dd>{selected.geometry.vertices.length}</dd></div><div><dt>Faces</dt><dd>{selected.geometry.faces.length}</dd></div></dl>}
          </div>
        )}
        {state.selection.length === 1 && selected?.type === "stakeout.point" && (
          <div className="v2-properties-form">
            <label>Název<input readOnly={selected.properties.derivation.kind !== "manual"} defaultValue={selected.properties.name} key={`stakeout-name-${selected.id}-${state.revision}`} maxLength={200} onBlur={(event) => patchStakeoutPoint((point) => { point.properties.name = event.currentTarget.value.trim() || point.properties.name; })} /></label>
            <label>Kód<input readOnly={selected.properties.derivation.kind !== "manual"} defaultValue={selected.properties.code} key={`stakeout-code-${selected.id}-${state.revision}`} maxLength={50} pattern="[A-Za-z0-9][A-Za-z0-9._-]*" onBlur={(event) => patchStakeoutPoint((point) => { point.properties.code = event.currentTarget.value.trim() || point.properties.code; })} /></label>
            {(["E", "N", "Z"] as const).map((label, axis) => <label key={label}>{label} [m]<input readOnly={selected.properties.derivation.kind !== "manual"} type="number" step="0.001" defaultValue={selected.geometry.point[axis]} key={`stakeout-${label}-${selected.id}-${state.revision}`} onBlur={(event) => {
              const value = Number(event.currentTarget.value);
              if (!Number.isFinite(value)) { setMessage("Souřadnice bodu musí být konečné číslo."); return; }
              patchStakeoutPoint((point) => { point.geometry.point[axis] = value; });
            }} /></label>)}
            <label>Stav kontroly<select value={selected.properties.review_state} onChange={(event) => patchStakeoutReview(event.currentTarget.value as StakeoutPointObject["properties"]["review_state"])}><option value="unreviewed" disabled>Neověřeno</option><option value="confirmed" disabled={selected.properties.review_state === "rejected"}>Potvrzeno</option><option value="corrected" disabled={selected.properties.review_state === "unreviewed" || selected.properties.review_state === "rejected"}>Opraveno</option><option value="rejected" disabled={selected.properties.review_state === "rejected"}>Vyřazeno</option></select></label>
            <dl className="v2-derived-values"><div><dt>CRS</dt><dd>EPSG:{selected.properties.crs.epsg}</dd></div><div><dt>Původ</dt><dd>{selected.properties.derivation.kind}</dd></div><div><dt>Přesnost H/V</dt><dd>{selected.properties.accuracy.horizontal_m} / {selected.properties.accuracy.vertical_m} m</dd></div></dl>
          </div>
        )}
        {state.selection.length === 1 && selected?.type === "stakeout.group" && (
          <div className="v2-properties-form">
            <label>Název<input defaultValue={selected.properties.name} key={`stakeout-group-name-${selected.id}-${state.revision}`} maxLength={200} onBlur={(event) => { const updated = structuredClone(selected); updated.properties.name = event.currentTarget.value.trim() || updated.properties.name; applyObject(updated); }} /></label>
            <label>Stav kontroly<select value={selected.properties.review_state} onChange={(event) => patchStakeoutReview(event.currentTarget.value as StakeoutGroupObject["properties"]["review_state"])}><option value="unreviewed" disabled>Neověřeno</option><option value="confirmed" disabled={selected.properties.review_state === "rejected"}>Potvrzeno</option><option value="corrected" disabled={selected.properties.review_state === "unreviewed" || selected.properties.review_state === "rejected"}>Opraveno</option><option value="rejected" disabled={selected.properties.review_state === "rejected"}>Vyřazeno</option></select></label>
            <fieldset><legend className="dm-label">Členové v explicitním pořadí</legend>{state.objects.filter((object): object is StakeoutPointObject => object.type === "stakeout.point").slice(0, MAX_REVIEW_CANDIDATES).map((point) => <label className="v2-check" key={point.id}><input type="checkbox" checked={selected.properties.point_ids.includes(point.id)} onChange={(event) => {
              const updated = structuredClone(selected);
              updated.properties.point_ids = event.currentTarget.checked
                ? [...updated.properties.point_ids, point.id]
                : updated.properties.point_ids.filter((id) => id !== point.id);
              if (!updated.properties.point_ids.length) { setMessage("Skupina musí obsahovat alespoň jeden bod."); return; }
              applyObject(updated);
            }} />{point.properties.code} · {point.properties.name}</label>)}</fieldset>
            <dl className="v2-derived-values"><div><dt>CRS</dt><dd>EPSG:{selected.properties.crs.epsg}</dd></div><div><dt>Body</dt><dd>{selected.properties.point_ids.length}</dd></div></dl>
          </div>
        )}
        </div>
        <p className="v2-save-status" role={connection === "error" ? "alert" : "status"} aria-live="polite">{message ?? (localOnly ? "Místní model a výměry" : "Autoritativní výměry potvrzuje serverová validace.")}</p>
        </>}
      </aside>
    </main>
  );
}

function ApplicationRoutes() {
  const [theme, setTheme] = useState<AppTheme>(() => readAppTheme(window.localStorage));
  useEffect(() => {
    try {
      writeAppTheme(window.localStorage, document.documentElement, theme);
    } catch {
      applyAppTheme(document.documentElement, theme);
    }
  }, [theme]);

  const parameters = new URLSearchParams(window.location.search);
  if (parameters.has("workspace")) return <ProjectWorkspace theme={theme} onThemeChange={setTheme} />;
  const opensEditor = parameters.has("localProject")
    || parameters.has("projectType")
    || (!localOnly && (parameters.has("project") || parameters.has("version")));
  if (opensEditor) return <EditorApp theme={theme} onThemeChange={setTheme} />;
  const projectListType = parameters.get("projects");
  return isProjectType(projectListType)
    ? <ProjectHub projectType={projectListType} theme={theme} onThemeChange={setTheme} />
    : <WelcomeScreen theme={theme} onThemeChange={setTheme} />;
}

export function App() {
  return <WorkspaceGate><ApplicationRoutes /></WorkspaceGate>;
}
