import { createHash } from "node:crypto";
import pg from "pg";
import { LibraryError } from "./handwriting-errors.ts";

const shared = globalThis as typeof globalThis & { handwritingPool?: pg.Pool };
export const pool = shared.handwritingPool ??= new pg.Pool({
  ...(process.env.HANDWRITING_DATABASE_URL ? { connectionString: process.env.HANDWRITING_DATABASE_URL } : {}),
  max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
});
export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export async function transaction<T>(body: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await body(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

type BlobReference = { $handwritingBlob: string; mime: string };
/** Binary values live in bytea. JSON stores references; never accept client references. */
export async function storeBlobs(client: pg.PoolClient, datasetId: string, value: unknown): Promise<unknown> {
  if (typeof value === "string" && value.startsWith("data:")) {
    const match = /^data:(image\/png|application\/x-pencilkit);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
    if (!match) throw new LibraryError("Unsupported embedded file.");
    const data = Buffer.from(match[2], "base64"), sha = hash(data);
    await client.query("INSERT INTO handwriting_assets(dataset_id,sha256,mime,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [datasetId, sha, match[1], data]);
    return { $handwritingBlob: sha, mime: match[1] } satisfies BlobReference;
  }
  if (Array.isArray(value)) {
    const result = []; for (const item of value) result.push(await storeBlobs(client, datasetId, item)); return result;
  }
  if (value && typeof value === "object") {
    if ("$handwritingBlob" in value) throw new LibraryError("Invalid embedded file reference.");
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new LibraryError("Invalid object key.");
      result[key] = await storeBlobs(client, datasetId, item);
    }
    return result;
  }
  return value;
}

export async function restoreBlobs<T>(datasetId: string, value: unknown): Promise<T> {
  const refs = new Set<string>();
  function collect(item: unknown) {
    if (!item || typeof item !== "object") return;
    if ("$handwritingBlob" in item) refs.add(String(item.$handwritingBlob));
    else Object.values(item).forEach(collect);
  }
  collect(value);
  const { rows } = refs.size ? await pool.query("SELECT sha256,mime,data FROM handwriting_assets WHERE dataset_id=$1 AND sha256=ANY($2::text[])", [datasetId, [...refs]]) : { rows: [] };
  const blobs = new Map(rows.map(row => [row.sha256, `data:${row.mime};base64,${row.data.toString("base64")}`]));
  function restore(item: unknown): unknown {
    if (!item || typeof item !== "object") return item;
    if ("$handwritingBlob" in item) {
      const data = blobs.get(item.$handwritingBlob);
      if (!data) throw new Error("Dataset asset missing.");
      return data;
    }
    if (Array.isArray(item)) return item.map(restore);
    return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, restore(value)]));
  }
  return restore(value) as T;
}
