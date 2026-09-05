import type { ReviewSession } from "./handwriting-dataset";

const DB = "aibook-handwriting-review-v1";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "fingerprint" });
      request.result.createObjectStore("settings");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readSession(fingerprint?: string): Promise<ReviewSession | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["sessions", "settings"], "readonly");
      let result: ReviewSession | null = null;
      const read = (id: string) => {
        const request = tx.objectStore("sessions").get(id);
        request.onsuccess = () => { result = request.result ?? null; };
      };
      if (fingerprint) read(fingerprint);
      else {
        const last = tx.objectStore("settings").get("active");
        last.onsuccess = () => { if (typeof last.result === "string") read(last.result); };
      }
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/** Compare the full previous review so another tab cannot silently overwrite work. */
export async function saveSession(session: ReviewSession, previous: ReviewSession | null): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["sessions", "settings"], "readwrite");
      let conflict = false;
      const store = tx.objectStore("sessions");
      const existing = store.get(session.fingerprint);
      existing.onsuccess = () => {
        if (existing.result && JSON.stringify(existing.result.review) !== JSON.stringify(previous?.review)) {
          conflict = true;
          tx.abort();
          return;
        }
        store.put(session);
        tx.objectStore("settings").put(session.fingerprint, "active");
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(conflict
        ? new Error("Решения изменились в другой вкладке. Обновите страницу перед продолжением.")
        : new Error("Не удалось сохранить в браузере. Освободите место; последнее действие не применено."));
    });
  } finally { db.close(); }
}
