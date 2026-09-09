import { renderWriting, svgDataUrl } from "../lib/handwriting-writing-renderer";
import { DEFAULT_WRITING_SETTINGS, type WritingGlyph } from "../lib/handwriting-writing";

/** Real SVG geometry checks; run after mount in a local browser harness. */
export async function runWritingAuditChecks() {
  const failures: string[] = [], passed: string[] = [];
  const assert = (ok: unknown, label: string) => { if (!ok) throw new Error(label); };
  const check = async (label: string, run: () => void | Promise<void>) => {
    try { await run(); passed.push(label); } catch (error) { failures.push(`${label}: ${String(error)}`); }
  };
  const near = (a: number, b: number) => Math.abs(a - b) < 0.004;
  const image = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><path d="M2 25L10 3L18 25" stroke="black" fill="none" stroke-width="3"/></svg>');
  const glyphs: WritingGlyph[] = ["x", "y", "1", "2", "3", "0", "6", "+", "-", "=", "dx", "dy", "\\sin", "\\cos"].map(latex => ({ latex, medoidId: latex, width: 20, height: 30, image }));
  const settings = { ...DEFAULT_WRITING_SETTINGS, size: 48 };
  const shapes = (source: string) => {
    const host = document.createElement("div"); host.style.cssText = "position:fixed;left:0;top:0;visibility:hidden";
    host.innerHTML = source; document.body.append(host);
    try {
      const root = host.querySelector("svg")!, frame = root.getBoundingClientRect();
      return [...root.querySelectorAll<SVGGraphicsElement>("path, text, line, rect:not([width='100%'])")].map(element => {
        const b = element.getBoundingClientRect();
        return { id: element.getAttribute("d") ?? element.tagName, x: b.x - frame.x, y: b.y - frame.y, width: b.width, height: b.height, stroke: getComputedStyle(element).strokeWidth };
      }).filter(b => b.width || b.height).sort((a, b) => a.id.localeCompare(b.id) || a.x - b.x || a.y - b.y);
    } finally { host.remove(); }
  };
  const formulas = ["x+1=2", "-", String.raw`\sin x-\cos y+123=6`, String.raw`\frac{dx}{dy}=x_1^2+\sin x`,
    String.raw`\frac{x_1^2+1}{\frac{y}{2}}`, String.raw`\sqrt[3]{\frac{x^2+1}{y}}`, String.raw`\left(\frac{x}{y}\right)^2`,
    String.raw`\int_0^1 x^2\,dx=\frac13`, String.raw`\sum_{n=0}^{10}x_n`, String.raw`\hat x+\overrightarrow y`,
    String.raw`\begin{aligned}y&=x^2+1\\\frac{dy}{dx}&=2x\end{aligned}`, String.raw`\begin{array}{c|cc}x&1&2\\y&3&6\end{array}`,
    String.raw`\begin{cases}x^2&\text{if }x>0\\0&\text{otherwise}\end{cases}`, String.raw`\text{Total chips}=6+3+1`,
    String.raw`x+\phantom{y}+1`, String.raw`\mathrm{abc}+\operatorname{max}(x,y)`];
  for (const formula of formulas) {
    await check(`common cells ${formula}`, () => {
      const hand = renderWriting(formula, "latex", glyphs, settings, 600, { readable: true });
      const print = renderWriting(formula, "latex", glyphs, settings, 600, { printed: true });
      const a = hand.inspectionPlacements!, b = print.inspectionPlacements!, c = print.preview!.placements;
      assert(a.length === b.length && b.length === c.length, `Unit counts ${a.length}/${b.length}/${c.length}`);
      a.forEach((p, i) => {
        assert(p.label === b[i].label && p.label === c[i].label, `Unit label ${p.label}/${b[i].label}/${c[i].label}`);
        for (const key of ["x", "y", "width", "height"] as const) {
          assert(near(p.cell[key], b[i].cell[key]), `${p.label}: printed cell ${key}`);
          assert(near(p.cell[key], c[i].cell[key]), `${p.label}: preview cell ${key}: ${p.cell[key]}/${c[i].cell[key]}`);
          assert(near(p.reference[key], b[i].reference[key]), `${p.label}: unchanged fitting reference ${key}`);
        }
      });
      assert(print.missing.length === 0 && !print.svg.includes("data-missing="), "Printed mode has no missing glyphs");
    });
    await check(`printed parity ${formula}`, () => {
      const output = renderWriting(formula, "latex", glyphs, settings, 600, { printed: true }), preview = output.preview!;
      assert(near(output.width, preview.width) && near(output.height, preview.height), `Frame ${output.width}×${output.height}/${preview.width}×${preview.height}`);
      const a = shapes(output.svg), b = shapes(preview.svg);
      assert(a.length === b.length, `Shape count ${a.length}/${b.length}`);
      a.forEach((p, i) => {
        assert(p.id === b[i].id, "Same outline");
        for (const key of ["x", "y", "width", "height"] as const) assert(near(p[key], b[i][key]), `Outline ${i} ${key}: ${p[key]}/${b[i][key]}`);
      });
    });
  }
  await check("nonzero printed settings are applied independently", () => {
    const normal = renderWriting("x+1", "latex", glyphs, settings, 600, { printed: true });
    for (const delta of [{ padding: { top: 8, right: 8, bottom: 8, left: 8 } }, { variation: 100 }, { verticalScatter: 30 }, { margin: { top: 5, right: 5, bottom: 5, left: 5 } }]) {
      const changed = renderWriting("x+1", "latex", glyphs, { ...settings, ...delta }, 600, { printed: true });
      assert(changed.svg !== normal.svg, `Setting changes output: ${JSON.stringify(delta)}`);
      assert(changed.preview!.svg === normal.preview!.svg, "Upper ink remains the reference");
      assert(changed.inspectionPlacements!.every(p => p.width > 0 && p.height > 0), "Positive dimensions");
    }
  });
  await check("variation and scatter never clip exported ink", async () => {
    for (const printed of [false, true]) {
      const out = renderWriting(String.raw`\frac{x^2+1}{y}-6`, "latex", glyphs, { ...settings, variation: 100, verticalScatter: 30 }, 600, { readable: true, printed });
      for (const p of shapes(out.svg)) assert(p.x >= -0.004 && p.y >= -0.004 && p.x + p.width <= out.width + 0.004 && p.y + p.height <= out.height + 0.004, "Every outline stays inside exported bounds");
      const bitmap = new Image(); bitmap.src = svgDataUrl(out.svg); await bitmap.decode();
      assert(bitmap.naturalWidth > 0 && bitmap.naturalHeight > 0, "SVG decodes for PNG export");
    }
  });
  await check("bad glyph dimensions produce an error", () => {
    let rejected = false;
    try { renderWriting("x", "latex", [{ ...glyphs[0], width: 0 }], settings, 600); } catch { rejected = true; }
    assert(rejected, "Reject zero width instead of producing NaN");
  });
  await check("placeholder rotation matches its diagnostic outline", () => {
    const out = renderWriting("q", "latex", [], { ...settings, variation: 100 }, 600);
    const p = out.placements[0];
    const doc = new DOMParser().parseFromString(out.svg, "image/svg+xml");
    assert(p.kind === "missing" && p.angle !== 0, "Missing source and rotation recorded");
    assert(doc.querySelector("[data-missing]")?.getAttribute("transform")?.startsWith("rotate("), "Rotation applied to the exported placeholder");
  });
  await check("extreme settings keep every ordinary symbol finite", () => {
    for (const size of [20, 96]) for (const printed of [false, true]) {
      const out = renderWriting(String.raw`\frac{x_1^2+1}{y}-6`, "latex", glyphs, { ...settings, size, variation: 100, verticalScatter: 30,
        padding: { top: 24, right: 24, bottom: 24, left: 24 }, margin: { top: 24, right: 24, bottom: 24, left: 24 } }, 600, { readable: true, printed });
      assert(!/NaN|Infinity/.test(out.svg), "Finite SVG");
      assert(out.inspectionPlacements!.every(p => p.width > 0 && p.height > 0 && p.content.width >= 0.999 && p.content.height >= 0.999), "Clamping leaves a drawable interior");
    }
  });
  return { passed: passed.length, failures };
}
