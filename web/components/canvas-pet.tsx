import styles from "./canvas-pet.module.css";

export type CanvasPetMood = "idle" | "thinking" | "writing" | "ready";

export function CanvasPet({ mood = "idle", className = "" }: { mood?: CanvasPetMood; className?: string }) {
  return (
    <svg aria-hidden="true" className={`${styles.pet} ${className}`} data-mood={mood} viewBox="0 0 104 104" fill="none">
      <ellipse className={styles.shadow} cx="51" cy="92" rx="29" ry="4" fill="#1e3a5f" opacity=".09" />
      <g className={styles.body}>
        <path d="M78 69c14-11 19 1 10 8-4 3-8 2-12 0" fill="#9bbcff" stroke="#304867" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M27 74c-3 4-5 11-1 14 4 2 10-1 13-5m25-9c5 3 11 10 7 14-4 3-11-1-14-4" fill="#304867" />
        <path d="M23 37c-5-10-5-23 0-25 5-2 12 6 16 12 7-3 15-3 22 0 5-7 13-15 18-11 5 4 2 18-2 25 5 8 8 18 6 28-2 15-14 22-31 22S21 81 19 66c-2-11 0-21 4-29Z" fill="#fffdf8" stroke="#304867" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M25 21c-1 4 0 9 2 13l6-6-8-7Zm49 0-9 8 7 6c2-5 3-10 2-14Z" fill="#adc9ff" />
        <path d="M26 68c3 11 12 16 26 16s22-5 25-16c-13 7-36 7-51 0Z" fill="#e8effc" />
        <g className={styles.face}>
          <g className={styles.eyes} fill="#304867">
            <rect x="34" y="45" width="6" height="10" rx="3" />
            <rect x="61" y="45" width="6" height="10" rx="3" />
          </g>
          <ellipse cx="30" cy="58" rx="5" ry="3" fill="#f4c6bd" opacity=".65" />
          <ellipse cx="71" cy="58" rx="5" ry="3" fill="#f4c6bd" opacity=".65" />
          <path d="m48 56 3 2 3-2m-3 2v2m-5 0c1 4 4 4 5 0 1 4 4 4 5 0" stroke="#304867" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <path d="M21 60c-7 0-10 8-4 11 5 2 10-2 10-5" fill="#fffdf8" stroke="#304867" strokeWidth="2.5" strokeLinecap="round" />
        <g className={styles.pencil}>
          <path d="m79 75 12-32 6 3-12 31-7 7 1-9Z" fill="#82aaff" stroke="#304867" strokeWidth="2" strokeLinejoin="round" />
          <path d="m79 75 6 2-7 7 1-9Z" fill="#fff0d0" />
          <path d="m91 43 1-3c1-3 7-1 6 2l-1 4" fill="#f4c6bd" stroke="#304867" strokeWidth="2" />
          <path d="m78 84 3-3" stroke="#304867" strokeWidth="2" strokeLinecap="round" />
        </g>
        <path d="M78 61c8-1 11 6 6 10-4 3-9 0-10-4" fill="#fffdf8" stroke="#304867" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <g className={styles.sparkle} stroke="#719bf2" strokeWidth="2" strokeLinecap="round">
        <path d="M91 15v8m-4-4h8M11 36v5m-2.5-2.5h5" />
      </g>
    </svg>
  );
}
