import type { Decision, Review, ReviewSession } from "./handwriting-dataset.ts";
import type { AnalysisStatus, AnalysisSymbol } from "./handwriting-analysis.ts";
import type { WritingDataset } from "./handwriting-writing.ts";

export type DatasetSummary = {
  ownerId?: string;
  ownerName?: string;
  publicationId?: string;
  datasetId?: string;
  sourceVersion?: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  exportable: number;
  status: "unreviewed" | "in-progress" | "reviewed" | "approved";
  analysisStatus: AnalysisStatus;
};

export type LibrarySession = ReviewSession & { name: string; version: number };
export type ReviewCommand =
  | { type: "decide"; sampleId: string; status: Decision["status"]; latex: string; issue?: Decision["issue"] }
  | { type: "undo" }
  | { type: "approve" }
;
export type ReviewAction = ReviewCommand & { expectedVersion: number };
export type ReviewUpdate = { review: Review; version: number; selectedId?: string };
export type AnalysisPreview = {
  error?: string; publicationId?: string;
  id: string; name: string; approved: boolean; sourceVersion: number; status: AnalysisStatus;
  symbols: AnalysisSymbol[]; computedAt?: string; progress?: { completed: number; total: number };
};

async function response<T>(result: Response): Promise<T> {
  const body = await result.json().catch(() => null);
  if (typeof window !== "undefined" && (result.status === 401 || result.status === 403)) window.dispatchEvent(new Event("dev-session-expired"));
  if (!result.ok) throw new Error(body?.error ?? "Request failed. Try again.");
  return body as T;
}

export const listDatasets = () => fetch("/dev/datasets", { cache: "no-store" }).then(response<DatasetSummary[]>);
export const loadDataset = (id: string) => fetch(`/dev/datasets/${id}`, { cache: "no-store" }).then(response<LibrarySession>);
export const loadAnalysis = (id: string) => fetch(`/dev/datasets/${id}/analysis`, { cache: "no-store" }).then(response<AnalysisPreview>);
export const loadWritingDataset = (id: string, signal?: AbortSignal) => fetch(`/dev/datasets/${id}/writing`, { cache: "no-store", signal }).then(response<WritingDataset>);
export const startAnalysis = (id: string, expectedVersion: number) => fetch(`/dev/datasets/${id}/analysis`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion }),
}).then(response<AnalysisPreview>);
export const publishDataset = (id: string, expectedVersion: number) => fetch(`/dev/datasets/${id}/publish`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion }),
}).then(response<DatasetSummary>);
export const importDataset = (dataset: unknown) => fetch("/dev/datasets", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset }),
}).then(response<DatasetSummary>);
export const updateReview = (id: string, action: ReviewAction) => fetch(`/dev/datasets/${id}`, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
}).then(response<ReviewUpdate>);
