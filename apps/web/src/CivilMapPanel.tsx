import { TerrainHeightCheck } from "./TerrainHeightCheck";
import { surveyTerrainFrom, surveyTerrainChanged } from "./terrain-reference";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelObject } from "@datamine/contracts";
import { GRID_SIZE, terrainGridSize, isSurveyTerrain, terrainElevations, MAP_LAYERS, loadMapImage, loadTerrain, mapBoundsFor, type MapContext, type MapLayer } from "./civil-map";

export function CivilMapPanel({ objects, allObjects, context, onContext, onClose, hasCadTransform, canSave }: {
  readonly objects: readonly ModelObject[];
  readonly allObjects: readonly ModelObject[];
  readonly context: MapContext | null;
  readonly onContext: (context: MapContext | null) => void;
  readonly onClose: () => void;
  readonly hasCadTransform: boolean;
  readonly canSave: boolean;
}) {
  const [sourceId, setSourceId] = useState(context && isSurveyTerrain(context.terrain) ? context.terrain.source_object_id : "cuzk");
  const surfaces = allObjects.filter((object) => object.type === "civil.tin_surface");
  const source = surfaces.find((object) => object.id === sourceId);
  const changed = useMemo(() => !!context && isSurveyTerrain(context.terrain) && surveyTerrainChanged(context.terrain, allObjects), [context, allObjects]);
  const [margin, setMargin] = useState(String(context?.margin ?? 50));
  const [layer, setLayer] = useState<MapLayer>(context?.layer ?? "ortho");
  const [detail, setDetail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  let bounds: ReturnType<typeof mapBoundsFor> | null = null, problem: string | null = null;
  try {
    if (hasCadTransform) throw new Error("Mapový podklad zatím není dostupný v pohledu s lokální transformací CAD. Použijte model v původních zeměměřických souřadnicích.");
    if (sourceId !== "cuzk" && !source) throw new Error("Zdrojový TIN chybí. Vyberte dostupný terén; uložený podklad zůstává zachován.");
    // Match the viewport guard: a valid reference cannot repair mixed/local model coordinates.
    if (source) mapBoundsFor(objects, 10);
    bounds = mapBoundsFor(source ? [source] : objects, Number(margin));
    if (source) surveyTerrainFrom(source, bounds);
  } catch (e) { problem = e instanceof Error ? e.message : "Nelze určit polohu modelu."; }
  const requestBounds = bounds;
  const gridSize = bounds ? terrainGridSize(bounds, detail) : GRID_SIZE;
  const load = async (imageOnly = false) => {
    const targetBounds = imageOnly && context ? context.terrain.bounds : requestBounds;
    if (!targetBounds) return;
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    setBusy(true); setRows(0); setError(null);
    try {
      const raster = await loadMapImage(targetBounds, layer, controller.signal);
      const terrain = imageOnly && context ? context.terrain : source ? surveyTerrainFrom(source, targetBounds) : await loadTerrain(targetBounds, controller.signal, setRows, gridSize);
      if (!controller.signal.aborted) onContext({ ...raster, terrain, version: 1, layer, visible: true,
        margin: imageOnly && context ? context.margin : Number(margin), loaded_at: new Date().toISOString(), opacity: context?.opacity ?? 0.7 });
    } catch (e) {
      const cancelled = controller.signal.aborted;
      controller.abort();
      if (abort.current === controller) setError(cancelled ? "Načítání bylo zrušeno nebo vypršel čas. Zkuste to znovu." : e instanceof Error ? e.message : "Podklad ČÚZK se nepodařilo načíst.");
    } finally { window.clearTimeout(timeout); if (abort.current === controller) setBusy(false); }
  };
  const valid = context ? terrainElevations(context.terrain).filter((z): z is number => z !== null) : [];
  const step = context && !isSurveyTerrain(context.terrain) ? (context.terrain.bounds[2] - context.terrain.bounds[0]) / (context.terrain.size - 1) : 0;
  return <section className="v2-point-panel v2-inspector-operation" aria-label="Mapa a terén">
    <div className="v2-point-panel__tabs"><h2>Mapa a terén</h2><button type="button" className="v2-tool" onClick={onClose}>Zavřít</button></div>
    <p>Mapa a referenční terén · EPSG:5514 · výšky Bpv. Model se zobrazí na svých původních souřadnicích XYZ.</p>
    <label>Zdroj výšek<select value={sourceId} disabled={busy} onChange={(e) => setSourceId(e.currentTarget.value)}><option value="cuzk">ČÚZK · DMR 5G</option>{surfaces.map((surface) => <option key={surface.id} value={surface.id}>TIN · {surface.properties.name}</option>)}</select></label>
    <details><summary>Jak vybrat přesný terén</summary><p className="v2-muted">Pro přesnější osazení importujte zaměřený terén od geodeta (LandXML) a vyberte jeho TIN. Ověřte, že jde o stávající terén, nikoli návrhovou konstrukci. Přesnost určuje kvalita zaměření.</p></details>
    {sourceId !== "cuzk" && <p>Původní trojúhelníky zůstanou beze změny. Mapa se položí pouze na rozsah TIN; mimo něj se terén nedomýšlí. ČÚZK obdrží jen rozsah obrázku, žádné výšky zaměření.</p>}
    {changed && <p role="alert">Zdrojový TIN se změnil nebo byl odstraněn. Zobrazen je uložený snapshot; pro jeho nahrazení vyberte zdroj a znovu načtěte podklad.</p>}
    <label>Mapová vrstva<select value={layer} disabled={busy} onChange={(e) => setLayer(e.currentTarget.value as MapLayer)}>{Object.entries(MAP_LAYERS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
    {context && layer !== context.layer && <button type="button" className="dm-btn dm-btn--primary" disabled={busy} onClick={() => void load(true)}>Použít vrstvu na načtený terén</button>}
    {layer === "topographic" && <p className="v2-muted">Mapa 1 : 10 000 je vhodná pro širší okolí; při velkém přiblížení má omezené detaily.</p>}
    {sourceId === "cuzk" && <label>Podrobnost terénu<select value={detail ? "detail" : "quick"} disabled={busy} onChange={(e) => setDetail(e.currentTarget.value === "detail")}><option value="detail">Podrobný · krok od 2 m</option><option value="quick">Rychlý · 31 × 31 bodů</option></select></label>}
    {sourceId === "cuzk" && bounds && <p className="v2-muted">Po načtení: {gridSize} × {gridSize} bodů, krok {((bounds[2] - bounds[0]) / (gridSize - 1)).toFixed(2)} m. Hustší síť nezvyšuje přesnost zdrojového měření.</p>}
    <label>Okolí modelu [m]<input type="number" min="10" max="200" step="10" value={margin} disabled={busy} onChange={(e) => setMargin(e.currentTarget.value)} /></label>
    {problem ? <p role="alert">{problem}</p> : bounds && <p className="dm-mono">Oblast {Math.round(bounds[2] - bounds[0])} × {Math.round(bounds[3] - bounds[1])} m</p>}
    <p className="v2-muted">Načtením odešlete souřadnice zobrazené oblasti přímo ČÚZK. Názvy projektu a dokumenty se neposílají. {canSave ? "Tlačítko Uložit projekt uchová i obrázek mapy, výšky a nastavení. Příště se obnoví bez stahování z ČÚZK." : "V ukázkovém modelu je podklad dočasný. Pro trvalé uložení otevřete vlastní projekt."}</p>
    <button type="button" className="dm-btn dm-btn--primary" disabled={!!problem || busy} onClick={() => void load()}>{busy ? source ? "Načítání mapy na TIN…" : `Načítání podkladu · terén ${rows}/${gridSize}` : source ? "Použít TIN a načíst mapu" : context ? "Obnovit oblast z ČÚZK" : "Načíst mapu a terén z ČÚZK"}</button>
    {busy && <button type="button" className="v2-tool" onClick={() => abort.current?.abort()}>Zrušit načítání</button>}
    {error && <p role="alert">{error}</p>}
    {context && <>
      <label>Průhlednost podkladu <output>{Math.round((1 - context.opacity) * 100)} %</output><input aria-label="Průhlednost mapy a terénu" disabled={busy} type="range" min="0" max="95" step="1" value={Math.round((1 - context.opacity) * 100)} onChange={(e) => onContext({ ...context, opacity: 1 - Number(e.currentTarget.value) / 100 })} /></label>
      <p>{MAP_LAYERS[context.layer].label} · načteno {new Date(context.loaded_at).toLocaleString("cs-CZ")}</p>
      <p role="status">{isSurveyTerrain(context.terrain) ? `TIN: ${context.terrain.source_name}, ${valid.length} vrcholů, ${context.terrain.faces.length} trojúhelníků.` : `Podklad načten: ${valid.length} výšek, krok sítě ${step.toFixed(2)} m.`} Výšky {Math.min(...valid).toFixed(2)} až {Math.max(...valid).toFixed(2)} m Bpv.</p>
      {!isSurveyTerrain(context.terrain) && valid.length !== context.terrain.size * context.terrain.size && <p role="alert">Část území nemá výšková data; v podkladu zůstávají mezery.</p>}
      <TerrainHeightCheck terrain={context.terrain} objects={allObjects} />
      <button type="button" className="v2-tool" disabled={busy} onClick={() => onContext({ ...context, visible: !context.visible })}>{context.visible ? "Skrýt mapu a terén" : "Zobrazit uloženou mapu a terén"}</button>
      <button type="button" className="v2-tool" disabled={busy} onClick={() => onContext(null)}>Odebrat podklad z projektu</button>
      <p>„Půdorys“ ukáže polohu na mapě, „Izometrie“ prostorové osazení. Průhlednost odkryje konstrukce pod terénem.</p>
    </>}
    {((context && !isSurveyTerrain(context.terrain)) || (!context && sourceId === "cuzk")) && <small>Orientační okolí z rastru DMR 5G (zdroj 2 m), síť nejvýše 151 × 151. Přesnost závisí na zdroji a jeho stáří. Nenahrazuje aktuální zaměření ani podklad pro výkaz zemních prací. Výšky konstrukce se automaticky neposouvají.</small>}
    {((context && !isSurveyTerrain(context.terrain)) || (!context && sourceId === "cuzk")) && <a href="https://ags.cuzk.gov.cz/arcgis2/rest/services/dmr5g/ImageServer" target="_blank" rel="noreferrer">DMR 5G © ČÚZK</a>}
    <a href={MAP_LAYERS[context?.layer ?? layer].source} target="_blank" rel="noreferrer">{MAP_LAYERS[context?.layer ?? layer].label} © ČÚZK</a>
  </section>;
}
