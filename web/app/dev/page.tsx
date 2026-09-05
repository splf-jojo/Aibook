import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import styles from "@/components/handwriting-review.module.css";
import { DevSignOut } from "@/components/dev-session";

export default function DevHome() {
  return <main className={styles.app} lang="en">
    <header className={styles.topbar}><Link href="/" className={styles.brand}>AIbook</Link><DevSignOut /></header>
    <div className={styles.homeContent}>
      <h1>Dev</h1>
      <nav className={styles.homeLinks} aria-label="Dev tools">
        <Link href="/dev/dataset">Datasets<ArrowUpRight size={24} /></Link>
        <Link href="/dev/writing">Writing<ArrowUpRight size={24} /></Link>
      </nav>
    </div>
  </main>;
}
