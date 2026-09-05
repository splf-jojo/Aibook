import test from "node:test";
import assert from "node:assert/strict";
import { createSolutionHistoryEntry, undoSolution, redoSolution } from "../lib/canvas-solution-history.ts";

const page = (id, elements = [], extra = {}) => ({ id, width: 794, height: 1123, pageTemplate: "plain", elements, ...extra });
const formula = (id, extra = {}) => ({
  id, kind: "image", solutionId: "solution", x: 36, y: 72, width: 200, height: 50,
  dataUrl: "data:image/png;base64,stable", latex: "P(X=1)=0.6",
  handwriting: { datasetId: "my-dataset", revision: "approved-v1", seed: 17 }, ...extra,
});
const stroke = (id) => ({ id, kind: "stroke", points: [0, 0, 30, 20] });

test("undo keeps user drawings and redo restores the last moved position with saved pixels and provenance", () => {
  const original = stroke("original");
  const before = [page("first", [original]), page("second")];
  const accepted = [page("first", [original, formula("f")]), page("second")];
  const entry = createSolutionHistoryEntry(before, accepted, "solution");
  const moved = formula("f", { x: 310, y: 410, width: 280 });
  const userDrawing = stroke("later");
  const current = [page("first", [original, userDrawing]), page("second", [moved])];
  const undone = undoSolution(current, entry);
  assert.deepEqual(undone.pages, [current[0], page("second")]);
  assert.equal(current[1].elements.length, 1, "undo must not mutate its input");
  const addedWhileUndone = stroke("while-undone");
  const edited = [undone.pages[0], page("second", [addedWhileUndone])];
  const redone = redoSolution(edited, undone.entry);
  assert.deepEqual(redone.pages, [current[0], page("second", [moved, addedWhileUndone])]);
  assert.equal(edited[1].elements.length, 1, "redo must not mutate its input");
  assert.deepEqual(undoSolution(redone.pages, redone.entry).pages, edited);
});

test("continuation pages return between the original neighbouring pages", () => {
  const before = [page("a"), page("d")];
  const accepted = [page("a"), page("b", [formula("b-f")]), page("c", [formula("c-f")]), page("d")];
  const entry = createSolutionHistoryEntry(before, accepted, "solution");
  const undone = undoSolution(accepted, entry);
  assert.deepEqual(undone.pages, before);
  const userPage = page("new-user-page", [stroke("user")]);
  const redone = redoSolution([before[0], userPage, before[1]], undone.entry);
  assert.deepEqual(redone.pages.map(({ id }) => id), ["a", "new-user-page", "b", "c", "d"]);
  assert.deepEqual(redone.pages[1], userPage);
  assert.deepEqual(redone.pages.slice(2, 4), accepted.slice(1, 3));
});

test("an added page with later user content, PencilKit data or a PDF stays on undo", () => {
  const before = [page("a")];
  const accepted = [page("a"), page("b", [formula("f")]), page("c", [formula("g")]), page("d", [formula("h")])];
  const entry = createSolutionHistoryEntry(before, accepted, "solution");
  const current = [accepted[0], page("b", [formula("f"), stroke("user")]),
    page("c", [formula("g")], { appleDrawingData: "pencil-data" }),
    page("d", [formula("h")], { pdfPageIndex: 0 })];
  const undone = undoSolution(current, entry);
  assert.deepEqual(undone.pages, [before[0], page("b", [stroke("user")]),
    page("c", [], { appleDrawingData: "pencil-data" }), page("d", [], { pdfPageIndex: 0 })]);
  assert.deepEqual(redoSolution(undone.pages, undone.entry).pages, current);
});

test("copied formulas and pre-existing solution objects survive undo even with the same provenance", () => {
  const existing = formula("existing");
  const before = [page("a", [existing])];
  const accepted = [page("a", [existing, formula("f")])];
  const entry = createSolutionHistoryEntry(before, accepted, "solution");
  const copied = formula("copy", { x: 500 });
  const foreign = formula("foreign", { solutionId: "another-solution" });
  const current = [page("a", [...accepted[0].elements, copied, foreign])];
  assert.deepEqual(undoSolution(current, entry).pages, [page("a", [existing, copied, foreign])]);
  const changedProvenance = [page("a", [existing, formula("f", { solutionId: "other" })])];
  assert.deepEqual(undoSolution(changedProvenance, entry).pages, changedProvenance);
});

test("ambiguous duplicate IDs are left untouched", () => {
  const before = [page("a")];
  assert.equal(createSolutionHistoryEntry(before, [page("a", [formula("f"), formula("f")])], "solution"), null);
  const accepted = [page("a", [formula("f")])];
  const entry = createSolutionHistoryEntry(before, accepted, "solution");
  const duplicate = stroke("f");
  const current = [page("a", [formula("f"), duplicate])];
  assert.deepEqual(undoSolution(current, entry).pages, current);
});

test("redo is idempotent and cannot introduce an existing ID twice", () => {
  const before = [page("a")];
  const accepted = [page("a", [formula("f"), formula("g")])];
  const entry = createSolutionHistoryEntry(before, accepted, "solution");
  const undone = undoSolution(accepted, entry);
  assert.deepEqual(undoSolution(undone.pages, undone.entry), undone);
  const alreadyRestored = formula("f", { x: 150 });
  const redone = redoSolution([page("a", [alreadyRestored])], undone.entry);
  assert.deepEqual(redone.pages, [page("a", [alreadyRestored, formula("g")])]);
  assert.deepEqual(redoSolution(redone.pages, redone.entry), redone);
  assert.deepEqual(redoSolution(redone.pages, undone.entry).pages, redone.pages);
});

test("redo does not resurrect a formula deleted by the user before undo", () => {
  const before = [page("a")];
  const accepted = [page("a", [formula("deleted"), formula("kept")])];
  const entry = createSolutionHistoryEntry(before, accepted, "solution");
  const current = [page("a", [formula("kept")])];
  const undone = undoSolution(current, entry);
  assert.deepEqual(redoSolution(undone.pages, undone.entry).pages, current);
});
