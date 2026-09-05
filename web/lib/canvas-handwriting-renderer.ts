import { DEFAULT_WRITING_SETTINGS, MAX_WRITING_LENGTH, type WritingDataset } from "./handwriting-writing.ts";
import { formulaSeed, type HandwritingSnapshot } from "./canvas-handwriting.ts";
import { renderWriting, svgDataUrl } from "./handwriting-writing-renderer.ts";
import { renderLatexImage, type FormulaImage } from "./latex-image.ts";

export type HandwrittenFormulaImage = FormulaImage & { handwriting?: HandwritingSnapshot };

/** Freeze the source and rendering settings alongside the portable canvas image. */
export async function renderCanvasHandwriting(latex: string, dataset: WritingDataset | null, fontSize = 32, maxWidth = 690): Promise<HandwrittenFormulaImage> {
  if (!dataset) return renderLatexImage(latex, fontSize, maxWidth);
  if (!dataset.approved || !["complete", "partial"].includes(dataset.status) || !dataset.glyphs.length) {
    throw new Error("handwriting-not-ready");
  }
  const settings = { ...DEFAULT_WRITING_SETTINGS, size: fontSize, variation: 8, seed: formulaSeed(latex) };
  const snapshot: HandwritingSnapshot = { schemaVersion: 1, rendererVersion: 1, datasetId: dataset.id,
    datasetName: dataset.name, sourceVersion: dataset.sourceVersion, computedAt: dataset.computedAt,
    settings, color: "#2456a6", medoids: [], fontSymbols: [], fontOnly: false };
  if (latex.length > MAX_WRITING_LENGTH) {
    return { ...await renderLatexImage(latex, fontSize, maxWidth), handwriting: { ...snapshot, fontOnly: true, fallbackReason: "length" } };
  }
  const result = renderWriting(latex, "latex", dataset.glyphs, settings, maxWidth, { target: "canvas" });
  if (result.unsupported.length) {
    return { ...await renderLatexImage(latex, fontSize, maxWidth), handwriting: { ...snapshot, fontOnly: true, fallbackReason: "layout" } };
  }
  const scale = Math.min(1, maxWidth / result.width);
  const width = result.width * scale, height = result.height * scale;
  if (fontSize * scale < 19 || height > 990) throw new Error("formula-too-large");
  const image = new Image(); image.src = svgDataUrl(result.svg); await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * 3); canvas.height = Math.ceil(height * 3);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = snapshot.color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const used = new Map(result.placements.filter(p => p.glyph).map(p => [p.glyph!.medoidId, { label: p.label, id: p.glyph!.medoidId }]));
  return { dataUrl: canvas.toDataURL("image/png"), width, height, handwriting: {
    ...snapshot, medoids: [...used.values()], fontSymbols: [...new Set([...result.missing, ...(result.fontFallback ?? [])])],
    fontOnly: used.size === 0,
  } };
}
