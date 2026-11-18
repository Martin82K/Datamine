import type { ModelObject } from "@datamine/contracts";

export const civilObjectLabels: Readonly<Record<string, string>> = {
  "civil.point": "Bod", "stakeout.point": "Vytyčovací bod",
  "civil.axis": "Osa", "civil.profile": "Profil", "civil.tin_surface": "TIN povrch",
  "civil.material_layer": "Materiálová vrstva", "civil.sweep": "Koridor",
  "stakeout.group": "Skupina bodů",
};

export const reviewStateLabels: Readonly<Record<string, string>> = {
  unreviewed: "Neověřeno", confirmed: "Potvrzeno", corrected: "Opraveno", rejected: "Vyřazeno",
};

/** Summary of the existing quick export, not the validated server export. */
export function civilWorkbenchSummary(objects: readonly ModelObject[]) {
  let points = 0;
  let lines = 0;
  let faces = 0;
  let surfaces = 0;
  let materials = 0;
  const omitted = new Map<string, number>();
  const coordinateSystems = new Set<string>();
  for (const object of objects) {
    if ("crs" in object.properties) {
      const crs = object.properties.crs;
      coordinateSystems.add(`EPSG:${crs.epsg} · ${crs.vertical_datum}`);
    }
    switch (object.type) {
      case "civil.point": case "stakeout.point": points += 1; break;
      case "civil.axis": case "civil.profile": lines += Math.max(0, object.geometry.points.length - 1); break;
      case "civil.tin_surface":
        surfaces += 1;
        faces += object.geometry.faces.length;
        break;
      case "civil.material_layer":
        materials += 1;
        faces += object.geometry.faces.length;
        break;
      case "civil.sweep": faces += object.geometry.faces.length; break;
      default: {
        const label = civilObjectLabels[object.type] ?? object.type;
        omitted.set(label, (omitted.get(label) ?? 0) + 1);
      }
    }
  }
  return {
    points, lines, faces, surfaces, materials,
    hasDxfGeometry: points + lines + faces > 0,
    omitted: [...omitted].map(([label, count]) => `${label}: ${count}`),
    coordinates: coordinateSystems.size === 1 ? [...coordinateSystems][0]!
      : coordinateSystems.size > 1 ? "Více souřadnicových systémů" : "Souřadnicový systém zatím neurčen",
  };
}
