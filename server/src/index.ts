/**
 * Skyward Parkour API – online leaderboard (Cloudflare Worker + D1).
 *
 *   POST /v1/submit   { id, token, name, a: { height, times }, c: { height, times }, app }
 *        a = Adventure mode, c = Challenge mode (every run from 0 m). The device sends its best results, not
 *        single runs: idempotent, so a device that played offline for a week just sends once when back online.
 *        Best height = max, best time = min. Implausible map times are ignored (the rest is still accepted).
 *   GET  /v1/board?b=height | b=time:map002 [&m=a|c] [&limit=50] [&me=<id>]
 *        Top list + the caller's own rank.
 *
 * Identity without accounts: the device makes a random id + secret token. The server stores only sha256(token);
 * only that device can change its row. Names may repeat: every player also has a 4-character tag.
 * The game runs on the player's device, so results cannot be fully trusted; the server rejects impossible heights
 * (> MAX_HEIGHT), ignores map times under MIN_MAP_SECONDS and limits how often a device can write.
 */
export interface Env {
  DB: D1Database;
  MAX_HEIGHT?: string;
  MIN_MAP_SECONDS?: string;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 2–16 characters: letters (any language, incl. Vietnamese), digits, space, _ . - */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if ([...n].length < 2 || [...n].length > 16) return null;
  if (!/^[\p{L}\p{M}\p{N} _.\-]+$/u.test(n)) return null;
  return n;
}

const ID_RE = /^[a-z0-9-]{8,64}$/;
const TOKEN_RE = /^[a-f0-9]{32,128}$/;
const MAP_RE = /^map\d{3}$/;
const RATE_MS = 3000;
type Mode = 'a' | 'c';
const COL: Record<Mode, { h: string; at: string }> = { a: { h: 'best_height', at: 'height_at' }, c: { h: 'best_height_c', at: 'height_at_c' } };

type Part = { height: number; times: [string, number][] };

function readPart(raw: unknown, maxH: number, minT: number): Part | 'bad' {
  if (!raw || typeof raw !== 'object') return { height: 0, times: [] };
  const o = raw as Record<string, unknown>;
  const height = Number(o.height ?? 0);
  if (!Number.isFinite(height) || height < 0 || height > maxH) return 'bad';
  const times: [string, number][] = [];
  if (o.times && typeof o.times === 'object') {
    for (const [k, v] of Object.entries(o.times as Record<string, unknown>).slice(0, 50)) {
      const t = Number(v);
      // an implausible time is dropped, the rest of the results still count
      if (MAP_RE.test(k) && Number.isFinite(t) && t >= minT && t <= 7 * 86400) times.push([k, Math.round(t * 100) / 100]);
    }
  }
  return { height: Math.round(height * 10) / 10, times };
}

