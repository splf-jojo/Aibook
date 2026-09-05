import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import type { AbstractMmlTokenNode, MmlNode } from "mathjax-full/js/core/MmlTree/MmlNode.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import {
  invisibleMath, layoutText, MAX_WRITING_LENGTH, missingLabel, normalizeMathCharacter, placeGlyph,
  type Box, type WritingGlyph, type WritingPlacement, type WritingResult, type WritingSettings,
} from "./handwriting-writing.ts";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const newDocument = () => {
  const input = new TeX({ packages: ["base", "ams"], maxBuffer: 4000, maxMacros: 200 });
  input.postFilters.add(({ data }: { data: { root: MmlNode } }) => data.root.walkTree((node) => {
    // A stretched bracket may consist of several font paths. Keep its original
    // operator identity so it still matches one medoid or one missing symbol.
    if (node.kind === "mo") {
      const token = node as AbstractMmlTokenNode;
      token.attributes.set("data-writing-text", token.getText());
    }
  }));
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

function svgDocument(input: string) {
  const unsupported = input.match(/\\(?:require|href|url|class|style|cssId|includegraphics|html\w*|def|gdef|edef|xdef|let|newcommand|renewcommand|newenvironment|renewenvironment|catcode|input|include|write|openout|special)\b/g);
  if (unsupported) throw new Error(`Unsupported commands: ${[...new Set(unsupported)].join(", ")}`);
  // A new TeX processor prevents user-defined state leaking between expressions.
  const node = newDocument().convert(cleanLatex(input), { display: true });
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
  const operator = element.getAttribute("data-writing-text");
  if (operator !== null) return operator.replace(invisibleMath, "");
  return [...element.querySelectorAll("path[data-c], text")].map((item) => item.hasAttribute("data-c")
    ? normalizeMathCharacter(String.fromCodePoint(parseInt(item.getAttribute("data-c")!, 16))) : item.textContent ?? "").join("").replace(invisibleMath, "");
}

function finish(placements: WritingPlacement[], width: number, height: number, size: number, structures = "") {
  const padding = size * 0.35;
  const content = placements.map((p) => {
    const common = `x="${number(p.x)}" y="${number(p.y)}" width="${number(p.width)}" height="${number(p.height)}"`;
    return p.glyph ? `<image ${common} href="${escape(p.glyph.image)}" data-medoid="${escape(p.glyph.medoidId)}" data-symbol="${escape(p.label)}" transform="rotate(${number(p.angle)} ${number(p.x + p.width / 2)} ${number(p.y + p.height / 2)})"/>`
      : `<rect ${common} fill="#fff1ee" stroke="#b04a38" stroke-width="1.2" stroke-dasharray="3 2" rx="2" data-missing="${escape(p.label)}"><title>Missing: ${escape(p.label)}</title></rect>`;
  }).join("");
  const w = Math.max(1, width + padding * 2), h = Math.max(size, height + padding * 2);
  if (w * h > 12_000_000 || w > 10000 || h > 16000) throw new Error("Output is too large. Shorten the input or reduce its size.");
  return { width: w, height: h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${number(w)}" height="${number(h)}" viewBox="0 0 ${number(w)} ${number(h)}"><rect width="100%" height="100%" fill="white"/><g transform="translate(${number(padding)} ${number(padding)})">${structures}${content}</g></svg>` };
}

export function renderWriting(input: string, mode: "text" | "latex", glyphs: WritingGlyph[], settings: WritingSettings, availableWidth: number): WritingResult {
  if (input.length > MAX_WRITING_LENGTH) throw new Error(`Maximum ${MAX_WRITING_LENGTH} characters.`);
  const aliases = glyphAliases(glyphs);
  if (mode === "text") {
    const layout = layoutText(input, aliases, settings, Math.max(100, availableWidth - settings.size * 0.7));
    return { ...finish(layout.placements, layout.width, layout.height, settings.size), placements: layout.placements, missing: layout.missing, unsupported: [] };
  }
  const { svg, viewBox: [vx, vy, vw, vh] } = svgDocument(input), scale = settings.size / 1000;
  svg.setAttribute("width", String(Math.max(1, vw * scale))); svg.setAttribute("height", String(Math.max(1, vh * scale)));
  svg.setAttribute("style", "color:#252822");
  const preview = { svg: svg.outerHTML, width: vw * scale, height: vh * scale };
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  host.setAttribute("aria-hidden", "true"); host.append(svg); document.body.append(host);
  try {
    const matrix = (element: SVGGraphicsElement) => svg.getScreenCTM()!.inverse().multiply(element.getScreenCTM()!);
    const bounds = (element: SVGGraphicsElement): Box => {
      const b = element.getBBox(), m = matrix(element);
      const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys);
      return { x: (x - vx) * scale, y: (y - vy) * scale, width: (Math.max(...xs) - x) * scale, height: (Math.max(...ys) - y) * scale };
    };
    const atoms = [...svg.querySelectorAll<SVGGraphicsElement>('[data-mml-node="mi"], [data-mml-node="mo"], [data-mml-node="mn"], [data-mml-node="mtext"]')].filter(visible);
    const consumed = new Set<Element>(), placements: WritingPlacement[] = [], missing = new Set<string>(), unsupported = new Set<string>();
    const add = (box: Box, label: string, glyph?: WritingGlyph) => {
      if (box.width <= 0 || box.height <= 0) return;
      placements.push(placeGlyph(box, label, glyph, placements.length, settings));
      if (!glyph) missing.add(missingLabel(label));
    };
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i]; if (consumed.has(atom)) continue;
      const label = textOf(atom); if (!label.trim()) continue;
      const glyph = aliases.get(label);
      // Join adjacent atoms only within one baseline run. dx must not consume an
      // x inside a superscript or across the numerator/denominator of a fraction.
      let joined = label, matched = false, previous = atom;
      for (let j = i + 1; j < Math.min(atoms.length, i + 8); j++) {
        const next = atoms[j];
        if (previous.nextElementSibling !== next || next.parentElement !== atom.parentElement) break;
        joined += textOf(next); previous = next;
        const compound = aliases.get(joined);
        if (!compound) continue;
        const boxes = atoms.slice(i, j + 1).map(bounds), x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
        if (Math.max(...boxes.map((b) => b.y + b.height)) - y > Math.max(...boxes.map((b) => b.height)) * 1.6) break;
        add({ x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }, joined, compound);
        atoms.slice(i, j + 1).forEach((item) => consumed.add(item)); matched = true; break;
      }
      if (matched) continue;
      if (glyph || atom.hasAttribute("data-writing-text")) { add(bounds(atom), label, glyph); consumed.add(atom); continue; }
      const paths = [...atom.querySelectorAll<SVGGraphicsElement>("path[data-c], text")];
      for (const path of paths) {
        const code = path.getAttribute("data-c"), text = (code ? normalizeMathCharacter(String.fromCodePoint(parseInt(code, 16))) : path.textContent ?? "").replace(invisibleMath, "");
        if (!text.trim()) continue;
        add(bounds(path), text, aliases.get(text));
      }
      consumed.add(atom);
    }
    const structures = [...svg.querySelectorAll<SVGGraphicsElement>("rect, line, path:not([data-c])")].filter(visible).filter((element) => !atoms.some((atom) => atom.contains(element))).map((element) => {
      const m = matrix(element), clone = element.cloneNode(true) as SVGGraphicsElement;
      clone.removeAttribute("transform"); clone.setAttribute("fill", "#252822");
      if (element.tagName.toLowerCase() === "line") { clone.setAttribute("stroke", "#252822"); clone.setAttribute("stroke-width", "35"); }
      return `<g transform="matrix(${m.a * scale} ${m.b * scale} ${m.c * scale} ${m.d * scale} ${(m.e - vx) * scale} ${(m.f - vy) * scale})">${clone.outerHTML}</g>`;
    }).join("");
    for (const path of svg.querySelectorAll("path[data-c], text")) {
      if (visible(path) && !atoms.some((atom) => atom.contains(path))) unsupported.add(path.closest("[data-mml-node]")?.getAttribute("data-mml-node") ?? "symbol layout");
    }
    return { ...finish(placements, vw * scale, vh * scale, settings.size, structures), placements, missing: [...missing], unsupported: [...unsupported], preview };
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
