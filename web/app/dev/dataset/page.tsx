import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import styles from "@/components/handwriting-review.module.css";

export const metadata: Metadata = { title: "Datasets · AIbook" };
export default function DatasetHome() {
  return <main className={styles.app} lang="en">
    <header className={styles.topbar}><Link href="/dev" className={styles.brand}><ArrowLeft size={17} />Dev</Link></header>
    <div className={styles.homeContent}>
      <h1>Datasets</h1>
      <nav className={styles.homeLinks} aria-label="Dataset tools">
        <Link href="/dev/dataset/analysis">Analysis<ArrowUpRight size={24} /></Link>
        <Link href="/dev/dataset/labeling">Labeling<ArrowUpRight size={24} /></Link>
      </nav>
    </div>
  </main>;
}
