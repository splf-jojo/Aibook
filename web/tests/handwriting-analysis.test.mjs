import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeSymbol } from "../lib/handwriting-analysis.server.ts";
import { ANALYSIS_SETTINGS } from "../lib/handwriting-analysis.ts";
import { approveDataset, datasetFingerprint, decide, exportDataset, freshReview, parseDataset } from "../lib/handwriting-dataset.ts";
import { analysisPreview, applyReviewAction, catalog, createDataset, readDataset, runAnalysis } from "../lib/handwriting-store.server.ts";

async function png(rectangles, size = 128) {
  const data = Buffer.alloc(size * size, 255);
  for (const [left, top, width, height] of rectangles) for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) data[y * size + x] = 0;
  return `data:image/png;base64,${(await sharp(data, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer()).toString("base64")}`;
}
const plus = [[20, 48, 64, 8], [48, 20, 8, 64]];
const sample = (id, image, latex = "x") => ({ id, latex, image, context: image,
  source: { file: "synthetic.pdf", sha256: "a".repeat(64), page: 1, pageWidth: 600, pageHeight: 800, box: [Number(id.replace(/\D/g, "")) * 20 || 0, 20, 10, 10] } });
async function pixels(url) { return sharp(Buffer.from(url.split(",")[1], "base64")).greyscale().raw().toBuffer({ resolveWithObject: true }); }

test("normalization removes crop offsets and scale while preserving a wide glyph's proportions", async () => {
  const images = await Promise.all([png([[20, 30, 64, 16]]), png([[40, 60, 128, 32]], 256), png([[30, 50, 64, 16]])]);
  const result = await analyzeSymbol("x", images.map((image, i) => sample(`s${i}`, image)));
  assert.equal(result.width, 128); assert.equal(result.height, 128);
  const decoded = await pixels(result.medoid.image);
  let left = 128, top = 128, right = 0, bottom = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (decoded.data[y * 128 + x] < 128) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  assert.equal(right - left + 1, 96); assert.equal(bottom - top + 1, 24);
  assert.deepEqual(result.samples.map(s => s.shift), [[0, 0], [0, 0], [0, 0]]);
  assert.ok(result.samples.every(s => s.centered === result.medoid.image));
  const wide = await analyzeSymbol("\\sin", images.map((image, i) => sample(`s${i}`, image)));
  assert.equal(wide.width, 256); assert.equal(wide.height, 128);
});

test("medoid is an actual representative sample, deterministic under reordering; outliers stay in the heatmap", async () => {
  const image = await png(plus), outlier = await png([[20, 20, 8, 64], [20, 76, 64, 8]]);
  const input = [sample("s1", image), sample("s2", image), sample("s3", image), sample("s4", outlier)];
  const result = await analyzeSymbol("x", input);
  assert.equal(result.medoid.id, "s1"); assert.equal(result.samples.length, 4);
  assert.equal(result.medoid.image, result.samples.find(s => s.id === result.medoid.id).centered);
  assert.ok(result.samples.find(s => s.id === "s4").distance > 1);
  assert.deepEqual(await analyzeSymbol("x", [...input].reverse()), result);
  const density = (await pixels(result.density.aligned)).data;
  const members = await Promise.all(result.samples.map(async s => (await pixels(s.aligned)).data));
  for (let i = 0; i < density.length; i++) {
    const mean = members.reduce((sum, data) => sum + 255 - data[i], 0) / members.length;
    assert.ok(Math.abs(density[i] - mean) <= 1, "Density must equal the mean of all accepted aligned samples.");
  }
  assert.ok(result.samples.every(s => s.shift.every(value => Math.abs(value) <= ANALYSIS_SETTINGS.maxShift)));
});

test("insufficient, empty and malformed samples never produce a substitute glyph", async () => {
  const image = await png(plus), blank = await png([]);
  await assert.rejects(analyzeSymbol("x", [sample("s1", image), sample("s2", image)]), /At least 3/);
  await assert.rejects(analyzeSymbol("x", Array.from({ length: 65 }, (_, i) => sample(`s${i}`, image))), /Maximum 64/);
  await assert.rejects(analyzeSymbol("x", [sample("s1", image), sample("s2", image), sample("s3", blank)]), /Sample s3/);
  await assert.rejects(analyzeSymbol("x", [sample("s1", image), sample("s2", image), sample("s3", "data:image/png;base64,aW52YWxpZA==")]), /unreadable/);
});

