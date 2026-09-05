import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { devAccessAllowed } from "@/lib/handwriting-access.server";

export const metadata: Metadata = { title: "Dev · AIbook", robots: { index: false, follow: false } };
export default async function DevLayout({ children }: { children: React.ReactNode }) {
  if (!devAccessAllowed(await headers())) notFound();
  return <div lang="en">{children}</div>;
}
