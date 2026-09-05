import { MAX_IMPORT_BYTES } from "./handwriting-dataset.ts";
import { LibraryError } from "./handwriting-store.server.ts";

export async function readJson(request: Request, maxBytes = MAX_IMPORT_BYTES): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new LibraryError("File is too large (40 MB maximum).", 413);
  if (!request.body) throw new LibraryError("Choose a JSON file.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new LibraryError("File is too large (40 MB maximum).", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new LibraryError("Invalid JSON file."); }
}

export function json(value: unknown) { return Response.json(value, { headers: { "Cache-Control": "no-store" } }); }
export function failure(error: unknown) {
  if (error instanceof LibraryError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  console.error("Handwriting library:", error instanceof Error ? error.message : "Storage error");
  return Response.json({ error: "Could not access the dataset folder. Check storage and retry." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
