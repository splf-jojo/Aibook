import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool, transaction, storeBlobs } from "../../web/lib/handwriting-db.server.ts";
import { createDataset, datasetSummary } from "../../web/lib/handwriting-store.server.ts";
import { restoreApproved } from "../../web/lib/handwriting-legacy.server.ts";

const [approvedPath, candidatesPath, name, ownerName = "dev"] = process.argv.slice(2);
if (!approvedPath || !candidatesPath) throw new Error('Usage: node scripts/handwriting/import_reviewed.mjs approved.json candidates.json ["Dataset name"] [owner-username]');
const read = async filename => JSON.parse(await readFile(path.resolve(filename), "utf8"));
try {
  const owner = (await pool.query("SELECT id,username,role FROM users WHERE username=$1", [ownerName])).rows[0];
  if (owner?.role !== "dev") throw new Error("An explicitly granted dev account is required.");
  const original = await read(approvedPath), { dataset, review } = await restoreApproved(original, await read(candidatesPath));
  const created = await createDataset(dataset, owner);
  await transaction(async client => {
    const row = (await client.query("SELECT * FROM handwriting_datasets WHERE id=$1 FOR UPDATE", [created.id])).rows[0];
    if (row.version !== 0 || row.review.revision !== 0) throw new Error("This dataset already has a review; it was not overwritten.");
    const summary = datasetSummary(row.id, name ?? dataset.name, dataset, review, row.summary.createdAt);
    if (!summary.name.trim() || summary.name.length > 160) throw new Error("Invalid dataset name.");
    const source = await storeBlobs(client, row.id, { originalApproved: original });
    await client.query("UPDATE handwriting_datasets SET name=$2,review=$3,source=$4,summary=$5,version=1,updated_at=now() WHERE id=$1", [row.id, summary.name, review, source, summary]);
  });
  console.log(`Imported approved review: ${created.id}`);
} finally { await pool.end(); }
