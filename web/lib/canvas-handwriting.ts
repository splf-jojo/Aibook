import type { DatasetSummary } from "./handwriting-library.ts";
import type { WritingDataset, WritingSettings } from "./handwriting-writing.ts";

export type HandwritingChoice = "auto" | "font" | string;
export type HandwritingSnapshot = {
  schemaVersion: 1;
  rendererVersion: 1;
  datasetId: string;
  datasetName: string;
  sourceVersion: number;
  computedAt?: string;
  settings: WritingSettings;
  color: string;
  medoids: { label: string; id: string }[];
  fontSymbols: string[];
  fontOnly: boolean;
  fallbackReason?: "layout" | "length";
};
export type HandwritingIssue = "sign-in" | "unavailable" | "not-ready" | null;

export function readyHandwriting(items: DatasetSummary[]) {
  return items.filter(item => item.status === "approved" && ["complete", "partial"].includes(item.analysisStatus) && item.exportable > 0)
    .sort((a, b) => b.exportable - a.exportable || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function chooseHandwriting(items: DatasetSummary[], choice: HandwritingChoice) {
  const ready = readyHandwriting(items);
  return choice === "font" ? undefined : choice === "auto" ? ready[0] : ready.find(item => item.id === choice);
}

export class HandwritingAccessError extends Error {
  readonly status: number;
  constructor(status: number) { super("Handwriting is unavailable."); this.status = status; }
}

/** Reuse the existing local/dev authorization; never expose the dataset publicly. */
async function authorizedFetch(url: string, token: string, signal?: AbortSignal) {
  const options = { cache: "no-store" as const, signal };
  let result = await fetch(url, options);
  if (result.status === 401 || result.status === 403) {
    const login = await fetch("/dev/session", { ...options, method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    if (!login.ok) throw new HandwritingAccessError(login.status);
    result = await fetch(url, options);
  }
  if (!result.ok) throw new HandwritingAccessError(result.status);
  return result;
}

export async function canvasHandwritingCatalog(token: string, signal?: AbortSignal): Promise<DatasetSummary[]> {
  return (await authorizedFetch("/dev/datasets", token, signal)).json();
}

export async function canvasHandwritingDataset(id: string, token: string, signal?: AbortSignal): Promise<WritingDataset> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HandwritingAccessError(404);
  const dataset = await (await authorizedFetch(`/dev/datasets/${id}/writing`, token, signal)).json() as WritingDataset;
  if (!dataset.approved || !["complete", "partial"].includes(dataset.status) || !dataset.glyphs.length) {
    throw new HandwritingAccessError(409);
  }
  return dataset;
}

export function handwritingIssue(error: unknown): HandwritingIssue {
  return error instanceof HandwritingAccessError
    ? [401, 403].includes(error.status) ? "sign-in" : error.status === 409 ? "not-ready" : "unavailable"
    : "unavailable";
}

export function formulaSeed(latex: string): number {
  let value = 2166136261;
  for (const character of latex) value = Math.imul(value ^ character.codePointAt(0)!, 16777619);
  return value >>> 0;
}
