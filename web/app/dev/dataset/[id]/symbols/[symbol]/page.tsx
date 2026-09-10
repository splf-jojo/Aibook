import type { Metadata } from "next";
import { HandwritingSymbol } from "@/components/handwriting-symbol";
export const metadata: Metadata = { title: "Symbol · AIbook" };
export default async function SymbolPage({ params }: { params: Promise<{ id: string; symbol: string }> }) {
  const { id, symbol } = await params;
  return <HandwritingSymbol key={`${id}:${symbol}`} datasetId={id} symbol={symbol} />;
}
