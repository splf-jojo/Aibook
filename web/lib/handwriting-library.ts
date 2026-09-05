import type { Decision, Review, ReviewSession } from "./handwriting-dataset.ts";
import type { AnalysisStatus, AnalysisSymbol } from "./handwriting-analysis.ts";

export type DatasetSummary = {
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
  id: string; name: string; approved: boolean; sourceVersion: number; status: AnalysisStatus;
  symbols: AnalysisSymbol[]; computedAt?: string; progress?: { completed: number; total: number };
};

async function response<T>(result: Response): Promise<T> {
  const body = await result.json().catch(() => null);
  if (!result.ok) throw new Error(body?.error ?? "Request failed. Try again.");
  return body as T;
}

export const listDatasets = () => fetch("/dev/datasets", { cache: "no-store" }).then(response<DatasetSummary[]>);
export const loadDataset = (id: string) => fetch(`/dev/datasets/${id}`, { cache: "no-store" }).then(response<LibrarySession>);
export const loadAnalysis = (id: string) => fetch(`/dev/datasets/${id}/analysis`, { cache: "no-store" }).then(response<AnalysisPreview>);
export const startAnalysis = (id: string, expectedVersion: number) => fetch(`/dev/datasets/${id}/analysis`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion }),
}).then(response<AnalysisPreview>);
export const importDataset = (dataset: unknown) => fetch("/dev/datasets", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset }),
}).then(response<DatasetSummary>);
export const updateReview = (id: string, action: ReviewAction) => fetch(`/dev/datasets/${id}`, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
}).then(response<ReviewUpdate>);
