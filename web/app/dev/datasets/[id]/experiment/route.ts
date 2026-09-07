import { checkDevRequest, requestIdentity } from "@/lib/handwriting-access.server";
import { readExperiment, saveExperiment } from "@/lib/handwriting-experiment.server";
import { failure, json, readJson } from "@/lib/handwriting-http.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  try {
    const query = new URL(request.url).searchParams;
    return json(await readExperiment((await context.params).id, query.get("latex"), Number(query.get("version")), query.get("alignment"), await requestIdentity(request, true)));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  try { return json(await saveExperiment((await context.params).id, await readJson(request, 16384), await requestIdentity(request, true))); }
  catch (error) { return failure(error); }
}
