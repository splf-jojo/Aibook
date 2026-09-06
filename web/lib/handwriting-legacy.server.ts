import katex from "katex";
import { LibraryError } from "./handwriting-errors.ts";
import { parseDataset, datasetFingerprint, exportDataset, MIN_EXAMPLES, type CandidateDataset, type Decision, type Review } from "./handwriting-dataset.ts";
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new LibraryError("Invalid dataset format.");
  return input as Record<string, unknown>;
}
function date(input: unknown): string {
  if (typeof input !== "string" || !Number.isFinite(Date.parse(input))) throw new LibraryError("Invalid review date.");
  return input;
}
function validLatex(value: string) {
  try { katex.renderToString(value, { throwOnError: true, trust: false, strict: "error", maxExpand: 100, maxSize: 5 }); }
  catch { throw new LibraryError("Invalid LaTeX. Correct the label before continuing."); }
}
function candidates(input: unknown) {
  let result: CandidateDataset;
  try { result = parseDataset(input); } catch (error) { throw new LibraryError((error as Error).message); }
  for (const item of result.samples) validLatex(item.latex);
  return result;
}
/** Original exports omit rejected crops, so restore against their exact candidate pack. */
export async function restoreApproved(input: unknown, source: unknown): Promise<{ dataset: CandidateDataset; review: Review }> {
  const raw = record(input), dataset = candidates(source);
  if (raw.schemaVersion !== dataset.schemaVersion || raw.kind !== "handwriting-reviewed-dataset" || raw.minimumExamples !== MIN_EXAMPLES
    || raw.representation !== (dataset.schemaVersion === 2 ? "pencilkit-cells" : "pdf-crops")
    || raw.coordinateSystem !== (dataset.schemaVersion === 2 ? "page-points-top-left" : "pdf-points-top-left")
    || raw.sourceFingerprint !== await datasetFingerprint(dataset) || !Array.isArray(raw.decisions)
    || !Number.isSafeInteger(raw.reviewRevision) || Number(raw.reviewRevision) < 0) {
    throw new LibraryError("The approved file does not match its source candidates.");
  }
  const ids = new Set(dataset.samples.map((sample) => sample.id));
  const decisions: Record<string, Decision> = {};
  for (const value of raw.decisions) {
    const item = record(value);
    if (typeof item.id !== "string" || !ids.has(item.id) || decisions[item.id]
      || !["accepted", "rejected"].includes(String(item.status)) || typeof item.latex !== "string"
      || !item.latex.trim() || item.latex.length > 80 || /[\u0000-\u001f]/.test(item.latex)
      || (item.issue !== undefined && (item.status !== "rejected" || !["incorrect-outline", "incorrect-symbol"].includes(String(item.issue))))) {
      throw new LibraryError("Invalid review decisions.");
    }
    validLatex(item.latex);
    decisions[item.id] = { status: item.status as Decision["status"], latex: item.latex,
      reviewedAt: date(item.reviewedAt), ...(item.issue ? { issue: item.issue as Decision["issue"] } : {}) };
  }
  if (Object.keys(decisions).length !== ids.size) throw new LibraryError("The review is missing candidate decisions.");
  const review: Review = { decisions, history: [], revision: Number(raw.reviewRevision),
    inspectedRevision: Number(raw.reviewRevision), approvedAt: date(raw.approvedAt) };
  let expected;
  try { expected = exportDataset({ dataset, fingerprint: String(raw.sourceFingerprint), review }); }
  catch (error) { throw new LibraryError((error as Error).message); }
  const exported = candidates({ ...raw, kind: "handwriting-candidates" });
  const actualSamples = new Map(exported.samples.map((sample) => [sample.id, sample]));
  const rawSamples = new Map((raw.samples as unknown[]).map((value) => { const item = record(value); return [item.id, item]; }));
  if (expected.samples.length !== exported.samples.length || expected.samples.some(({ reviewedAt, ...sample }) =>
    JSON.stringify(actualSamples.get(sample.id)) !== JSON.stringify(sample) || rawSamples.get(sample.id)?.reviewedAt !== reviewedAt)
    || JSON.stringify(raw.excludedSymbols) !== JSON.stringify(expected.excludedSymbols)) {
    throw new LibraryError("The approved samples do not match the saved decisions.");
  }
  return { dataset, review };
}
