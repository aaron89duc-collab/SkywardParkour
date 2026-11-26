// Map 006 – Mushroom Forest (935 -> 1150 m). A floating forest round one colossal ancient tree, entered through Toy
// Universe's summit gate. Same frame as Maps 003-005 (two interleaved halves, W / E, 16 m wide), but the halves meet
// at the tree: its trunk stands on the line between them (x = -60) all the way up to its crown, the summit. The map is
// about reading NATURE: red-and-white caps bounce you straight up, orange caps lean and throw you the way they lean,
// small violet caps throw you high; wood (trunk, branches, roots, shelf fungi) is solid; glowing cyan mushrooms mark
// where to land; vines are climbed. Every zone has its main way, an easier way, a harder way and a secret.
// Run: node devtools/build-map006.mjs -> packs/map006/maps/map006.json (+ devtools/out/map006_plan.png, routes006.json)
//   STAGE=n  build zones 1..n only     SHOWPATH=1  print the validator's paths     NOWRITE=1  validate only
import fs from 'fs';
import { applyI18n, applyPackI18n } from './i18n-content.mjs';
import { MapBuilder, r2, makeWaypoints } from './mapgen/lib.mjs';
import { plotMap } from './mapgen/plot.mjs';
import { zonePlot } from './mapgen/zoneplot.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const A = 'assets/map006', A6 = A;
const C6 = { x: -60, z: -9 };
const RING = 24;
const Y1 = 935, Y2 = 960, Y3 = 990, Y4 = 1020, Y5 = 1050, Y6 = 1085, Y7 = 1115, TOP = 1150;
const HALF = { W: { x0: -76, x1: -60, xc: -68 }, E: { x0: -60, x1: -44, xc: -52 } };
const Z0 = -25, Z1 = 6;
const B = new MapBuilder({ ground: { x: C6.x, y: -999, z: C6.z, r: 0 } });
B.seed = 6;
B.supportR = 0.22;
const STAGE = process.env.STAGE ?? 'all';
const upTo = (n) => STAGE === 'all' || +STAGE >= n;

// ---------------------------------------------------------------- the models: normalised size + flat top height
const info = (id) => JSON.parse(fs.readFileSync(`${ROOT}packs/map006/assets/map006/${id}.info.json`, 'utf8'));
const SZ = {}, FT = {};
for (const f of fs.readdirSync(`${ROOT}packs/map006/assets/map006`).filter((f) => f.endsWith('.info.json'))) {
  const id = f.replace('.info.json', ''), d = info(id);
  SZ[id] = d.size;
  const h = {};
  for (const v of d.top.flatMap((r) => r.trim().split(/\s+/)).filter((v) => v !== '.').map(Number).filter((v) => v >= 30)) h[v] = (h[v] ?? 0) + 1;
  FT[id] = +(Object.entries(h).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 100) / 100;
}
FT.forest_island = 0.95; FT.branch_platform = 0.6; FT.shelf_fungus = 0.93; FT.root_bridge = 0.92; FT.crown_platform = 0.46;
FT.spore_flower = 0.45; FT.mushroom_tower = 0.98; FT.tree_trunk = 1.0; FT.tree_trunk_hollow = 1.0; FT.giant_leaf = 0.62;
FT.mushroom_bounce = 0.98; FT.mushroom_tilted = 0.9; FT.mushroom_power = 0.97; FT.glow_cave = 0.9;
const ext = (rec, ux, uz) => rec.r ?? Math.abs(ux) * rec.hx + Math.abs(uz) * rec.hz;

/** a prefab whose flat top is at `top`, w wide (model x), standing on its own base or floating */
function piece(id, x, z, top, w, o = {}) {
  const s = w / SZ[id][0];
  const base = top - FT[id] * s;
  const ob = B.prefab(id, r2(x), r2(base), r2(z), o.r ?? 0, r2(s), { name: o.name ?? id, col: o.col });
  if (o.noStand) ob.noStand = true;
  const [hx, hz] = (Math.abs(Math.round((o.r ?? 0) / 90)) % 2 === 1) ? [SZ[id][2] * s / 2, w / 2] : [w / 2, SZ[id][2] * s / 2];
  return { id, x, z, top: r2(top), base: r2(base), s, hx, hz };
}
/** a floating moss islet (forest island model), w wide */
const islet = (x, z, top, o = {}) => piece('forest_island', x, z, top, o.w ?? 3.4, { name: 'moss islet', ...o });
/** a shelf fungus on the trunk at angle phi (deg, 0 = +z, 90 = +x), its flat back against the bark; top at `top` */
function shelf(phi, top, o = {}) {
  const w = o.w ?? 3.0, s = w / SZ.shelf_fungus[0], d = SZ.shelf_fungus[2] * s, R = TRUNK_R + d / 2 - 0.25;
  const q = (phi * Math.PI) / 180, x = C6.x + Math.sin(q) * R, z = C6.z + Math.cos(q) * R;
  B.prefab('shelf_fungus', r2(x), r2(top - FT.shelf_fungus * s), r2(z), r2(phi), r2(s), { name: o.name ?? 'shelf fungus' });
  return { id: 'shelf_fungus', x: r2(x), z: r2(z), top: r2(top), r: r2(Math.min(w, d) / 2 + 0.2) };
}
/** a branch growing out of the trunk towards angle phi (deg), its base in the bark, L long, top at `top` */
function branch(phi, top, L = 6, o = {}) {
  const s = L / SZ.branch_platform[0], q = (phi * Math.PI) / 180, R = TRUNK_R - 0.6 + L / 2;
  const x = C6.x + Math.sin(q) * R, z = C6.z + Math.cos(q) * R;
  B.prefab('branch_platform', r2(x), r2(top - FT.branch_platform * s), r2(z), r2(phi - 90), r2(s), { name: o.name ?? 'branch' });
  const tip = [r2(C6.x + Math.sin(q) * (TRUNK_R - 0.6 + L - 0.8)), r2(top), r2(C6.z + Math.cos(q) * (TRUNK_R - 0.6 + L - 0.8))];
  const mid = [r2(x), r2(top), r2(z)];
  const ax = Math.abs(Math.sin(q)) > 0.7;
  return { id: 'branch', x: r2(x), z: r2(z), top: r2(top), hx: ax ? L / 2 : 0.9, hz: ax ? 0.9 : L / 2, tip, mid };
}
/** a straight walkway of model `id` (long axis = model x) from a to b, top at a[1], about w wide; whole pieces */
function walkway(id, a, b, w, o = {}) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
  const len1 = SZ[id][0] * (w / SZ[id][2]);
  const n = Math.max(1, Math.round(L / len1));
  const s = L / (n * SZ[id][0]);
  const yaw = r2((Math.atan2(dx, dz) * 180) / Math.PI - 90);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    B.prefab(id, r2(a[0] + dx * t), r2(a[1] - FT[id] * s), r2(a[2] + dz * t), yaw, r2(s), { name: o.name ?? id });
  }
  return { len: L, n, s: r2(s), w: r2(SZ[id][2] * s) };
}
/** decoration (no collider) */
const deco = (id, x, z, base, s, r = 0) => B.prefab(id, r2(x), r2(base), r2(z), r, r2(s), { name: id, col: false });
/** the floor of a zone: two 16 x 16 moss islands covering the half (south: false = only the north one) */
function deck(name, H, y, o = {}) {
  const s = 16 / SZ.forest_island[0];
  for (const zc of o.zc ?? (o.south === false ? [-17.4] : [-17.0, -1.0])) B.prefab('forest_island', H.xc, r2(y - FT.forest_island * s), zc, 0, r2(s), { name });
  return { top: y };
}
/** the ancient tree's trunk on the line between the halves: segments of `tree_trunk`, 7 m across, from y0 to y1 */
const TRUNK_R = 3.5;
function trunk(y0, y1) {
  const s = (2 * TRUNK_R) / SZ.tree_trunk[0], h = s * 1.0;
  let y = y0, i = 0;
  while (y < y1 - 0.01) { const b = Math.min(y, y1 - h); B.prefab('tree_trunk', C6.x, r2(b), C6.z, (i * 137) % 360, r2(s), { name: 'ancient tree trunk' }).noStand = true; y = b + h; i++; }
}

