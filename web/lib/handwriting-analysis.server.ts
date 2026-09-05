import sharp from "sharp";
import { setImmediate } from "node:timers/promises";
import { ANALYSIS_SETTINGS as settings, type NormalizedSample, type SymbolAnalysis } from "./handwriting-analysis.ts";
import { MIN_EXAMPLES, type Candidate } from "./handwriting-dataset.ts";

type Glyph = {
  pixels: Float32Array;
  edges: [number, number][];
  field: Float32Array;
  sample: Omit<NormalizedSample, "centered" | "aligned" | "distance" | "shift">;
};
const dataUrl = (buffer: Buffer) => `data:image/png;base64,${buffer.toString("base64")}`;
const round = (value: number) => Math.round(value * 10000) / 10000;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

// Two-pass 8-neighbour chamfer approximation to distance from the ink contour.
function distanceField(edges: [number, number][], width: number, height: number) {
  const field = new Float32Array(width * height).fill(width + height), diagonal = Math.SQRT2;
  for (const [x, y] of edges) field[y * width + x] = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) field[i] = Math.min(field[i], field[i - 1] + 1);
    if (y) {
      field[i] = Math.min(field[i], field[i - width] + 1);
      if (x) field[i] = Math.min(field[i], field[i - width - 1] + diagonal);
      if (x + 1 < width) field[i] = Math.min(field[i], field[i - width + 1] + diagonal);
    }
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x + 1 < width) field[i] = Math.min(field[i], field[i + 1] + 1);
    if (y + 1 < height) {
      field[i] = Math.min(field[i], field[i + width] + 1);
      if (x) field[i] = Math.min(field[i], field[i + width - 1] + diagonal);
      if (x + 1 < width) field[i] = Math.min(field[i], field[i + width + 1] + diagonal);
    }
  }
  return field;
}

async function normalize(candidate: Candidate, width: number, height: number): Promise<Glyph> {
  const bytes = Buffer.from(candidate.image.slice("data:image/png;base64,".length), "base64");
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid PNG.");
  const input = sharp(bytes, { limitInputPixels: settings.maxInputPixels, failOn: "warning" });
  const metadata = await input.metadata();
  if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1) throw new Error("Expected a single PNG image.");
  const { data, info } = await input.flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  let left = w, top = h, right = -1, bottom = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (1 - data[y * w + x] / 255 < settings.trimThreshold) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error("No ink found.");
  const boxWidth = right - left + 1, boxHeight = bottom - top + 1;
  const scale = Math.min((width - settings.padding * 2) / boxWidth, (height - settings.padding * 2) / boxHeight);
  const resized = await sharp(data, { raw: { width: w, height: h, channels: 1 } })
    .extract({ left, top, width: boxWidth, height: boxHeight })
    .resize({ width: Math.max(1, Math.round(boxWidth * scale)), height: Math.max(1, Math.round(boxHeight * scale)), fit: "fill" })
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  const rw = resized.info.width, rh = resized.info.height;
  let mass = 0, cx = 0, cy = 0;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const ink = 1 - resized.data[y * rw + x] / 255;
    mass += ink; cx += ink * x; cy += ink * y;
  }
  if (mass < 1) throw new Error("Not enough ink.");
  const margin = settings.maxShift + 1;
  const ox = clamp(Math.round((width - 1) / 2 - cx / mass), margin, width - rw - margin);
  const oy = clamp(Math.round((height - 1) / 2 - cy / mass), margin, height - rh - margin);
  const pixels = new Float32Array(width * height);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) pixels[(y + oy) * width + x + ox] = 1 - resized.data[y * rw + x] / 255;
  const edges: [number, number][] = [];
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, t = settings.contourThreshold;
    if (pixels[i] >= t && (pixels[i - 1] < t || pixels[i + 1] < t || pixels[i - width] < t || pixels[i + width] < t)) edges.push([x, y]);
  }
  if (!edges.length) throw new Error("No readable outline.");
  return { pixels, edges, field: distanceField(edges, width, height), sample: {
    id: candidate.id, source: candidate.source, originalSize: [w, h], inkBox: [left, top, boxWidth, boxHeight],
    scale: round(scale), offset: [ox, oy],
  } };
}

