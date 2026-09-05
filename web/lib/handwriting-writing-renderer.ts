import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import type { AbstractMmlNode, AbstractMmlTokenNode, MmlNode } from "mathjax-full/js/core/MmlTree/MmlNode.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import { applyMathMargins } from "./handwriting-writing-math.ts";
import {
  glyphBounds, invisibleMath, layoutText, MAX_WRITING_LENGTH, missingLabel, normalizeMathCharacter, placeGlyph, verticalScatter, ZERO_INSETS,
  type Box, type WritingGlyph, type WritingPlacement, type WritingResult, type WritingSettings,
} from "./handwriting-writing.ts";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
type MathSpacing = { aliases: ReadonlyMap<string, WritingGlyph>; settings: WritingSettings; preserveText?: boolean };
export type WritingRenderOptions = { target?: "writing" | "canvas" };
const newDocument = (spacing?: MathSpacing) => {
  const input = new TeX({ packages: ["base", "ams"], maxBuffer: 4000, maxMacros: 200 });
  input.postFilters.add(({ data }: { data: { root: MmlNode } }) => data.root.walkTree((node) => {
    // A stretched bracket may consist of several font paths. Keep its original
    // operator identity so it still matches one medoid or one missing symbol.
    if (node.kind === "mo") {
      const token = node as AbstractMmlTokenNode;
      token.attributes.set("data-writing-text", token.getText());
    }
  }));
  if (spacing) input.postFilters.add(({ data }: { data: { root: AbstractMmlNode } }) => applyMathMargins(data.root, spacing.aliases, spacing.settings, spacing));
  return mathjax.document("", { InputJax: input, OutputJax: new SVG({ fontCache: "none" }) });
};
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const number = (value: number) => String(Math.round(value * 1000) / 1000);
const aliasCache = new Map<string, string | null>();

export function glyphAliases(glyphs: WritingGlyph[]) {
  const aliases = new Map<string, WritingGlyph>(), document = newDocument();
  for (const glyph of glyphs) {
    let alias = aliasCache.get(glyph.latex);
    if (alias === undefined) {
      const node = document.convert(glyph.latex, { display: false });
      const simple = adaptor.tags(node, "g").every((group) => !adaptor.hasAttribute(group, "data-mml-node") ||
        ["math", "mrow", "mi", "mn", "mo", "mtext", "mstyle", "TeXAtom"].includes(adaptor.getAttribute(group, "data-mml-node")));
      alias = simple ? adaptor.tags(node, "path").map((path) => {
        const code = adaptor.getAttribute(path, "data-c");
        return code ? normalizeMathCharacter(String.fromCodePoint(parseInt(code, 16))) : "";
      }).join("").replace(invisibleMath, "") : null;
      if (!alias && simple) alias = adaptor.tags(node, "text").map((node) => adaptor.textContent(node)).join("") || null;
      if (aliasCache.size > 512) aliasCache.clear();
      aliasCache.set(glyph.latex, alias);
    }
    if (alias && !aliases.has(alias)) aliases.set(alias, glyph);
    if (!glyph.latex.includes("\\") && !/[{}^_]/.test(glyph.latex)) aliases.set(glyph.latex, glyph);
  }
  return aliases;
}

export function cleanLatex(input: string) {
  const source = input.trim();
  for (const [open, close] of [["$$", "$$"], ["$", "$"], ["\\[", "\\]"], ["\\(", "\\)"]]) {
    if (source.startsWith(open) && source.endsWith(close) && source.length >= open.length + close.length) return source.slice(open.length, -close.length);
  }
  return source;
}

function svgDocument(input: string, spacing?: MathSpacing) {
  const unsupported = input.match(/\\(?:require|href|url|class|style|cssId|includegraphics|html\w*|def|gdef|edef|xdef|let|newcommand|renewcommand|newenvironment|renewenvironment|catcode|input|include|write|openout|special)\b/g);
  if (unsupported) throw new Error(`Unsupported commands: ${[...new Set(unsupported)].join(", ")}`);
  // A new TeX processor prevents user-defined state leaking between expressions.
  const node = newDocument(spacing).convert(cleanLatex(input), { display: true });
  const xml = adaptor.outerHTML(node), doc = new DOMParser().parseFromString(xml, "text/html"), svg = doc.querySelector("svg");
  const error = svg?.querySelector('[data-mml-node="merror"]')?.getAttribute("data-mjx-error");
  if (error) throw new Error(`Invalid LaTeX: ${error.slice(0, 220)}`);
  if (!svg) throw new Error("Could not render LaTeX.");
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] > 100_000 || viewBox[3] > 50_000) throw new Error("Formula is too large.");
  if (svg.querySelectorAll("path, text").length > 600) throw new Error("Formula has too many symbols.");
  return { svg, viewBox };
}

