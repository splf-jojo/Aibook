import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { nativeWritingGlyphs } from "../lib/handwriting-native.server.ts";
import { nativeGlyphLayout, placeNativeGlyph, DEFAULT_WRITING_SETTINGS as defaults } from "../lib/handwriting-writing.ts";

async function fixture() {
  const dataset = { schemaVersion: 2, samples: [] }, cells = [], symbols = [];
  for (const [latex, w, h, top] of [["a", 12, 18, 14], ["b", 12, 30, 2], ["y", 14, 28, 14]]) {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const id = `${latex}${i}`, box = [i * 60, symbols.length * 60, 52, 52];
      const pixels = Buffer.alloc(156 * 156 * 4);
      for (let y = top * 3; y < (top + h) * 3; y++) for (let x = 12 * 3; x < (12 + w) * 3; x++) {
        const p = (y * 156 + x) * 4;
        pixels[p] = pixels[p + 1] = pixels[p + 2] = 255; pixels[p + 3] = 200;
      }
      const image = `data:image/png;base64,${(await sharp(pixels, { raw: { width: 156, height: 156, channels: 4 } }).png().toBuffer()).toString("base64")}`;
      dataset.samples.push({ id, latex, image, source: { page: 1, box } });
      cells.push({ id, page: 1, box: [box[0] + 2, box[1] + 2, 48, 48] });
      samples.push({ id, originalSize: [156, 156], inkBox: [36, top * 3, w * 3, h * 3] });
    }
    symbols.push({ latex, result: { status: "complete", medoid: { id: samples[0].id }, samples } });
  }
  return { analysis: { symbols }, dataset, source: { renderScale: 3, configuration: { version: 3, cellSize: 48 }, cells } };
}

test("native crops preserve original resolution, alpha, relative sizes and worksheet descenders", async () => {
  const f = await fixture(), before = JSON.stringify(f);
  const glyphs = await nativeWritingGlyphs(f.analysis, f.dataset, f.source);
  assert.equal(JSON.stringify(f), before, "Never rewrite the source or analysis");
  const [a, b, y] = glyphs;
  assert.equal(a.width, 38); assert.equal(a.height, 56);
  assert.equal(b.height, 92);
  assert.equal(a.metrics.unitsPerEm, b.metrics.unitsPerEm);
  const renderedA = placeNativeGlyph(0, 60, "a", a, 0, defaults), renderedB = placeNativeGlyph(40, 60, "b", b, 1, defaults);
  assert.ok(Math.abs(renderedB.height / renderedA.height - b.height / a.height) < 1e-10);
  assert.ok(y.metrics.height - y.metrics.baseline > 9);
  assert.equal(a.metrics.baselineMethod, "worksheet-peers");
  const image = await sharp(Buffer.from(a.image.split(",")[1], "base64")).raw().toBuffer();
  assert.equal(image[3], 0);
  assert.equal(image[(a.width + 1) * 4 + 3], 200);
  assert.equal(image[(a.width + 1) * 4], 0);
});

test("source metrics use a shared scale; padding and variation never resize native ink", async () => {
  const f = await fixture(), glyph = (await nativeWritingGlyphs(f.analysis, f.dataset, f.source))[1];
  const normal = nativeGlyphLayout(glyph, 0, defaults);
  const modified = nativeGlyphLayout(glyph, 0, { ...defaults, variation: 100, padding: { top: 8, right: 4, bottom: 8, left: 4 } });
  assert.equal(modified.width, normal.width); assert.equal(modified.height, normal.height);
  assert.ok(modified.advance > normal.advance);
  const script = nativeGlyphLayout(glyph, 0, defaults, 0.707);
  assert.ok(Math.abs(script.height / normal.height - 0.707) < 1e-10);
});

test("legacy/incomplete sources retain legacy behavior; corrupt native geometry fails explicitly", async () => {
  const f = await fixture();
  assert.equal(await nativeWritingGlyphs(f.analysis, { ...f.dataset, schemaVersion: 1 }, f.source), null);
  assert.equal(await nativeWritingGlyphs(f.analysis, f.dataset, { configuration: { version: 3 }, cells: [] }), null);
  await assert.rejects(nativeWritingGlyphs(f.analysis, f.dataset, { ...f.source, renderScale: 2 }), /coordinates/);
});
