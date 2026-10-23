// A tiny persistent cache in IndexedDB. Every call degrades to a no-op where IndexedDB is missing
// or blocked (Node tests, private windows): a cache miss must never fail a run.

const DB = "lexi-cache";
const STORE = "kv";
// shortcut: oldest entries are dropped past this count; enough for ~20 long books of section notes.
const MAX_ENTRIES = 5000;

let db: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  db ??= new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE).createIndex("at", "at");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return db;
}

export async function kvGet(key: string): Promise<string | null> {
  const d = await open();
  if (!d) return null;
  return new Promise((resolve) => {
    const req = d.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as { v: string } | undefined)?.v ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function kvSet(key: string, v: string): Promise<void> {
  const d = await open();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put({ v, at: Date.now() }, key);
    const count = store.count();
    count.onsuccess = () => {
      let extra = count.result - MAX_ENTRIES;
      if (extra <= 0) return;
      store.index("at").openCursor().onsuccess = (e) => {
        const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cur && extra-- > 0) {
          cur.delete();
          cur.continue();
        }
      };
    };
    tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
  });
}

export async function kvClear(): Promise<void> {
  const d = await open();
  if (!d) return;
  await new Promise<void>((resolve) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = tx.onerror = () => resolve();
  });
}
