"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, LoaderCircle, Shuffle } from "lucide-react";
import { listDatasets, loadWritingDataset, type DatasetSummary } from "@/lib/handwriting-library";
import { DEFAULT_WRITING_SETTINGS, MAX_WRITING_LENGTH, type WritingDataset, type WritingResult } from "@/lib/handwriting-writing";
import { analysisLabels } from "@/lib/handwriting-analysis";
import { solutionExamples } from "@/lib/writing-examples";
import { Latex } from "./handwriting-review";
import { BoxInspector, InsetControls, WritingPreview } from "./handwriting-writing-boxes";
import shared from "./handwriting-review.module.css";
import styles from "./handwriting-writing.module.css";
import { DevNavigation, DevPage, samplesHref, symbolsHref, useDevViewState } from "./dev-workspace";

const message = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";
const latexPresets: Array<{ name: string; value: string }> = [
  ...solutionExamples,
  { name: "Simple fraction", value: String.raw`\frac{x}{e}=x` },
  { name: "Powers and fractions", value: String.raw`\frac{x^2+1}{y}=x_1` },
  { name: "Trigonometry", value: String.raw`\sin x+\cos y=1` },
  { name: "Derivative", value: String.raw`\frac{dy}{dx}=2x` },
  { name: "Integral", value: String.raw`\int_0^1 x^2\,dx=\frac{1}{3}` },
  { name: "Sum", value: String.raw`\sum_{x=0}^{9}x=45` },
  { name: "Multiple lines", value: String.raw`\begin{aligned}y&=x^2+1\\\frac{dy}{dx}&=2x\end{aligned}` },
];