function visible(element: Element) { return !element.closest('[data-mml-node="mphantom"]'); }
function textOf(element: Element) {
  const descendants = element.querySelectorAll('[data-mml-node="mi"], [data-mml-node="mo"], [data-mml-node="mn"], [data-mml-node="mtext"]');
  const operator = element.getAttribute("data-writing-text") ?? (element.hasAttribute("data-writing-unit") && descendants.length === 1 ? descendants[0].getAttribute("data-writing-text") : null);
  if (operator !== null) return operator.replace(invisibleMath, "");
  return [...element.querySelectorAll("path[data-c], text")].map((item) => item.hasAttribute("data-c")
    ? normalizeMathCharacter(String.fromCodePoint(parseInt(item.getAttribute("data-c")!, 16))) : item.textContent ?? "").join("").replace(invisibleMath, "");
}

function finish(placements: WritingPlacement[], width: number, height: number, size: number, structures = "", structureBounds: Box[] = [], transparent = false) {
  const padding = size * 0.35;
  const boxes = [...structureBounds, ...placements.flatMap((p) => [p.outer, glyphBounds(p, p.angle)])];
  const left = Math.min(0, ...boxes.map((b) => b.x)), top = Math.min(0, ...boxes.map((b) => b.y));
  const right = Math.max(width, ...boxes.map((b) => b.x + b.width)), bottom = Math.max(height, ...boxes.map((b) => b.y + b.height));
  const origin = { x: padding - left, y: padding - top };
  const content = placements.map((p) => {
    const common = `x="${number(p.x)}" y="${number(p.y)}" width="${number(p.width)}" height="${number(p.height)}"`;
    return p.glyph ? `<image ${common} href="${escape(p.glyph.image)}" data-medoid="${escape(p.glyph.medoidId)}" data-symbol="${escape(p.label)}" transform="rotate(${number(p.angle)} ${number(p.x + p.width / 2)} ${number(p.y + p.height / 2)})"/>`
      : `<rect ${common} fill="#fff1ee" stroke="#b04a38" stroke-width="1.2" stroke-dasharray="3 2" rx="2" data-missing="${escape(p.label)}"><title>Missing: ${escape(p.label)}</title></rect>`;
  }).join("");
  const w = Math.max(1, right - left + padding * 2), h = Math.max(size, bottom - top + padding * 2);
  if (w * h > 12_000_000 || w > 10000 || h > 16000) throw new Error("Output is too large. Shorten the input or reduce its size.");
  return { width: w, height: h, origin, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${number(w)}" height="${number(h)}" viewBox="0 0 ${number(w)} ${number(h)}">${transparent ? "" : '<rect width="100%" height="100%" fill="white"/>'}<g transform="translate(${number(origin.x)} ${number(origin.y)})">${structures}${content}</g></svg>` };
}

/** Canvas LaTeX keeps prose and unavailable symbols as readable MathJax outlines. */
export function renderWriting(input: string, mode: "text" | "latex", glyphs: WritingGlyph[], settings: WritingSettings, availableWidth: number, options: WritingRenderOptions = {}): WritingResult {
  if (input.length > MAX_WRITING_LENGTH) throw new Error(`Maximum ${MAX_WRITING_LENGTH} characters.`);
  const canvas = options.target === "canvas";
  const aliases = glyphAliases(glyphs);
  if (mode === "text") {
    const layout = layoutText(input, aliases, settings, Math.max(100, availableWidth - settings.size * 0.7));
    return { ...finish(layout.placements, layout.width, layout.height, settings.size, "", [], canvas), placements: layout.placements, missing: layout.missing, unsupported: [] };
  }
  const original = svgDocument(input), scale = settings.size / 1000;
  const sizeSvg = ({ svg, viewBox }: typeof original) => {
    svg.setAttribute("width", String(Math.max(1, viewBox[2] * scale))); svg.setAttribute("height", String(Math.max(1, viewBox[3] * scale)));
    svg.setAttribute("style", "color:#252822");
  };
  sizeSvg(original);
  const preview = { svg: original.svg.outerHTML, width: original.viewBox[2] * scale, height: original.viewBox[3] * scale };
  const layout = svgDocument(input, { aliases, settings, preserveText: canvas });
  sizeSvg(layout);
  const { svg, viewBox: [vx, vy, vw, vh] } = layout;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  host.setAttribute("aria-hidden", "true"); host.append(svg); document.body.append(host);
  try {
    const matrix = (element: SVGGraphicsElement) => svg.getScreenCTM()!.inverse().multiply(element.getScreenCTM()!);
    for (const group of svg.querySelectorAll<SVGGraphicsElement>("[data-writing-scatter]")) {
      const dy = verticalScatter(Number(group.getAttribute("data-writing-scatter")), settings);
      if (!dy) continue;
      const inverse = matrix(group).inverse();
      // Use a vector, not a point: translations must not affect the delta.
      const dx = inverse.c * dy / scale, localY = inverse.d * dy / scale;
      group.setAttribute("transform", `${group.getAttribute("transform") ?? ""} translate(${dx} ${localY})`);
    }
    const bounds = (element: SVGGraphicsElement): Box => {
      const b = element.getBBox(), m = matrix(element);
      const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys);
      return { x: (x - vx) * scale, y: (y - vy) * scale, width: (Math.max(...xs) - x) * scale, height: (Math.max(...ys) - y) * scale };
    };
    const atoms = [...svg.querySelectorAll<SVGGraphicsElement>('[data-writing-unit], [data-mml-node="mi"], [data-mml-node="mo"], [data-mml-node="mn"], [data-mml-node="mtext"]')]
      .filter(visible).filter((element) => element.hasAttribute("data-writing-unit") || !element.closest("[data-writing-unit]"));
    const consumed = new Set<Element>(), placements: WritingPlacement[] = [], missing = new Set<string>(), unsupported = new Set<string>();
    const preserved: SVGGraphicsElement[] = [], fontFallback = new Set<string>();
    const preserve = (element: SVGGraphicsElement, label?: string, absent = true) => {
      preserved.push(element);
      if (label) {
        const name = missingLabel(label);
        fontFallback.add(name);
        if (absent) missing.add(name);
      }
    };
    const add = (box: Box, label: string, glyph: WritingGlyph | undefined, element: SVGGraphicsElement) => {
      if (box.width <= 0 || box.height <= 0) return;
      const fontScale = Math.hypot(matrix(element).a, matrix(element).b);
      // MathJax creates the radical itself during output, outside the input
      // token tree. Its structural spacing is not an applied token margin.
      const applied = element.closest("[data-writing-unit]") ? settings : { ...settings, margin: ZERO_INSETS };
      const line = element.getAttribute("data-writing-cell") === "line";
      const em = settings.size * fontScale, baseline = (matrix(element).f - vy) * scale;
      const cell = line ? { ...box, y: baseline - em * 0.8, height: em } : box;
      const operator = /^[+−=±×÷·<>≤≥≠-]$/.test(label);
      const reference = line && !operator && box.y + box.height < baseline + em * 0.08 ? { ...box, y: baseline - box.height } : box;
      placements.push(placeGlyph(cell, label, glyph, placements.length, applied, fontScale, reference, line && !operator));
      if (!glyph) missing.add(missingLabel(label));
    };
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i]; if (consumed.has(atom)) continue;
      const label = textOf(atom); if (!label.trim()) continue;
      const glyph = aliases.get(label);
      if (canvas && atom.getAttribute("data-mml-node") === "mtext") {
        preserve(atom); consumed.add(atom); continue;
      }
      // The radical path is generated by MathJax outside the TeX token tree.
      // A sample of a full handwritten root includes its overbar; fitting it
      // into only the radical's hook duplicates that bar and can cut the root.
      // Keep the original hook plus MathJax's structural bar until the dataset
      // has stretchable radical parts. The radicand still uses real medoids.
      const generatedRadical = atom.getAttribute("data-mml-node") === "mo" &&
        ["msqrt", "mroot"].includes(atom.parentElement?.getAttribute("data-mml-node") ?? "");
      if (canvas && generatedRadical) {
        const available = glyphs.some((item) => /^(?:\\sqrt\s*\{\s*\}|√)$/.test(item.latex.trim()));
        preserve(atom, "√", !available); consumed.add(atom); continue;
      }
      // Join adjacent atoms only within one baseline run. dx must not consume an
      // x inside a superscript or across the numerator/denominator of a fraction.
      let joined = label, matched = false, previous = atom;
      for (let j = i + 1; j < Math.min(atoms.length, i + 8); j++) {
        const next = atoms[j];
        if (canvas && next.getAttribute("data-mml-node") === "mtext") break;
        if (atom.hasAttribute("data-writing-unit") || previous.nextElementSibling !== next || next.parentElement !== atom.parentElement) break;
        joined += textOf(next); previous = next;
        const compound = aliases.get(joined);
        if (!compound) continue;
        const boxes = atoms.slice(i, j + 1).map(bounds), x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
        if (Math.max(...boxes.map((b) => b.y + b.height)) - y > Math.max(...boxes.map((b) => b.height)) * 1.6) break;
        add({ x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }, joined, compound, atom);
        atoms.slice(i, j + 1).forEach((item) => consumed.add(item)); matched = true; break;
      }
      if (matched) continue;
      if (glyph || atom.hasAttribute("data-writing-text") || atom.hasAttribute("data-writing-unit")) {
        if (canvas && !glyph) preserve(atom, label);
        else add(bounds(atom), label, glyph, atom);
        consumed.add(atom); continue;
      }
      const paths = [...atom.querySelectorAll<SVGGraphicsElement>("path[data-c], text")];
      for (const path of paths) {
        const code = path.getAttribute("data-c"), text = (code ? normalizeMathCharacter(String.fromCodePoint(parseInt(code, 16))) : path.textContent ?? "").replace(invisibleMath, "");
        if (!text.trim()) continue;
        const item = aliases.get(text);
        if (canvas && !item) preserve(path, text);
        else add(bounds(path), text, item, atom);
      }
      consumed.add(atom);
    }
    const structureElements = [...svg.querySelectorAll<SVGGraphicsElement>("rect, line, path:not([data-c])")].filter(visible).filter((element) => !atoms.some((atom) => atom.contains(element)));
    for (const path of svg.querySelectorAll<SVGGraphicsElement>("path[data-c], text")) {
      if (visible(path) && !atoms.some((atom) => atom.contains(path))) {
        unsupported.add(path.closest("[data-mml-node]")?.getAttribute("data-mml-node") ?? "symbol layout");
        // Unknown output layouts must remain visible in the actual solution.
        if (canvas) {
          const code = path.getAttribute("data-c");
          const label = code ? normalizeMathCharacter(String.fromCodePoint(parseInt(code, 16))) : path.textContent ?? "";
          preserve(path, label.replace(invisibleMath, ""));
        }
      }
    }
    const renderElement = (element: SVGGraphicsElement, structure: boolean) => {
      const m = matrix(element), clone = element.cloneNode(true) as SVGGraphicsElement;
      clone.removeAttribute("transform");
      if (structure) {
        clone.setAttribute("fill", "#252822");
        if (element.tagName.toLowerCase() === "line") { clone.setAttribute("stroke", "#252822"); clone.setAttribute("stroke-width", "35"); }
      }
      return `<g fill="#252822" stroke="#252822" stroke-width="0" color="#252822"${structure ? "" : ' data-font-fallback="true"'} transform="matrix(${m.a * scale} ${m.b * scale} ${m.c * scale} ${m.d * scale} ${(m.e - vx) * scale} ${(m.f - vy) * scale})">${clone.outerHTML}</g>`;
    };
    const structures = structureElements.map((element) => renderElement(element, true)).join("") + preserved.map((element) => renderElement(element, false)).join("");
    return { ...finish(placements, vw * scale, vh * scale, settings.size, structures, [...structureElements, ...preserved].map(bounds), canvas), placements, missing: [...missing], unsupported: [...unsupported], ...(canvas ? { fontFallback: [...fontFallback] } : {}), preview };
  } finally { host.remove(); }
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export async function downloadWriting(result: WritingResult) {
  const image = new Image(); image.src = svgDataUrl(result.svg); await image.decode();
  const scale = Math.min(3, Math.sqrt(24_000_000 / (result.width * result.height)));
  const canvas = document.createElement("canvas"); canvas.width = Math.ceil(result.width * scale); canvas.height = Math.ceil(result.height * scale);
  const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not export the image.")), "image/png"));
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = "handwriting.png"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
