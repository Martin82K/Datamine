import { measureSurveyPoints, pointMeasurementAnchor, type MeasurementAnchor, type MeasurementPoint } from "./civil-measurement";

interface CivilMeasurementPanelProps {
  readonly points: readonly MeasurementPoint[];
  readonly selection: readonly string[];
  readonly onSelection: (ids: readonly string[]) => void;
  readonly anchors?: readonly MeasurementAnchor[];
  readonly onAnchors?: (anchors: readonly MeasurementAnchor[]) => void;
  readonly onClose: () => void;
}

const format = (value: number, decimals = 3): string => value.toLocaleString("cs-CZ", {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
});

export function CivilMeasurementPanel({ points, selection, onSelection, anchors, onAnchors, onClose }: CivilMeasurementPanelProps) {
  const candidates = [...points.map(pointMeasurementAnchor), ...(anchors ?? []).filter((anchor) => anchor.kind !== "point")];
  const ids = anchors?.map((anchor) => anchor.id) ?? selection;
  const choose = (nextIds: readonly string[]) => {
    if (onAnchors) onAnchors(nextIds.flatMap((id) => { const anchor = candidates.find((candidate) => candidate.id === id); return anchor ? [anchor] : []; }));
    else onSelection(nextIds);
  };
  const a = candidates.find((point) => point.id === ids[0]);
  const b = candidates.find((point) => point.id === ids[1]);
  let result = null;
  let error = null;
  if (a && b && ids.length === 2) {
    try { result = measureSurveyPoints(a, b); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Měření nelze vypočítat."; }
  }
  return <section className="v2-measurement-panel" aria-label="Měření mezi body">
    <header><p className="dm-label">Přesné měření</p><h2>Vzdálenost a sklon</h2><p className="v2-muted">{!a ? "Klikněte na bod nebo uchopený vrchol či hranu v 3D modelu. Body lze také vybrat níže." : !b ? "Klikněte na koncový bod B. Shift není potřeba." : "Směr A → B. Dalším kliknutím na bod změníte konec B."}</p></header>
    {result && <div aria-label="Výsledek měření" aria-live="polite">
      <div className="v2-measurement-result"><span>Prostorová vzdálenost</span><strong>{format(result.spatialM)} m</strong></div>
      <dl className="v2-derived-values">
        <div><dt>Vodorovně</dt><dd>{format(result.horizontalM)} m</dd></div>
        <div><dt>Převýšení A → B</dt><dd>{result.elevationM > 0 ? "+" : ""}{format(result.elevationM)} m</dd></div>
        <div><dt>Sklon</dt><dd>{result.slopePercent === null ? "Nedefinovaný" : `${format(result.slopePercent, 2)} %`}</dd></div>
        <div><dt>Úhel k vodorovné</dt><dd>{result.angleDegrees === null ? "Nedefinovaný" : `${format(result.angleDegrees)}°`}</dd></div>
      </dl>
      {result.horizontalM === 0 && <p className="v2-muted">{result.spatialM === 0 ? "Body mají shodné souřadnice. Směr ani sklon nejsou definované." : "Svislý úsek má nulovou vodorovnou délku; procentní sklon není definovaný."}</p>}
    </div>}
    {([a, b] as const).map((point, index) => <div className="v2-measurement-point" key={index}>
      <label>Bod {index === 0 ? "A · začátek" : "B · konec"}<select aria-label={index === 0 ? "Bod A · začátek" : "Bod B · konec"} value={point?.id ?? ""} disabled={index === 1 && !a} onChange={(event) => {
        const id = event.currentTarget.value;
        if (index === 0) choose(id ? [id, ...(b && b.id !== id ? [b.id] : [])] : []);
        else choose(a ? [a.id, ...(id && id !== a.id ? [id] : [])] : []);
      }}><option value="">Vyberte bod…</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={index === 1 && candidate.id === a?.id}>{candidate.properties.name} · {candidate.geometry.point.map((coordinate) => format(coordinate)).join(" / ")}</option>)}</select></label>
      {point && <><dl className="v2-derived-values">{point.geometry.point.map((coordinate, axis) => <div key={axis}><dt>{["X · východ", "Y · sever", "Z · výška"][axis]}</dt><dd>{format(coordinate)} m</dd></div>)}</dl><small>EPSG:{point.properties.crs.epsg} · {point.properties.crs.vertical_datum}</small></>}
    </div>)}
    {ids.length > 2 && <p role="status">Pro měření zvolte pouze dva body.</p>}
    {error && <p className="v2-operation-error" role="alert">{error}</p>}
    <div className="v2-measurement-actions">
      <button className="dm-btn dm-btn--ghost" type="button" disabled={!a || !b || ids.length !== 2} onClick={() => choose([b!.id, a!.id])}>Prohodit A / B</button>
      <button className="dm-btn dm-btn--ghost" type="button" onClick={() => choose([])}>Nové měření</button>
      <button className="dm-btn dm-btn--primary" type="button" onClick={onClose}>Ukončit měření</button>
    </div>
    <p className="v2-muted">Uchopování v 3D: bod a vrchol mají přednost před hranou v toleranci 12 obrazových bodů. Značka u kurzoru ukazuje přesný cíl. Skryté vrstvy a náhledy se neuchopují.</p>
    <p className="v2-muted">Měření používá souřadnice modelu v metrech. Tři desetinná místa vyjadřují způsob zobrazení, nikoli přesnost zaměření. Výsledek se neukládá do modelu ani exportů. CSV bodů nadále respektuje aktuální výběr.</p>
  </section>;
}
