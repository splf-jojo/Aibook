"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, LoaderCircle, Shuffle } from "lucide-react";
import { listDatasets, loadWritingDataset, type DatasetSummary } from "@/lib/handwriting-library";
import { DEFAULT_WRITING_SETTINGS, MAX_WRITING_LENGTH, type WritingDataset, type WritingResult } from "@/lib/handwriting-writing";
import { analysisLabels } from "@/lib/handwriting-analysis";
import { Latex } from "./handwriting-review";
import shared from "./handwriting-review.module.css";
import styles from "./handwriting-writing.module.css";

const imageSource = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";

export function HandwritingWriting() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]), [datasetId, setDatasetId] = useState("");
  const [data, setData] = useState<WritingDataset | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [renderError, setRenderError] = useState("");
  const [mode, setMode] = useState<"text" | "latex">("latex");
  const [source, setSource] = useState("\\frac{dx}{dy}=x^2+\\sin x");
  const [settings, setSettings] = useState(DEFAULT_WRITING_SETTINGS);
  const [result, setResult] = useState<WritingResult | null>(null), [rendering, setRendering] = useState(false), [exporting, setExporting] = useState(false);
  const [width, setWidth] = useState(800), surface = useRef<HTMLDivElement>(null), active = useRef(false), catalogRequest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++catalogRequest.current;
    try {
      const items = await listDatasets();
      if (!active.current || request !== catalogRequest.current) return;
      setDatasets(items); setError("");
      setDatasetId((current) => items.some((item) => item.id === current) ? current :
        items.find((item) => item.analysisStatus === "complete")?.id ?? items[0]?.id ?? "");
    } catch (err) { if (active.current && request === catalogRequest.current) setError(message(err)); }
    finally { if (active.current && request === catalogRequest.current) setLoading(false); }
  }, []);
  useEffect(() => {
    active.current = true; void refresh();
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { active.current = false; catalogRequest.current++; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setResult(null); setRenderError("");
    if (datasetId) loadWritingDataset(datasetId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setData(value); setError(""); }
    }).catch((err) => { if (!controller.signal.aborted) setError(message(err)); });
    return () => controller.abort();
  }, [datasetId, datasets]);
  useEffect(() => {
    if (!surface.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width - 32)));
    observer.observe(surface.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false; setRenderError("");
    if (!source.trim()) { setResult(null); setRendering(false); return; }
    setRendering(true);
    const timer = window.setTimeout(async () => {
      try {
        const { renderWriting } = await import("@/lib/handwriting-writing-renderer");
        if (cancelled) return;
        const value = renderWriting(source, mode, data?.glyphs ?? [], settings, width);
        if (!cancelled) setResult(value);
      } catch (err) { if (!cancelled) { setRenderError(message(err)); setResult(null); } }
      finally { if (!cancelled) setRendering(false); }
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [source, mode, data, settings, width]);

  async function download() {
    if (!result || rendering || exporting) return;
    setExporting(true); setError("");
    try { await (await import("@/lib/handwriting-writing-renderer")).downloadWriting(result); }
    catch (err) { setError(message(err)); }
    finally { setExporting(false); }
  }
  const unavailable = data && !data.glyphs.length;
  return <main className={shared.app} lang="en">
    <header className={shared.topbar}>
      <Link href="/dev" className={shared.brand}><ArrowLeft size={17} />Dev</Link>
      <div className={shared.tools}><Link href="/dev/dataset" className={shared.secondaryButton}>Datasets</Link></div>
    </header>
    <div className={styles.content} ref={surface}>
      <div className={shared.libraryHeading}><h1>Writing</h1>
        <div className={shared.alignmentSwitch} role="group" aria-label="Input mode">
          <button aria-pressed={mode === "text"} onClick={() => setMode("text")}>Text</button>
          <button aria-pressed={mode === "latex"} onClick={() => setMode("latex")}>LaTeX</button>
        </div>
      </div>
      <textarea className={styles.input} aria-label={mode === "latex" ? "LaTeX input" : "Text input"} value={source}
        maxLength={MAX_WRITING_LENGTH} rows={3} spellCheck={false} onChange={(event) => setSource(event.target.value)} />
      <div className={styles.settings}>
        <label className={styles.dataset}><span>Dataset</span><select value={datasetId} disabled={loading || !datasets.length} onChange={(event) => setDatasetId(event.target.value)}>
          {!datasets.length && <option value="">{loading ? "Loading…" : "No datasets"}</option>}
          {datasets.map((item) => <option key={item.id} value={item.id}>{item.name}{item.analysisStatus === "complete" ? "" : ` · ${analysisLabels[item.analysisStatus]}`}</option>)}
        </select></label>
        <label className={styles.slider}><span>Size <output>{settings.size} px</output></span><input aria-label="Size" type="range" min={20} max={96} value={settings.size} onChange={(e) => setSettings((s) => ({ ...s, size: Number(e.target.value) }))} /></label>
        <div className={styles.variation}><label className={styles.slider}><span>Variation <output>{settings.variation}%</output></span><input aria-label="Variation" type="range" min={0} max={100} value={settings.variation} onChange={(e) => setSettings((s) => ({ ...s, variation: Number(e.target.value) }))} /></label>
          <button className={shared.iconButton} aria-label="Reshuffle variation" title="Reshuffle variation" disabled={!settings.variation} onClick={() => setSettings((s) => ({ ...s, seed: s.seed + 1 }))}><Shuffle size={17} /></button>
        </div>
      </div>
      {mode === "text" && <details className={styles.spacing}><summary>Spacing</summary><div>
        <label className={styles.slider}><span>Letter spacing <output>{settings.letterSpacing} px</output></span><input aria-label="Letter spacing" type="range" min={0} max={16} value={settings.letterSpacing} onChange={(e) => setSettings((s) => ({ ...s, letterSpacing: Number(e.target.value) }))} /></label>
        <label className={styles.slider}><span>Line spacing <output>{settings.lineSpacing.toFixed(1)}</output></span><input aria-label="Line spacing" type="range" min={1.2} max={2.8} step={0.1} value={settings.lineSpacing} onChange={(e) => setSettings((s) => ({ ...s, lineSpacing: Number(e.target.value) }))} /></label>
      </div></details>}
      {data && data.glyphs.length > 0 && <div className={styles.coverage} aria-label="Available symbols">{data.glyphs.map((glyph) => <span key={glyph.latex} title={glyph.latex}><Latex value={glyph.latex} /></span>)}</div>}
      {error && <div role="alert" className={shared.error}>{error}<button className={shared.secondaryButton} onClick={() => void refresh()}>Retry</button></div>}
      {unavailable && <div className={styles.notice}><span>{data.approved ? `${analysisLabels[data.status]}.` : "Dataset needs approval."}</span>
        <Link href={`/dev/dataset/${data.approved ? "analysis" : "labeling"}/${data.id}`} className={shared.secondaryButton}>{data.approved ? "Analysis" : "Review dataset"}</Link></div>}
      {renderError && <div role="alert" className={shared.error}>{renderError}</div>}
      {!!data?.glyphs.length && !!result?.missing.length && <div className={styles.missing} role="status"><span>Missing symbols</span><div>{result.missing.map((label) => <code key={label}>{label}</code>)}</div></div>}
      {!!result?.unsupported.length && <div className={shared.error} role="status">Unsupported layout: {result.unsupported.join(", ")}</div>}
      {mode === "latex" && <section className={styles.preview} aria-label="LaTeX preview"><h2>LaTeX</h2>
        <div className={styles.paper} aria-busy={rendering}>{result?.preview && <img src={imageSource(result.preview.svg)} width={result.preview.width} height={result.preview.height} alt="LaTeX preview" />}</div>
      </section>}
      <section className={styles.preview} aria-label="Handwriting result">
        <div className={styles.outputHeading}><h2>Handwriting</h2><div>
          {(rendering || (datasetId && !data && !error)) && <LoaderCircle className={shared.spinner} size={17} role="status" aria-label="Rendering" />}
          <button className={shared.iconButton} aria-label="Download PNG" title="Download PNG" onClick={() => void download()} disabled={!result || !data?.glyphs.length || rendering || exporting}><Download size={18} /></button>
        </div></div>
        <div className={styles.paper} aria-busy={rendering}>{result && !!data?.glyphs.length && <img src={imageSource(result.svg)} width={result.width} height={result.height} alt="Handwriting result" />}</div>
      </section>
    </div>
  </main>;
}
