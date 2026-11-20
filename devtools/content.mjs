// Map content packs -> downloadable content (Cloudflare R2 or any static host).
//
// Content protocol v2 (web app now, Android app later; see docs/CONTENT_PROTOCOL.md):
//   catalog.json            every map in one small list (no file lists): id, name, order, heights, version, minApp,
//                           size, `pack` = sha256 of the map's pack manifest. Short cache: the only file that changes.
//   files/<sha256>          immutable, content addressed: every asset AND every pack manifest
//                           ({schema: 2, id, version, hash, entry, files: {logical path: [sha256, size]}}).
//   manifest.json           protocol v1 (all maps with their file lists) for app builds released before v2.
// Packs are self-contained: a map's pack lists every downloadable file its map JSON uses, even files that live in
// another pack's folder (same hash = stored once on R2 and on the device), so any map can be installed, played and
// removed on its own - the number of maps is not limited by the app or by the device.
//
//   node devtools/content.mjs build                 packs/*  ->  content-dist/{catalog.json, manifest.json, files/<sha256>}
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
    rel = [...new Set(rel)].filter((r) => r !== 'pack.json' && !r.endsWith('.info.json')).sort(); // .info.json: build tools only
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
    packs.push({ id, dir, pf, meta, files, size, root });
  }
  // self-contained packs: add the files a map uses from other (downloadable) packs
  const owner = new Map();
  for (const p of packs) if (!p.meta.bundled) for (const [r, f] of Object.entries(p.files)) if (!owner.has(r)) owner.set(r, f);
  for (const p of packs) {
    if (p.meta.bundled) continue;
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(p.root, p.meta.entry), 'utf8')); } catch { continue; }
    for (const ref of referencedFiles(data)) {
      if (p.files[ref]) continue;
      const f = owner.get(ref);
      if (f) { p.files[ref] = f; p.size += f.size; }
    }
  }
  for (const p of packs) {
    const rel = Object.keys(p.files).sort();
    p.files = Object.fromEntries(rel.map((r) => [r, p.files[r]]));
    p.hash = sha(rel.map((r) => `${r}:${p.files[r].hash}`).join('\n'));
  }
  return packs;
}

/** default models of the engine's moving-platform looks and jump pads (keep in step with src/world/Movers.ts, Boosters.ts) */
const MOVER_MODELS = {
  hover: 'assets/map002/hover_platform', pallet: 'assets/map003/cargo_pallet_stand', lift: 'assets/map003/lift_car',
  trolley: 'assets/map003/trolley_car', swing: 'assets/map003/hanging_container', rotor: 'assets/map003/crane_jib',
};
const PAD_MODEL = 'assets/map002/jump_pad';

/** Logical paths of the downloadable files a map JSON uses (models, collision meshes, atlas). */
export function referencedFiles(d) {
  const bases = new Set();
  for (const b of Object.values(d.prefabFiles ?? {})) bases.add(b);
  for (const m of d.movers ?? []) {
    const look = m.kind === 'swing' ? 'swing' : m.kind === 'rotor' ? 'rotor' : m.kind === 'hover' ? m.look ?? 'hover' : null;
    if (look) bases.add(d.moverModels?.[look] ?? MOVER_MODELS[look]);
  }
  if ((d.pads ?? []).some((p) => p.t === 'jump')) bases.add(d.padModel?.file ?? PAD_MODEL);
  if (d.atlas) bases.add(d.atlas);
  const out = new Set();
  for (const b of bases) for (const ext of ['.glb', '.col.bin', '.webp', '.json']) out.add(b + ext);
  return out;
}

