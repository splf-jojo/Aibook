import type { AnalysisStatus } from "./handwriting-analysis.ts";

export type WritingGlyph = { latex: string; medoidId: string; image: string; width: number; height: number };
export type WritingDataset = {
  id: string; name: string; approved: boolean; status: AnalysisStatus; sourceVersion: number;
  computedAt?: string; glyphs: WritingGlyph[];
};
export type WritingSettings = { size: number; variation: number; letterSpacing: number; lineSpacing: number; seed: number };
export const DEFAULT_WRITING_SETTINGS: WritingSettings = { size: 48, variation: 0, letterSpacing: 3, lineSpacing: 1.7, seed: 1 };
export const MAX_WRITING_LENGTH = 2000;
export type Box = { x: number; y: number; width: number; height: number };
export type WritingPlacement = Box & { label: string; glyph?: WritingGlyph; angle: number };
export type WritingResult = {
  svg: string; width: number; height: number; missing: string[]; unsupported: string[];
  preview?: { svg: string; width: number; height: number }; placements: WritingPlacement[];
};

export function normalizeMathCharacter(value: string) {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    // Default math italics keep the meaning of plain letters. Other alphabets,
    // such as blackboard bold, retain their distinct mathematical identity.
    return (code >= 0x1d434 && code <= 0x1d467) || (code >= 0x1d6e2 && code <= 0x1d71b) || code === 0x210e
      ? character.normalize("NFKD") : character;
  }).join("");
}
export const invisibleMath = /[\u2061-\u2064\u200b]/g;
export function missingLabel(character: string) {
  const names: Record<string, string> = { "−": "-", "∫": "\\int", "∂": "\\partial", "∑": "\\sum", "Σ": "\\Sigma", "σ": "\\sigma",
    "×": "\\times", "÷": "\\div", "·": "\\cdot", "±": "\\pm", "∞": "\\infty", "√": "\\sqrt{}", "≤": "\\le", "≥": "\\ge", "≠": "\\ne" };
  return names[character] ?? character;
}

export function randomVariation(index: number, settings: WritingSettings) {
  let state = (settings.seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 * 2 - 1; };
  const amount = Math.max(0, Math.min(100, settings.variation)) / 100;
  if (!amount) return { dx: 0, dy: 0, angle: 0, scale: 1 };
  return { dx: random() * amount * 0.035, dy: random() * amount * 0.055, angle: random() * amount * 5, scale: 1 + random() * amount * 0.06 };
}

export function placeGlyph(box: Box, label: string, glyph: WritingGlyph | undefined, index: number, settings: WritingSettings): WritingPlacement {
  const ratio = glyph ? glyph.width / glyph.height : box.width / box.height;
  const height = Math.min(box.height, box.width / ratio), width = height * ratio;
  const variation = randomVariation(index, settings), h = height * variation.scale, w = width * variation.scale;
  return { x: box.x + (box.width - w) / 2 + box.height * variation.dx, y: box.y + (box.height - h) / 2 + box.height * variation.dy,
    width: w, height: h, angle: variation.angle, label, ...(glyph ? { glyph } : {}) };
}

export function textTokens(input: string, aliases: ReadonlyMap<string, WritingGlyph>) {
  const multi = [...aliases.keys()].filter((key) => key.length > 1 && !/\s/.test(key)).sort((a, b) => b.length - a.length);
  const tokens: { text: string; glyph?: WritingGlyph }[] = [];
  for (let i = 0; i < input.length;) {
    const compound = multi.find((key) => input.startsWith(key, i));
    const text = compound ?? String.fromCodePoint(input.codePointAt(i)!);
    tokens.push({ text, glyph: aliases.get(text) }); i += text.length;
  }
  return tokens;
}

export function layoutText(input: string, aliases: ReadonlyMap<string, WritingGlyph>, settings: WritingSettings, availableWidth: number) {
  const placements: WritingPlacement[] = [], missing = new Set<string>(), size = settings.size;
  let x = 0, line = 0, maxX = 0;
  for (const token of textTokens(input.replace(/\r\n?/g, "\n"), aliases)) {
    if (token.text === "\n") { x = 0; line++; continue; }
    if (/^\s+$/.test(token.text)) { x += size * (token.text === "\t" ? 1.4 : 0.35); continue; }
    const t = token.text, descender = /^[gjpqy]$/.test(t), operator = /^[+−=±×÷·-]$/.test(t);
    const ratio = token.glyph ? token.glyph.width / token.glyph.height : 0.7;
    const height = operator ? Math.min(size * 0.6, size * 0.65 / ratio) : size * (/^[aceimnorsuvwxz]$/.test(t) ? 0.55 : 0.78);
    const width = token.glyph ? height * ratio : size * 0.55;
    if (x && x + width > availableWidth) { x = 0; line++; }
    const baseline = line * size * settings.lineSpacing + size;
    const y = operator ? baseline - size * 0.3 - height / 2 : baseline - height + (descender ? size * 0.2 : 0);
    placements.push(placeGlyph({ x, y, width, height }, t, token.glyph, placements.length, settings));
    if (!token.glyph) missing.add(t);
    x += width + settings.letterSpacing; maxX = Math.max(maxX, x);
  }
  return { placements, missing: [...missing], width: Math.max(1, maxX), height: (line + 1) * size * settings.lineSpacing };
}
