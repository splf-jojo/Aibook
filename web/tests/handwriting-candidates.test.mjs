import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { canonicalCandidates } from "../lib/handwriting-candidates.server.ts";

async function fixture(rgb = 255, opaque = false) {
  const pixels = Buffer.alloc(32 * 24 * 4);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
    const p = (y * 32 + x) * 4, ink = x >= 10 && x < 18 && y >= 6 && y < 20;
    pixels[p] = pixels[p + 1] = pixels[p + 2] = ink ? rgb : 255;
    pixels[p + 3] = opaque ? 255 : ink ? (x === 10 ? 80 : 255) : 0;
  }
  const png = await sharp(pixels, { raw: { width: 32, height: 24, channels: 4 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
function dataset(image, schemaVersion = 2) {
  return { schemaVersion, kind: "handwriting-candidates", name: "Native ink", samples: [{
    id: "r1-c1", latex: "a", image, context: image,
    source: { kind: "pencilkit", file: "drawing.pkdrawing", sha256: "a".repeat(64), page: 2,
      pageWidth: 600, pageHeight: 800, box: [20, 40, 32, 24], crossesCellBoundary: true },
  }] };
}
async function raw(image) {
  return sharp(Buffer.from(image.split(",")[1], "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

test("dark-mode PencilKit ink becomes visible without changing any alpha, geometry, label or input", async () => {
  const input = dataset(await fixture()), snapshot = structuredClone(input);
  const result = await canonicalCandidates(input);
  const before = await raw(input.samples[0].image), after = await raw(result.samples[0].image);
  assert.equal(after.info.width, 32); assert.equal(after.info.height, 24);
  for (let p = 0; p < before.data.length; p += 4) {
    assert.equal(after.data[p + 3], before.data[p + 3], "Antialiasing and stroke positions must be exact");
    if (after.data[p + 3]) assert.deepEqual([...after.data.subarray(p, p + 3)], [0, 0, 0]);
  }
  assert.deepEqual(input, snapshot, "Immutable source is untouched");
  assert.deepEqual(result.samples[0].source, input.samples[0].source);
  assert.equal(result.samples[0].latex, "a");
  assert.equal(result.samples[0].image, result.samples[0].context);
  assert.deepEqual(await canonicalCandidates(result), result, "Repeated reads are stable");
});

test("PDF, opaque paper and already-black native PNGs keep their original bytes", async () => {
  for (const input of [dataset(await fixture(), 1), dataset(await fixture(0, true)), dataset(await fixture(0))]) {
    assert.deepEqual(await canonicalCandidates(input), input);
  }
});

test("empty and unreadable images remain empty/rejectable, never get substitute strokes", async () => {
  const blank = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).png().toBuffer();
  for (const image of [`data:image/png;base64,${blank.toString("base64")}`, "data:image/png;base64,iVBORw0KGgo="]) {
    const input = dataset(image);
    assert.deepEqual(await canonicalCandidates(input), input);
  }
});
