import { useMemo, useState } from "react";
import type { ModelObject } from "@datamine/contracts";
import { pointMeasurementAnchor, type MeasurementAnchor, type MeasurementPoint } from "./civil-measurement";
import { createCivilSection, type CivilSection, type SectionPoint } from "./civil-sections";
import { createSectionPlan } from "./civil-section-plan";

interface Props {
  readonly objects: readonly ModelObject[];
  readonly points: readonly MeasurementPoint[];
  readonly anchors: readonly MeasurementAnchor[];
  readonly hiddenLayerIds: ReadonlySet<string>;
  readonly colors: Readonly<Record<string, string>>;
  readonly onAnchors: (anchors: readonly MeasurementAnchor[]) => void;
  readonly onClose: () => void;
}
const format = (value: number) => value.toLocaleString("cs-CZ", { maximumFractionDigits: 3 });

function SectionPlanChart({ objects, a, b, colors }: { objects: Props["objects"]; a: MeasurementAnchor; b: MeasurementAnchor; colors: Props["colors"] }) {
  const [focusOnCut, setFocusOnCut] = useState(true);
  const plan = useMemo(() => createSectionPlan(objects, [a.geometry.point[0], a.geometry.point[1]], [b.geometry.point[0], b.geometry.point[1]], focusOnCut), [objects, a, b, focusOnCut]);
  if (!plan) return <p role="status">Půdorysný náhled nelze zobrazit v limitu 100 000 vrcholů.</p>;
  const angle = Math.atan2(plan.b[1] - plan.a[1], plan.b[0] - plan.a[0]) * 180 / Math.PI;
  return <><svg className="v2-section-chart" viewBox="0 0 340 210" role="img" aria-label="Poloha řezu A–B v půdorysu">
    <title>Půdorys: směr řezu od A do B; +X doprava, +Y nahoru. Tečky jsou zjednodušený náhled bodů a vrcholů viditelných vrstev.</title>
    {plan.points.map((p, i) => <circle key={i} cx={p.xy[0]} cy={p.xy[1]} r="1.6" fill={colors[p.layerId] ?? "#94a3b8"} opacity="0.6" />)}
    <line x1={plan.a[0]} y1={plan.a[1]} x2={plan.b[0]} y2={plan.b[1]} stroke="currentColor" strokeWidth="2" />
    <circle cx={plan.a[0]} cy={plan.a[1]} r="4" fill="currentColor" />
    <path d="M0,0 L-10,-5 L-10,5 Z" transform={`translate(${plan.b.join(" ")}) rotate(${angle})`} fill="currentColor" />
    {([plan.a, plan.b] as const).map((p, i) => <text key={i} x={p[0]} y={p[1] - 10} textAnchor="middle" fill="currentColor">{i === 0 ? "A" : "B"}</text>)}
    <text x="8" y="201">+Y ↑ · +X →</text><text x="332" y="201" textAnchor="end">{focusOnCut ? "Detail řezu" : "Celý půdorys"} · A → B</text>
  </svg><button className="dm-btn dm-btn--ghost" type="button" onClick={() => setFocusOnCut((value) => !value)}>{focusOnCut ? "Zobrazit celý půdorys" : "Přiblížit k řezu"}</button></>;
}

