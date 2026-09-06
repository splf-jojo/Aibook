import katex from "katex";
import { pool, transaction, hash, storeBlobs, restoreBlobs } from "./handwriting-db.server.ts";
import { readCandidateDataset } from "./handwriting-candidates.server.ts";
import { LibraryError } from "./handwriting-errors.ts";
import type { Identity } from "./handwriting-access.server.ts";
import { approveDataset, datasetFingerprint, datasetStats, decide, freshReview, parseDataset, undoDecision, type CandidateDataset, type Decision, type Review } from "./handwriting-dataset.ts";
import { ANALYSIS_SETTINGS } from "./handwriting-analysis.ts";
import type { AnalysisRecord } from "./handwriting-analysis.ts";
import type { AnalysisPreview, DatasetSummary, LibrarySession, ReviewUpdate } from "./handwriting-library.ts";
import type { WritingDataset } from "./handwriting-writing.ts";
export { LibraryError } from "./handwriting-errors.ts";

export function requireDev(actor: Identity) {
  if (actor.role !== "dev") throw new LibraryError("A dev account is required.", 403);
}
function validLatex(value: string) {
  try { katex.renderToString(value, { throwOnError: true, trust: false, strict: "error", maxExpand: 100, maxSize: 5 }); }
  catch { throw new LibraryError("Invalid LaTeX. Correct the label before continuing."); }
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new LibraryError("Invalid dataset format.");
  return input as Record<string, unknown>;
}
export function datasetSummary(id: string, name: string, dataset: CandidateDataset, review: Review, createdAt: string): DatasetSummary {
  const stats = datasetStats(dataset, review);
  return { id, name, createdAt, updatedAt: new Date().toISOString(), total: dataset.samples.length,
    accepted: stats.accepted, rejected: stats.rejected, pending: stats.pending, exportable: stats.exportable,
    status: review.approvedAt ? "approved" : !stats.pending ? "reviewed" : stats.pending === dataset.samples.length ? "unreviewed" : "in-progress",
    analysisStatus: "not-run" };
}
export async function datasetRow(id: string, actor: Identity) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new LibraryError("Dataset not found.", 404);
  const { rows } = await pool.query("SELECT d.*,u.username AS owner_name FROM handwriting_datasets d JOIN users u ON u.id=d.owner_id WHERE d.id=$1 AND ($2='dev' OR d.owner_id=$3)", [id, actor.role, actor.id]);
  if (!rows[0]) throw new LibraryError("Dataset not found.", 404);
  return rows[0];
}

/** Each export is an immutable source snapshot; retries are scoped to its owner. */
export async function createDataset(input: unknown, actor: Identity, source?: unknown): Promise<DatasetSummary> {
  let dataset: CandidateDataset;
  try { dataset = parseDataset(input); } catch (error) { throw new LibraryError((error as Error).message); }
  for (const sample of dataset.samples) validLatex(sample.latex);
  if (dataset.schemaVersion === 2) {
    const archive = record(source);
    if (typeof archive.drawing !== "string" || !/^data:application\/x-pencilkit;base64,[A-Za-z0-9+/]+={0,2}$/.test(archive.drawing)
      || typeof archive.worksheetId !== "string" || archive.worksheetId.length > 100
      || typeof archive.configuration !== "object" || !archive.configuration || !Array.isArray(archive.cells)
      || archive.cells.length > 10000 || !Number.isFinite(archive.renderScale) || Number(archive.renderScale) <= 0) throw new LibraryError("Missing PencilKit archive or worksheet geometry.");
    const digest = hash(Buffer.from(archive.drawing.split(",")[1], "base64"));
    if (dataset.samples.some(sample => sample.source.sha256 !== digest)) throw new LibraryError("The samples do not match the PencilKit archive.");
  }
  const fingerprint = await datasetFingerprint(dataset), id = hash(`${actor.id}:${fingerprint}`), review = freshReview();
  return transaction(async client => {
    const summary = datasetSummary(id, dataset.name, dataset, review, new Date().toISOString());
    // Reserve the identity first; conflict never overwrites review, assets or source.
    const inserted = await client.query("INSERT INTO handwriting_datasets(id,owner_id,fingerprint,name,candidates,review,summary) VALUES($1,$2,$3,$4,'{}',$5,$6) ON CONFLICT(owner_id,fingerprint) DO NOTHING RETURNING id", [id, actor.id, fingerprint, dataset.name, review, summary]);
    if (!inserted.rowCount) return (await client.query("SELECT summary FROM handwriting_datasets WHERE owner_id=$1 AND fingerprint=$2", [actor.id, fingerprint])).rows[0].summary;
    const candidates = await storeBlobs(client, id, dataset);
    const original = source ? await storeBlobs(client, id, source) : null;
    await client.query("UPDATE handwriting_datasets SET candidates=$2,source=$3 WHERE id=$1", [id, candidates, original]);
    return summary;
  });
}

