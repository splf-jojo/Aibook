"use client";

import { glyphBounds, MAX_SYMBOL_SPACING, type Box, type Insets, type WritingPlacement, type WritingResult } from "@/lib/handwriting-writing";
import { Latex } from "./handwriting-review";
import styles from "./handwriting-writing.module.css";

const sides = ["top", "right", "bottom", "left"] as const;
const n = (value: number) => value.toFixed(1);
const dimensions = (box: Box) => `${n(box.width)} × ${n(box.height)} px`;
const rectPath = (box: Box) => `M${box.x},${box.y}h${box.width}v${box.height}h${-box.width}Z`;
type Preview = Pick<WritingResult, "svg" | "width" | "height" | "origin" | "placements">;

/** Give inspection overlays room outside the image without changing the image,
 * its coordinates or the exported dimensions. */
export function WritingPreview({ result, alt, selected, onSelect, boxes = false, references = false }: { result: Preview; alt: string; selected: number | null; onSelect: (index: number) => void; boxes?: boolean; references?: boolean }) {
  const bounds = result.placements.flatMap(p => [...(boxes ? [p.outer, p.cell, glyphBounds(p, p.angle)] : []), ...(references ? [p.reference] : [])]);
  const left = bounds.length ? Math.max(0, -Math.min(...bounds.map(b => b.x + result.origin.x)) + 2) : 0;
  const top = bounds.length ? Math.max(0, -Math.min(...bounds.map(b => b.y + result.origin.y)) + 2) : 0;
  const right = bounds.length ? Math.max(0, Math.max(...bounds.map(b => b.x + b.width + result.origin.x)) - result.width + 2) : 0;
  const bottom = bounds.length ? Math.max(0, Math.max(...bounds.map(b => b.y + b.height + result.origin.y)) - result.height + 2) : 0;
  return <div className={styles.resultCanvas} style={{ width: result.width + left + right, height: result.height + top + bottom }}>
    <div style={{ position: "absolute", left, top, width: result.width, height: result.height }}>
      <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`} width={result.width} height={result.height} style={{ width: result.width, height: result.height }} alt={alt} />
      {(boxes || references) && <SymbolBoxes result={result} selected={selected} onSelect={onSelect} boxes={boxes} references={references} />}
    </div>
  </div>;
}

export function InsetControls({ label, value, onChange }: { label: string; value: Insets; onChange: (value: Insets) => void }) {
  const equal = sides.every((side) => value[side] === value.top);
  return <fieldset className={styles.insets}>
    <legend>{label}</legend>
    <label className={styles.slider}><span>All <output>{equal ? `${value.top} px` : "Mixed"}</output></span>
      <input type="range" aria-label={`${label} all`} min={0} max={MAX_SYMBOL_SPACING} value={value.top}
        onChange={(e) => { const v = Number(e.target.value); onChange({ top: v, right: v, bottom: v, left: v }); }} />
    </label>
    <details className={styles.sides}><summary>Individual sides</summary><div>
      {sides.map((side) => <label key={side}><span>{side[0].toUpperCase() + side.slice(1)}</span>
        <input aria-label={`${label} ${side}`} type="number" min={0} max={MAX_SYMBOL_SPACING} step={1} value={value[side]}
          onChange={(e) => onChange({ ...value, [side]: Math.max(0, Math.min(MAX_SYMBOL_SPACING, Number(e.target.value) || 0)) })} />
      </label>)}
    </div></details>
  </fieldset>;
}

export function SymbolBoxes({ result, selected, onSelect, boxes = true, references = false }: { result: Pick<WritingResult, "width" | "height" | "origin" | "placements">; selected: number | null; onSelect: (index: number) => void; boxes?: boolean; references?: boolean }) {
  return <svg className={styles.boxOverlay} width={result.width} height={result.height} viewBox={`0 0 ${result.width} ${result.height}`} role="group" aria-label="Symbol boxes">
    <g transform={`translate(${result.origin.x} ${result.origin.y})`}>
      {result.placements.map((p, i) => <g key={i} className={styles.boxItem} role="button" tabIndex={0}
        aria-label={`${p.label} symbol ${i + 1}`} aria-pressed={selected === i} onClick={() => onSelect(i)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(i); } }}>
        {boxes && <><path d={`${rectPath(p.outer)}${rectPath(p.cell)}`} fillRule="evenodd" className={styles.marginArea} />
        <path d={`${rectPath(p.cell)}${rectPath(p.content)}`} fillRule="evenodd" className={styles.paddingArea} />
        <rect {...p.outer} className={styles.marginOutline} />
        <rect {...p.cell} className={styles.cellOutline} />
        <rect x={p.x} y={p.y} width={p.width} height={p.height} className={styles.glyphOutline}
          transform={`rotate(${p.angle} ${p.x + p.width / 2} ${p.y + p.height / 2})`} />
        {p.baseline !== undefined && <line x1={p.outer.x} x2={p.outer.x + p.outer.width} y1={p.baseline} y2={p.baseline} className={styles.baselineOutline} />}
        {p.mathAxis !== undefined && <line x1={p.outer.x} x2={p.outer.x + p.outer.width} y1={p.mathAxis} y2={p.mathAxis} className={styles.axisOutline} />}</>}
        {references && <rect {...p.reference} className={styles.referenceOutline} />}
        <rect x={p.x - 2} y={p.y - 2} width={Math.max(6, p.width + 4)} height={Math.max(6, p.height + 4)} fill="transparent" className={styles.boxTarget}
          transform={`rotate(${p.angle} ${p.x + p.width / 2} ${p.y + p.height / 2})`} />
      </g>)}
    </g>
  </svg>;
}

export function BoxInspector({ placement: p, boxes = true, references = false }: { placement?: WritingPlacement; boxes?: boolean; references?: boolean }) {
  return <div className={styles.boxInfo}>
    <div className={styles.boxLegend} aria-label="Box legend">{boxes && <><span>Glyph</span><span>Cell</span><span>Padding</span><span>Margin</span>{p?.baseline !== undefined && <><span className={styles.baselineLegend}>Baseline</span><span className={styles.axisLegend}>Math axis</span></>}</>}{references && <span className={styles.referenceLegend}>Reference bounds</span>}</div>
    {p && <div className={styles.inspector} aria-label="Selected symbol">
      {p.kind === "prose" ? <code>{p.label}</code> : <Latex value={p.glyph?.latex ?? p.label} />}
      <dl>
        <div><dt>Source</dt><dd>{p.kind === "prose" ? "Printed text" : p.kind === "structure" ? "Math structure" : p.glyph ? "Handwriting" : p.kind === "missing" ? "Placeholder" : "Printed"}</dd></div>
        <div><dt>Glyph</dt><dd>{dimensions(p)} · {n(p.angle)}°</dd></div>
        <div><dt>Cell</dt><dd>{dimensions(p.cell)}</dd></div>
        {references && <div><dt>Reference bounds</dt><dd>{dimensions(p.reference)} · {n(p.reference.x)}, {n(p.reference.y)} px</dd></div>}
        <div><dt>Cell position</dt><dd>{n(p.cell.x)}, {n(p.cell.y)} px</dd></div>
        <div><dt>Glyph position</dt><dd>{n(p.x)}, {n(p.y)} px</dd></div>
        {p.baseline !== undefined && <div><dt>Baseline</dt><dd>{n(p.baseline)} px</dd></div>}
        {p.glyph?.metrics && <div><dt>Source size</dt><dd>{n(p.glyph.metrics.width)} × {n(p.glyph.metrics.height)} pt</dd></div>}
        <div><dt>Applied padding · T R B L</dt><dd>{sides.map((side) => n(p.padding[side])).join(" / ")} px</dd></div>
        <div><dt>Applied margin · T R B L</dt><dd>{sides.map((side) => n(p.margin[side])).join(" / ")} px</dd></div>
      </dl>
    </div>}
  </div>;
}