function compare(a: Glyph, b: Glyph, width: number) {
  let distance = Infinity, shift: [number, number] = [0, 0];
  for (let dy = -settings.maxShift; dy <= settings.maxShift; dy++) for (let dx = -settings.maxShift; dx <= settings.maxShift; dx++) {
    let ab = 0, ba = 0;
    for (const [x, y] of a.edges) ab += b.field[(y - dy) * width + x - dx];
    for (const [x, y] of b.edges) ba += a.field[(y + dy) * width + x + dx];
    const score = (ab / a.edges.length + ba / b.edges.length) / 2;
    if (score < distance - 1e-8 || (Math.abs(score - distance) < 1e-8 && dx * dx + dy * dy < shift[0] ** 2 + shift[1] ** 2)) {
      distance = score; shift = [dx, dy];
    }
  }
  // This shift places b onto a. Both contour directions contribute equally.
  return { distance, shift };
}

function translate(pixels: Float32Array, width: number, height: number, [dx, dy]: [number, number]) {
  const moved = new Float32Array(pixels.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) moved[ny * width + nx] = pixels[y * width + x];
  }
  return moved;
}

async function grayscale(pixels: Float32Array, width: number, height: number, invert: boolean) {
  const bytes = Buffer.from(Uint8Array.from(pixels, (value) => Math.round(255 * clamp(invert ? 1 - value : value, 0, 1))));
  return dataUrl(await sharp(bytes, { raw: { width, height, channels: 1 } }).png().toBuffer());
}

async function heatmap(pixels: Float32Array, width: number, height: number) {
  const colors = [[255, 255, 255], [254, 240, 217], [253, 204, 138], [252, 141, 89], [227, 74, 51], [179, 0, 0]];
  const bytes = Buffer.alloc(pixels.length * 3);
  for (let i = 0; i < pixels.length; i++) {
    const value = clamp(pixels[i], 0, 1) * (colors.length - 1), lower = Math.min(Math.floor(value), colors.length - 2), fraction = value - lower;
    for (let c = 0; c < 3; c++) bytes[i * 3 + c] = Math.round(colors[lower][c] * (1 - fraction) + colors[lower + 1][c] * fraction);
  }
  return dataUrl(await sharp(bytes, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

/** Never infers labels, deletes outliers, rotates, or changes a review decision. */
export async function analyzeSymbol(latex: string, candidates: Candidate[]): Promise<Extract<SymbolAnalysis, { status: "complete" }>> {
  if (candidates.length < MIN_EXAMPLES) throw new Error(`At least ${MIN_EXAMPLES} accepted samples are required.`);
  if (candidates.length > settings.maxSamplesPerSymbol) throw new Error(`Maximum ${settings.maxSamplesPerSymbol} samples per symbol.`);
  const width = (settings.wideLabels as readonly string[]).includes(latex) ? settings.wideWidth : settings.width, height = settings.height;
  const glyphs: Glyph[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    try { glyphs.push(await normalize(candidate, width, height)); }
    catch { throw new Error(`Sample ${candidate.id} has an unreadable or empty PNG. Check its outline in Labeling.`); }
  }
  const n = glyphs.length, totals = new Float64Array(n);
  const pairs: { distance: number; shift: [number, number] }[][] = Array.from({ length: n }, () => []);
  const deadline = Date.now() + 60_000;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (Date.now() > deadline) throw new Error("This symbol exceeded the analysis time limit.");
    const pair = compare(glyphs[a], glyphs[b], width);
    pairs[a][b] = pair; pairs[b][a] = { distance: pair.distance, shift: [-pair.shift[0], -pair.shift[1]] };
    totals[a] += pair.distance; totals[b] += pair.distance;
    await setImmediate();
  }
  let medoid = 0;
  for (let i = 1; i < n; i++) if (totals[i] < totals[medoid] - 1e-8) medoid = i;
  const centeredMean = new Float32Array(width * height), alignedMean = new Float32Array(width * height);
  const samples: NormalizedSample[] = [];
  for (let i = 0; i < n; i++) {
    const shift: [number, number] = i === medoid ? [0, 0] : pairs[medoid][i].shift;
    const centered = glyphs[i].pixels, aligned = translate(centered, width, height, shift);
    for (let p = 0; p < centered.length; p++) { centeredMean[p] += centered[p] / n; alignedMean[p] += aligned[p] / n; }
    samples.push({ ...glyphs[i].sample, shift, distance: i === medoid ? 0 : round(pairs[medoid][i].distance),
      centered: await grayscale(centered, width, height, true), aligned: await grayscale(aligned, width, height, true) });
  }
  return { status: "complete", width, height,
    heatmap: { centered: await heatmap(centeredMean, width, height), aligned: await heatmap(alignedMean, width, height) },
    density: { centered: await grayscale(centeredMean, width, height, false), aligned: await grayscale(alignedMean, width, height, false) },
    medoid: { id: samples[medoid].id, image: samples[medoid].centered, meanDistance: round(totals[medoid] / (n - 1)) }, samples };
}
