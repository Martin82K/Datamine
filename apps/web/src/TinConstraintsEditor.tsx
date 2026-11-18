import type { MeasurementPoint } from "./civil-measurement";
import type { TinConstraintDraft } from "./tin-constraints";
export function TinConstraintsEditor({ points, value, onChange }: {
  points: readonly MeasurementPoint[]; value: TinConstraintDraft; onChange: (value: TinConstraintDraft) => void;
}) {
  return <details className="v2-tin-constraints"><summary>Obvod, otvory a povinné hrany</summary>
    <p>Čísla odkazují na tento pevný seznam zdrojových bodů. Obvod i otvory se uzavřou automaticky. Každý otvor nebo linii zadejte na samostatný řádek.</p>
    <details><summary>Zdrojové body · {points.length}</summary><ol>{points.map((point) => <li key={point.id}><strong>{point.properties.name}</strong><small>{point.geometry.point.map((n) => n.toLocaleString("cs-CZ", { maximumFractionDigits: 3 })).join(" / ")}</small></li>)}</ol></details>
    <label>Obvod · čísla bodů<input aria-label="Obvod TIN" placeholder="1, 2, 3, 4" value={value.boundary} maxLength={16000} onChange={(event) => onChange({ ...value, boundary: event.currentTarget.value })} /></label>
    <label>Otvory<textarea aria-label="Otvory TIN" placeholder="5, 6, 7, 8" value={value.holes} maxLength={16000} rows={2} onChange={(event) => onChange({ ...value, holes: event.currentTarget.value })} /></label>
    <label>Povinné hrany<textarea aria-label="Povinné hrany TIN" placeholder="1, 3" value={value.breaklines} maxLength={16000} rows={2} onChange={(event) => onChange({ ...value, breaklines: event.currentTarget.value })} /></label>
    <p>Křížící se linie musí mít společný zdrojový bod. Při zadaných omezeních prázdný limit dovolí všechny potřebné hrany. Bez omezení se prázdný limit dopočítá automaticky. Změny se projeví po přepočtu.</p>
  </details>;
}
