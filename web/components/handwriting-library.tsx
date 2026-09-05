"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileUp, LoaderCircle } from "lucide-react";
import { MAX_IMPORT_BYTES } from "@/lib/handwriting-dataset";
import { importDataset, listDatasets, type DatasetSummary } from "@/lib/handwriting-library";
import { analysisLabels } from "@/lib/handwriting-analysis";
import styles from "./handwriting-review.module.css";
import library from "./handwriting-library.module.css";

export function DevNavigation() {
  return <header className={styles.topbar}>
    <Link href="/dev" className={styles.brand}><ArrowLeft size={17} />Dev</Link>
    <div className={styles.tools}><Link href="/dev/writing" className={styles.secondaryButton}>Writing</Link></div>
  </header>;
}

const statuses = { unreviewed: "Unreviewed", "in-progress": "In progress", reviewed: "Reviewed", approved: "Approved" };

export function DatasetLibrary() {
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
    <DevNavigation />
    <div className={styles.libraryContent}>
      <div className={styles.libraryHeading}>
        <h1>Datasets</h1>
        <button className={styles.primaryButton} disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <LoaderCircle className={styles.spinner} size={17} aria-label="Importing" /> : <FileUp size={17} />}Add dataset
        </button>
      </div>
      <input ref={input} type="file" accept=".json,application/json" hidden aria-label="Candidate dataset file" onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (file) void add(file);
      }} />
      {error && <div role="alert" className={styles.error}>{error}<button className={styles.secondaryButton} onClick={() => void refresh()}>Retry</button></div>}
      {loading && <div className={styles.loading}><LoaderCircle className={styles.spinner} size={20} role="status" aria-label="Loading datasets" /></div>}
      {!loading && !error && !items.length && <div className={styles.emptyLibrary}>
        <p>No datasets</p>
      </div>}
      {!loading && <div className={styles.datasetList}>
        {items.map((item) => <div key={item.id} className={`${styles.datasetRow} ${library.row}`}>
          <div><span className={styles.datasetTitle}>{item.name}</span>
            <span className={styles.datasetMeta}>{statuses[item.status]} · {item.total - item.pending} / {item.total} reviewed · {analysisLabels[item.analysisStatus]}</span>
          </div>
          <nav className={library.actions} aria-label={`${item.name} actions`}>
            <Link href={`/dev/dataset/labeling/${item.id}`} className={styles.secondaryButton}>Labeling</Link>
            <Link href={`/dev/dataset/analysis/${item.id}`} className={styles.secondaryButton}>Analysis</Link>
          </nav>
        </div>)}
      </div>}
    </div>
  </main>;
}
