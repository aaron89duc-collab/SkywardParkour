// Map 004 – Candy Kingdom (520 -> 720 m). A tower of sweets in the sky, entered through Map 003's summit gate.
// Same layout idea as Map 003: two interleaved halves (W / E, 14 m wide). Every zone is built above its own start
// deck (two giant cookie tiles covering the whole half) and the next zone's deck sits in the other half, so a fall
// lands on the deck where the current zone started. The 24 models are the artist's (E:\game\Parkout\Asset map 4);
// every mechanism is a data-driven device or mover that wears one of them.
// Run: node devtools/build-map004.mjs -> packs/map004/maps/map004.json (+ devtools/out/map004_plan.png, routes004.json)
//   SHOWPATH=1  print the validator's shortest paths    NOWRITE=1  validate only
import fs from 'fs';
import { applyI18n, applyPackI18n } from './i18n-content.mjs';
import { MapBuilder, r2, makeWaypoints } from './mapgen/lib.mjs';
import { plotMap } from './mapgen/plot.mjs';
import { zonePlot } from './mapgen/zoneplot.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const A = 'assets/map004';
const C4 = { x: -60, z: -10 };
const RING = 22;
const Y1 = 520, Y2 = 545, Y3 = 570, Y4 = 600, Y5 = 630, Y6 = 660, Y7 = 690, TOP = 720;
const HALF = { W: { x0: -74, x1: -60, xc: -67 }, E: { x0: -60, x1: -46, xc: -53 } };
const Z0 = -24, Z1 = 4;
const B = new MapBuilder({ ground: { x: C4.x, y: -999, z: C4.z, r: 0 } });
B.seed = 4;
B.supportR = 0.22; // a standable spot needs ~0.45 m of flat top around it (no frosting lips)

// ---------------------------------------------------------------- the models: normalised size + flat top height
const info = (id) => JSON.parse(fs.readFileSync(`${ROOT}packs/map004/assets/map004/${id}.info.json`, 'utf8'));
const SZ = {}, FT = {};
for (const f of fs.readdirSync(`${ROOT}packs/map004/assets/map004`).filter((f) => f.endsWith('.info.json'))) {
  const id = f.replace('.info.json', ''), d = info(id);
  SZ[id] = d.size;
  // the dominant top height (the flat standing surface) from the heightmap
  const h = {};
  for (const v of d.top.flatMap((r) => r.trim().split(/\s+/)).filter((v) => v !== '.').map(Number).filter((v) => v >= 30)) h[v] = (h[v] ?? 0) + 1;
  FT[id] = +Object.entries(h).sort((a, b) => b[1] - a[1])[0][0] / 100;
}
FT.cupcake_tower = 0.95; FT.candy_mushroom = 0.93; FT.cotton_candy_cloud = 0.82; FT.chocolate_slope = 0.84;
const TIER = [0.41, 0.645, 0.85]; // cupcake tower: heights of its three cream rings (normalised)
const TIER_R = [[0.2, 0.29], [0.115, 0.2], [0.055, 0.115]]; // ...their inner / outer radius
const ext = (rec, ux, uz) => rec.r ?? Math.abs(ux) * rec.hx + Math.abs(uz) * rec.hz;

/** a prefab whose flat top is at `top`, w wide (model x), standing on its own base or floating */
function piece(id, x, z, top, w, o = {}) {
  const s = w / SZ[id][0];
  const base = top - FT[id] * s;
  const ob = B.prefab(id, r2(x), r2(base), r2(z), o.r ?? 0, r2(s), { name: o.name ?? id, col: o.col });
  if (o.noStand) ob.noStand = true;
  const [hx, hz] = (Math.abs(Math.round((o.r ?? 0) / 90)) % 2 === 1) ? [SZ[id][2] * s / 2, w / 2] : [w / 2, SZ[id][2] * s / 2];
  const round = ['donut_platform', 'macaron_platform', 'lollipop_platform', 'carousel_base', 'candy_plate', 'cupcake_tower', 'candy_mushroom'].includes(id);
  return { id, x, z, top: r2(top), base: r2(base), s, hx, hz, ...(round ? { r: r2(w / 2) } : {}) };
}
/** a piece standing on `ground` with its top at `top` (its size follows from the height) */
function standing(id, x, z, ground, top, o = {}) { return piece(id, x, z, top, ((top - ground) / FT[id]) * SZ[id][0], o); }
/** cupcake tower standing on `ground`, s high: three cream rings to climb (returns the rings) */
function cupTower(x, z, ground, s, o = {}) {
  B.prefab('cupcake_tower', r2(x), r2(ground), r2(z), o.r ?? 0, r2(s), { name: 'cupcake tower' });
  return TIER.map((t, i) => ({ x, z, top: r2(ground + t * s), r: r2(TIER_R[i][1] * s), ri: r2(TIER_R[i][0] * s) }));
}
/** a straight walkway of model `id` (long axis = model x) from a to b, top at a[1], about w wide; whole pieces fitted */
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
const wafer = (a, b, w = 1.6, o) => walkway('wafer_bridge', a, b, w, o);
const cane = (a, b, w = 0.62, o) => walkway('candy_cane_bar', a, b, w, o);
/** decoration (no collider) */
const deco = (id, x, z, base, s, r = 0) => B.prefab(id, r2(x), r2(base), r2(z), r, r2(s), { name: id, col: false });

/** a gumdrop bush (decoration, walk-through), s ~ height in m */
const bush = (x, z, base, s = 0.9, r = 0) => deco('gumdrop_bush', x, z, base, s, r);
/** a gingerbread house you can walk into: the model has no collider, invisible walls on three sides and either side
 *  of the door (door faces -z), open roof (a fan inside blows you out of the chimney). s = height in m */
function house(x, z, ground, s) {
  deco('gingerbread_house', x, z, ground, s, 180);
  const hx = (SZ.gingerbread_house[0] * s) / 2, hz = (SZ.gingerbread_house[2] * s) / 2, hy = 1.1, yc = r2(ground + hy), t = 0.15, door = 0.75;
  B.kitPiece('wall', [r2(x), yc, r2(z + hz - t)], [r2(hx), hy, t]);
  for (const sx of [-1, 1]) B.kitPiece('wall', [r2(x + sx * (hx - t)), yc, r2(z)], [t, hy, r2(hz)]);
  const seg = (hx - door) / 2;
  for (const sx of [-1, 1]) B.kitPiece('wall', [r2(x + sx * (door + seg)), yc, r2(z - hz + t)], [r2(seg), hy, t]);
  return { x, z, top: ground, door: [r2(x), ground, r2(z - hz - 0.9)] };
}

/** the giant cookie floor of a zone: two 14 x 14 tiles covering the whole half */
function deck(name, H, y) {
  const s = 14 / SZ.cookie_floor_tile[0];
  for (const zc of [-17, -3]) B.prefab('cookie_floor_tile', H.xc, r2(y - FT.cookie_floor_tile * s), zc, 0, r2(s), { name });
  return { top: y };
}

// ---------------------------------------------------------------- devices (data-driven mechanics) with candy looks
const devices = [];
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
  return { id, x, z, top: r2(top), hx: box[0] / 2, hz: box[2] / 2, s, dev: d, ...(o.round ? { r: r2((w * (o.k ?? 1)) / 2) } : {}) };
}
const crumble = (id, x, z, top, w = 2.2, o = {}) => boxDev('crumble', id, 'gummy_platform', x, z, top, w, { delay: o.delay ?? 0.7, respawn: 3 }, { hk: 1, ...o });
const blink = (id, x, z, top, w, on, off, phase, o = {}) => boxDev('blink', id, 'gummy_platform', x, z, top, w, { on, off, phase }, o);
const jelly = (t, id, x, z, top, w, extra = {}, o = {}) => boxDev(t, id, 'jelly_block', x, z, top, w, extra, o);
function turntable(id, x, z, top, R, speed, o = {}) {
  const s = (2 * R) / (SZ.carousel_base[0] * 0.98);
  const d = { t: 'turntable', id, p: [r2(x), r2(top), r2(z)], s: [r2(2 * R), 0.5, r2(2 * R)], radius: r2(R), speed, ...(o.phase ? { phase: o.phase } : {}), model: look('carousel_base', s) };
  devices.push(d);
  surf('carousel', d.p, [r2(R * 1.4), 0.5, r2(R * 1.4)]); // (validator: the disc's inner square)
  return { id, x, z, top: r2(top), r: r2(R) };
}
function tilt(id, x, z, top, w, o = {}) {
  const s = w / SZ.donut_platform[0];
  const k = 0.74;
  const d = { t: 'tilt', id, p: [r2(x), r2(top), r2(z)], r: o.r ?? 0, s: [r2(w * k), 0.45, r2(w * k)], maxAngle: o.maxAngle ?? 12, model: look('donut_platform', s) };
  devices.push(d);
  surf('tilt donut', d.p, d.s, o.r ?? 0);
  return { id, x, z, top: r2(top), r: r2((w * k) / 2) };
}
/** trampoline: a jelly block (or a candy mushroom) whose top throws you back up */
function tramp(id, x, z, top, w, o = {}) {
  const m = o.mushroom ? 'candy_mushroom' : 'jelly_block';
  return boxDev('trampoline', id, m, x, z, top, w, { bounce: o.bounce ?? 0.9, min: o.min ?? 11, max: o.max ?? 24 }, { k: o.mushroom ? 0.7 : 1, ...o });
}
/** updraft: a candy fan on a surface at y, blowing up a column w wide and h high */
function fan(id, x, y, z, w, h, o = {}) {
  devices.push({ t: 'fan', id, p: [r2(x), r2(y), r2(z)], s: [r2(w), r2(h), r2(w)], force: o.force ?? 52, color: o.color ?? '#7be0c3', ...(o.on ? { on: o.on, off: o.off, phase: o.phase ?? 0 } : {}) });
  return { id, x, z, top: y };
}
/** conveyor: a chocolate river segment carrying along its length (local +z = yaw r) */
function river(id, x, z, top, w, r, speed) {
  const s = w / SZ.chocolate_river_segment[0];
  const box = [r2(w), r2(Math.max(0.4, FT.chocolate_river_segment * s)), r2(SZ.chocolate_river_segment[2] * s)];
  const d = { t: 'conveyor', id, p: [r2(x), r2(top), r2(z)], r, s: box, speed, model: look('chocolate_river_segment', s) };
  devices.push(d);
  surf('chocolate river', d.p, box, r);
  const q = (r * Math.PI) / 180;
  return { id, x, z, top: r2(top), hx: Math.abs(Math.cos(q)) * box[0] / 2 + Math.abs(Math.sin(q)) * box[2] / 2, hz: Math.abs(Math.sin(q)) * box[0] / 2 + Math.abs(Math.cos(q)) * box[2] / 2, len: box[2] };
}
/** glossy hard-candy floor: low grip */
function glossy(id, x, z, top, w, d, r = 0, o = {}) {
  const dv = { t: 'slippery', id, p: [r2(x), r2(top), r2(z)], r, s: [r2(w), 0.4, r2(d)], grip: o.grip ?? 0.12, color: o.color ?? '#ff9fd0' };
  devices.push(dv);
  surf('glossy candy', dv.p, dv.s, r);
  return { id, x, z, top: r2(top), hx: r % 180 ? d / 2 : w / 2, hz: r % 180 ? w / 2 : d / 2 };
}
function zipline(id, a, b, speed = 11) { devices.push({ t: 'zipline', id, p: a.map(r2), b: b.map(r2), speed, color: '#e3263a' }); return { a, b }; }
/** elevator: a macaron that rides from `top` up to `topB` when stood on */
function elevator(id, x, z, top, topB, w, o = {}) {
  const r = boxDev('elevator', id, 'macaron_platform', x, z, top, w, { b: [r2(x), r2(topB), r2(z)], speed: o.speed ?? 2.4, wait: o.wait ?? 2 }, { k: 0.72, h: 0.5, round: true });
  B.node([x, topB, z]);
  return { ...r, topB };
}
/** a pressure plate (candy plate) at p driving device `target` (held `hold` s after you step off) */
function plate(id, p, target, hold = 3) {
  const w = 1.6, s = w / SZ.candy_plate[0];
  devices.push({ t: 'plate', id, p: p.map(r2), s: [w, 0.15, w], target, hold, model: look('candy_plate', s) });
  return { id, x: p[0], z: p[2], top: p[1], r: w / 2 };
}
/** a chocolate block piston sliding `stroke` along yaw r (driven by a plate when target given) */
function piston(id, x, z, top, w, r, stroke, o = {}) {
  return boxDev('piston', id, 'chocolate_bar', x, z, top, w, { stroke, period: o.period ?? 4, wait: o.wait ?? 0.8, ...(o.plate ? { target: 'plate' } : {}) }, { r, surf: false, h: 0.6 });
}
function cannon(id, p, yaw, pitch, v) {
  devices.push({ t: 'cannon', id, p: p.map(r2), r: yaw, pitch, v, model: { file: `${A}/candy_cannon`, s: 2.6, off: [0, 0, 0], yaw: 90 } });
  return { id, x: p[0], z: p[2], top: p[1], r: 0.9 };
}
function portal(id, p, r, b, rb, need = 0) { devices.push({ t: 'portal', id, p: p.map(r2), r, b: b.map(r2), rb, color: '#b48cff', ...(need ? { need } : {}) }); }
function sweeper(id, x, y, z, L, speed, arms = 2, o = {}) { devices.push({ t: 'sweeper', id, p: [r2(x), r2(y), r2(z)], radius: L, speed, arms, color: o.color ?? '#e3263a', ...(o.phase ? { phase: o.phase } : {}) }); }
function lowgrav(id, x, y, z, w, h, d, g = 0.45) { devices.push({ t: 'lowgrav', id, p: [r2(x), r2(y), r2(z)], s: [r2(w), r2(h), r2(d)], g }); }
const checkpoint = (id, p, r = 0) => devices.push({ t: 'checkpoint', id, p: p.map(r2), r, color: '#ff5fa2' });
const gem = (id, p) => devices.push({ t: 'collectible', id, p: p.map(r2), color: '#ff7ad9' });

