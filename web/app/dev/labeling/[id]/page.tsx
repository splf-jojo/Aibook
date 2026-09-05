import type { Metadata } from "next";
import { HandwritingReview } from "@/components/handwriting-review";

export const metadata: Metadata = { title: "Labeling · AIbook" };
export default async function LabelingDataset({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HandwritingReview key={id} datasetId={id} />;
}
