import { redirect } from "next/navigation";
export default async function LegacyAnalysisDataset({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/dev/dataset/analysis/${encodeURIComponent((await params).id)}`);
}
