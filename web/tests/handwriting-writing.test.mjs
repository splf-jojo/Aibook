import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_WRITING_SETTINGS as defaults, layoutText, placeGlyph, randomVariation, textTokens } from "../lib/handwriting-writing.ts";
import { cleanLatex, glyphAliases } from "../lib/handwriting-writing-renderer.ts";
import { writingDataset } from "../lib/handwriting-writing.server.ts";
import { approveDataset, datasetFingerprint, decide, exportDataset, freshReview, parseDataset } from "../lib/handwriting-dataset.ts";
import { applyReviewAction, createDataset, runAnalysis } from "../lib/handwriting-store.server.ts";

const glyph = (latex, width = 48, height = 80) => ({ latex, medoidId: `medoid-${latex}`, image: "data:image/png;base64,", width, height });

test("LaTeX aliases support functions, differential pairs, operators and distinct alphabets", () => {
  const aliases = glyphAliases(["x", "dx", "\\sin", "\\cos", "-", "\\int", "\\partial", "\\mathbb{R}"].map(s => glyph(s)));
  assert.equal(aliases.get("sin").latex, "\\sin");
  assert.equal(aliases.get("cos").latex, "\\cos");
  assert.equal(aliases.get("∫").latex, "\\int");
  assert.equal(aliases.get("∂").latex, "\\partial");
  assert.equal(aliases.get("−").latex, "-");
  assert.equal(aliases.get("-").latex, "-");
  assert.equal(aliases.get("ℝ").latex, "\\mathbb{R}");
  assert.equal(aliases.has("R"), false);
  assert.deepEqual(textTokens("dx sin x", aliases).map(s => s.glyph?.latex ?? s.text), ["dx", " ", "\\sin", " ", "x"]);
  assert.equal(cleanLatex("$$x^2$$"), "x^2");
  assert.equal(cleanLatex("\\[x^2\\]"), "x^2");
});

test("text preserves lines, wraps, reports missing characters, and bounds horizontal operators", () => {
  const aliases = new Map([["x", glyph("x")], ["-", glyph("-", 96, 8)]]);
  const result = layoutText("xx - a\nxxxy", aliases, defaults, 90);
  assert.deepEqual(result.missing, ["a", "y"]);
  assert.equal(result.placements.filter(p => p.glyph).length, 6);
  assert.ok(result.placements.find(p => p.label === "-").width < defaults.size);
  assert.ok(result.placements.at(-1).y > result.placements[0].y + defaults.size);
  assert.ok(result.placements.every(p => p.x + p.width <= 90.001));
  assert.ok(result.placements.filter(p => !p.glyph).every(p => p.label === "a" || p.label === "y"));
});

test("variation is reproducible, zero is stable, and medoid proportions are never distorted", () => {
  const box = { x: 10, y: 20, width: 70, height: 90 }, item = glyph("x");
  assert.deepEqual(placeGlyph(box, "x", item, 0, defaults), placeGlyph(box, "x", item, 0, { ...defaults, seed: 900 }));
  const varied = { ...defaults, variation: 70 };
  assert.deepEqual(randomVariation(2, varied), randomVariation(2, varied));
  assert.notDeepEqual(randomVariation(2, varied), randomVariation(2, { ...varied, seed: 2 }));
  const placed = placeGlyph(box, "x", item, 2, varied);
  assert.ok(Math.abs(placed.width / placed.height - item.width / item.height) < 1e-10);
  assert.equal(placed.glyph.medoidId, item.medoidId);
});

test("writing serves transparent accepted medoids, never edits reviews, and drops stale or unapproved results", async () => {
  const previous = process.env.HANDWRITING_DATA_DIR, folder = await mkdtemp(path.join(os.tmpdir(), "aibook-writing-test-"));
  process.env.HANDWRITING_DATA_DIR = folder;
  try {
    const pixels = Buffer.alloc(64 * 64, 255);
    for (let i = 10; i < 54; i++) for (let d = -2; d <= 2; d++) { pixels[i * 64 + i + d] = 0; pixels[i * 64 + 63 - i + d] = 0; }
    const image = `data:image/png;base64,${(await sharp(pixels, { raw: { width: 64, height: 64, channels: 1 } }).png().toBuffer()).toString("base64")}`;
    const data = parseDataset({ schemaVersion: 1, kind: "handwriting-candidates", name: "Writing test", samples: Array.from({ length: 4 }, (_, i) => ({
      id: `s${i}`, latex: "x", image, context: image, source: { file: "synthetic.pdf", sha256: "a".repeat(64), page: 1, pageWidth: 600, pageHeight: 800, box: [20 * i, 0, 10, 10] },
    })) });
    let review = data.samples.reduce((r, s) => decide(r, s, "accepted", "x"), freshReview());
    review = approveDataset(data, { ...review, inspectedRevision: review.revision });
    const item = await createDataset(exportDataset({ dataset: data, review, fingerprint: await datasetFingerprint(data) }), { sourceCandidates: data });
    assert.deepEqual((await writingDataset(item.id)).glyphs, []);
    await runAnalysis(item.id, 0);
    const state = await readFile(path.join(folder, item.id, "state.json"), "utf8");
    const pack = await writingDataset(item.id);
    assert.equal(pack.glyphs.length, 1); assert.equal(pack.glyphs[0].medoidId, "s0");
    const decoded = await sharp(Buffer.from(pack.glyphs[0].image.split(",")[1], "base64")).raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.channels, 4);
    const alpha = decoded.data.filter((_, i) => i % 4 === 3);
    assert.ok(alpha.includes(0)); assert.ok(alpha.includes(255));
    assert.equal(await readFile(path.join(folder, item.id, "state.json"), "utf8"), state);
    await applyReviewAction(item.id, { type: "decide", expectedVersion: 0, sampleId: "s0", status: "rejected", latex: "x" });
    assert.deepEqual((await writingDataset(item.id)).glyphs, []);
    await applyReviewAction(item.id, { type: "approve", expectedVersion: 1 });
    const stale = await writingDataset(item.id);
    assert.equal(stale.status, "stale"); assert.deepEqual(stale.glyphs, []);
  } finally {
    if (previous === undefined) delete process.env.HANDWRITING_DATA_DIR; else process.env.HANDWRITING_DATA_DIR = previous;
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith("aibook-writing-test-"));
    await rm(folder, { recursive: true, force: true });
  }
});
