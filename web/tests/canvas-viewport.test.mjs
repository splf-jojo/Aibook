import test from "node:test";
import assert from "node:assert/strict";
import { anchoredCanvasScroll, zoomFromWheel, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM } from "../lib/canvas-viewport.ts";

test("zoom holds the paper coordinate under the cursor when the page can scroll", () => {
  const viewport = { width: 700, height: 600 }, before = { width: 794, height: 1123 }, after = { width: 1588, height: 2246 };
  const scroll = { left: 90, top: 400 }, cursor = { x: 250, y: 300 };
  const result = anchoredCanvasScroll(before, after, viewport, scroll, cursor);
  assert.equal((result.left + cursor.x - 24) / after.width, (scroll.left + cursor.x - 24) / before.width);
  assert.equal((result.top + cursor.y) / after.height, (scroll.top + cursor.y) / before.height);
  assert.deepEqual(anchoredCanvasScroll(after, before, viewport, result, cursor), scroll);
});

test("centred paper remains centred and scroll offsets stay valid at fit and edges", () => {
  const result = anchoredCanvasScroll({ width: 1588, height: 2246 }, { width: 400, height: 565 },
    { width: 800, height: 650 }, { left: 800, top: 1600 }, { x: 500, y: 500 });
  assert.deepEqual(result, { left: 0, top: 0 });
  const enlarged = anchoredCanvasScroll({ width: 400, height: 565 }, { width: 800, height: 1130 },
    { width: 600, height: 650 }, { left: 0, top: 0 }, { x: 300, y: 250 });
  assert.equal(enlarged.left, 124);
  assert.equal(enlarged.top, 250);
});

test("touchpad/wheel zoom is reciprocal, handles line deltas, and stops at bounds", () => {
  assert.ok(zoomFromWheel(1, -50, 0) > 1);
  assert.ok(Math.abs(zoomFromWheel(zoomFromWheel(1, -50, 0), 50, 0) - 1) < 1e-10);
  assert.equal(zoomFromWheel(1, -3, 1), zoomFromWheel(1, -48, 0));
  assert.equal(zoomFromWheel(MAX_CANVAS_ZOOM, -1000, 0), MAX_CANVAS_ZOOM);
  assert.equal(zoomFromWheel(MIN_CANVAS_ZOOM, 1000, 0), MIN_CANVAS_ZOOM);
  assert.equal(zoomFromWheel(1, 0, 0), 1);
});
