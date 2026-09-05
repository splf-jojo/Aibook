import { redirect } from "next/navigation";
export default async function LegacyLabelingDataset({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/dev/dataset/labeling/${encodeURIComponent((await params).id)}`);
}
