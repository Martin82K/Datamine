import { useState } from "react";
import "./civil-workbench.css";
import type { civilWorkbenchSummary } from "./civil-workbench";

interface CivilWorkbenchToolbarProps {
  readonly summary: ReturnType<typeof civilWorkbenchSummary>;
  readonly selectedPoints: number;
  readonly selectionCount: number;
  readonly surfaceVertices: number;
  readonly canSlope: boolean;
  readonly canSweep: boolean;
  readonly canGroup: boolean;
  readonly busy: boolean;
  readonly is3d: boolean;
  readonly boxSelection: boolean;
  readonly focusMode: boolean;
  readonly showTriangulation: boolean;
  readonly onToggleTriangulation: () => void;
  readonly measuring: boolean;
  readonly onMeasure: () => void;
  readonly sectioning: boolean;
  readonly onSection: () => void;
  readonly onPoint: () => void;
  readonly onRoute: () => void;
  readonly onTin: () => void;
  readonly onSlope: () => void;
  readonly onMaterial: () => void;
  readonly onCopy: () => void;
  readonly onSweep: () => void;
  readonly onGroup: () => void;
  readonly onSelect: () => void;
  readonly onBox: () => void;
  readonly onMap?: () => void;
  readonly onDrawing: () => void;
  readonly canDrawing: boolean;
  readonly onFocus: () => void;
  readonly onCsv: () => void;
  readonly onDxf: () => void;
  readonly onVerticesCsv: () => void;
}

const sections = ["Modelování", "Výběr", "Měření", "Řez", "Zobrazení", "Export"] as const;

export function CivilWorkbenchToolbar(props: CivilWorkbenchToolbarProps) {
  const [section, setSection] = useState<typeof sections[number]>("Modelování");
  const { summary, busy, selectedPoints } = props;
  return <section className="v2-civil-tools" aria-label="Pracovní nabídky modelu">
    <div className="v2-civil-tools__heading">
      <nav aria-label="Nabídky modelu">{sections.map((label) => <button key={label} type="button" aria-pressed={section === label} onClick={() => setSection(label)}>{label}</button>)}</nav>
      <span className="v2-civil-tools__selection">Výběr: {props.selectionCount} objektů · {selectedPoints} bodů</span>
    </div>
    <div className="v2-civil-tools__body" aria-label={section}>
      {section === "Modelování" && <>
        <div className="v2-civil-tools__commands">
          <button type="button" disabled={busy} onClick={props.onPoint}>Bod</button>
          <button type="button" disabled={busy || summary.points < 2} onClick={props.onRoute}>Řada / osa</button>
          <button type="button" disabled={busy || selectedPoints < 3} onClick={props.onTin}>TIN z bodů</button>
          <button type="button" disabled={busy || !props.canSlope} onClick={props.onSlope}>Šikmá plocha</button>
          <button type="button" disabled={busy || !props.surfaceVertices} onClick={props.onMaterial}>Materiálová vrstva</button>
          <button type="button" disabled={busy || !props.canSweep} onClick={props.onSweep}>Koridor</button>
        </div>
        <p>{busy ? "Dokončete nebo ukončete rozpracovanou operaci ve vlastnostech." : "TIN: vyberte alespoň 3 body. Vrstva: vyberte TIN. Šikmá plocha: osa nebo 2 body. Koridor: osa a profil."}</p>
      </>}
      {section === "Výběr" && <>
        <div className="v2-civil-tools__commands">
          <button type="button" aria-pressed={!props.boxSelection} onClick={props.onSelect}>Výběr</button>
          <button type="button" aria-pressed={props.boxSelection} disabled={!props.is3d} onClick={props.onBox}>Okno</button>
          <button type="button" disabled={busy || summary.points < 2} onClick={props.onRoute}>Řada / osa</button>
          <button type="button" disabled={busy || !selectedPoints} aria-keyshortcuts="Shift+D" onClick={props.onCopy}>Kopie</button>
          <button type="button" disabled={busy || !props.canGroup} onClick={props.onGroup}>Nová skupina</button>
        </div>
        <p>Shift/Ctrl/Cmd přidá objekt do výběru. Okno vybírá viditelné body ve 3D. Kopie pracuje s vybranými body.</p>
      </>}
      {section === "Zobrazení" && <>
        <div className="v2-civil-tools__commands"><button type="button" aria-pressed={props.focusMode} onClick={props.onFocus}>{props.focusMode ? "Zobrazit panely" : "Celá plocha"}</button>{props.onMap && <button type="button" disabled={busy} onClick={props.onMap}>Mapa a terén</button>}<button type="button" disabled={busy || !props.canDrawing} title={props.canDrawing ? undefined : "Otevřete vlastní projekt v původních zeměměřických souřadnicích."} onClick={props.onDrawing}>Připnout situaci</button><button type="button" aria-pressed={props.showTriangulation} onClick={props.onToggleTriangulation}>Zobrazit triangulaci</button></div>
        <p>{props.is3d ? "Pohledy a zarámování jsou dole ve 3D. Levé tažení otáčí, pravé posouvá a kolečko přibližuje." : "Přepněte na 3D model pro pohledy, otáčení a zarámování."}</p>
      </>}
      {section === "Měření" && <>
        <div className="v2-civil-tools__commands"><button type="button" aria-pressed={props.measuring} disabled={(summary.points < 2 && !summary.faces) || (busy && !props.measuring)} onClick={props.onMeasure}>{props.measuring ? "Ukončit měření" : "Vzdálenost a sklon"}</button></div>
        <p>Měření mezi body, viditelnými vrcholy a hranami TIN nebo vrstev v souřadnicích modelu. Výsledek najdete ve vlastnostech. Esc ukončí měření.</p>
      </>}
      {section === "Řez" && <>
        <div className="v2-civil-tools__commands"><button type="button" aria-pressed={props.sectioning} disabled={!summary.faces || (busy && !props.sectioning)} onClick={props.onSection}>{props.sectioning ? "Ukončit řez" : "Svislý řez A–B"}</button></div>
        <p>Vyberte dva body, vrcholy nebo hrany. Řez zobrazí výšky a průřezy viditelných vrstev mezi A a B. Esc jej ukončí.</p>
      </>}
      {section === "Export" && <>
        <div className="v2-civil-tools__commands">
          <button type="button" disabled={!summary.points} onClick={props.onCsv}>CSV body · {selectedPoints || summary.points}</button>
          <button type="button" disabled={!props.surfaceVertices} onClick={props.onVerticesCsv}>CSV vrcholy · {props.surfaceVertices}</button>
          <button type="button" disabled={!summary.hasDxfGeometry} onClick={props.onDxf}>DXF model</button>
        </div>
        <p><strong>Pracovní export</strong> · CSV: {selectedPoints ? "vybrané body" : "všechny body"}, název + XYZ, 3 desetinná místa. DXF: celý model včetně skrytých objektů, bez dočasných náhledů.</p>
        <p>{summary.points} bodů · {summary.lines} úseček · {summary.faces} trojúhelníků · jednotky m. {summary.omitted.length > 0 && <>DXF vynechá: {summary.omitted.join("; ")}.</>}</p>
      </>}
    </div>
  </section>;
}
