"use client";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { analysisLabels } from "@/lib/handwriting-analysis";
import { Latex } from "./handwriting-review";
import { DatasetHeader, DevNavigation, DevPage, samplesHref, symbolHref, useDevNavigationGuard, useDevViewState } from "./dev-workspace";
import { useHandwritingAnalysis } from "./use-handwriting-analysis";
import styles from "./handwriting-review.module.css";
import css from "./handwriting-symbols.module.css";

export function HandwritingAnalysis({ datasetId }: { datasetId: string }) {
  const { data, error, busy, running, refresh, analyze, publish } = useHandwritingAnalysis(datasetId);
  const [alignment, setAlignment] = useDevViewState<"centered" | "aligned">(`symbols:${datasetId}:alignment`, "aligned");
  useDevNavigationGuard(busy);
  const hasResults = data?.symbols.some(symbol => symbol.result?.status === "complete");
  return <DevPage viewKey={`symbols:${datasetId}`} ready={!!data || !!error}>
    <DevNavigation /><DatasetHeader id={datasetId} name={data?.name} active="symbols" />
    <div className={css.content}>
      {error && <div role="alert" className={styles.error}>{error}<button className={styles.secondaryButton} onClick={() => void refresh()}>Reload</button></div>}
      {!data && !error && <div className={styles.loading}><LoaderCircle className={styles.spinner} size={20} role="status" aria-label="Loading symbols" /></div>}
      {data && <>
        <div className={css.actions}>
          <span role="status">{data.approved ? analysisLabels[data.status] : "Not approved"}{running && data.progress ? ` · ${data.progress.completed} / ${data.progress.total}` : ""}</span>
          {data.approved && (running || data.status !== "complete") && <button className={styles.primaryButton} disabled={busy || running} onClick={() => void analyze()}>
            {running && <LoaderCircle className={styles.spinner} size={16} />}{running ? "Analyzing" : data.status === "partial" || data.status === "failed" ? "Retry analysis" : data.status === "stale" ? "Reanalyze" : "Analyze"}
          </button>}
          {hasResults && <>
            <Link href={`/dev/writing?dataset=${encodeURIComponent(datasetId)}`} className={styles.secondaryButton}>Try in Writing</Link>
            <button className={styles.primaryButton} disabled={busy || !!data.publicationId} onClick={() => void publish()}>{data.publicationId ? "Published" : "Publish"}</button>
          </>}
        </div>
        {data.error && <p className={styles.error} role="alert">{data.error}</p>}
        {!data.approved ? <div className={styles.emptyLibrary}>
          <p>Approve this dataset before analysis.</p><Link href={samplesHref(datasetId)} className={styles.secondaryButton}>Review samples</Link>
        </div> : <>
          {hasResults && <div className={styles.analysisToolbar}>
            <div className={styles.alignmentSwitch} role="group" aria-label="Alignment">
              {(["centered", "aligned"] as const).map(value => <button key={value} aria-pressed={alignment === value} onClick={() => setAlignment(value)}>{value === "centered" ? "Centered" : "Aligned"}</button>)}
            </div>
            <div className={styles.heatmapLegend} aria-label="Ink coverage: 0 to 100 percent"><span>0%</span><i /><span>100%</span></div>
          </div>}
          <div className={css.tableScroll}><table className={css.table}>
            <thead><tr><th scope="col">Symbol</th><th scope="col">Samples</th><th scope="col">Heatmap</th><th scope="col">Medoid</th><th scope="col">Status</th></tr></thead>
            <tbody>{data.symbols.map(symbol => {
              const result = symbol.result, ready = result?.status === "complete" ? result : null;
              return <tr key={symbol.latex}>
                <th scope="row">{ready ? <Link className={css.symbolLink} href={symbolHref(datasetId, symbol.latex)} aria-label={`Open symbol ${symbol.latex}`}><Latex value={symbol.latex} /></Link> : <Latex value={symbol.latex} />}</th>
                <td><Link href={samplesHref(datasetId, symbol.latex)} aria-label={`Review ${symbol.count} samples of ${symbol.latex}`}>{symbol.count}</Link></td>
                <td>{ready ? <img className={css.thumbnail} src={ready.heatmap[alignment]} width={ready.width} height={ready.height} alt={`${symbol.latex} heatmap`} /> : "—"}</td>
                <td>{ready ? <img className={css.thumbnail} src={ready.medoid.image} width={ready.width} height={ready.height} alt={`${symbol.latex} medoid`} /> : "—"}</td>
                <td className={css.state}>{ready ? <Link href={symbolHref(datasetId, symbol.latex)}>Explore symbol →</Link> : result?.status === "failed" ? <>{result.error}<Link href={samplesHref(datasetId, symbol.latex)}>Review samples</Link></> : running ? "Waiting for result" : "Not calculated"}</td>
              </tr>;
            })}</tbody>
          </table></div>
        </>}
      </>}
    </div>
  </DevPage>;
}