async function rankOf(env: Env, mode: Mode, id: string) {
  const c = COL[mode];
  const me = await env.DB.prepare(`SELECT ${c.h} AS v, ${c.at} AS at FROM players WHERE id = ?`).bind(id).first<{ v: number; at: number }>();
  if (!me || me.v <= 0) return null;
  const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE ${c.h} > ? OR (${c.h} = ? AND ${c.at} < ?)`).bind(me.v, me.v, me.at).first<{ n: number }>();
  return { rank: (n?.n ?? 0) + 1, v: me.v };
}

async function submit(req: Request, env: Env) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const id = String(body.id ?? '');
  const token = String(body.token ?? '');
  if (!ID_RE.test(id) || !TOKEN_RE.test(token)) return json({ error: 'bad identity' }, 400);
  const name = cleanName(body.name);
  if (!name) return json({ error: 'bad name' }, 400);
  const maxH = Number(env.MAX_HEIGHT ?? 1500);
  const minT = Number(env.MIN_MAP_SECONDS ?? 30);
  // older clients sent { height, times } at the top level: that is Adventure
  const a = readPart(body.a ?? { height: body.height, times: body.times }, maxH, minT);
  const c = readPart(body.c, maxH, minT);
  if (a === 'bad' || c === 'bad') return json({ error: 'bad height' }, 422);
  const now = Date.now();
  const th = await sha256(token);
  const row = await env.DB.prepare('SELECT token_hash, best_height, best_height_c, last_submit FROM players WHERE id = ?').bind(id).first<{ token_hash: string; best_height: number; best_height_c: number; last_submit: number }>();
  if (!row) {
    const tag = (await sha256('tag:' + id)).slice(0, 4).toUpperCase();
    await env.DB.prepare('INSERT INTO players (id, token_hash, name, tag, best_height, height_at, best_height_c, height_at_c, created_at, updated_at, last_submit, submits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
      .bind(id, th, name, tag, a.height, now, c.height, now, now, now, now).run();
  } else {
    if (row.token_hash !== th) return json({ error: 'not your player' }, 403);
    if (now - row.last_submit < RATE_MS) return json({ error: 'slow down' }, 429, { 'Retry-After': '3' });
    const sets = ['name = ?', 'updated_at = ?', 'last_submit = ?', 'submits = submits + 1'];
    const vals: unknown[] = [name, now, now];
    if (a.height > row.best_height) { sets.push('best_height = ?', 'height_at = ?'); vals.push(a.height, now); }
    if (c.height > row.best_height_c) { sets.push('best_height_c = ?', 'height_at_c = ?'); vals.push(c.height, now); }
    await env.DB.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  }
  const stmts = [...a.times.map(([m, t]) => ['a', m, t] as const), ...c.times.map(([m, t]) => ['c', m, t] as const)].map(([mode, m, t]) =>
    env.DB.prepare('INSERT INTO times (player_id, mode, map_id, seconds, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (player_id, mode, map_id) DO UPDATE SET seconds = excluded.seconds, at = excluded.at WHERE excluded.seconds < times.seconds')
      .bind(id, mode, m, t, now));
  if (stmts.length) await env.DB.batch(stmts);
  const tag = (await env.DB.prepare('SELECT tag FROM players WHERE id = ?').bind(id).first<{ tag: string }>())!.tag;
  return json({ ok: true, tag, rank: { a: await rankOf(env, 'a', id), c: await rankOf(env, 'c', id) } });
}

async function board(url: URL, env: Env) {
  const b = url.searchParams.get('b') ?? 'height';
  const mode: Mode = url.searchParams.get('m') === 'c' ? 'c' : 'a';
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 50) || 50));
  const me = url.searchParams.get('me') ?? '';
  const cache = { 'Cache-Control': 'public, max-age=15' };
  type Row = { id: string; name: string; tag: string; v: number; at: number };
  const shape = (results: Row[], total: number, mine: unknown) =>
    json({ board: b, mode, total, entries: results.map((r, i) => ({ rank: i + 1, name: r.name, tag: r.tag, v: r.v, me: r.id === me })), me: mine }, 200, cache);
  if (b === 'height') {
    const c = COL[mode];
    const { results } = await env.DB.prepare(`SELECT id, name, tag, ${c.h} AS v, ${c.at} AS at FROM players WHERE ${c.h} > 0 ORDER BY ${c.h} DESC, ${c.at} ASC LIMIT ?`).bind(limit).all<Row>();
    const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE ${c.h} > 0`).first<{ n: number }>())?.n ?? 0;
    return shape(results, total, ID_RE.test(me) ? await rankOf(env, mode, me) : null);
  }
  const m = /^time:(map\d{3})$/.exec(b);
  if (!m) return json({ error: 'unknown board' }, 400);
  const { results } = await env.DB.prepare('SELECT p.id, p.name, p.tag, t.seconds AS v, t.at FROM times t JOIN players p ON p.id = t.player_id WHERE t.mode = ? AND t.map_id = ? ORDER BY t.seconds ASC, t.at ASC LIMIT ?').bind(mode, m[1], limit).all<Row>();
  const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM times WHERE mode = ? AND map_id = ?').bind(mode, m[1]).first<{ n: number }>())?.n ?? 0;
  let mine = null;
  if (ID_RE.test(me)) {
    const r = await env.DB.prepare('SELECT seconds AS v, at FROM times WHERE player_id = ? AND mode = ? AND map_id = ?').bind(me, mode, m[1]).first<{ v: number; at: number }>();
    if (r) {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM times WHERE mode = ? AND map_id = ? AND (seconds < ? OR (seconds = ? AND at < ?))').bind(mode, m[1], r.v, r.v, r.at).first<{ n: number }>();
      mine = { rank: (n?.n ?? 0) + 1, v: r.v };
    }
  }
  return shape(results, total, mine);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === '/v1/submit' && req.method === 'POST') return await submit(req, env);
      if (url.pathname === '/v1/board' && req.method === 'GET') return await board(url, env);
      if (url.pathname === '/' || url.pathname === '/v1/health') return json({ ok: true, service: 'skyward-api' });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'server error' }, 500);
    }
  },
};
