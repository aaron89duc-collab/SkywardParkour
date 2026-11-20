// Map content packs -> downloadable content (Cloudflare R2 or any static host).
//
//   node devtools/content.mjs build                 packs/*  ->  content-dist/{manifest.json, files/<sha256>}
//   node devtools/content.mjs publish --bucket B [--url https://maps.example.com/] [--dry-run]
//                                                   upload new files first, manifest.json last (wrangler, `wrangler login` once)
//   node devtools/content.mjs cors --bucket B       allow the game (any origin) to GET from the bucket
//
// A pack = packs/<id>/pack.json + its files, addressed by their logical game path (maps/map002.json,
// assets/map002/water_tower.glb ...). Files are stored content-addressed (files/<sha256>), so
//  - an update only uploads / downloads the files that really changed,
//  - files never change under a URL (cache forever), only manifest.json does (short cache).
// When a pack's content changes, its version is bumped automatically (pack.json keeps version + contentHash).
// Packs with "bundled": true ship inside the app too (Map 001); their version is written to public/maps/index.json
// so the game can tell whether R2 has something newer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = path.join(ROOT, 'packs');
const OUT = path.join(ROOT, 'content-dist');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/** Read every pack: files (logical path -> abs path, hash, size), pack hash. Does not write anything.
 *  `cache` (abs path -> {m, s, h}) skips re-hashing unchanged files (dev server). */
export function scanPacks(cache = null) {
  const packs = [];
  if (!fs.existsSync(PACKS)) return packs;
  for (const id of fs.readdirSync(PACKS).sort()) {
    const dir = path.join(PACKS, id);
    const pf = path.join(dir, 'pack.json');
    if (!fs.existsSync(pf)) continue;
    const meta = JSON.parse(fs.readFileSync(pf, 'utf8'));
    const root = meta.root ? path.resolve(dir, meta.root) : dir;
    const include = meta.include ?? [''];
    let rel = [];
    for (const inc of include) {
      const p = path.join(root, inc);
      if (!fs.existsSync(p)) throw new Error(`${id}: include "${inc}" not found`);
      if (fs.statSync(p).isDirectory()) walk(p, root, rel); else rel.push(inc);
    }
    rel = [...new Set(rel)].filter((r) => r !== 'pack.json').sort();
    if (!rel.includes(meta.entry)) throw new Error(`${id}: entry ${meta.entry} is not in the pack`);
    const files = {};
    let size = 0;
    for (const r of rel) {
      const abs = path.join(root, r);
      const st = fs.statSync(abs);
      let c = cache?.get(abs);
      if (!c || c.m !== st.mtimeMs || c.s !== st.size) { c = { m: st.mtimeMs, s: st.size, h: sha(fs.readFileSync(abs)) }; cache?.set(abs, c); }
      files[r] = { abs, hash: c.h, size: st.size };
      size += st.size;
    }
    const hash = sha(rel.map((r) => `${r}:${files[r].hash}`).join('\n'));
    packs.push({ id, dir, pf, meta, files, hash, size });
  }
  return packs;
}

/** Manifest JSON for the given packs (versions as currently recorded). */
export function manifestOf(packs) {
  return {
    schema: 1,
    generated: new Date().toISOString(),
    maps: packs.map((p) => ({
      id: p.id, name: p.meta.name, order: p.meta.order, yMin: p.meta.yMin, yMax: p.meta.yMax,
      entry: p.meta.entry, minApp: p.meta.minApp ?? 1, requires: p.meta.requires ?? [], summary: p.meta.summary ?? '',
      bundled: !!p.meta.bundled, version: p.meta.version, hash: p.hash, size: p.size,
      files: Object.fromEntries(Object.entries(p.files).map(([r, f]) => [r, [f.hash, f.size]])),
    })),
  };
}

