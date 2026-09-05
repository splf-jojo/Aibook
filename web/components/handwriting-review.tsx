"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import { ArrowLeft, Check, Download, Home, LoaderCircle, Pencil, RotateCcw, X } from "lucide-react";
import {
  datasetStats, exportDataset, MIN_EXAMPLES, type Candidate, type Decision, type ReviewIssue,
} from "@/lib/handwriting-dataset";
import { loadDataset, updateReview, type LibrarySession, type ReviewCommand, type ReviewUpdate } from "@/lib/handwriting-library";
import styles from "./handwriting-review.module.css";

type Mode = "queue" | "gallery";
type Filter = "all" | "pending" | "accepted" | "rejected";
const statusLabels = { pending: "Pending", accepted: "Accepted", rejected: "Rejected" };
const issueLabels: Record<ReviewIssue, string> = {
  "incorrect-outline": "Correct symbol, wrong outline",
  "incorrect-symbol": "Correct outline, wrong symbol",
};
function decisionLabel(decision?: Decision) {
  return decision?.issue ? issueLabels[decision.issue] : statusLabels[decision?.status ?? "pending"];
}

function math(latex: string): { html: string; valid: boolean } {
  try {
    return { html: katex.renderToString(latex, { throwOnError: true, trust: false, strict: "error", output: "html", maxExpand: 100, maxSize: 5 }), valid: true };
  } catch { return { html: "", valid: false }; }
}

export function Latex({ value }: { value: string }) {
  const result = useMemo(() => math(value), [value]);
  return result.valid ? <span aria-label={value} dangerouslySetInnerHTML={{ __html: result.html }} /> : <code>{value}</code>;
}

function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReviewCard({ sample, decision, index, total, busy, onDecide, onUndo, canUndo }: {
  sample: Candidate; decision?: Decision; index: number; total: number; busy: boolean;
  onDecide: (status: Decision["status"], latex: string, issue?: ReviewIssue) => void; onUndo: () => void; canUndo: boolean;
}) {
  const [label, setLabel] = useState(decision?.latex ?? sample.latex);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const valid = Boolean(label.trim()) && label.length <= 80 && math(label).valid;
  const canAccept = loaded && contextLoaded && !imageError && valid;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || busy || editing) return;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); onDecide("rejected", valid ? label : sample.latex); }
      if (event.key === "ArrowRight" && canAccept) { event.preventDefault(); onDecide("accepted", label); }
      if (canAccept && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault(); onDecide("rejected", label, event.key === "ArrowUp" ? "incorrect-outline" : "incorrect-symbol");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, canAccept, editing, label, onDecide, sample.latex, valid]);

  return <section className={styles.card} aria-label="Symbol review" aria-busy={busy}>
    <div className={styles.cardTop}>
      <span aria-label={`Sample ${index + 1} of ${total}`}>{index + 1} / {total}</span>
      {decision && <span className={styles[decision.status]}>{decisionLabel(decision)}</span>}
      <button className={styles.iconButton} onClick={onUndo} disabled={busy || !canUndo}
        aria-label="Undo last decision" title="Undo last decision"><RotateCcw size={17} /></button>
    </div>
    <div className={styles.reference}>
      <div className={styles.mathReference}><Latex value={label} /></div>
      <button className={styles.iconButton} onClick={() => setEditing(!editing)} disabled={busy}
        aria-label="Edit LaTeX" title="Edit LaTeX" aria-expanded={editing}><Pencil size={15} /></button>
    </div>
    {editing && <form className={styles.editLabel} onSubmit={(event) => { event.preventDefault(); if (valid) setEditing(false); }}>
      <input id="symbol-latex" aria-label="Symbol LaTeX" aria-invalid={!valid} autoFocus maxLength={80}
        value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy} />
      <button className={styles.iconButton} type="submit" disabled={!valid || busy} aria-label="Done" title="Done"><Check size={18} /></button>
      {!valid && <span className={styles.inlineError}>Invalid LaTeX</span>}
    </form>}
    <div className={styles.sampleStage}>
      <img src={sample.image} alt={`Cropped sample: ${sample.latex}`} draggable={false}
        onLoad={() => setLoaded(true)} onError={() => setImageError(true)} />
    </div>
    {imageError && <p role="alert" className={styles.inlineError}>Could not load the image. Reload to review this sample.</p>}
    <div className={styles.decisions}>
      <button className={styles.secondaryButton} onClick={() => onDecide("rejected", valid ? label : sample.latex)} disabled={busy}>
        <kbd>←</kbd>Reject
      </button>
      <button className={styles.primaryButton} onClick={() => onDecide("accepted", label)} disabled={busy || !canAccept || editing}>
        Accept<kbd>→</kbd>
      </button>
      <button className={`${styles.secondaryButton} ${styles.issueButton}`} disabled={busy || !canAccept || editing}
        onClick={() => onDecide("rejected", label, "incorrect-outline")} aria-label={issueLabels["incorrect-outline"]}>
        <kbd>↑</kbd><span>Correct symbol<br />Wrong outline</span>
      </button>
      <button className={`${styles.secondaryButton} ${styles.issueButton}`} disabled={busy || !canAccept || editing}
        onClick={() => onDecide("rejected", label, "incorrect-symbol")} aria-label={issueLabels["incorrect-symbol"]}>
        <span>Correct outline<br />Wrong symbol</span><kbd>↓</kbd>
      </button>
    </div>
    <details className={styles.context}>
      <summary>Context</summary>
      <img src={sample.context} alt={`Source context, page ${sample.source.page}`}
        onLoad={() => setContextLoaded(true)} onError={() => setImageError(true)} />
      <span>{sample.source.file} · {sample.source.page}</span>
    </details>
  </section>;
}

