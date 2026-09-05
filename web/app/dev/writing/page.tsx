import type { Metadata } from "next";
import { HandwritingWriting } from "@/components/handwriting-writing";

export const metadata: Metadata = { title: "Writing · AIbook" };
export default function WritingPage() { return <HandwritingWriting />; }