// ---------------------------------------------------------------- movers (moving platforms) wearing the models
const movers = [];
const sweeps = [];
/** a platform floating between a and b (top centres): donut / macaron / cloud look, flat collider box */
function hover(id, a, b, modelId, w, o = {}) {
  const s = w / SZ[modelId][0];
  const k = modelId === 'cotton_candy_cloud' ? 0.32 : 0.36; // collider half size (normalised): the round top's inner square
  const t = 0.5 / s;
  movers.push({ id, kind: 'hover', pts: [a.map(r2), b.map(r2)], speed: o.speed ?? 2.2, wait: o.wait ?? 2.2, phase: o.phase ?? 0, r: 0, s: r2(s),
    model: { file: `${A}/${modelId}`, s: r2(s), off: [0, r2(-FT[modelId]), 0], boxes: [[0, r2(-t / 2), 0, r2(SZ[modelId][0] * k), r2(t / 2), r2(SZ[modelId][2] * k)]] } });
  B.node(a); B.node(b);
  const hx = SZ[modelId][0] * k * s, hz = SZ[modelId][2] * k * s;
  // swept volume, sampled along the path (with the rider's 2 m on top)
  const boxes = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12, p = [a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t]; boxes.push({ x0: p[0] - hx - 0.4, x1: p[0] + hx + 0.4, z0: p[2] - hz - 0.4, z1: p[2] + hz + 0.4 }); }
  sweeps.push({ id, y0: Math.min(a[1], b[1]) - FT[modelId] * s - 0.3, y1: Math.max(a[1], b[1]) + 2.0, boxes, each: true });
  return { A: a, B: b, hx, hz };
}
/** the lollipop arm (rotor): its hub stands at `base` (ground y), the swirl head at the tip is where you stand */
const ARM = { hubX: -0.05, hubZ: 0.68, head: 1.36, walk: 0.85, headR: 0.24 };
function lolliArm(id, base, s, a0, a1, o = {}) {
  const center = [base[0], r2(base[1] + ARM.walk * s), base[2]];
  const arm = r2(ARM.head * s);
  const tip = (a) => { const r = (a * Math.PI) / 180; return [r2(center[0] + arm * Math.sin(r)), center[1], r2(center[2] + arm * Math.cos(r))]; };
  const hr = ARM.headR, t = 0.45 / s;
  movers.push({ id, kind: 'rotor', pts: [tip(a0), tip(a1)], center, arm, off: 0, s: r2(s), a0, a1, speed: o.speed ?? 30, wait: o.wait ?? 2.4, phase: o.phase ?? 0,
    model: { file: `${A}/lollipop_arm`, s: r2(s), off: [r2(-ARM.hubX), -ARM.walk, ARM.hubZ], yaw: 180, boxes: [[0, r2(-t / 2), ARM.head, hr, r2(t / 2), hr], [0, r2(-t / 2 - 0.02), 0.7, 0.06, r2(t / 2), 0.42]] } });
  B.node(tip(a0)); B.node(tip(a1));
  sweeps.push({ id, y0: r2(center[1] - 0.5), y1: r2(center[1] + 2.0), circle: { x: center[0], z: center[2], r: r2(arm + hr * s + 0.4), a0, a1 } });
  return { A: tip(a0), B: tip(a1), center };
}

