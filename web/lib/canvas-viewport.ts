export type Size = { width: number; height: number };
export type ScrollPoint = { left: number; top: number };
export const MIN_CANVAS_ZOOM = 0.4;
export const MAX_CANVAS_ZOOM = 3;
export const CANVAS_SIDE_PADDING = 24;
export const CANVAS_BOTTOM_PADDING = 16;

export function zoomFromWheel(zoom: number, deltaY: number, deltaMode: number) {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 240 : 1);
  return Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, zoom * Math.exp(-Math.max(-240, Math.min(240, pixels)) * 0.004)));
}

/** Keep the same paper point under the cursor, subject to the scroll bounds. */
export function anchoredCanvasScroll(before: Size, after: Size, viewport: Size, scroll: ScrollPoint, cursor: { x: number; y: number }): ScrollPoint {
  const beforeWidth = Math.max(viewport.width, before.width + CANVAS_SIDE_PADDING * 2);
  const afterWidth = Math.max(viewport.width, after.width + CANVAS_SIDE_PADDING * 2);
  const oldLeft = (beforeWidth - before.width) / 2, newLeft = (afterWidth - after.width) / 2;
  const left = newLeft + (scroll.left + cursor.x - oldLeft) * after.width / before.width - cursor.x;
  const top = (scroll.top + cursor.y) * after.height / before.height - cursor.y;
  return { left: Math.max(0, Math.min(afterWidth - viewport.width, left)),
    top: Math.max(0, Math.min(Math.max(viewport.height, after.height + CANVAS_BOTTOM_PADDING) - viewport.height, top)) };
}
