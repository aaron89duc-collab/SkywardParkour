import type { SaveData } from '../systems/Score';
import { writeSave } from '../systems/Score';

/**
 * Online leaderboard, offline-first.
 *  - The name is set on the device (no account, no network needed). A random id + secret token identify the
 *    device to the server (Cloudflare Worker + D1, see server/).
 *  - What is sent is the player's best results (best height ever, best full-climb time per map). Playing offline
 *    just leaves them unsent; they go out the next time the game is online (menu, end of a map, 'online' event).
 *  - Boards are cached on the device and shown (marked as such) while offline.
 *  - Nothing here ever blocks or slows the game: short timeouts, errors are swallowed.
 */
const ENV_API = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
export const API_URL = ENV_API ? ENV_API.replace(/\/$/, '') : '';
const CACHE_KEY = 'skyward-parkour.lb.';

export type BoardEntry = { rank: number; name: string; tag: string; v: number; me: boolean };
export type Board = { board: string; total: number; entries: BoardEntry[]; me: { rank: number; v: number } | null };
export type BoardResult = Board & { at: number; cached: boolean };

/** 2–16 characters: letters (Vietnamese included), digits, space, _ . -  (same rule as the server) */
export function cleanName(raw: string): string | null {
  const n = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  const len = [...n].length;
  if (len < 2 || len > 16) return null;
  if (!/^[\p{L}\p{M}\p{N} _.\-]+$/u.test(n)) return null;
  return n;
}

function rand(bytes: number) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function withTimeout(url: string, init: RequestInit = {}, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

export class Leaderboard {
  /** last known reachability of the server */
  online: boolean | null = null;
  private busy = false;

  constructor(private save: SaveData, private firstMapId: () => string) {}

  get enabled() { return !!API_URL; }
  get profile() { return this.save.profile ?? null; }
  get hasName() { return !!this.save.profile?.name; }

  /** set or change the player's name (offline is fine: it is sent with the next submission) */
  setName(name: string) {
    const n = cleanName(name);
    if (!n) return false;
    if (!this.save.profile) this.save.profile = { name: n, id: crypto.randomUUID ? crypto.randomUUID() : `${rand(4)}-${rand(2)}-${rand(2)}-${rand(2)}-${rand(6)}`, token: rand(32) };
    else this.save.profile.name = n;
    this.save.lbSent = undefined; // name changed: send again
    writeSave(this.save);
    return true;
  }

  /** what would be sent now: Adventure (a) and Challenge (c) records; full-climb times only */
  private payload() {
    const p = this.save.profile!;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const at: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.save.bestTimes ?? {})) if (v && v > 0) at[k] = r2(v);
    if (this.save.bestTime && !at[this.firstMapId()]) at[this.firstMapId()] = r2(this.save.bestTime);
    const ch = this.save.challenge;
    const ct: Record<string, number> = {};
    for (const [k, v] of Object.entries(ch?.bestTimes ?? {})) if (v && v > 0) ct[k] = r2(v);
    return {
      id: p.id, token: p.token, name: p.name, app: 1,
      a: { height: Math.round(this.save.personalBest * 10) / 10, times: at },
      c: { height: Math.round((ch?.best ?? 0) * 10) / 10, times: ct },
    };
  }

  private signature() {
    const b = this.payload();
    return JSON.stringify([b.name, b.a, b.c]);
  }

  /** results not accepted by the server yet */
  get dirty() { return !!this.save.profile && (this.save.personalBest > 0 || (this.save.challenge?.best ?? 0) > 0) && this.save.lbSent !== this.signature(); }

  /** Send the best results if they changed. Safe to call often; does nothing offline or without a server. */
  async sync(): Promise<boolean> {
    if (!this.enabled || !this.save.profile || this.busy || !this.dirty) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.online = false; return false; }
    this.busy = true;
    try {
      const body = this.payload();
      const sig = this.signature();
      const r = await withTimeout(`${API_URL}/v1/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      this.online = true;
      if (r.ok) {
        const j = await r.json();
        if (j.tag) this.save.profile!.tag = j.tag;
        this.save.lbSent = sig;
        writeSave(this.save);
        return true;
      }
      if (r.status === 403 || r.status === 400 || r.status === 422) {
        // the server will never accept this as it is (e.g. results from an old cheat-y save): do not retry forever
        console.warn('leaderboard rejected results', r.status, await r.text());
        this.save.lbSent = sig;
        writeSave(this.save);
      }
      return false;
    } catch {
      this.online = false;
      return false;
    } finally { this.busy = false; }
  }

  /** A board ("c|height", "a|time:map002" ...), from the server when online, else the copy saved last time. */
  async board(id: string, limit = 50): Promise<BoardResult | null> {
    const [mode, b] = id.includes('|') ? id.split('|') : ['a', id];
    const key = CACHE_KEY + id;
    const cached = (): BoardResult | null => {
      try { const c = JSON.parse(localStorage.getItem(key) ?? 'null'); return c ? { ...c, cached: true } : null; } catch { return null; }
    };
    if (!this.enabled) return cached();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.online = false; return cached(); }
    try {
      await this.sync();
      const me = this.save.profile?.id ? `&me=${encodeURIComponent(this.save.profile.id)}` : '';
      const r = await withTimeout(`${API_URL}/v1/board?b=${encodeURIComponent(b)}&m=${mode === 'c' ? 'c' : 'a'}&limit=${limit}${me}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as Board;
      this.online = true;
      const res: BoardResult = { ...data, at: Date.now(), cached: false };
      try { localStorage.setItem(key, JSON.stringify(res)); } catch { /* full */ }
      return res;
    } catch {
      this.online = false;
      return cached();
    }
  }
}