export async function catalog(actor: Identity): Promise<DatasetSummary[]> {
  const { rows } = await pool.query(`SELECT d.summary, d.owner_id, u.username, j.status AS analysis_status,
    (SELECT p.id FROM handwriting_publications p WHERE p.dataset_id=d.id AND p.source_version=d.version) AS publication_id
    FROM handwriting_datasets d JOIN users u ON u.id=d.owner_id
    LEFT JOIN handwriting_jobs j ON j.dataset_id=d.id AND j.source_version=d.version
    WHERE $1='dev' OR d.owner_id=$2 ORDER BY d.created_at DESC`, [actor.role, actor.id]);
  return rows.map(row => ({ ...row.summary, ownerId: row.owner_id, ownerName: row.username,
    analysisStatus: row.analysis_status ?? "not-run", publicationId: row.publication_id ?? undefined }));
}
export async function readDataset(id: string, actor: Identity): Promise<LibrarySession> {
  const row = await datasetRow(id, actor);
  return { fingerprint: row.fingerprint, name: row.name, dataset: await readCandidateDataset(id, row.candidates), review: row.review, version: row.version };
}
export async function readSource(id: string, actor: Identity) {
  const row = await datasetRow(id, actor);
  return row.source ? restoreBlobs(id, row.source) : null;
}

