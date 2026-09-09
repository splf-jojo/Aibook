import test from "node:test";
import assert from "node:assert/strict";
import { CanvasEditHistory, intersectRect, subtractRect, resizeSelection } from "../lib/canvas-editing.ts";

const area = rect => rect.width * rect.height;
test("cutting a half leaves exactly the other half, including edge-aligned selections", () => {
  const photo = { x: 50, y: 100, width: 400, height: 200 };
  const cut = { x: 250, y: 0, width: 400, height: 500 };
  assert.deepEqual(intersectRect(photo, cut), { x: 250, y: 100, width: 200, height: 200 });
  assert.deepEqual(subtractRect(photo, cut), [{ x: 50, y: 100, width: 200, height: 200 }]);
  assert.deepEqual(subtractRect(photo, photo), []);
  assert.deepEqual(subtractRect(photo, { ...photo, x: 450 }), [photo]);
});

test("arbitrary rectangular cuts preserve all pixels outside and never duplicate overlapping strips", () => {
  const source = { x: 30, y: 80, width: 320, height: 210 };
  for (let x = -50; x < 450; x += 27) for (let y = -30; y < 350; y += 31) {
    const cut = { x, y, width: 95, height: 80 };
    const inside = intersectRect(source, cut), remainder = subtractRect(source, cut);
    assert.equal(remainder.reduce((sum, rect) => sum + area(rect), inside ? area(inside) : 0), area(source));
    for (let i = 0; i < remainder.length; i++) {
      assert.equal(intersectRect(remainder[i], cut), null);
      for (let j = i + 1; j < remainder.length; j++) assert.equal(intersectRect(remainder[i], remainder[j]), null);
    }
  }
});

test("all resize handles keep proportions and the opposite corner, with minimum size and page limits", () => {
  const before = { x: 200, y: 300, width: 200, height: 100 }, page = { width: 794, height: 1123 };
  for (let corner = 0; corner < 4; corner++) for (const pointer of [{ x: -100, y: -200 }, { x: 1000, y: 1500 }, { x: 280, y: 330 }]) {
    const after = resizeSelection(before, corner, pointer, page);
    assert.ok(after.width > 0 && after.height > 0);
    assert.equal(after.width / after.height, 2);
    assert.ok(after.x >= -1e-9 && after.y >= -1e-9);
    assert.ok(after.x + after.width <= page.width + 1e-9 && after.y + after.height <= page.height + 1e-9);
    assert.equal(corner % 2 === 0 ? after.x + after.width : after.x, corner % 2 === 0 ? 400 : 200);
    assert.equal(corner < 2 ? after.y + after.height : after.y, corner < 2 ? 400 : 300);
  }
});

test("history records a multi-page gesture atomically and restores solution metadata", () => {
  const history = new CanvasEditHistory();
  const before = { pages: [{ id: "a", elements: [] }], solutionHistory: null };
  const after = { pages: [{ id: "a", elements: ["start"] }, { id: "b", elements: ["end"] }], solutionHistory: { state: "accepted" } };
  history.record(before, after, true);
  assert.equal(history.undo(), before);
  assert.equal(history.canUndo, false);
  assert.equal(history.redo(), after);
  assert.deepEqual(before.pages, [{ id: "a", elements: [] }]);
});

test("selection and no-op gestures preserve redo, new edits discard it and history is bounded", () => {
  const history = new CanvasEditHistory(2);
  history.record(0, 1, true); history.record(1, 2, true); history.record(2, 3, true);
  assert.equal(history.undo(), 2);
  history.record(2, 2, false);
  assert.equal(history.redo(), 3);
  assert.equal(history.undo(), 2);
  history.record(2, 4, true);
  assert.equal(history.redo(), null);
  assert.equal(history.undo(), 2);
  assert.equal(history.undo(), 1);
  assert.equal(history.undo(), null);
});