// ---------------------------------------------------------------- devices (data-driven mechanics) with toy looks
const devices = [];
const PURPLE = '#b9a2f0', BTN = '#e3262e';
/** a solid box the validator can stand on (device platforms are not prefabs) */
function surf(name, p, s, r = 0) { B.objects.push({ type: 'kit', k: 'slab', boxes: [{ c: [p[0], p[1] - s[1] / 2, p[2]], h: [s[0] / 2, s[1] / 2, s[2] / 2], top: true, narrow: s[0] < 0.9 || s[2] < 0.9 }], r, name }); }
/** a model as the look of a device box whose top is at the device's p */
const look = (id, s, o = {}) => ({ file: `${A}/${id}`, s: r2(s), off: [r2(o.ox ?? 0), r2(-(o.ft ?? FT[id])), r2(o.oz ?? 0)], ...(o.yaw ? { yaw: o.yaw } : {}) });
function boxDev(t, id, modelId, x, z, top, w, extra = {}, o = {}) {
  const s = w / SZ[modelId][0];
  const h = o.h ?? r2(Math.max(0.3, FT[modelId] * s * (o.hk ?? 1)));
  const box = [r2(w * (o.k ?? 1)), h, r2(SZ[modelId][2] * s * (o.k ?? 1))];
  const d = { t, id, p: [r2(x), r2(top), r2(z)], r: o.r ?? 0, s: box, ...extra, model: look(modelId, s, o) };
  devices.push(d);
  if (o.surf !== false) surf(o.name ?? t, d.p, box, o.r ?? 0);
  const odd = Math.abs(Math.round((o.r ?? 0) / 90)) % 2 === 1;
  return { id, x, z, top: r2(top), hx: (odd ? box[2] : box[0]) / 2, hz: (odd ? box[0] : box[2]) / 2, s, dev: d };
}
/** a built-in coloured box device (no model) */
function colDev(t, id, x, z, top, w, d, extra = {}, o = {}) {
  const dv = { t, id, p: [r2(x), r2(top), r2(z)], r: o.r ?? 0, s: [r2(w), o.h ?? 0.5, r2(d)], color: o.color ?? PURPLE, ...extra };
  devices.push(dv);
  if (o.surf !== false) surf(o.name ?? t, dv.p, dv.s, o.r ?? 0);
  const odd = Math.abs(Math.round((o.r ?? 0) / 90)) % 2 === 1;
  return { id, x, z, top: r2(top), hx: (odd ? d : w) / 2, hz: (odd ? w : d) / 2, dev: dv };
}
const crumble = (id, x, z, top, o = {}) => boxDev('crumble', id, 'shelf_fungus', x, z, top, o.w ?? 2.6, { delay: o.delay ?? 0.7, respawn: 3 }, { name: 'crumbling fungus', ...o });
const blink = (id, x, z, top, on, off, phase, o = {}) => colDev('blink', id, x, z, top, o.w ?? 2.2, o.d ?? 2.2, { on, off, phase }, { color: o.color ?? '#7dd6ff', ...o });
/** a spinning top (turntable, built-in look in toy colours) */
function spinTop(id, x, z, top, R, speed, o = {}) {
  const d = { t: 'turntable', id, p: [r2(x), r2(top), r2(z)], s: [r2(2 * R), 0.5, r2(2 * R)], radius: r2(R), speed, color: o.color ?? PURPLE, ...(o.phase ? { phase: o.phase } : {}) };
  devices.push(d);
  surf('spinning top', d.p, [r2(R * 1.4), 0.5, r2(R * 1.4)]);
  return { id, x, z, top: r2(top), r: r2(R) };
}
/** the seesaw: a purple plank (its long side along the plank's z = yaw r) tipping towards whoever stands on it */
function seesaw(id, x, z, top, L, o = {}) {
  const s = L / SZ.seesaw[0];
  const w = r2(0.9 * s);
  const d = { t: 'tilt', id, p: [r2(x), r2(top), r2(z)], r: o.r ?? 0, s: [w, 0.4, r2(L * 0.94)], maxAngle: o.maxAngle ?? 9, model: look('seesaw', s, { yaw: 90, ft: 0.68 }) };
  devices.push(d);
  surf('seesaw', d.p, d.s, o.r ?? 0);
  const odd = Math.abs(Math.round((o.r ?? 0) / 90)) % 2 === 1;
  return { id, x, z, top: r2(top), hx: odd ? L / 2 : w / 2, hz: odd ? w / 2 : L / 2 };
}
/** trampoline: a toy drum (built-in look) */
function drum(id, x, z, top, w, o = {}) { return colDev('trampoline', id, x, z, top, w, w, { bounce: o.bounce ?? 0.9, min: o.min ?? 11, max: o.max ?? 24 }, { color: o.color ?? '#ff5f7a', h: 0.6, ...o }); }
/** updraft: a fan on a surface at y, blowing up a column w wide and h high */
function fan(id, x, y, z, w, h, o = {}) {
  devices.push({ t: 'fan', id, p: [r2(x), r2(y), r2(z)], s: [r2(w), r2(h), r2(w)], force: o.force ?? 50, color: o.color ?? '#7dd6ff', ...(o.on ? { on: o.on, off: o.off, phase: o.phase ?? 0 } : {}) });
  return { id, x, z, top: y };
}
/** conveyor: a belt on the race track carrying along local +z (yaw r) */
function belt(id, x, z, top, w, len, r, speed, o = {}) {
  const d = { t: 'conveyor', id, p: [r2(x), r2(top), r2(z)], r, s: [r2(w), 0.3, r2(len)], speed, color: '#ff8a1f' };
  devices.push(d);
  if (o.surf !== false) surf('race belt', d.p, d.s, r);
  const q = (r * Math.PI) / 180;
  return { id, x, z, top: r2(top), hx: Math.abs(Math.cos(q)) * w / 2 + Math.abs(Math.sin(q)) * len / 2, hz: Math.abs(Math.sin(q)) * w / 2 + Math.abs(Math.cos(q)) * len / 2 };
}
function zipline(id, a, b, speed = 11) { devices.push({ t: 'zipline', id, p: a.map(r2), b: b.map(r2), speed, color: '#ffc928' }); return { a, b }; }
/** a big red toy button (pressure plate) at p driving device `target` (held `hold` s after you step off) */
function button(id, p, target, hold = 3.5) {
  devices.push({ t: 'plate', id, p: p.map(r2), s: [1.6, 0.15, 1.6], target, hold, color: BTN });
  return { id, x: p[0], z: p[2], top: p[1], r: 0.8 };
}
function cannon(id, p, yaw, pitch, v) { devices.push({ t: 'cannon', id, p: p.map(r2), r: yaw, pitch, v, color: '#ffc928' }); return { id, x: p[0], z: p[2], top: p[1], r: 0.9 }; }
function portal(id, p, r, b, rb, need = 0) { devices.push({ t: 'portal', id, p: p.map(r2), r, b: b.map(r2), rb, color: PURPLE, ...(need ? { need } : {}) }); }
/** a robot arm sweeping round (sweeper): the arm model is the bar */
function sweepArm(id, x, y, z, L, speed, o = {}) {
  devices.push({ t: 'sweeper', id, p: [r2(x), r2(y), r2(z)], radius: L, speed, arms: 1, color: PURPLE, ...(o.phase ? { phase: o.phase } : {}) });
}
function lowgrav(id, x, y, z, w, h, d, g = 0.45) { devices.push({ t: 'lowgrav', id, p: [r2(x), r2(y), r2(z)], s: [r2(w), r2(h), r2(d)], g }); }
const checkpoint = (id, p, r = 0) => devices.push({ t: 'checkpoint', id, p: p.map(r2), r, color: '#ffc928' });
const gem = (id, p) => devices.push({ t: 'collectible', id, p: p.map(r2), color: '#ff7ad9' });


/** a giant leaf, L long: 'fixed' (green, a solid prefab), 'spring' (yellow-green, tips towards you, springs back),
 *  'fold' (orange, its tip bends down once you have stood on it a moment), 'sway' (mint, rocks in the wind by itself).
 *  r = 0: the leaf lies along z (stem at -z, tip at +z); r = 90: along x (stem at +x... i.e. turned) */
function leaf(kind, id, x, z, top, L = 6, o = {}) {
  const s = L / SZ.giant_leaf[0], w = SZ.giant_leaf[2] * s, r = o.r ?? 0;
  const odd = Math.abs(Math.round(r / 90)) % 2 === 1;
  if (kind === 'fixed') {
    B.prefab('giant_leaf', r2(x), r2(top - FT.giant_leaf * s), r2(z), r2(r + 90), r2(s), { name: 'giant leaf' });
    return { id, x, z, top: r2(top), hx: odd ? L / 2 : w / 2, hz: odd ? w / 2 : L / 2 };
  }
  const box = [r2(w * 0.85), 0.3, r2(L * 0.94)];
  const extra = kind === 'spring' ? { maxAngle: o.max ?? 12 } : kind === 'fold' ? { maxAngle: o.max ?? 28, fold: o.fold ?? 0.9 } : { maxAngle: o.max ?? 9, sway: o.period ?? 4, phase: o.phase ?? 0 };
  const d = { t: 'tilt', id, p: [r2(x), r2(top), r2(z)], r, s: box, ...extra, model: look(`leaf_${kind}`, s, { ft: FT.giant_leaf, yaw: 90 }) };
  devices.push(d);
  surf(`${kind} leaf`, d.p, box, r);
  return { id, x, z, top: r2(top), hx: odd ? L / 2 : w / 2, hz: odd ? w / 2 : L / 2 };
}


/** a log hung on two vines, swinging along its own length (ride it from one end of its swing to the other):
 *  centre at rest c (top of the log), L long, along z (axis 'z') or x, swinging amp degrees, period s */
function swingLog(id, c, L, axis, amp, period, o = {}) {
  const s = L / SZ.hanging_log[0], len = r2(0.78 * s), th = (amp * Math.PI) / 180;
  const r = axis === 'z' ? 0 : 90; // swing direction = the log's length
  const pivot = [c[0], r2(c[1] + len), c[2]];
  const dir = axis === 'z' ? [0, 1] : [1, 0];
  const at = (sg) => [r2(c[0] + dir[0] * Math.sin(th * sg) * len), r2(pivot[1] - Math.cos(th) * len), r2(c[2] + dir[1] * Math.sin(th * sg) * len)];
  const A = at(-1), Bp = at(1), t = 0.3 / s;
  // model x = the log; local frame: x across the swing for r = 0, so turn the model along the swing
  movers.push({ id, kind: 'swing', pts: [A, Bp], pivot, len, amp, period, r, s: r2(s), speed: 0, wait: 0, phase: o.phase ?? 0, rope: false,
    model: { file: `${A6}/hanging_log`, s: r2(s), off: [0, -0.2, 0], yaw: 90, boxes: [[0, r2(-t / 2), 0, 0.07, r2(t / 2), 0.4]] } });
  B.node(A); B.node(Bp);
  const half = L / 2, w = 0.6;
  const fp = (p) => (axis === 'z' ? { x0: p[0] - w, x1: p[0] + w, z0: p[2] - half, z1: p[2] + half } : { x0: p[0] - half, x1: p[0] + half, z0: p[2] - w, z1: p[2] + w });
  sweeps.push({ id, kind: 'swing', y0: r2(c[1] - 0.25), y1: r2(c[1] + 0.8), boxes: [fp(A), fp(Bp), fp(c)] });
  return { A, B: Bp, c };
}
/** a climbable vine hanging on a face: foot p (standable), facing yaw r (the side you climb from), up to top */
function vine(p, top, r) {
  const h = r2(top - p[1]);
  ladders.push({ p: p.map(r2), h, r, nv: true });
  const q = (r * Math.PI) / 180;
  B.prefab('vine_climb', r2(p[0] + Math.sin(q) * 0.12), r2(p[1] - 0.3), r2(p[2] + Math.cos(q) * 0.12), r, r2(h + 0.6), { name: 'climbing vine', col: false });
}


/** a spore stream: a glowing flower lying open at y (you can stand on it) blowing a column h high that lifts you */
function spore(id, x, y, z, h, o = {}) {
  const w = o.w ?? 2.2, s = (w * 1.15) / SZ.spore_flower[0];
  B.prefab('spore_flower', r2(x), r2(y - FT.spore_flower * s), r2(z), o.r ?? 0, r2(s), { name: 'spore flower' });
  fan(id, x, y, z, w, h, { force: o.force ?? 50, color: '#8ff0ff', ...(o.on ? { on: o.on, off: o.off, phase: o.phase ?? 0 } : {}) });
  return { id, x, z, top: r2(y), r: r2(w * 0.55) };
}
/** a crumbling shelf fungus on the trunk at angle phi (it sags and drops a moment after you land, grows back) */
function crumbleShelf(id, phi, top, o = {}) {
  const w = o.w ?? 2.8, s = w / SZ.shelf_fungus[0], d = SZ.shelf_fungus[2] * s, R = TRUNK_R + d / 2 - 0.2;
  const q = (phi * Math.PI) / 180, x = C6.x + Math.sin(q) * R, z = C6.z + Math.cos(q) * R;
  const box = [r2(w * 0.8), 0.45, r2(d * 0.8)];
  devices.push({ t: 'crumble', id, p: [r2(x), r2(top), r2(z)], r: r2(phi), s: box, delay: o.delay ?? 0.8, respawn: 3, model: look('shelf_fungus', s, { ft: FT.shelf_fungus }) });
  surf('crumbling fungus', [x, top, z], box, phi);
  return { id, x: r2(x), z: r2(z), top: r2(top), r: r2(Math.min(w, d) / 2 + 0.1) };
}

// ---------------------------------------------------------------- movers (moving platforms) wearing the toys
const movers = [];
const ladders = [];
const sweeps = [];
/** a curved rail piece (90 degrees): arc centre (cx, cz), centre-line radius R, rail top y; the arc runs from angle
 *  a = -90 (west of the centre) to a = 0 (south of it, +z) – turn it with `rot` (degrees) */
