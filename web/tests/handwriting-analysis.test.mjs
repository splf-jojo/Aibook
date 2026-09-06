import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { analyzeSymbol } from "../lib/handwriting-analysis.server.ts";
import { ANALYSIS_SETTINGS } from "../lib/handwriting-analysis.ts";

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