export function HandwritingReview({ datasetId }: { datasetId: string }) {
  const [session, setSession] = useState<LibrarySession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("queue");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(60);
  const locked = useRef(false);
  const stats = useMemo(() => session ? datasetStats(session.dataset, session.review) : null, [session]);
  const sample = session?.dataset.samples.find((item) => item.id === selectedId)
    ?? session?.dataset.samples.find((item) => !session.review.decisions[item.id]);

  useEffect(() => {
    let active = true;
    loadDataset(datasetId).then((saved) => {
      if (!active) return;
      if (saved) {
        setSession(saved);
        if (!saved.dataset.samples.some((item) => !saved.review.decisions[item.id])) setMode("gallery");
      }
    }).catch(() => { if (active) setError("Could not load the dataset. Reload to try again."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [datasetId]);

  const persist = useCallback(async (action: ReviewCommand, after?: (result: ReviewUpdate) => void) => {
    if (!session || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const result = await updateReview(datasetId, { ...action, expectedVersion: session.version });
      setSession({ ...session, review: result.review, version: result.version });
      after?.(result);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save the decision. Try again."); }
    finally { locked.current = false; setBusy(false); }
  }, [datasetId, session]);

  const onDecide = useCallback((status: Decision["status"], label: string, issue?: ReviewIssue) => {
    if (!session || !sample || locked.current) return;
    if (status === "accepted" && !math(label).valid) return;
    void persist({ type: "decide", sampleId: sample.id, status, latex: label, issue }, ({ review }) => {
      const start = session.dataset.samples.findIndex((item) => item.id === sample.id);
      const ordered = [...session.dataset.samples.slice(start + 1), ...session.dataset.samples.slice(0, start)];
      const next = ordered.find((item) => !review.decisions[item.id]);
      setSelectedId(next?.id ?? null);
      if (!next) { setMode("gallery"); setFilter("all"); }
    });
  }, [persist, sample, session]);

  function undo() {
    void persist({ type: "undo" }, (result) => { setSelectedId(result.selectedId ?? null); setMode("queue"); });
  }

  function approve() { void persist({ type: "approve" }); }

  const filtered = useMemo(() => session?.dataset.samples.filter((item) => {
    const decision = session.review.decisions[item.id];
    return (filter === "all" || (decision?.status ?? "pending") === filter)
      && (decision?.latex ?? item.latex).toLowerCase().includes(search.trim().toLowerCase());
  }) ?? [], [filter, search, session]);

  return <main className={styles.app} lang="en">
    <header className={styles.topbar}>
      <Link href="/dev/dataset/labeling" className={styles.brand}><ArrowLeft size={17} />Datasets</Link>
      {session && <nav className={styles.nav} aria-label="Review views">
        <button aria-current={mode === "queue" ? "page" : undefined}
          onClick={() => { setMode("queue"); setSelectedId(null); }} disabled={busy}>Review</button>
        <button aria-current={mode === "gallery" ? "page" : undefined}
          onClick={() => setMode("gallery")} disabled={busy}>All samples</button>
      </nav>}
      <div className={styles.tools}>
        {(busy || loading) && <LoaderCircle size={17} className={styles.spinner} role="status" aria-label={loading ? "Loading" : "Saving"} />}
        <Link href="/dev" className={styles.iconButton} aria-label="Dev home" title="Dev home"><Home size={18} /></Link>
      </div>
    </header>
    {session && <h1 className={styles.datasetName}>{session.name}</h1>}
    <div className={mode === "gallery" && session ? styles.galleryContent : styles.content}>
      {error && <div className={styles.error} role="alert">{error}
        <button className={styles.secondaryButton} onClick={() => window.location.reload()}>Reload</button>
      </div>}
      {session && mode === "queue" && sample && <ReviewCard key={sample.id + ":" + session.review.revision} sample={sample}
        decision={session.review.decisions[sample.id]} index={session.dataset.samples.findIndex((item) => item.id === sample.id)}
        total={session.dataset.samples.length} busy={busy} onDecide={onDecide} onUndo={undo} canUndo={session.review.history.length > 0} />}

      {session && mode === "queue" && !sample && <div className={styles.empty}>
        <Check size={24} aria-label="All samples reviewed" />
        <button className={styles.primaryButton} onClick={() => setMode("gallery")}>All samples</button>
      </div>}

      {session && stats && mode === "gallery" && <>
        <div className={styles.galleryToolbar}>
          <div className={styles.filters} role="group" aria-label="Decision filter">
            {(["all", "pending", "accepted", "rejected"] as Filter[]).map((value) => <button key={value} aria-pressed={filter === value}
              onClick={() => { setFilter(value); setVisibleCount(60); }}>
              {value === "all" ? "All" : value === "pending" ? "Pending" : value === "accepted" ? "Accepted" : "Rejected"}
            </button>)}
          </div>
          <input aria-label="Search LaTeX" placeholder="LaTeX" value={search}
            onChange={(event) => { setSearch(event.target.value); setVisibleCount(60); }} />
        </div>
        <details className={styles.coverage}>
          <summary>Symbols</summary>
          <div>{stats.coverage.map((group) => <button key={group.latex} className={group.accepted >= MIN_EXAMPLES ? styles.accepted : styles.pending}
            onClick={() => { setSearch(group.latex); setFilter("all"); setVisibleCount(60); }}
            title={group.accepted >= MIN_EXAMPLES ? "Enough accepted samples" : "At least " + MIN_EXAMPLES + " accepted samples needed"}>
            <Latex value={group.latex} /><span>{group.accepted}/{MIN_EXAMPLES}</span>
          </button>)}</div>
        </details>
        <div className={styles.gallery}>
          {filtered.slice(0, visibleCount).map((item) => {
            const decision = session.review.decisions[item.id], status = decision?.status ?? "pending";
            return <button className={styles.galleryCard} key={item.id} disabled={busy}
              aria-label={"Review " + (decision?.latex ?? item.latex) + ", " + decisionLabel(decision) + ", " + item.id}
              title={decisionLabel(decision)}
              onClick={() => { setSelectedId(item.id); setMode("queue"); }}>
              <div><Latex value={decision?.latex ?? item.latex} />
                <span className={styles[status]} title={decisionLabel(decision)} aria-label={decisionLabel(decision)}>
                  {decision?.issue ? <span className={styles.issueMark}>{decision.issue === "incorrect-outline" ? "↑" : "↓"}</span>
                    : status === "accepted" ? <Check size={16} /> : status === "rejected" ? <X size={16} /> : <span className={styles.dot} />}
                </span>
              </div>
              <img src={item.image} alt={"Sample " + (decision?.latex ?? item.latex)} loading="lazy" />
            </button>;
          })}
        </div>
        {!filtered.length && <p className={styles.noResults}>No samples</p>}
        {filtered.length > visibleCount && <button className={styles.secondaryButton}
          onClick={() => setVisibleCount((count) => count + 60)}>Show more</button>}
        <footer className={styles.galleryFooter}>
          <button className={styles.iconButton} onClick={undo} disabled={busy || !session.review.history.length}
            aria-label="Undo last decision" title="Undo last decision"><RotateCcw size={17} /></button>
          <span className={styles.finalCount}>{stats.pending ? "Remaining: " + stats.pending
            : !stats.eligible.length ? "Need " + MIN_EXAMPLES + " accepted samples of one symbol"
            : "For export: " + stats.exportable}</span>
          {session.review.approvedAt
            ? <button className={styles.primaryButton} disabled={busy} onClick={() => {
              try { download(exportDataset(session), "handwriting-approved-" + session.fingerprint.slice(0, 10) + ".json"); }
              catch (err) { setError(err instanceof Error ? err.message : "Could not export the dataset."); }
            }}><Download size={17} />Download dataset</button>
            : <button className={styles.primaryButton} disabled={busy || stats.pending > 0 || !stats.eligible.length}
              onClick={approve}>Approve dataset</button>}
        </footer>
      </>}
    </div>
  </main>;
}