/** a bouncy mushroom (trampoline wearing the model; only the cap is solid): kind 'bounce' (red, straight up),
 *  'tilted' (orange, also throws you `push` m/s towards yaw r: its cap leans that way), 'power' (violet, small, high);
 *  cap = cap width (m), top = the cap top; a moss clump under its stem */
function mush(kind, id, x, z, top, cap, o = {}) {
  const m = `mushroom_${kind}`, s = cap / SZ[m][0];
  const box = [r2(cap * 0.78), r2(0.3 * s), r2(cap * 0.78)];
  const yaw = kind === 'tilted' ? -90 : 0; // the model leans down towards +x: turned so it leans along the device's +z
  const d = { t: 'trampoline', id, p: [r2(x), r2(top), r2(z)], r: o.r ?? 0, s: box, bounce: 0.9, min: o.min ?? (kind === 'power' ? 20 : 15), max: o.max ?? 26,
    ...(kind === 'tilted' ? { push: o.push ?? 8 } : {}), model: look(m, s, { ft: FT[m], yaw }) };
  devices.push(d);
  surf(`${kind} mushroom`, d.p, box, o.r ?? 0);
  const base = top - FT[m] * s;
  if (o.clump !== false) B.prefab('forest_island', r2(x), r2(base - 0.95 * s * 0.4), r2(z), 0, r2(s * 0.4), { name: 'moss clump', col: false });
  return { id, x, z, top: r2(top), r: r2(cap * 0.39), base: r2(base), s };
}
/** the spinning top (turntable wearing the toy's model; its handle sticks up in the middle) */
/** cannon speed for a given pitch that lands on b from a (gravity 30 up / 42 down) */
function aim(a, b, pitch) {
  const D = Math.hypot(b[0] - a[0], b[2] - a[2]), dh = b[1] - a[1], q = (pitch * Math.PI) / 180;
  let lo = 5, hi = 60;
  for (let k = 0; k < 60; k++) {
    const v = (lo + hi) / 2, vy = v * Math.sin(q), vh = v * Math.cos(q), H = (vy * vy) / 60;
    const d = H < dh ? 0 : vh * (vy / 30 + Math.sqrt((2 * (H - dh)) / 42));
    if (d < D) lo = v; else hi = v;
  }
  return { yaw: r2((Math.atan2(b[0] - a[0], b[2] - a[2]) * 180) / Math.PI), v: r2((lo + hi) / 2) };
}

// ---------------------------------------------------------------- routes, hops
const mark = (p, label, act) => B.mark('main', p.map(r2), label, act);
const P = (rec, dx = 0, dz = 0) => [r2(rec.x + dx), rec.top, r2(rec.z + dz)];
const hops = [];
function hop(a, b, label) {
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
  const g = d - ext(a, dx / d, dz / d) - ext(b, dx / d, dz / d), dh = b.top - a.top;
  hops.push(`${label.padEnd(30)} gap ${g.toFixed(2).padStart(6)}  dh ${dh.toFixed(2).padStart(6)}`);
}
const at = (p, r = 0.5) => ({ x: p[0], z: p[2], top: p[1], r });
/** a chain of pieces on the main route: specs [kind, x, z, top, opts]; prints the hops, marks every piece */
function chain(prev, specs, labelBase) {
  const out = [];
  for (const [i, sp] of specs.entries()) {
    const rec = make(sp);
    hop(prev, rec, `${labelBase} ${i + 1}`);
    mark(P(rec, ...(sp[5] ?? [0, 0])), sp[4]?.label ?? `${labelBase} ${i + 1}`, sp[4]?.act);
    prev = rec; out.push(rec);
  }
  return out;
}
function make([kind, x, z, top, o = {}]) {
  if (kind === 'islet') return islet(x, z, top, o);
  if (kind === 'shelf') return shelf(x, top, o); // x = phi
  return piece(kind, x, z, top, o.w ?? 3, o);
}
/** an alternative route (own route list for the bot): start, pieces, end */
function alt(route, start, specs, end) {
  B.mark(route, start.p, start.label ?? 'start', start.act);
  let prev = start.rec ?? at(start.p);
  const out = [];
  for (const [i, sp] of specs.entries()) {
    if (!Array.isArray(sp)) { hop(prev, sp.rec ?? at(sp.p), `${route} ${i + 1}`); B.mark(route, sp.p ?? P(sp.rec), sp.label ?? `${route} ${i + 1}`, sp.act); prev = sp.rec ?? at(sp.p); continue; }
    const rec = make(sp);
    hop(prev, rec, `${route} ${i + 1}`);
    B.mark(route, P(rec, ...(sp[5] ?? [0, 0])), sp[4]?.label ?? `${route} ${i + 1}`, sp[4]?.act);
    prev = rec; out.push(rec);
  }
  if (end) { hop(prev, end.rec ?? at(end.p), `${route} > end`); B.mark(route, end.p, end.label ?? 'end', end.act); }
  return out;
}
/** invisible wall between the halves for one zone band, with openings [z0, z1, y0, y1] */
function divider(y0, y1, holes = []) {
  const cuts = [...new Set([Z0, Z1, ...holes.flatMap(([a, b]) => [a, b])])].sort((p, q) => p - q);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const za = cuts[i], zb = cuts[i + 1];
    if (zb - za < 0.05) continue;
    const zc = (za + zb) / 2;
    let segs = [[y0, y1]];
    for (const [hz0, hz1, hy0, hy1] of holes) if (zc > hz0 && zc < hz1) segs = segs.flatMap(([a, b]) => [[a, Math.min(b, hy0)], [Math.max(a, hy1), b]]).filter(([a, b]) => b - a > 0.2);
    for (const [a, b] of segs) B.kitPiece('wall', [-60, r2((a + b) / 2), r2(zc)], [0.15, r2((b - a) / 2), r2((zb - za) / 2)]);
  }
}
let EXIT;
const SIGN = (p, r, en, vi) => B.kitPiece('sign', p, [4.6, 1.2], r, { m: `${en}|${vi}` });

// =====================================================================================
// ENTRY (935): Toy Universe's summit gate (-52, 935, -10.4) opens north onto the first moss island of the forest; the
// ancient tree rises beside it (x = -60). A root arch is the way into the forest.
// =====================================================================================
const HOLS = (2 * TRUNK_R) / SZ.tree_trunk_hollow[0], HOL0 = r2(Y5 - 0.144 * HOLS), HOL1 = r2(HOL0 + HOLS);
trunk(Y1 - 2, HOL0);
trunk(HOL1, TOP - 1.2);
// the hollow: a room in the trunk (floor at Y5, 5.5 m across, 6.7 m high), its doorway facing east
B.prefab('tree_trunk_hollow', C6.x, HOL0, C6.z, 90, r2(HOLS), { name: 'hollow of the ancient tree' });
const SPAWN = [-52.0, Y1, -12.6];
deck('forest gate island', HALF.E, Y1, { south: false });
B.prefab('root_arch_gate', -52.0, Y1, -16.4, 0, r2(7.0 / SZ.root_arch_gate[0] * 0.975 / 0.975), { name: 'root arch gate' }).noStand = true;
SIGN([-46.0, r2(Y1 + 3.6), -13.0], -90, 'MUSHROOM FOREST', 'Rừng nấm khổng lồ · 935 → 1150 m');
mark(SPAWN, 'Forest Gate');

// =====================================================================================
// ZONE 1 – FOREST ENTRANCE (935–960, east): a red cap on the island bounces you up to moss islets, a second red cap to
// a branch of the tree, an orange cap at its tip leans south and throws you over the gap, a violet cap throws you
// high onto a branch on the trunk's east side, shelf fungi round the trunk to a root bridge west at 960.
//   easy: islets instead of the orange cap · hard: tiny moss stones instead of the second red cap
//   secret: a glowing cave on the island behind the arch (gem)
// =====================================================================================
const G1 = (x, z, top, s = 1.2, r = 0) => deco('glow_mushrooms', x, z, top, s, r);
const M1 = mush('bounce', 'm1', -50.4, -20.6, r2(Y1 + 2.0), 2.4);
G1(-48.6, -19.0, Y1, 1.3, 40);
hop(at(SPAWN, 0.4), M1, 'gate > red cap 1');
const I1 = islet(-46.6, -22.2, r2(Y1 + 4.6), { w: 3.6 });
B.link(P(M1), P(I1), 'bounce'); mark(P(I1), 'moss islet 1', 'via:m1');
const I2 = islet(-46.0, -17.6, r2(Y1 + 6.0), { w: 3.2 });
hop(I1, I2, 'islet 1 > 2'); mark(P(I2), 'moss islet 2');
const M2 = mush('bounce', 'm2', -47.4, -13.4, r2(Y1 + 7.4), 2.4, { min: 16 });
hop(I2, M2, 'islet 2 > red cap 2');
const B1 = branch(95, r2(Y1 + 10.4), 6.4);
B.link(P(M2), B1.tip, 'bounce'); mark(B1.tip, 'branch (tip)', 'via:m2');
const T1 = mush('tilted', 't1', -49.6, -6.8, r2(Y1 + 10.0), 2.6, { r: 0, push: 8 });
hop({ ...at(B1.tip, 0.9) }, T1, 'branch > orange cap');
G1(-49.6, -3.6, r2(Y1 + 7.6), 0.9);
const I3 = islet(-49.0, -0.8, r2(Y1 + 12.6), { w: 3.8 });
B.link(P(T1), P(I3), 'bounce'); mark(P(I3), 'moss islet 3 (thrown south)', 'via:t1');
const I4 = islet(-52.8, 1.8, r2(Y1 + 14.0), { w: 3.2 });
hop(I3, I4, 'islet 3 > 4'); mark(P(I4), 'moss islet 4');
const P1 = mush('power', 'p1', -55.6, -1.4, r2(Y1 + 15.0), 2.2);
hop(I4, P1, 'islet 4 > violet cap');
const B2 = branch(52, r2(Y1 + 20.6), 6.0);
B.link(P(P1), B2.tip, 'bounce'); mark(B2.tip, 'high branch (tip)', 'via:p1');
mark(B2.mid, 'high branch');
const SF = [shelf(92, r2(Y1 + 22.0)), shelf(122, r2(Y1 + 23.4)), shelf(152, r2(Y1 + 24.2))];
hop(at(B2.mid, 0.9), SF[0], 'branch > fungus 1'); hop(SF[0], SF[1], 'fungus 1 > 2'); hop(SF[1], SF[2], 'fungus 2 > 3');
SF.forEach((f, i) => mark(P(f), `shelf fungus ${i + 1}`));
const RB1 = piece('root_bridge', -60.0, -15.8, Y2, 10.6, { name: 'root bridge' });
hop(SF[2], at([-56.8, Y2, -15.8], 0.9), 'fungus 3 > root bridge');
mark([-56.6, Y2, -15.8], 'root bridge (east end)');
// easy: moss islets instead of the orange cap
alt('z1easy', { p: B1.tip, label: 'branch (tip)' }, [
  ['islet', -47.4, -8.6, r2(Y1 + 10.6), { w: 2.8 }],
  ['islet', -46.4, -4.6, r2(Y1 + 11.4), { w: 2.8 }],
], { p: P(I3), rec: I3, label: 'moss islet 3 (joins)' });
// hard: tiny moss stones instead of the second red cap
alt('z1hard', { p: P(I2), rec: I2, label: 'moss islet 2' }, [
  ['islet', -48.8, -16.0, r2(Y1 + 7.6), { w: 1.4 }],
  ['islet', -51.6, -13.4, r2(Y1 + 9.2), { w: 1.4 }],
], { p: B1.mid, label: 'branch (joins)' });
// secret: a glowing cave on the island behind the arch, a gem inside
const CAVE1 = piece('glow_cave', -55.0, -21.6, r2(Y1 + FT.glow_cave * 3.6), 3.6 * SZ.glow_cave[0], { name: 'glowing cave' });
gem('gem1', [-55.0, Y1, -21.6]);
B.mark('z1secret', [-52.0, Y1, -18.6], 'behind the arch');
B.mark('z1secret', [-55.0, Y1, -21.6], 'glowing cave (gem)');
B.mark('z1secret', [-55.0, Y1, -16.8], 'out of the cave');
void CAVE1; void RB1;
divider(Y1, Y2 - 0.6, []);
EXIT = [-56.6, Y2, -15.8];
console.log('zone 1 placed');


