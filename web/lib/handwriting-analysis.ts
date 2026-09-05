import type { Candidate } from "./handwriting-dataset.ts";

export const ANALYSIS_SETTINGS = {
  version: "contour-medoid-v1",
  height: 128,
  width: 128,
  wideWidth: 256,
  wideLabels: ["\\sin", "\\cos", "dx", "dy"],
  padding: 16,
  maxShift: 6,
  trimThreshold: 0.12,
  contourThreshold: 0.25,
  maxInputPixels: 4_000_000,
  maxSamplesPerSymbol: 64,
} as const;

export type AnalysisStatus = "not-run" | "running" | "complete" | "partial" | "stale";
export const analysisLabels: Record<AnalysisStatus, string> = {
  "not-run": "Not analyzed", running: "Analyzing", complete: "Analyzed", partial: "Incomplete", stale: "Outdated",
};
export type NormalizedSample = {
  id: string;
  source: Candidate["source"];
  originalSize: [number, number];
  inkBox: [number, number, number, number];
  scale: number;
  offset: [number, number];
  shift: [number, number];
  distance: number;
  centered: string;
  aligned: string;
};
export type SymbolAnalysis = {
  status: "complete";
  width: number;
  height: number;
  heatmap: { centered: string; aligned: string };
  density: { centered: string; aligned: string };
  medoid: { id: string; image: string; meanDistance: number };
  samples: NormalizedSample[];
} | { status: "failed"; error: string };
export type AnalysisSymbol = { latex: string; count: number; result?: SymbolAnalysis };
export type AnalysisRecord = {
  schemaVersion: 1;
  key: string;
  datasetId: string;
  sourceVersion: number;
  approvedAt: string;
  settings: typeof ANALYSIS_SETTINGS;
  computedAt: string;
  status: "complete" | "partial";
  symbols: AnalysisSymbol[];
};
