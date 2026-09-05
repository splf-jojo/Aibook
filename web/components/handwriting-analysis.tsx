"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Home, LoaderCircle } from "lucide-react";
import { loadAnalysis, startAnalysis, type AnalysisPreview } from "@/lib/handwriting-library";
import { analysisLabels } from "@/lib/handwriting-analysis";
import { Latex } from "./handwriting-review";
import styles from "./handwriting-review.module.css";

export function HandwritingAnalysis({ datasetId }: { datasetId: string }) {
  const [data, setData] = useState<AnalysisPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [alignment, setAlignment] = useState<"centered" | "aligned">("aligned");
  const [expanded, setExpanded] = useState<string | null>(null);
  const requestNumber = useRef(0), currentId = useRef(datasetId), mounted = useRef(false), locked = useRef(false);
  currentId.current = datasetId;
  const refresh = useCallback(async () => {
    const request = ++requestNumber.current;
    try {
      const result = await loadAnalysis(datasetId);
      if (mounted.current && request === requestNumber.current) { setData(result); setError(""); }
    } catch (err) {
      if (mounted.current && request === requestNumber.current) setError(err instanceof Error ? err.message : "Could not load the dataset.");
    }
  }, [datasetId]);
  useEffect(() => {
    mounted.current = true; setData(null); setError(""); setExpanded(null);
    void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { mounted.current = false; requestNumber.current++; window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  const running = busy || data?.status === "running";
  useEffect(() => {
    if (!running) return;
    let pending = false;
    const timer = window.setInterval(async () => {
      if (pending) return;
      pending = true; await refresh(); pending = false;
    }, 1500);
    return () => window.clearInterval(timer);
  }, [running, refresh]);
  async function analyze() {
    if (!data || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      await startAnalysis(datasetId, data.sourceVersion);
      if (mounted.current && currentId.current === datasetId) await refresh();
    } catch (err) {
      if (mounted.current && currentId.current === datasetId) {
        await refresh();
        setError(err instanceof Error ? err.message : "Could not analyze the dataset.");
      }
    } finally {
      locked.current = false;
      if (mounted.current && currentId.current === datasetId) setBusy(false);
    }
  }
  const hasResults = data?.symbols.some((symbol) => symbol.result?.status === "complete");
  return <main className={styles.app} lang="en">
    <header className={styles.topbar}>
      <Link href="/dev/dataset/analysis" className={styles.brand}><ArrowLeft size={17} />Datasets</Link>
      <div className={styles.tools}><Link href="/dev" className={styles.iconButton} aria-label="Dev home" title="Dev home"><Home size={18} /></Link></div>
    </header>
    <div className={styles.libraryContent}>
      {error && <div role="alert" className={styles.error}>{error}<button className={styles.secondaryButton} onClick={() => void refresh()}>Reload</button></div>}
      {!data && !error && <div className={styles.loading}><LoaderCircle className={styles.spinner} size={20} role="status" aria-label="Loading dataset" /></div>}
      {data && <>
        <div className={styles.libraryHeading}>
          <h1>{data.name}</h1>
          {data.approved && (running || data.status !== "complete") && <button className={styles.primaryButton} disabled={running} onClick={() => void analyze()}>
            {running && <LoaderCircle className={styles.spinner} size={16} />}
            {running ? "Analyzing" : data.status === "partial" ? "Retry analysis" : data.status === "stale" ? "Reanalyze" : "Analyze"}
          </button>}
        </div>
        {!data.approved ? <div className={styles.emptyLibrary}>
          <p>Approve this dataset before analysis.</p><Link href={`/dev/dataset/labeling/${datasetId}`} className={styles.secondaryButton}>Review dataset</Link>
        </div> : <>
          <div className={styles.analysisToolbar}>
            {hasResults ? <>
              <div className={styles.alignmentSwitch} role="group" aria-label="Alignment">
                {(["centered", "aligned"] as const).map((value) => <button key={value} aria-pressed={alignment === value} onClick={() => setAlignment(value)}>
                  {value === "centered" ? "Centered" : "Aligned"}
                </button>)}
              </div>
              <div className={styles.heatmapLegend} aria-label="Ink coverage: white is 0 percent, dark red is 100 percent"><span>0%</span><i /><span>100%</span></div>
            </> : <span className={styles.datasetMeta} role="status">{running ? `Analyzing${data.progress ? ` · ${data.progress.completed} / ${data.progress.total}` : ""}` : analysisLabels[data.status]}</span>}
          </div>
          <table className={styles.analysisTable}>
            <thead><tr><th scope="col">Symbol</th><th scope="col">Heatmap</th><th scope="col">Medoid</th></tr></thead>
            <tbody>{data.symbols.map((symbol, index) => {
              const result = symbol.result, ready = result?.status === "complete" ? result : null;
              const open = expanded === symbol.latex;
              return <Fragment key={symbol.latex}><tr>
                <th scope="row"><div className={styles.analysisSymbol}><Latex value={symbol.latex} /></div>
                  {ready ? <button className={styles.sampleCount} aria-expanded={open} aria-controls={`samples-${index}`} onClick={() => setExpanded(open ? null : symbol.latex)}>{symbol.count} samples</button>
                    : <span className={styles.datasetMeta}>{symbol.count} samples</span>}
                </th>
                {result?.status === "failed" ? <td colSpan={2} className={styles.analysisFailure}>{result.error} <Link href={`/dev/dataset/labeling/${datasetId}`}>Review</Link></td> : <>
                  <td>{ready ? <img className={styles.analysisImage} src={ready.heatmap[alignment]} width={ready.width} height={ready.height} alt={`${symbol.latex} ${alignment} heatmap`} /> : <span aria-label="Heatmap not calculated">—</span>}</td>
                  <td>{ready ? <img className={styles.analysisImage} src={ready.medoid.image} width={ready.width} height={ready.height} alt={`${symbol.latex} medoid`} title={`Sample ${ready.medoid.id}`} /> : <span aria-label="Medoid not selected">—</span>}</td>
                </>}
              </tr>{ready && <tr hidden={!open} id={`samples-${index}`}><td colSpan={3} className={styles.sampleCell}>
                {open && <div className={styles.analysisSamples}>{ready.samples.map((sample) => <figure key={sample.id} title={`${sample.source.file} · Page ${sample.source.page} · ${sample.id}`}>
                  <img className={styles.sampleImage} src={sample[alignment]} width={ready.width} height={ready.height} alt={`${symbol.latex} sample ${sample.id}`} />
                  <figcaption>{sample.id === ready.medoid.id ? "Medoid" : `Page ${sample.source.page}`}</figcaption>
                </figure>)}</div>}
              </td></tr>}</Fragment>;
            })}</tbody>
          </table>
        </>}
      </>}
    </div>
  </main>;
}
