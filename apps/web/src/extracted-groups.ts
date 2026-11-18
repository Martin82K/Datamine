const EXTRACTED_GROUP_NAMES: Readonly<Record<string, string>> = Object.freeze({
  micropile_inner_row: "Mikropiloty – vnitřní řada", micropile_outer_row: "Mikropiloty – vnější řada",
  excavation_bottom: "Výkop – dno", foundation_joint: "Opěrná stěna – základová spára", wall_top: "Opěrná stěna – horní hrana",
  road_aco: "Vozovka – ACO (40 mm)", road_acl: "Vozovka – ACL (60 mm)", road_acp: "Vozovka – ACP (80 mm)",
  road_sd: "Vozovka – ŠD (150 mm)", road_sd2: "Vozovka – ŠD", road_subgrade: "Vozovka – zemní pláň",
});

export const readableExtractedGroupName = (kind: string): string => (
  EXTRACTED_GROUP_NAMES[kind]
  ?? (kind.replace(/[<>\u0000-\u001f]/g, " ").trim().slice(0, 200) || "Importované body")
);

export const safeExtractedLayerId = (value: string): string => {
  const readable = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "import";
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `layer_extracted_${readable}_${hash.toString(16).padStart(8, "0")}`;
};

export function inferredLegacyExtractedGroup(name: string): string | null {
  const normalized = name.toLocaleLowerCase("cs-CZ");
  if (normalized.includes("vnitřní řada")) return EXTRACTED_GROUP_NAMES.micropile_inner_row!;
  if (normalized.includes("vnější řada")) return EXTRACTED_GROUP_NAMES.micropile_outer_row!;
  if (/\baco\b/u.test(normalized)) return EXTRACTED_GROUP_NAMES.road_aco!;
  if (/\bacl\b/u.test(normalized)) return EXTRACTED_GROUP_NAMES.road_acl!;
  if (/\bacp\b/u.test(normalized)) return EXTRACTED_GROUP_NAMES.road_acp!;
  if (normalized.includes("šd 150") || normalized.includes("sd 150")) return EXTRACTED_GROUP_NAMES.road_sd!;
  if (/(?:^|\s)(?:šd|sd)(?:\s|$)/u.test(normalized)) return EXTRACTED_GROUP_NAMES.road_sd2!;
  if (normalized.includes("zemní pláň") || normalized.includes("zemni plan")) return EXTRACTED_GROUP_NAMES.road_subgrade!;
  if (normalized.includes("základová spára")) return EXTRACTED_GROUP_NAMES.foundation_joint!;
  if (normalized.includes("horní hrana")) return EXTRACTED_GROUP_NAMES.wall_top!;
  if (normalized.includes("hrana výkopu") || normalized.includes("dno výkopu")) return EXTRACTED_GROUP_NAMES.excavation_bottom!;
  return null;
}
