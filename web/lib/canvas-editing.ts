export type EditPoint = { x: number; y: number };
export type EditRect = EditPoint & { width: number; height: number };

export function intersectRect(a: EditRect, b: EditRect): EditRect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Disjoint rectangles covering exactly the part of source outside the cut. */
export function subtractRect(source: EditRect, cut: EditRect): EditRect[] {
  const inside = intersectRect(source, cut);
  if (!inside) return [source];
  const right = source.x + source.width, bottom = source.y + source.height;
  return [
    { x: source.x, y: source.y, width: source.width, height: inside.y - source.y },
    { x: source.x, y: inside.y + inside.height, width: source.width, height: bottom - inside.y - inside.height },
    { x: source.x, y: inside.y, width: inside.x - source.x, height: inside.height },
    { x: inside.x + inside.width, y: inside.y, width: right - inside.x - inside.width, height: inside.height },
  ].filter(rect => rect.width > 0 && rect.height > 0);
}

/** Opposite corner is fixed. Proportional scaling cannot flip or leave the page. */
export function resizeSelection(rect: EditRect, corner: number, pointer: EditPoint, page: { width: number; height: number }): EditRect {
  const left = corner % 2 === 0, top = corner < 2;
  const anchor = { x: left ? rect.x + rect.width : rect.x, y: top ? rect.y + rect.height : rect.y };
  const dx = (pointer.x - anchor.x) * (left ? -1 : 1);
  const dy = (pointer.y - anchor.y) * (top ? -1 : 1);
  // Project the pointer onto the original diagonal to avoid jumps near either axis.
  const wanted = (dx * rect.width + dy * rect.height) / (rect.width ** 2 + rect.height ** 2);
  const maximum = Math.max(0.001, Math.min(
    (left ? anchor.x : page.width - anchor.x) / rect.width,
    (top ? anchor.y : page.height - anchor.y) / rect.height,
  ));
  const minimum = Math.min(maximum, Math.max(0.01, 4 / Math.min(rect.width, rect.height)));
  const ratio = Math.max(minimum, Math.min(wanted, maximum));
  const width = rect.width * ratio, height = rect.height * ratio;
  return { x: left ? anchor.x - width : anchor.x, y: top ? anchor.y - height : anchor.y, width, height };
}

/** Stores immutable snapshots; gestures record once, and a fresh edit discards redo. */
export class CanvasEditHistory<T> {
  private past: Array<{ before: T; after: T }> = [];
  private future: Array<{ before: T; after: T }> = [];
  private limit: number;

  constructor(limit = 100) { this.limit = limit; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  record(before: T, after: T, changed: boolean) {
    if (!changed) return;
    this.past.push({ before, after });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(): T | null {
    const edit = this.past.pop();
    if (!edit) return null;
    this.future.push(edit);
    return edit.before;
  }

  redo(): T | null {
    const edit = this.future.pop();
    if (!edit) return null;
    this.past.push(edit);
    return edit.after;
  }
}
