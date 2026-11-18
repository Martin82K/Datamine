import { useEffect, useRef, useState } from "react";
import type { ModelObject } from "@datamine/contracts";
import type { LocalProject } from "./local-projects";
import { getProjectFile } from "./project-files";
import { rasterizeDrawing, type DrawingRaster } from "./drawing-raster";
import { drawingAnchorsChanged, drawingTransform, storedDrawingUnderlay, type DrawingControlPoint, type DrawingUnderlay, type XY } from "./drawing-underlay";
import { mapBoundsFor } from "./civil-map";

interface DraftAnchor { pixel: XY | null; x: string; y: string; modelId: string }
const emptyAnchor = (): DraftAnchor => ({ pixel: null, x: "", y: "", modelId: "" });

export function DrawingUnderlayDialog({ context, objects, project, onApply, onClose }: {
  readonly context: DrawingUnderlay | null;
  readonly objects: readonly ModelObject[];
  readonly project: LocalProject | null;
  readonly onApply: (drawing: DrawingUnderlay | null) => void;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const fileRef = useRef<File | null>(null);
  const [raster, setRaster] = useState<DrawingRaster | null>(context);
  const [anchors, setAnchors] = useState<DraftAnchor[]>(() => [0, 1, 2].map((i) => {
    const p = context?.control_points[i];
    return p ? { pixel: p.pixel, x: String(p.world[0]), y: String(p.world[1]), modelId: p.model_point_id ?? "" } : emptyAnchor();
  }));
  const [active, setActive] = useState(0);
  const [elevation, setElevation] = useState(String(context?.elevation ?? objects.flatMap((o) => o.type === "civil.point" || o.type === "stakeout.point" ? [o.geometry.point[2]] : [])[0] ?? 0));
  const [opacity, setOpacity] = useState(context?.opacity ?? 0.65);
  const [visible, setVisible] = useState(context?.visible ?? true);
  const [pageNumber, setPageNumber] = useState(String(context?.page_number ?? 1));
  const [projectFile, setProjectFile] = useState("");
  const [zoom, setZoom] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => { controller.current?.abort(); element.close(); };
  }, []);
  const points = objects.filter((o) => o.type === "civil.point" || o.type === "stakeout.point");
  const files = project?.files.filter((f) => /\.(pdf|png|jpe?g)$/i.test(f.name)) ?? [];
  let coordinateProblem: string | null = null;
  try { mapBoundsFor(objects, 10); } catch (e) { coordinateProblem = e instanceof Error ? e.message : "Neplatné souřadnice modelu."; }
  const changed = context && drawingAnchorsChanged(context, objects);
  const updateAnchor = (index: number, update: Partial<DraftAnchor>) => setAnchors((current) => current.map((a, i) => i === index ? { ...a, ...update } : a));
  const loadFile = async (file: File | null, fromProject = false) => {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 60_000);
    setBusy(true); setError(null);
    try {
      if (fromProject && project) {
        const metadata = files.find((f) => f.id === projectFile);
        if (!metadata) throw new Error("Vyberte projektový soubor.");
        file = new File([await getProjectFile(project.id, metadata)], metadata.name, { type: metadata.media_type });
      }
      if (!file) throw new Error("Nejprve vyberte PDF nebo obrázek.");
      fileRef.current = file;
      const image = await rasterizeDrawing(file, Number(pageNumber), abort.signal);
      if (abort.signal.aborted) return;
      setRaster(image); setAnchors([emptyAnchor(), emptyAnchor(), emptyAnchor()]); setActive(0); setZoom(100);
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Podklad se nepodařilo načíst.");
      else if (controller.current === abort) setError("Načítání bylo zrušeno nebo vypršel čas.");
    } finally { window.clearTimeout(timer); if (controller.current === abort) setBusy(false); }
  };
  const parsed: DrawingControlPoint[] = [];
  let problem: string | null = null;
  for (const [i, a] of anchors.entries()) {
    if (i === 2 && !a.pixel && !a.x && !a.y) break;
    if (!a.pixel || !a.x.trim() || !a.y.trim() || ![Number(a.x), Number(a.y)].every(Number.isFinite)) { problem = `Doplňte bod ${"ABC"[i]} v obrázku i jeho X/Y v modelu.`; break; }
    parsed.push({ pixel: a.pixel, world: [Number(a.x), Number(a.y)], ...(a.modelId ? { model_point_id: a.modelId } : {}) });
  }
  let transform: ReturnType<typeof drawingTransform> | null = null;
  try { if (!problem) transform = drawingTransform(parsed); } catch (e) { problem = e instanceof Error ? e.message : "Vazbu nelze vypočítat."; }
  const apply = () => {
    try {
      if (!raster || problem || coordinateProblem || !elevation.trim()) throw new Error(problem ?? coordinateProblem ?? "Načtěte podklad a zadejte výšku.");
      const drawing: DrawingUnderlay = { ...raster, version: 1, control_points: parsed, elevation: Number(elevation), opacity, visible };
      storedDrawingUnderlay(drawing);
      onApply(drawing); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Připnutí nelze použít."); }
  };
  return <dialog ref={dialog} className="v2-drawing-dialog" aria-labelledby="drawing-title" onKeyDown={(e) => e.stopPropagation()} onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <header><div><h2 id="drawing-title">Připnout situaci k modelu</h2><p>Dva odpovídající body určí polohu, natočení a měřítko podkladu.</p></div><button type="button" className="v2-tool" onClick={onClose}>Zavřít připnutí</button></header>
    <div className="v2-drawing-layout">
      <div className="v2-drawing-preview-column">
        <div className="v2-drawing-source">
          <label>PDF nebo obrázek<input type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={busy} onChange={(e) => { const file = e.currentTarget.files?.[0]; if (file) void loadFile(file); e.currentTarget.value = ""; }} /></label>
          <label>Strana PDF<input type="number" min="1" max="1000" value={pageNumber} disabled={busy} onChange={(e) => setPageNumber(e.currentTarget.value)} /></label>
          <button type="button" className="v2-tool" disabled={busy || !fileRef.current || !/\.pdf$/i.test(fileRef.current.name)} onClick={() => void loadFile(fileRef.current)}>Načíst stranu PDF</button>
        </div>
        {!!files.length && <div className="v2-drawing-source"><label>Ze souborů projektu<select value={projectFile} disabled={busy} onChange={(e) => setProjectFile(e.currentTarget.value)}><option value="">Vyberte podklad…</option>{files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><button type="button" className="v2-tool" disabled={busy || !projectFile} onClick={() => void loadFile(null, true)}>Načíst projektový podklad</button></div>}
        {busy && <p role="status">Připravuji náhled… <button type="button" className="v2-tool" onClick={() => controller.current?.abort()}>Zrušit načítání podkladu</button></p>}
        {raster ? <>
          <p>{raster.source_name}{raster.page_number ? ` · strana ${raster.page_number}` : ""} · kliknutím označte bod {"ABC"[active]}.</p>
          <label>Přiblížení náhledu <input type="range" min="100" max="400" step="25" value={zoom} onChange={(e) => setZoom(Number(e.currentTarget.value))} /> {zoom} %</label>
          <div className="v2-drawing-preview"><div className="v2-drawing-sheet" style={{ width: `${zoom}%` }} onClick={(e) => {
            if (busy) return;
            const box = e.currentTarget.getBoundingClientRect();
            updateAnchor(active, { pixel: [Math.max(0, Math.min(raster.pixel_width, (e.clientX - box.left) / box.width * raster.pixel_width)), Math.max(0, Math.min(raster.pixel_height, (e.clientY - box.top) / box.height * raster.pixel_height))] });
          }}><img src={raster.image_data_url} alt="Náhled situace pro výběr vazebních bodů" draggable={false} />{anchors.map((a, i) => a.pixel && <span key={i} className={`v2-drawing-marker${active === i ? " v2-drawing-marker--active" : ""}`} style={{ left: `${a.pixel[0] / raster.pixel_width * 100}%`, top: `${a.pixel[1] / raster.pixel_height * 100}%` }}>{"ABC"[i]}</span>)}</div></div>
        </> : <div className="v2-drawing-empty">Vyberte půdorys nebo situaci. Podporované jsou PDF, PNG a JPEG.</div>}
        <p className="v2-muted">Uloží se zobrazená stránka a přiřazení bodů. Původní PDF můžete samostatně uchovat v Souborech projektu.</p>
      </div>
      <div className="v2-drawing-controls">
        {coordinateProblem && <p role="alert">{coordinateProblem}</p>}
        {changed && <p role="alert">Přiřazený bod modelu se změnil nebo byl odstraněn. Znovu vyberte odpovídající body před použitím vazby.</p>}
        {anchors.map((a, index) => <fieldset key={index} disabled={busy}><legend><button type="button" className="v2-tool" aria-pressed={active === index} onClick={() => setActive(index)}>Bod {"ABC"[index]}{index === 2 ? " · kontrolní" : ""}</button></legend>
          <label>Bod {"ABC"[index]} v modelu<select value={a.modelId} onChange={(e) => {
            const id = e.currentTarget.value, point = points.find((p) => p.id === id);
            updateAnchor(index, point ? { modelId: id, x: String(point.geometry.point[0]), y: String(point.geometry.point[1]) } : { modelId: "" });
          }}><option value="">Zadat X/Y ručně</option>{points.map((p) => <option key={p.id} value={p.id}>{p.properties.name} · {p.geometry.point[0].toFixed(2)}, {p.geometry.point[1].toFixed(2)}</option>)}</select></label>
          <div className="v2-drawing-pair">{(["x", "y"] as const).map((axis) => <label key={axis}>{axis === "x" ? "X · východ [m]" : "Y · sever [m]"}<input aria-label={`Bod ${"ABC"[index]} ${axis.toUpperCase()}`} type="number" step="any" value={a[axis]} onChange={(e) => updateAnchor(index, { [axis]: e.currentTarget.value, modelId: "" })} /></label>)}</div>
          <div className="v2-drawing-pair">{([0, 1] as const).map((axis) => <label key={axis}>Obrázek {axis === 0 ? "X" : "Y"} [px]<input aria-label={`Bod ${"ABC"[index]} pixel ${axis === 0 ? "X" : "Y"}`} type="number" step="any" min="0" value={a.pixel?.[axis] ?? ""} onChange={(e) => {
            const point: [number, number] = [...(a.pixel ?? [0, 0])]; point[axis] = Number(e.currentTarget.value); updateAnchor(index, { pixel: point });
          }} /></label>)}</div>
          {index === 2 && <button type="button" className="v2-tool" onClick={() => updateAnchor(2, emptyAnchor())}>Vynechat kontrolní bod</button>}
        </fieldset>)}
        {transform && <p role="status">Měřítko {transform.scale.toFixed(5)} m/px · natočení {transform.rotation.toFixed(2)}°.<br />{transform.residual === null ? "Přesnost zatím není ověřena třetím bodem." : `Odchylka kontrolního bodu: ${transform.residual.toFixed(3)} m.`}</p>}
        {transform?.residual !== null && transform?.residual !== undefined && transform.residual > 0.1 && <p role="alert">Odchylka přesahuje 0,10 m. Ověřte výběr bodů a případné zkreslení skenu.</p>}
        <label>Výška podkladu [m Bpv]<input type="number" step="any" min="-100" max="2000" value={elevation} onChange={(e) => setElevation(e.currentTarget.value)} /></label>
        <label>Průhlednost situace <input type="range" min="0" max="95" value={Math.round((1 - opacity) * 100)} onChange={(e) => setOpacity((100 - Number(e.currentTarget.value)) / 100)} />{Math.round((1 - opacity) * 100)} %</label>
        <label><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.currentTarget.checked)} /> Zobrazit situaci ve 3D</label>
        <p className="v2-muted">Situace tvoří rovinu v zadané výšce. Upravuje se její poloha, souřadnice konstrukce zůstávají zachované.</p>
      </div>
    </div>
    <footer>{error ? <p role="alert">{error}</p> : problem && <p>{problem}</p>}<div>{context && <button type="button" className="v2-tool" disabled={busy} onClick={() => { onApply(null); onClose(); }}>Odebrat připnutou situaci</button>}<button type="button" className="v2-tool" onClick={onClose}>Zrušit změny</button><button type="button" className="dm-btn dm-btn--primary" disabled={busy || !raster || !!problem || !!coordinateProblem} onClick={apply}>Použít připnutí</button></div><small>Potom změny potvrďte tlačítkem Uložit projekt.</small></footer>
  </dialog>;
}