export function build() {
  const packs = scanPacks();
  fs.mkdirSync(path.join(OUT, 'files'), { recursive: true });
  for (const p of packs) {
    if (p.meta.contentHash !== p.hash) {
      if (p.meta.contentHash) p.meta.version = (p.meta.version ?? 0) + 1;
      p.meta.version = p.meta.version ?? 1;
      p.meta.contentHash = p.hash;
      fs.writeFileSync(p.pf, JSON.stringify(p.meta, null, 1) + '\n');
      console.log(`${p.id}: content changed -> version ${p.meta.version}`);
    }
    for (const f of Object.values(p.files)) {
      const dst = path.join(OUT, 'files', f.hash);
      if (!fs.existsSync(dst)) fs.copyFileSync(f.abs, dst);
    }
  }
  const manifest = manifestOf(packs);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
  // drop files no pack references any more (local build dir only; R2 keeps old files for clients mid-update)
  const live = new Set(manifest.maps.flatMap((m) => Object.values(m.files).map((f) => f[0])));
  for (const f of fs.readdirSync(path.join(OUT, 'files'))) if (!live.has(f)) fs.rmSync(path.join(OUT, 'files', f));
  // bundled packs: the app's own index records which version it ships
  const idxFile = path.join(ROOT, 'public/maps/index.json');
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  for (const m of manifest.maps.filter((m) => m.bundled)) {
    const e = idx.find((x) => x.id === m.id);
    if (e) { e.version = m.version; e.hash = m.hash; }
  }
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1) + '\n');
  for (const m of manifest.maps) console.log(`${m.id} v${m.version}${m.bundled ? ' (bundled in app)' : ''}: ${Object.keys(m.files).length} files, ${(m.size / 1048576).toFixed(1)} MB`);
  return manifest;
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
}

function wrangler(args) {
  return execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...args], { stdio: 'pipe', cwd: ROOT, shell: process.platform === 'win32' }).toString();
}

async function publish() {
  const bucket = arg('bucket', process.env.R2_BUCKET);
  if (!bucket) throw new Error('--bucket <name> (or R2_BUCKET) is required');
  const url = arg('url', process.env.CONTENT_URL);
  const dry = process.argv.includes('--dry-run');
  const manifest = build();
  const have = new Set();
  const recFile = path.join(OUT, `.uploaded-${bucket}.json`);
  if (fs.existsSync(recFile)) for (const h of JSON.parse(fs.readFileSync(recFile, 'utf8'))) have.add(h);
  if (url) {
    try {
      const r = await fetch(new URL('manifest.json', url.endsWith('/') ? url : url + '/'), { cache: 'no-store' });
      if (r.ok) for (const m of (await r.json()).maps ?? []) for (const f of Object.values(m.files)) have.add(f[0]);
    } catch (e) { console.warn('could not read the live manifest:', e.message); }
  }
  const all = [...new Set(manifest.maps.flatMap((m) => Object.values(m.files).map((f) => f[0])))];
  const todo = all.filter((h) => !have.has(h));
  console.log(`${todo.length} new file(s) to upload, ${all.length - todo.length} already on R2`);
  let n = 0;
  for (const h of todo) {
    n++;
    console.log(`[${n}/${todo.length}] files/${h}`);
    if (!dry) {
      wrangler(['r2', 'object', 'put', `${bucket}/files/${h}`, '--file', path.join(OUT, 'files', h), '--remote',
        '--content-type', 'application/octet-stream', '--cache-control', 'public, max-age=31536000, immutable']);
      have.add(h);
      fs.writeFileSync(recFile, JSON.stringify([...have]));
    }
  }
  // the manifest goes last: a client never sees a manifest that points at files not uploaded yet
  console.log('manifest.json');
  if (!dry) wrangler(['r2', 'object', 'put', `${bucket}/manifest.json`, '--file', path.join(OUT, 'manifest.json'), '--remote',
    '--content-type', 'application/json', '--cache-control', 'public, max-age=60, must-revalidate']);
  console.log(dry ? 'dry run: nothing uploaded' : 'published');
}

function cors() {
  const bucket = arg('bucket', process.env.R2_BUCKET);
  if (!bucket) throw new Error('--bucket <name> (or R2_BUCKET) is required');
  const file = path.join(ROOT, 'devtools', 'r2-cors.json');
  console.log(wrangler(['r2', 'bucket', 'cors', 'set', bucket, '--file', file, '--force']));
}

const cmd = process.argv[2];
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (cmd === 'build') build();
  else if (cmd === 'publish') await publish();
  else if (cmd === 'cors') cors();
  else console.log('usage: node devtools/content.mjs build | publish --bucket <name> [--url <public url>] [--dry-run] | cors --bucket <name>');
}
