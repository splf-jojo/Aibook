import { renderWriting, svgDataUrl } from "../lib/handwriting-writing-renderer";
import { DEFAULT_WRITING_SETTINGS, type WritingGlyph, type WritingResult } from "../lib/handwriting-writing";
import { renderCanvasHandwriting } from "../lib/canvas-handwriting-renderer";

// Import from a temporary client test page and call after mount. These checks
// intentionally require the browser's SVG getBBox/getScreenCTM implementation.
export async function runWritingBrowserChecks() {
  const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const image = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><path d="M3 27L10 3L17 27" fill="none" stroke="black" stroke-width="3"/></svg>');
  const glyphs: WritingGlyph[] = ["x", "1", "2", "3", "0", "6", "a", "+", "-", "=", "P", "(", ")", String.raw`\sqrt{}`].map((latex) => ({
    latex, medoidId: `test-${latex}`, image, width: 20, height: 30,
  }));
  const settings = { ...DEFAULT_WRITING_SETTINGS, size: 32 };
  const render = (source: string, canvas = true) => renderWriting(source, "latex", glyphs, settings, 690, canvas ? { target: "canvas" } : {});
  const svg = (result: WritingResult) => new DOMParser().parseFromString(result.svg, "image/svg+xml");
  const passed: string[] = [];
  const checkBounds = (result: WritingResult) => {
    assert(result.width > 0 && result.height > 0 && Number.isFinite(result.width + result.height), "Finite result bounds");
    for (const placement of result.placements) {
      assert(placement.width > 0 && placement.height > 0, `Positive glyph dimensions: ${placement.label}`);
      assert(placement.x + result.origin.x >= 0 && placement.y + result.origin.y >= 0, `Glyph starts within output: ${placement.label}`);
      assert(placement.x + result.origin.x + placement.width <= result.width + 0.01 && placement.y + result.origin.y + placement.height <= result.height + 0.01, `Glyph ends within output: ${placement.label}`);
    }
    assert(!svg(result).querySelector("parsererror"), "Valid exported SVG");
  };

  const mixed = render(String.raw`P(X=1)=\frac{6}{10}=0.6`), mixedSvg = svg(mixed);
  checkBounds(mixed);
  assert(mixed.placements.some(p => p.label === "P" && p.glyph?.medoidId === "test-P"), "Actual medoid placed");
  assert(mixed.missing.includes("X") && mixed.missing.includes("."), "Absent math glyphs reported");
  assert(mixed.fontFallback?.includes("X") && mixed.fontFallback.includes("."), "Math font fallback reported");
  assert(!mixedSvg.querySelector("[data-missing]"), "Canvas has no missing placeholders");
  assert(!!mixedSvg.querySelector('[data-font-fallback] path[data-c="1D44B"]'), "X is retained as its MathJax outline");
  assert(!!mixedSvg.querySelector('[data-font-fallback] path[data-c="2E"]'), "Decimal dot is retained as its MathJax outline");
  assert(!mixedSvg.querySelector('rect[width="100%"]'), "Canvas has no opaque background");
  const denominator = mixed.placements.filter(p => p.label === "1" || p.label === "0");
  assert(denominator.some(p => p.y > mixed.placements.find(p => p.label === "6")!.y), "Fraction denominator below numerator");
  assert([...mixedSvg.querySelectorAll("rect")].some(r => Number(r.getAttribute("width")) > 0), "Fraction bar preserved");
  passed.push("mixed medoids and readable font fallback; fraction; transparent SVG");

  const prose = render(String.raw`\text{Total chips a x} = x+1`), proseSvg = svg(prose);
  checkBounds(prose);
  assert(prose.missing.length === 0 && prose.fontFallback?.length === 0, "Prose excluded from math coverage");
  assert(prose.placements.filter(p => p.label === "x").length === 1 && !prose.placements.some(p => p.label === "a"), "Prose never borrows individual medoids");
  assert(proseSvg.querySelectorAll('[data-mml-node="mtext"]').length === 1, "Prose retains one font run");
  assert(proseSvg.querySelectorAll('[data-mml-node="mtext"] path').length > 10, "All prose outlines preserved");
  passed.push("complete prose font runs excluded from missing symbols");

  const scripts = render(String.raw`\frac{x_1^2+1}{2}`);
  checkBounds(scripts);
  const base = scripts.placements.find(p => p.label === "x")!;
  const exponent = scripts.placements.find(p => p.label === "2")!;
  const subscript = scripts.placements.find(p => p.label === "1")!;
  assert(exponent.y < base.y && subscript.y > base.y, "Script vertical positions retained");
  assert(exponent.x > base.x && subscript.x > base.x, "Script horizontal positions retained");
  passed.push("superscript and subscript geometry inside a fraction");

  for (const formula of [String.raw`\sqrt{x+2}`, String.raw`\sqrt{\frac{x^2+1}{2}}`, String.raw`\sqrt[3]{x}`]) {
    const result = render(formula), doc = svg(result); checkBounds(result);
    assert(result.fontFallback?.includes(String.raw`\sqrt{}`), "Structural radical honestly reports fallback");
    assert(!result.missing.includes(String.raw`\sqrt{}`), "Present root sample is not reported as absent");
    assert(doc.querySelectorAll('[data-font-fallback] path[data-c="221A"]').length === 1, "Exactly one original radical hook preserved");
    assert(!result.placements.some(p => p.label === "√"), "Full root sample is not inserted into just the hook");
    assert([...doc.querySelectorAll("rect")].some(r => Number(r.getAttribute("width")) > 0), "Radical overbar preserved");
    assert(result.placements.some(p => p.label === "x" && p.glyph), "Radicand remains handwritten");
  }
  passed.push("roots preserve hook, overbar, radicand and root index without duplication");

  const cases = render(String.raw`\begin{cases}x^2 & \text{if x > 0}\\ -x & \text{otherwise}\end{cases}`), casesSvg = svg(cases);
  checkBounds(cases);
  assert(casesSvg.querySelectorAll('[data-mml-node="mtext"]').length === 2, "Case annotations stay intact");
  assert(!!casesSvg.querySelector('[data-font-fallback] path[data-c="7B"]'), "Stretched system brace preserved");
  const caseX = cases.placements.filter(p => p.label === "x");
  assert(caseX.length === 2 && caseX[1].y > caseX[0].y + settings.size / 2, "Case rows stay separate");
  const table = render(String.raw`\begin{array}{c|ccc}x&1&2&3\\x&0.6&0.3&0.1\end{array}`);
  checkBounds(table);
  assert(svg(table).querySelectorAll("line").length > 0, "Table column rule preserved");
  assert(table.placements.filter(p => p.label === "x").length === 2, "Table rows retained");
  passed.push("case brace and row geometry; table rows and column rule");

  const accent = render(String.raw`\widehat{x}+\overrightarrow{x}`);
  checkBounds(accent);
  assert(!svg(accent).querySelector("[data-missing]"), "Unsupported accent output remains readable");
  assert(svg(accent).querySelectorAll("path[data-c]").length >= 2, "Original accent and arrow outlines survive");
  passed.push("accent and arrow outlines remain visible");

  const strict = render(String.raw`\text{Total} + X`, false), strictSvg = svg(strict);
  assert(strictSvg.querySelector('rect[width="100%"]')?.getAttribute("fill") === "white", "Writing default retains white background");
  assert(!!strictSvg.querySelector('[data-missing="X"]'), "Writing default retains placeholders");
  assert(strict.missing.includes("T") && strict.fontFallback === undefined, "Writing default retains strict prose coverage");
  passed.push("unchanged strict Writing defaults");

  const bitmap = new Image(); bitmap.src = svgDataUrl(mixed.svg); await bitmap.decode();
  const canvas = document.createElement("canvas"); canvas.width = Math.ceil(mixed.width); canvas.height = Math.ceil(mixed.height);
  const context = canvas.getContext("2d")!; context.drawImage(bitmap, 0, 0);
  assert(context.getImageData(0, 0, 1, 1).data[3] === 0, "Export raster retains transparent padding");
  assert(context.getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 === 3 && value > 0), "Export raster contains visible ink");
  passed.push("SVG rasterization has transparent padding and visible ink");
  const dataset = { id: "a".repeat(64), name: "Synthetic check", approved: true, status: "complete" as const, sourceVersion: 7, glyphs };
  const source = String.raw`P(X=1)=\frac{6}{10}=0.6`;
  const rendered = await renderCanvasHandwriting(source, dataset);
  const repeated = await renderCanvasHandwriting(source, dataset);
  assert(rendered.dataUrl === repeated.dataUrl, "Same source and snapshot produce identical PNG");
  assert(rendered.handwriting?.sourceVersion === 7 && rendered.handwriting.medoids.some(item => item.id === "test-P"), "Snapshot records the rendered profile and medoids");
  assert(rendered.handwriting.fontSymbols.includes("X") && rendered.handwriting.fontSymbols.includes("."), "Snapshot reports actual math font symbols");
  const png = new Image(); png.src = rendered.dataUrl; await png.decode();
  canvas.width = png.width; canvas.height = png.height; context.drawImage(png, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  assert(pixels[3] === 0, "Final PNG keeps transparent padding");
  let blueInk = false;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] === 255) {
    assert(pixels[i] === 36 && pixels[i + 1] === 86 && pixels[i + 2] === 166, "Final ink is consistently blue"); blueInk = true;
  }
  assert(blueInk, "Final PNG has opaque ink");
  assert(JSON.parse(JSON.stringify(rendered)).dataUrl === rendered.dataUrl, "Saved image round trips independently of the profile");
  passed.push("canvas PNG wrapper: reproducible pixels, transparent background, blue ink and profile snapshot");
  return { passed, count: passed.length };
}
