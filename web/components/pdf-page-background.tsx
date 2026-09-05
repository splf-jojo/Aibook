"use client";

import { useEffect, useState } from "react";
import { Image as KonvaImage, Text as KonvaText } from "react-konva";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";

/** The original PDF stays separate from editable ink. Decode once per note,
 * render only the active page, and cancel stale work when switching pages. */
export function PdfPageBackground({ source, pageIndex, width, height }: {
  source?: string | null; pageIndex?: number | null; width: number; height: number;
}) {
  const [document, setDocument] = useState<{ source: string; pdf: PDFDocumentProxy } | null>(null);
  const [rendered, setRendered] = useState<{ source: string; index: number; canvas: HTMLCanvasElement } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    setDocument(null);
    setFailed(false);
    if (source) void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        const assets = `/pdfjs/${pdfjs.version}/`;
        pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
        task = pdfjs.getDocument({
          data: Uint8Array.from(atob(source), (char) => char.charCodeAt(0)),
          cMapUrl: `${assets}cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
          iccUrl: `${assets}iccs/`,
        });
        const pdf = await task.promise;
        if (!cancelled) setDocument({ source, pdf });
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; if (task) void task.destroy(); };
  }, [source]);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | undefined;
    setRendered(null);
    if (pageIndex == null || !document || document.source !== source) return;
    setFailed(false);
    void (async () => {
      try {
        const page = await document.pdf.getPage(pageIndex + 1);
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        const fit = Math.min(width / natural.width, height / natural.height);
        const pixelRatio = 2;
        const viewport = page.getViewport({ scale: fit * pixelRatio });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(width * pixelRatio);
        canvas.height = Math.ceil(height * pixelRatio);
        task = page.render({ canvas, viewport, background: "white", transform: [1, 0, 0, 1,
          (canvas.width - viewport.width) / 2, (canvas.height - viewport.height) / 2] });
        await task.promise;
        if (!cancelled) setRendered({ source: document.source, index: pageIndex, canvas });
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [document, source, pageIndex, width, height]);

  if (!source || pageIndex == null) return null;
  if (rendered?.source === source && rendered.index === pageIndex) {
    return <KonvaImage image={rendered.canvas} width={width} height={height} listening={false} />;
  }
  return <KonvaText text={failed ? "PDF could not be displayed. Reopen the note to retry." : "Loading PDF…"}
    x={24} y={24} width={width - 48} fontSize={16} fill={failed ? "#b91c1c" : "#64748b"} listening={false} />;
}
