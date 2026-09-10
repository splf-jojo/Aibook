import { redirect } from "next/navigation";
export default async function LegacyAnalysisDataset({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/dev/dataset/${encodeURIComponent((await params).id)}/symbols`);
}
