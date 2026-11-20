import { STORE_KEY } from "./rules";

const DB = "simple-diet", OS = "kv", K = "state";
let cache: unknown = null;
let dbP: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(OS); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function db(): Promise<IDBDatabase> {
  if (!dbP) dbP = openDb().catch((e: unknown) => { dbP = null; throw e; });
  return dbP;
}
async function readIdb(): Promise<unknown> {
  const d = await db();
  return new Promise((res, rej) => { const q = d.transaction(OS, "readonly").objectStore(OS).get(K); q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error); });
}
async function writeIdb(v: unknown): Promise<void> {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(OS, "readwrite");
    tx.objectStore(OS).put(v, K);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
function readLs(): unknown {
  try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch (_e) { return null; }
}

export async function initStore(): Promise<void> {
  cache = (await readIdb().catch(() => null)) || readLs();
  if (navigator.storage && navigator.storage.persist) await navigator.storage.persist().catch(() => false);
}
export function readCached(): unknown { return cache; }

export async function writeStore(v: unknown): Promise<boolean> {
  cache = v;
  let lsOk = true;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (_e) { lsOk = false; }
  const idbOk = await writeIdb(v).then(() => true, () => false);
  return lsOk && idbOk;
}
