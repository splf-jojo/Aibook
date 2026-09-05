import type { Metadata } from "next";
import { DatasetLibrary } from "@/components/handwriting-library";

export const metadata: Metadata = { title: "Labeling · AIbook" };
export default function LabelingPage() { return <DatasetLibrary mode="labeling" />; }
