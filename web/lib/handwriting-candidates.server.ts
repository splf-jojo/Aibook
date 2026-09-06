import sharp from "sharp";
import { ANALYSIS_SETTINGS } from "./handwriting-analysis.ts";
import type { CandidateDataset } from "./handwriting-dataset.ts";
import { restoreBlobs } from "./handwriting-db.server.ts";

/** PencilKit exports contain ink on transparency, without paper or guides.
 * Older iPad exports inherited dark-mode traits and encoded white ink. Use the
 * alpha mask as black ink for both review and analysis; never rewrite originals.
 */
async function pencilInk(image: string): Promise<string> {
  try {
    const input = sharp(Buffer.from(image.split(",")[1], "base64"), {
      limitInputPixels: ANALYSIS_SETTINGS.maxInputPixels, failOn: "warning",
    });
    const metadata = await input.metadata();
    if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1 || !metadata.hasAlpha) return image;
    const { data, info } = await input.toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = false, coloredInk = false;
    for (let p = 0; p < data.length; p += 4) {
      transparent ||= data[p + 3] === 0;
      coloredInk ||= data[p + 3] > 0 && (data[p] !== 0 || data[p + 1] !== 0 || data[p + 2] !== 0);
    }
    // Opaque paper images are not alpha masks. Already-black/empty ink is stable.
    if (!transparent || !coloredInk) return image;
    for (let p = 0; p < data.length; p += 4) data[p] = data[p + 1] = data[p + 2] = 0;
    const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    // Keep an unreadable sample rejectable in review; analysis reports its ID.
    return image;
  }
}

export async function canonicalCandidates(dataset: CandidateDataset): Promise<CandidateDataset> {
  if (dataset.schemaVersion !== 2) return dataset;
  const images = new Map<string, string>();
  async function canonical(image: string) {
    const cached = images.get(image);
    if (cached !== undefined) return cached;
    const result = await pencilInk(image);
    images.set(image, result);
    return result;
  }
  const samples = [];
  // Bound decoded-image memory on ECS; deduplicate image/context within this read.
  for (const sample of dataset.samples) {
    samples.push(sample.source.kind === "pencilkit"
      ? { ...sample, image: await canonical(sample.image), context: await canonical(sample.context) }
      : sample);
  }
  return { ...dataset, samples };
}

export async function readCandidateDataset(id: string, stored: unknown): Promise<CandidateDataset> {
  return canonicalCandidates(await restoreBlobs<CandidateDataset>(id, stored));
}
