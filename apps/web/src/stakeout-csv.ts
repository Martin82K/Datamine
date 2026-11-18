import type { LocalProjectFile } from "./local-projects";
import type { StakeoutImportPayload } from "./processing-api";

export const MAX_STAKEOUT_CSV_BYTES = 4 * 1024 * 1024;
const MAX_POINTS = 10_000;
const MAX_FIELD_LENGTH = 200;

export const isStakeoutCsv = (file: Pick<LocalProjectFile, "name">): boolean => /\.csv$/i.test(file.name);

interface CsvRow { readonly cells: readonly string[]; readonly line: number }

/** Strict bounded CSV reader; quoted fields and escaped quotes are treated as text. */
function readRows(text: string, delimiter: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [], field = "", quoted = false, closed = false;
  let line = 1, startLine = 1;
  const finishField = () => {
    cells.push(field.trim());
    if (cells.length > 4) throw new Error(`CSV: řádek ${startLine} má více než 4 sloupce.`);
    field = "";
    closed = false;
  };
  const finishRow = () => {
    finishField();
    if (cells.some((cell) => cell !== "")) rows.push({ cells, line: startLine });
    if (rows.length > MAX_POINTS + 1) throw new Error("CSV překročilo limit 10 000 bodů.");
    cells = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else { quoted = false; closed = true; }
      } else {
        // Point names and coordinates must each fit on one physical line.
        if (char === "\r" || char === "\n") throw new Error(`CSV: víceřádková hodnota na řádku ${startLine} není podporována.`);
        field += char;
      }
    } else if (char === delimiter) finishField();
    else if (char === "\r" || char === "\n") {
      finishRow();
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      line += 1;
      startLine = line;
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error(`CSV: neplatné uvozovky na řádku ${startLine}.`);
      field += char;
    }
    if (field.length > MAX_FIELD_LENGTH) throw new Error(`CSV: hodnota na řádku ${startLine} je příliš dlouhá.`);
  }
  if (quoted) throw new Error(`CSV: neuzavřené uvozovky na řádku ${startLine}.`);
  finishRow();
  return rows;
}

export function parseStakeoutCsv(text: string): StakeoutImportPayload["points"] {
  if (text.length > MAX_STAKEOUT_CSV_BYTES) throw new Error("CSV může mít nejvýše 4 MB.");
  const source = text.replace(/^\uFEFF/, "");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source)) throw new Error("CSV obsahuje nepovolené řídicí znaky.");
  const headerLine = source.split(/\r?\n|\r/, 1)[0] ?? "";
  const rows = readRows(source, headerLine.includes(";") ? ";" : ",");
  const header = rows.shift()?.cells.map((cell) => cell.toLocaleLowerCase("cs-CZ"));
  if (!header || header.length !== 4 || !["bod", "název bodu"].includes(header[0] ?? "")
    || header[1] !== "x" || header[2] !== "y" || header[3] !== "z") {
    throw new Error("CSV musí mít hlavičku bod,X,Y,Z (nebo Název bodu,X,Y,Z). Souřadnice jsou v metrech.");
  }
  if (!rows.length) throw new Error("CSV neobsahuje žádné body.");
  return rows.map(({ cells, line }) => {
    if (cells.length !== 4 || !cells[0]) throw new Error(`CSV: řádek ${line} musí obsahovat název bodu a souřadnice X, Y, Z.`);
    const coordinates = cells.slice(1).map((value) => {
      const normalized = value.replace(",", ".");
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)
        || !Number.isFinite(Number(normalized))) throw new Error(`CSV: neplatná souřadnice na řádku ${line}.`);
      return Number(normalized);
    });
    return { code: cells[0], name: cells[0], point: coordinates as [number, number, number], kind: "Importované body", page: 1, row: line };
  });
}

/** Local extraction never uploads the source or invents a server job. */
export async function extractStakeoutCsv(file: LocalProjectFile, blob: Blob): Promise<StakeoutImportPayload> {
  if (!isStakeoutCsv(file)) throw new Error("Pro import bodů vyberte CSV.");
  if (blob.size > MAX_STAKEOUT_CSV_BYTES) throw new Error("CSV může mít nejvýše 4 MB.");
  if (!blob.size || blob.size !== file.size) throw new Error("Velikost CSV nesouhlasí s metadaty.");
  const bytes = await blob.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  if (sha256 !== file.sha256) throw new Error("Kontrolní součet CSV nesouhlasí.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("CSV musí být uloženo v kódování UTF-8."); }
  return {
    schema_version: "datamine.stakeout-import.v1",
    document_id: `document_csv_${sha256.slice(0, 48)}`,
    source_document_sha256: sha256,
    algorithm_version: "stakeout-csv-import-v1",
    points: parseStakeoutCsv(text),
  };
}
