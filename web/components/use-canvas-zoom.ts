"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { anchoredCanvasScroll, zoomFromWheel, type ScrollPoint, type Size } from "@/lib/canvas-viewport";

export function useCanvasZoom(fitSize: Size, blocked: () => boolean) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const blockedRef = useRef(blocked); blockedRef.current = blocked;
  const pending = useRef<ScrollPoint | null>(null);
  const stageSize = { width: fitSize.width * zoom, height: fitSize.height * zoom };
  const previousSize = useRef(stageSize);

  useLayoutEffect(() => {
    const viewport = viewportRef.current, previous = previousSize.current;
    previousSize.current = stageSize;
    if (!viewport) return;
    // Adapt scrolling when the fitted paper dimensions change, retaining the zoom level.
    if (!pending.current && previous.width > 0 && (previous.width !== stageSize.width || previous.height !== stageSize.height)) {
      pending.current = anchoredCanvasScroll(previous, stageSize, { width: viewport.clientWidth, height: viewport.clientHeight },
        { left: viewport.scrollLeft, top: viewport.scrollTop }, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
    }
    if (pending.current) {
      viewport.scrollLeft = pending.current.left; viewport.scrollTop = pending.current.top;
      pending.current = null;
    }
  }, [stageSize.width, stageSize.height]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      // Chromium/Firefox deliver touchpad pinch as a wheel event with ctrlKey.
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (blockedRef.current() || fitSize.width <= 0) return;
      const next = zoomFromWheel(zoomRef.current, event.deltaY, event.deltaMode);
      if (next === zoomRef.current) return;
      const rect = viewport.getBoundingClientRect();
      pending.current = anchoredCanvasScroll(
        { width: fitSize.width * zoomRef.current, height: fitSize.height * zoomRef.current },
        { width: fitSize.width * next, height: fitSize.height * next },
        { width: viewport.clientWidth, height: viewport.clientHeight },
        pending.current ?? { left: viewport.scrollLeft, top: viewport.scrollTop },
        { x: event.clientX - rect.left, y: event.clientY - rect.top });
      zoomRef.current = next;
      setZoom(next);
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [fitSize.width, fitSize.height]);
  return { stageSize, viewportRef, zoom };
}