if (upTo(2)) {
  // =====================================================================================
  // ZONE 2 – MUSHROOM VALLEY (960–990, west): read the caps. Two orange caps by the root bridge lean different ways:
  // the west one throws you on up the valley (the north one throws you to a hidden islet). Red caps up to the giant
  // tower mushroom; on its cap an orange cap leans north and throws you onto a branch of the tree; shelf fungi round
  // the trunk; a violet cap throws you up to the root bridge east at 990.
  //   easy: moss islets instead of the first orange cap · hard: tiny moss stones instead of the red cap after it
  //   secret: the north-leaning orange cap throws you to a hidden islet beyond the island's edge (gem)
  // =====================================================================================
  deck('deck 2', HALF.W, Y2);
  mark([-66.2, Y2, -15.8], 'deck 2');
  checkpoint('cp2', [-66.4, Y2, -12.8], -90);
  const T2a = mush('tilted', 't2a', -69.0, -19.4, r2(Y2 + 2.0), 2.4, { r: -90, push: 8 });
  const T2b = mush('tilted', 't2b', -64.6, -21.2, r2(Y2 + 2.0), 2.4, { r: 180, push: 8 });
  G1(-67.0, -23.0, Y2, 1.1, 120);
  const I21 = islet(-74.0, -19.8, r2(Y2 + 4.2), { w: 3.4 });
  hop(at([-66.2, Y2, -15.8], 0.4), T2a, 'deck > west orange cap');
  B.link(P(T2a), P(I21), 'bounce'); mark(P(I21), 'moss islet (thrown west)', 'via:t2a');
  const M21 = mush('bounce', 'm21', -73.6, -15.4, r2(Y2 + 5.6), 2.4, { min: 16 });
  hop(I21, M21, 'islet > red cap');
  const I22 = islet(-70.6, -10.8, r2(Y2 + 8.8), { w: 3.4 });
  B.link(P(M21), P(I22), 'bounce'); mark(P(I22), 'moss islet', 'via:m21');
  const M22 = mush('bounce', 'm22', -70.4, -6.8, r2(Y2 + 10.2), 2.4, { min: 16 });
  hop(I22, M22, 'islet > red cap 2');
  const TS = 13, TOW = { x: -69.4, z: 0.4, top: r2(Y2 + FT.mushroom_tower * TS) };
  B.prefab('mushroom_tower', TOW.x, Y2, TOW.z, 20, TS, { name: 'giant tower mushroom' });
  B.link(P(M22), [-69.6, TOW.top, -3.0], 'bounce'); mark([-69.6, TOW.top, -3.0], 'giant mushroom cap', 'via:m22');
  const T22 = mush('tilted', 't22', -67.6, -0.6, r2(TOW.top + 2.0), 2.4, { r: 180, push: 8, clump: false });
  hop(at([-69.6, TOW.top, -3.0], 1.0), T22, 'cap > orange cap (north)');
  const B21 = branch(290, r2(TOW.top + 4.5), 6.2);
  B.link(P(T22), B21.tip, 'bounce'); mark(B21.tip, 'branch (tip)', 'via:t22');
  mark(B21.mid, 'branch');
  const SF2 = [shelf(255, r2(B21.top + 1.4)), shelf(230, r2(B21.top + 2.8)), shelf(205, r2(B21.top + 4.2))];
  hop(at(B21.mid, 0.9), SF2[0], 'branch > fungus 1'); hop(SF2[0], SF2[1], 'fungus 1 > 2'); hop(SF2[1], SF2[2], 'fungus 2 > 3');
  SF2.forEach((f, i) => mark(P(f), `shelf fungus ${i + 1}`));
  const I23 = islet(-64.6, -15.6, r2(SF2[2].top + 1.4), { w: 3.0 });
  hop(SF2[2], I23, 'fungus 3 > islet'); mark(P(I23), 'moss islet by the trunk');
  const P21 = mush('power', 'p21', -67.6, -17.0, r2(I23.top - 0.6), 2.6, { min: 21 });
  hop(I23, P21, 'islet > violet cap');
  const I24 = islet(-71.4, -20.6, r2(Y3 - 1.4), { w: 3.2 });
  B.link(P(P21), P(I24), 'bounce'); mark(P(I24), 'high islet', 'via:p21');
  piece('root_bridge', -62.4, -21.6, Y3, 13.0, { name: 'root bridge' });
  hop(I24, at([-67.4, Y3, -21.6], 0.9), 'islet > root bridge');
  mark([-65.6, Y3, -21.6], 'root bridge');
  // easy: moss islets instead of the first orange cap
  alt('z2easy', { p: [-66.2, Y2, -15.8], label: 'deck 2' }, [
    ['islet', -70.8, -15.6, r2(Y2 + 1.4), { w: 2.8 }],
    ['islet', -74.2, -15.2, r2(Y2 + 2.8), { w: 2.8 }],
  ], { p: P(I21), rec: I21, label: 'moss islet (joins)' });
  // hard: tiny moss stones instead of the red cap
  alt('z2hard', { p: P(I21), rec: I21, label: 'moss islet' }, [
    ['islet', -75.0, -16.2, r2(Y2 + 5.8), { w: 1.4 }],
    ['islet', -73.4, -13.0, r2(Y2 + 7.4), { w: 1.4 }],
  ], { p: P(I22), rec: I22, label: 'moss islet (joins)' });
  // secret: the north-leaning orange cap throws you to a hidden islet beyond the island's edge
  const SEC2 = islet(-64.6, -27.8, r2(Y2 + 3.0), { w: 2.8, name: 'hidden islet' });
  gem('gem2', P(SEC2));
  B.link(P(T2b), P(SEC2), 'bounce');
  B.mark('z2secret', [-66.2, Y2, -18.0], 'by the orange caps');
  B.mark('z2secret', P(SEC2), 'hidden islet (gem)', 'via:t2b');
  B.mark('z2secret', [-65.0, Y2, -23.6], 'back on the island');
  divider(Y2, Y3 - 0.6, [[-17.0, -14.6, Y2 - 1, Y2 + 3.5]]);
  EXIT = [-56.4, Y3, -21.6];
  console.log('zone 2 placed');
}
if (upTo(3)) {
  // =====================================================================================
  // ZONE 3 – GIANT LEAF GARDEN (990–1020, east): leaves you learn by colour. A red cap to a green (solid) leaf,
  // two yellow-green springy leaves that tip towards you, two mint leaves rocking in the wind, a green leaf, a violet
  // cap high onto a green leaf, a branch, shelf fungi round the trunk, a red cap to the root bridge west at 1020.
  //   easy: moss islets up the east side instead of the springy and rocking leaves
  //   secret: an orange leaf by the rocking ones folds down when you stand on it - from its tip a hidden islet (gem)
  // =====================================================================================
  deck('deck 3', HALF.E, Y3);
  mark([-55.8, Y3, -21.6], 'deck 3');
  checkpoint('cp3', [-55.2, Y3, -18.4], 90);
  const M31 = mush('bounce', 'm31', -52.6, -19.6, r2(Y3 + 2.0), 2.4);
  hop(at([-55.8, Y3, -21.6], 0.4), M31, 'deck > red cap');
  const F1 = leaf('fixed', 'f1', -47.0, -22.4, r2(Y3 + 4.6), 6, { r: 90 });
  B.link(P(M31), P(F1), 'bounce'); mark(P(F1), 'green leaf', 'via:m31');
  const E1 = leaf('spring', 'e31', -48.6, -16.6, r2(Y3 + 6.0), 6);
  const E2 = leaf('spring', 'e32', -51.0, -9.6, r2(Y3 + 7.4), 6);
  hop(F1, E1, 'green leaf > springy 1'); mark([-48.6, E1.top, -18.6], 'springy leaf 1'); mark([-48.6, E1.top, -14.4], 'springy leaf 1 (south end)');
  hop(E1, E2, 'springy 1 > 2'); mark([-51.0, E2.top, -11.6], 'springy leaf 2'); mark([-51.0, E2.top, -7.4], 'springy leaf 2 (south end)');
  const S1 = leaf('sway', 's31', -49.8, -4.0, r2(Y3 + 8.8), 6, { r: 90, period: 4.0 });
  const S2 = leaf('sway', 's32', -54.4, 1.0, r2(Y3 + 10.2), 6, { period: 3.4, phase: 1.2 });
  hop(E2, S1, 'springy 2 > rocking 1'); mark([-49.6, S1.top, -4.0], 'rocking leaf 1'); mark([-51.8, S1.top, -4.0], 'rocking leaf 1 (west end)');
  hop(S1, S2, 'rocking 1 > 2'); mark([-54.4, S2.top, -0.6], 'rocking leaf 2'); mark([-54.4, S2.top, 2.0], 'rocking leaf 2 (south)');
  const F2 = leaf('fixed', 'f2', -48.6, 2.2, r2(Y3 + 11.6), 6, { r: 90 });
  hop(S2, F2, 'rocking 2 > green leaf'); mark(P(F2, 1.4), 'green leaf 2');
  const P3 = mush('power', 'p3', -45.6, -0.4, r2(F2.top + 0.2), 2.4, { min: 21 });
  hop(F2, P3, 'green leaf > violet cap');
  const F3 = leaf('fixed', 'f3', -49.4, -4.0, r2(Y3 + 17.8), 6, { r: 90 });
  B.link(P(P3), P(F3), 'bounce'); mark(P(F3, 1.0), 'high green leaf', 'via:p3');
  const B3 = branch(75, r2(F3.top + 1.4), 7.0);
  hop(F3, at(B3.tip, 0.9), 'leaf > branch'); mark(B3.tip, 'branch (tip)'); mark(B3.mid, 'branch');
  const SF3 = [shelf(110, r2(B3.top + 1.4)), shelf(135, r2(B3.top + 2.8)), shelf(160, r2(B3.top + 4.2))];
  hop(at(B3.mid, 0.9), SF3[0], 'branch > fungus 1'); hop(SF3[0], SF3[1], 'fungus 1 > 2'); hop(SF3[1], SF3[2], 'fungus 2 > 3');
  SF3.forEach((f, i) => mark(P(f), `shelf fungus ${i + 1}`));
  const I31 = islet(-55.2, -16.0, r2(SF3[2].top + 1.4), { w: 3.2 });
  hop(SF3[2], I31, 'fungus 3 > islet'); mark(P(I31), 'moss islet');
  const M32 = mush('bounce', 'm32', -51.8, -17.6, r2(I31.top + 0.6), 2.4, { min: 16 });
  hop(I31, M32, 'islet > red cap');
  const I32 = islet(-52.4, -20.8, r2(Y4 - 1.4), { w: 3.2 });
  B.link(P(M32), P(I32), 'bounce'); mark(P(I32), 'high islet', 'via:m32');
  piece('root_bridge', -60.0, -23.6, Y4, 12.6, { name: 'root bridge' });
  hop(I32, at([-54.6, Y4, -23.6], 0.9), 'islet > root bridge'); mark([-56.0, Y4, -23.6], 'root bridge');
  // easy: moss islets up the east side
  alt('z3easy', { p: P(F1, 2.0), rec: F1, label: 'green leaf' }, [
    ['islet', -45.4, -18.4, r2(Y3 + 6.0), { w: 2.6 }],
    ['islet', -45.4, -14.6, r2(Y3 + 7.4), { w: 2.6 }],
    ['islet', -45.4, -10.8, r2(Y3 + 8.8), { w: 2.6 }],
    ['islet', -45.4, -7.0, r2(Y3 + 10.2), { w: 2.6 }],
    ['islet', -45.6, -2.8, r2(Y3 + 11.6), { w: 2.6 }],
  ], null);
  B.mark('z3easy', P(F3, 1.0), 'high green leaf (joins)', 'via:p3');
  B.link([-45.6, Y3 + 11.6, -2.8], P(P3), 'walk');
  // hard: three orange (folding) leaves instead of the violet cap - keep moving
  const FD3 = [leaf('fold', 'fd3a', -49.0, 6.0, r2(F2.top + 1.4), 6, { r: 90 }), leaf('fold', 'fd3b', -43.6, 2.6, r2(F2.top + 3.0), 6), leaf('fold', 'fd3c', -43.6, -4.6, r2(F2.top + 4.6), 6)];
  hop(F2, FD3[0], 'green leaf > folding 1'); hop(FD3[0], FD3[1], 'folding 1 > 2'); hop(FD3[1], FD3[2], 'folding 2 > 3'); hop(FD3[2], F3, 'folding 3 > high leaf');
  B.mark('z3hard', P(F2, 1.4), 'green leaf 2');
  B.mark('z3hard', [-48.0, FD3[0].top, 6.0], 'folding leaf 1');
  B.mark('z3hard', [-43.6, FD3[1].top, 2.0], 'folding leaf 2');
  B.mark('z3hard', [-43.6, FD3[2].top, -4.4], 'folding leaf 3');
  B.mark('z3hard', P(F3, 1.0), 'high green leaf (joins)');
  // secret: an orange leaf folds down when you stand on it; from its tip, a hidden islet (gem)
  const FD = leaf('fold', 'fd3', -57.4, 4.6, S2.top, 6);
  const SEC3 = islet(-57.2, 11.4, r2(S2.top - 2.0), { w: 2.6, name: 'hidden islet' });
  gem('gem3', P(SEC3));
  hop(S2, FD, 'rocking 2 > orange leaf'); hop(at([-57.4, S2.top - 1.4, 7.4], 0.6), SEC3, 'folded tip > hidden islet');
  B.link([-57.4, S2.top, 6.6], P(SEC3), 'drop');
  B.mark('z3secret', [-54.4, S2.top, 2.0], 'rocking leaf 2');
  B.mark('z3secret', [-57.4, S2.top, 6.4], 'orange leaf (tip)');
  B.mark('z3secret', P(SEC3), 'hidden islet (gem)');
  divider(Y3, Y4 - 0.6, [[-22.8, -20.4, Y3 - 1, Y3 + 3.5]]);
  EXIT = [-56.0, Y4, -23.6];
  console.log('zone 3 placed');
}
if (upTo(4)) {
  // =====================================================================================
  // ZONE 4 – HANGING LOG CANYON (1020–1050, west): climb a vine up the side of a high islet, ride a log swinging on
  // vines across the canyon, climb a second vine, ride a second log over to the trunk, shelf fungi round its west side,
  // a violet cap up to the root bridge east at 1050.
  //   easy: a root bridge beside the first log · secret: behind the first high islet, a ledge with a gem
  // =====================================================================================
  deck('deck 4', HALF.W, Y4);
  mark([-64.8, Y4, -23.6], 'deck 4');
  checkpoint('cp4', [-65.0, Y4, -20.4], -90);
  const H1 = islet(-71.0, -20.0, r2(Y4 + 6.9), { w: 5.0, name: 'high islet' });
  vine([-68.45, Y4, -20.0], H1.top, 90);
  mark([-67.9, Y4, -20.0], 'vine (foot)', 'ladder'); B.link([-67.9, Y4, -20.0], P(H1, 1.0), 'ladder');
  mark(P(H1, 1.2, 0.6), 'high islet');
  const SL1 = swingLog('sl41', [-71.0, r2(H1.top + 0.1), -13.0], 6.0, 'z', 20, 5.0);
  const H2 = islet(-71.0, -6.0, H1.top, { w: 5.0, name: 'high islet' });
  mark([-71.0, H1.top, -18.2], 'log (south end)');
  mark(SL1.A, 'swinging log (board)', 'swing:sl41:A'); mark(SL1.B, 'swinging log (ride)', 'swing:sl41:B');
  B.link([-71.0, H1.top, -18.2], SL1.A, 'board'); B.link(SL1.A, SL1.B, 'swing'); B.link(SL1.B, P(H2), 'alight');
  mark(P(H2, 0, -1.4), 'high islet 2');
  const I41 = islet(-73.0, -1.8, r2(H2.top + 1.4), { w: 3.0 });
  hop(H2, I41, 'islet 2 > ledge');
  const H3 = islet(-73.0, 2.4, r2(I41.top + 7.2), { w: 5.0, name: 'high islet' });
  vine([-73.0, I41.top, -0.15], H3.top, 180);
  mark([-73.0, I41.top, -0.6], 'vine 2 (foot)', 'ladder'); B.link([-73.0, I41.top, -0.6], P(H3, 0, 1.0), 'ladder');
  mark(P(H3, 1.4, 0.4), 'high islet 3');
  const SL2 = swingLog('sl42', [-67.25, r2(H3.top + 0.1), 0.4], 4.0, 'x', 20, 4.2, { phase: 1.0 });
  const H4 = islet(-62.2, -0.8, H3.top, { w: 3.6 });
  mark([-71.2, H3.top, 0.4], 'log 2 (west end)');
  mark(SL2.A, 'swinging log 2 (board)', 'swing:sl42:A'); mark(SL2.B, 'swinging log 2 (ride)', 'swing:sl42:B');
  B.link([-71.2, H3.top, 0.4], SL2.A, 'board'); B.link(SL2.A, SL2.B, 'swing'); B.link(SL2.B, P(H4), 'alight');
  mark(P(H4), 'islet by the trunk');
  const SF4 = [shelf(345, r2(H4.top + 1.4)), shelf(320, r2(H4.top + 2.8)), shelf(295, r2(H4.top + 4.2)), shelf(270, r2(H4.top + 5.6))];
  hop(H4, SF4[0], 'islet > fungus 1'); SF4.forEach((f, i) => { if (i) hop(SF4[i - 1], f, `fungus ${i} > ${i + 1}`); mark(P(f), `shelf fungus ${i + 1}`); });
  const I42 = islet(-67.6, -12.4, r2(SF4[3].top + 1.4), { w: 3.2 });
  hop(SF4[3], I42, 'fungus 4 > islet'); mark(P(I42), 'moss islet');
  const P4 = mush('power', 'p4', -70.4, -16.2, r2(I42.top - 0.2), 2.4, { min: 21 });
  hop(I42, P4, 'islet > violet cap');
  const I43 = islet(-70.4, -20.4, r2(Y5 - 1.0), { w: 3.2 });
  B.link(P(P4), P(I43), 'bounce'); mark(P(I43), 'high islet 4', 'via:p4');
  piece('root_bridge', -62.0, -20.4, Y5, 13.2, { name: 'root bridge' });
  hop(I43, at([-68.2, Y5, -20.4], 0.9), 'islet > root bridge'); mark([-65.4, Y5, -20.4], 'root bridge');
  // easy: a root bridge beside the first log
  piece('root_bridge', -74.6, -13.0, r2(H1.top + 0.2), 9.4, { r: 90, name: 'root bridge (easy)' });
  B.mark('z4easy', P(H1, -1.8, 1.4), 'high islet (west)');
  B.mark('z4easy', [-74.6, r2(H1.top + 0.2), -13.0], 'root bridge');
  B.mark('z4easy', P(H2, -1.8, -1.4), 'high islet 2 (joins)');
  // hard: two short logs side by side, swinging half a beat apart - jump from one to the other where they meet
  const SH1 = swingLog('slh1', [-67.0, r2(H1.top + 0.1), -15.6], 4.0, 'z', 20, 4.0, { phase: 0 });
  const SH2 = swingLog('slh2', [-67.0, r2(H1.top + 0.1), -10.4], 4.0, 'z', 20, 4.0, { phase: 2.0 });
  B.mark('z4hard', P(H1, 2.0, 1.4), 'high islet (east)');
  B.mark('z4hard', SH1.A, 'log 1 (board)', 'swing:slh1:A');
  B.mark('z4hard', SH1.B, 'log 1 (ride)', 'swing:slh1:B');
  B.mark('z4hard', SH2.A, 'log 2 (jump across)', 'swing:slh2:A');
  B.mark('z4hard', SH2.B, 'log 2 (ride)', 'swing:slh2:B');
  B.mark('z4hard', P(H2, 1.8, -1.4), 'high islet 2 (joins)');
  B.link(P(H1, 2.0, 1.4), SH1.A, 'board'); B.link(SH1.A, SH1.B, 'swing'); B.link(SH1.B, SH2.A, 'jump'); B.link(SH2.A, SH2.B, 'swing'); B.link(SH2.B, P(H2, 1.8, -1.4), 'alight');
  // secret: behind the first high islet, a ledge with a gem
  const SEC4 = islet(-74.6, -25.6, r2(H1.top + 1.2), { w: 2.4, name: 'hidden ledge' });
  gem('gem4', P(SEC4));
  hop(H1, SEC4, 'high islet > hidden ledge');
  B.mark('z4secret', P(H1, -1.0, -1.4), 'high islet');
  B.mark('z4secret', P(SEC4), 'hidden ledge (gem)');
  B.mark('z4secret', P(H1, -1.0, -1.0), 'back on the islet');
  divider(Y4, Y5 - 0.6, [[-24.6, -22.6, Y4 - 1, Y4 + 3.5]]);
  EXIT = [-56.0, Y5, -20.4];
  console.log('zone 4 placed');
}
if (upTo(5)) {
  // =====================================================================================
  // ZONE 5 – HOLLOW ANCIENT TREE (1050–1085, east): round the trunk. A red cap to a branch, shelf fungi up its
  // north-east side, two that crumble, a branch south, a vine up the side of a high islet, a spore stream lifting you
  // ten metres, an orange cap that throws you north, islets to the root bridge west at 1085.
  //   easy: moss islets instead of the crumbling fungi · hard: tiny moss stones instead of the orange cap
  //   secret: the hollow in the trunk - a doorway at the foot of the zone; inside, a spore stream to a ledge (gem)
  // =====================================================================================
  deck('deck 5', HALF.E, Y5, { zc: [-15.0, 1.0] }); // the seam between the two islands clear of the hollow's doorway (z -9)
  mark([-56.0, Y5, -20.4], 'deck 5');
  checkpoint('cp5', [-55.0, Y5, -17.6], 90);
  const M51 = mush('bounce', 'm51', -50.4, -16.4, r2(Y5 + 2.0), 2.4, { min: 16 });
  hop(at([-56.0, Y5, -20.4], 0.4), M51, 'deck > red cap');
  const B51 = branch(120, r2(Y5 + 5.0), 6.4);
  B.link(P(M51), B51.tip, 'bounce'); mark(B51.tip, 'branch (tip)', 'via:m51'); mark(B51.mid, 'branch');
  const SF5 = [shelf(100, r2(B51.top + 1.4)), shelf(80, r2(B51.top + 2.8))];
  hop(at(B51.mid, 0.9), SF5[0], 'branch > fungus 1'); hop(SF5[0], SF5[1], 'fungus 1 > 2');
  SF5.forEach((f, i) => mark(P(f), `shelf fungus ${i + 1}`));
  const CR5 = [crumbleShelf('cr5a', 60, r2(SF5[1].top + 1.4)), crumbleShelf('cr5b', 42, r2(SF5[1].top + 2.8))];
  hop(SF5[1], CR5[0], 'fungus 2 > crumbling 1'); hop(CR5[0], CR5[1], 'crumbling 1 > 2');
  mark(P(CR5[0]), 'crumbling fungus 1'); mark(P(CR5[1]), 'crumbling fungus 2');
  const SFV = shelf(24, r2(CR5[1].top + 1.4));
  hop(CR5[1], SFV, 'crumbling 2 > fungus'); mark(P(SFV), 'shelf fungus by the vine');
  const H51 = islet(-57.6, -1.6, r2(SFV.top + 6.6), { w: 4.6, name: 'high islet' });
  vine([-58.0, SFV.top, -3.95], H51.top, 180);
  mark([-58.0, SFV.top, -4.4], 'vine (foot)', 'ladder'); B.link([-58.0, SFV.top, -4.4], P(H51), 'ladder');
  mark(P(H51, 0, 0.6), 'high islet');
  const SP5 = spore('sp5', r2(H51.x + 1.2), H51.top, r2(H51.z + 1.2), 10.4);
  const I52 = islet(r2(H51.x + 4.4), r2(H51.z + 0.4), r2(H51.top + 9.6), { w: 3.0 });
  B.link(P(H51), P(I52), 'spore'); mark(P(I52), 'islet above the spores', 'fan:sp5');
  const T51 = mush('tilted', 't51', -50.4, r2(I52.z - 3.4), r2(I52.top + 0.8), 2.4, { r: 180, push: 8, min: 16 });
  hop(I52, T51, 'islet > orange cap');
  const I53 = islet(-50.4, r2(T51.z - 5.8), r2(T51.top + 3.2), { w: 3.2 });
  B.link(P(T51), P(I53), 'bounce'); mark(P(I53), 'islet (thrown north)', 'via:t51');
  const I54 = islet(-50.0, -13.4, r2(Y6 - 2.1), { w: 2.6 });
  const I55 = islet(-51.0, -16.4, r2(Y6 - 1.4), { w: 3.0 });
  hop(I53, I54, 'islet > islet'); mark(P(I54), 'high islet 2');
  hop(I54, I55, 'islet > islet 2'); mark(P(I55), 'high islet 3');
  piece('root_bridge', -60.2, -16.4, Y6, 14.4, { name: 'root bridge' });
  hop(I55, at([-53.4, Y6, -16.4], 0.9), 'islet > root bridge'); mark([-56.6, Y6, -16.4], 'root bridge');
  // easy: moss islets instead of the crumbling fungi
  alt('z5easy', { p: P(SF5[1]), rec: SF5[1], label: 'shelf fungus 2' }, [
    ['islet', -53.4, -4.6, r2(SF5[1].top + 1.4), { w: 2.6 }],
    ['islet', -55.4, -1.6, r2(SF5[1].top + 2.8), { w: 2.6 }],
  ], { p: P(SFV), rec: SFV, label: 'shelf fungus by the vine (joins)' });
  // hard: tiny moss stones instead of the orange cap
  alt('z5hard', { p: P(I52), rec: I52, label: 'islet above the spores' }, [
    ['islet', -49.4, r2(I52.z - 0.2), r2(I52.top + 1.6), { w: 1.4 }],
    ['islet', -47.0, r2(I52.z - 2.8), r2(I52.top + 3.0), { w: 1.4 }],
    ['islet', -47.4, r2(I52.z - 6.2), r2(I52.top + 4.0), { w: 1.4 }],
  ], { p: P(I53), rec: I53, label: 'islet (joins)' });
  // secret: the hollow in the trunk; inside, a spore stream up to a ledge with a gem
  const SPH = spore('sph5', -59.4, Y5, -9.0, 4.8, { w: 1.6 });
  const SECL = { x: -61.9, z: -9.0, top: r2(Y5 + 3.6), r: 0.9 };
  B.prefab('shelf_fungus', -62.05, r2(SECL.top - FT.shelf_fungus * 0.9), -9.0, 270, 0.9, { name: 'ledge in the hollow' });
  gem('gem5', P(SECL));
  B.mark('z5secret', [-55.2, Y5, -9.0], 'at the doorway in the trunk');
  B.mark('z5secret', [-58.4, Y5, -9.0], 'in the hollow');
  B.mark('z5secret', P(SECL), 'ledge in the hollow (gem)', 'fan:sph5');
  void SPH; void SP5;
  divider(Y5, Y6 - 0.6, [[-21.4, -19.4, Y5 - 1, Y5 + 3.5], [-12.6, -5.4, Y5 - 1.2, HOL1]]);
  EXIT = [-55.4, Y6, -16.4];
  console.log('zone 5 placed');
}

