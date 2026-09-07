import test from "node:test";
import assert from "node:assert/strict";
import { signedDistance, averageGlyphs, detectControlPoints, localWarp, augmentGlyph } from "../lib/handwriting-geometry.ts";
import { parseExperimentConfig } from "../lib/handwriting-experiment.server.ts";
import { defaultAugmentation } from "../lib/handwriting-experiment.ts";

const mask = (w, h, inside) => Uint8Array.from({ length: w * h }, (_, i) => Number(inside(i % w, Math.floor(i / w))));

test("signed distance agrees with brute-force Euclidean distances, including image borders", () => {
  for (const [w, h] of [[11, 9], [7, 5]]) {
    const ink = mask(w, h, (x, y) => ((x * 7 + y * 3) % 9 < 4));
    const field = signedDistance(ink, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let best = Infinity;
      const value = ink[y * w + x];
      for (let yy = -1; yy <= h; yy++) for (let xx = -1; xx <= w; xx++) {
        const other = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : ink[yy * w + xx];
        if (other !== value) best = Math.min(best, Math.hypot(x - xx, y - yy));
      }
      assert.ok(Math.abs(field[y * w + x] - (value ? best : -best)) < 1e-8);
    }
  }
  assert.equal(signedDistance(new Uint8Array(9).fill(1), 3, 3)[4], 2);
  assert.throws(() => signedDistance(new Uint8Array(9), 3, 3), /Empty/);
});

test("thresholded mean and mean signed-distance shape differ for three displaced strokes", () => {
  const samples = [10, 13, 16].map(left => Float32Array.from(mask(32, 32, (x, y) => x >= left && x < left + 5 && y >= 5 && y < 27)));
  const result = averageGlyphs(samples, 32, 32);
  const thresholded = Uint8Array.from(result.density, v => Number(v >= .5));
  assert.equal(thresholded[16 * 32 + 15], 0);
  assert.equal(result.shape[16 * 32 + 15], 1);
  assert.ok(result.shape.some((v, i) => v !== thresholded[i]));
  const same = averageGlyphs([samples[0], samples[0], samples[0]], 32, 32);
  assert.deepEqual(same.shape, Uint8Array.from(samples[0]));
});

const b = mask(128, 128, (x, y) => (x >= 44 && x <= 50 && y >= 20 && y <= 105)
  || (((x - 62) ** 2 / 22 ** 2 + (y - 84) ** 2 / 23 ** 2 <= 1) && ((x - 62) ** 2 / 15 ** 2 + (y - 84) ** 2 / 16 ** 2 >= 1)));
test("automatic points cover an ascender, branch and closed loop; deterministic with no ink", () => {
  const points = detectControlPoints(b, 128, 128);
  assert.ok(points.some(p => p.kind === "endpoint" && p.y < 32));
  assert.ok(points.some(p => p.kind === "junction"));
  assert.ok(points.some(p => p.x > 70));
  assert.deepEqual(detectControlPoints(b, 128, 128), points);
  assert.deepEqual(detectControlPoints(new Uint8Array(128 * 128), 128, 128), []);
});

test("local deformation extends the upper b while its loop stays fixed", () => {
  const points = [{ id: "tip", x: 47, y: 23, kind: "endpoint", movable: true }, { id: "base", x: 47, y: 61, kind: "junction", movable: false }];
  const targets = [{ x: 47, y: 17 }, { x: 47, y: 61 }];
  const map = localWarp(points, targets, 32);
  assert.deepEqual(map(47, 17), [47, 23]);
  assert.deepEqual(map(47, 61), [47, 61]);
  assert.deepEqual(map(75, 90), [75, 90]);
  const settings = { ...defaultAugmentation, radius: 32, direction: "up" };
  const first = augmentGlyph(b, 128, 128, points, settings, 42);
  assert.deepEqual(augmentGlyph(b, 128, 128, points, settings, 42), first);
  assert.notDeepEqual(augmentGlyph(b, 128, 128, points, settings, 43).pixels, first.pixels);
  assert.ok(first.pixels.some((v, i) => i < 45 * 128 && v !== b[i]));
  for (let i = 62 * 128; i < b.length; i++) assert.equal(first.pixels[i], b[i]);
  assert.deepEqual(augmentGlyph(b, 128, 128, points, { ...settings, strength: 0 }, 42).pixels, Float32Array.from(b));
  const automatic = detectControlPoints(b, 128, 128);
  assert.ok(augmentGlyph(b, 128, 128, automatic, defaultAugmentation, 1).pixels.some(Boolean));
});

test("invalid deformations and forged settings cannot be silently saved", () => {
  const points = [{ id: "tip", x: 47, y: 2, kind: "manual", movable: true }];
  assert.throws(() => augmentGlyph(b, 128, 128, points, { ...defaultAugmentation, direction: "up" }, 1), /edge/);
  const config = { threshold: .5, points: detectControlPoints(b, 128, 128), augmentation: defaultAugmentation };
  assert.deepEqual(parseExperimentConfig(config, 128, 128), config);
  for (const invalid of [{ ...config, threshold: NaN }, { ...config, points: [...config.points, config.points[0]] },
    { ...config, augmentation: { ...defaultAugmentation, count: 999 } }, { ...config, augmentation: { ...defaultAugmentation, seed: .5 } }]) {
    assert.throws(() => parseExperimentConfig(invalid, 128, 128));
  }
});
