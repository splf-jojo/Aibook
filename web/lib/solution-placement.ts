export type Bounds = { x: number; y: number; width: number; height: number };
const MARGIN = 36;
const GAP = 18;

export function overlaps(a: Bounds, b: Bounds, gap = GAP): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

// Search obstacle edges, rather than a coarse grid, so narrow free regions aren't missed.
export function findSolutionSpace(
  width: number, height: number, occupied: Bounds[], anchor?: Bounds,
  pageWidth = 794, pageHeight = 1123,
): Bounds | null {
  const xs = new Set([MARGIN, pageWidth - MARGIN - width]);
  const ys = new Set([MARGIN, pageHeight - MARGIN - height]);
  for (const rect of occupied) {
    xs.add(rect.x); xs.add(rect.x + rect.width + GAP); xs.add(rect.x - width - GAP);
    ys.add(rect.y); ys.add(rect.y + rect.height + GAP); ys.add(rect.y - height - GAP);
  }
  const candidates: Bounds[] = [];
  for (const x of xs) for (const y of ys) {
    const candidate = { x, y, width, height };
    if (x < MARGIN || y < MARGIN || x + width > pageWidth - MARGIN || y + height > pageHeight - MARGIN) continue;
    if (occupied.every((rect) => !overlaps(candidate, rect))) candidates.push(candidate);
  }
  const target = anchor ? { x: anchor.x, y: anchor.y + anchor.height + GAP } : { x: MARGIN, y: MARGIN };
  const score = (rect: Bounds) => Math.abs(rect.y - target.y) * 2 + Math.abs(rect.x - target.x) +
    (anchor && rect.y < anchor.y + anchor.height ? pageHeight : 0);
  candidates.sort((a, b) => score(a) - score(b));
  return candidates[0] ?? null;
}