if (upTo(6)) {
  // =====================================================================================
  // ZONE 6 – GLOWING SPORE SANCTUARY (1085–1115, west): the glowing forest. A spore stream from the island lifts you
  // to an islet, a second one to a branch of the tree, shelf fungi round its west side, a violet cap to the root bridge
  // east at 1115. Glowing mushrooms mark every landing.
  //   easy: moss islets instead of the violet cap · hard: a pulsing spore stream (on 2.5 s, off 2 s) instead of the first
  //   secret: a glowing cave on the second islet - walk through it (gem)
  // =====================================================================================
  deck('deck 6', HALF.W, Y6);
  mark([-66.0, Y6, -16.4], 'deck 6');
  checkpoint('cp6', [-66.2, Y6, -13.4], -90);
  const S61 = spore('sp61', -70.0, Y6, -20.0, 9.0);
  G1(-68.6, -22.2, Y6, 1.3, 200); G1(-72.6, -22.6, Y6, 1.1, 80);
  const I61 = islet(-73.6, -16.2, r2(Y6 + 8.0), { w: 3.2 });
  hop(at([-66.0, Y6, -16.4], 0.4), S61, 'deck > spores');
  B.link([-70.0, Y6, -20.0], P(I61), 'spore'); mark(P(I61), 'islet above the spores', 'fan:sp61');
  const I62 = islet(-71.0, -9.6, r2(I61.top + 1.0), { w: 8.4, name: 'glowing islet' });
  hop(I61, I62, 'islet > glowing islet'); mark([-68.4, I62.top, -13.0], 'glowing islet');
  const GC = piece('glow_cave', -72.8, -8.4, r2(I62.top + FT.glow_cave * 4.4), 4.4 * SZ.glow_cave[0], { r: 180, name: 'glowing cave' });
  G1(-69.2, -7.0, I62.top, 1.0, 30);
  const S62 = spore('sp62', -67.8, I62.top, -10.4, 10.2);
  hop(I62, S62, 'glowing islet > spores');
  const B61 = branch(280, r2(I62.top + 8.6), 6.4);
  B.link([-67.8, I62.top, -10.4], B61.tip, 'spore'); mark(B61.tip, 'branch (tip)', 'fan:sp62'); mark(B61.mid, 'branch');
  const SF6 = [shelf(255, r2(B61.top + 1.4)), shelf(230, r2(B61.top + 2.8)), shelf(205, r2(B61.top + 4.2))];
  hop(at(B61.mid, 0.9), SF6[0], 'branch > fungus 1'); hop(SF6[0], SF6[1], 'fungus 1 > 2'); hop(SF6[1], SF6[2], 'fungus 2 > 3');
  SF6.forEach((f, i) => mark(P(f), `shelf fungus ${i + 1}`));
  const I63 = islet(-64.6, -15.6, r2(SF6[2].top + 1.4), { w: 3.0 });
  hop(SF6[2], I63, 'fungus 3 > islet'); mark(P(I63), 'moss islet by the trunk');
  G1(-63.6, -16.8, I63.top, 0.8, 90);
  const P61 = mush('power', 'p61', -67.6, -17.0, r2(I63.top - 0.6), 2.6, { min: 21 });
  hop(I63, P61, 'islet > violet cap');
  const I64 = islet(-71.4, -20.6, r2(Y7 - 1.4), { w: 3.2 });
  B.link(P(P61), P(I64), 'bounce'); mark(P(I64), 'high islet', 'via:p61');
  piece('root_bridge', -62.4, -21.6, Y7, 13.0, { name: 'root bridge' });
  hop(I64, at([-67.4, Y7, -21.6], 0.9), 'islet > root bridge'); mark([-65.6, Y7, -21.6], 'root bridge');
  // easy: moss islets instead of the violet cap
  alt('z6easy', { p: P(I63), rec: I63, label: 'moss islet by the trunk' }, [
    ['islet', -67.8, -13.0, r2(I63.top + 1.4), { w: 2.6 }],
    ['islet', -71.2, -13.8, r2(I63.top + 2.8), { w: 2.6 }],
    ['islet', -74.2, -16.4, r2(I63.top + 4.2), { w: 2.6 }],
    ['islet', -74.4, -20.0, r2(I63.top + 5.6), { w: 2.6 }],
  ], { p: P(I64), rec: I64, label: 'high islet (joins)' });
  // hard: a pulsing spore stream on the far side of the island instead of the first one
  const SH = spore('sp6h', -74.4, Y6, -22.6, 9.6, { on: 2.5, off: 2.0 });
  const IH = islet(-74.6, -18.8, r2(Y6 + 8.6), { w: 1.6, name: 'small islet' });
  B.link([-74.4, Y6, -22.6], P(IH), 'spore');
  B.mark('z6hard', [-66.0, Y6, -18.4], 'deck 6');
  B.mark('z6hard', P(IH), 'small islet (pulsing spores)', 'fan:sp6h');
  B.mark('z6hard', P(I61), 'islet above the spores (joins)');
  hop(IH, I61, 'small islet > islet'); void SH;
  // secret: walk through the glowing cave on the second islet
  gem('gem6', [-72.8, I62.top, -8.6]);
  B.mark('z6secret', [-68.4, I62.top, -13.0], 'glowing islet');
  B.mark('z6secret', [-72.6, I62.top, -13.2], 'in front of the cave');
  B.mark('z6secret', [-72.8, I62.top, -11.4], 'cave mouth');
  B.mark('z6secret', [-72.8, I62.top, -8.6], 'in the glowing cave (gem)');
  B.mark('z6secret', [-72.8, I62.top, -11.6], 'back out of the cave');
  void GC; void S61; void S62;
  divider(Y6, Y7 - 0.6, [[-17.4, -15.4, Y6 - 1, Y6 + 3.5]]);
  EXIT = [-56.4, Y7, -21.6];
  console.log('zone 6 placed');
}
if (upTo(7)) {
  // =====================================================================================
  // ZONE 7 – ANCIENT TREE CROWN (1115–1150, east): everything the forest taught. A red cap to a springy leaf, a leaf
  // rocking in the wind, an orange cap thrown south, a vine up a high islet, a spore stream, shelf fungi round the
  // trunk (two crumble), a violet cap that throws you over the rim of the crown: the summit, and the gate to Map 007.
  //   easy: moss islets instead of the crumbling fungi · hard: four orange (folding) leaves instead of the vine
  //   portal: on deck 7, opens with 5 of the 6 gems; flies you up to the islet before the last violet cap
  // =====================================================================================
  deck('deck 7', HALF.E, Y7);
  mark([-56.4, Y7, -21.6], 'deck 7');
  checkpoint('cp7', [-55.6, Y7, -18.6], 90);
  const CROWN = piece('crown_platform', C6.x, C6.z, TOP, 14.0, { name: 'crown of the ancient tree' });
  const M71 = mush('bounce', 'm71', -50.0, -19.6, r2(Y7 + 2.0), 2.4, { min: 16 });
  hop(at([-56.4, Y7, -21.6], 0.4), M71, 'deck > red cap');
  const L71 = leaf('spring', 'l71', -48.0, -13.0, r2(Y7 + 5.0), 6);
  B.link(P(M71), [-48.0, L71.top, -15.0], 'bounce'); mark([-48.0, L71.top, -15.0], 'springy leaf', 'via:m71');
  mark([-48.0, L71.top, -10.8], 'springy leaf (south end)');
  const L72 = leaf('sway', 'l72', -50.6, -8.0, r2(L71.top + 1.4), 6, { r: 90, period: 3.8 });
  hop(L71, L72, 'springy > rocking'); mark([-49.6, L72.top, -8.0], 'rocking leaf'); mark([-52.6, L72.top, -8.0], 'rocking leaf (west end)');
  const T71 = mush('tilted', 't71', -54.8, -5.2, r2(L72.top + 0.4), 2.4, { r: 0, push: 8, min: 16 });
  hop(at([-52.6, L72.top, -8.0], 0.8), T71, 'rocking leaf > orange cap');
  const I71 = islet(-54.8, 0.4, r2(T71.top + 2.6), { w: 3.0 });
  B.link(P(T71), P(I71), 'bounce'); mark(P(I71), 'islet (thrown south)', 'via:t71');
  const H71 = islet(-51.0, 0.4, r2(I71.top + 7.0), { w: 4.4, name: 'high islet' });
  vine([-53.25, I71.top, 0.4], H71.top, -90);
  mark([-53.8, I71.top, 0.4], 'vine (foot)', 'ladder'); B.link([-53.8, I71.top, 0.4], P(H71), 'ladder');
  mark(P(H71, 0.8, 0.8), 'high islet');
  const SP7 = spore('sp7', -52.4, H71.top, -0.6, 10.0);
  const B71 = branch(40, r2(H71.top + 9.0), 6.4);
  B.link([-52.4, H71.top, -0.6], B71.tip, 'spore'); mark(B71.tip, 'branch (tip)', 'fan:sp7'); mark(B71.mid, 'branch');
  const SF7 = [shelf(65, r2(B71.top + 1.4))];
  const CR7 = [crumbleShelf('cr7a', 90, r2(B71.top + 2.8)), crumbleShelf('cr7b', 115, r2(B71.top + 4.2))];
  const SF7b = shelf(140, r2(B71.top + 5.6));
  hop(at(B71.mid, 0.9), SF7[0], 'branch > fungus'); hop(SF7[0], CR7[0], 'fungus > crumbling 1'); hop(CR7[0], CR7[1], 'crumbling 1 > 2'); hop(CR7[1], SF7b, 'crumbling 2 > fungus');
  mark(P(SF7[0]), 'shelf fungus'); mark(P(CR7[0]), 'crumbling fungus 1'); mark(P(CR7[1]), 'crumbling fungus 2'); mark(P(SF7b), 'shelf fungus 2');
  const I73 = islet(-56.0, -15.8, r2(SF7b.top + 1.4), { w: 3.0 });
  hop(SF7b, I73, 'fungus > islet'); mark(P(I73), 'last islet');
  G1(-57.0, -16.8, I73.top, 0.8, 60);
  const P7 = mush('power', 'p7', -52.8, -15.0, r2(I73.top - 0.2), 2.4, { min: 21 });
  hop(I73, P7, 'islet > violet cap');
  B.link(P(P7), [-56.4, TOP, -12.4], 'bounce'); mark([-56.4, TOP, -12.4], 'the crown', 'via:p7');
  mark([-60.0, TOP, -9.6], 'SUMMIT');
  // easy: moss islets instead of the crumbling fungi
  alt('z7easy', { p: P(SF7[0]), rec: SF7[0], label: 'shelf fungus' }, [
    ['islet', -53.0, -8.8, r2(SF7[0].top + 1.4), { w: 2.6 }],
    ['islet', -53.4, -12.2, r2(SF7[0].top + 2.8), { w: 2.6 }],
  ], { p: P(SF7b), rec: SF7b, label: 'shelf fungus 2 (joins)' });
  // hard: four orange (folding) leaves instead of the vine - keep moving
  alt('z7hard', { p: P(I71), rec: I71, label: 'islet' }, [], null);
  const FDL = [leaf('fold', 'fd71', -56.0, 5.0, r2(I71.top + 1.4), 6), leaf('fold', 'fd72', -51.6, 7.2, r2(I71.top + 2.8), 6, { r: 90 }),
    leaf('fold', 'fd73', -46.6, 4.0, r2(I71.top + 4.2), 6), leaf('fold', 'fd74', -46.6, -3.0, r2(I71.top + 5.6), 6)];
  hop(I71, FDL[0], 'islet > folding 1'); FDL.forEach((f, i) => { if (i) hop(FDL[i - 1], f, `folding ${i} > ${i + 1}`); });
  B.mark('z7hard', [-56.0, FDL[0].top, 4.4], 'folding leaf 1');
  B.mark('z7hard', [-52.6, FDL[1].top, 7.2], 'folding leaf 2');
  B.mark('z7hard', [-46.6, FDL[2].top, 3.6], 'folding leaf 3');
  B.mark('z7hard', [-46.6, FDL[3].top, -1.8], 'folding leaf 4');
  B.mark('z7hard', P(H71, 0.8, 0.8), 'high islet (joins)');
  hop(FDL[3], H71, 'folding 4 > high islet');
  // the gem portal (5 of the 6 gems): from deck 7 up to the last islet
  const PT = [-52.0, Y7, -22.6], PE = P(I73), PL = Math.hypot(PE[0] - PT[0], PE[2] - PT[2]);
  const PU = [(PE[0] - PT[0]) / PL, (PE[2] - PT[2]) / PL];
  portal('pt7', PT, r2((Math.atan2(PU[0], PU[1]) * 180) / Math.PI), PE, 0, 5);
  SIGN([-47.2, r2(Y7 + 3.2), -23.8], 0, 'CỔNG ĐÁ QUÝ', 'Cần 5 viên đá quý · bay lên gần vương miện');
  B.mark('portal', [r2(PT[0] - 2.0 * PU[0]), Y7, r2(PT[2] - 2.0 * PU[1])], 'in front of the portal (needs 5 gems)');
  B.mark('portal', PE, 'portal exit (last islet)');
  void CROWN; void SP7;
  divider(Y7, TOP - 0.6, [[-22.6, -20.6, Y7 - 1, Y7 + 3.5]]);
  EXIT = [-60.0, TOP, -9.6];
  console.log('zone 7 placed');
}
// ===================================================================================== @ZONES-END
console.log('hops:\n  ' + hops.join('\n  '));

