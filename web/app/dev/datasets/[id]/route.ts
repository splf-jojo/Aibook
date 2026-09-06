import { checkDevRequest, requestIdentity } from "@/lib/handwriting-access.server";
import { applyReviewAction, readDataset } from "@/lib/handwriting-store.server";
import { failure, json, readJson } from "@/lib/handwriting-http.server";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  try { return json(await readDataset((await context.params).id, await requestIdentity(request, true))); } catch (error) { return failure(error); }
}
export async function PATCH(request: Request, context: Context) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  try { return json(await applyReviewAction((await context.params).id, await readJson(request, 4096), await requestIdentity(request, true))); }
  catch (error) { return failure(error); }
}
