import type { ContentManager, MapStatus } from './ContentManager';

/**
 * What the player sees of map downloads: nothing, except a warning while maps ahead are missing and there is
 * no connection. (`busy` / `retry` are internal: downloads and failed attempts are never shown.)
 */
export type SyncView =
  | { kind: 'idle' }
  /** maps ahead are missing and there is no connection: ask for internet, retry by itself */
  | { kind: 'offline'; names: string[] }
  | { kind: 'busy' }
  | { kind: 'retry' };

/**
 * Keeps the maps the player is about to need on the device without any tap or any message:
 * every map up to AHEAD maps past the furthest map in play (playing Map 001 -> 002, 003, 004 are kept),
 * plus updates of those maps. Downloads run in the background (one at a time, verified, atomic switch);
 * offline it shows a warning and starts by itself as soon as the connection is back.
 */
export class AutoSync {
  static AHEAD = 3;
  view: SyncView = { kind: 'idle' };
  private running = false;
  private again = false;
  private forceCheck = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private content: ContentManager,
    /** order of the furthest map in play (current map / furthest reached) */
    private anchorOrder: () => number,
    /** a map (or an update) finished installing: `fresh` = it was not on the device before */
    private installed: (id: string, fresh: boolean) => Promise<void>,
    private onView: (v: SyncView) => void,
  ) {
    // connection back / app back in front (players switch Wi-Fi on in the system settings): try right away
    window.addEventListener('online', () => { this.forceCheck = true; this.kick(300); });
    window.addEventListener('offline', () => this.kick(300));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { this.forceCheck = true; this.kick(500); } });
  }

  /** maps to fetch now, lowest first (a map needs the ones below it) */
  /** downloaded maps kept below the player (falls, the way back, replays) */
  static readonly BEHIND = 3;
  wanted(): MapStatus[] {
    const lim = this.anchorOrder() + AutoSync.AHEAD;
    return this.content.statuses().filter((s) => s.order <= lim && (s.state === 'download' || s.state === 'update'));
  }

  /** maps ahead that are not on the device at all (updates only refresh what is already playable) */
  missing(): MapStatus[] { return this.wanted().filter((s) => s.state === 'download'); }

  /** run soon (coalesces repeated calls) */
  kick(delayMs = 0) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, delayMs);
  }

  async run() {
    if (this.running) { this.again = true; return; }
    this.running = true;
    try {
      do { this.again = false; await this.pass(); } while (this.again);
    } finally { this.running = false; }
  }

  private set(v: SyncView) {
    this.view = v;
    this.onView(v);
  }

  private offline() {
    const miss = this.missing();
    // never reached the server yet: we cannot know what is missing, but there is at least the next map
    const unknown = !this.content.state.manifest;
    if (miss.length || unknown) { this.set({ kind: 'offline', names: miss.map((s) => s.name) }); this.kick(20000); }
    else this.set({ kind: 'idle' });
  }

  private async pass() {
    const stale = Date.now() - (this.content.state.manifestAt || 0) > 5 * 60 * 1000;
    if (this.content.online !== true || stale || this.forceCheck || navigator.onLine === false) {
      this.forceCheck = false;
      await this.content.check();
    }
    if (this.content.online !== true) { this.offline(); return; }
    let lastId = '';
    for (;;) {
      const list = this.wanted();
      const s = list[0];
      if (!s) break;
      if (s.id === lastId) { this.set({ kind: 'retry' }); this.kick(60000); return; } // did not take: no loop
      lastId = s.id;
      const fresh = s.state === 'download';
      this.set({ kind: 'busy' });
      try {
        await this.content.install(s.id);
      } catch {
        // connection lost midway or a bad file on the server: what is on the device stays as it was
        await this.content.check();
        if (this.content.online !== true) { this.offline(); return; }
        this.set({ kind: 'retry' });
        this.kick(60000);
        return;
      }
      await this.installed(s.id, fresh).catch((e) => console.warn('after install', e));
    }
    // bounded storage: keep the maps around the player, drop far ones (they download again when needed)
    const a = this.anchorOrder();
    const st = this.content.statuses();
    const ord = new Map(st.map((x) => [x.id, x.order]));
    const keep = new Set(st.filter((x) => x.order >= a - AutoSync.BEHIND && x.order <= a + AutoSync.AHEAD).map((x) => x.id));
    await this.content.prune(keep, (id) => Math.abs((ord.get(id) ?? a) - a)).catch((e) => console.warn('prune', e));
    this.set({ kind: 'idle' });
  }
}
