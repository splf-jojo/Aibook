import test from "node:test";
import assert from "node:assert/strict";
import { photoBounds, photoDropPoint, readCanvasPhoto } from "../lib/canvas-photo.ts";

const page = { width: 794, height: 1123 };
test("drop coordinates follow the target page at different zoom and scroll positions", () => {
  for (const zoom of [0.4, 1, 2.75]) {
    const rect = { x: -230, y: -1420, width: page.width * zoom, height: page.height * zoom };
    const point = photoDropPoint({ x: rect.x + 300 * zoom, y: rect.y + 900 * zoom }, rect, page);
    assert.ok(Math.abs(point.x - 300) < 1e-9 && Math.abs(point.y - 900) < 1e-9);
  }
});

test("photo placement preserves aspect ratio, fits large images, and clamps at page edges", () => {
  assert.deepEqual(photoBounds(200, 100, page, { x: 300, y: 700 }), { x: 200, y: 650, width: 200, height: 100 });
  assert.deepEqual(photoBounds(200, 100, page, { x: 0, y: 1123 }), { x: 0, y: 1023, width: 200, height: 100 });
  const large = photoBounds(4000, 2000, page, { x: 794, y: 0 });
  assert.equal(large.width / large.height, 2);
  assert.equal(large.x + large.width, 794);
  assert.equal(large.y, 0);
  assert.ok(large.width <= 714 && large.height <= 1043);
  const centered = photoBounds(200, 100, page);
  assert.equal(centered.x + centered.width / 2, page.width / 2);
  assert.equal(centered.y + centered.height / 2, page.height / 2);
});

test("file contents are validated before decoding even with a misleading image extension", async () => {
  await assert.rejects(readCanvasPhoto(new File(['not a PNG'], 'photo.png', { type: 'image/png' })), { issue: 'photoInvalid' });
  await assert.rejects(readCanvasPhoto({ size: 21 * 1024 * 1024 }), { issue: 'photoTooLarge' });
});
