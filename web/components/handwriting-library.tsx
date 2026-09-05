"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, FileUp, LoaderCircle } from "lucide-react";
import { MAX_IMPORT_BYTES } from "@/lib/handwriting-dataset";
import { importDataset, listDatasets, type DatasetSummary } from "@/lib/handwriting-library";
import { analysisLabels } from "@/lib/handwriting-analysis";
import styles from "./handwriting-review.module.css";

export function DevNavigation({ mode }: { mode: "labeling" | "analysis" }) {
  return <header className={styles.topbar}>
    <Link href="/dev/dataset" className={styles.brand}><ArrowLeft size={17} />Datasets</Link>
    <nav className={styles.nav} aria-label="Dev tools">
      <Link href="/dev/dataset/labeling" aria-current={mode === "labeling" ? "page" : undefined}>Labeling</Link>
      <Link href="/dev/dataset/analysis" aria-current={mode === "analysis" ? "page" : undefined}>Analysis</Link>
    </nav>
  </header>;
}

const statuses = { unreviewed: "Unreviewed", "in-progress": "In progress", reviewed: "Reviewed", approved: "Approved" };

export function DatasetLibrary({ mode }: { mode: "labeling" | "analysis" }) {
  const [items, setItems] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null), locked = useRef(false);
  const router = useRouter();
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setItems(await listDatasets()); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load datasets."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const shown = items.filter((item) => mode === "labeling" || item.status === "approved");

  async function add(file: File) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("File is too large (40 MB maximum).");
      const result = await importDataset(JSON.parse(await file.text()));
      router.push(`/dev/dataset/labeling/${result.id}`);
    } catch (err) {
      setError(err instanceof SyntaxError ? "Invalid JSON file." : err instanceof Error ? err.message : "Could not add the dataset.");
    } finally { locked.current = false; setBusy(false); }
  }

  return <main className={styles.app} lang="en">
    <DevNavigation mode={mode} />
    <div className={styles.libraryContent}>
      <div className={styles.libraryHeading}>
        <h1>Datasets</h1>
        {mode === "labeling" && <button className={styles.primaryButton} disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <LoaderCircle className={styles.spinner} size={17} aria-label="Importing" /> : <FileUp size={17} />}Add dataset
        </button>}
      </div>
      <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Candidate dataset file" onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (file) void add(file);
      }} />
      {error && <div role="alert" className={styles.error}>{error}<button className={styles.secondaryButton} onClick={() => void refresh()}>Retry</button></div>}
      {loading && <div className={styles.loading}><LoaderCircle className={styles.spinner} size={20} role="status" aria-label="Loading datasets" /></div>}
      {!loading && !error && !shown.length && <div className={styles.emptyLibrary}>
        <p>{mode === "analysis" ? "No approved datasets" : "No datasets"}</p>
        {mode === "analysis" && <Link href="/dev/dataset/labeling" className={styles.secondaryButton}>Labeling<ArrowRight size={16} /></Link>}
      </div>}
      {!loading && <div className={styles.datasetList}>
        {shown.map((item) => <Link key={item.id} href={`/dev/dataset/${mode}/${item.id}`} className={styles.datasetRow}>
          <div><span className={styles.datasetTitle}>{item.name}</span>
            <span className={styles.datasetMeta}>{mode === "analysis" ? `${item.exportable} samples · ${analysisLabels[item.analysisStatus]}`
              : `${statuses[item.status]} · ${item.total - item.pending} / ${item.total} reviewed`}</span>
          </div><ArrowRight size={18} aria-hidden="true" />
        </Link>)}
      </div>}
    </div>
  </main>;
}