test("one broken accepted crop fails its group without silently dropping it or blocking good groups", async () => {
  const previous = process.env.HANDWRITING_DATA_DIR;
  const folder = await mkdtemp(path.join(os.tmpdir(), "aibook-analysis-test-"));
  process.env.HANDWRITING_DATA_DIR = folder;
  try {
    const image = await png(plus), blank = await png([]);
    const data = parseDataset({ schemaVersion: 1, kind: "handwriting-candidates", name: "Partially invalid analysis",
      samples: ["x", "x", "x", "z", "z", "z"].map((latex, i) => sample(`s${i + 1}`, i === 5 ? blank : image, latex)) });
    let review = data.samples.reduce((r, s) => decide(r, s, "accepted", s.latex), freshReview());
    review = approveDataset(data, { ...review, inspectedRevision: review.revision });
    const item = await createDataset(exportDataset({ dataset: data, review, fingerprint: await datasetFingerprint(data) }), { sourceCandidates: data });
    const result = await runAnalysis(item.id, 0);
    assert.equal(result.status, "partial");
    assert.equal(result.symbols.find(s => s.latex === "x").result.status, "complete");
    const failed = result.symbols.find(s => s.latex === "z");
    assert.equal(failed.count, 3); assert.equal(failed.result.status, "failed");
    assert.match(failed.result.error, /Sample s6/);
    assert.equal(failed.result.heatmap, undefined);
    assert.equal((await catalog())[0].analysisStatus, "partial");
    assert.deepEqual((await readDataset(item.id)).review.decisions, review.decisions);
  } finally {
    if (previous === undefined) delete process.env.HANDWRITING_DATA_DIR; else process.env.HANDWRITING_DATA_DIR = previous;
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith("aibook-analysis-test-"));
    await rm(folder, { recursive: true, force: true });
  }
});

test("approved analysis persists, deduplicates requests, excludes rejected and rare labels, and becomes stale after a review", async () => {
  const previous = process.env.HANDWRITING_DATA_DIR;
  const folder = await mkdtemp(path.join(os.tmpdir(), "aibook-analysis-test-"));
  process.env.HANDWRITING_DATA_DIR = folder;
  try {
    const image = await png(plus);
    const data = parseDataset({ schemaVersion: 1, kind: "handwriting-candidates", name: "Analysis test", samples:
      ["x", "x", "x", "q", "y", "z"].map((latex, i) => sample(`s${i + 1}`, image, latex)) });
    let review = data.samples.reduce((r, s) => decide(r, s, s.latex === "z" ? "rejected" : "accepted", s.latex === "q" ? "x" : s.latex), freshReview());
    review = approveDataset(data, { ...review, inspectedRevision: review.revision });
    const approved = exportDataset({ dataset: data, review, fingerprint: await datasetFingerprint(data) });
    const item = await createDataset(approved, { sourceCandidates: data });
    const statePath = path.join(folder, item.id, "state.json"), before = await readFile(statePath, "utf8");
    await assert.rejects(runAnalysis(item.id, 99), error => error.status === 409);
    const [first, second] = await Promise.all([runAnalysis(item.id, 0), runAnalysis(item.id, 0)]);
    assert.equal(first.status, "complete"); assert.deepEqual(second, first);
    assert.deepEqual(first.symbols.map(s => [s.latex, s.count]), [["x", 4]]);
    assert.deepEqual(await analysisPreview(item.id), first);
    assert.deepEqual(await runAnalysis(item.id, 0), first);
    assert.equal((await catalog())[0].analysisStatus, "complete");
    assert.equal(await readFile(statePath, "utf8"), before, "Analysis must not write review state.");
    await applyReviewAction(item.id, { expectedVersion: 0, type: "decide", sampleId: "s1", status: "rejected", latex: "x" });
    assert.equal((await analysisPreview(item.id)).status, "stale");
    assert.deepEqual((await analysisPreview(item.id)).symbols, []);
    await assert.rejects(runAnalysis(item.id, 1), /Approve/);
    await applyReviewAction(item.id, { expectedVersion: 1, type: "approve" });
    const stale = await analysisPreview(item.id);
    assert.equal(stale.status, "stale"); assert.equal(stale.symbols[0].result, undefined);
    const refreshed = await runAnalysis(item.id, 2);
    assert.equal(refreshed.status, "complete"); assert.equal(refreshed.symbols[0].count, 3);
    assert.ok(!refreshed.symbols[0].result.samples.some(s => s.id === "s1"));

    // A second, uncached version changes while computation is in flight.
    await applyReviewAction(item.id, { expectedVersion: 2, type: "decide", sampleId: "s1", status: "accepted", latex: "x" });
    await applyReviewAction(item.id, { expectedVersion: 3, type: "approve" });
    const pending = runAnalysis(item.id, 4);
    const rejected = assert.rejects(pending, /review changed/);
    for (let i = 0; i < 100; i++) {
      if ((await analysisPreview(item.id)).status === "running") break;
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    await applyReviewAction(item.id, { expectedVersion: 4, type: "decide", sampleId: "s1", status: "rejected", latex: "x" });
    await rejected;
    assert.equal((await readDataset(item.id)).version, 5);
    assert.equal((await analysisPreview(item.id)).status, "stale");
  } finally {
    if (previous === undefined) delete process.env.HANDWRITING_DATA_DIR; else process.env.HANDWRITING_DATA_DIR = previous;
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith("aibook-analysis-test-"));
    await rm(folder, { recursive: true, force: true });
  }
});
