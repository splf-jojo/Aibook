import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDataset } from "../../web/lib/handwriting-store.server.ts";

const [approvedPath, candidatesPath, name] = process.argv.slice(2);
if (!approvedPath || !candidatesPath) {
  console.error('Usage: node scripts/handwriting/import_reviewed.mjs approved.json candidates.json ["Dataset name"]');
  process.exit(1);
}
process.env.HANDWRITING_DATA_DIR ??= fileURLToPath(new URL("../../data/handwriting/datasets/", import.meta.url));
const read = async (filename) => JSON.parse(await readFile(path.resolve(filename), "utf8"));
const result = await createDataset(await read(approvedPath), { sourceCandidates: await read(candidatesPath), ...(name ? { name } : {}) });
console.log(JSON.stringify(result, null, 2));
