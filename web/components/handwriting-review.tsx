"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import { Check, Download, FileUp, LoaderCircle, Pencil, RotateCcw, X } from "lucide-react";
import {
  approveDataset, datasetFingerprint, datasetStats, decide, exportDataset, freshReview, MAX_IMPORT_BYTES,
  MIN_EXAMPLES, parseDataset, undoDecision, type Candidate, type Decision, type Review, type ReviewSession,
} from "@/lib/handwriting-dataset";
import { readSession, saveSession } from "@/lib/handwriting-review-storage";
import styles from "./handwriting-review.module.css";

type Mode = "queue" | "gallery";
type Filter = "all" | "pending" | "accepted" | "rejected";
const statusLabels = { pending: "Не проверен", accepted: "Принят", rejected: "Отклонён" };

function math(latex: string): { html: string; valid: boolean } {
  try {
    return { html: katex.renderToString(latex, { throwOnError: true, trust: false, strict: "error", output: "html", maxExpand: 100, maxSize: 5 }), valid: true };
  } catch { return { html: "", valid: false }; }
}

function Latex({ value }: { value: string }) {
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
  onDecide: (status: Decision["status"], latex: string) => void; onUndo: () => void; canUndo: boolean;
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, canAccept, editing, label, onDecide, sample.latex, valid]);

  return <section className={styles.card} aria-label="Проверка символа" aria-busy={busy}>
    <div className={styles.cardTop}>
      <span aria-label={`Образец ${index + 1} из ${total}`}>{index + 1} / {total}</span>
      {decision && <span className={styles[decision.status]}>{statusLabels[decision.status]}</span>}
      <button className={styles.iconButton} onClick={onUndo} disabled={busy || !canUndo}
        aria-label="Отменить последнее решение" title="Отменить последнее решение"><RotateCcw size={17} /></button>
    </div>
    <div className={styles.reference}>
      <div className={styles.mathReference}><Latex value={label} /></div>
      <button className={styles.iconButton} onClick={() => setEditing(!editing)} disabled={busy}
        aria-label="Изменить LaTeX" title="Изменить LaTeX" aria-expanded={editing}><Pencil size={15} /></button>
    </div>
    {editing && <form className={styles.editLabel} onSubmit={(event) => { event.preventDefault(); if (valid) setEditing(false); }}>
      <input id="symbol-latex" aria-label="LaTeX символа" aria-invalid={!valid} autoFocus maxLength={80}
        value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy} />
      <button className={styles.iconButton} type="submit" disabled={!valid || busy} aria-label="Готово" title="Готово"><Check size={18} /></button>
      {!valid && <span className={styles.inlineError}>Некорректный LaTeX</span>}
    </form>}
    <div className={styles.sampleStage}>
      <img src={sample.image} alt={`Вырезанный образец: ${sample.latex}`} draggable={false}
        onLoad={() => setLoaded(true)} onError={() => setImageError(true)} />
    </div>
    {imageError && <p role="alert" className={styles.inlineError}>Не удалось показать изображение. Принять образец нельзя.</p>}
    <div className={styles.decisions}>
      <button className={styles.secondaryButton} onClick={() => onDecide("rejected", valid ? label : sample.latex)} disabled={busy}>
        <kbd>←</kbd>Отклонить
      </button>
      <button className={styles.primaryButton} onClick={() => onDecide("accepted", label)} disabled={busy || !canAccept || editing}>
        Принять<kbd>→</kbd>
      </button>
    </div>
    <details className={styles.context}>
      <summary>Контекст</summary>
      <img src={sample.context} alt={`Контекст образца на странице ${sample.source.page}`}
        onLoad={() => setContextLoaded(true)} onError={() => setImageError(true)} />
      <span>{sample.source.file} · {sample.source.page}</span>
    </details>
  </section>;
}

