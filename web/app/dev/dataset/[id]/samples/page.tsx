import type { Metadata } from "next";
import { HandwritingReview } from "@/components/handwriting-review";
export const metadata: Metadata = { title: "Samples · AIbook" };
export default async function Samples({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ symbol?: string; sample?: string }> }) {
  const { id } = await params, { symbol, sample } = await searchParams;
  return <HandwritingReview key={`${id}:${symbol ?? ""}:${sample ?? ""}`} datasetId={id} initialSymbol={symbol} initialSample={sample} />;
}
