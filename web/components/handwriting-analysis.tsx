"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Home, LoaderCircle } from "lucide-react";
import { loadAnalysis, type AnalysisPreview } from "@/lib/handwriting-library";
import { Latex } from "./handwriting-review";
import styles from "./handwriting-review.module.css";

export function HandwritingAnalysis({ datasetId }: { datasetId: string }) {
  const [data, setData] = useState<AnalysisPreview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    loadAnalysis(datasetId).then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Could not load the dataset."); });
    return () => { active = false; };
  }, [datasetId]);
  return <main className={styles.app} lang="en">
    <header className={styles.topbar}>
      <Link href="/dev/analysis" className={styles.brand}><ArrowLeft size={17} />Datasets</Link>
      <div className={styles.tools}><Link href="/dev" className={styles.iconButton} aria-label="Dev home" title="Dev home"><Home size={18} /></Link></div>
    </header>
    <div className={styles.libraryContent}>
      {error && <div role="alert" className={styles.error}>{error}<button className={styles.secondaryButton} onClick={() => window.location.reload()}>Retry</button></div>}
      {!data && !error && <div className={styles.loading}><LoaderCircle className={styles.spinner} size={20} role="status" aria-label="Loading dataset" /></div>}
      {data && <>
        <div className={styles.libraryHeading}>
          <h1>{data.name}</h1>
          {data.approved && <button className={styles.primaryButton} disabled aria-describedby="analysis-availability">Analyze</button>}
        </div>
        {!data.approved ? <div className={styles.emptyLibrary}>
          <p>Approve this dataset before analysis.</p><Link href={`/dev/labeling/${datasetId}`} className={styles.secondaryButton}>Review dataset</Link>
        </div> : <>
          <div className={styles.analysisStatus}><span>Not analyzed</span><span id="analysis-availability">Analysis is not available yet.</span></div>
          <table className={styles.analysisTable}>
            <thead><tr><th scope="col">Symbol</th><th scope="col">Heatmap</th><th scope="col">Medoid</th></tr></thead>
            <tbody>{data.symbols.map((symbol) => <tr key={symbol.latex}>
              <th scope="row"><div className={styles.analysisSymbol}><Latex value={symbol.latex} /></div><span className={styles.datasetMeta}>{symbol.count} samples</span></th>
              <td aria-label="Heatmap not calculated">—</td><td aria-label="Medoid not selected">—</td>
            </tr>)}</tbody>
          </table>
        </>}
      </>}
    </div>
  </main>;
}
