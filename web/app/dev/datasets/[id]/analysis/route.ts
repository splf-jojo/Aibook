import { checkDevRequest, requestIdentity } from "@/lib/handwriting-access.server";
import { analysisPreview, runAnalysis } from "@/lib/handwriting-store.server";
import { failure, json, readJson } from "@/lib/handwriting-http.server";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  try { return json(await analysisPreview((await context.params).id, await requestIdentity(request, true))); } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  try {
    const body = await readJson(request, 1024) as { expectedVersion?: unknown } | null;
    return json(await runAnalysis((await context.params).id, body?.expectedVersion, await requestIdentity(request, true)));
  } catch (error) { return failure(error); }
}
