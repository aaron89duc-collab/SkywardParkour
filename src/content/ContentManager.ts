import { ContentStore, type ContentState, type InstalledPack, type RemoteManifest, type RemoteMap } from './ContentStore';
import { sha256Async } from '../systems/sha256';
import type { MapRegistryEntry } from '../world/MapTypes';

/**
 * Download Once – Play Offline – Update When Online.
 *
 *  - Map 001 ships inside the app (public/maps/index.json lists the bundled maps and their version).
 *  - Other maps are packs on the content server (Cloudflare R2): manifest.json + files/<sha256>.
 *    A pack is downloaded once into on-device storage (IndexedDB) and from then on played with no network.
 *  - Startup never touches the network. When online, `check()` reads the manifest (short timeout, never throws)
 *    and the menu offers new maps / updates; the player downloads now or later.
 *  - Updates are incremental (only files whose hash changed) and safe: every file is verified (SHA-256), the
 *    installed record switches to the new version in one write only when all of it is on the device, and
 *    only then are files nobody references any more deleted. A failed or interrupted download leaves the old
 *    version untouched (and resumes next time).
 *  - Maps a newer app is needed for (minApp > APP_CONTENT_VERSION) are listed but not offered.
 *
 * Protocol v2 (any number of maps): the server keeps catalog.json (every map, no file lists) and one immutable
 * pack manifest per map version (files/<sha256>), fetched only when that map is downloaded. A map can also need
 * gameplay mechanics this build does not have yet (`mechanics`): it is listed but waits for an app update.
 * The device keeps only the maps around the player (prune), so storage does not grow with the number of maps.
 *
 * The game keeps using the same logical paths (maps/map002.json, assets/map002/x.glb): installed packs are
 * mounted under them and served from storage as blob: URLs.
 */
export const APP_CONTENT_VERSION = 2; // 2: swinging / turning movers, map pad models, multi-height rings (Map 003)

const BASE = import.meta.env.BASE_URL;
const ENV_URL = (import.meta.env.VITE_CONTENT_URL as string | undefined)?.trim();
export const CONTENT_URL = ENV_URL ? (ENV_URL.endsWith('/') ? ENV_URL : ENV_URL + '/') : BASE + 'content/';

/** Gameplay mechanics this build implements (map data may only use these; see docs/MECHANICS.md). */
export const MECHANICS = new Set([
  'ladder', 'jump-pad', 'speed-pad', 'speed-ring', 'ledge',
  'mover:crane', 'mover:hover', 'mover:swing', 'mover:rotor',
]);
export const supports = (m: { minApp?: number; mechanics?: string[] }) => (m.minApp ?? 1) <= APP_CONTENT_VERSION && (m.mechanics ?? []).every((x) => MECHANICS.has(x));

export type BundledEntry = MapRegistryEntry & { order: number; bundled: true; version?: number; hash?: string; summary?: string };

export type MapStatus = {
  id: string;
  name: string;
  order: number;
  yMin: number;
  summary: string;
  /** on this device: 'bundled' (inside the app) | 'pack' (downloaded) | null */
  source: 'bundled' | 'pack' | null;
  version: number | null;
  /** from the last manifest seen online */
  remote: RemoteMap | null;
  state: 'ready' | 'update' | 'download' | 'needs-app' | 'needs-previous';
  /** bytes to download for 'update' / 'download' (only the changed files) */
  bytes: number;
};

