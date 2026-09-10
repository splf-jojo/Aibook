import type { Metadata } from "next";
import { HandwritingAnalysis } from "@/components/handwriting-analysis";
export const metadata: Metadata = { title: "Symbols · AIbook" };
export default async function Symbols({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HandwritingAnalysis key={id} datasetId={id} />;
}
