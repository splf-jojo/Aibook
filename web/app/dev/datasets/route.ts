import { checkDevRequest, requestIdentity } from "@/lib/handwriting-access.server";
import { catalog, createDataset, LibraryError } from "@/lib/handwriting-store.server";
import { failure, json, readJson } from "@/lib/handwriting-http.server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  try { return json(await catalog(await requestIdentity(request, true))); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  try {
    const body = await readJson(request) as { dataset?: unknown };
    if (!body || !body.dataset) throw new LibraryError("Choose a candidate dataset.");
    if ((body.dataset as { kind?: string }).kind !== "handwriting-candidates") throw new LibraryError("Add an unreviewed candidate file. Approved exports require their original candidates.");
    return json(await createDataset(body.dataset, await requestIdentity(request, true)));
  } catch (error) { return failure(error); }
}
