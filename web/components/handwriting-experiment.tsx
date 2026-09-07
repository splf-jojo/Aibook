"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { loadExperiment, updateExperiment } from "@/lib/handwriting-library";
import type { Alignment, ControlPoint, ExperimentConfig, GlyphExperiment } from "@/lib/handwriting-experiment";
import css from "./handwriting-experiment.module.css";

export function HandwritingExperiment({ datasetId, latex, version, alignment, onPending }: {
  datasetId: string; latex: string; version: number; alignment: Alignment; onPending: (latex: string, pending: boolean) => void;
}) {
  const host = useRef<HTMLTableCellElement>(null), mounted = useRef(true), locked = useRef(false);
  const [visible, setVisible] = useState(false), [data, setData] = useState<GlyphExperiment | null>(null);
  const [config, setConfig] = useState<ExperimentConfig | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<string | null>(null);
  const dirty = Boolean(data && config && JSON.stringify(data.config) !== JSON.stringify(config));
  useEffect(() => {
    mounted.current = true;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    if (host.current) observer.observe(host.current);
    return () => { observer.disconnect(); mounted.current = false; };
  }, []);
  useEffect(() => {
    onPending(latex, dirty || busy);
    return () => onPending(latex, false);
  }, [onPending, latex, dirty, busy]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await loadExperiment(datasetId, latex, version, alignment, signal);
      if (mounted.current && !signal?.aborted) { setData(result); setConfig(result.config); setSelected(result.config.points[0]?.id ?? null); setError(""); }
    } catch (err) { if (mounted.current && !signal?.aborted) setError(err instanceof Error ? err.message : "Could not load experiment."); }
  }, [datasetId, latex, version, alignment]);
  useEffect(() => { if (!visible) return; const controller = new AbortController(); void reload(controller.signal); return () => controller.abort(); }, [reload, visible]);
  const save = useCallback(async (action: "save" | "generate") => {
    if (!data || !config || locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const result = await updateExperiment(datasetId, data, config, action);
      if (mounted.current) { setData(result); setConfig(result.config); }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Could not save experiment."); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }, [datasetId, data, config]);
  useEffect(() => {
    if (!dirty || busy || error || drag.current) return;
    const timer = window.setTimeout(() => void save("save"), 700);
    return () => window.clearTimeout(timer);
  }, [dirty, busy, error, save]);
  const patch = (value: Partial<ExperimentConfig>) => setConfig(c => c ? { ...c, ...value } : c);
  const point = config?.points.find(p => p.id === selected);
  const changePoint = (value: Partial<ControlPoint>) => { if (config) patch({ points: config.points.map(p => p.id === selected ? { ...p, ...value } : p) }); };
  function position(event: PointerEvent<SVGSVGElement>) {
    const matrix = event.currentTarget.getScreenCTM(); if (!matrix || !data) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.max(1, Math.min(data.width - 2, Math.round(point.x))), y: Math.max(1, Math.min(data.height - 2, Math.round(point.y))) };
  }
  function start(event: PointerEvent<SVGSVGElement>) {
    if (busy || !config) return;
    const positionHere = position(event); if (!positionHere) return;
    const closest = config.points.find(p => Math.hypot(p.x - positionHere.x, p.y - positionHere.y) < 7);
    if (closest) { setSelected(closest.id); drag.current = closest.id; event.currentTarget.setPointerCapture(event.pointerId); }
  }
  function addPoint() {
    if (!data || !config || config.points.length >= 32) return;
    // Start near the centre. Coordinates and Move are keyboard-accessible too.
    let x = Math.floor(data.width / 2), y = Math.floor(data.height / 2);
    while (config.points.some(p => Math.hypot(p.x - x, p.y - y) < 4)) { x += 4; if (x >= data.width - 2) { x = 2; y += 4; } }
    const id = `m-${crypto.randomUUID().slice(0, 12)}`;
    patch({ points: [...config.points, { id, x, y, kind: "manual", movable: false }] }); setSelected(id);
  }
  const stale = data?.generatedWith && config && JSON.stringify(data.generatedWith) !== JSON.stringify(config);
  return <>
    <td ref={host} className={css.cell}>
      {data && config ? <>
        <img className={css.glyph} src={data.thresholdImage} width={data.width} height={data.height} alt={`${latex} thresholded mean`} />
        <label className={css.range}>Threshold <output>{Math.round(config.threshold * 100)}%</output>
          <input aria-label={`${latex} threshold`} type="range" min="5" max="95" step="1" value={Math.round(config.threshold * 100)} disabled={busy} onChange={e => patch({ threshold: Number(e.target.value) / 100 })} />
        </label>
      </> : <span className={css.muted}>{visible && !error ? "Loading…" : "—"}</span>}
    </td>
    <td className={css.cell}>
      {data && config && <fieldset disabled={busy} className={css.controls}>
        <svg className={css.editor} viewBox={`0 0 ${data.width} ${data.height}`} aria-label={`${latex} control points`} onPointerDown={start}
          onPointerMove={event => { const pos = position(event); if (drag.current && pos && !busy) patch({ points: config.points.map(p => p.id === drag.current ? { ...p, ...pos } : p) }); }}
          onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setConfig(c => c ? { ...c } : c); }}
          onPointerCancel={() => { drag.current = null; setConfig(c => c ? { ...c } : c); }}>
          <image href={data.shapeImage} x="0" y="0" width={data.width} height={data.height} />
          {config.points.map((p, i) => <g key={p.id}>
            <circle cx={p.x + .5} cy={p.y + .5} r={p.id === selected ? 4 : 3} fill={p.movable ? "#d2603d" : "#fff"} stroke={p.id === selected ? "#163f8b" : "#52686f"} strokeWidth="1"><title>{`${i + 1}: ${p.kind}, ${p.movable ? "moving" : "fixed"}`}</title></circle>
          </g>)}
        </svg>
        <div className={css.row}>
          <select aria-label={`${latex} selected point`} value={selected ?? ""} onChange={e => setSelected(e.target.value)}>
            {!config.points.length && <option value="">No points</option>}
            {config.points.map((p, i) => <option key={p.id} value={p.id}>{i + 1} · {p.kind}</option>)}
          </select>
          {point && <label><input type="checkbox" checked={point.movable} onChange={e => changePoint({ movable: e.target.checked })} />Move</label>}
        </div>
        {point && <div className={css.coordinates}>{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input aria-label={`${latex} point ${axis}`} type="number" min="1" max={(axis === "x" ? data.width : data.height) - 2} value={point[axis]} onChange={e => changePoint({ [axis]: Math.max(1, Math.min((axis === "x" ? data.width : data.height) - 2, Number(e.target.value))) })} /></label>)}</div>}
        <div className={css.row}>
          <button type="button" disabled={config.points.length >= 32} onClick={addPoint}>Add point</button>
          <button type="button" disabled={!point} onClick={() => { patch({ points: config.points.filter(p => p.id !== selected) }); setSelected(null); }}>Remove</button>
          <button type="button" onClick={() => { patch({ points: data.autoPoints.map(p => ({ ...p })) }); setSelected(data.autoPoints[0]?.id ?? null); }}>Auto</button>
        </div>
        <button type="button" className={css.generate} disabled={!config.points.some(p => p.movable)} onClick={() => void save("generate")}>Augmentation</button>
      </fieldset>}
      {error && <div className={css.error} role="alert">{error}<div className={css.row}>
        {dirty && <button disabled={busy} onClick={() => void save("save")}>Retry save</button>}
        <button disabled={busy} onClick={() => void reload()}>Reload</button>
      </div></div>}
      {busy && <span className={css.muted} role="status">Saving…</span>}
    </td>
    <td className={css.cell}>
      {data && config && <>
        <div className={css.variants} aria-label={`${latex} augmentation results`}>
          {data.variants.map((variant, i) => <a key={i} href={variant.image} download={`${latex.replace(/[^a-zA-Z0-9]/g, "") || "glyph"}-${variant.seed}.png`} title={`Download · Seed ${variant.seed}`}><img src={variant.image} width={data.width} height={data.height} alt={`${latex} augmented variant ${i + 1}`} /></a>)}
          {!data.variants.length && <span className={css.muted}>—</span>}
        </div>
        {stale && <div className={css.muted}>Previous settings</div>}
        <details className={css.settings}><summary>Settings</summary><fieldset disabled={busy} className={css.controls}>
          {([['strength', 'Strength', 0, 16], ['radius', 'Radius', 12, 96], ['count', 'Variants', 1, 12]] as const).map(([key, label, min, max]) => <label key={key} className={css.range}>{label}<output>{config.augmentation[key]}{key === "count" ? "" : " px"}</output>
            <input aria-label={`${latex} ${label.toLowerCase()}`} type="range" min={min} max={max} step="1" value={config.augmentation[key]} onChange={e => patch({ augmentation: { ...config.augmentation, [key]: Number(e.target.value) } })} />
          </label>)}
          <label className={css.row}>Direction<select aria-label={`${latex} direction`} value={config.augmentation.direction} onChange={e => patch({ augmentation: { ...config.augmentation, direction: e.target.value as ExperimentConfig["augmentation"]["direction"] } })}>
            {["free", "up", "down", "left", "right", "horizontal", "vertical"].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
          </select></label>
          <label className={css.row}>Seed<input aria-label={`${latex} seed`} type="number" min="0" max="2147483647" value={config.augmentation.seed} onChange={e => patch({ augmentation: { ...config.augmentation, seed: Math.max(0, Math.min(2147483647, Math.round(Number(e.target.value)))) } })} /></label>
        </fieldset></details>
      </>}
    </td>
  </>;
}
