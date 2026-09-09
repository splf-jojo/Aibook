"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { API_URL, apiHeaders, type CanvasContent, type CanvasRecord } from "@/lib/canvas-api";
import styles from "./canvas-library.module.css";

const PreviewPage = dynamic(() => import("./canvas-preview-page"), { ssr: false });

// Limit large note/PDF downloads when a library first enters the viewport.
let active = 0;
const waiting: Array<() => void> = [];
async function fetchPreview(id: string, token: string, signal: AbortSignal) {
  if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try {
    signal.throwIfAborted();
    return await fetch(`${API_URL}/api/canvases/${encodeURIComponent(id)}`, {
      headers: apiHeaders(token), signal,
    }).then(async response => {
      if (!response.ok) throw new Error(String(response.status));
      return await response.json() as CanvasRecord;
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

export function CanvasPreview({ id, updatedAt, token, unavailable, loadingLabel, onAuthFailure }: {
  id?: string; updatedAt?: string; token: string; unavailable: string; loadingLabel: string;
  onAuthFailure: () => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const [content, setContent] = useState<CanvasContent | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "120px" });
    observer.observe(host.current);
    const resize = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    resize.observe(host.current);
    return () => { observer.disconnect(); resize.disconnect(); };
  }, []);

  useEffect(() => {
    setContent(null); setFailed(false);
    if (!id || !visible) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(new Error("preview-timeout")), 30000);
    void fetchPreview(id, token, controller.signal).then(record => {
      if (controller.signal.aborted) return;
      const page = record.content.pages.find(page => page.elements.length || page.pdfPageIndex != null || page.appleDrawingData)
        ?? record.content.pages[0];
      if (!page || (page.appleDrawingData && !page.elements.length && page.pdfPageIndex == null)) {
        setFailed(true); return;
      }
      setContent({ schemaVersion: 2, pages: [page], pdfData: page.pdfPageIndex != null ? record.content.pdfData : null });
    }).catch(error => {
      if (controller.signal.aborted && controller.signal.reason?.message !== "preview-timeout") return;
      if (error instanceof Error && ["401", "403"].includes(error.message)) onAuthFailure();
      else setFailed(true);
    }).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [id, updatedAt, token, visible, onAuthFailure]);

  return <span ref={host} className={styles.preview} data-preview-state={failed ? "error" : content || !id ? "ready" : "loading"}>
    {content && width > 0 && <PreviewPage content={content} width={width} />}
    {failed && <span className={styles.previewMessage}>{unavailable}</span>}
    {id && !content && !failed && <span className={styles.previewLoading} aria-label={loadingLabel} />}
  </span>;
}
