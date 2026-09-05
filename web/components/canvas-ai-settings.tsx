"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Settings } from "lucide-react";
import styles from "./canvas-companion.module.css";

export function CanvasAiSettings({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return <details className={styles.settings} ref={ref} onKeyDown={event => {
    if (event.key === "Escape" && ref.current?.open) {
      event.stopPropagation(); ref.current.open = false; ref.current.querySelector("summary")?.focus();
    }
  }}>
    <summary className={styles.iconButton} aria-label={label} title={label}><Settings aria-hidden="true" size={16} strokeWidth={1.7} /></summary>
    <div className={styles.settingsPanel} role="group" aria-label={label}>{children}</div>
  </details>;
}
