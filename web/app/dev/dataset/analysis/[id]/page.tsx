import { redirect } from "next/navigation";
export default async function AnalysisDataset({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dev/dataset/${encodeURIComponent(id)}/symbols`);
}
