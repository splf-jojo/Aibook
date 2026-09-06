"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { TOKEN_STORAGE_KEY } from "@/lib/canvas-api";
import type { DatasetSummary, LibrarySession } from "@/lib/handwriting-library";
import type { WritingDataset } from "@/lib/handwriting-writing";
import { Latex } from "./handwriting-review";
import styles from "./handwriting-review.module.css";

const copy = {
  en: { title: "Handwriting", ready: "Published", mine: "My datasets", empty: "No datasets", signIn: "Sign in to AIbook", load: "Loading…", download: "Download", preview: "Preview", retry: "Retry", error: "Could not load handwriting.", samples: "samples", review: "reviewed", back: "Back" },
  ru: { title: "Почерк", ready: "Опубликованные", mine: "Мои датасеты", empty: "Нет датасетов", signIn: "Войти в AIbook", load: "Загрузка…", download: "Скачать", preview: "Посмотреть", retry: "Повторить", error: "Не удалось загрузить почерк.", samples: "образцов", review: "проверено", back: "Назад" },
  zh: { title: "笔迹", ready: "已发布", mine: "我的数据集", empty: "暂无数据集", signIn: "登录 AIbook", load: "加载中…", download: "下载", preview: "预览", retry: "重试", error: "无法加载笔迹。", samples: "样本", review: "已审核", back: "返回" },
};
export function HandwritingCatalog() {
  const [language, setLanguage] = useState<keyof typeof copy>("en"), t = copy[language];
  const [token, setToken] = useState(""), [tab, setTab] = useState<"fonts" | "datasets">("fonts");
  const [items, setItems] = useState<DatasetSummary[]>([]), [font, setFont] = useState<WritingDataset | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [reload, setReload] = useState(0);
  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
    const saved = localStorage.getItem("canvas_app_language");
    if (saved === "en" || saved === "ru" || saved === "zh") setLanguage(saved);
  }, []);
  async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/api/handwriting/${path}`, { signal, cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) { setToken(""); throw new Error(t.signIn); }
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? t.error);
    return value;
  }
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController(); setBusy(true); setError(""); setFont(null);
    void request<DatasetSummary[]>(tab, controller.signal).then(setItems).catch(err => {
      if (!controller.signal.aborted) setError(err.message);
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
    // The token and tab define this request; language only changes messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tab, reload]);
  async function open(item: DatasetSummary) {
    setBusy(true); setError("");
    try {
      if (tab === "fonts") setFont(await request<WritingDataset>(`fonts/${item.id}`));
      else {
        const [session, source] = await Promise.all([request<LibrarySession>(`datasets/${item.id}`), request<unknown>(`datasets/${item.id}/source`)]);
        const url = URL.createObjectURL(new Blob([JSON.stringify({ dataset: session.dataset, source, review: session.review, version: session.version })], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = `handwriting-${item.id.slice(0, 12)}.json`; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (err) { setError(err instanceof Error ? err.message : t.error); }
    finally { setBusy(false); }
  }
  return <main className={styles.app} lang={language}>
    <header className={styles.topbar}><Link href="/" className={styles.brand}>AIbook</Link></header>
    <div className={styles.libraryContent}>
      <div className={styles.libraryHeading}><h1>{t.title}</h1></div>
      {!token ? <Link href="/" className={styles.primaryButton}>{t.signIn}</Link> : <>
        <nav className={styles.tools}>{(["fonts", "datasets"] as const).map(value => <button key={value} aria-pressed={tab === value} disabled={busy} className={tab === value ? styles.primaryButton : styles.secondaryButton} onClick={() => setTab(value)}>{value === "fonts" ? t.ready : t.mine}</button>)}</nav>
        {error && <p role="alert" className={styles.error}>{error} <button onClick={() => setReload(reload + 1)}>{t.retry}</button></p>}
        {busy && <p role="status">{t.load}</p>}
        {!busy && !error && !items.length && <p>{t.empty}</p>}
        <div className={styles.datasetList}>{items.map(item => <div key={item.id} className={styles.datasetRow}>
          <div><span className={styles.datasetTitle}>{item.name}</span><span className={styles.datasetMeta}>{tab === "fonts" ? `${item.exportable} ${t.samples}` : `${item.total - item.pending} / ${item.total} ${t.review}`}</span></div>
          <button className={styles.secondaryButton} disabled={busy} onClick={() => void open(item)}>{tab === "fonts" ? t.preview : t.download}</button>
        </div>)}</div>
        {font && <section><h2>{font.name}</h2><div className={styles.analysisSamples}>{font.glyphs.map(glyph => <figure key={glyph.latex}>
          <Latex value={glyph.latex} /><img src={glyph.image} alt={glyph.latex} style={{ maxWidth: 160, maxHeight: 100, objectFit: "contain" }} />
        </figure>)}</div></section>}
      </>}
    </div>
  </main>;
}
