import { renderWriting } from "../lib/handwriting-writing-renderer";
import { DEFAULT_WRITING_SETTINGS as defaults, glyphBounds, type WritingGlyph } from "../lib/handwriting-writing";
import { renderCanvasHandwriting } from "../lib/canvas-handwriting-renderer";
import { createSolutionHistoryEntry, undoSolution, redoSolution } from "../lib/canvas-solution-history";
import type { CanvasPage } from "../lib/canvas-api";

export async function runNativeBrowserChecks() {
  const assert = (ok: unknown, message: string) => { if (!ok) throw Error(message); };
  const glyph = (latex: string, width: number, height: number, baseline: number): WritingGlyph => ({
    latex, medoidId: `native-${latex}`, width: width * 3, height: height * 3,
    image: "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="${width * 3}" height="${height * 3}"><rect x="1" y="1" width="${width * 3 - 2}" height="${height * 3 - 2}" rx="2" fill="black"/></svg>`),
    metrics: { version: 1, width, height, baseline, unitsPerEm: 48, crop: [0, 0, width, height], cell: [0, 0, 48, 48], baselineMethod: "worksheet-peers" },
  });
  const glyphs = [glyph("x", 18, 25, 25), glyph("y", 20, 37, 25), glyph("dy", 54, 75, 48), glyph("dx", 41, 42, 42),
    glyph("1", 14, 32, 32), glyph("2", 25, 33, 33), glyph("\\sin", 61, 29, 29), glyph("\\int", 22, 95, 64), glyph("(", 10, 30, 25), glyph(")", 10, 30, 25)];
  const render = (source: string, settings = defaults) => renderWriting(source, "latex", glyphs, settings, 900, { readable: true });
  const simple = render("dy+x");
  const dy = simple.placements.find(p => p.label === "dy")!, x = simple.placements.find(p => p.label === "x")!;
  assert(Math.abs(dy.height - 75) < 0.01 && Math.abs(dy.width - 54) < 0.01, "Tall dy retains source size");
  assert(Math.abs(dy.baseline! - x.baseline!) < 0.01, "dy and x share a baseline");
  assert(dy.y + dy.height > dy.baseline!, "dy descender survives");
  assert(x.x > dy.x + dy.width, "Following symbol reflows after wide dy");
  const formula = render("x+x^x+x^{x^x}+x_x");
  const sizes = [...new Set(formula.placements.filter(p => p.label === "x").map(p => Math.round(p.height * 100)))].sort((a, b) => b - a);
  assert(sizes.length >= 3 && sizes[0] === 2500 && sizes[1] < sizes[0] && sizes[2] < sizes[1], "Nested scripts scale by level");
  const fraction = render(String.raw`\frac{dy}{dx}`);
  const numerator = fraction.placements.find(p => p.label === "dy")!, denominator = fraction.placements.find(p => p.label === "dx")!;
  assert(denominator.y > numerator.y + numerator.height, "Fraction accounts for tall numerator and its descender");
  const plain = render("dy+x"), padded = render("dy+x", { ...defaults, padding: { top: 5, right: 5, bottom: 5, left: 5 } });
  assert(plain.placements.every((p, i) => Math.abs(p.width - padded.placements[i].width) < 0.01 && Math.abs(p.height - padded.placements[i].height) < 0.01), "Native padding reserves space without resizing ink");
  assert(padded.width > plain.width, "Native padding participates in math layout");
  for (const source of ["dy+x", String.raw`\frac{dy}{dx}=x_1^2+\sin x`, String.raw`\sqrt{\frac{dy}{dx}}`,
    String.raw`\left(\frac{dy}{dx}\right)^2`, String.raw`\int_0^1 dy`, String.raw`\begin{aligned}dy&=x^2\\dx&=y\end{aligned}`, String.raw`\frac{dy}{\frac{dx}{y}}`]) {
    for (const size of [24, 48, 72]) {
      const result = render(source, { ...defaults, size, variation: 100 });
      assert(!result.unsupported.length, `Supported natural math: ${source}`);
      for (const p of result.placements) {
        const b = glyphBounds(p, p.angle);
        assert(b.x + result.origin.x >= -0.01 && b.y + result.origin.y >= -0.01 && b.x + b.width + result.origin.x <= result.width + 0.01 && b.y + b.height + result.origin.y <= result.height + 0.01, `Rotated ink stays in output: ${source}`);
      }
    }
  }
  const text = renderWriting("dyx\ndyx", "text", glyphs, defaults, 500);
  assert(text.placements[2].y > text.placements[0].y + text.placements[0].height, "Text rows account for real ink height");
  const canvas = await renderCanvasHandwriting("dy+x", { id: "a".repeat(64), name: "Synthetic", approved: true, status: "complete", sourceVersion: 1, glyphs }, 32);
  assert(canvas.handwriting?.rendererVersion === 2 && canvas.handwriting.medoids.some(m => m.label === "dy"), "Canvas freezes native output and renderer version");
  const before: CanvasPage[] = [{ id: "page", width: 794, height: 1123, pageTemplate: "plain", elements: [] }];
  const accepted: CanvasPage[] = [{ ...before[0], elements: [{ ...canvas, id: "formula", solutionId: "solution", kind: "image", x: 30, y: 60, latex: "dy+x" }] }];
  const saved = JSON.parse(JSON.stringify(accepted)) as CanvasPage[];
  const entry = createSolutionHistoryEntry(before, saved, "solution")!;
  const undone = undoSolution(saved, entry), redone = redoSolution(undone.pages, undone.entry);
  assert(undone.pages[0].elements.length === 0 && JSON.stringify(redone.pages) === JSON.stringify(saved), "Save/reload and undo/redo retain actual native PNG and provenance");
  assert(!render(String.raw`\left(\frac{dy}{dx}\right)`).placements.some(p => p.label === "(" || p.label === ")"), "Stretchable parentheses keep structural geometry even when native samples exist");
  return { passed: ["source sizes and baselines", "wide dy advance", "nested script scales", "tall fractions", "padding without shrinking", "roots, delimiters, integrals, aligned rows at three sizes", "rotation bounds", "multiline text", "canvas PNG and snapshot", "save/reload and undo/redo", "structural delimiters"] };
}
