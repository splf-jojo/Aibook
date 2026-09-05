import type { Metadata } from "next";
import { DatasetLibrary } from "@/components/handwriting-library";
export const metadata: Metadata = { title: "Analysis · AIbook" };
export default function AnalysisPage() { return <DatasetLibrary mode="analysis" />; }
