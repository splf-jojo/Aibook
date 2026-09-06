"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DatasetSummary } from "@/lib/handwriting-library";
import { canvasHandwritingCatalog, canvasHandwritingDataset, chooseHandwriting, HandwritingAccessError, handwritingIssue, readyHandwriting,
  type HandwritingChoice, type HandwritingIssue, type HandwritingSnapshot } from "@/lib/canvas-handwriting";
import styles from "./canvas-handwriting.module.css";

const text = {
  ru: { handwriting: "Почерк", auto: "Автоматически", font: "Шрифт", connect: "Подключить почерк", refresh: "Обновить",
    signIn: "Войдите в AIbook. Пока используется шрифт.", unavailable: "Почерк недоступен. Используется шрифт.",
    notReady: "Готовый почерк пока не опубликован. Используется шрифт.", missing: "Шрифтом", layout: "Часть решения выведена шрифтом.",
    undo: "Отменить решение", redo: "Вернуть решение", missingChoice: "Выбранный набор недоступен" },
  en: { handwriting: "Handwriting", auto: "Automatic", font: "Font", connect: "Connect handwriting", refresh: "Refresh",
    signIn: "Sign in to AIbook. Using font for now.", unavailable: "Handwriting is unavailable. Using font.",
    notReady: "No published handwriting is ready. Using font for now.", missing: "Font symbols", layout: "Part of the solution uses font.",
    undo: "Undo solution", redo: "Redo solution", missingChoice: "Selected dataset unavailable" },
  zh: { handwriting: "笔迹", auto: "自动", font: "字体", connect: "连接笔迹", refresh: "刷新",
    signIn: "请登录 AIbook。暂时使用字体。", unavailable: "笔迹不可用，暂时使用字体。",
    notReady: "尚无已发布的笔迹。暂时使用字体。", missing: "使用字体的符号", layout: "部分解答使用字体显示。",
    undo: "撤销解答", redo: "恢复解答", missingChoice: "所选数据集不可用" },
};

export function useCanvasHandwriting(token: string, canvasId: string) {
  const [choice, setChoice] = useState<HandwritingChoice>("auto");
  const [items, setItems] = useState<DatasetSummary[]>([]);
  const [issue, setIssue] = useState<HandwritingIssue>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const serial = useRef(0);
  const storageKey = `aibook-canvas-handwriting-v1:${canvasId}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      setChoice(saved && (/^[a-f0-9]{64}$/.test(saved) || ["font", "auto"].includes(saved)) ? saved : "auto");
    } catch { /* The in-memory choice still works when storage is disabled. */ }
  }, [storageKey]);
  const changeChoice = (value: string) => {
    setChoice(value); setIssue(null);
    try { localStorage.setItem(storageKey, value); } catch { /* Optional preference only. */ }
  };
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const current = ++serial.current;
    setLoading(true);
    try {
      const catalog = await canvasHandwritingCatalog(token, signal);
      if (current !== serial.current || signal?.aborted) return;
      setItems(readyHandwriting(catalog)); setAvailable(true); setIssue(null);
    } catch (error) {
      if (current !== serial.current || signal?.aborted) return;
      setItems([]);
      setAvailable(!(error instanceof HandwritingAccessError && error.status === 404));
      setIssue(handwritingIssue(error));
    } finally { if (current === serial.current && !signal?.aborted) setLoading(false); }
  }, [token]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const focus = () => { if (document.visibilityState === "visible") void refresh(controller.signal); };
    window.addEventListener("focus", focus);
    return () => { controller.abort(); serial.current++; window.removeEventListener("focus", focus); };
  }, [refresh]);
  const loadForSolution = async (signal: AbortSignal) => {
    if (choice === "font") { setIssue(null); return null; }
    try {
      const catalog = await canvasHandwritingCatalog(token, signal);
      const selected = chooseHandwriting(catalog, choice);
      if (!selected) {
        setIssue("not-ready");
        return null;
      }
      const dataset = await canvasHandwritingDataset(selected.id, token, signal);
      setIssue(null);
      return dataset;
    } catch (error) {
      if (signal.aborted) throw error;
      setIssue(handwritingIssue(error));
      return null;
    }
  };
  return { choice, changeChoice, items, issue, available, loading, refresh, loadForSolution };
}

export function CanvasHandwriting({ model, language, disabled, snapshots, historyState, onUndo, onRedo }: {
  model: ReturnType<typeof useCanvasHandwriting>;
  language: "ru" | "en" | "zh";
  disabled: boolean;
  snapshots: HandwritingSnapshot[];
  historyState?: "accepted" | "undone";
  onUndo: () => void;
  onRedo: () => void;
}) {
  const t = text[language], selected = chooseHandwriting(model.items, model.choice);
  const missing = [...new Set(snapshots.flatMap(snapshot => snapshot.fontSymbols))];
  const fallback = snapshots.some(snapshot => snapshot.fallbackReason);
  if (!model.available && !historyState && !snapshots.length) return null;
  return <div className={styles.panel}>
    {model.available && <div className={styles.row}>
      <label htmlFor="canvas-handwriting-choice">{t.handwriting}</label>
      <select id="canvas-handwriting-choice" value={model.choice} disabled={disabled || model.loading} onChange={event => model.changeChoice(event.target.value)}>
        <option value="auto">{selected && model.choice === "auto" ? `${t.auto} · ${selected.name}` : t.auto}</option>
        <option value="font">{t.font}</option>
        {model.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        {!["auto", "font"].includes(model.choice) && !model.items.some(item => item.id === model.choice) && <option value={model.choice}>{t.missingChoice}</option>}
      </select>
    </div>}
    {model.available && model.issue && model.choice !== "font" && <p role="status" className={styles.notice}>
      {model.issue === "sign-in" ? t.signIn : model.issue === "not-ready" ? t.notReady : t.unavailable}{" "}
      <a href="/handwriting" target="_blank" rel="noreferrer">{t.connect}</a>{" "}
      <button type="button" disabled={disabled || model.loading} onClick={() => void model.refresh()}>{t.refresh}</button>
    </p>}
    {missing.length > 0 && <details className={styles.notice}><summary>{t.missing}: {missing.length}</summary><p>{missing.join(" · ")}</p></details>}
    {fallback && <p className={styles.notice}>{t.layout}</p>}
    {historyState && <button className={styles.history} type="button" disabled={disabled}
      onClick={historyState === "accepted" ? onUndo : onRedo}>{historyState === "accepted" ? t.undo : t.redo}</button>}
  </div>;
}
