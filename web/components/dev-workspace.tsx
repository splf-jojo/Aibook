"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DevSignOut } from "./dev-session";
import styles from "./handwriting-review.module.css";
import css from "./dev-workspace.module.css";

type Workspace = { views: Map<string, unknown>; scroll: Map<string, number>; guards: Map<string, string>; canNavigate: () => boolean };
const Context = createContext<Workspace | null>(null);

/** UI context only. Dataset contents and decisions continue to come from the server. */
export function DevWorkspace({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState("");
  const [workspace] = useState<Workspace>(() => ({
    views: new Map(), scroll: new Map(), guards: new Map(),
    canNavigate() { const reason = this.guards.values().next().value; setNotice(reason ?? ""); return !reason; },
  }));
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (workspace.guards.size) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [workspace]);
  const pathname = usePathname();
  useEffect(() => setNotice(""), [pathname]);
  return <Context.Provider value={workspace}><div onClickCapture={event => {
    const anchor = (event.target as Element).closest?.("a[href]");
    if (!anchor || anchor.hasAttribute("download") || anchor.getAttribute("target") === "_blank" || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (!workspace.canNavigate()) { event.preventDefault(); event.stopPropagation(); }
  }}>
    {children}
    {notice && <div className={css.navigationNotice} role="alert">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
  </div></Context.Provider>;
}

export function useDevNavigation() { const workspace = useContext(Context); return () => workspace?.canNavigate() ?? true; }

export function useDevNavigationGuard(pending: boolean, message = "Finish saving before leaving. If saving failed, retry or reload.") {
  const workspace = useContext(Context), id = useId();
  useLayoutEffect(() => { if (pending) workspace?.guards.set(id, message); return () => { workspace?.guards.delete(id); }; }, [workspace, id, pending, message]);
}

/** Scoped to this signed-in workspace; discarded on sign out, never shared between users. */
export function useDevViewState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const workspace = useContext(Context);
  const [value, setValue] = useState<T>(() => workspace?.views.has(key) ? workspace.views.get(key) as T : initial);
  const current = useRef(value);
  const update = useCallback<Dispatch<SetStateAction<T>>>(next => {
    const result = typeof next === "function" ? (next as (previous: T) => T)(current.current) : next;
    current.current = result; workspace?.views.set(key, result); setValue(result);
  }, [workspace, key]);
  return [value, update];
}

export function DevPage({ children, viewKey, ready = true, className = "" }: { children: ReactNode; viewKey: string; ready?: boolean; className?: string }) {
  const workspace = useContext(Context), host = useRef<HTMLElement>(null), restored = useRef(false);
  useLayoutEffect(() => {
    restored.current = false;
    if (ready && host.current) { host.current.scrollTop = workspace?.scroll.get(viewKey) ?? 0; restored.current = true; }
  }, [workspace, viewKey, ready]);
  return <main ref={host} className={`${styles.app} ${className}`} lang="en" onScroll={event => {
    if (restored.current) workspace?.scroll.set(viewKey, event.currentTarget.scrollTop);
  }}>{children}</main>;
}

export function DevNavigation() {
  const pathname = usePathname(), canNavigate = useDevNavigation(), writing = pathname.startsWith("/dev/writing");
  return <header className={css.topbar}>
    <Link href="/" className={styles.brand}>AIbook</Link>
    <nav className={css.globalNav} aria-label="Dev tools">
      <Link href="/dev" scroll={false} aria-current={!writing ? "page" : undefined}>Datasets</Link>
      <Link href="/dev/writing" scroll={false} aria-current={writing ? "page" : undefined}>Writing</Link>
    </nav><DevSignOut beforeSignOut={canNavigate} />
  </header>;
}

export const samplesHref = (id: string, symbol?: string) => `/dev/dataset/${id}/samples${symbol === undefined ? "" : `?symbol=${encodeURIComponent(symbol)}`}`;
export const symbolsHref = (id: string) => `/dev/dataset/${id}/symbols`;
export const symbolHref = (id: string, symbol: string) => `${symbolsHref(id)}/${encodeURIComponent(symbol)}`;

export function DatasetHeader({ id, name, active }: { id: string; name?: string; active: "samples" | "symbols" }) {
  return <div className={css.datasetHeader}>
    <div className={css.datasetTitle}><Link href="/dev" scroll={false}><ArrowLeft size={16} />Datasets</Link><h1>{name ?? "Loading dataset…"}</h1></div>
    <nav className={css.localNav} aria-label="Dataset views">
      <Link href={samplesHref(id)} scroll={false} aria-current={active === "samples" ? "page" : undefined}>Samples</Link>
      <Link href={symbolsHref(id)} scroll={false} aria-current={active === "symbols" ? "page" : undefined}>Symbols</Link>
    </nav>
  </div>;
}
