import { checkDevRequest, requestIdentity } from "@/lib/handwriting-access.server";
import { publishDataset } from "@/lib/handwriting-store.server";
import { failure, json, readJson } from "@/lib/handwriting-http.server";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await checkDevRequest(request); if (denied) return denied;
  try {
    const body = await readJson(request, 1024) as { expectedVersion?: unknown };
    return json(await publishDataset((await context.params).id, body?.expectedVersion, await requestIdentity(request, true)));
  } catch (error) { return failure(error); }
}
