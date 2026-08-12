/**
 * Persistência local da sessão de trabalho (IndexedDB).
 *
 * - store `blobs`   → arquivos de vídeo importados, posters e MP4 prontos
 * - store `session` → snapshot serializável do lote por ferramenta
 * - store `results` → biblioteca de arquivos exportados (download de novo)
 *
 * Nada aqui depende de login: funciona offline e sobrevive a F5 / fechar a aba.
 */

const DB_NAME = "vaiviral";
const DB_VERSION = 1;
const BLOBS = "blobs";
const SESSIONS = "sessions";
const RESULTS = "results";

/** sessões mais antigas que isto são descartadas sozinhas */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB indisponível"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS);
      if (!db.objectStoreNames.contains(RESULTS)) db.createObjectStore(RESULTS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("falha ao abrir o banco local"));
  });
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("falha no banco local"));
  });
}

/* ------------------------------------------------------------------ */
/* Blobs                                                               */
/* ------------------------------------------------------------------ */

export async function putBlob(key: string, blob: Blob): Promise<string> {
  await tx(BLOBS, "readwrite", (s) => s.put(blob, key));
  return key;
}

export async function getBlob(key: string): Promise<Blob | null> {
  try {
    return (await tx<Blob | undefined>(BLOBS, "readonly", (s) => s.get(key))) ?? null;
  } catch {
    return null;
  }
}

export async function delBlob(key: string) {
  try {
    await tx(BLOBS, "readwrite", (s) => s.delete(key));
  } catch {
    /* ignora */
  }
}

/* ------------------------------------------------------------------ */
/* Snapshot da sessão                                                  */
/* ------------------------------------------------------------------ */

export interface SessionOutput {
  key: string;
  ext: string;
  label: string;
  bytes: number;
}

export interface SessionItem {
  id: string;
  fileKey: string;
  fileName: string;
  fileType: string;
  posterKey?: string | null;
  w: number;
  h: number;
  duration: number;
  headline?: string;
  offsetX?: number;
  offsetY?: number;
  status: string;
  progress: number;
  sourceUrl?: string | null;
  clip?: { start: number; end: number } | null;
  score?: number | null;
  clipTitle?: string | null;
  clipReason?: string | null;
  clipTags?: string[] | null;
  preEdit?: unknown;
  captions?: unknown;
  regions?: unknown;
  result_url?: string | null;
  ext?: string | null;
  mainKey?: string | null;
  outputs?: SessionOutput[];
}

export interface SessionSnap {
  mode: string;
  updatedAt: number;
  templateName?: string | null;
  items: SessionItem[];
}

export async function saveSession(snap: SessionSnap) {
  await tx(SESSIONS, "readwrite", (s) => s.put(snap, snap.mode));
}

export async function loadSession(mode: string): Promise<SessionSnap | null> {
  try {
    const snap = (await tx<SessionSnap | undefined>(SESSIONS, "readonly", (s) => s.get(mode))) ?? null;
    if (!snap) return null;
    if (Date.now() - snap.updatedAt > MAX_AGE_MS) {
      await clearSession(mode);
      return null;
    }
    return snap;
  } catch {
    return null;
  }
}

/** Apaga a sessão e todos os blobs referenciados por ela. */
export async function clearSession(mode: string) {
  const snap = await tx<SessionSnap | undefined>(SESSIONS, "readonly", (s) => s.get(mode)).catch(() => undefined);
  if (snap) {
    for (const it of snap.items) {
      await delBlob(it.fileKey);
      if (it.posterKey) await delBlob(it.posterKey);
      if (it.mainKey) await delBlob(it.mainKey);
      for (const o of it.outputs ?? []) await delBlob(o.key);
    }
  }
  try {
    await tx(SESSIONS, "readwrite", (s) => s.delete(mode));
  } catch {
    /* ignora */
  }
}

/** Remove sessões vencidas (chamado na abertura do app). */
export async function pruneSessions() {
  try {
    const keys = await tx<IDBValidKey[]>(SESSIONS, "readonly", (s) => s.getAllKeys());
    for (const k of keys) {
      const snap = await tx<SessionSnap | undefined>(SESSIONS, "readonly", (s) => s.get(k));
      if (snap && Date.now() - snap.updatedAt > MAX_AGE_MS) await clearSession(String(k));
    }
  } catch {
    /* ignora */
  }
}

/* ------------------------------------------------------------------ */
/* Biblioteca de resultados                                            */
/* ------------------------------------------------------------------ */

export interface ResultRow {
  id: string;
  name: string;
  mode: string;
  blobKey: string;
  poster?: string | null;
  bytes: number;
  seconds: number;
  createdAt: number;
  sourceName?: string | null;
  variant?: string | null;
}

export async function addResult(row: Omit<ResultRow, "id" | "createdAt"> & { blob?: Blob }) {
  const id = crypto.randomUUID();
  if (row.blob) await putBlob(row.blobKey, row.blob);
  const { blob: _drop, ...rest } = row;
  const rec: ResultRow = { ...rest, id, createdAt: Date.now() };
  await tx(RESULTS, "readwrite", (s) => s.put(rec, id));
  return rec;
}

export async function listResults(): Promise<ResultRow[]> {
  try {
    const rows = await tx<ResultRow[]>(RESULTS, "readonly", (s) => s.getAll());
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function deleteResult(id: string) {
  const rec = await tx<ResultRow | undefined>(RESULTS, "readonly", (s) => s.get(id)).catch(() => undefined);
  if (rec?.blobKey) await delBlob(rec.blobKey);
  try {
    await tx(RESULTS, "readwrite", (s) => s.delete(id));
  } catch {
    /* ignora */
  }
}

/** Espaço aproximado usado pelo app no navegador. */
export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

export function formatBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
