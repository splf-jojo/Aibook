import sharp from "sharp";
import { setImmediate } from "node:timers/promises";
import { pool, transaction, hash, storeBlobs, restoreBlobs } from "./handwriting-db.server.ts";
import { datasetRow, requireDev } from "./handwriting-store.server.ts";
import { LibraryError } from "./handwriting-errors.ts";
import type { Identity } from "./handwriting-access.server.ts";
import type { AnalysisRecord, SymbolAnalysis } from "./handwriting-analysis.ts";
import { EXPERIMENT_VERSION, defaultAugmentation, type Alignment, type ExperimentConfig, type GlyphExperiment } from "./handwriting-experiment.ts";
import { averageGlyphs, detectControlPoints, augmentGlyph } from "./handwriting-geometry.ts";

type ReadySymbol = Extract<SymbolAnalysis, { status: "complete" }>;
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new LibraryError("Invalid experiment.");
  return input as Record<string, unknown>;
}
function bounded(value: unknown, low: number, high: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high || (integer && !Number.isSafeInteger(value))) throw new LibraryError("Invalid experiment setting.");
  return value;
}
export function parseExperimentConfig(input: unknown, width: number, height: number): ExperimentConfig {
  const config = object(input), aug = object(config.augmentation);
  if (!Array.isArray(config.points) || config.points.length > 32) throw new LibraryError("Use at most 32 control points.");
  const ids = new Set<string>();
  const points = config.points.map(value => {
    const p = object(value);
    if (typeof p.id !== "string" || !/^[a-zA-Z0-9-]{1,40}$/.test(p.id) || ids.has(p.id) || typeof p.movable !== "boolean"
      || !["endpoint", "junction", "bend", "extreme", "manual"].includes(String(p.kind))) throw new LibraryError("Invalid control point.");
    ids.add(p.id);
    return { id: p.id, x: bounded(p.x, 1, width - 2), y: bounded(p.y, 1, height - 2), kind: p.kind as ExperimentConfig["points"][number]["kind"], movable: p.movable };
  });
  if (points.some((p, i) => points.some((q, j) => j < i && Math.hypot(p.x - q.x, p.y - q.y) < 2))) throw new LibraryError("Place control points at least 2 pixels apart.");
  if (!["free", "up", "down", "left", "right", "horizontal", "vertical"].includes(String(aug.direction))) throw new LibraryError("Invalid direction.");
  return { threshold: bounded(config.threshold, .05, .95), points, augmentation: {
    strength: bounded(aug.strength, 0, 16), radius: bounded(aug.radius, 12, 96), count: bounded(aug.count, 1, 12, true),
    seed: bounded(aug.seed, 0, 2147483647, true), direction: aug.direction as ExperimentConfig["augmentation"]["direction"],
  } };
}
async function image(ink: ArrayLike<number>, width: number, height: number) {
  const bytes = Buffer.from(Uint8Array.from(ink, v => Math.round(255 * (1 - Math.max(0, Math.min(1, v))))));
  return `data:image/png;base64,${(await sharp(bytes, { raw: { width, height, channels: 1 } }).png().toBuffer()).toString("base64")}`;
}
export async function experimentBase(symbol: ReadySymbol, alignment: Alignment) {
  const samples: Float32Array[] = [];
  for (const sample of symbol.samples) {
    const { data, info } = await sharp(Buffer.from(sample[alignment].split(",")[1], "base64"), { limitInputPixels: 32768 }).flatten({ background: "white" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== symbol.width || info.height !== symbol.height) throw new LibraryError("Sample dimensions changed. Reanalyze the dataset.", 409);
    samples.push(Float32Array.from(data, v => 1 - v / 255));
  }
  const { density, shape } = averageGlyphs(samples, symbol.width, symbol.height);
  return { density, shape, autoPoints: detectControlPoints(shape, symbol.width, symbol.height), shapeImage: await image(shape, symbol.width, symbol.height) };
}
const analysisKey = (job: { id: string; result: unknown }) => hash(`${EXPERIMENT_VERSION}:${job.id}:${JSON.stringify(job.result)}`);
async function source(id: string, latex: unknown, version: unknown, alignment: unknown, actor: Identity) {
  requireDev(actor);
  if (typeof latex !== "string" || latex.length > 200 || !["centered", "aligned"].includes(String(alignment))) throw new LibraryError("Invalid symbol or alignment.");
  const dataset = await datasetRow(id, actor);
  if (dataset.version !== version || !dataset.review.approvedAt) throw new LibraryError("The dataset changed. Reload Analysis.", 409);
  const job = (await pool.query("SELECT id,result,status FROM handwriting_jobs WHERE dataset_id=$1 AND source_version=$2", [id, version])).rows[0];
  if (!job?.result || !["complete", "partial"].includes(job.status)) throw new LibraryError("Analyze this symbol first.", 409);
  // Restore only this symbol's assets, not every PNG in the full analysis.
  const stored = (job.result as AnalysisRecord).symbols.find(s => s.latex === latex)?.result;
  if (stored?.status !== "complete") throw new LibraryError("This symbol has no completed analysis.", 404);
  const symbol = await restoreBlobs<ReadySymbol>(id, stored);
  return { symbol, key: analysisKey(job), version: dataset.version as number, latex, alignment: alignment as Alignment };
}
export async function readExperiment(id: string, latex: unknown, version: unknown, alignment: unknown, actor: Identity): Promise<GlyphExperiment> {
  const src = await source(id, latex, version, alignment, actor);
  const row = (await pool.query("SELECT payload FROM handwriting_experiments WHERE dataset_id=$1 AND analysis_key=$2 AND latex=$3 AND alignment=$4", [id, src.key, src.latex, src.alignment])).rows[0];
  if (row) return restoreBlobs<GlyphExperiment>(id, row.payload);
  const base = await experimentBase(src.symbol, src.alignment);
  return { algorithm: EXPERIMENT_VERSION, analysisKey: src.key, sourceVersion: src.version, latex: src.latex, alignment: src.alignment,
    revision: 0, width: src.symbol.width, height: src.symbol.height,
    config: { threshold: .5, points: base.autoPoints, augmentation: { ...defaultAugmentation } },
    autoPoints: base.autoPoints, shapeImage: base.shapeImage,
    thresholdImage: await image(Uint8Array.from(base.density, v => Number(v >= .5)), src.symbol.width, src.symbol.height), variants: [] };
}
export async function saveExperiment(id: string, input: unknown, actor: Identity): Promise<GlyphExperiment> {
  requireDev(actor);
  const body = object(input);
  if (!["save", "generate"].includes(String(body.action))) throw new LibraryError("Invalid experiment action.");
  const src = await source(id, body.latex, body.sourceVersion, body.alignment, actor);
  if (body.analysisKey !== src.key) throw new LibraryError("The analysis changed. Reload Analysis.", 409);
  const revision = bounded(body.expectedRevision, 0, 2147483646, true);
  const prior = (await pool.query("SELECT revision,payload FROM handwriting_experiments WHERE dataset_id=$1 AND analysis_key=$2 AND latex=$3 AND alignment=$4", [id, src.key, src.latex, src.alignment])).rows[0];
  if ((prior?.revision ?? 0) !== revision) throw new LibraryError("This experiment changed in another tab. Reload before saving.", 409);
  const old = prior && body.action === "save" ? await restoreBlobs<GlyphExperiment>(id, prior.payload) : null;
  const config = parseExperimentConfig(body.config, src.symbol.width, src.symbol.height);
  const base = await experimentBase(src.symbol, src.alignment);
  const variants: GlyphExperiment["variants"] = [];
  if (body.action === "generate") {
    if (!base.shape.some(Boolean)) throw new LibraryError("The mean shape is empty. Review the source samples.");
    if (!config.points.some(p => p.movable)) throw new LibraryError("Choose at least one moving point.");
    for (let i = 0; i < config.augmentation.count; i++) {
      try {
        const variant = augmentGlyph(base.shape, src.symbol.width, src.symbol.height, config.points, config.augmentation, (config.augmentation.seed + i) >>> 0);
        variants.push({ image: await image(variant.pixels, src.symbol.width, src.symbol.height), seed: variant.seed, targets: variant.targets });
      } catch (error) { throw new LibraryError(error instanceof Error ? error.message : "Could not deform the glyph."); }
      await setImmediate();
    }
  }
  const experiment: GlyphExperiment = { algorithm: EXPERIMENT_VERSION, analysisKey: src.key, sourceVersion: src.version, latex: src.latex, alignment: src.alignment,
    revision: revision + 1, width: src.symbol.width, height: src.symbol.height, config, autoPoints: base.autoPoints, shapeImage: base.shapeImage,
    thresholdImage: await image(Uint8Array.from(base.density, v => Number(v >= config.threshold)), src.symbol.width, src.symbol.height),
    variants, ...(body.action === "generate" ? { generatedWith: config } : {}), updatedAt: new Date().toISOString() };
  return transaction(async client => {
    // Keep review and analysis fixed through the CAS, including a concurrent reanalysis.
    const dataset = (await client.query("SELECT version,review FROM handwriting_datasets WHERE id=$1 FOR SHARE", [id])).rows[0];
    const job = (await client.query("SELECT id,result,status FROM handwriting_jobs WHERE dataset_id=$1 AND source_version=$2 FOR SHARE", [id, src.version])).rows[0];
    if (!dataset || dataset.version !== src.version || !dataset.review.approvedAt || !job?.result || !["complete", "partial"].includes(job.status) || analysisKey(job) !== src.key) throw new LibraryError("The analysis changed. Reload Analysis.", 409);
    const previous = (await client.query("SELECT revision,payload FROM handwriting_experiments WHERE dataset_id=$1 AND analysis_key=$2 AND latex=$3 AND alignment=$4 FOR UPDATE", [id, src.key, src.latex, src.alignment])).rows[0];
    if ((previous?.revision ?? 0) !== revision) throw new LibraryError("This experiment changed in another tab. Reload before saving.", 409);
    // A settings-only save retains the last generated batch and its exact settings.
    if (old) {
      experiment.variants = old.variants; experiment.generatedWith = old.generatedWith;
    }
    const payload = await storeBlobs(client, id, experiment);
    const saved = await client.query(`INSERT INTO handwriting_experiments(dataset_id,source_version,analysis_key,latex,alignment,revision,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dataset_id,analysis_key,latex,alignment)
      DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=now()
      WHERE handwriting_experiments.revision=$8 RETURNING revision`, [id, src.version, src.key, src.latex, src.alignment, experiment.revision, payload, revision]);
    if (!saved.rowCount) throw new LibraryError("This experiment changed in another tab. Reload before saving.", 409);
    return experiment;
  });
}