export type Progress = { id: string; done: number; total: number; files: number; filesDone: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ContentManager {
  store = new ContentStore();
  state: ContentState = { packs: {}, manifest: null, manifestAt: 0, pending: {} };
  bundled: BundledEntry[] = [];
  /** result of the last online check: true / false (offline, server unreachable) / null (not checked yet) */
  online: boolean | null = null;
  installing: Progress | null = null;
  private urls = new Map<string, Promise<string | null>>();
  private mounts = new Map<string, string>();
  /** maps in use this session keep the files they were loaded with until the app restarts */
  private pinned = new Map<string, Record<string, [string, number]> | null>();
  private listeners = new Set<() => void>();
  /** hashes already present locally (filled lazily) */
  private present = new Set<string>();

  onChange(f: () => void) { this.listeners.add(f); return () => this.listeners.delete(f); }
  private emit() { for (const f of this.listeners) { try { f(); } catch (e) { console.warn(e); } } }

  /** Offline-safe: bundled index + what is already on the device. */
  async init() {
    await this.store.open();
    this.state = await this.store.getState();
    try {
      const r = await fetch(BASE + 'maps/index.json');
      this.bundled = (await r.json()) as BundledEntry[];
    } catch (e) { console.warn('bundled map index missing', e); this.bundled = []; }
    this.remount();
    // housekeeping: drop files no installed map (or paused download) references
    void this.store.gc(this.keepSet()).catch(() => 0);
  }

  // ---------------------------------------------------------------- what is playable
  private keepSet() {
    const keep = new Set<string>();
    for (const p of Object.values(this.state.packs)) for (const f of Object.values(p.files)) keep.add(f[0]);
    for (const hs of Object.values(this.state.pending)) for (const h of hs) keep.add(h);
    return keep;
  }

  /** where a map is played from on this device: the newer of the app's own copy and a download (tie: app). */
  private source(id: string): { kind: 'bundled'; b: BundledEntry } | { kind: 'pack'; p: InstalledPack } | null {
    const b = this.bundled.find((x) => x.id === id);
    const p = this.state.packs[id];
    if (b && (!p || (b.version ?? 0) >= p.version)) return { kind: 'bundled', b };
    if (p) return { kind: 'pack', p };
    return null;
  }

  private remount() {
    this.mounts.clear();
    const ids = new Set([...this.bundled.map((b) => b.id), ...Object.keys(this.state.packs)]);
    for (const id of ids) {
      const files = this.pinned.has(id) ? this.pinned.get(id) : (() => { const s = this.source(id); return s?.kind === 'pack' ? s.p.files : null; })();
      if (files) for (const [path, [hash]] of Object.entries(files)) this.mounts.set(path, hash);
    }
  }

  /** Asset resolver: logical path -> blob: URL for downloaded files, null for files inside the app. */
  resolve = (path: string): Promise<string | null> => {
    const hash = this.mounts.get(path.replace(/^\//, ''));
    if (!hash) return Promise.resolve(null);
    let u = this.urls.get(hash);
    if (!u) {
      u = this.store.getBlob(hash).then((b) => {
        if (!b) throw new Error(`downloaded file missing from storage: ${path}`);
        return URL.createObjectURL(b);
      });
      this.urls.set(hash, u);
      u.catch(() => this.urls.delete(hash));
    }
    return u;
  };

  /** Maps playable right now, bottom to top. A map is playable when it is on the device together with the maps
   *  it names in `requires` (only maps whose falls end in the map below need one; later maps are self-contained,
   *  so any of them can be installed, played or pruned on its own). */
  entries(): MapRegistryEntry[] {
    const all: (MapRegistryEntry & { order: number; requires: string[] })[] = [];
    const ids = new Set([...this.bundled.map((b) => b.id), ...Object.keys(this.state.packs)]);
    for (const id of ids) {
      const s = this.source(id);
      if (!s) continue;
      if (s.kind === 'bundled') all.push({ ...s.b, requires: [] });
      else all.push({ id, name: s.p.name, file: s.p.entry, yMin: s.p.yMin, yMax: s.p.yMax, order: s.p.order, requires: s.p.requires ?? [] });
    }
    all.sort((a, b) => a.order - b.order);
    const ok = new Set<string>();
    const out: MapRegistryEntry[] = [];
    for (const e of all) {
      if (e.requires.every((r) => ok.has(r))) { ok.add(e.id); out.push({ id: e.id, name: e.name, file: e.file, yMin: e.yMin, yMax: e.yMax, order: e.order }); }
    }
    return out; // (requires are checked against maps lower in the order: a dependency must sit below)
  }

  /** a loaded map keeps its files for this session (an update installed meanwhile applies on next start) */
  pin(id: string) {
    if (this.pinned.has(id)) return;
    const s = this.source(id);
    this.pinned.set(id, s?.kind === 'pack' ? s.p.files : null); // null: the app's own copy
  }

  /** an update is on the device but this session still runs the version it started with */
  updatePendingRestart(id: string) {
    if (!this.pinned.has(id)) return false;
    const s = this.source(id);
    const now = s?.kind === 'pack' ? s.p.files : null;
    return this.pinned.get(id) !== now;
  }

  // ---------------------------------------------------------------- online
  /** Read the server manifest. Short timeout, never throws: offline just means "nothing new". */
  async check(timeoutMs = 6000): Promise<RemoteManifest | null> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.online = false; this.emit(); return null; }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      let m: RemoteManifest | null = null;
      const c = await fetch(CONTENT_URL + 'catalog.json', { cache: 'no-store', signal: ctl.signal }).catch(() => null);
      if (c?.ok) {
        const cat = (await c.json()) as RemoteManifest;
        if (cat && cat.schema === 2 && Array.isArray(cat.maps)) {
          // keep the file lists already fetched for the same pack manifest
          const old = new Map((this.state.manifest?.maps ?? []).map((x) => [x.id, x]));
          cat.maps = cat.maps.map((x) => { const o = old.get(x.id); return { ...x, files: o && o.pack === x.pack && Object.keys(o.files ?? {}).length ? o.files : {} }; });
          m = cat;
        }
      }
      if (!m) {
        const r = await fetch(CONTENT_URL + 'manifest.json', { cache: 'no-store', signal: ctl.signal });
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        m = (await r.json()) as RemoteManifest;
        if (!m || m.schema !== 1 || !Array.isArray(m.maps)) throw new Error('bad manifest');
      }
      this.online = true;
      this.state.manifest = m;
      this.state.manifestAt = Date.now();
      await this.store.setState(this.state).catch(() => {});
      await this.refreshPresent();
      this.emit();
      return m;
    } catch (e) {
      this.online = false;
      console.info('content server not reachable (offline play):', (e as Error).message);
      this.emit();
      return null;
    } finally { clearTimeout(timer); }
  }

  private async refreshPresent() {
    const m = this.state.manifest;
    if (!m) return;
    const hashes = new Set(m.maps.flatMap((x) => Object.values(x.files).map((f) => f[0])));
    for (const h of hashes) if (!this.present.has(h) && (await this.store.hasBlob(h).catch(() => false))) this.present.add(h);
  }

  private missingBytes(r: RemoteMap) {
    if (!Object.keys(r.files ?? {}).length) return r.size; // v2 catalog entry: exact delta known once its pack manifest is read
    let n = 0;
    const seen = new Set<string>();
    for (const [h, size] of Object.values(r.files)) if (!this.present.has(h) && !seen.has(h)) { seen.add(h); n += size; }
    return n;
  }

  /** Everything the maps menu shows: on-device maps and what the last manifest offered. */
  statuses(): MapStatus[] {
    const remote = this.state.manifest?.maps ?? [];
    const ids = new Set([...this.bundled.map((b) => b.id), ...Object.keys(this.state.packs), ...remote.map((r) => r.id)]);
    const playable = new Set(this.entries().map((e) => e.id));
    const out: MapStatus[] = [];
    for (const id of ids) {
      const s = this.source(id);
      const r = remote.find((x) => x.id === id) ?? null;
      const version = s ? (s.kind === 'bundled' ? s.b.version ?? 0 : s.p.version) : null;
      const hash = s ? (s.kind === 'bundled' ? s.b.hash : s.p.hash) : undefined;
      const name = r?.name ?? (s?.kind === 'bundled' ? s.b.name : s?.p.name) ?? id;
      const order = r?.order ?? (s?.kind === 'bundled' ? s.b.order : s?.p.order) ?? 99;
      const yMin = r?.yMin ?? (s?.kind === 'bundled' ? s.b.yMin : s?.p.yMin) ?? 0;
      let state: MapStatus['state'] = 'ready';
      if (r && !supports(r)) state = s ? 'ready' : 'needs-app';
      else if (!s) state = 'download';
      else if (r && r.hash !== hash && r.version >= (version ?? 0)) state = 'update';
      if (s && !playable.has(id)) state = 'needs-previous';
      out.push({ id, name, order, yMin, summary: r?.summary ?? (s?.kind === 'pack' ? s.p.summary ?? '' : s?.kind === 'bundled' ? s.b.summary ?? '' : ''), source: s?.kind ?? null, version, remote: r, state, bytes: r && (state === 'download' || state === 'update') ? this.missingBytes(r) : 0 });
    }
    return out.sort((a, b) => a.order - b.order);
  }

  /** New maps / updates the player has not dealt with yet (for the menu notice). */
  news() { return this.statuses().filter((s) => s.state === 'download' || s.state === 'update'); }

  // ---------------------------------------------------------------- install / update
  private queue: Promise<unknown> = Promise.resolve();
  private inflight = new Map<string, Promise<void>>();

  /**
   * Download a map (and any map below it that is missing), verify every file, then switch atomically.
   * Installs run one at a time (automatic background downloads and the maps menu share this queue);
   * asking again for a map that is already queued returns the same promise.
   */
  install(id: string, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<void> {
    const cur = this.inflight.get(id);
    if (cur) return cur;
    const run = this.queue.then(() => this.installNow(id, onProgress, signal));
    this.queue = run.catch(() => {});
    this.inflight.set(id, run);
    void run.catch(() => {}).finally(() => this.inflight.delete(id));
    return run;
  }

  private async installNow(id: string, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<void> {
    const r = this.state.manifest?.maps.find((x) => x.id === id);
    if (!r) throw new Error('Không tìm thấy map trên máy chủ');
    if (!supports(r)) throw new Error('Cần cập nhật ứng dụng để chơi map này');
    if (r.pack && !Object.keys(r.files ?? {}).length) r.files = await this.packFiles(r, signal);
    // already up to date (queued twice, or installed meanwhile)
    const have = this.source(id);
    if (have && (have.kind === 'bundled' ? have.b.hash : have.p.hash) === r.hash) return;
    for (const dep of r.requires ?? []) if (!this.entries().some((e) => e.id === dep)) await this.installNow(dep, onProgress, signal);
    void this.store.requestPersist();

    const need: [string, number][] = [];
    const seen = new Set<string>();
    for (const [h, size] of Object.values(r.files)) {
      if (seen.has(h)) continue;
      seen.add(h);
      if (!(await this.store.hasBlob(h))) need.push([h, size]);
      else this.present.add(h);
    }
    // remember the download so its finished files survive GC (resume after an interruption)
    this.state.pending[id] = [...seen];
    await this.store.setState(this.state);

    const prog: Progress = { id, done: 0, total: need.reduce((a, [, s]) => a + s, 0), files: need.length, filesDone: 0 };
    this.installing = prog;
    this.emit();
    onProgress?.(prog);
    try {
      let next = 0;
      const worker = async () => {
        while (next < need.length) {
          const [h, size] = need[next++];
          for (let attempt = 1; ; attempt++) {
            try {
              const res = await fetch(CONTENT_URL + 'files/' + h, { signal });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const buf = await res.arrayBuffer();
              if (buf.byteLength !== size) throw new Error('kích thước sai');
              if ((await sha256Async(buf)) !== h) throw new Error('mã kiểm tra sai');
              await this.store.putBlob(h, buf);
              this.present.add(h);
              prog.done += size;
              prog.filesDone++;
              onProgress?.(prog);
              this.emit();
              break;
            } catch (e) {
              if (signal?.aborted || attempt >= 3) throw e;
              await sleep(600 * attempt);
            }
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      // everything is on the device and verified: switch to the new version in a single write
      const rec: InstalledPack = {
        id, name: r.name, order: r.order, yMin: r.yMin, yMax: r.yMax, entry: r.entry, version: r.version, hash: r.hash,
        size: r.size, summary: r.summary, requires: r.requires ?? [], files: r.files, installedAt: Date.now(),
      };
      const st = await this.store.getState();
      st.packs[id] = rec;
      delete st.pending[id];
      st.manifest = this.state.manifest;
      st.manifestAt = this.state.manifestAt;
      await this.store.setState(st);
      this.state = st;
      // only now may the previous version's files go
      await this.store.gc(this.keepSet()).catch(() => 0);
      this.remount();
    } finally {
      this.installing = null;
      this.emit();
    }
  }

  /** Protocol v2: read one map's pack manifest (content addressed: verified against its name). */
  private async packFiles(r: RemoteMap, signal?: AbortSignal): Promise<Record<string, [string, number]>> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(CONTENT_URL + 'files/' + r.pack, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if ((await sha256Async(buf)) !== r.pack) throw new Error('mã kiểm tra sai');
        const pm = JSON.parse(new TextDecoder().decode(buf)) as { id: string; hash: string; files: Record<string, [string, number]> };
        if (pm.id !== r.id || pm.hash !== r.hash) throw new Error('pack manifest không khớp');
        const st = this.state.manifest?.maps.find((x) => x.id === r.id);
        if (st) { st.files = pm.files; await this.store.setState(this.state).catch(() => {}); }
        return pm.files;
      } catch (e) {
        if (signal?.aborted || attempt >= 3) throw e;
        await sleep(600 * attempt);
      }
    }
  }

  /**
   * Keep storage bounded however many maps exist: downloaded maps outside `keep` are removed once more than
   * `max` are on the device (farthest from the player first). They come back by themselves when needed.
   */
  async prune(keep: Set<string>, distance: (id: string) => number, max = 10) {
    const installed = Object.keys(this.state.packs).filter((id) => !this.pinned.has(id) && !keep.has(id));
    let over = Object.keys(this.state.packs).length - max;
    if (over <= 0) return [];
    const gone: string[] = [];
    for (const id of installed.sort((a, b) => distance(b) - distance(a))) {
      if (over-- <= 0) break;
      // never break a kept map's dependency
      const needed = [...keep].some((k) => this.state.packs[k]?.requires?.includes(id));
      if (needed) continue;
      await this.remove(id);
      gone.push(id);
    }
    return gone;
  }

  /** Remove a downloaded map (frees space; bundled maps cannot be removed). */
  async remove(id: string) {
    const st = await this.store.getState();
    delete st.packs[id];
    delete st.pending[id];
    await this.store.setState(st);
    this.state = st;
    await this.store.gc(this.keepSet()).catch(() => 0);
    this.remount();
    this.emit();
  }
}