export function HandwritingReview() {
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("queue");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(60);
  const fileInput = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const stats = useMemo(() => session ? datasetStats(session.dataset, session.review) : null, [session]);
  const sample = session?.dataset.samples.find((item) => item.id === selectedId)
    ?? session?.dataset.samples.find((item) => !session.review.decisions[item.id]);

  useEffect(() => {
    let active = true;
    readSession().then((saved) => {
      if (!active) return;
      if (saved) {
        setSession(saved);
        if (!saved.dataset.samples.some((item) => !saved.review.decisions[item.id])) setMode("gallery");
      }
    }).catch(() => { if (active) setError("Не удалось открыть локальное хранилище. Разрешите сохранение данных для этой страницы."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const persist = useCallback(async (review: Review, after?: () => void) => {
    if (!session || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    const next = { ...session, review };
    try { await saveSession(next, session); setSession(next); after?.(); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось сохранить решение."); }
    finally { locked.current = false; setBusy(false); }
  }, [session]);

  async function importFile(file: File) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Максимальный размер набора — 40 МБ.");
      const dataset = parseDataset(JSON.parse(await file.text()));
      if (dataset.samples.some((item) => !math(item.latex).valid)) throw new Error("В наборе есть некорректный LaTeX. Исправьте подписи в файле перед импортом.");
      const fingerprint = await datasetFingerprint(dataset);
      const saved = await readSession(fingerprint);
      const next = saved ?? { dataset, fingerprint, review: freshReview() };
      await saveSession(next, saved);
      setSession(next); setSelectedId(null); setFilter("all"); setSearch(""); setVisibleCount(60);
      setMode(dataset.samples.some((item) => !next.review.decisions[item.id]) ? "queue" : "gallery");
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось загрузить набор."); }
    finally { locked.current = false; setBusy(false); }
  }

  const onDecide = useCallback((status: Decision["status"], label: string) => {
    if (!session || !sample || locked.current) return;
    if (status === "accepted" && !math(label).valid) return;
    const review = decide(session.review, sample, status, label);
    void persist(review, () => {
      const start = session.dataset.samples.findIndex((item) => item.id === sample.id);
      const ordered = [...session.dataset.samples.slice(start + 1), ...session.dataset.samples.slice(0, start)];
      const next = ordered.find((item) => !review.decisions[item.id]);
      setSelectedId(next?.id ?? null);
      if (!next) { setMode("gallery"); setFilter("all"); }
    });
  }, [persist, sample, session]);

  function undo() {
    if (!session) return;
    const result = undoDecision(session.review);
    if (result) void persist(result.review, () => { setSelectedId(result.id); setMode("queue"); });
  }

  function approve() {
    if (!session) return;
    // The explicit action in the gallery records final inspection and approval together.
    try { void persist(approveDataset(session.dataset, { ...session.review, inspectedRevision: session.review.revision })); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось принять датасет."); }
  }

  const filtered = useMemo(() => session?.dataset.samples.filter((item) => {
    const decision = session.review.decisions[item.id];
    return (filter === "all" || (decision?.status ?? "pending") === filter)
      && (decision?.latex ?? item.latex).toLowerCase().includes(search.trim().toLowerCase());
  }) ?? [], [filter, search, session]);

  return <main className={styles.app}>
    <header className={styles.topbar}>
      <Link href="/" className={styles.brand}>AIbook</Link>
      {session && <nav className={styles.nav} aria-label="Разделы проверки">
        <button aria-current={mode === "queue" ? "page" : undefined}
          onClick={() => { setMode("queue"); setSelectedId(null); }} disabled={busy}>Проверка</button>
        <button aria-current={mode === "gallery" ? "page" : undefined}
          onClick={() => setMode("gallery")} disabled={busy}>Все образцы</button>
      </nav>}
      <div className={styles.tools}>
        {(busy || loading) && <LoaderCircle size={17} className={styles.spinner} role="status" aria-label={loading ? "Загрузка" : "Сохранение"} />}
        {session && <button className={styles.iconButton} onClick={() => fileInput.current?.click()} disabled={busy || loading}
          aria-label="Открыть набор" title="Открыть набор"><FileUp size={18} /></button>}
      </div>
    </header>
    <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Файл набора кандидатов" hidden onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file);
    }} />
    <div className={mode === "gallery" && session ? styles.galleryContent : styles.content}>
      {error && <div className={styles.error} role="alert">{error}
        <button className={styles.iconButton} onClick={() => setError("")} aria-label="Закрыть сообщение" title="Закрыть сообщение"><X size={16} /></button>
      </div>}
      {!session && !loading && <div className={styles.empty}>
        <button className={styles.primaryButton} onClick={() => fileInput.current?.click()} disabled={busy}>
          <FileUp size={18} />Открыть набор
        </button>
      </div>}

      {session && mode === "queue" && sample && <ReviewCard key={sample.id + ":" + session.review.revision} sample={sample}
        decision={session.review.decisions[sample.id]} index={session.dataset.samples.findIndex((item) => item.id === sample.id)}
        total={session.dataset.samples.length} busy={busy} onDecide={onDecide} onUndo={undo} canUndo={session.review.history.length > 0} />}

      {session && mode === "queue" && !sample && <div className={styles.empty}>
        <Check size={24} aria-label="Все образцы проверены" />
        <button className={styles.primaryButton} onClick={() => setMode("gallery")}>Все образцы</button>
      </div>}

      {session && stats && mode === "gallery" && <>
        <div className={styles.galleryToolbar}>
          <div className={styles.filters} role="group" aria-label="Фильтр решений">
            {(["all", "pending", "accepted", "rejected"] as Filter[]).map((value) => <button key={value} aria-pressed={filter === value}
              onClick={() => { setFilter(value); setVisibleCount(60); }}>
              {value === "all" ? "Все" : value === "pending" ? "Не проверены" : value === "accepted" ? "Приняты" : "Отклонены"}
            </button>)}
          </div>
          <input aria-label="Поиск по LaTeX" placeholder="LaTeX" value={search}
            onChange={(event) => { setSearch(event.target.value); setVisibleCount(60); }} />
        </div>
        <details className={styles.coverage}>
          <summary>Символы</summary>
          <div>{stats.coverage.map((group) => <button key={group.latex} className={group.accepted >= MIN_EXAMPLES ? styles.accepted : styles.pending}
            onClick={() => { setSearch(group.latex); setFilter("all"); setVisibleCount(60); }}
            title={group.accepted >= MIN_EXAMPLES ? "Достаточно образцов" : "Нужно минимум " + MIN_EXAMPLES + " принятых образца"}>
            <Latex value={group.latex} /><span>{group.accepted}/{MIN_EXAMPLES}</span>
          </button>)}</div>
        </details>
        <div className={styles.gallery}>
          {filtered.slice(0, visibleCount).map((item) => {
            const decision = session.review.decisions[item.id], status = decision?.status ?? "pending";
            return <button className={styles.galleryCard} key={item.id} disabled={busy}
              aria-label={"Проверить " + (decision?.latex ?? item.latex) + ", " + statusLabels[status] + ", " + item.id}
              onClick={() => { setSelectedId(item.id); setMode("queue"); }}>
              <div><Latex value={decision?.latex ?? item.latex} />
                <span className={styles[status]} title={statusLabels[status]} aria-label={statusLabels[status]}>
                  {status === "accepted" ? <Check size={16} /> : status === "rejected" ? <X size={16} /> : <span className={styles.dot} />}
                </span>
              </div>
              <img src={item.image} alt={"Образец " + (decision?.latex ?? item.latex)} loading="lazy" />
            </button>;
          })}
        </div>
        {!filtered.length && <p className={styles.noResults}>Нет образцов</p>}
        {filtered.length > visibleCount && <button className={styles.secondaryButton}
          onClick={() => setVisibleCount((count) => count + 60)}>Показать ещё</button>}
        <footer className={styles.galleryFooter}>
          <button className={styles.iconButton} onClick={undo} disabled={busy || !session.review.history.length}
            aria-label="Отменить последнее решение" title="Отменить последнее решение"><RotateCcw size={17} /></button>
          <span className={styles.finalCount}>{stats.pending ? "Осталось: " + stats.pending
            : !stats.eligible.length ? "Нужно " + MIN_EXAMPLES + " принятых образца одного символа"
            : "К экспорту: " + stats.exportable}</span>
          {session.review.approvedAt
            ? <button className={styles.primaryButton} disabled={busy} onClick={() => {
              try { download(exportDataset(session), "handwriting-approved-" + session.fingerprint.slice(0, 10) + ".json"); }
              catch (err) { setError(err instanceof Error ? err.message : "Ошибка экспорта."); }
            }}><Download size={17} />Скачать датасет</button>
            : <button className={styles.primaryButton} disabled={busy || stats.pending > 0 || !stats.eligible.length}
              onClick={approve}>Принять датасет</button>}
        </footer>
      </>}
    </div>
  </main>;
}
