import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { HandwritingReview } from "@/components/handwriting-review";

export const metadata: Metadata = { title: "Проверка почерка · AIbook", robots: { index: false, follow: false } };

export default async function HandwritingPage() {
  await connection();
  if (process.env.NODE_ENV !== "development" && process.env.HANDWRITING_REVIEW_ENABLED !== "1") notFound();
  return <HandwritingReview />;
}