/** Gameplay mechanics a map uses (the app must implement all of them: src/content/ContentManager.ts MECHANICS). */
export function mechanicsOf(d) {
  const m = new Set();
  if ((d.ladders ?? []).length) m.add('ladder');
  for (const p of d.pads ?? []) m.add(p.t === 'speed' ? 'speed-pad' : 'jump-pad');
  if ((d.rings ?? []).length) m.add('speed-ring');
  for (const mv of d.movers ?? []) m.add(`mover:${mv.kind}`);
  return [...m].sort();
}
function entryData(p) { try { return JSON.parse(fs.readFileSync(path.join(p.root, p.meta.entry), 'utf8')); } catch { return {}; } }

/** The pack manifest of one map (stored content addressed: files/<sha256 of this JSON>). */
export function packManifestOf(p) {
  const json = JSON.stringify({
    schema: 2, id: p.id, version: p.meta.version, hash: p.hash, entry: p.meta.entry,
    files: Object.fromEntries(Object.entries(p.files).map(([r, f]) => [r, [f.hash, f.size]])),
  });
  return { json, sha: sha(Buffer.from(json)) };
}

/** catalog.json (protocol v2): the list of maps, without file lists. */
export function catalogOf(packs) {
  return {
    schema: 2,
    generated: new Date().toISOString(),
    maps: packs.map((p) => ({
      id: p.id, name: p.meta.name, order: p.meta.order, yMin: p.meta.yMin, yMax: p.meta.yMax,
      entry: p.meta.entry, minApp: p.meta.minApp ?? 1, requires: p.meta.requires ?? [], summary: p.meta.summary ?? '',
      bundled: !!p.meta.bundled, version: p.meta.version, hash: p.hash, size: p.size, files: Object.keys(p.files).length,
      pack: packManifestOf(p).sha, mechanics: mechanicsOf(entryData(p)),
    })),
  };
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
  const live = new Set(manifest.maps.flatMap((m) => Object.values(m.files).map((f) => f[0])));
  for (const p of packs) { const pm = packManifestOf(p); fs.writeFileSync(path.join(OUT, 'files', pm.sha), pm.json); live.add(pm.sha); }
  const catalog = catalogOf(packs);
  fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog));
  // drop files no pack references any more (local build dir only; R2 keeps old files for clients mid-update)
  for (const f of fs.readdirSync(path.join(OUT, 'files'))) if (!live.has(f)) fs.rmSync(path.join(OUT, 'files', f));
  // bundled packs: the app's own index records which version it ships
  const idxFile = path.join(ROOT, 'public/maps/index.json');
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  for (const m of manifest.maps.filter((m) => m.bundled)) {
    const e = idx.find((x) => x.id === m.id);
    if (e) { e.version = m.version; e.hash = m.hash; if (m.summary) e.summary = m.summary; }
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
    const base = url.endsWith('/') ? url : url + '/';
    try {
      const r = await fetch(new URL('manifest.json', base), { cache: 'no-store' });
      if (r.ok) for (const m of (await r.json()).maps ?? []) for (const f of Object.values(m.files)) have.add(f[0]);
    } catch (e) { console.warn('could not read the live manifest:', e.message); }
    try {
      const r = await fetch(new URL('catalog.json', base), { cache: 'no-store' });
      if (r.ok) for (const m of (await r.json()).maps ?? []) {
        const pr = await fetch(new URL('files/' + m.pack, base));
        if (!pr.ok) continue;
        have.add(m.pack);
        for (const f of Object.values((await pr.json()).files ?? {})) have.add(f[0]);
      }
    } catch (e) { console.warn('could not read the live catalog:', e.message); }
  }
  const all = [...new Set([...manifest.maps.flatMap((m) => Object.values(m.files).map((f) => f[0])), ...scanPacks().map((p) => packManifestOf(p).sha)])];
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
  // the lists go last: a client never sees a list that points at files not uploaded yet
  for (const f of ['manifest.json', 'catalog.json']) {
    console.log(f);
    if (!dry) wrangler(['r2', 'object', 'put', `${bucket}/${f}`, '--file', path.join(OUT, f), '--remote',
      '--content-type', 'application/json', '--cache-control', 'public, max-age=60, must-revalidate']);
  }
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
