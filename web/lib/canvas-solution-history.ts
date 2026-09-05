import type { CanvasPage } from "./canvas-api";

type SolutionElement = { id: string; solutionId: string };
type RemovedElement = { element: SolutionElement; pageId: string; index: number };
type PageShell = { page: CanvasPage; index: number };

/** History for one accepted solution, independent of subsequent drawing edits. */
export type SolutionHistoryEntry = {
  solutionId: string;
  state: "accepted" | "undone";
  elementIds: string[];
  addedPageIds: string[];
  removedElements: RemovedElement[];
  pageShells: PageShell[];
  pageOrder: string[];
};

function elementId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("id" in value)) return undefined;
  return typeof value.id === "string" ? value.id : undefined;
}

function isSolutionElement(value: unknown, solutionId: string): value is SolutionElement {
  return elementId(value) !== undefined && "solutionId" in (value as object) &&
    (value as SolutionElement).solutionId === solutionId;
}

function idCounts(pages: CanvasPage[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const page of pages) for (const element of page.elements) {
    const id = elementId(element);
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function createSolutionHistoryEntry(
  beforePages: CanvasPage[], afterPages: CanvasPage[], solutionId: string,
): SolutionHistoryEntry | null {
  const existingIds = idCounts(beforePages);
  const newIds = idCounts(afterPages);
  const elementIds = afterPages.flatMap((page) => page.elements)
    .filter((element): element is SolutionElement => isSolutionElement(element, solutionId))
    // Ambiguous IDs cannot safely identify an original object for undo.
    .filter((element) => !existingIds.has(element.id) && newIds.get(element.id) === 1)
    .map((element) => element.id);
  if (!elementIds.length) return null;
  const previousPageIds = new Set(beforePages.map((page) => page.id));
  return {
    solutionId, state: "accepted", elementIds,
    addedPageIds: afterPages.filter((page) => !previousPageIds.has(page.id)).map((page) => page.id),
    removedElements: [], pageShells: [], pageOrder: [],
  };
}

export function undoSolution(pages: CanvasPage[], entry: SolutionHistoryEntry): {
  pages: CanvasPage[]; entry: SolutionHistoryEntry;
} {
  if (entry.state === "undone") return { pages, entry };
  const targetIds = new Set(entry.elementIds);
  const counts = idCounts(pages);
  const addedPageIds = new Set(entry.addedPageIds);
  const removedElements: RemovedElement[] = [];
  const pageShells: PageShell[] = [];
  const nextPages: CanvasPage[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const elements = page.elements.filter((element, index) => {
      if (!isSolutionElement(element, entry.solutionId) || !targetIds.has(element.id) ||
        counts.get(element.id) !== 1) return true;
      removedElements.push({ element: structuredClone(element), pageId: page.id, index });
      return false;
    });
    const changed = elements.length !== page.elements.length;
    const removable = addedPageIds.has(page.id) && !elements.length &&
      !page.appleDrawingData && page.pdfPageIndex == null;
    if (changed || removable) {
      pageShells.push({ page: structuredClone({ ...page, elements: [] }), index: pageIndex });
    }
    // Keep a usable page even if the user has since deleted all other pages.
    if (!removable || (nextPages.length === 0 && pageIndex === pages.length - 1)) {
      nextPages.push(changed ? { ...page, elements } : page);
    }
  }
  return {
    pages: nextPages,
    entry: { ...entry, state: "undone", removedElements, pageShells, pageOrder: pages.map((page) => page.id) },
  };
}

export function redoSolution(pages: CanvasPage[], entry: SolutionHistoryEntry): {
  pages: CanvasPage[]; entry: SolutionHistoryEntry;
} {
  if (entry.state === "accepted") return { pages, entry };
  const presentIds = idCounts(pages);
  const restoring = entry.removedElements.filter(({ element }) => !presentIds.has(element.id));
  const neededPages = new Set(restoring.map(({ pageId }) => pageId));
  const nextPages = [...pages];
  for (const { page, index } of entry.pageShells) {
    if (!neededPages.has(page.id) || nextPages.some((current) => current.id === page.id)) continue;
    // Anchor to surviving neighbours, keeping later user pages and edits intact.
    const following = entry.pageOrder.slice(index + 1).find((id) => nextPages.some((current) => current.id === id));
    const preceding = entry.pageOrder.slice(0, index).reverse().find((id) => nextPages.some((current) => current.id === id));
    const insertion = following ? nextPages.findIndex((current) => current.id === following)
      : preceding ? nextPages.findIndex((current) => current.id === preceding) + 1
      : Math.min(index, nextPages.length);
    nextPages.splice(insertion, 0, structuredClone(page));
  }
  for (const { element, pageId, index } of restoring) {
    const pageIndex = nextPages.findIndex((page) => page.id === pageId);
    if (pageIndex < 0) continue;
    const page = nextPages[pageIndex];
    const elements = [...page.elements];
    elements.splice(Math.min(index, elements.length), 0, structuredClone(element));
    nextPages[pageIndex] = { ...page, elements };
  }
  return { pages: nextPages, entry: { ...entry, state: "accepted", removedElements: [], pageShells: [], pageOrder: [] } };
}
