import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import { parse, type Font } from "opentype.js";

let handwritingFont: Promise<Font | null> | undefined;
function loadHandwritingFont(): Promise<Font | null> {
  handwritingFont ??= fetch("/fonts/Kalam-Regular.ttf", { signal: AbortSignal.timeout(5000) }).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load handwriting font: HTTP ${response.status}`);
    return parse(await response.arrayBuffer());
  }).catch((error: unknown) => {
    // Handwriting is optional styling. Keep the complete MathJax outlines when the
    // font is missing or offline, and don't repeat the failed fetch for every step.
    console.warn("[canvas] Handwriting font unavailable; using standard math glyphs.", error);
    return null;
  });
  return handwritingFont;
}

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mathDocument = mathjax.document("", {
  InputJax: new TeX({ packages: ["base", "ams"], maxBuffer: 20_000, maxMacros: 1_000 }),
  OutputJax: new SVG({ fontCache: "none" }),
});

export type FormulaImage = { dataUrl: string; width: number; height: number };

// Self-contained math outlines avoid font-dependent positioning and missing glyphs.
// The PNG is also readable by the native canvas client; the original LaTeX is saved separately.
export async function renderLatexImage(latex: string, fontSize = 32, maxWidth = 690): Promise<FormulaImage> {
  const font = await loadHandwritingFont();
  const source = latex.trim().replace(/^\$\$?([\s\S]*?)\$\$?$/, "$1");
  const node = mathDocument.convert(source, { display: true });
  const xml = adaptor.outerHTML(node);
  const doc = new DOMParser().parseFromString(xml, "text/html");
  const svg = doc.querySelector("svg");
  if (!svg || svg.querySelector('[data-mml-node="merror"]')) throw new Error("Invalid LaTeX");
  const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite)) throw new Error("Invalid formula bounds");
  const [x, y, w, h] = viewBox;
  const padding = 90;
  const scale = Math.min(fontSize / 1000, maxWidth / (w + padding * 2));
  if (scale < 0.019 || h * scale > 990) throw new Error("formula-too-large");
  const width = (w + padding * 2) * scale;
  const height = (h + padding * 2) * scale;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("viewBox", `${x - padding} ${y - padding} ${w + padding * 2} ${h + padding * 2}`);
  svg.setAttribute("width", String(width * 3));
  svg.setAttribute("height", String(height * 3));
  svg.setAttribute("style", "color:#2456a6");
  const measuringHost = document.createElement("div");
  measuringHost.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none";
  measuringHost.setAttribute("aria-hidden", "true");
  measuringHost.append(svg);
  document.body.append(measuringHost);
  try {
    svg.querySelectorAll<SVGPathElement>("path[data-c]").forEach((path, index) => {
      const character = String.fromCodePoint(parseInt(path.getAttribute("data-c")!, 16)).normalize("NFKD");
      const originalTransform = path.getAttribute("transform") ?? "";
      if (font && /^[A-Za-z0-9]$/.test(character) && font.charToGlyphIndex(character)) {
        const original = path.getBBox();
        const handwritten = font.getPath(character, 0, 0, 1000);
        const bounds = handwritten.getBoundingBox();
        const sx = original.width / (bounds.x2 - bounds.x1);
        const sy = original.height / (bounds.y2 - bounds.y1);
        if (Number.isFinite(sx) && Number.isFinite(sy) && sx > 0 && sy > 0) {
          path.setAttribute("d", handwritten.toPathData(3));
          path.setAttribute("transform", `${originalTransform} translate(${original.x - bounds.x1 * sx} ${original.y + bounds.y2 * sy}) scale(${sx} ${-sy})`);
        }
      }
      // Subtle, deterministic pen variation without disturbing fraction/script alignment.
      const angle = ((index * 7) % 11 - 5) * 0.15;
      const shift = ((index * 3) % 7 - 3) * 1.5;
      path.setAttribute("transform", `${path.getAttribute("transform") ?? ""} translate(0 ${shift}) rotate(${angle})`);
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "9");
      path.setAttribute("stroke-linejoin", "round");
    });
  } finally {
    measuringHost.remove();
  }
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * 3);
  canvas.height = Math.ceil(height * 3);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(image, 0, 0);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

export function renderBarChart(chart: { bars: { label: string; value: number }[]; x_label: string; y_label: string }): FormulaImage {
  const width = 540, height = 260;
  const canvas = document.createElement("canvas");
  canvas.width = width * 3;
  canvas.height = height * 3;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(3, 3);
  ctx.strokeStyle = "#2456a6";
  ctx.fillStyle = "#2456a6";
  ctx.lineWidth = 1.6;
  ctx.font = '15px "Segoe Print", "Comic Sans MS", cursive';
  const left = 66, top = 32, bottom = 204, right = 520;
  const max = Math.max(...chart.bars.map((bar) => bar.value), 0.001);
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
  for (let tick = 0; tick <= 4; tick++) {
    const y = bottom - (bottom - top) * tick / 4;
    ctx.textAlign = "right";
    ctx.fillText(Number((max * tick / 4).toPrecision(3)).toString(), left - 8, y + 5);
    ctx.beginPath(); ctx.moveTo(left - 3, y); ctx.lineTo(left, y); ctx.stroke();
  }
  const cell = (right - left) / chart.bars.length;
  chart.bars.forEach((bar, index) => {
    const x = left + index * cell + cell * 0.15;
    const barHeight = bar.value / max * (bottom - top);
    ctx.fillStyle = "rgba(36,86,166,0.16)";
    ctx.fillRect(x, bottom - barHeight, cell * 0.7, barHeight);
    ctx.strokeRect(x, bottom - barHeight, cell * 0.7, barHeight);
    ctx.fillStyle = "#2456a6";
    ctx.textAlign = "center";
    ctx.fillText(bar.label, x + cell * 0.35, bottom + 23, cell - 3);
  });
  ctx.textAlign = "center";
  ctx.fillText(chart.x_label, (left + right) / 2, 250, 430);
  ctx.fillText(chart.y_label, (left + right) / 2, 20, 430);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}
