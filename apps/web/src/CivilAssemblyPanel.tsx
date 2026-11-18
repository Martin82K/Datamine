import { useState } from "react";
import type { CivilMaterialLayerObject, TinSurfaceObject } from "@datamine/contracts";
import { createCivilMaterialAssemblyFromSurface } from "@datamine/modules";

interface Row { id: string; layerId: string; name: string; code: string; thickness: string }
const newRow = (): Row => {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  return { id: `object_material_${suffix}`, layerId: `layer_material_${suffix}`, name: "", code: "", thickness: "" };
};
const format = (value: number) => value.toLocaleString("cs-CZ", { maximumFractionDigits: 3 });
export const ASSEMBLY_COLORS = ["#64748b", "#a78bfa", "#f59e0b", "#84cc16", "#22d3ee", "#fb7185"];

export function CivilAssemblyPanel({ surface, existing, colors, onPreview, onCommit, onClose }: {
  surface: TinSurfaceObject;
  existing: readonly CivilMaterialLayerObject[];
  colors: Readonly<Record<string, string>>;
  onPreview: (layers: readonly CivilMaterialLayerObject[]) => void;
  onCommit: (layers: readonly CivilMaterialLayerObject[], hideSource: boolean) => void;
  onClose: () => void;
}) {
  const [assemblyId] = useState(() => existing[0]?.properties.derivation.assembly?.id ?? `assembly_${crypto.randomUUID().replaceAll("-", "")}`);
  const [rows, setRows] = useState<Row[]>(() => existing.length ? existing.map((layer) => ({
    id: layer.id, layerId: layer.layer_id, name: layer.properties.name, code: layer.properties.material_code, thickness: String(layer.properties.derivation.thickness_m * 1000),
  })) : [newRow()]);
  const [preview, setPreview] = useState<readonly CivilMaterialLayerObject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hideSource, setHideSource] = useState(true);
  const change = (next: Row[]) => { setRows(next); setPreview([]); onPreview([]); setError(null); };
  const move = (index: number, delta: number) => {
    const next = [...rows]; [next[index], next[index + delta]] = [next[index + delta]!, next[index]!]; change(next);
  };
  return <section className="v2-assembly-panel" aria-label="Skladba vozovky">
    <h2>{existing.length ? "Upravit skladbu" : "Skladba vozovky"}</h2>
    <p className="v2-muted">Horní povrch: <strong>{surface.properties.name}</strong>. Zadejte dodanou skladbu shora dolů. Tloušťky jsou svislé, v milimetrech; všechny vrstvy mají půdorys vybraného TIN včetně otvorů.</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      try {
        const layers = createCivilMaterialAssemblyFromSurface(surface, assemblyId, rows.map((row) => ({
          objectId: row.id, layerId: row.layerId, name: row.name, materialCode: row.code,
          thicknessM: Number(row.thickness.replace(",", ".")) / 1000,
          sourceDocumentId: surface.provenance.source_document_id, sourceDocumentSha256: surface.provenance.source_document_sha256,
        })));
        onPreview(layers); setPreview(layers); setError(null);
      } catch (cause) { setPreview([]); onPreview([]); setError(cause instanceof Error ? cause.message : "Skladbu nelze vytvořit."); }
    }}>
      {rows.map((row, index) => <fieldset key={row.id}>
        <legend>{index + 1}. vrstva {index === 0 ? "· nahoře" : ""}</legend>
        <label>Název vrstvy<input aria-label={`Vrstva ${index + 1} · název`} required maxLength={200} value={row.name} onChange={(event) => change(rows.map((r) => r.id === row.id ? { ...r, name: event.currentTarget.value } : r))} /></label>
        <label>Kód materiálu<input aria-label={`Vrstva ${index + 1} · materiál`} required maxLength={50} value={row.code} onChange={(event) => change(rows.map((r) => r.id === row.id ? { ...r, code: event.currentTarget.value } : r))} /></label>
        <label>Svislá tloušťka [mm]<input aria-label={`Vrstva ${index + 1} · tloušťka [mm]`} type="number" min="1" max="1000000" step="any" required value={row.thickness} onChange={(event) => change(rows.map((r) => r.id === row.id ? { ...r, thickness: event.currentTarget.value } : r))} /></label>
        <div className="v2-assembly-row-actions"><button type="button" disabled={index === 0} aria-label={`Posunout vrstvu ${index + 1} nahoru`} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === rows.length - 1} aria-label={`Posunout vrstvu ${index + 1} dolů`} onClick={() => move(index, 1)}>↓</button><button type="button" disabled={rows.length === 1} onClick={() => change(rows.filter((r) => r.id !== row.id))}>Odebrat vrstvu {index + 1}</button></div>
      </fieldset>)}
      <button className="dm-btn dm-btn--ghost" type="button" disabled={rows.length >= 20} onClick={() => change([...rows, newRow()])}>Přidat vrstvu</button>
      <button className="dm-btn dm-btn--primary" type="submit">Vytvořit náhled skladby</button>
    </form>
    {error && <p role="alert" className="v2-operation-error">{error}</p>}
    {preview.length > 0 && <div aria-label="Náhled skladby">
      <p>Celková tloušťka: <strong>{format(preview.reduce((sum, layer) => sum + layer.properties.derivation.thickness_m, 0) * 1000)} mm</strong></p>
      {preview.map((layer, index) => <p key={layer.id}><span style={{ color: colors[layer.layer_id] ?? ASSEMBLY_COLORS[index % ASSEMBLY_COLORS.length] }}>■ </span>{layer.properties.name}: {format(layer.properties.volume_m3)} m³ · hloubka {format((layer.properties.derivation.top_offset_m ?? 0) * 1000)}–{format(((layer.properties.derivation.top_offset_m ?? 0) + layer.properties.derivation.thickness_m) * 1000)} mm</p>)}
      <p className="v2-muted">Uloží se samostatné objemové vrstvy. Změnou tloušťky ve skladbě se posunou všechny vrstvy pod ní. Kubatury jsou odvozené z geometrie.</p>
      <label className="v2-assembly-source"><input type="checkbox" checked={hideSource} onChange={(event) => setHideSource(event.currentTarget.checked)} />Po uložení skrýt vrstvu zdrojového TIN</label>
      <p className="v2-muted">TIN zůstane v projektu. Jeho skrytím se nebude překrývat barva povrchu s horní vrstvou skladby.</p>
      <button className="dm-btn dm-btn--primary" type="button" onClick={() => { try { onCommit(preview, hideSource); } catch (cause) { setError(cause instanceof Error ? cause.message : "Skladbu nelze uložit."); } }}>Uložit skladbu</button>
    </div>}
    <button className="dm-btn dm-btn--ghost" type="button" onClick={onClose}>Zrušit skladbu</button>
  </section>;
}
