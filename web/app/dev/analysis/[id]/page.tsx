import type { Metadata } from "next";
import { HandwritingAnalysis } from "@/components/handwriting-analysis";

export const metadata: Metadata = { title: "Analysis · AIbook" };
export default async function AnalysisDataset({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HandwritingAnalysis key={id} datasetId={id} />;
}
