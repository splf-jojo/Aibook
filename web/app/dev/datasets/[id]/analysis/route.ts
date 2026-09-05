import { checkDevRequest } from "@/lib/handwriting-access.server";
import { analysisPreview } from "@/lib/handwriting-store.server";
import { failure, json } from "@/lib/handwriting-http.server";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = checkDevRequest(request); if (denied) return denied;
  try { return json(await analysisPreview((await context.params).id)); } catch (error) { return failure(error); }
}