// ---------------------------------------------------------------- routes, hops
const mark = (p, label, act) => B.mark('main', p.map(r2), label, act);
const P = (rec, dx = 0, dz = 0) => [r2(rec.x + dx), rec.top, r2(rec.z + dz)];
const hops = [];
/** record the edge gap / rise between two records (printed: design check) */
function hop(a, b, label) {
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
  const g = d - ext(a, dx / d, dz / d) - ext(b, dx / d, dz / d), dh = b.top - a.top;
  hops.push(`${label.padEnd(28)} gap ${g.toFixed(2).padStart(6)}  dh ${dh.toFixed(2).padStart(6)}`);
}
/** an alternative route (its own route list for the bot): start mark, pieces, end mark; prints its hops */
function alt(route, start, specs, end, labels = {}) {
  B.mark(route, start.p, start.label ?? 'start', start.act);
  let prev = start.rec ?? { x: start.p[0], z: start.p[2], top: start.p[1], r: 0.6 };
  const out = [];
  for (const [i, sp] of specs.entries()) {
    if (!Array.isArray(sp)) { hop(prev, sp.rec, `${route} ${i + 1}`); B.mark(route, sp.p ?? P(sp.rec), sp.label, sp.act); prev = sp.rec; continue; } // an existing point
    const [id, x, z, top, w, o] = sp;
    const rec = piece(id, x, z, top, w, o ?? {});
    hop(prev, rec, `${route} ${i + 1}`);
    B.mark(route, P(rec), labels[i] ?? `${route} ${i + 1}`);
    prev = rec; out.push(rec);
  }
  if (end) { hop(prev, end.rec ?? { x: end.p[0], z: end.p[2], top: end.p[1], r: 0.6 }, `${route} > end`); B.mark(route, end.p, end.label ?? 'end', end.act); }
  return out;
}
const ladders = [];
const pads = [];
const PADM = { file: `${A}/candy_plate`, w: SZ.candy_plate[0], d: SZ.candy_plate[2], top: FT.candy_plate };
/** jump pad (candy plate) standing on the surface at y, aimed at tg */
function pad(x, y, z, r, v, s, tg) {
  const top = r2(y + PADM.top * s);
  B.kitPiece('solid', [x, top, z], [r2(PADM.w * s * 0.8), r2(PADM.top * s), r2(PADM.d * s * 0.8)], r, { vo: true });
  const d = { t: 'jump', p: [r2(x), top, r2(z)], r, v, s };
  if (tg) d.tg = tg.map(r2);
  pads.push(d);
  return { x, z, top, r: r2((PADM.w * s) / 2) };
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
/** invisible boundary around the whole footprint */
function boundary() {
  const y0 = Y1 - 2, y1 = TOP + 45, yc = (y0 + y1) / 2, hy = (y1 - y0) / 2;
  B.kitPiece('wall', [-60, r2(yc), Z0 - 0.9], [15, r2(hy), 0.5]);
  B.kitPiece('wall', [-60, r2(yc), Z1 + 0.9], [15, r2(hy), 0.5]);
  B.kitPiece('wall', [HALF.W.x0 - 0.9, r2(yc), -10], [0.5, r2(hy), 15.5]);
  B.kitPiece('wall', [HALF.E.x1 + 0.9, r2(yc), -10], [0.5, r2(hy), 15.5]);
}

// =====================================================================================
// ENTRY (520): Map 003's summit gate (-51.4, 520, -2.8) opens south onto a cookie; a wafer bridge leads west under the
// rainbow Sugar Gate onto the first cookie deck.
// =====================================================================================
const ENT = piece('cookie_floor_tile', -51.4, 0.9, Y1, 6.0, { name: 'Sugar Gate cookie' });
const SPAWN = [-51.4, Y1, 0.9];
mark(SPAWN, 'Sugar Gate');
wafer([-54.2, Y1, 0.9], [-60.0, Y1, 0.9], 1.5, { name: 'entry wafer' });
mark([-57.0, Y1, 0.9], 'entry bridge');
void ENT;

// =====================================================================================
// ZONE 1 – SUGAR GATE (520–545, west): donut steps, a wafer bridge, a candy-cane beam, crumbling gummies (low, the
// lesson), giant lollipops, the three-ring cupcake tower, then floating sweets spiralling up to the bridge onto deck 2
// =====================================================================================
deck('deck 1', HALF.W, Y1);
piece('rainbow_gate', -62.2, 0.9, Y1 + FT.rainbow_gate * 5.2 - 0.02, 5.2 * SZ.rainbow_gate[0], { r: 90, name: 'Sugar Gate arch' });
checkpoint('cp1', [-63.4, Y1, 2.4], -90);
B.kitPiece('sign', [-73.7, Y1 + 3.6, -3.0], [4.6, 1.2], 90, { m: 'CANDY KINGDOM|Vương quốc kẹo · 520 → 720 m' });
mark([-61.0, Y1, 0.9], 'deck 1');
const D1 = standing('donut_platform', -64.2, 0.0, Y1, Y1 + 1.0);
const D2 = standing('donut_platform', -66.9, 0.0, Y1, Y1 + 1.9);
const D3 = standing('donut_platform', -70.9, -0.4, Y1, Y1 + 2.8);
hop({ x: -61, z: 0.9, top: Y1, r: 0.3 }, D1, 'deck > D1'); hop(D1, D2, 'D1 > D2'); hop(D2, D3, 'D2 > D3');
mark(P(D1, 0.6), 'donut 1'); mark(P(D2, 0.9), 'donut 2'); mark(P(D3, 1.2, 0.6), 'donut 3');
const C1 = piece('chocolate_bar', -70.9, -8.8, Y1 + 2.8, 2.8, { r: 90 });
wafer([-70.9, D3.top, r2(D3.z - D3.r + 0.5)], [-70.9, D3.top, r2(C1.z + C1.hz - 0.1)], 1.5);
mark([-70.9, D3.top, -5.0], 'wafer bridge'); mark(P(C1), 'chocolate 1');
const C2 = piece('chocolate_bar', -64.4, -8.8, Y1 + 2.8, 2.8, { r: 90 });
cane([r2(C1.x + C1.hx - 0.05), C1.top, -8.8], [r2(C2.x - C2.hx + 0.05), C1.top, -8.8], 0.62);
mark([-67.6, C1.top, -8.8], 'candy cane beam'); mark(P(C2), 'chocolate 2');
const G = [crumble('cr1a', -63.6, -12.4, Y1 + 2.8), crumble('cr1b', -63.6, -15.4, Y1 + 3.1), crumble('cr1c', -63.6, -18.4, Y1 + 3.4)];
hop(C2, G[0], 'C2 > crumble a'); hop(G[0], G[1], 'crumble a > b'); hop(G[1], G[2], 'crumble b > c');
mark(P(G[0]), 'crumble a'); mark(P(G[2]), 'crumble c');
const L1 = standing('lollipop_platform', -66.4, -21.2, Y1, Y1 + 5.4);
hop(G[2], L1, 'crumble c > lollipop 1');
mark(P(L1, 0.8, 0.4), 'lollipop 1');
cupTower(-71.0, -14.6, Y1, 11.0); // landmark: the three-ring cupcake tower (its cream rings are sloped, decoration)
const Z1P = [
  piece('chocolate_bar', -62.8, -22.0, Y1 + 8.0, 2.6, { r: 90 }),
  piece('macaron_platform', -62.2, -18.2, Y1 + 9.8, 2.6),
  piece('jelly_block', -62.6, -14.4, Y1 + 11.6, 2.2),
  piece('macaron_platform', -63.2, -10.4, Y1 + 13.4, 2.6, { r: 40 }),
  piece('chocolate_bar', -64.0, -6.2, Y1 + 15.2, 2.6),
  piece('donut_platform', -67.6, -4.4, Y1 + 17.0, 3.0),
  piece('jelly_block', -71.4, -5.6, Y1 + 18.8, 2.2),
  piece('macaron_platform', -72.2, -9.6, Y1 + 20.6, 2.6),
  piece('chocolate_bar', -68.6, -11.8, Y1 + 22.4, 2.6),
  piece('jelly_block', -65.0, -11.0, Y1 + 23.0, 2.2),
];
hop(L1, Z1P[0], 'lollipop 1 > P1');
Z1P.forEach((p, i) => { if (i) hop(Z1P[i - 1], p, `P${i} > P${i + 1}`); mark(P(p), `float ${i + 1}`); });
// route A (easy): candy stairs up the north-east corner straight to float 1
alt('z1easy', { p: [-61.0, Y1, -8.6], label: 'deck (east)' }, [
  ['chocolate_bar', -61.2, -10.6, Y1 + 1.4, 2.2, { r: 90 }], ['macaron_platform', -61.2, -13.0, Y1 + 2.6, 2.2], ['chocolate_bar', -61.2, -15.4, Y1 + 3.8, 2.2, { r: 90 }],
  ['jelly_block', -61.2, -17.8, Y1 + 5.0, 1.8], ['jelly_block', -60.8, -19.8, Y1 + 6.2, 1.6],
], { p: P(Z1P[0]), rec: Z1P[0], label: 'float 1 (joins the main route)' });
// route C (hard): small sweets up the south-east with long grabs, from chocolate 2 to float 5
alt('z1hard', { p: P(C2), rec: C2, label: 'chocolate 2' }, [
  ['jelly_block', -61.4, -6.6, Y1 + 5.2, 1.4], ['gummy_platform', -61.4, -3.6, Y1 + 7.6, 1.6], ['jelly_block', -63.0, -0.6, Y1 + 10.0, 1.4], ['gummy_platform', -64.8, -3.4, Y1 + 12.4, 1.6],
], { p: P(Z1P[4]), rec: Z1P[4], label: 'float 5 (joins the main route)' });
const EXW1 = { x: -61.6, z: -11.0, top: Y2, hx: 1.6, hz: 0.7 };
wafer([-63.2, Y2, -11.0], [-60.0, Y2, -11.0], 1.4, { name: 'bridge to deck 2' });
hop(Z1P[9], EXW1, 'P10 > bridge');
mark([-62.2, Y2, -11.0], 'bridge to deck 2');
divider(Y1, Y2 - 0.6, [[-0.6, 2.4, Y1 - 1, Y1 + 3.5]]);
B.prefab('gingerbread_house', -72.4, Y1, 2.3, 120, 3.2, { name: 'gingerbread house' });
for (const [x, z, sc, r] of [[-69.6, 3.3, 0.8, 0], [-73.6, -0.6, 0.7, 60], [-65.8, 3.4, 0.9, 140], [-61.2, -2.4, 0.7, 30], [-68.8, -23.2, 0.9, 200], [-73.6, -19.6, 0.8, 90]]) bush(x, z, Y1, sc, r);
for (const [x, z, s] of [[-61.4, -22.8, 2.0], [-73.0, -23.0, 2.6]]) piece('cupcake_small', x, z, Y1 + s * FT.cupcake_small, s * SZ.cupcake_small[0], { name: 'cupcake' });
console.log('zone 1 placed');
let EXIT = [-58.8, Y2, -11.0];

const STAGE = process.env.STAGE ?? 'all';
if (STAGE === 'all' || +STAGE >= 2) {
  // =====================================================================================
  // ZONE 2 – DONUT VALLEY (545–570, east): floating donuts, a turning carousel, two tipping donuts, a flying donut,
  // cupcake towers to climb, twin carousels turning against each other, up and over to deck 3
  // =====================================================================================
  deck('deck 2', HALF.E, Y2);
  mark([-58.8, Y2, -11.0], 'deck 2');
  const N = [
    piece('donut_platform', -56.6, -12.8, Y2 + 1.2, 2.6),
    piece('donut_platform', -53.6, -14.6, Y2 + 2.6, 2.6),
    piece('donut_platform', -50.4, -13.4, Y2 + 4.0, 2.6),
    piece('donut_platform', -48.6, -10.2, Y2 + 5.4, 2.6),
  ];
  hop({ x: -58.8, z: -11.0, top: Y2, r: 0.3 }, N[0], 'deck2 > N1');
  N.forEach((p, i) => { if (i) hop(N[i - 1], p, `N${i} > N${i + 1}`); mark(P(p, 0.7), `floating donut ${i + 1}`); });
  // the carousel: ride it round to the side that faces the next sweet
  const TT1 = turntable('tt2', -51.0, -5.6, Y2 + 6.0, 2.4, 32);
  hop(N[3], TT1, 'N4 > carousel');
  mark([-49.6, TT1.top, -6.8], 'carousel (board)');
  const K1 = piece('jelly_block', -55.4, -1.8, Y2 + 6.4, 2.2);
  hop(TT1, K1, 'carousel > jelly');
  mark([-52.6, TT1.top, -4.4], 'carousel (ride)', 'turn:tt2');
  mark(P(K1), 'jelly');
  // two tipping donuts going north along the west side
  const TL1 = tilt('tl2a', -57.4, -5.4, Y2 + 6.8, 3.0);
  const TL2 = tilt('tl2b', -57.4, -9.2, Y2 + 7.2, 3.0);
  hop(K1, TL1, 'jelly > tilt 1'); hop(TL1, TL2, 'tilt 1 > tilt 2');
  mark(P(TL1), 'tipping donut 1'); mark(P(TL2), 'tipping donut 2');
  const PD = piece('chocolate_bar', -57.2, -13.4, Y2 + 7.6, 2.6, { r: 90 });
  hop(TL2, PD, 'tilt 2 > chocolate');
  mark(P(PD), 'chocolate (flying donut stop)');
  // the flying donut: across the north of the half
  const HDy = Y2 + 7.8;
  const HD = hover('hd2', [-57.4, HDy, -17.6], [-50.4, HDy, -21.0], 'donut_platform', 2.8, { speed: 2.4, wait: 2.4 });
  mark(HD.A, 'flying donut (west)', 'hover:hd2:A'); mark(HD.B, 'flying donut (east)', 'hover:hd2:B');
  B.link(P(PD), HD.A, 'board'); B.link(HD.A, HD.B, 'hover');
  // the cupcake forest below (decoration) and three floating chocolate blocks above it: jump and grab
  cupTower(-47.8, 1.6, Y2, 9.0); // landmark in the corner, out of reach of the route
  const K = [
    piece('chocolate_bar', -48.1, -18.6, Y2 + 10.4, 2.6),
    piece('chocolate_bar', -49.2, -14.6, Y2 + 13.0, 2.6, { r: 90 }),
    piece('chocolate_bar', -52.8, -12.6, Y2 + 15.6, 2.6),
  ];
  hop({ x: HD.B[0], z: HD.B[2], top: HDy, r: 1.0 }, K[0], 'flying donut > block 1');
  B.link(HD.B, P(K[0]), 'alight');
  K.forEach((p, i) => { if (i) hop(K[i - 1], p, `block ${i} > ${i + 1}`); mark(P(p), `chocolate block ${i + 1}`); });
  // twin carousels turning against each other
  const TT2 = turntable('tt2b', -56.0, -15.6, Y2 + 17.2, 2.2, 36);
  const TT3 = turntable('tt2c', -51.6, -19.2, Y2 + 17.2, 2.2, -36);
  hop(K[2], TT2, 'block 3 > carousel A'); hop(TT2, TT3, 'carousel A > B');
  mark([-55.2, TT2.top, -14.2], 'carousel A (board)');
  mark([-54.6, TT2.top, -16.8], 'carousel A (ride)', 'turn:tt2b');
  mark([-52.8, TT3.top, -18.0], 'carousel B');
  const Z2P = [
    piece('macaron_platform', -48.0, -21.6, Y2 + 18.8, 2.6),
    piece('jelly_block', -47.6, -17.8, Y2 + 20.2, 2.2),
    piece('macaron_platform', -48.2, -13.8, Y2 + 21.6, 2.6),
    piece('chocolate_bar', -51.8, -11.0, Y2 + 22.8, 2.6),
    piece('jelly_block', -55.2, -12.4, Y2 + 23.6, 2.2),
    piece('macaron_platform', -57.4, -15.6, Y2 + 24.2, 2.6),
    piece('chocolate_bar', -58.0, -19.2, Y2 + 24.6, 2.4, { r: 90 }),
  ];
  mark([-50.2, TT3.top, -20.2], 'carousel B (ride)', 'turn:tt2c');
  hop(TT3, Z2P[0], 'carousel B > P1');
  Z2P.forEach((p, i) => { if (i) hop(Z2P[i - 1], p, `Z2 P${i} > P${i + 1}`); mark(P(p), `float ${i + 1}`); });
  // route A (easy): half steps between the chocolate blocks (no long grabs)
  alt('z2easy', { p: HD.B, label: 'flying donut (east)', act: 'hover:hd2:B' }, [
    ['jelly_block', -47.0, -22.2, Y2 + 9.1, 2.0], { rec: K[0], label: 'chocolate block 1' },
    ['jelly_block', -46.4, -15.8, Y2 + 11.7, 2.0], { rec: K[1], label: 'chocolate block 2' },
    ['macaron_platform', -50.0, -10.6, Y2 + 14.3, 2.2],
  ], { p: P(K[2]), rec: K[2], label: 'chocolate block 3' });
  // route C (hard): three long grabs from block 3 straight to float 5 (no carousels)
  const Z2H = alt('z2hard', { p: P(K[2]), rec: K[2], label: 'chocolate block 3' }, [
    ['gummy_platform', -55.6, -9.4, Y2 + 18.0, 1.6], ['jelly_block', -58.4, -11.6, Y2 + 20.4, 1.4],
  ], { p: P(Z2P[4]), rec: Z2P[4], label: 'float 5 (joins the main route)' });
  wafer([-57.6, Y3, -21.0], [-60.0, Y3, -21.0], 1.4, { name: 'bridge to deck 3' });
  const EXW2 = { x: -58.8, z: -21.0, top: Y3, hx: 1.2, hz: 0.7 };
  hop(Z2P[6], EXW2, 'P7 > bridge to deck 3');
  mark([-58.8, Y3, -21.0], 'bridge to deck 3');
  divider(Y2, Y3 - 0.6, [[-12.0, -9.2, Y2 - 1, Y2 + 3.5]]);
  piece('cupcake_small', -47.2, 2.4, Y2 + 2.2 * FT.cupcake_small, 2.2 * SZ.cupcake_small[0], { name: 'cupcake' });
  EXIT = [-58.8, Y3, -21.0];
  // secret (zone 2): walk in through the gingerbread house door - a fan inside blows you out of the chimney onto
  // hidden floats along the west edge, which join the hard route (and skip most of the zone)
  const HS2 = house(-57.8, 2.4, Y2, 3.6);
  fan('hf2', -57.8, Y2, 2.4, 1.6, 15.0, { force: 100, color: '#ffb36b' });
  alt('z2secret', { p: HS2.door, label: 'gingerbread house door' }, [
    ['jelly_block', -58.6, -1.0, Y2 + 12.4, 1.8], ['gummy_platform', -58.8, -4.6, Y2 + 14.2, 2.0], ['macaron_platform', -57.8, -8.0, Y2 + 16.0, 2.2],
    { rec: Z2H[0], label: 'hard route gummy (joins)' },
    { rec: Z2H[1], label: 'hard route jelly' },
  ], { p: P(Z2P[4]), rec: Z2P[4], label: 'float 5 (joins the main route)' }, { 0: 'blown out of the chimney' });
  B.routes.z2secret[1].act = 'fan:hf2';
  for (const [x, z, sc, r] of [[-59.4, -0.4, 0.8, 20], [-55.2, 3.6, 0.9, 100], [-47.2, -1.2, 0.8, 0], [-52.4, 3.6, 0.7, 250]]) bush(x, z, Y2, sc, r);
  console.log('zone 2 placed');
}
if (STAGE === 'all' || +STAGE >= 3) {
  // =====================================================================================
  // ZONE 3 – JELLY BOUNCE GARDEN (570–600, west): practice jellies on the deck, a drop onto a jelly that throws you
  // higher than you fell, a chain of floating jellies, blinking gummies, a candy plate pad, a candy fan, up to deck 4
  // =====================================================================================
  deck('deck 3', HALF.W, Y3);
  mark([-61.0, Y3, -21.0], 'deck 3');
  const jt = (w) => r2(FT.jelly_block * (w / SZ.jelly_block[0])); // a jelly standing on a deck: top above the deck
  tramp('t3p1', -71.4, 1.6, Y3 + jt(2.0), 2.0); tramp('t3p2', -68.2, 2.4, Y3 + jt(2.0), 2.0); // practice (off the route)
  const B3 = [
    piece('chocolate_bar', -63.6, -20.2, Y3 + 1.6, 2.4),
    piece('macaron_platform', -66.8, -21.6, Y3 + 3.2, 2.4),
    piece('chocolate_bar', -70.2, -20.4, Y3 + 4.8, 2.4),
    piece('macaron_platform', -72.0, -16.6, Y3 + 7.2, 2.6),
  ];
  hop({ x: -61, z: -21, top: Y3, r: 0.3 }, B3[0], 'deck3 > B1');
  B3.forEach((p, i) => { if (i) hop(B3[i - 1], p, `Z3 B${i} > B${i + 1}`); mark(P(p), i === 3 ? 'high jelly ledge' : `step ${i + 1}`); });
  const T1 = tramp('t3a', -71.8, -12.8, Y3 + jt(2.4), 2.4);
  const H2 = piece('chocolate_bar', -71.0, -8.4, Y3 + 7.0, 2.6, { r: 90 });
  mark(P(H2), 'thrown up by the jelly', 'via:t3a');
  B.link(P(T1), P(H2), 'bounce');
  const TJ = [tramp('t3b', -67.8, -6.4, Y3 + 5.2, 2.2), tramp('t3c', -64.4, -4.4, Y3 + 5.6, 2.2), tramp('t3d', -62.4, -8.0, Y3 + 6.0, 2.2)];

  const H3 = piece('macaron_platform', -63.0, -11.8, Y3 + 7.6, 2.6);
  [T1, ...TJ, H3].forEach((t, i, a) => { if (i > 1) B.link(P(a[i - 1]), P(t), 'bounce'); });
  mark(P(H3), 'after three floating jellies', 'via:t3b,t3c,t3d');
  // blinking gummies: on 2 s, off 1.5 s, each one 0.9 s after the one before
  const BL = [[-65.2, -13.8, 8.4], [-65.0, -17.8, 9.2], [-64.0, -21.4, 10.0], [-61.2, -21.6, 10.8]].map(([x, z, h], i) => blink(`b3${i}`, x, z, Y3 + h, 2.4, 2.0, 1.5, r2((((-0.9 * i) % 3.5) + 3.5) % 3.5)));
  hop(H3, BL[0], 'macaron > blink 1');
  BL.forEach((b, i) => { if (i) hop(BL[i - 1], b, `blink ${i} > ${i + 1}`); mark(P(b), `blinking gummy ${i + 1}`, `blink:${b.id}`); });
  const P31 = piece('chocolate_bar', -61.2, -17.6, Y3 + 13.2, 2.6, { r: 90 });
  hop(BL[3], P31, 'blink 4 > pad block');
  mark(P(P31, 0, 0.6), 'pad block');
  const M31 = piece('chocolate_bar', -62.6, -12.0, Y3 + 21.2, 3.0);
  const J31 = pad(-61.2, P31.top, -17.0, 180, 23, 0.5, P(M31));
  mark([J31.x, J31.top, J31.z], 'candy pad', 'topad');
  mark(P(M31), 'pad landing', 'pad');
  B.link([J31.x, J31.top, J31.z], P(M31), 'pad');
  const M32 = piece('chocolate_bar', -66.4, -11.2, Y3 + 21.2, 3.4);
  fan('f3', -67.2, M32.top, -11.2, 2.2, 9.0, { force: 100 });
  hop(M31, M32, 'pad landing > fan block');
  mark(P(M32, 1.1), 'next to the candy fan');
  const H4 = [
    piece('macaron_platform', -69.6, -8.0, Y3 + 27.0, 2.6),
    piece('jelly_block', -69.2, -3.8, Y3 + 28.0, 2.2),
    piece('chocolate_bar', -65.6, -1.6, Y3 + 28.8, 2.6),
    piece('macaron_platform', -62.8, -0.6, Y3 + 29.4, 2.4),
  ];
  mark(P(H4[0]), 'blown up onto', 'fan:f3');
  B.link(P(M32), P(H4[0]), 'fan');
  H4.forEach((p, i) => { if (i) { hop(H4[i - 1], p, `Z3 top ${i} > ${i + 1}`); mark(P(p), `top float ${i + 1}`); } });
  // route A (easy): walk round the jelly drop on three sweets
  alt('z3easy', { p: P(B3[3]), rec: B3[3], label: 'high jelly ledge' }, [['jelly_block', -69.6, -13.4, Y3 + 7.6, 2.2], ['macaron_platform', -67.0, -10.4, Y3 + 8.0, 2.4]], { p: P(H3), rec: H3, label: 'macaron (joins the main route)' });
  // route C (hard): long grabs round the north-west corner instead of the candy pad and the fan
  alt('z3hard', { p: P(BL[3]), rec: BL[3], label: 'blinking gummy 4', act: `blink:${BL[3].id}` }, [
    ['jelly_block', -64.4, -23.0, Y3 + 13.2, 1.4], ['gummy_platform', -67.6, -22.8, Y3 + 15.6, 1.6], ['jelly_block', -70.8, -21.8, Y3 + 18.0, 1.4],
    ['gummy_platform', -72.8, -18.6, Y3 + 20.4, 1.6], ['jelly_block', -72.8, -15.4, Y3 + 22.8, 1.4], ['gummy_platform', -72.6, -12.4, Y3 + 25.2, 1.6], ['jelly_block', -71.8, -9.0, Y3 + 26.2, 1.4],
  ], { p: P(H4[0]), rec: H4[0], label: 'top float 1 (joins the main route)' });
  wafer([-61.4, Y4, 0.4], [-60.0, Y4, 0.4], 1.4, { name: 'bridge to deck 4' });
  hop(H4[3], { x: -60.7, z: 0.4, top: Y4, hx: 0.7, hz: 0.7 }, 'top float 4 > bridge');
  mark([-60.7, Y4, 0.4], 'bridge to deck 4');
  divider(Y3, Y4 - 0.6, [[-22.6, -19.4, Y3 - 1, Y3 + 3.5]]);
  EXIT = [-59.0, Y4, 0.4];
  for (const [x, z, sc, r] of [[-73.6, 3.4, 0.8, 0], [-61.0, 3.2, 0.9, 80], [-73.4, -23.2, 0.8, 160]]) bush(x, z, Y3, sc, r);
  console.log('zone 3 placed');
}
if (STAGE === 'all' || +STAGE >= 4) {
  // =====================================================================================
  // ZONE 4 – CHOCOLATE RIVER (600–630, east): a chocolate ramp, a glossy floor, rivers that carry you (one against you),
  // a crumbling wafer bridge, a zipline, a rising macaron, up to deck 5
  // =====================================================================================
  deck('deck 4', HALF.E, Y4);
  mark([-59.0, Y4, 0.4], 'deck 4');
  const slS = 5.0;
  B.prefab('chocolate_slope', -54.0, Y4, 0.6, 180, slS, { name: 'chocolate slope' });
  mark([-56.6, r2(Y4 + 2.0), 0.6], 'slope (low)'); mark([-50.6, r2(Y4 + FT.chocolate_slope * slS), 0.6], 'slope top');
  const GL4 = glossy('g4', -48.6, -4.0, Y4 + 4.4, 2.6, 6.0);
  mark([-48.6, GL4.top, -2.0], 'glossy floor'); mark([-48.6, GL4.top, -6.2], 'glossy end');
  const N41 = piece('macaron_platform', -49.0, -9.8, Y4 + 5.0, 2.4);
  hop(GL4, N41, 'glossy > N1'); mark(P(N41), 'macaron N1');
  const R41 = river('r4a', -49.0, -12.9, Y4 + 5.2, 2.4, 180, 3.0);
  const R42 = river('r4b', -49.0, r2(-12.9 - R41.len), Y4 + 5.2, 2.4, 180, 3.0);
  hop(N41, R41, 'N1 > river'); mark([-49.0, R41.top, -12.4], 'river (with you)'); mark([-49.0, R42.top, r2(-12.9 - R41.len - 1.0)], 'river end');
  const N42 = piece('chocolate_bar', -49.2, -21.0, Y4 + 5.4, 2.6);
  hop(R42, N42, 'river > N2'); mark(P(N42), 'N2');
  const R43 = river('r4c', -52.6, -21.8, Y4 + 6.0, 2.4, 90, 2.5);
  const R44 = river('r4d', r2(-52.6 - R43.len), -21.8, Y4 + 6.0, 2.4, 90, 2.5);
  hop(N42, R43, 'N2 > river against'); mark([-52.6, R43.top, -21.8], 'river (against you)'); mark([r2(-52.6 - R43.len - 1.0), R44.top, -21.8], 'river against end');
  const N43 = piece('macaron_platform', -57.8, -17.6, Y4 + 6.8, 2.4);
  hop(R44, N43, 'river against > N3'); mark(P(N43), 'N3');
  const CW = [];
  for (let i = 0; i < 3; i++) CW.push(boxDev('crumble', `cw4${i}`, 'wafer_bridge', -57.8, r2(-14.6 + i * 3.7), Y4 + 6.8, 3.6, { delay: 0.7, respawn: 3 }, { r: 90, name: 'crumbling wafer' }));
  hop(N43, CW[0], 'N3 > wafer 1'); mark([-57.8, CW[0].top, -15.6], 'crumbling wafer bridge'); mark([-57.8, CW[2].top, -6.0], 'wafer bridge end');
  const N44 = piece('chocolate_bar', -57.6, -3.6, Y4 + 8.2, 2.6, { r: 90 });
  hop(CW[2], N44, 'wafer 3 > N4'); mark(P(N44), 'N4');
  const Q4 = [piece('jelly_block', -54.6, -3.0, Y4 + 9.8, 2.2), piece('macaron_platform', -51.8, -0.6, Y4 + 11.4, 2.4), piece('chocolate_bar', -48.6, -2.2, Y4 + 13.0, 2.6, { r: 90 }), piece('jelly_block', -48.2, -6.0, Y4 + 14.6, 2.2)];
  hop(N44, Q4[0], 'N4 > Q1'); Q4.forEach((q, i) => { if (i) hop(Q4[i - 1], q, `Q${i} > Q${i + 1}`); mark(P(q), `Q${i + 1}`); });
  const Z0 = piece('macaron_platform', -49.0, -9.8, Y4 + 16.0, 2.4);
  hop(Q4[3], Z0, 'Q4 > zip start'); mark(P(Z0), 'zipline start');
  const za = [-49.8, r2(Z0.top + 2.3), -11.4], zb = [-55.6, r2(Z0.top - 1.0), -18.4];
  zipline('z4', za, zb, 11);
  const Z1 = piece('chocolate_bar', -57.4, -20.6, r2(zb[1] - 3.2), 2.8, { r: 90 });
  mark(P(Z1), 'zipline landing', 'zip:z4');
  B.link(P(Z0), P(Z1), 'zip');
  const V4 = hover('v4', [-56.4, Z1.top, -16.8], [-56.4, r2(Y4 + 22.6), -16.8], 'macaron_platform', 2.6, { speed: 2.0, wait: 2.4 });
  hop(Z1, { x: -56.4, z: -16.8, top: Z1.top, r: 0.9 }, 'zip landing > rising macaron');
  mark(V4.A, 'rising macaron (bottom)', 'hover:v4:A'); mark(V4.B, 'rising macaron (top)', 'hover:v4:B');
  B.link(P(Z1), V4.A, 'board'); B.link(V4.A, V4.B, 'hover');
  const U4 = [piece('jelly_block', -52.8, -18.0, Y4 + 24.2, 2.2), piece('macaron_platform', -49.4, -15.6, Y4 + 25.8, 2.4), piece('chocolate_bar', -50.6, -11.6, Y4 + 27.4, 2.6), piece('jelly_block', -54.4, -11.0, Y4 + 28.8, 2.2)];
  hop({ x: V4.B[0], z: V4.B[2], top: V4.B[1], r: 0.9 }, U4[0], 'rising macaron > U1');
  B.link(V4.B, P(U4[0]), 'alight');
  U4.forEach((u, i) => { if (i) hop(U4[i - 1], u, `U${i} > U${i + 1}`); mark(P(u), `U${i + 1}`); });
  // route A (easy): stairs along the east edge and over the river, straight onto the rising macaron
  alt('z4easy', { p: P(N42), rec: N42, label: 'N2' }, [
    ['jelly_block', -47.0, -17.8, Y4 + 6.6, 2.0], ['macaron_platform', -46.8, -14.4, Y4 + 7.8, 2.0], ['chocolate_bar', -46.9, -11.0, Y4 + 9.0, 2.2, { r: 90 }],
    ['jelly_block', -50.2, -13.6, Y4 + 10.2, 2.0], ['macaron_platform', -52.8, -14.8, Y4 + 11.4, 2.2],
  ], { p: V4.A, label: 'rising macaron (bottom)', act: 'hover:v4:A' });
  // route C (hard): grabs up the east edge from the last jelly before the zipline to U2
  alt('z4hard', { p: P(Q4[3]), rec: Q4[3], label: 'Q4' }, [
    ['jelly_block', -46.8, -9.2, Y4 + 17.0, 1.4], ['gummy_platform', -46.8, -12.4, Y4 + 19.4, 1.6], ['jelly_block', -47.0, -15.4, Y4 + 21.8, 1.4],
  ], { p: P(U4[1]), rec: U4[1], label: 'U2 (joins the main route)' });
  wafer([-57.0, Y5, -11.6], [-60.0, Y5, -11.6], 1.4, { name: 'bridge to deck 5' });
  hop(U4[3], { x: -58.5, z: -11.6, top: Y5, hx: 1.5, hz: 0.7 }, 'U4 > bridge');
  mark([-58.2, Y5, -11.6], 'bridge to deck 5');
  divider(Y4, Y5 - 0.6, [[-0.8, 1.6, Y4 - 1, Y4 + 3.5]]);
  EXIT = [-61.0, Y5, -11.6];
  // secret (zone 4): the chocolate waterfall under the jellies is only chocolate - walk through the curtain and the
  // updraft hidden inside lifts you past the rivers and the crumbling wafers onto Q1
  deco('choco_waterfall_wall', -55.4, -6.6, Y4, 6.5, -90);
  fan('wf4', -55.4, Y4, -6.6, 2.4, 13.0, { force: 100, color: '#c98a47' });
  B.mark('z4secret', [-58.6, Y4, -6.6], 'in front of the chocolate waterfall');
  B.mark('z4secret', P(Q4[0]), 'Q1 (joins the main route)', 'fan:wf4');
  for (const [x, z, sc, r] of [[-56.9, -9.2, 0.8, 0], [-56.8, -4.0, 0.7, 70], [-46.8, 3.2, 0.9, 150], [-58.8, 3.4, 0.8, 300]]) bush(x, z, Y4, sc, r);
  console.log('zone 4 placed');
}
if (STAGE === 'all' || +STAGE >= 5) {
  // =====================================================================================
  // ZONE 5 – LOLLIPOP CAROUSEL (630–660, west): a big carousel with candy-cane bars sweeping over it, a lollipop arm,
  // two drifting macarons, a macaron elevator, a high lollipop arm, sweets up to deck 6
  // =====================================================================================
  deck('deck 5', HALF.W, Y5);
  mark([-61.0, Y5, -11.6], 'deck 5');
  const S5 = [piece('jelly_block', -62.6, -15.4, Y5 + 1.6, 2.2), piece('macaron_platform', -63.4, -19.4, Y5 + 3.2, 2.4), piece('chocolate_bar', -67.0, -19.8, Y5 + 4.8, 2.6)];
  hop({ x: -61, z: -11.6, top: Y5, r: 0.3 }, S5[0], 'deck5 > S1');
  S5.forEach((p, i) => { if (i) hop(S5[i - 1], p, `Z5 S${i} > S${i + 1}`); mark(P(p), `step ${i + 1}`); });
  const CAR = turntable('car5', -67.0, -12.8, Y5 + 5.6, 4.4, 18);
  sweeper('sw5', -67.0, CAR.top, -12.8, 4.2, -48, 2);
  hop(S5[2], CAR, 'S3 > carousel');
  mark([-67.0, CAR.top, -16.6], 'carousel (board)');
  mark([-70.4, CAR.top, -12.8], 'carousel (west)', 'turn:car5');
  const W51 = piece('macaron_platform', -70.8, -7.1, Y5 + 8.0, 2.4);
  hop(CAR, W51, 'carousel > W1');
  mark(P(W51), 'arm stop');
  // lollipop arm: its hub stands on a chocolate block, the swirl head carries you round the south of the half
  const a5s = 4.2, a5walk = Y5 + 8.0, a5hub = [-67.0, r2(a5walk - ARM.walk * a5s), -2.6];
  piece('chocolate_bar', a5hub[0], a5hub[2], a5hub[1], 2.4, { name: 'arm pedestal' });
  const R5 = lolliArm('arm5', a5hub, a5s, -110, 50, { speed: 30, wait: 2.6 });
  mark(R5.A, 'lollipop arm (west)', 'rotor:arm5:A'); mark(R5.B, 'lollipop arm (east)', 'rotor:arm5:B');
  B.link(P(W51), R5.A, 'board'); B.link(R5.A, R5.B, 'rotor');
  const W52 = piece('macaron_platform', -61.2, -2.0, Y5 + 8.0, 2.4);
  B.link(R5.B, P(W52), 'alight');
  mark(P(W52), 'after the arm');
  // two drifting macarons, one after the other
  const HM1 = hover('hm5a', [-61.0, Y5 + 8.0, -4.3], [-61.0, Y5 + 8.0, -19.0], 'macaron_platform', 2.4, { speed: 2.6, wait: 2.2 });
  mark(HM1.A, 'drifting macaron 1', 'hover:hm5a:A'); mark(HM1.B, 'drifting macaron 1 (north)', 'hover:hm5a:B');
  B.link(P(W52), HM1.A, 'board'); B.link(HM1.A, HM1.B, 'hover');
  const W53 = piece('chocolate_bar', -62.0, -22.6, Y5 + 8.8, 2.6);
  B.link(HM1.B, P(W53), 'alight'); mark(P(W53), 'macaron stop');
  const HM2 = hover('hm5b', [-65.6, Y5 + 9.4, -22.6], [-70.6, Y5 + 9.4, -22.6], 'macaron_platform', 2.4, { speed: 2.0, wait: 2.2, phase: 1.3 });
  mark(HM2.A, 'drifting macaron 2', 'hover:hm5b:A'); mark(HM2.B, 'drifting macaron 2 (west)', 'hover:hm5b:B');
  B.link(P(W53), HM2.A, 'board'); B.link(HM2.A, HM2.B, 'hover');
  // the macaron elevator: stand on it and it rises
  const EL = elevator('el5', -72.4, -20.2, Y5 + 9.8, Y5 + 18.6, 2.6, { speed: 2.4, wait: 2.2 });
  B.link(HM2.B, P(EL), 'alight');
  mark(P(EL), 'macaron elevator');
  mark([EL.x, EL.topB, EL.z], 'elevator top', 'elev:el5');
  B.link(P(EL), [EL.x, EL.topB, EL.z], 'elevator');
  // the high lollipop arm on a floating chocolate pedestal
  const a6s = 4.2, a6walk = Y5 + 19.4, a6hub = [-67.0, r2(a6walk - ARM.walk * a6s), -14.0];
  piece('chocolate_bar', a6hub[0], a6hub[2], a6hub[1], 2.4, { name: 'arm pedestal' });
  const R6 = lolliArm('arm5b', a6hub, a6s, -115, 40, { speed: 30, wait: 2.6, phase: 1.0 });
  mark(R6.A, 'high arm (west)', 'rotor:arm5b:A'); mark(R6.B, 'high arm (east)', 'rotor:arm5b:B');
  B.link([EL.x, EL.topB, EL.z], R6.A, 'board'); B.link(R6.A, R6.B, 'rotor');
  const W56 = piece('macaron_platform', -61.2, -12.4, a6walk, 2.4);
  B.link(R6.B, P(W56), 'alight'); mark(P(W56), 'after the high arm');
  const F5 = [piece('jelly_block', -61.4, -15.8, Y5 + 21.0, 2.2), piece('chocolate_bar', -63.8, -18.8, Y5 + 22.6, 2.6), piece('macaron_platform', -67.4, -20.4, Y5 + 24.2, 2.4),
    piece('jelly_block', -71.0, -18.8, Y5 + 25.8, 2.2), piece('chocolate_bar', -71.6, -14.8, Y5 + 27.4, 2.6, { r: 90 }), piece('macaron_platform', -68.6, -12.4, Y5 + 28.8, 2.4),
    piece('jelly_block', -65.0, -14.6, Y5 + 29.6, 2.2), piece('chocolate_bar', -62.6, -19.0, Y5 + 29.6, 2.6, { r: 90 })];
  hop(W56, F5[0], 'arm stop > F1');
  F5.forEach((p, i) => { if (i) hop(F5[i - 1], p, `Z5 F${i} > F${i + 1}`); mark(P(p), `top float ${i + 1}`); });
  // route A (easy): round the carousel and the first arm on three sweets
  alt('z5easy', { p: P(S5[2]), rec: S5[2], label: 'step 3' }, [['jelly_block', -65.6, -23.0, Y5 + 6.0, 2.0], ['macaron_platform', -63.6, -19.6, Y5 + 7.4, 2.2]], { p: P(W53), rec: W53, label: 'macaron stop (joins the main route)' });
  // route C (hard): grabs up the south and west edges, skipping the macarons, the elevator and the high arm
  alt('z5hard', { p: P(W52), rec: W52, label: 'after the arm' }, [
    ['jelly_block', -61.6, 1.6, Y5 + 11.6, 1.4], ['gummy_platform', -64.6, 2.2, Y5 + 13.6, 1.6], ['jelly_block', -67.8, 1.4, Y5 + 15.6, 1.4], ['gummy_platform', -70.8, 0.0, Y5 + 17.6, 1.6],
    ['jelly_block', -72.6, -3.2, Y5 + 20.0, 1.4], ['gummy_platform', -72.8, -6.4, Y5 + 22.4, 1.6], ['jelly_block', -72.6, -9.4, Y5 + 24.8, 1.4], ['jelly_block', -72.6, -12.4, Y5 + 26.0, 1.4],
  ], { p: P(F5[4]), rec: F5[4], label: 'top float 5 (joins the main route)' });
  wafer([-61.6, Y6, -21.0], [-60.0, Y6, -21.0], 1.4, { name: 'bridge to deck 6' });
  hop(F5[7], { x: -61.3, z: -21.0, top: Y6, hx: 1.3, hz: 0.7 }, 'F8 > bridge');
  mark([-61.4, Y6, -21.0], 'bridge to deck 6');
  divider(Y5, Y6 - 0.6, [[-13.0, -10.2, Y5 - 1, Y5 + 3.5]]);
  EXIT = [-59.0, Y6, -21.0];
  for (const [x, z, sc, r] of [[-73.6, 3.4, 0.9, 40], [-61.2, 3.4, 0.8, 120], [-61.0, -23.4, 0.8, 200]]) bush(x, z, Y5, sc, r);
  console.log('zone 5 placed');
}
if (STAGE === 'all' || +STAGE >= 6) {
  // =====================================================================================
  // ZONE 6 – GUMMY SKY CHALLENGE (660–690, east): a crumbling gummy run that ends in a fall onto a jelly, a glossy
  // slide and a long jump, a low-gravity cloud field with drifting clouds, a one-way jelly, sweet gems off the route
  // =====================================================================================
  deck('deck 6', HALF.E, Y6);
  mark([-59.0, Y6, -21.0], 'deck 6');
  checkpoint('cp6', [-57.6, Y6, -22.4], 90);
  const K6 = [piece('chocolate_bar', -56.2, -18.4, Y6 + 1.6, 2.4), piece('macaron_platform', -53.0, -20.6, Y6 + 3.2, 2.4), piece('chocolate_bar', -49.6, -21.4, Y6 + 4.8, 2.4)];
  hop({ x: -59, z: -21, top: Y6, r: 0.3 }, K6[0], 'deck6 > K1');
  K6.forEach((p, i) => { if (i) hop(K6[i - 1], p, `Z6 K${i} > K${i + 1}`); mark(P(p), `K${i + 1}`); });
  const G6 = [0, 1, 2, 3, 4].map((i) => crumble(`cr6${i}`, -48.4, r2(-17.6 + 3.0 * i), Y6 + 5.6 + 0.4 * i, 2.0, { delay: 0.6 }));
  hop(K6[2], G6[0], 'K3 > crumble 1');
  G6.forEach((g, i) => { if (i) hop(G6[i - 1], g, `crumble ${i} > ${i + 1}`); });
  mark(P(G6[0]), 'crumbling gummies'); mark(P(G6[4]), 'last gummy');
  const T6 = tramp('t6', -48.8, -1.6, Y6 + r2(FT.jelly_block * (2.4 / SZ.jelly_block[0])), 2.4);
  const U61 = piece('macaron_platform', -52.6, -0.6, Y6 + 7.6, 2.4);
  mark(P(U61), 'thrown up by the jelly', 'via:t6');
  B.link(P(G6[4]), P(T6), 'drop'); B.link(P(T6), P(U61), 'bounce');
  const GL6 = glossy('g6', -56.0, -3.6, Y6 + 8.0, 2.4, 5.0);
  hop(U61, GL6, 'U1 > glossy');
  mark([-56.0, GL6.top, -1.8], 'glossy candy'); mark([-56.0, GL6.top, -5.6], 'glossy end');
  const V61 = piece('chocolate_bar', -56.2, -10.0, Y6 + 8.4, 2.6);
  hop(GL6, V61, 'glossy > long jump');
  mark(P(V61), 'over the gap');
  // low gravity over the north-west: long, floaty jumps between clouds
  lowgrav('lg6', -52.6, Y6 + 8.0, -17.4, 13.0, 15.0, 13.0, 0.45);
  const L61 = piece('jelly_block', -55.8, -16.4, Y6 + 10.4, 2.2);
  hop(V61, L61, 'low-g jump 1');
  B.link(P(V61), P(L61), 'low gravity jump');
  mark(P(L61), 'low gravity 1');
  const CL1 = hover('cl6a', [-52.4, Y6 + 11.4, -17.4], [-52.4, Y6 + 11.4, -22.0], 'cotton_candy_cloud', 3.0, { speed: 1.6, wait: 2.6 });
  mark(CL1.A, 'cloud 1', 'hover:cl6a:A'); mark(CL1.B, 'cloud 1 (north)', 'hover:cl6a:B');
  B.link(P(L61), CL1.A, 'board'); B.link(CL1.A, CL1.B, 'hover');
  const L62 = piece('macaron_platform', -47.8, -22.0, Y6 + 13.0, 2.4);
  B.link(CL1.B, P(L62), 'alight'); mark(P(L62), 'low gravity 2');
  const CL2 = hover('cl6b', [-47.8, Y6 + 13.6, -17.4], [-47.8, Y6 + 17.6, -12.6], 'cotton_candy_cloud', 3.0, { speed: 1.6, wait: 2.6 });
  mark(CL2.A, 'cloud 2', 'hover:cl6b:A'); mark(CL2.B, 'cloud 2 (up)', 'hover:cl6b:B');
  B.link(P(L62), CL2.A, 'board'); B.link(CL2.A, CL2.B, 'hover');
  const L63 = piece('chocolate_bar', -51.8, -11.6, Y6 + 19.0, 2.6);
  B.link(CL2.B, P(L63), 'alight'); mark(P(L63, 0.6), 'under the one-way jelly');
  const OW = jelly('oneway', 'ow6', -53.6, -11.6, Y6 + 21.4, 2.2, {}, { h: 0.5 });
  mark([-52.6, OW.top, -11.6], 'one-way jelly (jump up through)');
  const L65 = [piece('macaron_platform', -55.6, -10.2, Y6 + 23.0, 2.4), piece('jelly_block', -57.6, -6.6, Y6 + 24.6, 2.2), piece('chocolate_bar', -55.0, -3.4, Y6 + 26.2, 2.6), piece('macaron_platform', -51.6, -1.4, Y6 + 27.8, 2.4), piece('jelly_block', -55.4, 0.6, Y6 + 29.0, 2.2)];
  hop(OW, L65[0], 'one-way > L5');
  L65.forEach((p, i) => { if (i) hop(L65[i - 1], p, `Z6 top ${i} > ${i + 1}`); mark(P(p), `top float ${i + 1}`); });
  // sweet gems (five in zones 6–7 open the castle portal): off the route, a little harder
  const gemA = piece('gummy_platform', -46.8, -6.4, Y6 + 9.2, 1.8); gem('gem1', [-46.8, Y6 + 9.2, -6.4]); void gemA;
  gem('gem2', [-47.8, Y6 + 18.4, -10.0]);
  const gemC = piece('jelly_block', -58.6, -1.0, Y6 + 27.4, 1.8); gem('gem3', [-58.6, Y6 + 27.4, -1.0]); void gemC;
  // route A (easy): steps down the west side straight to the long jump (no crumbling run, no drop)
  alt('z6easy', { p: P(K6[1]), rec: K6[1], label: 'K2' }, [['jelly_block', -55.2, -17.6, Y6 + 4.4, 2.0], ['macaron_platform', -57.8, -14.8, Y6 + 5.6, 2.2], ['chocolate_bar', -58.6, -11.6, Y6 + 6.8, 2.2, { r: 90 }]], { p: P(V61), rec: V61, label: 'over the gap (joins the main route)' });
  // route C (hard): two huge low-gravity leaps instead of the clouds
  alt('z6hard', { p: P(L61), rec: L61, label: 'low gravity 1' }, [['gummy_platform', -50.4, -14.6, Y6 + 13.4, 1.4], ['gummy_platform', -48.8, -9.2, Y6 + 16.4, 1.4]], { p: P(L63, 0.6), rec: L63, label: 'under the one-way jelly (joins)' });
  wafer([-57.6, Y7, 0.4], [-60.0, Y7, 0.4], 1.4, { name: 'bridge to deck 7' });
  hop(L65[4], { x: -59.2, z: 0.4, top: Y7, hx: 0.8, hz: 0.7 }, 'top float 5 > bridge');
  mark([-59.0, Y7, 0.4], 'bridge to deck 7');
  divider(Y6, Y7 - 0.6, [[-22.4, -19.6, Y6 - 1, Y6 + 3.5]]);
  EXIT = [-61.0, Y7, 0.4];
  for (const [x, z, sc, r] of [[-46.8, 3.4, 0.9, 10], [-58.6, -23.4, 0.8, 90], [-46.8, -23.4, 0.7, 210]]) bush(x, z, Y6, sc, r);
  console.log('zone 6 placed');
}
if (STAGE === 'all' || +STAGE >= 7) {
  // =====================================================================================
  // ZONE 7 – CANDY CASTLE (690–720, west): climb the castle wall, a candy plate that slides out a chocolate bridge, the
  // candy cannon onto the rampart, a crumbling wafer bridge under a sweeping candy cane, macaron steps round the keep,
  // the gem portal (shortcut), the rainbow gate to Map 005 on top
  // =====================================================================================
  deck('deck 7', HALF.W, Y7);
  mark([-61.0, Y7, 0.4], 'deck 7');
  checkpoint('cp7', [-62.4, Y7, 2.2], -90);
  // the keep (landmark) and corner towers
  B.prefab('castle_main_tower', -69.4, Y7, -18.6, 180, 12.0, { name: 'castle keep' });
  B.prefab('castle_tower_corner', -72.0, Y7, 1.6, 0, 7.0, { name: 'corner tower' });
  B.prefab('castle_tower_corner', -61.8, Y7, -22.2, 0, 6.0, { name: 'corner tower' });
  // castle walls round the courtyard (scenery: their crenellated tops are no walkway)
  for (const z of [-3.6, -10.0]) B.prefab('castle_wall', -73.4, Y7, z, 90, 5.0, { name: 'castle wall' });
  // steps up to the plate ledge; the candy plate slides a wafer bridge out across a gap you cannot jump
  const S7 = [piece('jelly_block', -62.8, -2.6, Y7 + 2.0, 2.2), piece('macaron_platform', -63.0, -6.4, Y7 + 3.8, 2.4)];
  hop({ x: -61, z: 0.4, top: Y7, r: 0.3 }, S7[0], 'deck7 > S1'); hop(S7[0], S7[1], 'Z7 S1 > S2');
  S7.forEach((p, i) => mark(P(p), `courtyard step ${i + 1}`));
  const L71 = piece('chocolate_bar', -63.4, -11.2, Y7 + 6.0, 4.4, { r: 90 }); // 3.5 wide (x), 4.4 long (z)
  hop(S7[1], L71, 'S2 > plate ledge');
  const PL7 = plate('pl7', [-63.4, r2(L71.top + 0.02), -9.8], 'pi7', 3.5);
  mark([-63.4, L71.top, -10.4], 'candy plate', 'plate:pl7');
  const wbS = 0.8, wbL = SZ.wafer_bridge[0] * wbS, wbW = SZ.wafer_bridge[2] * wbS, G7 = 4.0;
  const pc = r2(L71.z - L71.hz + wbL / 2 + 0.1); // retracted: inside the ledge
  devices.push({ t: 'piston', id: 'pi7', p: [-63.4, r2(L71.top), pc], r: 180, s: [r2(wbW), 0.6, r2(wbL)], stroke: G7, target: 'plate', model: { file: `${A}/wafer_bridge`, s: wbS, off: [0, r2(-FT.wafer_bridge), 0], yaw: 90 } });
  const L72 = piece('chocolate_bar', -63.4, r2(L71.z - L71.hz - G7 - 1.3), Y7 + 6.0, 2.6, { r: 90 });
  mark(P(L72), 'across the slid-out bridge', 'piston');
  B.link([-63.4, L71.top, -10.4], P(L72), 'piston'); void PL7;
  // route C (hard): a candy-cane beam beside the bridge gap (balance instead of the plate)
  cane([-61.2, L71.top, r2(L71.z - L71.hz + 0.3)], [-61.2, L71.top, r2(L72.z + L72.hz - 0.3)], 0.42, { name: 'balance cane' });
  B.mark('z7hard', [-61.6, L71.top, r2(L71.z - L71.hz + 0.6)], 'plate ledge (north-east)'); B.mark('z7hard', [-61.2, L71.top, r2((L71.z - L71.hz + L72.z + L72.hz) / 2)], 'balance cane'); B.mark('z7hard', [-62.4, L72.top, r2(L72.z + L72.hz - 0.8)], 'across');
  // the candy cannon on that ledge shoots you up onto the rampart
  const CN = cannon('cn7', [-63.4, L72.top, r2(L72.z - 0.6)], -35.4, 65, 27);
  const RM1 = piece('chocolate_bar', -71.0, -8.6, Y7 + 13.6, 3.0, { r: 90 });
  mark(P(RM1), 'rampart', 'cannon:cn7');
  B.link([-63.4, L72.top, r2(L72.z - 0.4)], P(RM1), 'cannon'); void CN;
  // crumbling wafers to the next tower top, a candy cane sweeping across them
  const CR7 = [0, 1].map((i) => boxDev('crumble', `cw7${i}`, 'wafer_bridge', -71.0, r2(-5.4 + i * 3.3), Y7 + 13.6, 3.2, { delay: 0.7, respawn: 3 }, { r: 90, name: 'crumbling wafer' }));
  sweeper('sw7', -71.0, Y7 + 13.6, -3.8, 3.0, 70, 1);
  const RM2 = piece('macaron_platform', -70.8, 1.4, Y7 + 14.2, 2.6);
  mark([-71.0, Y7 + 13.6, -6.0], 'crumbling wafers'); mark(P(RM2), 'tower top', 'sweep:sw7');
  void CR7;
  // secret: a candy fan hidden in the corner behind the corner tower lifts you to a hidden ledge next to the tower top
  fan('f7', -73.2, Y7, -0.9, 1.8, 14.0, { force: 100, color: '#ff9fd0' });
  for (const [x, z, sc, r] of [[-72.0, 0.4, 0.9, 30], [-72.2, -2.4, 0.8, 200], [-73.6, 1.4, 0.7, 120]]) bush(x, z, Y7, sc, r);
  const SEC7 = piece('jelly_block', -73.0, -3.0, Y7 + 10.6, 1.6, { name: 'secret ledge' });
  gem('gem6', [-73.0, SEC7.top, -3.0]);
  B.mark('z7secret', [-71.4, Y7, -1.4], 'behind the corner tower');
  B.mark('z7secret', P(SEC7), 'secret ledge', 'fan:f7');
  B.mark('z7secret', P(RM2), 'tower top (joins the main route)');
  // macaron steps round the keep to the summit
  const SP = [[-67.2, 2.0, 15.8], [-63.4, -0.4, 17.4], [-62.0, -4.4, 19.0], [-62.4, -8.4, 20.6], [-64.4, -12.0, 22.2], [-62.8, -15.8, 23.8], [-65.4, -18.8, 25.4], [-66.0, -14.6, 27.0], [-68.6, -11.6, 28.4]]
    .map(([x, z, h], i) => piece(i % 3 === 1 ? 'macaron_platform' : i % 3 === 2 ? 'jelly_block' : 'macaron_platform', x, z, Y7 + h, i % 3 === 2 ? 2.2 : 2.4, { r: i * 40 }));
  hop(RM2, SP[0], 'tower top > spiral 1');
  SP.forEach((p, i) => { if (i) hop(SP[i - 1], p, `spiral ${i} > ${i + 1}`); mark(P(p), `spiral step ${i + 1}`); });
  // the summit: a cookie with the rainbow gate (the way on to Map 005)
  const SUM = piece('cookie_floor_tile', -68.6, -6.6, TOP, 6.4, { name: 'summit cookie' });
  hop(SP[8], SUM, 'spiral 9 > summit');
  piece('rainbow_gate', -68.6, -4.6, TOP + FT.rainbow_gate * 6.0 - 0.02, 6.0 * SZ.rainbow_gate[0], { name: 'rainbow gate' });
  mark([-68.6, TOP, -7.4], 'SUMMIT');
  // gems in the castle, and the gem portal: from the courtyard straight up to the spiral (needs all five)
  gem('gem4', [-72.0, Y7 + 7.2, 1.6]);
  gem('gem5', [-61.8, Y7 + 6.2, -22.2]);
  portal('pt7', [-62.4, Y7, -6.0], 0, [-62.4, Y7 + 19.0, -4.4], 180, 5);
  B.mark('portal', [-62.4, Y7, -8.2], 'in front of the portal (needs 5 gems)');
  B.mark('portal', [-62.4, Y7 + 19.0, -4.4], 'portal exit (spiral)');
  divider(Y7, TOP - 0.6, [[-1.0, 1.8, Y7 - 1, Y7 + 3.5]]);
  EXIT = [-68.6, TOP, -6.0];
  console.log('zone 7 placed');
}
boundary();
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
      const g = o.g, c = Math.cos((o.r * Math.PI) / 180), sn = Math.sin((o.r * Math.PI) / 180);
      const xs = [], zs = [];
      for (const [lx, lz] of [[g.minx, g.minz], [g.maxx, g.minz], [g.minx, g.maxz], [g.maxx, g.maxz]]) { xs.push(o.x + (lx * c + lz * sn) * o.s); zs.push(o.z + (-lx * sn + lz * c) * o.s); }
      return [{ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0: o.y, y1: o.y + o.s }];
    }
    return (o.boxes ?? []).map((b) => { const r = ((o.r ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r)); const hx = b.h[0] * c + b.h[2] * sn, hz = b.h[0] * sn + b.h[2] * c; return { x0: b.c[0] - hx, x1: b.c[0] + hx, z0: b.c[2] - hz, z1: b.c[2] + hz, y0: b.c[1] - b.h[1], y1: b.c[1] + b.h[1] }; });
  };
  const hits = [];
  for (const sw of sweeps) {
    const reg = sw.boxes && !sw.each ? { x0: Math.min(...sw.boxes.map((b) => b.x0)), x1: Math.max(...sw.boxes.map((b) => b.x1)), z0: Math.min(...sw.boxes.map((b) => b.z0)), z1: Math.max(...sw.boxes.map((b) => b.z1)) } : null;
    for (const o of B.objects) for (const b of objBoxes(o)) {
      if (b.y1 <= sw.y0 + 0.05 || b.y0 >= sw.y1 - 0.05) continue;
      let hit = false;
      if (sw.each) hit = sw.boxes.some((q) => b.x0 < q.x1 - 0.05 && b.x1 > q.x0 + 0.05 && b.z0 < q.z1 - 0.05 && b.z1 > q.z0 + 0.05);
      else if (reg) hit = b.x0 < reg.x1 - 0.05 && b.x1 > reg.x0 + 0.05 && b.z0 < reg.z1 - 0.05 && b.z1 > reg.z0 + 0.05;
      else {
        const { x, z, r, a0, a1 } = sw.circle, lo = Math.min(a0, a1) - 12, hi = Math.max(a0, a1) + 12;
        for (let i = 0; i <= 6 && !hit; i++) for (let j = 0; j <= 6 && !hit; j++) {
          const px = b.x0 + ((b.x1 - b.x0) * i) / 6, pz = b.z0 + ((b.z1 - b.z0) * j) / 6, d = Math.hypot(px - x, pz - z);
          if (d > r || d < 1.2) continue;
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
await plotMap(B, val, new URL('./out/map004_plan.png', import.meta.url).pathname, { cx: C4.x, cz: C4.z, r: 24, y0: Y1 - 5, y1: TOP + 5 });
if (process.env.ZPLOT) {
  const bands = [[HALF.W, Y1, Y2], [HALF.E, Y2, Y3], [HALF.W, Y3, Y4], [HALF.E, Y4, Y5], [HALF.W, Y5, Y6], [HALF.E, Y6, Y7], [HALF.W, Y7, TOP]];
  for (const [i, [H, a, b]] of bands.entries()) await zonePlot(B, `/tmp/zone${i + 1}.png`, { x0: H.x0 - 1, x1: H.x1 + 1, z0: Z0 - 1, z1: Z1 + 1, y0: a, y1: b + 1, routes: B.routes, title: `zone ${i + 1}: ${a}–${b}` });
}
console.log('route points', JSON.stringify(Object.fromEntries(Object.entries(B.routes).map(([k, v]) => [k, v.length]))));
if (process.env.NOWRITE) process.exit(0);
const zones = [
  { id: 'A', name: 'Cổng Đường', y0: 518, y1: 545, color: '#ff8fc0' },
  { id: 'B', name: 'Thung Lũng Donut', y0: 545, y1: 570, color: '#ffd166' },
  { id: 'C', name: 'Vườn Thạch Nảy', y0: 570, y1: 600, color: '#7be0c3' },
  { id: 'D', name: 'Dòng Sông Sô-cô-la', y0: 600, y1: 630, color: '#c98a47' },
  { id: 'E', name: 'Vòng Quay Kẹo Mút', y0: 630, y1: 660, color: '#ff5f7a' },
  { id: 'F', name: 'Thử Thách Kẹo Dẻo', y0: 660, y1: 690, color: '#b48cff' },
  { id: 'G', name: 'Lâu Đài Kẹo', y0: 690, y1: 725, color: '#ffffff' },
];
const data = B.toJSON({
  id: 'map004', name: 'Candy Kingdom', version: 1, height: TOP - Y1, origin: [0, Y1, 0],
  spawn: { p: SPAWN, yaw: -Math.PI / 2 },
  exit: { p: EXIT, r: 2.6, next: 'map005', label: 'Map 005', gate: { p: [EXIT[0], EXIT[1], r2(EXIT[2] + 1.6)], yaw: 0, w: 4.4, h: 4.2 } },
  finishHint: 'Gợi ý: Candy Kingdom có những lối bí mật – ngọc kẹo mở cổng tắt ở lâu đài, và đừng ngại bước vào những thứ trông như không thể đi xuyên qua…',
  challengeTime: 1500,
  zones, milestones: [540, 560, 580, 600, 620, 640, 660, 680, 700, 720],
  region: { c: [C4.x, C4.z], r: RING },
  terrain: { style: 'none', radius: RING, center: [C4.x, Y1 + 20, C4.z], wallTop: TOP + 40 - (Y1 + 20), plazas: [], paths: [] },
  movers, pads, rings: [], ladders, devices, padModel: PADM,
  prefabFiles: Object.fromEntries([...new Set(B.prefabs.map((p) => p.id))].map((id) => [id, `${A}/${id}`])),
  waypoints: makeWaypoints(B.routes, zones),
});
fs.mkdirSync(`${ROOT}packs/map004/maps`, { recursive: true });
// ---------------------------------------------------------------- ambient scenery (the artist's 10 PNGs + a bubble)
// still backdrops far out, bobbing islands, clouds and balloons drifting past, candies circling, bubbles rising, birds
{
  let seed = 4004;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const R = (a, b) => a + (b - a) * rnd();
  const at = (r, a, y) => [r2(C4.x + Math.cos(a) * r), r2(y), r2(C4.z + Math.sin(a) * r)];
  const S = [];
  // far away: castles and rainbows (still)
  for (const [n, a, r, y, h] of [['castle_far', 0.5, 175, 585, 70], ['castle_far', 2.7, 190, 640, 80], ['castle_far', 4.6, 170, 545, 60], ['rainbow', 1.5, 160, 610, 55], ['rainbow', 3.9, 165, 680, 60], ['rainbow', 5.6, 150, 560, 45]]) S.push({ n, p: at(r, a, y), h });
  // floating sweet islands, gently bobbing
  const isl = ['candy_island', 'lollipop_grove', 'choco_fall'];
  for (let i = 0; i < 10; i++) S.push({ n: isl[i % 3], p: at(R(75, 125), i * 0.63 + R(0, 0.3), R(500, 735)), h: r2(R(22, 34)), mv: { k: 'bob', a: r2(R(1.0, 2.2)), s: r2(R(0.18, 0.3)), ph: r2(R(0, 6.28)) } });
  // clouds drifting round the tower (a chord tangent to its circle: they never pass through it)
  const cl = ['cloud_pink', 'cloud_mint', 'cloud_lilac'];
  for (let i = 0; i < 30; i++) { const a = R(0, 6.28), r = R(42, 140); S.push({ n: cl[i % 3], p: at(r, a, R(480, 780)), h: r2(R(9, 22)), mv: { k: 'drift', span: r2(R(90, 150)), s: r2(R(0.7, 1.5)), d: r2(a + Math.PI / 2), a: 0.8, ph: r2(rnd()) } }); }
  // hot-air balloons drifting slowly, bobbing
  for (let i = 0; i < 10; i++) { const a = R(0, 6.28); S.push({ n: 'candy_balloon', p: at(R(30, 62), a, Y1 + 8 + i * 20 + R(-4, 4)), h: r2(R(6, 9)), mv: { k: 'drift', span: r2(R(50, 70)), s: r2(R(0.4, 0.8)), d: r2(a + Math.PI / 2 * (i % 2 ? 1 : -1)), a: 1.6, ph: r2(rnd()) } }); }
  // flying candies circling the tower
  for (let i = 0; i < 8; i++) S.push({ n: 'flying_candies', p: [C4.x, r2(Y1 + 12 + i * 25), C4.z], h: r2(R(4, 6)), mv: { k: 'orbit', r: r2(R(26, 40)), s: r2(R(0.05, 0.09) * (i % 2 ? -1 : 1)), a: 1.0, ph: r2(R(0, 6.28)) } });
  // soap bubbles rising beside every zone
  for (let i = 0; i < 44; i++) S.push({ n: 'bubble', p: at(R(21, 34), R(0, 6.28), Y1 - 5 + (i % 8) * 27), h: r2(R(0.9, 2.2)), mv: { k: 'rise', span: r2(R(35, 55)), s: r2(R(1.0, 1.9)), a: 0.6, ph: r2(rnd()) } });
  data.atlas = `${A}/map004_atlas`;
  data.sprites = S;
  // birds circling at three heights
  data.fx.push({ t: 'birds', p: [C4.x, 575, C4.z], r: 52, n: 6, c: '#6b4a7a' }, { t: 'birds', p: [C4.x, 648, C4.z], r: 63, n: 7, c: '#6b4a7a' }, { t: 'birds', p: [C4.x, 712, C4.z], r: 46, n: 5, c: '#6b4a7a' });
  console.log(`scenery: ${S.length} sprites, ${data.fx.length} fx`);
}
applyI18n(data);
fs.writeFileSync(`${ROOT}packs/map004/maps/map004.json`, JSON.stringify(data));
fs.writeFileSync(new URL('./out/routes004.json', import.meta.url), JSON.stringify(B.routes));
{
  const { referencedFiles } = await import('./content.mjs');
  const dir = `${ROOT}packs/map004/`;
  const include = ['maps/map004.json', ...[...referencedFiles(data)].filter((f) => fs.existsSync(dir + f))].sort();
  const pf = dir + 'pack.json';
  const old = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  const meta = {
    id: 'map004', name: 'Candy Kingdom', order: 4, yMin: Y1 - 2, yMax: TOP + 40, entry: 'maps/map004.json', minApp: 3, requires: [],
    summary: 'Vương quốc kẹo trên mây · 520 → 720 m · 7 khu · donut xoay, thạch nảy, sông sô-cô-la, kẹo mút quay, lâu đài kẹo, lối bí mật',
    include, ...(old.version ? { version: old.version, contentHash: old.contentHash } : {}),
  };
  applyPackI18n('map004', meta);
  fs.writeFileSync(pf, JSON.stringify(meta, null, 1) + '\n');
  console.log(`pack.json: ${include.length} files`);
}
console.log(`prefabs ${B.prefabs.length}, kit ${B.kit.length}, devices ${devices.length}, movers ${movers.length}, pads ${pads.length}, ladders ${ladders.length}`);
