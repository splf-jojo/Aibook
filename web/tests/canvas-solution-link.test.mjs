import test from "node:test";
import assert from "node:assert/strict";
import { solutionMessage, parseSolutionMessage } from "../lib/canvas-solution-link.ts";

test("accepted message retains its specific canvas and solution after persistence", () => {
  for (const [label, sentence] of [["Solution", "Solution accepted and added to the canvas."], ["Решение", "Решение принято и добавлено на канвас."], ["解答", "解答已接受并添加到画布。"]]) {
    const persisted = JSON.parse(JSON.stringify({ content: solutionMessage(sentence, label, "canvas-1", "solution-2") }));
    const link = parseSolutionMessage(persisted.content);
    assert.equal(link.canvasId, "canvas-1"); assert.equal(link.solutionId, "solution-2");
    assert.equal(link.before + link.label + link.after, sentence);
  }
});

test("ordinary text and arbitrary external links are not treated as canvas actions", () => {
  for (const content of ["Solution accepted and added to the canvas.", "[Solution](https://example.com)", "[Solution](javascript:alert(1))"]) {
    assert.equal(parseSolutionMessage(content), null);
  }
});