// =====================================================================================
// VALIDATION, OUTPUT
// =====================================================================================
const val = B.validate(SPAWN, EXIT);
if (process.env.SHOWPATH) for (const k of ['med', 'hard']) { const names = []; for (const i of val[k].path ?? []) { const n = val.nodes[i]; names.push(`${n.o?.name ?? 'node'}@${n.x.toFixed(1)},${n.y.toFixed(1)},${n.z.toFixed(1)}`); } console.log(`  ${k}:`, names.join(' > ')); }
B.checkOverlaps();
function sweepCheck() {
  const objBoxes = (o) => {
    if (o.type === 'prefab') {
      if (!o.solid) return [];
      const g = o.g, c = Math.cos((o.r * Math.PI) / 180), sn = Math.sin((o.r * Math.PI) / 180);
      const xs = [], zs = [];
      for (const [lx, lz] of [[g.minx, g.minz], [g.maxx, g.minz], [g.minx, g.maxz], [g.maxx, g.maxz]]) { xs.push(o.x + (lx * c + lz * sn) * o.s); zs.push(o.z + (-lx * sn + lz * c) * o.s); }
      return [{ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0: o.y, y1: o.y + o.s }];
    }
    return (o.boxes ?? []).map((b) => { const r = ((o.r ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r)); const hx = b.h[0] * c + b.h[2] * sn, hz = b.h[0] * sn + b.h[2] * c; return { x0: b.c[0] - hx, x1: b.c[0] + hx, z0: b.c[2] - hz, z1: b.c[2] + hz, y0: b.c[1] - b.h[1], y1: b.c[1] + b.h[1] }; });
  };
  const hits = [];
  for (const sw of sweeps) {
    for (const o of B.objects) for (const b of objBoxes(o)) {
      if (b.y1 <= sw.y0 + 0.05 || b.y0 >= sw.y1 - 0.05) continue;
      let hit = false;
      if (sw.skip?.includes(o.name)) continue;
      if (sw.boxes) hit = sw.boxes.some((q) => b.x0 < q.x1 - 0.05 && b.x1 > q.x0 + 0.05 && b.z0 < q.z1 - 0.05 && b.z1 > q.z0 + 0.05);
      else {
        const { x, z, r, a0, a1 } = sw.circle, lo = Math.min(a0, a1) - 12, hi = Math.max(a0, a1) + 12;
        for (let i = 0; i <= 6 && !hit; i++) for (let j = 0; j <= 6 && !hit; j++) {
          const px = b.x0 + ((b.x1 - b.x0) * i) / 6, pz = b.z0 + ((b.z1 - b.z0) * j) / 6, d = Math.hypot(px - x, pz - z);
          if (d > r || d < Math.max(1.2, sw.circle.r0 ?? 0)) continue;
          let ang = (Math.atan2(px - x, pz - z) * 180) / Math.PI;
          while (ang < lo) ang += 360;
          while (ang > lo + 360) ang -= 360;
          if (ang <= hi) hit = true;
        }
      }
      if (hit) hits.push(`${sw.id} x ${o.name} [${r2(b.x0)}..${r2(b.x1)}, ${r2(b.y0)}..${r2(b.y1)}, ${r2(b.z0)}..${r2(b.z1)}]`);
    }
  }
  console.log(`  mover clearance: ${hits.length ? hits.length + ' hits\n    ' + [...new Set(hits)].slice(0, 30).join('\n    ') : 'ok'}`);
}
sweepCheck();
await plotMap(B, val, new URL('./out/map006_plan.png', import.meta.url).pathname, { cx: C6.x, cz: C6.z, r: 26, y0: Y1 - 5, y1: TOP + 5 });
if (process.env.ZPLOT) {
  const bands = [[HALF.E, Y1, Y2], [HALF.W, Y2, Y3], [HALF.E, Y3, Y4], [HALF.W, Y4, Y5], [HALF.E, Y5, Y6], [HALF.W, Y6, Y7], [HALF.E, Y7, TOP]];
  for (const [i, [H, a, b]] of bands.entries()) if (upTo(i + 1)) await zonePlot(B, `/tmp/z6_${i + 1}.png`, { x0: H.x0 - 1, x1: H.x1 + 1, z0: Z0 - 1, z1: Z1 + 2, y0: a, y1: b + 1, routes: B.routes, title: `zone ${i + 1}: ${a}–${b}` });
}
console.log('route points', JSON.stringify(Object.fromEntries(Object.entries(B.routes).map(([k, v]) => [k, v.length]))));
if (process.env.NOWRITE) process.exit(0);
const zones = [
  { id: 'A', name: 'Cửa Rừng', y0: 933, y1: 960, color: '#7ccf4a' },
  { id: 'B', name: 'Thung Lũng Nấm', y0: 960, y1: 990, color: '#e3402e' },
  { id: 'C', name: 'Vườn Lá Khổng Lồ', y0: 990, y1: 1020, color: '#3cc45a' },
  { id: 'D', name: 'Hẻm Cầu Thân Cây', y0: 1020, y1: 1050, color: '#a0703c' },
  { id: 'E', name: 'Cây Cổ Thụ Rỗng', y0: 1050, y1: 1085, color: '#6fd6e8' },
  { id: 'F', name: 'Thánh Địa Bào Tử', y0: 1085, y1: 1115, color: '#a98cf0' },
  { id: 'G', name: 'Vương Miện Cây Cổ', y0: 1115, y1: 1155, color: '#ffffff' },
];
const data = B.toJSON({
  id: 'map006', name: 'Mushroom Forest', version: 1, height: TOP - Y1, origin: [0, Y1, 0],
  spawn: { p: SPAWN, yaw: Math.PI },
  exit: { p: EXIT, r: 2.6, next: 'map007', label: 'Map 007', gate: { p: [EXIT[0], EXIT[1], r2(EXIT[2] - 1.8)], yaw: 0, w: 4.4, h: 4.2 } },
  finishHint: 'Gợi ý: Rừng Nấm có quy luật riêng – nấm đỏ bật thẳng, nấm cam nghiêng ném bạn theo hướng mũ, nấm tím bật rất cao; nấm phát sáng chỉ chỗ đáp, và đừng quên nhìn phía sau thân cây…',
  challengeTime: 1800,
  zones, milestones: [950, 970, 990, 1010, 1030, 1050, 1070, 1090, 1110, 1130, 1150],
  region: { c: [C6.x, C6.z], r: RING },
  terrain: { style: 'none', radius: RING, center: [C6.x, Y1 + 20, C6.z], wallTop: 0, plazas: [], paths: [] },
  movers, pads: [], rings: [], ladders, devices,
  emissive: { glow_mushrooms: 1.0, spore_flower: 0.6, mushroom_power: 0.35, glow_cave: 0.25 },
  prefabFiles: Object.fromEntries([...new Set(B.prefabs.map((p) => p.id))].map((id) => [id, `${A}/${id}`])),
  waypoints: makeWaypoints(B.routes, zones),
});
fs.mkdirSync(`${ROOT}packs/map006/maps`, { recursive: true });
// ---------------------------------------------------------------- ambient scenery (the artist's 14 PNGs)
// far: the ancient tree's cousins, mushroom hills, a spirit tree up high (still); bobbing forest / waterfall / mushroom
// islands, glowing islands in the upper zones, leaf clusters drifting, clouds (white below, lavender above), glowing
// spores rising round the tree and over every spore stream, leaves and dandelion seeds drifting, butterflies circling
{
  let seed = 6006;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const R = (a, b) => a + (b - a) * rnd();
  const at = (r, a, y) => [r2(C6.x + Math.cos(a) * r), r2(y), r2(C6.z + Math.sin(a) * r)];
  const S = [];
  for (const [n, a, r, y, h] of [['ancient_tree_far', 0.7, 190, 930, 110], ['ancient_tree_far', 3.6, 200, 990, 120], ['mushroom_hills_far', 1.9, 175, 960, 60], ['mushroom_hills_far', 5.0, 180, 1010, 55],
    ['spirit_tree_far', 2.7, 165, 1090, 70], ['spirit_tree_far', 5.8, 170, 1120, 65]]) S.push({ n, p: at(r, a, y), h });
  const low = ['forest_island_far', 'waterfall_island_far', 'mushroom_cluster_far'];
  for (let i = 0; i < 10; i++) S.push({ n: low[i % 3], p: at(R(75, 125), i * 0.63 + R(0, 0.3), R(925, 1060)), h: r2(R(20, 32)), mv: { k: 'bob', a: r2(R(1.0, 2.2)), s: r2(R(0.18, 0.3)), ph: r2(R(0, 6.28)) } });
  for (let i = 0; i < 6; i++) S.push({ n: 'glow_island_far', p: at(R(80, 125), i * 1.05 + R(0, 0.4), R(1060, 1160)), h: r2(R(22, 32)), mv: { k: 'bob', a: r2(R(1.0, 2.0)), s: r2(R(0.15, 0.25)), ph: r2(R(0, 6.28)) } });
  for (let i = 0; i < 8; i++) { const a = R(0, 6.28); S.push({ n: 'canopy_cluster_far', p: at(R(60, 110), a, R(960, 1150)), h: r2(R(10, 16)), mv: { k: 'drift', span: r2(R(70, 110)), s: r2(R(0.3, 0.6)), d: r2(a + Math.PI / 2), a: 1.0, ph: r2(rnd()) } }); }
  for (let i = 0; i < 32; i++) { const a = R(0, 6.28), r = R(42, 140), y = R(900, 1190); S.push({ n: y > 1060 ? 'cloud_lavender_b' : 'cloud_soft_a', p: at(r, a, y), h: r2(R(9, 22)), mv: { k: 'drift', span: r2(R(90, 150)), s: r2(R(0.7, 1.5)), d: r2(a + Math.PI / 2), a: 0.8, ph: r2(rnd()) } }); }
  // glowing spores: round the trunk all the way up, and a few over every spore stream
  for (let i = 0; i < 60; i++) S.push({ n: 'spore_glow', p: at(R(5, 22), R(0, 6.28), Y1 + (i % 12) * 18), h: r2(R(0.35, 0.8)), mv: { k: 'rise', span: r2(R(25, 40)), s: r2(R(0.6, 1.2)), a: 0.5, ph: r2(rnd()) } });
  for (const f of devices.filter((d) => d.t === 'fan')) for (let i = 0; i < 4; i++) S.push({ n: 'spore_glow', p: [r2(f.p[0] + R(-0.6, 0.6)), r2(f.p[1]), r2(f.p[2] + R(-0.6, 0.6))], h: r2(R(0.3, 0.6)), mv: { k: 'rise', span: r2(f.s[1] + 1), s: r2(R(1.6, 2.4)), a: 0.2, ph: r2(rnd()) } });
  for (let i = 0; i < 16; i++) { const a = R(0, 6.28); S.push({ n: i % 2 ? 'falling_leaf' : 'dandelion_seeds', p: at(R(14, 40), a, R(940, 1150)), h: r2(i % 2 ? R(0.6, 1.0) : R(1.0, 1.6)), mv: { k: 'drift', span: r2(R(30, 50)), s: r2(R(0.5, 0.9)), d: r2(a + Math.PI / 2), a: 1.4, ph: r2(rnd()) } }); }
  for (let i = 0; i < 8; i++) S.push({ n: 'butterfly', p: [C6.x, r2(Y1 + 10 + i * 26), C6.z], h: r2(R(0.9, 1.4)), mv: { k: 'orbit', r: r2(R(12, 26)), s: r2(R(0.08, 0.14) * (i % 2 ? -1 : 1)), a: 1.2, ph: r2(R(0, 6.28)) } });
  data.atlas = `${A}/map006_atlas`;
  data.sprites = S;
  data.fx = [...(data.fx ?? []), { t: 'birds', p: [C6.x, 975, C6.z], r: 52, n: 6, c: '#3d5a3a' }, { t: 'birds', p: [C6.x, 1050, C6.z], r: 60, n: 7, c: '#3d5a3a' }, { t: 'birds', p: [C6.x, 1130, C6.z], r: 48, n: 5, c: '#4a4a7a' }];
  console.log(`scenery: ${S.length} sprites, ${data.fx.length} fx`);
}
applyI18n(data);
fs.writeFileSync(`${ROOT}packs/map006/maps/map006.json`, JSON.stringify(data));
fs.writeFileSync(new URL('./out/routes006.json', import.meta.url), JSON.stringify(B.routes));
{
  const { referencedFiles } = await import('./content.mjs');
  const dir = `${ROOT}packs/map006/`;
  const include = ['maps/map006.json', ...[...referencedFiles(data)].filter((f) => fs.existsSync(dir + f))].sort();
  const pf = dir + 'pack.json';
  const old = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  const meta = {
    id: 'map006', name: 'Mushroom Forest', order: 6, yMin: Y1 - 2, yMax: TOP + 40, entry: 'maps/map006.json', minApp: 4, requires: [],
    summary: 'Rừng nấm khổng lồ quanh một cây cổ thụ · 935 → 1150 m · 7 khu · nấm bật, nấm nghiêng, lá gập, cầu thân cây đung đưa, dây leo, dòng bào tử và lối bí mật trong thân cây',
    include, ...(old.version ? { version: old.version, contentHash: old.contentHash } : {}),
  };
  applyPackI18n('map006', meta);
  fs.writeFileSync(pf, JSON.stringify(meta, null, 1) + '\n');
  console.log(`pack.json: ${include.length} files`);
}
console.log(`prefabs ${B.prefabs.length}, kit ${B.kit.length}, devices ${devices.length}, movers ${movers.length}`);
