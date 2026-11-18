import { useMemo, useState } from "react";
import type { ModelObject } from "@datamine/contracts";
import type { ReferenceTerrain } from "./civil-map";
import { terrainHeightAt } from "./terrain-height";

export function TerrainHeightCheck({ terrain, objects }: { readonly terrain: ReferenceTerrain; readonly objects: readonly ModelObject[] }) {
  const [pointId, setPointId] = useState("");
  const points = objects.filter((object) => object.type === "civil.point" || object.type === "stakeout.point");
  const point = points.find((object) => object.id === pointId);
  const crs = point?.properties.crs;
  const compatible = crs?.kind === "epsg" && crs.epsg === 5514 && crs.axis_order === "east_north_up"
    && crs.horizontal_unit === "m" && crs.vertical_unit === "m" && crs.vertical_datum === "Bpv";
  const result = useMemo(() => point && compatible ? terrainHeightAt(terrain, point.geometry.point[0], point.geometry.point[1]) : null, [terrain, point, compatible]);
  return <section aria-label="Kontrola výškového osazení">
    <h3>Kontrola výškového osazení</h3>
    <label>Kontrolní bod<select value={pointId} onChange={(event) => setPointId(event.currentTarget.value)}><option value="">Vyberte bod konstrukce</option>{points.map((item) => <option key={item.id} value={item.id}>{item.properties.name}</option>)}</select></label>
    {point && !compatible && <p role="alert">Bod nemá EPSG:5514 a výšky Bpv. Výšky nelze porovnat.</p>}
    {point && result?.status === "ok" && <div role="status">
      <p>Bod: {point.geometry.point[2].toFixed(3)} m Bpv<br />Terén: {result.elevation.toFixed(3)} m Bpv</p>
      <p><strong>Rozdíl ΔZ: {(point.geometry.point[2] - result.elevation).toFixed(3)} m</strong></p>
      <p className="v2-muted">Kladně = bod nad terénem, záporně = pod terénem. Výška je interpolovaná na trojúhelníku podkladu. Počet desetinných míst nevyjadřuje přesnost zaměření.</p>
    </div>}
    {result && result.status !== "ok" && <p role="status">{result.status === "ambiguous" ? "Pod bodem se překrývá více výšek TIN. Terén není jednoznačný." : result.status === "outside" ? "Bod leží mimo rozsah podkladu." : "Pod bodem není trojúhelník terénu nebo chybí výška. Výsledek se neodhaduje."}</p>}
    {!points.length && <p>Pro kontrolu přidejte bod konstrukce s výškou Bpv.</p>}
  </section>;
}
