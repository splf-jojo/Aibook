/** Portable human-review contract. No OCR result is an approval. */
export type Candidate = {
  id: string;
  latex: string;
  image: string;
  context: string;
  source: {
    file: string;
    sha256: string;
    page: number;
    pageWidth: number;
    pageHeight: number;
    /** PDF points, top-left origin: x, y, width, height. */
    box: [number, number, number, number];
  };
};

export type CandidateDataset = {
  schemaVersion: 1;
  kind: "handwriting-candidates";
  name: string;
  samples: Candidate[];
};

export type ReviewIssue = "incorrect-outline" | "incorrect-symbol";
export type Decision = { status: "accepted" | "rejected"; latex: string; reviewedAt: string; issue?: ReviewIssue };
export type Review = {
  decisions: Record<string, Decision>;
  history: { id: string; previous: Decision | null }[];
  revision: number;
  inspectedRevision: number | null;
  approvedAt: string | null;
};
export type ReviewSession = { fingerprint: string; dataset: CandidateDataset; review: Review };

export const MIN_EXAMPLES = 3;
export const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
export const freshReview = (): Review => ({ decisions: {}, history: [], revision: 0, inspectedRevision: null, approvedAt: null });

/** Carry decisions only when this is an exact extension of the active pack. */
export function reviewForImport(dataset: CandidateDataset, previous: ReviewSession | null): Review {
  if (!previous || dataset.samples.length <= previous.dataset.samples.length) return freshReview();
  const samples = new Map(dataset.samples.map((sample) => [sample.id, JSON.stringify(sample)]));
  if (!previous.dataset.samples.every((sample) => samples.get(sample.id) === JSON.stringify(sample))) return freshReview();
  return { ...previous.review, revision: previous.review.revision + 1, inspectedRevision: null, approvedAt: null };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректный формат набора.");
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error("В наборе есть пустые или некорректные подписи.");
  }
  return value.trim();
}

function png(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000_000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Образцы и контекст должны быть встроенными PNG, без внешних ссылок.");
  }
  return value;
}

export function parseDataset(input: unknown): CandidateDataset {
  const data = object(input);
  if (data.schemaVersion !== 1 || data.kind !== "handwriting-candidates" || !Array.isArray(data.samples) || !data.samples.length || data.samples.length > 5000) {
    throw new Error("Нужен набор handwriting-candidates версии 1, от 1 до 5000 образцов.");
  }
  const ids = new Set<string>(), locations = new Set<string>();
  const samples = data.samples.map((raw): Candidate => {
    const sample = object(raw), source = object(sample.source);
    const id = text(sample.id, 100);
    if (ids.has(id) || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("В наборе повторяются или некорректны ID образцов.");
    ids.add(id);
    if (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Нет SHA-256 исходного PDF.");
    if (!Number.isInteger(source.page) || Number(source.page) < 1 || Number(source.page) > 10000) throw new Error("Некорректный номер страницы.");
    const width = source.pageWidth, height = source.pageHeight, box = source.box;
    if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Array.isArray(box) || box.length !== 4 || !box.every((v) => typeof v === "number" && Number.isFinite(v))) {
      throw new Error("Некорректные координаты источника.");
    }
    const [x, y, w, h] = box as number[];
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > width + 0.01 || y + h > height + 0.01) throw new Error("Образец выходит за границы страницы.");
    const location = `${source.sha256}:${source.page}:${box.join(",")}`;
    if (locations.has(location)) throw new Error("Одна и та же область PDF добавлена несколько раз.");
    locations.add(location);
    return { id, latex: text(sample.latex, 80), image: png(sample.image), context: png(sample.context), source: {
      file: text(source.file, 240), sha256: source.sha256, page: Number(source.page), pageWidth: width, pageHeight: height, box: [x, y, w, h],
    } };
  });
  return { schemaVersion: 1, kind: "handwriting-candidates", name: text(data.name, 160), samples };
}

