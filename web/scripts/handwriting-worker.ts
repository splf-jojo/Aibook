import { setTimeout as delay } from "node:timers/promises";
import { pool, transaction, storeBlobs, restoreBlobs } from "../lib/handwriting-db.server.ts";
import { analyzeSymbol } from "../lib/handwriting-analysis.server.ts";
import { ANALYSIS_SETTINGS, type AnalysisRecord } from "../lib/handwriting-analysis.ts";
import { datasetStats, type CandidateDataset, type Review } from "../lib/handwriting-dataset.ts";

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
// A session advisory lock limits all worker replicas to one analysis at a time.
// A crash releases it; its successor safely requeues interrupted jobs.
const lock = await pool.connect();
lock.on("error", () => process.exit(1));
while (!(await lock.query("SELECT pg_try_advisory_lock(71620391) AS acquired")).rows[0].acquired) {
  if (stopping) { lock.release(); await pool.end(); process.exit(0); }
  await delay(3000);
}
await lock.query("UPDATE handwriting_jobs SET status='queued',updated_at=now() WHERE status='running'");
console.log("Handwriting worker ready.");
while (!stopping) {
  const job = await transaction(async client => {
    const row = (await client.query("SELECT * FROM handwriting_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
    if (!row) return null;
    await client.query("UPDATE handwriting_jobs SET status='running',error=NULL,updated_at=now() WHERE id=$1", [row.id]);
    return row;
  });
  if (!job) { await delay(1500); continue; }
  try {
    const row = (await pool.query("SELECT * FROM handwriting_datasets WHERE id=$1", [job.dataset_id])).rows[0];
    if (!row || row.version !== job.source_version || !row.review.approvedAt) throw new Error("The review changed. Approve it again, then reanalyze.");
    const dataset = await restoreBlobs<CandidateDataset>(row.id, row.candidates), review = row.review as Review;
    const groups = datasetStats(dataset, review).eligible, symbols: AnalysisRecord["symbols"] = [], deadline = Date.now() + 120000;
    if (!groups.length) throw new Error("No symbols have enough accepted samples.");
    let completed = 0;
    await pool.query("UPDATE handwriting_jobs SET progress=$2,updated_at=now() WHERE id=$1", [job.id, { completed, total: groups.length }]);
    for (const group of groups) {
      const samples = dataset.samples.filter(sample => review.decisions[sample.id]?.status === "accepted" && review.decisions[sample.id].latex === group.latex);
      try {
        if (Date.now() > deadline) throw new Error("Analysis time limit reached. Try a smaller dataset.");
        symbols.push({ latex: group.latex, count: samples.length, result: await analyzeSymbol(group.latex, samples) });
      } catch (error) {
        symbols.push({ latex: group.latex, count: samples.length, result: { status: "failed", error: error instanceof Error ? error.message : "Could not analyze this symbol." } });
      }
      await pool.query("UPDATE handwriting_jobs SET progress=$2,updated_at=now() WHERE id=$1", [job.id, { completed: ++completed, total: groups.length }]);
    }
    const result: AnalysisRecord = { schemaVersion: 1, key: job.id, datasetId: row.id, sourceVersion: job.source_version,
      approvedAt: review.approvedAt!, settings: ANALYSIS_SETTINGS, computedAt: new Date().toISOString(),
      status: symbols.every(symbol => symbol.result?.status === "complete") ? "complete" : "partial", symbols };
    await transaction(async client => {
      const stored = await storeBlobs(client, row.id, result);
      await client.query("UPDATE handwriting_jobs SET status=$2,result=$3,updated_at=now() WHERE id=$1", [job.id, result.status, stored]);
    });
    console.log(`Analysis ${job.id}: ${result.status}.`);
  } catch (error) {
    await pool.query("UPDATE handwriting_jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1", [job.id, error instanceof Error ? error.message : "Analysis failed."]);
    console.error(`Analysis ${job.id} failed.`);
  }
}
await lock.query("SELECT pg_advisory_unlock(71620391)");
lock.release();
await pool.end();
