import sharp from "sharp";
import { analysisPreview } from "./handwriting-store.server.ts";
import type { WritingDataset, WritingGlyph } from "./handwriting-writing.ts";

/** Only current, accepted medoids are served. Analysis keeps the other images. */
export async function writingDataset(id: string): Promise<WritingDataset> {
  const analysis = await analysisPreview(id), glyphs: WritingGlyph[] = [];
  for (const symbol of analysis.symbols) {
    const result = symbol.result;
    if (result?.status !== "complete") continue;
    const medoid = result.samples.find((sample) => sample.id === result.medoid.id);
    if (!medoid) throw new Error("Missing medoid provenance.");
    const { data, info } = await sharp(Buffer.from(result.medoid.image.split(",")[1], "base64"), { limitInputPixels: 256 * 128 })
      .greyscale().raw().toBuffer({ resolveWithObject: true });
    const [left, top] = medoid.offset;
    const width = Math.min(info.width - left, Math.max(1, Math.round(medoid.inkBox[2] * medoid.scale)));
    const height = Math.min(info.height - top, Math.max(1, Math.round(medoid.inkBox[3] * medoid.scale)));
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba[(y * width + x) * 4 + 3] = 255 - data[(y + top) * info.width + x + left];
    const image = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    glyphs.push({ latex: symbol.latex, medoidId: result.medoid.id, width, height, image: `data:image/png;base64,${image.toString("base64")}` });
  }
  return { id, name: analysis.name, approved: analysis.approved, status: analysis.status, sourceVersion: analysis.sourceVersion,
    ...(analysis.computedAt ? { computedAt: analysis.computedAt } : {}), glyphs };
}
