import sharp from "sharp";
import type { CandidateDataset } from "./handwriting-dataset.ts";
import type { AnalysisPreview } from "./handwriting-library.ts";
import type { WritingGlyph } from "./handwriting-writing.ts";

type Rect = [number, number, number, number];
type Cell = { id: string; page: number; box: Rect };
type Worksheet = { renderScale: number; configuration: { version: number; cellSize: number }; cells: Cell[] };
const rect = (v: unknown): v is Rect => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite) && v[2] > 0 && v[3] > 0;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const axisSymbol = /^(?:\\(?:int|sum|prod|infty|times|div|cdot|pm|le|ge|ne)|[+−=±×÷·<>≤≥≠∞∫∑-])$/;
const baselinePeer = /^(?:[0-9A-PR-Zabcdehiklmnorstuvwxz]|d[xt]|\\(?:sin|cos|tan|cot))$/;

/** Original PencilKit ink, never an upscaled analysis thumbnail. Old/partial
 * source formats without worksheet geometry retain the legacy renderer. */
export async function nativeWritingGlyphs(analysis: AnalysisPreview, dataset: CandidateDataset, source: unknown): Promise<WritingGlyph[] | null> {
  const worksheet = source as Worksheet | null;
  if (dataset.schemaVersion !== 2 || !worksheet || ![1, 2, 3].includes(worksheet.configuration?.version)
    || !Number.isFinite(worksheet.configuration.cellSize) || worksheet.configuration.cellSize <= 0
    || !Number.isFinite(worksheet.renderScale) || worksheet.renderScale <= 0 || !Array.isArray(worksheet.cells) || !worksheet.cells.length) return null;
  const cells = new Map(worksheet.cells.filter(c => typeof c.id === "string" && rect(c.box)).map(c => [c.id, c]));
  const candidates = new Map(dataset.samples.map(s => [s.id, s]));
  const group = (cell: Cell) => `${cell.box[2]}:${cell.box[3]}`;
  const peers = new Map<string, number[]>();
  const capHeights: number[] = [];
  for (const symbol of analysis.symbols) {
    if (symbol.result?.status !== "complete") continue;
    const perGroup = new Map<string, number[]>(), heights: number[] = [];
    for (const sample of symbol.result.samples) {
      const candidate = candidates.get(sample.id), cell = cells.get(sample.id);
      if (!candidate || !cell || candidate.source.crossesCellBoundary) continue;
      const scale = sample.originalSize[1] / candidate.source.box[3];
      const bottom = candidate.source.box[1] + (sample.inkBox[1] + sample.inkBox[3]) / scale;
      const values = perGroup.get(group(cell)) ?? [];
      values.push(bottom - cell.box[1] - cell.box[3] / 2); perGroup.set(group(cell), values);
      heights.push(sample.inkBox[3] / scale);
    }
    if (baselinePeer.test(symbol.latex)) for (const [key, values] of perGroup) {
      const valuesForGroup = peers.get(key) ?? [];
      valuesForGroup.push(median(values)); peers.set(key, valuesForGroup);
    }
    if (/^[0-9A-Z]$/.test(symbol.latex) && heights.length) capHeights.push(median(heights));
  }
  // One calibration for the entire handwriting, retaining all relative sizes.
  // Without capitals use the worksheet unit; never infer an em separately per glyph.
  const unitsPerEm = capHeights.length ? median(capHeights) / 0.7 : worksheet.configuration.cellSize;
  const glyphs: WritingGlyph[] = [];
  for (const symbol of analysis.symbols) {
    if (symbol.result?.status !== "complete") continue;
    const candidate = candidates.get(symbol.result.medoid.id), cell = cells.get(symbol.result.medoid.id);
    if (!candidate || !cell || candidate.source.page !== cell.page) throw new Error("Missing native medoid geometry.");
    const input = sharp(Buffer.from(candidate.image.split(",")[1], "base64"), { limitInputPixels: 4_000_000 });
    if (!(await input.metadata()).hasAlpha) return null;
    const { data, info } = await input.toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const scale = worksheet.renderScale;
    if (Math.abs(info.width / scale - candidate.source.box[2]) > 1 / scale + 0.01 || Math.abs(info.height / scale - candidate.source.box[3]) > 1 / scale + 0.01) throw new Error("Native image does not match its page coordinates.");
    let left = info.width, top = info.height, right = -1, bottom = -1;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const p = (y * info.width + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = 0;
      if (data[p + 3] <= 1) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) throw new Error("Native medoid has no ink.");
    // Keep a one-pixel antialiasing border and its precise source offset.
    left = Math.max(0, left - 1); top = Math.max(0, top - 1);
    right = Math.min(info.width - 1, right + 1); bottom = Math.min(info.height - 1, bottom + 1);
    const width = right - left + 1, height = bottom - top + 1;
    const image = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract({ left, top, width, height }).png().toBuffer();
    const crop: Rect = [candidate.source.box[0] + left / scale, candidate.source.box[1] + top / scale, width / scale, height / scale];
    const calibration = peers.get(group(cell));
    const baseline = axisSymbol.test(symbol.latex) ? crop[3] / 2 + unitsPerEm * 0.25
      : cell.box[1] + cell.box[3] / 2 + (calibration?.length ? median(calibration) : worksheet.configuration.cellSize * 0.25) - crop[1];
    glyphs.push({ latex: symbol.latex, medoidId: candidate.id, width, height, image: `data:image/png;base64,${image.toString("base64")}`,
      metrics: { version: 1, width: crop[2], height: crop[3], baseline, unitsPerEm, crop, cell: cell.box,
        baselineMethod: axisSymbol.test(symbol.latex) ? "math-axis" : calibration?.length ? "worksheet-peers" : "estimated" } });
  }
  return glyphs;
}