export function HandwritingWriting({ initialDataset }: { initialDataset?: string } = {}) {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useDevViewState("writing:dataset", initialDataset ?? "");
  useEffect(() => { if (initialDataset) setDatasetId(initialDataset); }, [initialDataset, setDatasetId]);
  const [loaded, setLoaded] = useState<{ key: string; value: WritingDataset } | null>(null), [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(""), [datasetError, setDatasetError] = useState<{ key: string; message: string } | null>(null);
  const [exportError, setExportError] = useState(""), [retryVersion, setRetryVersion] = useState(0);
  const [mode, setMode] = useDevViewState<"text" | "latex">("writing:mode", "latex");
  const [sources, setSources] = useDevViewState("writing:sources", { latex: "\\frac{dx}{dy}=x^2+\\sin x", text: "" });
  const source = sources[mode], setSource = (value: string) => setSources(current => ({ ...current, [mode]: value }));
  const [settings, setSettings] = useDevViewState("writing:settings", DEFAULT_WRITING_SETTINGS);
  const [inspecting, setInspecting] = useDevViewState("writing:inspect", false);
  const [showReferences, setShowReferences] = useState(false);
  const [showLatexBoxes, setShowLatexBoxes] = useState(false), [selectedLatexBox, setSelectedLatexBox] = useState<number | null>(null);
  const [printed, setPrinted] = useDevViewState("writing:printed", false);
  const [fontFallback, setFontFallback] = useDevViewState("writing:fallback", true);
  const [showBoxes, setShowBoxes] = useState(false), [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [rendered, setRendered] = useState<{ key: string; value?: WritingResult; error?: string } | null>(null), [exporting, setExporting] = useState(false);
  const [width, setWidth] = useState(800), surface = useRef<HTMLDivElement>(null), active = useRef(false), catalogRequest = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++catalogRequest.current;
    try {
      const items = await listDatasets();
      if (!active.current || request !== catalogRequest.current) return;
      setDatasets(current => JSON.stringify(current) === JSON.stringify(items) ? current : items); setCatalogError("");
      setDatasetId((current) => items.some((item) => item.id === current) ? current :
        items.find((item) => item.analysisStatus === "complete")?.id ?? items[0]?.id ?? "");
    } catch (err) { if (active.current && request === catalogRequest.current) setCatalogError(message(err)); }
    finally { if (active.current && request === catalogRequest.current) setLoading(false); }
  }, [setDatasetId]);
  const selectedDataset = datasets.find(item => item.id === datasetId);
  const datasetKey = selectedDataset ? JSON.stringify([datasetId, selectedDataset.updatedAt, selectedDataset.sourceVersion, selectedDataset.analysisStatus, selectedDataset.status, retryVersion]) : "";
  const data = loaded?.key === datasetKey ? loaded.value : null;
  const hasHandwriting = !!data?.approved && ["complete", "partial"].includes(data.status) && data.glyphs.length > 0;
  const loadError = datasetError?.key === datasetKey ? datasetError.message : "";
  const datasetPending = !!datasetKey && !data && !loadError;
  const printedOnly = mode === "latex" && printed;
  const renderKey = JSON.stringify([source, mode, settings, width, printedOnly, fontFallback, datasetKey, data?.sourceVersion, data?.computedAt]);
  const currentRender = rendered?.key === renderKey ? rendered : null;
  const result = source.trim() ? currentRender?.value ?? null : null;
  const renderError = currentRender?.error ?? "";
  const rendering = !!source.trim() && (!currentRender || datasetPending);
  useEffect(() => {
    active.current = true; void refresh();
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { active.current = false; catalogRequest.current++; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    if (datasetKey) loadWritingDataset(datasetId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setLoaded({ key: datasetKey, value }); setDatasetError(null); }
    }).catch((err) => { if (!controller.signal.aborted) setDatasetError({ key: datasetKey, message: message(err) }); });
    return () => controller.abort();
  }, [datasetId, datasetKey]);
  useEffect(() => {
    if (!surface.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(100, entry.contentRect.width)));
    observer.observe(surface.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // Opening the inspector can add a scrollbar and change the preview width.
    // Keep the selection through that reflow and through size/spacing edits.
    setSelectedBox(null); setSelectedLatexBox(null);
  }, [source, mode, datasetKey, printedOnly, fontFallback]);
  useEffect(() => {
    let cancelled = false; setExportError("");
    if (!source.trim()) return;
    const timer = window.setTimeout(async () => {
      try {
        const { renderWriting } = await import("@/lib/handwriting-writing-renderer");
        if (cancelled) return;
        const value = renderWriting(source, mode, hasHandwriting ? data!.glyphs : [], settings, width, { readable: fontFallback, printed: printedOnly });
        if (!cancelled) setRendered({ key: renderKey, value });
      } catch (err) { if (!cancelled) setRendered({ key: renderKey, error: message(err) }); }
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [source, mode, data, settings, width, fontFallback, printedOnly, renderKey, hasHandwriting]);

  async function download() {
    if (!result || rendering || exporting) return;
    setExporting(true); setExportError("");
    try { await (await import("@/lib/handwriting-writing-renderer")).downloadWriting(result); }
    catch (err) { setExportError(message(err)); }
    finally { setExporting(false); }
  }
  const unavailable = !printedOnly && data && !hasHandwriting;
  const hasOutput = hasHandwriting || printedOnly;
  const inspectedResult = result ? { ...result, placements: result.inspectionPlacements ?? result.placements } : null;
  const reportedSymbols = mode === "latex" && fontFallback ? result?.fontFallback : result?.missing;
  const outputTitle = printedOnly ? "Printed result" : result?.fontPlacements?.length ? (result.placements.some(p => p.glyph) ? "Mixed result" : "Printed result") : "Handwriting";
  return <DevPage viewKey="writing" ready={!loading && !datasetPending && (!source.trim() || !!currentRender)} className={styles.app}>
    <DevNavigation />
    <div className={styles.content}>
      <div className={styles.workspace}>
        <div className={shared.libraryHeading}><h1>Writing</h1>
          <div className={shared.alignmentSwitch} role="group" aria-label="Input mode">
            <button aria-pressed={mode === "text"} onClick={() => setMode("text")}>Text</button>
            <button aria-pressed={mode === "latex"} onClick={() => setMode("latex")}>LaTeX</button>
          </div>
        </div>
        <textarea className={styles.input} aria-label={mode === "latex" ? "LaTeX input" : "Text input"} value={source}
          maxLength={MAX_WRITING_LENGTH} rows={3} spellCheck={false} onChange={(event) => setSource(event.target.value)} />
        {mode === "latex" && <select className={styles.presets} aria-label="LaTeX presets" value="" onChange={(event) => {
          const preset = latexPresets.find((item) => item.name === event.target.value);
          if (preset) setSource(preset.value);
        }}>
          <option value="" disabled>Examples</option>
          {latexPresets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
        </select>}
        {!printedOnly && hasHandwriting && <details className={styles.symbols} open={data!.glyphs.length <= 16}><summary>Available symbols · {data!.glyphs.length}</summary><div className={styles.coverage} aria-label="Dataset symbols">{data!.glyphs.map((glyph) => <span key={glyph.latex} title={glyph.latex}>
          <Latex value={glyph.latex} />
          <img className={styles.medoid} src={glyph.image} width={glyph.width} height={glyph.height} alt={`${glyph.latex} medoid`} />
        </span>)}</div></details>}
        {(catalogError || loadError) && <div role="alert" className={shared.error}>{catalogError || loadError}<button className={shared.secondaryButton} onClick={() => { setRetryVersion(value => value + 1); void refresh(); }}>Retry</button></div>}
        {unavailable && <div className={styles.notice}><span>{data.approved ? (data.status === "complete" ? "No usable symbols." : `${analysisLabels[data.status]}.`) : "Dataset needs approval."}</span>
          <Link href={data.approved ? symbolsHref(data.id) : samplesHref(data.id)} className={shared.secondaryButton}>{data.approved ? "Symbols" : "Review samples"}</Link></div>}
        {renderError && <div role="alert" className={shared.error}>{renderError}</div>}
        {exportError && <div role="alert" className={shared.error}>PNG export: {exportError}</div>}
        {!printedOnly && !!data?.glyphs.length && !!reportedSymbols?.length && <div className={styles.missing} role="status"><span>{mode === "latex" && fontFallback ? "Printed fallback" : "Missing symbols"}</span><div>{reportedSymbols.map((label) => <code key={label}>{label}</code>)}</div></div>}
        {!!result?.unsupported.length && <div className={shared.error} role="status">Unsupported layout: {result.unsupported.join(", ")}</div>}
        {mode === "latex" && <section className={styles.preview} aria-label="LaTeX preview">
          <div className={styles.outputHeading}><h2>LaTeX</h2></div>
          <div className={styles.paper} aria-busy={rendering}>{result?.preview && <WritingPreview result={result.preview} alt="LaTeX preview" boxes={inspecting && showLatexBoxes && !rendering} selected={selectedLatexBox} onSelect={setSelectedLatexBox} />}</div>
          {inspecting && showLatexBoxes && result?.preview && !rendering && <BoxInspector placement={selectedLatexBox === null ? undefined : result.preview.placements[selectedLatexBox]} />}
        </section>}
        <section className={styles.preview} aria-label="Handwriting result">
          <div className={styles.outputHeading}><h2>{outputTitle}</h2><div>
            {(rendering || datasetPending) && <LoaderCircle className={shared.spinner} size={17} role="status" aria-label="Rendering" />}
            <button className={shared.secondaryButton} aria-label="Download PNG" onClick={() => void download()} disabled={!result || !hasOutput || rendering || exporting}><Download size={16} />PNG</button>
          </div></div>
          <div className={styles.paper} ref={surface} aria-busy={rendering}>{inspectedResult && hasOutput && <WritingPreview result={inspectedResult} alt={outputTitle === "Handwriting" ? "Handwriting result" : outputTitle} boxes={inspecting && showBoxes && !rendering} references={inspecting && showReferences && !rendering} selected={selectedBox} onSelect={setSelectedBox} />}</div>
          {inspecting && (showBoxes || showReferences) && inspectedResult && hasOutput && !rendering && <BoxInspector placement={selectedBox === null ? undefined : inspectedResult.placements[selectedBox]} boxes={showBoxes} references={showReferences} />}
        </section>
      </div>
      <aside className={styles.sidebar} aria-label="Writing settings">
        <div className={styles.settings}>
          <label className={styles.dataset}><span>Dataset</span><select value={datasetId} disabled={loading || !datasets.length} onChange={(event) => setDatasetId(event.target.value)}>
            {!datasets.length && <option value="">{loading ? "Loading…" : "No datasets"}</option>}
            {datasets.map((item) => <option key={item.id} value={item.id}>{item.name}{item.analysisStatus === "complete" ? "" : ` · ${analysisLabels[item.analysisStatus]}`}</option>)}
          </select></label>
          <label className={styles.slider}><span>Size <output>{settings.size} px</output></span><input aria-label="Size" type="range" min={20} max={96} value={settings.size} onChange={(e) => setSettings((s) => ({ ...s, size: Number(e.target.value) }))} /></label>
          <div className={styles.variation}><label className={styles.slider}><span>Variation <output>{settings.variation}%</output></span><input aria-label="Variation" type="range" min={0} max={100} value={settings.variation} onChange={(e) => setSettings((s) => ({ ...s, variation: Number(e.target.value) }))} /></label>
            <button className={shared.iconButton} aria-label="Reshuffle variation" title="Reshuffle variation" disabled={!settings.variation && !settings.verticalScatter} onClick={() => setSettings((s) => ({ ...s, seed: s.seed + 1 }))}><Shuffle size={17} /></button>
          </div>
          <label className={styles.slider}><span>Vertical scatter <output>{settings.verticalScatter} px</output></span><input aria-label="Vertical scatter" type="range" min={0} max={30} value={settings.verticalScatter} onChange={(e) => setSettings((s) => ({ ...s, verticalScatter: Number(e.target.value) }))} /></label>
        </div>
        <details className={styles.spacing}><summary>Spacing</summary><div>
          <InsetControls label="Padding" value={settings.padding} onChange={(padding) => setSettings((s) => ({ ...s, padding }))} />
          <InsetControls label="Margin" value={settings.margin} onChange={(margin) => setSettings((s) => ({ ...s, margin }))} />
          {mode === "text" && <>
          <label className={styles.slider}><span>Letter spacing <output>{settings.letterSpacing} px</output></span><input aria-label="Letter spacing" type="range" min={0} max={16} value={settings.letterSpacing} onChange={(e) => setSettings((s) => ({ ...s, letterSpacing: Number(e.target.value) }))} /></label>
          <label className={styles.slider}><span>Line spacing <output>{settings.lineSpacing.toFixed(1)}</output></span><input aria-label="Line spacing" type="range" min={1.2} max={2.8} step={0.1} value={settings.lineSpacing} onChange={(e) => setSettings((s) => ({ ...s, lineSpacing: Number(e.target.value) }))} /></label>
          </>}
        </div><button className={shared.secondaryButton} onClick={() => setSettings((s) => ({ ...s, padding: DEFAULT_WRITING_SETTINGS.padding, margin: DEFAULT_WRITING_SETTINGS.margin, letterSpacing: DEFAULT_WRITING_SETTINGS.letterSpacing, lineSpacing: DEFAULT_WRITING_SETTINGS.lineSpacing }))}>Reset spacing</button></details>
        {mode === "latex" && <details className={styles.spacing}><summary>Display</summary><div>
          <label className={styles.boxToggle}><input type="checkbox" checked={printed} onChange={event => setPrinted(event.target.checked)} />Printed</label>
          <label className={styles.dataset}><span>Missing symbols</span><select aria-label="Missing symbol display" value={printedOnly || fontFallback ? "printed" : "placeholder"} disabled={printedOnly} onChange={event => setFontFallback(event.target.value === "printed")}><option value="printed">Printed fallback</option><option value="placeholder">Placeholders</option></select></label>
        </div></details>}
        <details className={styles.spacing} open={inspecting} onToggle={event => setInspecting(event.currentTarget.open)}><summary>Inspect</summary><div className={styles.inspectionControls}>
          {mode === "latex" && <label className={styles.boxToggle}><input type="checkbox" checked={showLatexBoxes} onChange={event => setShowLatexBoxes(event.target.checked)} />LaTeX boxes</label>}
          <label className={styles.boxToggle}><input type="checkbox" checked={showBoxes} onChange={event => setShowBoxes(event.target.checked)} />Result boxes</label>
          <label className={styles.boxToggle}><input type="checkbox" checked={showReferences} onChange={event => setShowReferences(event.target.checked)} />Reference bounds</label>
        </div></details>
      </aside>
    </div>
  </DevPage>;
}
