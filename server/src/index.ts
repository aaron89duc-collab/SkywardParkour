/**
 * Skyward Parkour API – online leaderboard (Cloudflare Worker + D1).
 *
 *   POST /v1/submit   { id, token, name, a: { height }, c: { height }, app }
 *        a = Adventure mode, c = Challenge mode (every run from 0 m). The device sends its best height, not
 *        single runs: idempotent, so a device that played offline for a week just sends once when back online.
 *   GET  /v1/board [?m=a|c] [&limit=50] [&me=<id>]
 *        Best-height top list for one mode + the caller's own rank. (Only height boards: no per-map boards.)
 *
 * Identity without accounts: the device makes a random id + secret token. The server stores only sha256(token);
 * only that device can change its row. Names may repeat: every player also has a 4-character tag.
 * The game runs on the player's device, so results cannot be fully trusted; the server rejects impossible heights
 * (> MAX_HEIGHT) and limits how often a device can write.
 */
export interface Env {
  DB: D1Database;
  MAX_HEIGHT?: string;
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
const RATE_MS = 3000;
type Mode = 'a' | 'c';
const COL: Record<Mode, { h: string; at: string }> = { a: { h: 'best_height', at: 'height_at' }, c: { h: 'best_height_c', at: 'height_at_c' } };

function readHeight(raw: unknown, maxH: number): number | 'bad' {
  if (!raw || typeof raw !== 'object') return 0;
  const height = Number((raw as Record<string, unknown>).height ?? 0);
  if (!Number.isFinite(height) || height < 0 || height > maxH) return 'bad';
  return Math.round(height * 10) / 10;
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
  // older clients sent { height } at the top level: that is Adventure. Any map times sent are ignored.
  const a = readHeight(body.a ?? { height: body.height }, maxH);
  const c = readHeight(body.c, maxH);
  if (a === 'bad' || c === 'bad') return json({ error: 'bad height' }, 422);
  const now = Date.now();
  const th = await sha256(token);
  const row = await env.DB.prepare('SELECT token_hash, best_height, best_height_c, last_submit FROM players WHERE id = ?').bind(id).first<{ token_hash: string; best_height: number; best_height_c: number; last_submit: number }>();
  if (!row) {
    const tag = (await sha256('tag:' + id)).slice(0, 4).toUpperCase();
    await env.DB.prepare('INSERT INTO players (id, token_hash, name, tag, best_height, height_at, best_height_c, height_at_c, created_at, updated_at, last_submit, submits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
      .bind(id, th, name, tag, a, now, c, now, now, now, now).run();
  } else {
    if (row.token_hash !== th) return json({ error: 'not your player' }, 403);
    if (now - row.last_submit < RATE_MS) return json({ error: 'slow down' }, 429, { 'Retry-After': '3' });
    const sets = ['name = ?', 'updated_at = ?', 'last_submit = ?', 'submits = submits + 1'];
    const vals: unknown[] = [name, now, now];
    if (a > row.best_height) { sets.push('best_height = ?', 'height_at = ?'); vals.push(a, now); }
    if (c > row.best_height_c) { sets.push('best_height_c = ?', 'height_at_c = ?'); vals.push(c, now); }
    await env.DB.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  }
  const tag = (await env.DB.prepare('SELECT tag FROM players WHERE id = ?').bind(id).first<{ tag: string }>())!.tag;
  return json({ ok: true, tag, rank: { a: await rankOf(env, 'a', id), c: await rankOf(env, 'c', id) } });
}

async function board(url: URL, env: Env) {
  const mode: Mode = url.searchParams.get('m') === 'c' ? 'c' : 'a';
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 50) || 50));
  const me = url.searchParams.get('me') ?? '';
  const c = COL[mode];
  type Row = { id: string; name: string; tag: string; v: number };
  const { results } = await env.DB.prepare(`SELECT id, name, tag, ${c.h} AS v FROM players WHERE ${c.h} > 0 ORDER BY ${c.h} DESC, ${c.at} ASC LIMIT ?`).bind(limit).all<Row>();
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM players WHERE ${c.h} > 0`).first<{ n: number }>())?.n ?? 0;
  const mine = ID_RE.test(me) ? await rankOf(env, mode, me) : null;
  return json({ board: 'height', mode, total, entries: results.map((r, i) => ({ rank: i + 1, name: r.name, tag: r.tag, v: r.v, me: r.id === me })), me: mine }, 200, { 'Cache-Control': 'public, max-age=15' });
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