function SectionChart({ section, colors, exaggeration }: {
  section: CivilSection; colors: Props["colors"]; exaggeration: number;
}) {
  const elevations = section.traces.flatMap((trace) => trace.segments.flatMap((segment) => segment.map((p) => p[1])));
  const minZ = elevations.reduce((min, value) => Math.min(min, value), Infinity);
  const maxZ = elevations.reduce((max, value) => Math.max(max, value), -Infinity);
  if (!elevations.length) return <p role="status">Řez neprotíná žádný viditelný povrch ani materiálovou vrstvu.</p>;
  const scale = Math.min(240 / section.lengthM, 160 / Math.max((maxZ - minZ) * exaggeration, 0.01));
  const narrow = section.lengthM * scale < 180;
  const x0 = (340 - section.lengthM * scale) / 2;
  const y0 = 180 - (160 - (maxZ - minZ) * scale * exaggeration) / 2;
  const screen = (p: SectionPoint) => `${x0 + p[0] * scale},${y0 - (p[1] - minZ) * scale * exaggeration}`;
  return <svg className="v2-section-chart" viewBox="0 0 340 225" role="img" aria-label="Svislý řez modelu A–B">
    <title>Řez A–B; vodorovně vzdálenost od A, svisle nadmořská výška; zvýraznění výšek {exaggeration}×</title>
    {[minZ, maxZ].filter((value, index, array) => array.indexOf(value) === index).map((z) => <g key={z}><line x1="48" x2="300" y1={y0 - (z - minZ) * scale * exaggeration} y2={y0 - (z - minZ) * scale * exaggeration} stroke="currentColor" opacity="0.15" /><text x="5" y={y0 - (z - minZ) * scale * exaggeration - 5}>{format(z)}</text></g>)}
    {section.traces.map((trace) => <g key={trace.objectId} stroke={colors[trace.layerId] ?? "#5369dc"}>
      {trace.rings.length > 0 && <path d={trace.rings.map((ring) => `M${ring.map(screen).join(" L")} Z`).join(" ")} fill={colors[trace.layerId] ?? "#5369dc"} fillOpacity="0.2" fillRule="evenodd" strokeWidth="1.5" />}
      <path d={trace.segments.map(([a, b]) => `M${screen(a)} L${screen(b)}`).join(" ")} fill="none" strokeWidth="2" />
    </g>)}
    {(narrow ? [0, section.lengthM] : [0, section.lengthM / 2, section.lengthM]).map((station, i) => <text key={i} x={narrow ? station === 0 ? 8 : 332 : x0 + station * scale} y="211" textAnchor={narrow ? station === 0 ? "start" : "end" : "middle"}>{station === 0 ? "A · " : station === section.lengthM ? "B · " : ""}{format(station)} m</text>)}
  </svg>;
}

