"use client";

import { MAX_SYMBOL_SPACING, type Box, type Insets, type WritingPlacement, type WritingResult } from "@/lib/handwriting-writing";
import { Latex } from "./handwriting-review";
import styles from "./handwriting-writing.module.css";

const sides = ["top", "right", "bottom", "left"] as const;
const n = (value: number) => value.toFixed(1);
const dimensions = (box: Box) => `${n(box.width)} × ${n(box.height)} px`;
const rectPath = (box: Box) => `M${box.x},${box.y}h${box.width}v${box.height}h${-box.width}Z`;

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

export function SymbolBoxes({ result, selected, onSelect }: { result: WritingResult; selected: number | null; onSelect: (index: number) => void }) {
  return <svg className={styles.boxOverlay} width={result.width} height={result.height} viewBox={`0 0 ${result.width} ${result.height}`} role="group" aria-label="Symbol boxes">
    <g transform={`translate(${result.origin.x} ${result.origin.y})`}>
      {result.placements.map((p, i) => <g key={i} className={styles.boxItem} role="button" tabIndex={0}
        aria-label={`${p.label} symbol ${i + 1}`} aria-pressed={selected === i} onClick={() => onSelect(i)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(i); } }}>
        <path d={`${rectPath(p.outer)}${rectPath(p.cell)}`} fillRule="evenodd" className={styles.marginArea} />
        <path d={`${rectPath(p.cell)}${rectPath(p.content)}`} fillRule="evenodd" className={styles.paddingArea} />
        <rect {...p.outer} className={styles.marginOutline} />
        <rect {...p.cell} className={styles.cellOutline} />
        <rect x={p.x} y={p.y} width={p.width} height={p.height} className={styles.glyphOutline}
          transform={`rotate(${p.angle} ${p.x + p.width / 2} ${p.y + p.height / 2})`} />
        <rect {...p.outer} fill="transparent" className={styles.boxTarget} />
      </g>)}
    </g>
  </svg>;
}

export function BoxInspector({ placement: p }: { placement?: WritingPlacement }) {
  return <div className={styles.boxInfo}>
    <div className={styles.boxLegend} aria-label="Box legend"><span>Glyph</span><span>Cell</span><span>Padding</span><span>Margin</span></div>
    {p && <div className={styles.inspector} aria-label="Selected symbol">
      <Latex value={p.glyph?.latex ?? p.label} />
      <dl>
        <div><dt>Glyph</dt><dd>{dimensions(p)} · {n(p.angle)}°</dd></div>
        <div><dt>Cell</dt><dd>{dimensions(p.cell)}</dd></div>
        <div><dt>Position</dt><dd>{n(p.cell.x)}, {n(p.cell.y)} px</dd></div>
        <div><dt>Padding · T R B L</dt><dd>{sides.map((side) => n(p.padding[side])).join(" / ")} px</dd></div>
        <div><dt>Margin · T R B L</dt><dd>{sides.map((side) => n(p.margin[side])).join(" / ")} px</dd></div>
      </dl>
    </div>}
  </div>;
}
