/**
 * On-device storage for downloaded maps (IndexedDB: works in browsers, installed PWAs and Android WebViews).
 *  - blobs: file contents keyed by their SHA-256 (shared between map versions -> incremental updates)
 *  - meta:  the installed-content state (one record, replaced atomically)
 * Falls back to memory when IndexedDB is unavailable (private mode): the game still runs, just without
 * keeping downloads between sessions.
 */

export interface InstalledPack {
  id: string;
  name: string;
  order: number;
  yMin: number;
  yMax: number;
  entry: string;
  version: number;
  hash: string;
  size: number;
  summary?: string;
  /** English summary (the base `summary` is Vietnamese) */
  summary_en?: string;
  requires: string[];
  /** logical game path -> [sha256, bytes] */
  files: Record<string, [string, number]>;
  installedAt: number;
}

export interface RemoteMap extends Omit<InstalledPack, 'installedAt'> {
  minApp: number;
  bundled?: boolean;
  /** protocol v2: sha256 of the map's pack manifest (files/<pack>); `files` stays empty until it is fetched */
  pack?: string;
  /** protocol v2: gameplay mechanics the map uses (the app must know all of them) */
  mechanics?: string[];
}

export interface RemoteManifest {
  schema: number;
  generated?: string;
  maps: RemoteMap[];
}

export interface ContentState {
  packs: Record<string, InstalledPack>;
  /** last manifest seen online: lets the menu show what can be downloaded even while offline */
  manifest: RemoteManifest | null;
  manifestAt: number;
  /** a download in progress (its finished files are kept by GC so it can resume) */
  pending: Record<string, string[]>;
}

const DB_NAME = 'skyward-content';
const STATE_KEY = 'state';

export class ContentStore {
  private db: IDBDatabase | null = null;
  private mem = new Map<string, Blob>();
  private memMeta: ContentState | null = null;
  persistent = false;

  async open() {
    if (typeof indexedDB === 'undefined') return;
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('indexedDB blocked'));
      });
    } catch (e) {
      console.warn('IndexedDB unavailable, downloads will not be kept', e);
      this.db = null;
    }
  }

  /** ask the browser not to evict downloaded maps under storage pressure */
  async requestPersist() {
    try { this.persistent = !!(await navigator.storage?.persist?.()); } catch { /* unsupported */ }
    return this.persistent;
  }

  private tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = this.db!;
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => resolve(r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    });
  }

  async getState(): Promise<ContentState> {
    const empty: ContentState = { packs: {}, manifest: null, manifestAt: 0, pending: {} };
    if (!this.db) return this.memMeta ?? empty;
    try {
      const v = (await this.tx<ContentState>('meta', 'readonly', (s) => s.get(STATE_KEY))) as ContentState | undefined;
      return v ? { ...empty, ...v } : empty;
    } catch { return empty; }
  }

  /** single put: the switch to a new map version is all-or-nothing */
  async setState(st: ContentState) {
    if (!this.db) { this.memMeta = structuredClone(st); return; }
    await this.tx('meta', 'readwrite', (s) => s.put(st, STATE_KEY));
  }

  async hasBlob(hash: string): Promise<boolean> {
    if (!this.db) return this.mem.has(hash);
    const k = await this.tx<IDBValidKey | undefined>('blobs', 'readonly', (s) => s.getKey(hash));
    return k !== undefined;
  }

  async getBlob(hash: string): Promise<Blob | null> {
    if (!this.db) return this.mem.get(hash) ?? null;
    const v = await this.tx<Blob | ArrayBuffer | undefined>('blobs', 'readonly', (s) => s.get(hash));
    if (!v) return null;
    return v instanceof Blob ? v : new Blob([v]);
  }

  async putBlob(hash: string, data: ArrayBuffer) {
    if (!this.db) { this.mem.set(hash, new Blob([data])); return; }
    // some WebViews cannot store Blobs in IndexedDB: plain ArrayBuffers always work
    await this.tx('blobs', 'readwrite', (s) => s.put(data, hash));
  }

  /** delete every blob not in `keep` (after a successful install / at startup) */
  async gc(keep: Set<string>) {
    if (!this.db) { for (const k of [...this.mem.keys()]) if (!keep.has(k)) this.mem.delete(k); return 0; }
    const keys = ((await this.tx<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys())) ?? []) as string[];
    const drop = keys.filter((k) => !keep.has(k));
    if (drop.length) await this.tx('blobs', 'readwrite', (s) => { for (const k of drop) s.delete(k); });
    return drop.length;
  }

  async usage(): Promise<{ used: number; quota: number } | null> {
    try {
      const e = await navigator.storage?.estimate?.();
      return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
    } catch { return null; }
  }
}
