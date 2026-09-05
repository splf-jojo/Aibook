import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import katex from "katex";
import {
  approveDataset, datasetFingerprint, datasetStats, decide, exportDataset, freshReview, MIN_EXAMPLES,
  parseDataset, undoDecision, type CandidateDataset, type Decision, type Review,
} from "./handwriting-dataset.ts";
import type { AnalysisPreview, DatasetSummary, LibrarySession, ReviewUpdate } from "./handwriting-library.ts";

export class LibraryError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

type State = { schemaVersion: 1; summary: DatasetSummary; version: number; review: Review };
// User data is mounted at runtime and must never be traced into the application image.
const root = () => path.resolve(/* turbopackIgnore: true */ process.env.HANDWRITING_DATA_DIR ?? "../data/handwriting/datasets");
const isId = (id: string) => /^[a-f0-9]{64}$/.test(id);
function directory(id: string) {
  if (!isId(id)) throw new LibraryError("Dataset not found.", 404);
  return path.join(/* turbopackIgnore: true */ root(), id);
}
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
function summary(id: string, name: string, dataset: CandidateDataset, review: Review, createdAt: string): DatasetSummary {
  const stats = datasetStats(dataset, review);
  return { id, name, createdAt, updatedAt: new Date().toISOString(), total: dataset.samples.length,
    accepted: stats.accepted, rejected: stats.rejected, pending: stats.pending, exportable: stats.exportable,
    status: review.approvedAt ? "approved" : !stats.pending ? "reviewed" : stats.pending === dataset.samples.length ? "unreviewed" : "in-progress",
    analysisStatus: "not-run" };
}
async function readState(id: string): Promise<State> {
  try { return JSON.parse(await readFile(path.join(directory(id), "state.json"), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new LibraryError("Dataset not found.", 404);
    throw error;
  }
}
async function atomicState(id: string, state: State) {
  const dir = directory(id), temporary = path.join(dir, `.state-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path.join(dir, "state.json"));
  } finally { await rm(temporary, { force: true }); }
}

/** Original exports omit rejected crops, so restore against their exact candidate pack. */
async function restoreApproved(input: unknown, source: unknown): Promise<{ dataset: CandidateDataset; review: Review }> {
  const raw = record(input), dataset = candidates(source);
  if (raw.schemaVersion !== 1 || raw.kind !== "handwriting-reviewed-dataset" || raw.minimumExamples !== MIN_EXAMPLES
    || raw.representation !== "pdf-crops" || raw.coordinateSystem !== "pdf-points-top-left"
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

export async function createDataset(input: unknown, options: { sourceCandidates?: unknown; name?: string } = {}): Promise<DatasetSummary> {
  const raw = record(input);
  const restored = raw.kind === "handwriting-reviewed-dataset"
    ? await restoreApproved(input, options.sourceCandidates)
    : { dataset: candidates(input), review: freshReview() };
  const { dataset, review } = restored;
  const id = await datasetFingerprint(dataset);
  const name = (options.name ?? dataset.name).trim();
  if (!name || name.length > 160 || /[\u0000-\u001f]/.test(name)) throw new LibraryError("Invalid dataset name.");
  await mkdir(root(), { recursive: true });
  try { return (await readState(id)).summary; } catch (error) { if (!(error instanceof LibraryError && error.status === 404)) throw error; }
  const state: State = { schemaVersion: 1, version: 0, review, summary: summary(id, name, dataset, review, new Date().toISOString()) };
  const staging = path.join(root(), `.import-${randomUUID()}`);
  await mkdir(staging);
  try {
    await writeFile(path.join(staging, "candidates.json"), JSON.stringify(dataset), { flag: "wx" });
    await writeFile(path.join(staging, "state.json"), JSON.stringify(state), { flag: "wx" });
    if (raw.kind === "handwriting-reviewed-dataset") await writeFile(path.join(staging, "original-approved.json"), JSON.stringify(input), { flag: "wx" });
    try { await rename(staging, directory(id)); }
    catch (error) {
      // An identical concurrent import must never replace an existing review.
      if (["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) return (await readState(id)).summary;
      throw error;
    }
  } finally {
    if (path.dirname(staging) !== root() || !path.basename(staging).startsWith(".import-")) throw new Error("Invalid import staging path.");
    await rm(staging, { recursive: true, force: true });
  }
  return state.summary;
}

export async function catalog(): Promise<DatasetSummary[]> {
  await mkdir(root(), { recursive: true });
  const entries = await readdir(/* turbopackIgnore: true */ root(), { withFileTypes: true });
  const items = await Promise.all(entries.filter((entry) => entry.isDirectory() && isId(entry.name)).map(async (entry) => (await readState(entry.name)).summary));
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));
}

export async function readDataset(id: string): Promise<LibrarySession> {
  const state = await readState(id);
  const dataset = JSON.parse(await readFile(path.join(directory(id), "candidates.json"), "utf8")) as CandidateDataset;
  return { fingerprint: id, name: state.summary.name, dataset, review: state.review, version: state.version };
}

export async function applyReviewAction(id: string, input: unknown): Promise<ReviewUpdate> {
  const action = record(input), dir = directory(id);
  // Exclusive creation also protects against writes from another Next.js worker.
  let lock;
  try { lock = await open(path.join(dir, ".review.lock"), "wx"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new LibraryError("A save is in progress. Try again.", 409);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new LibraryError("Dataset not found.", 404);
    throw error;
  }
  try {
    const session = await readDataset(id), previous = await readState(id);
    if (!Number.isSafeInteger(action.expectedVersion) || action.expectedVersion !== session.version) {
      throw new LibraryError("This dataset changed in another tab. Reload before continuing.", 409);
    }
    let review: Review, selectedId: string | undefined;
    if (action.type === "decide") {
      const sample = session.dataset.samples.find((item) => item.id === action.sampleId);
      if (!sample || !["accepted", "rejected"].includes(String(action.status)) || typeof action.latex !== "string"
        || (action.issue !== undefined && !["incorrect-outline", "incorrect-symbol"].includes(String(action.issue)))) {
        throw new LibraryError("Invalid review decision.");
      }
      validLatex(action.latex);
      try { review = decide(session.review, sample, action.status as Decision["status"], action.latex, undefined, action.issue as Decision["issue"]); }
      catch (error) { throw new LibraryError((error as Error).message); }
    } else if (action.type === "undo") {
      const undone = undoDecision(session.review);
      if (!undone) throw new LibraryError("No decision to undo.");
      review = undone.review; selectedId = undone.id;
    } else if (action.type === "approve") {
      try { review = approveDataset(session.dataset, { ...session.review, inspectedRevision: session.review.revision }); }
      catch (error) { throw new LibraryError((error as Error).message); }
    } else throw new LibraryError("Unknown review action.");
    const version = session.version + 1;
    await atomicState(id, { ...previous, version, review,
      summary: summary(id, session.name, session.dataset, review, previous.summary.createdAt) });
    return { review, version, ...(selectedId ? { selectedId } : {}) };
  } finally { await lock.close(); await rm(path.join(dir, ".review.lock"), { force: true }); }
}

export async function analysisPreview(id: string): Promise<AnalysisPreview> {
  const session = await readDataset(id), approved = Boolean(session.review.approvedAt);
  return { id, name: session.name, approved, status: "not-run",
    symbols: approved ? datasetStats(session.dataset, session.review).eligible.map((group) => ({ latex: group.latex, count: group.accepted })) : [] };
}
