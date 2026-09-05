import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { authenticateDev, devAccessAllowed, devSessionToken } from "@/lib/handwriting-access.server";
import { DevLogin, DevSessionMonitor } from "@/components/dev-session";

export const metadata: Metadata = { title: "Dev · AIbook", robots: { index: false, follow: false } };
export default async function DevLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  if (!devAccessAllowed(requestHeaders)) notFound();
  const auth = await authenticateDev(devSessionToken(requestHeaders));
  if (auth.status !== 200) return <DevLogin unavailable={auth.status === 503} />;
  return <div lang="en"><DevSessionMonitor />{children}</div>;
}
