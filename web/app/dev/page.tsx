import type { Metadata } from "next";
import { DatasetLibrary } from "@/components/handwriting-library";
export const metadata: Metadata = { title: "Datasets · AIbook" };
export default function DevHome() { return <DatasetLibrary />; }