export function CivilSectionPanel({ objects, points, anchors, hiddenLayerIds, colors, onAnchors, onClose }: Props) {
  const [exaggeration, setExaggeration] = useState(5);
  const candidates = [...points.map(pointMeasurementAnchor), ...anchors.filter((anchor) => anchor.kind !== "point")];
  const a = anchors[0];
  const b = anchors[1];
  const visibleObjects = useMemo(() => objects.filter((object) => !hiddenLayerIds.has(object.layer_id)), [objects, hiddenLayerIds]);
  const result = useMemo(() => {
    if (!a || !b || anchors.length !== 2) return { section: null, error: null };
    try {
      return { section: createCivilSection(visibleObjects,
        { point: a.geometry.point, crs: a.properties.crs }, { point: b.geometry.point, crs: b.properties.crs }), error: null };
    } catch (error) { return { section: null, error: error instanceof Error ? error.message : "Řez nelze vypočítat." }; }
  }, [visibleObjects, a, b, anchors.length]);
  return <section className="v2-section-panel" aria-label="Řez modelu">
    <header><p className="dm-label">Geometrie modelu</p><h2>Svislý řez A–B</h2><p className="v2-muted">Dva body, vrcholy nebo místa na hranách určují směr a rozsah řezu v XY. Řez zahrnuje všechny výšky viditelných povrchů a materiálových vrstev.</p></header>
    {([a, b] as const).map((point, i) => <label key={i}>Bod {i === 0 ? "A" : "B"}<select aria-label={`Řez · bod ${i === 0 ? "A" : "B"}`} value={point?.id ?? ""} disabled={i === 1 && !a} onChange={(event) => {
      const id = event.currentTarget.value;
      const next = candidates.find((candidate) => candidate.id === id);
      onAnchors(i === 0 ? next ? [next, ...(b && b.id !== id ? [b] : [])] : [] : a ? [a, ...(next && id !== a.id ? [next] : [])] : []);
    }}><option value="">Vyberte bod…</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={i === 1 && candidate.id === a?.id}>{candidate.properties.name}</option>)}</select></label>)}
    {anchors.length < 2 && <p role="status">Vyberte A a B kliknutím v modelu nebo ze seznamu.</p>}
    {anchors.length > 2 && <p role="status">Pro řez vyberte přesně dva body.</p>}
    {(a || b) && <details open><summary>Vedení řezu · souřadnice</summary>
      {([a, b] as const).map((point, i) => point && <p className="dm-mono" key={i}>{i === 0 ? "A" : "B"}: X {format(point.geometry.point[0])} · Y {format(point.geometry.point[1])} · Z {format(point.geometry.point[2])} m</p>)}
      <p className="v2-muted">A je začátek staničení 0 m, B jeho konec. Výšky bodů A a B řez nenaklánějí ani výškově neořezávají. Skryté vrstvy se nepočítají; samotné body bez plochy průřez nevytvoří.</p>
    </details>}
    <label>Zvýraznění výšek<select aria-label="Zvýraznění výšek řezu" value={exaggeration} onChange={(event) => setExaggeration(Number(event.currentTarget.value))}>{[1, 2, 5, 10].map((factor) => <option key={factor} value={factor}>{factor}×</option>)}</select></label>
    {result.error && <p className="v2-operation-error" role="alert">{result.error}</p>}
    {result.section && <>
      <SectionPlanChart objects={visibleObjects} a={a!} b={b!} colors={colors} />
      <p className="v2-muted">Čára A→B určuje polohu a rozsah řezu. Tečky zobrazují zjednodušený půdorys viditelných bodů a vrcholů.</p>
      <SectionChart section={result.section} colors={colors} exaggeration={exaggeration} />
      <p className="v2-muted">Délka řezu {format(result.section.lengthM)} m · výšky {exaggeration}× · EPSG:{a!.properties.crs.epsg} · {a!.properties.crs.vertical_datum}</p>
      <div className="v2-section-traces" aria-label="Průřezy vrstev">{result.section.traces.map((trace) => <article key={trace.objectId}>
        <strong><span style={{ background: colors[trace.layerId] ?? "#5369dc" }} />{trace.name}</strong>
        {trace.material && <p>Materiál: {trace.material}</p>}
        {trace.thicknessM !== null && <p>Svislá tloušťka vrstvy: {format(trace.thicknessM)} m</p>}
        <p>{trace.areaM2 === null ? trace.material ? "Plochu průřezu nelze určit" : "Průsečnice povrchu" : `Plocha průřezu: ${format(trace.areaM2)} m²`}</p>
        {trace.warning && <p role="status">{trace.warning}</p>}
      </article>)}</div>
      <details><summary>Souřadnice průsečíků</summary><p className="v2-muted">Vzdálenost od A / nadmořská výška [m]. Zobrazeno nejvýše 100 úseček na objekt.</p>{result.section.traces.map((trace) => <div key={trace.objectId}><strong>{trace.name}</strong><ol>{trace.segments.slice(0, 100).map(([p, q], index) => <li key={index}>{p.map(format).join(" / ")} → {q.map(format).join(" / ")}</li>)}</ol></div>)}</details>
    </>}
    <div className="v2-measurement-actions"><button className="dm-btn dm-btn--ghost" type="button" disabled={!a || !b || anchors.length !== 2} onClick={() => onAnchors([b!, a!])}>Prohodit směr řezu</button><button className="dm-btn dm-btn--primary" type="button" onClick={onClose}>Ukončit řez</button></div>
    <p className="v2-muted">Plocha průřezu je odvozená z uzavřené geometrie, není objemem ani potvrzeným výkazem. Zobrazení řezu model nemění.</p>
  </section>;
}
