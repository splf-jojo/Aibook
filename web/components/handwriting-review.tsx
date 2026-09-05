"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import { Check, CheckCheck, ChevronLeft, Download, FileUp, Grid2X2, NotebookPen, RotateCcw, ScanLine, X } from "lucide-react";
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

  return <div className={styles.reviewLayout}>
    <section className={styles.card} aria-label="Проверка символа">
      <div className={styles.cardTop}>
        <span className={styles.eyebrow}>ОБРАЗЕЦ {String(index + 1).padStart(2, "0")} <span>/ {total}</span></span>
        <span className={`${styles.badge} ${styles[decision?.status ?? "pending"]}`}>{statusLabels[decision?.status ?? "pending"]}</span>
      </div>
      <div className={styles.reference}>
        <span className={styles.smallLabel}>Предполагаемый символ</span>
        <div className={styles.mathReference}><Latex value={label} /></div>
        <button className={styles.codeButton} onClick={() => setEditing(!editing)} disabled={busy} aria-expanded={editing}>
          <code>{label}</code><span>Изменить LaTeX</span>
        </button>
        {editing && <div className={styles.editLabel}>
          <label htmlFor="symbol-latex">Правильная подпись</label>
          <input id="symbol-latex" autoFocus maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} disabled={busy} />
          <p>{valid ? "Новая подпись сохранится вместе с решением." : "Введите корректный LaTeX."}</p>
          <button onClick={() => setEditing(false)} disabled={!valid || busy}>Готово</button>
        </div>}
      </div>
      <div className={styles.sampleStage}>
        <span className={styles.stageLabel}>ИЗ ТВОИХ ЗАПИСЕЙ</span>
        <img src={sample.image} alt={`Вырезанный образец: ${sample.latex}`} draggable={false}
          onLoad={() => setLoaded(true)} onError={() => setImageError(true)} />
        <span className={styles.stageCorner} aria-hidden="true"><ScanLine size={20} /></span>
      </div>
      {imageError && <p role="alert" className={styles.inlineError}>Не удалось показать изображение. Принять образец нельзя.</p>}
      <div className={styles.question}>
        <strong>Это верный символ и чистая вырезка?</strong>
        <p>Проверь подпись, целостность символа и отсутствие чужих штрихов.</p>
      </div>
      <div className={styles.decisions}>
        <button className={styles.rejectButton} onClick={() => onDecide("rejected", valid ? label : sample.latex)} disabled={busy}>
          <X size={20} /><span>Отклонить</span><kbd>←</kbd>
        </button>
        <button className={styles.acceptButton} onClick={() => onDecide("accepted", label)} disabled={busy || !canAccept || editing}>
          <Check size={20} /><span>Принять</span><kbd>→</kbd>
        </button>
      </div>
      <div className={styles.cardBottom}>
        <button onClick={onUndo} disabled={busy || !canUndo}><RotateCcw size={14} />Отменить последнее решение</button>
        <span>← / → на клавиатуре</span>
      </div>
    </section>
    <aside className={styles.sourcePanel}>
      <div className={styles.sourceTitle}><NotebookPen size={18} /><h2>Контекст записи</h2></div>
      <p>Сверь символ с окружающей формулой. Рамка показывает выбранную область.</p>
      <div className={styles.contextImage}>
        <img src={sample.context} alt={`Контекст образца на странице ${sample.source.page}`} onLoad={() => setContextLoaded(true)} onError={() => setImageError(true)} />
      </div>
      <dl className={styles.sourceMeta}>
        <div><dt>Документ</dt><dd>{sample.source.file}</dd></div>
        <div><dt>Страница</dt><dd>{sample.source.page}</dd></div>
      </dl>
      <div className={styles.note}>
        <span className={styles.smallLabel}>СОМНЕВАЕШЬСЯ?</span>
        <p>Отклоняй. Пропущенный образец лучше ошибочного. Решение можно изменить в общей галерее.</p>
      </div>
    </aside>
  </div>;
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
    try { void persist(approveDataset(session.dataset, session.review)); }
    catch (err) { setError(err instanceof Error ? err.message : "Не удалось принять датасет."); }
  }

  const filtered = useMemo(() => session?.dataset.samples.filter((item) => {
    const decision = session.review.decisions[item.id];
    return (filter === "all" || (decision?.status ?? "pending") === filter)
      && (decision?.latex ?? item.latex).toLowerCase().includes(search.trim().toLowerCase());
  }) ?? [], [filter, search, session]);

  return <main className={styles.app}>
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand}><span><NotebookPen size={21} /></span>AIbook</Link>
      <div className={styles.labLabel}>ЛАБОРАТОРИЯ ПОЧЕРКА</div>
      <nav className={styles.nav} aria-label="Разделы проверки">
        <button aria-current={mode === "queue" ? "page" : undefined} onClick={() => { setMode("queue"); setSelectedId(null); }} disabled={busy}>
          <ScanLine size={18} />Проверка<span>{stats?.pending ?? 0}</span>
        </button>
        <button aria-current={mode === "gallery" ? "page" : undefined} onClick={() => setMode("gallery")} disabled={busy}>
          <Grid2X2 size={18} />Все образцы<span>{session?.dataset.samples.length ?? 0}</span>
        </button>
      </nav>
      <div className={styles.sidebarProgress}>
        <div><span>ПРОГРЕСС ПРОВЕРКИ</span><strong>{stats ? Math.round((stats.accepted + stats.rejected) / session!.dataset.samples.length * 100) : 0}%</strong></div>
        <progress aria-label="Прогресс проверки" max={session?.dataset.samples.length ?? 1} value={(stats?.accepted ?? 0) + (stats?.rejected ?? 0)} />
        <dl>
          <div><dt><i className={styles.greenDot} />Приняты</dt><dd>{stats?.accepted ?? 0}</dd></div>
          <div><dt><i className={styles.redDot} />Отклонены</dt><dd>{stats?.rejected ?? 0}</dd></div>
          <div><dt><i />Осталось</dt><dd>{stats?.pending ?? 0}</dd></div>
        </dl>
      </div>
      <div className={styles.sidebarFooter}>
        <span className={styles.localBadge}>Локальная проверка</span>
        <p>Образцы и решения сохраняются в этом браузере. Очистка данных сайта удалит локальный прогресс.</p>
        <Link href="/"><ChevronLeft size={15} />Вернуться к заметкам</Link>
      </div>
    </aside>
    <div className={styles.workspace}>
      <header className={styles.topbar}>
        <span>Почерк <span>/</span> Human review</span>
        <div><span role="status" className={styles.saveStatus}>{loading ? "Загрузка…" : busy ? "Сохраняем…" : session ? "Сохранено в браузере" : "Набор не загружен"}</span>
          <button className={styles.secondaryButton} onClick={() => fileInput.current?.click()} disabled={busy || loading}><FileUp size={16} />Загрузить набор</button>
        </div>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Файл набора кандидатов" hidden onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file);
        }} />
      </header>
      <div className={styles.content}>
        {error && <div className={styles.error} role="alert">{error}<button onClick={() => setError("")} aria-label="Закрыть сообщение"><X size={16} /></button></div>}
        <div className={styles.heading}>
          <div><span className={styles.eyebrow}>ТВОЙ ПОЧЕРК. ТВОЁ РЕШЕНИЕ.</span>
            <h1>{mode === "queue" ? "Проверим каждый символ" : "Посмотри на набор целиком"}</h1>
            <p>{session ? session.dataset.name : "Собери библиотеку из проверенных образцов своих записей."}</p>
          </div>
          {session && <span className={styles.datasetBadge}>{session.review.approvedAt ? <CheckCheck size={16} /> : <span className={styles.pulseDot} />}{session.review.approvedAt ? "Датасет принят" : "Датасет на проверке"}</span>}
        </div>

        {!session && !loading && <section className={styles.empty}>
          <div className={styles.emptyIcon}><FileUp size={32} /></div>
          <h2>Начни с набора кандидатов</h2>
          <p>Загрузи JSON с вырезками из заметок и предполагаемыми LaTeX-подписями. Все новые образцы поступят на проверку.</p>
          <button className={styles.acceptButton} onClick={() => fileInput.current?.click()} disabled={busy}><FileUp size={18} />Выбрать файл</button>
          <div className={styles.steps}><span><b>1</b>Прими или отклони</span><span><b>2</b>Проверь общую галерею</span><span><b>3</b>Прими датасет</span></div>
          <p className={styles.emptyFootnote}>Файл обрабатывается локально. Загрузка в облако не требуется.</p>
        </section>}

        {session && mode === "queue" && sample && <ReviewCard key={`${sample.id}:${session.review.revision}`} sample={sample}
          decision={session.review.decisions[sample.id]} index={session.dataset.samples.findIndex((item) => item.id === sample.id)}
          total={session.dataset.samples.length} busy={busy} onDecide={onDecide} onUndo={undo} canUndo={session.review.history.length > 0} />}

        {session && mode === "queue" && !sample && <section className={styles.empty}>
          <div className={styles.emptyIcon}><CheckCheck size={32} /></div><h2>Все образцы проверены</h2>
          <p>Осталось посмотреть на итоговую галерею и принять датасет.</p>
          <button className={styles.acceptButton} onClick={() => setMode("gallery")}><Grid2X2 size={18} />Открыть все образцы</button>
        </section>}

        {session && stats && mode === "gallery" && <>
          <section className={styles.summary} aria-label="Итог датасета">
            <div><span className={styles.smallLabel}>ОБРАЗЦЫ К ЭКСПОРТУ</span><strong>{stats.exportable}<small>Допущено символов: {stats.eligible.length}</small></strong>
              <p>В итоговый набор попадут символы с {MIN_EXAMPLES} и более принятыми образцами.</p></div>
            <div className={styles.finalActions}>
              {session.review.approvedAt ? <>
                <p className={styles.approvedMessage}><CheckCheck size={18} />Датасет принят. Изменение решения потребует повторной проверки.</p>
                <button className={styles.acceptButton} disabled={busy} onClick={() => {
                  try { download(exportDataset(session), `handwriting-approved-${session.fingerprint.slice(0, 10)}.json`); }
                  catch (err) { setError(err instanceof Error ? err.message : "Ошибка экспорта."); }
                }}><Download size={18} />Скачать датасет</button>
              </> : <>
                <label className={styles.finalCheckbox}>
                  <input type="checkbox" disabled={busy || stats.pending > 0 || !stats.eligible.length}
                    checked={session.review.inspectedRevision === session.review.revision}
                    onChange={(event) => void persist({ ...session.review, inspectedRevision: event.target.checked ? session.review.revision : null })} />
                  Я просмотрел все решения в галерее
                </label>
                <button className={styles.acceptButton} disabled={busy || stats.pending > 0 || !stats.eligible.length || session.review.inspectedRevision !== session.review.revision} onClick={approve}>
                  <CheckCheck size={18} />Принять датасет
                </button>
                <span className={styles.finalHint}>{stats.pending ? `Осталось проверить: ${stats.pending}` : !stats.eligible.length ? `Пока нет символов с ${MIN_EXAMPLES} принятыми примерами.` : "Экспорт включает только допущенные образцы."}</span>
              </>}
            </div>
          </section>
          <div className={styles.coverage} aria-label="Покрытие символов">
            {stats.coverage.map((group) => <button key={group.latex} className={group.accepted >= MIN_EXAMPLES ? styles.covered : styles.uncovered}
              onClick={() => { setSearch(group.latex); setFilter("all"); setVisibleCount(60); }} title={group.accepted >= MIN_EXAMPLES ? "Достаточно образцов" : "Недостаточно принятых образцов — не войдёт в датасет"}>
              <Latex value={group.latex} /><span>{group.accepted}/{MIN_EXAMPLES}</span>
            </button>)}
          </div>
          <div className={styles.galleryToolbar}>
            <div className={styles.filters} role="group" aria-label="Фильтр решений">
              {(["all", "pending", "accepted", "rejected"] as Filter[]).map((value) => <button key={value} aria-pressed={filter === value}
                onClick={() => { setFilter(value); setVisibleCount(60); }}>{value === "all" ? "Все" : value === "pending" ? "Не проверены" : value === "accepted" ? "Приняты" : "Отклонены"}</button>)}
            </div>
            <input aria-label="Поиск по LaTeX" placeholder="Найти символ по LaTeX" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(60); }} />
          </div>
          <p className={styles.galleryHint}>Нажми на образец, чтобы проверить его ещё раз. Показано {Math.min(visibleCount, filtered.length)} из {filtered.length}.</p>
          <div className={styles.gallery}>
            {filtered.slice(0, visibleCount).map((item) => {
              const decision = session.review.decisions[item.id], status = decision?.status ?? "pending";
              return <button className={styles.galleryCard} key={item.id} disabled={busy} aria-label={`Проверить ${decision?.latex ?? item.latex}, ${statusLabels[status]}, ${item.id}`}
                onClick={() => { setSelectedId(item.id); setMode("queue"); }}>
                <div><Latex value={decision?.latex ?? item.latex} /><span className={`${styles.badge} ${styles[status]}`}>{statusLabels[status]}</span></div>
                <img src={item.image} alt={`Образец ${decision?.latex ?? item.latex}`} loading="lazy" />
                <span>{item.source.file} · стр. {item.source.page}</span>
              </button>;
            })}
          </div>
          {!filtered.length && <p className={styles.noResults}>По этому фильтру образцов нет.</p>}
          {filtered.length > visibleCount && <button className={styles.secondaryButton} onClick={() => setVisibleCount((count) => count + 60)}>Показать ещё 60</button>}
          <div className={styles.galleryFooter}><button className={styles.secondaryButton} onClick={undo} disabled={busy || !session.review.history.length}><RotateCcw size={15} />Отменить последнее решение</button>
            <span>Одобрение вырезок — первый этап. Восстановление векторов и LaTeX → почерк подключаются отдельно.</span></div>
        </>}
      </div>
    </div>
  </main>;
}
