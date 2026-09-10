import type { Metadata } from "next";
import { HandwritingWriting } from "@/components/handwriting-writing";

export const metadata: Metadata = { title: "Writing · AIbook" };
export default async function WritingPage({ searchParams }: { searchParams: Promise<{ dataset?: string }> }) {
  const { dataset } = await searchParams;
  return <HandwritingWriting initialDataset={dataset} />;
}
