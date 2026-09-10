/** Synthetic browser fixture. All Dev requests stay in memory; no account or database is used. */
import React from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import { DatasetLibrary } from "../components/handwriting-library";
import { HandwritingReview } from "../components/handwriting-review";
import { HandwritingAnalysis } from "../components/handwriting-analysis";
import { HandwritingSymbol } from "../components/handwriting-symbol";
import { HandwritingWriting } from "../components/handwriting-writing";
import { DevWorkspace } from "../components/dev-workspace";
import { useLocation } from "./dev-ui-router";
import { approveDataset, acceptPending, datasetStats, decide, freshReview, undoDecision, type CandidateDataset, type Review } from "../lib/handwriting-dataset";
import type { GlyphExperiment } from "../lib/handwriting-experiment";

const image = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><path d="M32 24L90 104M90 24L32 104" fill="none" stroke="#222" stroke-width="7" stroke-linecap="round"/></svg>');
const contextImage = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><text x="20" y="64" font-family="serif" font-size="42">x + y = 2</text></svg>');
const datasets = ["a", "b"].map((letter, index) => {
  const id = letter.repeat(64), dataset: CandidateDataset = { schemaVersion: 1, kind: "handwriting-candidates", name: index ? "Demo · Pending samples" : "Demo · Algebra", samples: Array.from({ length: 80 }, (_, i) => ({
    id: `sample-${i}`, latex: ["x", "y", "1", "2"][i % 4], image, context: contextImage,
    source: { file: "synthetic.pdf", sha256: "0".repeat(64), page: i + 1, pageWidth: 400, pageHeight: 300, box: [0, 0, 128, 128] },
  })) };
  const review: Review = index ? freshReview() : { ...acceptPending(dataset, freshReview()), approvedAt: new Date().toISOString() };
  if (!index) review.inspectedRevision = review.revision;
  return { id, dataset, review, version: 1, publicationId: "" };
});
const experiments = new Map<string, GlyphExperiment>();
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  if (!url.pathname.startsWith("/dev/")) return originalFetch(input, init);
  await new Promise(resolve => setTimeout(resolve, 180));
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const summary = (item: typeof datasets[number]) => ({ id: item.id, name: item.dataset.name, ownerName: "Demo", updatedAt: String(item.version), createdAt: "2026-09-11", ...datasetStats(item.dataset, item.review), total: item.dataset.samples.length, status: item.review.approvedAt ? "approved" : "in-progress", analysisStatus: item.review.approvedAt ? "complete" : "not-run", publicationId: item.publicationId || undefined });
  if (url.pathname === "/dev/datasets") return Response.json(datasets.map(summary));
  const item = datasets.find(value => url.pathname.split("/")[3] === value.id);
  if (!item) return Response.json({ error: "Dataset not found" }, { status: 404 });
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const stats = datasetStats(item.dataset, item.review);
  const symbols = stats.eligible.map(group => {
    const samples = item.dataset.samples.filter(sample => sample.latex === group.latex).map(sample => ({ id: sample.id, source: sample.source, centered: image, aligned: image, originalSize: [128, 128], inkBox: [0, 0, 128, 128], scale: 1, offset: [0, 0], shift: [0, 0], distance: 0 }));
    return { latex: group.latex, count: group.accepted, result: { status: "complete", width: 128, height: 128, heatmap: { centered: image, aligned: image }, medoid: { id: samples[0].id, image, meanDistance: 0 }, samples } };
  });
  if (url.pathname.endsWith("/analysis")) return Response.json({ id: item.id, name: item.dataset.name, approved: !!item.review.approvedAt, sourceVersion: item.version, status: item.review.approvedAt ? "complete" : "not-run", computedAt: "fixture-1", symbols: item.review.approvedAt ? symbols : [], publicationId: item.publicationId || undefined });
  if (url.pathname.endsWith("/writing")) return Response.json({ id: item.id, name: item.dataset.name, approved: !!item.review.approvedAt, status: item.review.approvedAt ? "complete" : "not-run", sourceVersion: item.version, glyphs: item.review.approvedAt ? symbols.map(symbol => ({ latex: symbol.latex, medoidId: symbol.result.medoid.id, width: 128, height: 128, image })) : [] });
  if (url.pathname.endsWith("/experiment")) {
    const latex = body?.latex ?? url.searchParams.get("latex"), alignment = body?.alignment ?? url.searchParams.get("alignment"), key = item.id + latex + alignment;
    const points = [{ id: "p1", x: 32, y: 24, kind: "endpoint" as const, movable: true }, { id: "p2", x: 90, y: 104, kind: "endpoint" as const, movable: false }];
    const experiment = experiments.get(key) ?? { algorithm: "synthetic", latex, sourceVersion: item.version, alignment, analysisKey: "fixture", revision: 0, width: 128, height: 128, config: { threshold: .5, points, augmentation: { strength: 5, radius: 32, count: 3, direction: "free", seed: 1 } }, autoPoints: points, thresholdImage: image, shapeImage: image, variants: [] } as GlyphExperiment;
    if (body) {
      if (body.expectedRevision !== experiment.revision) return Response.json({ error: "Experiment changed. Reload." }, { status: 409 });
      experiment.config = body.config; experiment.revision++;
      if (body.action === "generate") { experiment.generatedWith = body.config; experiment.variants = Array.from({ length: body.config.augmentation.count }, (_, index) => ({ image, seed: index + body.config.augmentation.seed, targets: [] })); }
      experiments.set(key, experiment);
    }
    return Response.json(experiment);
  }
  if (url.pathname.endsWith("/publish")) { item.publicationId = "synthetic-publication"; return Response.json(summary(item)); }
  if (body) {
    if (body.expectedVersion !== item.version) return Response.json({ error: "Dataset changed. Reload." }, { status: 409 });
    let selectedId;
    if (body.type === "decide") item.review = decide(item.review, item.dataset.samples.find(sample => sample.id === body.sampleId)!, body.status, body.latex, undefined, body.issue);
    if (body.type === "undo") { const undone = undoDecision(item.review)!; item.review = undone.review; selectedId = undone.id; }
    if (body.type === "accept-all") item.review = acceptPending(item.dataset, item.review);
    if (body.type === "approve") item.review = approveDataset(item.dataset, { ...item.review, inspectedRevision: item.review.revision });
    item.version++; return Response.json({ review: item.review, version: item.version, selectedId });
  }
  return Response.json({ ...item, name: item.dataset.name, fingerprint: item.id });
};

function Fixture() {
  const href = useLocation(), url = new URL(href, location.origin), parts = url.pathname.split("/");
  let content: React.ReactNode;
  if (parts[2] === "writing") content = <HandwritingWriting initialDataset={url.searchParams.get("dataset") ?? undefined} />;
  else if (parts[2] === "dataset" && parts[4] === "samples") content = <HandwritingReview key={href} datasetId={parts[3]} initialSymbol={url.searchParams.get("symbol") ?? undefined} initialSample={url.searchParams.get("sample") ?? undefined} />;
  else if (parts[2] === "dataset" && parts[4] === "symbols" && parts[5]) content = <HandwritingSymbol key={href} datasetId={parts[3]} symbol={decodeURIComponent(parts[5])} />;
  else if (parts[2] === "dataset" && parts[4] === "symbols") content = <HandwritingAnalysis key={href} datasetId={parts[3]} />;
  else content = <DatasetLibrary />;
  return <DevWorkspace>{content}</DevWorkspace>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Fixture /></React.StrictMode>);
