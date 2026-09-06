import { requestIdentity } from "@/lib/handwriting-access.server";
import { catalog, createDataset, readDataset, readSource, applyReviewAction, analysisPreview, runAnalysis, publishDataset, fontCatalog, publishedFont, LibraryError } from "@/lib/handwriting-store.server";
import { failure, json, readJson } from "@/lib/handwriting-http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  try {
    const actor = await requestIdentity(request);
    const parts = (await context.params).path, [resource, id, action] = parts;
    if (resource === "fonts" && request.method === "GET") {
      if (parts.length === 1) return json(await fontCatalog());
      if (parts.length === 2) return json(await publishedFont(id));
    }
    if (resource === "datasets") {
      if (parts.length === 1) {
        if (request.method === "GET") return json(await catalog(actor));
        if (request.method === "POST") {
          const body = await readJson(request) as { dataset?: unknown; source?: unknown };
          if (!body?.dataset) throw new LibraryError("Choose a candidate dataset.");
          return json(await createDataset(body.dataset, actor, body.source));
        }
      }
      if (parts.length === 2) {
        if (request.method === "GET") return json(await readDataset(id, actor));
        if (request.method === "PATCH") return json(await applyReviewAction(id, await readJson(request, 4096), actor));
      }
      if (parts.length === 3) {
        if (action === "source" && request.method === "GET") return json(await readSource(id, actor));
        if (action === "analysis" && request.method === "GET") return json(await analysisPreview(id, actor));
        if (["analysis", "publish"].includes(action) && request.method === "POST") {
          const body = await readJson(request, 1024) as { expectedVersion?: unknown };
          return json(action === "analysis" ? await runAnalysis(id, body?.expectedVersion, actor) : await publishDataset(id, body?.expectedVersion, actor));
        }
      }
    }
    throw new LibraryError("Not found.", 404);
  } catch (error) { return failure(error); }
}
export { handle as GET, handle as POST, handle as PATCH };
