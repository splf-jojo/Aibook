import test from "node:test";
import assert from "node:assert/strict";
import { findSolutionSpace, overlaps } from "../lib/solution-placement.ts";

test("places a solution below the photographed problem without touching ink", () => {
  const task = { x: 70, y: 490, width: 640, height: 200 };
  const occupied = [{ x: 90, y: 35, width: 580, height: 350 }, task];
  const result = findSolutionSpace(620, 90, occupied, task);
  assert.ok(result);
  assert.ok(result.y > task.y + task.height);
  assert.ok(occupied.every((rect) => !overlaps(rect, result)));
});

test("finds a narrow free column instead of overlapping a photo", () => {
  const occupied = [{ x: 36, y: 36, width: 410, height: 1000 }];
  const result = findSolutionSpace(260, 140, occupied);
  assert.ok(result && result.x >= 464);
  assert.ok(!overlaps(result, occupied[0]));
});

test("a full page requires a continuation page", () => {
  assert.equal(findSolutionSpace(500, 100, [{ x: 0, y: 0, width: 794, height: 1123 }]), null);
  const continuation = findSolutionSpace(500, 100, []);
  assert.deepEqual(continuation, { x: 36, y: 36, width: 500, height: 100 });
});

test("successive formulas remain separated and inside page margins", () => {
  const occupied = [];
  let anchor;
  for (let index = 0; index < 7; index++) {
    const result = findSolutionSpace(600, 110, occupied, anchor);
    assert.ok(result);
    assert.ok(result.x >= 36 && result.y >= 36);
    assert.ok(result.x + result.width <= 758 && result.y + result.height <= 1087);
    assert.ok(occupied.every((rect) => !overlaps(result, rect)));
    occupied.push(result); anchor = result;
  }
  assert.equal(findSolutionSpace(600, 220, occupied, anchor), null);
});
