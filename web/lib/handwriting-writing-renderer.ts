import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import type { AbstractMmlNode, AbstractMmlTokenNode, MmlNode } from "mathjax-full/js/core/MmlTree/MmlNode.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import { applyMathMargins } from "./handwriting-writing-math.ts";
import {
  expandBox, glyphBounds, invisibleMath, layoutText, MAX_WRITING_LENGTH, missingLabel, normalizeMathCharacter, placeGlyph, placeNativeGlyph, placePrintedGlyph, verticalScatter, ZERO_INSETS,
  type Box, type WritingGlyph, type WritingPlacement, type WritingResult, type WritingSettings,
} from "./handwriting-writing.ts";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
type MathSpacing = { aliases: ReadonlyMap<string, WritingGlyph>; settings: WritingSettings; preserveText?: boolean; native?: boolean };
export type WritingRenderOptions = { target?: "writing" | "canvas"; readable?: boolean; printed?: boolean };
const newDocument = (spacing?: MathSpacing) => {
  const input = new TeX({ packages: ["base", "ams"], maxBuffer: 4000, maxMacros: 200 });
  input.postFilters.add(({ data }: { data: { root: MmlNode } }) => data.root.walkTree((node) => {
    // A stretched bracket may consist of several font paths. Keep its original
    // operator identity so it still matches one medoid or one missing symbol.
    if (node.kind === "mo") {
      const token = node as AbstractMmlTokenNode;
      token.attributes.set("data-writing-text", token.getText());
    }
    if (["mi", "mn", "mo", "mtext"].includes(node.kind)) {
      const token = node as AbstractMmlTokenNode;
      const large = node.kind === "mo" && (token.attributes.get("largeop") || token.attributes.get("stretchy"));
      token.attributes.set("data-writing-cell", large ? "ink" : "line");
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
  const paths = element.matches("path[data-c], text") ? [element] : [...element.querySelectorAll("path[data-c], text")];
  return paths.map((item) => item.hasAttribute("data-c")
    ? normalizeMathCharacter(String.fromCodePoint(parseInt(item.getAttribute("data-c")!, 16))) : item.textContent ?? "").join("").replace(invisibleMath, "");
}

function finish(placements: WritingPlacement[], width: number, height: number, size: number, structures = "", structureBounds: Box[] = [], transparent = false, naturalFrame = false) {
  const padding = naturalFrame ? 0 : size * 0.35;
  const boxes = [...structureBounds, ...placements.flatMap((p) => [p.outer, p.glyph ? glyphBounds(p, p.angle) : expandBox(glyphBounds(p, p.angle), { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 })])];
  const left = Math.min(0, ...boxes.map((b) => b.x)), top = Math.min(0, ...boxes.map((b) => b.y));
  const right = Math.max(width, ...boxes.map((b) => b.x + b.width)), bottom = Math.max(height, ...boxes.map((b) => b.y + b.height));
  const origin = { x: padding - left, y: padding - top };
  const content = placements.map((p) => {
    const common = `x="${number(p.x)}" y="${number(p.y)}" width="${number(p.width)}" height="${number(p.height)}"`;
    return p.glyph ? `<image ${common} href="${escape(p.glyph.image)}" data-medoid="${escape(p.glyph.medoidId)}" data-symbol="${escape(p.label)}" transform="rotate(${number(p.angle)} ${number(p.x + p.width / 2)} ${number(p.y + p.height / 2)})"/>`
      : `<rect ${common} transform="rotate(${number(p.angle)} ${number(p.x + p.width / 2)} ${number(p.y + p.height / 2)})" fill="#fff1ee" stroke="#b04a38" stroke-width="1.2" stroke-dasharray="3 2" rx="2" data-missing="${escape(p.label)}"><title>Missing: ${escape(p.label)}</title></rect>`;
  }).join("");
  const w = Math.max(1, right - left + padding * 2), h = Math.max(naturalFrame ? 1 : size, bottom - top + padding * 2);
  if (w * h > 12_000_000 || w > 10000 || h > 16000) throw new Error("Output is too large. Shorten the input or reduce its size.");
  return { width: w, height: h, origin, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${number(w)}" height="${number(h)}" viewBox="0 0 ${number(w)} ${number(h)}">${transparent ? "" : '<rect width="100%" height="100%" fill="white"/>'}<g transform="translate(${number(origin.x)} ${number(origin.y)})">${structures}${content}</g></svg>` };
}

/** Canvas LaTeX keeps prose and unavailable symbols as readable MathJax outlines. */
export function renderWriting(input: string, mode: "text" | "latex", glyphs: WritingGlyph[], settings: WritingSettings, availableWidth: number, options: WritingRenderOptions = {}): WritingResult {
  if (input.length > MAX_WRITING_LENGTH) throw new Error(`Maximum ${MAX_WRITING_LENGTH} characters.`);
  const canvas = options.target === "canvas";
  const readable = canvas || options.readable === true || options.printed === true;
  for (const glyph of glyphs) {
    if (![glyph.width, glyph.height].every(n => Number.isFinite(n) && n > 0)) throw new Error(`Invalid glyph dimensions: ${glyph.latex}`);
    const m = glyph.metrics;
    if (m && (m.version !== 1 || ![m.width, m.height, m.unitsPerEm].every(n => Number.isFinite(n) && n > 0) || !Number.isFinite(m.baseline))) throw new Error(`Invalid source metrics: ${glyph.latex}`);
  }
  const aliases = glyphAliases(glyphs);
  if (mode === "text") {
    const layout = layoutText(input, aliases, settings, Math.max(100, availableWidth - (canvas ? settings.size * 0.7 : 0)));
    return { ...finish(layout.placements, layout.width, layout.height, settings.size, "", [], canvas, !canvas), placements: layout.placements, missing: layout.missing, unsupported: [] };
  }
  const original = svgDocument(input), scale = settings.size / 1000;
  const sizeSvg = ({ svg, viewBox }: typeof original) => {
    svg.setAttribute("width", String(Math.max(1, viewBox[2] * scale))); svg.setAttribute("height", String(Math.max(1, viewBox[3] * scale)));
    svg.setAttribute("style", "color:#252822");
  };
  sizeSvg(original);
  const preview = { svg: original.svg.outerHTML, width: original.viewBox[2] * scale, height: original.viewBox[3] * scale,
    placements: [] as WritingPlacement[], origin: { x: 0, y: 0 } };
  const layout = svgDocument(input, { aliases, settings, preserveText: readable, native: !options.printed });
  sizeSvg(layout);
  const { svg, viewBox: [vx, vy, vw, vh] } = layout;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  host.setAttribute("aria-hidden", "true"); host.append(original.svg, svg); document.body.append(host);
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
    const measuredBounds = (element: SVGGraphicsElement, root: SVGSVGElement, xOrigin: number, yOrigin: number): Box => {
      // Measure leaf outlines consistently. Browser group getBBox can include
      // different conservative curve bounds depending on MathJax's wrappers.
      const leaves = element.matches("path, text, rect, line") ? [element] : [...element.querySelectorAll<SVGGraphicsElement>("path, text, rect, line")].filter(visible);
      const inverse = root.getScreenCTM()!.inverse();
      const points = leaves.flatMap(leaf => {
        const b = leaf.getBBox(), m = inverse.multiply(leaf.getScreenCTM()!);
        if (!b.width && !b.height) return [];
        return [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      });
      if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys);
      return { x: (x - xOrigin) * scale, y: (y - yOrigin) * scale, width: (Math.max(...xs) - x) * scale, height: (Math.max(...ys) - y) * scale };
    };
    const bounds = (element: SVGGraphicsElement) => measuredBounds(element, svg, vx, vy);
    const atomsOf = (root: SVGSVGElement) => [...root.querySelectorAll<SVGGraphicsElement>('[data-writing-unit], [data-mml-node="mi"], [data-mml-node="mo"], [data-mml-node="mn"], [data-mml-node="mtext"]')]
      .filter(visible).filter((element) => element.hasAttribute("data-writing-unit") || !element.closest("[data-writing-unit]"));
    type Unit = { elements: SVGGraphicsElement[]; metric: SVGGraphicsElement; label: string; kind?: "prose" | "structure" };
    const unitsOf = (root: SVGSVGElement) => {
      const atoms = atomsOf(root), units: Unit[] = [];
      for (let i = 0; i < atoms.length; i++) {
        const atom = atoms[i], label = textOf(atom);
        if (!label.trim()) continue;
        if (atom.hasAttribute("data-writing-structure")) {
          units.push({ elements: [atom], metric: atom, label, kind: "structure" }); continue;
        }
        if (readable && atom.getAttribute("data-mml-node") === "mtext") {
          units.push({ elements: [atom], metric: atom, label, kind: "prose" }); continue;
        }
        const radical = atom.getAttribute("data-mml-node") === "mo" && ["msqrt", "mroot"].includes(atom.parentElement?.getAttribute("data-mml-node") ?? "");
        if (readable && radical) { units.push({ elements: [atom], metric: atom, label, kind: "structure" }); continue; }
        let joined = label, end = i;
        for (let j = i + 1; j < Math.min(atoms.length, i + 8); j++) {
          const next = atoms[j];
          if (atom.hasAttribute("data-writing-unit") || atoms[j - 1].nextElementSibling !== next || next.parentElement !== atom.parentElement || (readable && next.getAttribute("data-mml-node") === "mtext")) break;
          const nextLabel = textOf(next);
          if (!nextLabel.trim()) break;
          joined += nextLabel;
          if (aliases.has(joined)) end = j;
        }
        if (end > i) {
          const elements = atoms.slice(i, end + 1);
          units.push({ elements, metric: atom, label: elements.map(textOf).join("") }); i = end; continue;
        }
        if (aliases.has(label) || atom.hasAttribute("data-writing-text") || atom.hasAttribute("data-writing-unit") || (readable && atom.getAttribute("data-mml-node") === "mi")) {
          units.push({ elements: [atom], metric: atom, label }); continue;
        }
        for (const path of atom.querySelectorAll<SVGGraphicsElement>("path[data-c], text")) {
          const text = textOf(path);
          if (text.trim()) units.push({ elements: [path], metric: atom, label: text });
        }
      }
      return units;
    };
    const geometry = (unit: Unit, root: SVGSVGElement, view: number[]) => {
      const boxes = unit.elements.map(element => measuredBounds(element, root, view[0], view[1]));
      const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
      const box = { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
      const element = unit.metric, m = root.getScreenCTM()!.inverse().multiply(element.getScreenCTM()!);
      const fontScale = Math.hypot(m.a, m.b);
      const line = element.getAttribute("data-writing-cell") === "line";
      const em = settings.size * fontScale, baseline = (m.f - view[1]) * scale;
      const cell = line ? { ...box, y: baseline - em * 0.8, height: em } : box;
      const operator = /^[+−=±×÷·<>≤≥≠-]$/.test(unit.label);
      const reference = line && !operator && box.y + box.height < baseline + em * 0.08 ? { ...box, y: baseline - box.height } : box;
      return { box, cell, reference, fontScale, baseline, x: (m.e - view[0]) * scale, alignBottom: line && !operator };
    };
    const neutral = { ...settings, variation: 0, verticalScatter: 0, padding: ZERO_INSETS, margin: ZERO_INSETS };
    for (const unit of unitsOf(original.svg)) {
      const g = geometry(unit, original.svg, original.viewBox);
      if (g.box.width <= 0 || g.box.height <= 0) continue;
      preview.placements.push({ ...placePrintedGlyph(g.cell, g.reference, g.box, unit.label, preview.placements.length, neutral, g.fontScale), kind: unit.kind ?? "printed" });
    }
    const atoms = atomsOf(svg), placements: WritingPlacement[] = [], inspectionPlacements: WritingPlacement[] = [], missing = new Set<string>(), unsupported = new Set<string>();
    const preserved: { unit: Unit; ink: Box; placement: WritingPlacement }[] = [], fontFallback = new Set<string>();
    const preserve = (unit: Unit, absent: boolean, index: number) => {
      const g = geometry(unit, svg, layout.viewBox);
      if (g.box.width <= 0 || g.box.height <= 0) return;
      const fixed = canvas || unit.kind === "structure";
      const applied = { ...settings, ...(fixed ? { padding: ZERO_INSETS, variation: 0 } : {}),
        ...(!unit.metric.closest("[data-writing-unit]") ? { margin: ZERO_INSETS } : {}) };
      const p = { ...placePrintedGlyph(g.cell, g.reference, g.box, unit.label, index, applied, g.fontScale), kind: unit.kind ?? "printed" as const };
      preserved.push({ unit, ink: g.box, placement: p }); inspectionPlacements.push(p);
      if (unit.kind !== "prose" && !options.printed) {
        fontFallback.add(missingLabel(unit.label));
        if (absent) missing.add(missingLabel(unit.label));
      }
    };
    unitsOf(svg).forEach((unit, index) => {
      const glyph = options.printed ? undefined : aliases.get(unit.label);
      if (unit.kind || (readable && !glyph)) {
        const availableRoot = unit.kind === "structure" && glyphs.some(item => /^(?:\\sqrt\s*\{\s*\}|√)$/.test(item.latex.trim()));
        preserve(unit, !glyph && !availableRoot, index); return;
      }
      const g = geometry(unit, svg, layout.viewBox);
      if (g.box.width <= 0 || g.box.height <= 0) return;
      const applied = unit.metric.closest("[data-writing-unit]") ? settings : { ...settings, margin: ZERO_INSETS };
      const nativeIndex = unit.metric.getAttribute("data-writing-native");
      const p = { ...(glyph?.metrics && nativeIndex !== null
        ? placeNativeGlyph(g.x, g.baseline, unit.label, glyph, Number(nativeIndex), applied, g.fontScale, g.reference)
        : placeGlyph(g.cell, unit.label, glyph, canvas ? placements.length : index, applied, g.fontScale, g.reference, g.alignBottom)), kind: glyph ? "handwriting" as const : "missing" as const };
      placements.push(p); inspectionPlacements.push(p);
      if (!glyph) missing.add(missingLabel(unit.label));
    });
    const structureElements = [...svg.querySelectorAll<SVGGraphicsElement>("rect, line, path:not([data-c])")].filter(visible).filter((element) => !atoms.some((atom) => atom.contains(element)));
    for (const path of svg.querySelectorAll<SVGGraphicsElement>("path[data-c], text")) {
      if (visible(path) && !atoms.some((atom) => atom.contains(path))) {
        if (!options.printed) unsupported.add(path.closest("[data-mml-node]")?.getAttribute("data-mml-node") ?? "symbol layout");
        // Unknown output layouts must remain visible in the actual solution.
        if (readable) {
          const code = path.getAttribute("data-c");
          const label = code ? normalizeMathCharacter(String.fromCodePoint(parseInt(code, 16))) : path.textContent ?? "";
          preserve({ elements: [path], metric: path, label: label.replace(invisibleMath, ""), kind: "structure" }, true, inspectionPlacements.length);
        }
      }
    }
    const renderElement = (element: SVGGraphicsElement, structure: boolean) => {
      const m = matrix(element), clone = element.cloneNode(true) as SVGGraphicsElement;
      clone.removeAttribute("transform");
      if (structure) {
        clone.setAttribute("fill", "#252822");
        if (element.tagName.toLowerCase() === "line") clone.setAttribute("stroke", "#252822");
      }
      return `<g fill="#252822" stroke="#252822" stroke-width="0" color="#252822"${structure ? "" : ' data-font-fallback="true"'} transform="matrix(${m.a * scale} ${m.b * scale} ${m.c * scale} ${m.d * scale} ${(m.e - vx) * scale} ${(m.f - vy) * scale})">${clone.outerHTML}</g>`;
    };
    const structures = structureElements.map((element) => renderElement(element, true)).join("") + preserved.map(({ unit, ink, placement: p }) => {
      const content = unit.elements.map(element => renderElement(element, false)).join("");
      if (p.x === ink.x && p.y === ink.y && p.width === ink.width && p.height === ink.height && !p.angle) return content;
      return `<g transform="translate(${p.x + p.width / 2} ${p.y + p.height / 2}) rotate(${p.angle}) scale(${p.width / ink.width} ${p.height / ink.height}) translate(${-ink.x - ink.width / 2} ${-ink.y - ink.height / 2})">${content}</g>`;
    }).join("");
    const fontPlacements = preserved.map(item => item.placement);
    // Keep the exact original SVG for wholly printed, unmodified output. This
    // also avoids a second rounding of stretched signs, accents and table rules.
    if (!canvas && readable && !placements.length && !settings.variation && !settings.verticalScatter &&
      !Object.values(settings.padding).some(Boolean) && !Object.values(settings.margin).some(Boolean)) {
      const printedSvg = original.svg.cloneNode(true) as SVGSVGElement;
      const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      background.setAttribute("x", String(original.viewBox[0])); background.setAttribute("y", String(original.viewBox[1]));
      background.setAttribute("width", "100%"); background.setAttribute("height", "100%"); background.setAttribute("fill", "white");
      printedSvg.prepend(background);
      return { svg: printedSvg.outerHTML, width: preview.width, height: preview.height, origin: { x: 0, y: 0 }, placements,
        inspectionPlacements: preview.placements, fontPlacements: preview.placements, missing: [...missing], unsupported: [], fontFallback: [...fontFallback], preview };
    }
    return { ...finish(placements, vw * scale, vh * scale, settings.size, structures, [...structureElements.map(bounds), ...fontPlacements.map(p => glyphBounds(p, p.angle))], canvas, !canvas), placements, inspectionPlacements, missing: [...missing], unsupported: [...unsupported], ...(readable ? { fontFallback: [...fontFallback], fontPlacements } : {}), preview };
  } finally { host.remove(); }
}

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export async function downloadWriting(result: WritingResult) {
  const image = new Image(); image.src = svgDataUrl(result.svg); await image.decode();
  const scale = Math.min(3, Math.sqrt(24_000_000 / (result.width * result.height)));
  const canvas = document.createElement("canvas"); canvas.width = Math.ceil(result.width * scale); canvas.height = Math.ceil(result.height * scale);
  const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas is unavailable.");
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, result.width * scale, result.height * scale);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not export the image.")), "image/png"));
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = "handwriting.png"; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