export async function applyReviewAction(id: string, input: unknown, actor: Identity): Promise<ReviewUpdate> {
  requireDev(actor);
  const action = record(input), session = await readDataset(id, actor);
  if (!Number.isSafeInteger(action.expectedVersion) || action.expectedVersion !== session.version) throw new LibraryError("This dataset changed in another tab. Reload before continuing.", 409);
  let review: Review, selectedId: string | undefined;
  if (action.type === "decide") {
    const sample = session.dataset.samples.find(item => item.id === action.sampleId);
    if (!sample || !["accepted", "rejected"].includes(String(action.status)) || typeof action.latex !== "string"
      || (action.issue !== undefined && !["incorrect-outline", "incorrect-symbol"].includes(String(action.issue)))) throw new LibraryError("Invalid review decision.");
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
  const row = await datasetRow(id, actor), version = session.version + 1;
  const summary = datasetSummary(id, session.name, session.dataset, review, row.summary.createdAt);
  const saved = await pool.query("UPDATE handwriting_datasets SET review=$3,version=$4,summary=$5,updated_at=now() WHERE id=$1 AND version=$2 RETURNING id", [id, session.version, review, version, summary]);
  if (!saved.rowCount) throw new LibraryError("This dataset changed in another tab. Reload before continuing.", 409);
  return { review, version, ...(selectedId ? { selectedId } : {}) };
}

export async function analysisPreview(id: string, actor: Identity): Promise<AnalysisPreview> {
  const row = await datasetRow(id, actor);
  const job = (await pool.query("SELECT * FROM handwriting_jobs WHERE dataset_id=$1 AND source_version=$2", [id, row.version])).rows[0];
  const publication = (await pool.query("SELECT id FROM handwriting_publications WHERE dataset_id=$1 AND source_version=$2", [id, row.version])).rows[0];
  const preview: AnalysisPreview = { id, name: row.name, sourceVersion: row.version, approved: Boolean(row.review.approvedAt),
    status: job?.status ?? "not-run", symbols: [], publicationId: publication?.id,
    ...(job?.error ? { error: job.error } : {}), ...(job?.progress ? { progress: job.progress } : {}) };
  if (!preview.approved) return preview;
  if (job?.result && ["complete", "partial"].includes(job.status)) {
    const result = await restoreBlobs<AnalysisRecord>(id, job.result);
    return { ...preview, symbols: result.symbols, computedAt: result.computedAt };
  }
  const dataset = await readCandidateDataset(id, row.candidates);
  return { ...preview, symbols: datasetStats(dataset, row.review).eligible.map(group => ({ latex: group.latex, count: group.accepted })) };
}
export async function runAnalysis(id: string, expectedVersion: unknown, actor: Identity): Promise<AnalysisPreview> {
  requireDev(actor);
  await transaction(async client => {
    const row = (await client.query("SELECT * FROM handwriting_datasets WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new LibraryError("Dataset not found.", 404);
    if (!Number.isSafeInteger(expectedVersion) || row.version !== expectedVersion) throw new LibraryError("This dataset changed. Reload before analyzing.", 409);
    if (!row.review.approvedAt) throw new LibraryError("Approve this dataset before analysis.", 409);
    const key = hash(`${id}:${row.version}:${JSON.stringify(ANALYSIS_SETTINGS)}`);
    await client.query(`INSERT INTO handwriting_jobs(id,dataset_id,source_version,status) VALUES($1,$2,$3,'queued')
      ON CONFLICT(dataset_id,source_version) DO UPDATE SET status='queued', error=NULL, result=NULL, updated_at=now()
      WHERE handwriting_jobs.status IN ('failed','partial')`, [key, id, row.version]);
  });
  return analysisPreview(id, actor);
}

export async function publishDataset(id: string, expectedVersion: unknown, actor: Identity): Promise<DatasetSummary> {
  requireDev(actor);
  const preview = await analysisPreview(id, actor);
  if (!preview.approved || preview.sourceVersion !== expectedVersion || !["complete", "partial"].includes(preview.status)) throw new LibraryError("Analyze the current approved dataset before publishing.", 409);
  const { writingFromAnalysis } = await import("./handwriting-writing.server.ts");
  const writing = await writingFromAnalysis(preview);
  if (!writing.glyphs.length) throw new LibraryError("No handwriting symbols are ready.", 409);
  return transaction(async client => {
    const row = (await client.query("SELECT * FROM handwriting_datasets WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (row.version !== expectedVersion || !row.review.approvedAt) throw new LibraryError("The review changed. Reload before publishing.", 409);
    const publicationId = hash(`published:${id}:${row.version}`);
    const summary = { ...row.summary, id: publicationId, datasetId: id, sourceVersion: row.version, analysisStatus: preview.status, publicationId };
    const payload = await storeBlobs(client, id, { ...writing, id: publicationId });
    await client.query("INSERT INTO handwriting_publications(id,dataset_id,source_version,published_by,payload,summary) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dataset_id,source_version) DO NOTHING", [publicationId, id, row.version, actor.id, payload, summary]);
    return summary;
  });
}
export async function fontCatalog(): Promise<DatasetSummary[]> {
  // Show the latest publication of each source, while older IDs remain readable.
  return (await pool.query("SELECT DISTINCT ON(dataset_id) summary FROM handwriting_publications ORDER BY dataset_id,source_version DESC")).rows.map(row => row.summary);
}
export async function publishedFont(id: string): Promise<WritingDataset> {
  const row = (await pool.query("SELECT dataset_id,payload FROM handwriting_publications WHERE id=$1", [id])).rows[0];
  if (!row) throw new LibraryError("Published handwriting not found.", 404);
  return restoreBlobs<WritingDataset>(row.dataset_id, row.payload);
}
