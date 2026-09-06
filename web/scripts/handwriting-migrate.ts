/** Import a backed-up filesystem library into PostgreSQL, without touching sources. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pool, transaction, hash, storeBlobs } from "../lib/handwriting-db.server.ts";
import { datasetFingerprint, parseDataset, datasetStats, freshReview, decide, approveDataset, type Review } from "../lib/handwriting-dataset.ts";
import { datasetSummary } from "../lib/handwriting-store.server.ts";
import { ANALYSIS_SETTINGS, type AnalysisRecord } from "../lib/handwriting-analysis.ts";

const [root, ownerName] = process.argv.slice(2);
if (!root || !ownerName) throw new Error("Usage: handwriting-migrate DIRECTORY OWNER_USERNAME");
const owner = (await pool.query("SELECT id,role FROM users WHERE username=$1", [ownerName])).rows[0];
if (!owner || owner.role !== "dev") throw new Error("The migration owner must be an explicitly granted dev account.");
const read = async (file: string) => JSON.parse(await readFile(file, "utf8"));
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
  const dir = path.join(root, entry.name), dataset = parseDataset(await read(path.join(dir, "candidates.json")));
  const fingerprint = await datasetFingerprint(dataset);
  if (fingerprint !== entry.name) throw new Error(`Source fingerprint mismatch: ${entry.name}`);
  const state = await read(path.join(dir, "state.json"));
  if (!Number.isSafeInteger(state.version) || state.version < 0 || typeof state.summary?.name !== "string") throw new Error("Invalid saved review version.");
  const review = state.review as Review;
  if (!review || !Number.isSafeInteger(review.revision) || !Array.isArray(review.history) || !review.decisions) throw new Error("Invalid saved review.");
  const ids = new Map(dataset.samples.map(sample => [sample.id, sample]));
  for (const [id, decision] of Object.entries(review.decisions)) {
    const sample = ids.get(id);
    if (!sample || !["accepted", "rejected"].includes(decision.status) || !Number.isFinite(Date.parse(decision.reviewedAt))) throw new Error("Invalid review decision.");
    decide(freshReview(), sample, decision.status, decision.latex, decision.reviewedAt, decision.issue);
  }
  if (review.approvedAt) approveDataset(dataset, review, review.approvedAt);
  let originalApproval: unknown;
  try { originalApproval = await read(path.join(dir, "original-approved.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let analysis: AnalysisRecord | undefined;
  try {
    const index = await read(path.join(dir, "analysis", "index.json"));
    if (!/^[a-f0-9]{64}$/.test(index.key)) throw new Error("Invalid analysis key.");
    if (review.approvedAt && index.sourceVersion === state.version && ["complete", "partial"].includes(index.status)) {
      analysis = await read(path.join(dir, "analysis", `${index.key}.json`));
      if (analysis!.sourceVersion !== state.version || analysis!.approvedAt !== review.approvedAt || analysis!.datasetId !== entry.name) throw new Error("Analysis provenance mismatch.");
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const id = hash(`${owner.id}:${fingerprint}`), summary = datasetSummary(id, state.summary.name, dataset, review, state.summary.createdAt);
  const imported = await transaction(async client => {
    const insert = await client.query("INSERT INTO handwriting_datasets(id,owner_id,fingerprint,name,candidates,review,version,summary,created_at,updated_at) VALUES($1,$2,$3,$4,'{}',$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id", [id, owner.id, fingerprint, summary.name, review, state.version, { ...summary, updatedAt: state.summary.updatedAt }, state.summary.createdAt, state.summary.updatedAt]);
    if (!insert.rowCount) return false;
    const candidates = await storeBlobs(client, id, dataset);
    const original = await storeBlobs(client, id, { migration: { legacyId: entry.name, state, ...(originalApproval ? { originalApproval } : {}) } });
    await client.query("UPDATE handwriting_datasets SET candidates=$2,source=$3 WHERE id=$1", [id, candidates, original]);
    if (analysis) {
      const key = hash(`${id}:${state.version}:${JSON.stringify(ANALYSIS_SETTINGS)}`);
      const result = await storeBlobs(client, id, { ...analysis, key, datasetId: id });
      await client.query("INSERT INTO handwriting_jobs(id,dataset_id,source_version,status,result,progress) VALUES($1,$2,$3,$4,$5,$6)", [key, id, state.version, analysis.status, result, { completed: analysis.symbols.length, total: analysis.symbols.length }]);
    }
    return true;
  });
  console.log(`${imported ? "Imported" : "Already present"}: ${entry.name} -> ${id} (${dataset.samples.length} samples; ${datasetStats(dataset, review).accepted} accepted).`);
}
await pool.end();
