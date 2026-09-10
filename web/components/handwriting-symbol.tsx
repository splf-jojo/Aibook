"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { useHandwritingAnalysis } from "./use-handwriting-analysis";
import { HandwritingExperiment } from "./handwriting-experiment";
import { Latex } from "./handwriting-review";
import { DatasetHeader, DevNavigation, DevPage, samplesHref, symbolHref, symbolsHref, useDevNavigation, useDevViewState } from "./dev-workspace";
import shared from "./handwriting-review.module.css";
import css from "./handwriting-symbols.module.css";

export function HandwritingSymbol({ datasetId, symbol }: { datasetId: string; symbol: string }) {
  const [pending, setPending] = useState(false);
  const { data, error, refresh } = useHandwritingAnalysis(datasetId, pending);
  const [alignment, setAlignment] = useDevViewState<"centered" | "aligned">(`symbols:${datasetId}:alignment`, "aligned");
  const canNavigate = useDevNavigation(), router = useRouter();
  const entry = data?.symbols.find(item => item.latex === symbol), result = entry?.result;
  const ready = result?.status === "complete" ? result : null;
  return <DevPage viewKey={`symbol:${datasetId}:${symbol}`} ready={!!data || !!error}>
    <DevNavigation /><DatasetHeader id={datasetId} name={data?.name} active="symbols" />
    <div className={css.content}>
      <div className={css.symbolHeading}>
        <Link href={symbolsHref(datasetId)} scroll={false}><ArrowLeft size={16} />All symbols</Link>
        <label>Symbol<select aria-label="Symbol" value={symbol} disabled={pending || !data} onChange={event => {
          if (canNavigate()) router.push(symbolHref(datasetId, event.target.value), { scroll: false });
        }}>{!entry && <option value={symbol}>{symbol}</option>}{data?.symbols.map(item => <option key={item.latex} value={item.latex}>{item.latex}</option>)}</select></label>
        <div className={shared.alignmentSwitch} role="group" aria-label="Alignment">
          {(["centered", "aligned"] as const).map(value => <button key={value} disabled={pending} aria-pressed={alignment === value} onClick={() => { if (canNavigate()) setAlignment(value); }}>{value === "centered" ? "Centered" : "Aligned"}</button>)}
        </div>
      </div>
      {error && <div className={shared.error} role="alert">{error}<button className={shared.secondaryButton} disabled={pending} onClick={() => void refresh()}>Reload</button></div>}
      {!data && !error && <div className={shared.loading}><LoaderCircle className={shared.spinner} aria-label="Loading symbol" role="status" /></div>}
      {data && !ready && <div className={shared.emptyLibrary}><p>{result?.status === "failed" ? result.error : !data.approved ? "Approve this dataset before analysis." : "No current result for this symbol."}</p>
        <Link className={shared.secondaryButton} href={samplesHref(datasetId, symbol)}>Review samples</Link>
      </div>}
      {data && ready && <>
        <div className={css.comparison}>
          <figure><figcaption><Latex value={symbol} /> · Heatmap</figcaption><img src={ready.heatmap[alignment]} alt={`${symbol} ${alignment} heatmap`} /><div className={shared.heatmapLegend} aria-label="Ink coverage from 0 to 100 percent"><span>0%</span><i /><span>100%</span></div></figure>
          <figure><figcaption>Medoid</figcaption><img src={ready.medoid.image} alt={`${symbol} medoid`} /></figure>
        </div>
        <HandwritingExperiment key={`${data.sourceVersion}:${data.computedAt}:${alignment}`} datasetId={datasetId} latex={symbol} version={data.sourceVersion} generation={data.computedAt ?? ""} alignment={alignment} onPending={setPending} />
        <details className={css.sourceSamples}>
          <summary>Source samples · {entry?.count}</summary>
          <Link className={shared.secondaryButton} href={samplesHref(datasetId, symbol)}>Review samples</Link>
          <div className={shared.analysisSamples}>{ready.samples.map(sample => <figure key={sample.id}>
            <Link href={`${samplesHref(datasetId, symbol)}&sample=${encodeURIComponent(sample.id)}`} title={`${sample.source.file} · Page ${sample.source.page}`}>
              <img className={shared.sampleImage} src={sample[alignment]} alt={`${symbol} sample ${sample.id}`} />
              <figcaption>{sample.id === ready.medoid.id ? "Medoid · " : ""}Page {sample.source.page}</figcaption>
            </Link>
          </figure>)}</div>
        </details>
      </>}
    </div>
  </DevPage>;
}
