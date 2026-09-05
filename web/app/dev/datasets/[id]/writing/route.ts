import { checkDevRequest } from "@/lib/handwriting-access.server";
import { writingDataset } from "@/lib/handwriting-writing.server";
import { failure, json } from "@/lib/handwriting-http.server";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = checkDevRequest(request); if (denied) return denied;
  try { return json(await writingDataset((await context.params).id)); } catch (error) { return failure(error); }
}
