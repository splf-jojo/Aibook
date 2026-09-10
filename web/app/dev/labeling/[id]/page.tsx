import { redirect } from "next/navigation";
export default async function LegacyLabelingDataset({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/dev/dataset/${encodeURIComponent((await params).id)}/samples`);
}