export async function datasetFingerprint(dataset: CandidateDataset): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(dataset));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function decide(review: Review, sample: Candidate, status: Decision["status"], latex: string, now = new Date().toISOString(), issue?: ReviewIssue): Review {
  const label = text(latex, 80);
  if (issue && (status !== "rejected" || !["incorrect-outline", "incorrect-symbol"].includes(issue))) {
    throw new Error("Образец с ошибкой нельзя принять.");
  }
  return {
    ...review,
    decisions: { ...review.decisions, [sample.id]: { status, latex: label, reviewedAt: now, ...(issue ? { issue } : {}) } },
    history: [...review.history, { id: sample.id, previous: review.decisions[sample.id] ?? null }].slice(-5000),
    revision: review.revision + 1, inspectedRevision: null, approvedAt: null,
  };
}

export function undoDecision(review: Review): { review: Review; id: string } | null {
  const last = review.history.at(-1);
  if (!last) return null;
  const decisions = { ...review.decisions };
  if (last.previous) decisions[last.id] = last.previous;
  else delete decisions[last.id];
  return { id: last.id, review: { ...review, decisions, history: review.history.slice(0, -1), revision: review.revision + 1, inspectedRevision: null, approvedAt: null } };
}

export function datasetStats(dataset: CandidateDataset, review: Review) {
  const groups = new Map<string, { latex: string; accepted: number; rejected: number; pending: number }>();
  let accepted = 0, rejected = 0, pending = 0;
  for (const sample of dataset.samples) {
    const decision = review.decisions[sample.id], latex = decision?.latex ?? sample.latex;
    const group = groups.get(latex) ?? { latex, accepted: 0, rejected: 0, pending: 0 };
    const status = decision?.status ?? "pending";
    group[status]++;
    groups.set(latex, group);
    if (status === "accepted") accepted++;
    else if (status === "rejected") rejected++;
    else pending++;
  }
  const coverage = [...groups.values()].sort((a, b) => a.latex.localeCompare(b.latex));
  const eligible = coverage.filter((g) => g.accepted >= MIN_EXAMPLES);
  return { accepted, rejected, pending, coverage, eligible, exportable: eligible.reduce((sum, g) => sum + g.accepted, 0) };
}

export function approveDataset(dataset: CandidateDataset, review: Review, now = new Date().toISOString()): Review {
  const stats = datasetStats(dataset, review);
  if (stats.pending) throw new Error("Сначала проверьте каждый образец.");
  if (!stats.eligible.length) throw new Error(`Нужен хотя бы один символ с ${MIN_EXAMPLES} принятыми образцами.`);
  if (review.inspectedRevision !== review.revision) throw new Error("Проверьте итоговую галерею после последнего изменения.");
  return { ...review, approvedAt: now };
}

export function exportDataset(session: ReviewSession) {
  const { dataset, review, fingerprint } = session;
  if (!review.approvedAt) throw new Error("Датасет ещё не принят.");
  approveDataset(dataset, review, review.approvedAt);
  const stats = datasetStats(dataset, review);
  const eligible = new Set(stats.eligible.map((g) => g.latex));
  return {
    schemaVersion: 1, kind: "handwriting-reviewed-dataset", name: dataset.name,
    sourceFingerprint: fingerprint, approvedAt: review.approvedAt, reviewRevision: review.revision,
    minimumExamples: MIN_EXAMPLES,
    // These are reviewed PDF crops, not recovered pen trajectories or a trained font.
    representation: "pdf-crops", coordinateSystem: "pdf-points-top-left",
    samples: dataset.samples.flatMap((sample) => {
      const decision = review.decisions[sample.id];
      return decision?.status === "accepted" && eligible.has(decision.latex)
        ? [{ ...sample, latex: decision.latex, reviewedAt: decision.reviewedAt }] : [];
    }),
    excludedSymbols: stats.coverage.filter((g) => g.accepted < MIN_EXAMPLES),
    decisions: dataset.samples.map((sample) => ({ id: sample.id, ...review.decisions[sample.id] })),
  };
}
