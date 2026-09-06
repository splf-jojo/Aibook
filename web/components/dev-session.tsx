"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TOKEN_STORAGE_KEY } from "@/lib/canvas-api";
import shared from "./handwriting-review.module.css";
import styles from "./dev-session.module.css";

async function signIn(body: { token: string } | { username: string; password: string }, signal?: AbortSignal) {
  const response = await fetch("/dev/session", { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json()).error || "Could not sign in.");
}

export function DevLogin({ unavailable = false }: { unavailable?: boolean }) {
  const [username, setUsername] = useState("dev");
  const router = useRouter(), [password, setPassword] = useState(""), [busy, setBusy] = useState(false);
  const [error, setError] = useState(unavailable ? "Sign in is unavailable. Try again." : ""), bridge = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); bridge.current = controller;
    try {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (token) void signIn({ token }, controller.signal).then(() => { if (!controller.signal.aborted) router.refresh(); }).catch(() => {});
    } catch {}
    return () => controller.abort();
  }, [router]);
  return <main className={shared.app} lang="en">
    <header className={shared.topbar}><Link href="/" className={shared.brand}>AIbook</Link></header>
    <form className={styles.login} onSubmit={async (event) => {
      event.preventDefault(); if (busy) return; bridge.current?.abort(); setBusy(true); setError("");
      try { await signIn({ username, password }); setPassword(""); router.refresh(); }
      catch (err) { setError(err instanceof Error ? err.message : "Could not sign in."); }
      finally { setBusy(false); }
    }}>
      <h1>Dev</h1>
      <label>Username<input name="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required minLength={3} maxLength={64} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} /></label>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <button type="submit" className={shared.primaryButton} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  </main>;
}

export function DevSessionMonitor() {
  const router = useRouter();
  useEffect(() => {
    const expired = () => router.refresh();
    window.addEventListener("dev-session-expired", expired);
    return () => window.removeEventListener("dev-session-expired", expired);
  }, [router]);
  return null;
}

export function DevSignOut() {
  const router = useRouter(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className={shared.tools}>
    {error && <span role="alert">{error}</span>}
    <button className={shared.secondaryButton} disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch("/dev/session", { method: "DELETE", headers: { "Content-Type": "application/json" } });
        if (!response.ok) throw new Error();
        try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch {}
        router.refresh();
      } catch { setError("Could not sign out."); }
      finally { setBusy(false); }
    }}>Sign out</button>
  </div>;
}
