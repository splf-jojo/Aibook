"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAnalysis, startAnalysis, publishDataset, type AnalysisPreview } from "@/lib/handwriting-library";

export function useHandwritingAnalysis(datasetId: string, pauseRefresh = false) {
  const [data, setData] = useState<AnalysisPreview | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const active = useRef(false), request = useRef(0), locked = useRef(false), paused = useRef(pauseRefresh);
  paused.current = pauseRefresh;
  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const result = await loadAnalysis(datasetId);
      if (active.current && current === request.current && !paused.current) { setData(result); setError(""); }
    } catch (err) { if (active.current && current === request.current) setError(err instanceof Error ? err.message : "Could not load symbols."); }
  }, [datasetId]);
  useEffect(() => {
    active.current = true; void refresh();
    const focus = () => { if (!paused.current && document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { active.current = false; request.current++; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [refresh]);
  const running = data?.status === "queued" || data?.status === "running";
  useEffect(() => {
    if (!running) return;
    let pending = false;
    const timer = window.setInterval(async () => { if (pending || paused.current) return; pending = true; await refresh(); pending = false; }, 1500);
    return () => window.clearInterval(timer);
  }, [running, refresh]);
  const act = async (action: "analyze" | "publish") => {
    if (!data || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try { await (action === "analyze" ? startAnalysis : publishDataset)(datasetId, data.sourceVersion); await refresh(); }
    catch (err) { await refresh(); if (active.current) setError(err instanceof Error ? err.message : "Request failed. Try again."); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  };
  return { data, error, busy, running, refresh, analyze: () => act("analyze"), publish: () => act("publish") };
}
