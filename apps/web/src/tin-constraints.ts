export interface TinConstraintDraft { boundary: string; holes: string; breaklines: string }
export const emptyTinConstraints = (): TinConstraintDraft => ({ boundary: "", holes: "", breaklines: "" });

/** User-facing indices start at one, relative to the frozen source list. */
export function parseTinConstraints(draft: TinConstraintDraft, pointCount: number) {
  if (Object.values(draft).some((value) => value.length > 16000)) throw new RangeError("Zadání omezení je příliš dlouhé.");
  const line = (value: string, label: string, closed: boolean) => {
    const tokens = value.trim().split(/[\s,;]+/);
    if (tokens.some((token) => !/^[1-9]\d*$/.test(token))) throw new TypeError(`${label}: použijte celá čísla bodů oddělená mezerou nebo čárkou.`);
    const indices = tokens.map((token) => Number(token) - 1);
    if (indices.some((index) => !Number.isSafeInteger(index) || index >= pointCount)) throw new RangeError(`${label}: číslo bodu musí být mezi 1 a ${pointCount}.`);
    if (closed && indices.length > 1 && indices[0] === indices.at(-1)) indices.pop();
    if (indices.length < (closed ? 3 : 2)) throw new RangeError(`${label}: vyberte alespoň ${closed ? 3 : 2} body.`);
    return indices;
  };
  const lines = (value: string, label: string, closed: boolean) => value.split(/\r?\n/).filter((row) => row.trim()).map((row, i) => line(row, `${label} ${i + 1}`, closed));
  const boundary = draft.boundary.trim() ? line(draft.boundary, "Obvod", true) : undefined;
  const holes = lines(draft.holes, "Otvor", true);
  const breaklines = lines(draft.breaklines, "Povinná hrana", false);
  if (holes.length && !boundary) throw new TypeError("Otvory vyžadují explicitní obvod.");
  return { ...(boundary ? { boundary } : {}), ...(holes.length ? { holes } : {}), ...(breaklines.length ? { breaklines } : {}) };
}
