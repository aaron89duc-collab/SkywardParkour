// Map 005 – Toy Universe (720 -> 935 m). A giant toy world above the clouds, entered through Candy Kingdom's rainbow
// gate. Same frame as Maps 003/004: two interleaved halves (W / E, 16 m wide); every zone is built above its own
// start deck (two floating play-mat islands covering the half) and the next zone's deck sits in the other half, so a
// fall lands on the deck where the zone started. The map is about EXPLORATION: every zone has its main way, an
// easier way, a harder way and a secret, and the toys are the tools (press a toy button to slide a brick out, ride the
// toy train or the race car, stand on a robot's turning arm, tip a seesaw, follow the A-B-C blocks...).
// Colour rule: standable = red / yellow / blue / green, moving and interactive = pastel purple, decoration = plush.
// The 15 models are placeholders with the artist's names and proportions (devtools/pipeline/placeholder-map005.mjs)
// until the real files arrive (E:\game\Parkout\Asset map 5).
// Run: node devtools/build-map005.mjs -> packs/map005/maps/map005.json (+ devtools/out/map005_plan.png, routes005.json)
//   STAGE=n  build zones 1..n only     SHOWPATH=1  print the validator's paths     NOWRITE=1  validate only
import fs from 'fs';
import { applyI18n, applyPackI18n } from './i18n-content.mjs';
import { MapBuilder, r2, makeWaypoints } from './mapgen/lib.mjs';
import { plotMap } from './mapgen/plot.mjs';
import { zonePlot } from './mapgen/zoneplot.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const A = 'assets/map005';
const C5 = { x: -60, z: -9 };
const RING = 24;
const Y1 = 720, Y2 = 750, Y3 = 780, Y4 = 810, Y5 = 840, Y6 = 870, Y7 = 900, TOP = 935;
const HALF = { W: { x0: -76, x1: -60, xc: -68 }, E: { x0: -60, x1: -44, xc: -52 } };
const Z0 = -25, Z1 = 6;
const B = new MapBuilder({ ground: { x: C5.x, y: -999, z: C5.z, r: 0 } });
B.seed = 5;
B.supportR = 0.22;
const STAGE = process.env.STAGE ?? 'all';
const upTo = (n) => STAGE === 'all' || +STAGE >= n;

// ---------------------------------------------------------------- the models: normalised size + flat top height
const info = (id) => JSON.parse(fs.readFileSync(`${ROOT}packs/map005/assets/map005/${id}.info.json`, 'utf8'));
const SZ = {}, FT = {};
for (const f of fs.readdirSync(`${ROOT}packs/map005/assets/map005`).filter((f) => f.endsWith('.info.json'))) {
  const id = f.replace('.info.json', ''), d = info(id);
  SZ[id] = d.size;
  const h = {};
  for (const v of d.top.flatMap((r) => r.trim().split(/\s+/)).filter((v) => v !== '.').map(Number).filter((v) => v >= 30)) h[v] = (h[v] ?? 0) + 1;
  FT[id] = +(Object.entries(h).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 100) / 100;
}
FT.toy_brick = 1.0; FT.abc_block = 1.0; // box colliders: you stand on the studs / the plain top
FT.playmat_island = 0.945; FT.arch_bridge = 0.63; FT.rail_track = 0.98; FT.race_track = 0.88; FT.toy_house = 0.99;
FT.toy_drum = 0.93; FT.spinning_top = 0.61; FT.race_car = 0.91;
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
/** toy brick (2 x 4 studs): w long (4.2 = the standard brick), r = 90 turns it along z */
const brick = (x, z, top, o = {}) => piece('toy_brick', x, z, top, o.w ?? 4.2, o);
/** alphabet block, w on each side; r turns a letter towards the player (A +z, B +x, C -z, 1 -x) */
const abc = (x, z, top, o = {}) => piece('abc_block', x, z, top, (o.w ?? 2.4) * SZ.abc_block[0], o);
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
/** the floor of a zone: two 16 x 16 play-mat islands covering the whole half */
function deck(name, H, y) {
  const s = 8.6; // 16.2 x 10.3 each, three of them cover z -25 .. 5.9
  for (const zc of [-19.85, -9.55, 0.75]) B.prefab('playmat_island', H.xc, r2(y - FT.playmat_island * s), zc, 0, s, { name });
  return { top: y };
}

// ---------------------------------------------------------------- landmarks you climb by the bricks put on them
/** giant sitting teddy (decoration, solid; its back to -z): world points of its feet, knees, arms and head top
 *  (normalised points read off the model's heightmap) */
function teddy(x, z, base, s, r = 0) {
  B.prefab('teddy_bear', r2(x), r2(base), r2(z), r, r2(s), { name: 'giant teddy' }).noStand = true;
  const q = (r * Math.PI) / 180, c = Math.cos(q), sn = Math.sin(q);
  const W = (mx, my, mz) => [r2(x + (mx * c + mz * sn) * s), r2(base + my * s), r2(z + (-mx * sn + mz * c) * s)];
  return { footL: W(0.29, 0.35, 0.27), footR: W(-0.31, 0.35, 0.27), kneeL: W(0.29, 0.49, 0.1), kneeR: W(-0.31, 0.49, 0.1), armL: W(0.22, 0.85, -0.1), armR: W(-0.24, 0.85, -0.1), chest: W(0, 0.84, 0.02), head: W(0.03, 0.93, -0.29) };
}

/** a toy house you can walk into (its door faces local +z, turned by r): the model has no collider; invisible walls
 *  round it with a door gap, a roof you can stand on with a hole in the middle (an updraft inside blows you out) */
function house(x, z, ground, S, r = 0) {
  B.prefab('toy_house', r2(x), r2(ground), r2(z), r, r2(S), { name: 'toy house', col: false });
  const hw = (SZ.toy_house[0] * S) / 2, hd = (SZ.toy_house[2] * S) / 2, roof = r2(ground + FT.toy_house * S), t = 0.15, hy = r2((roof - ground) / 2);
  const q = (r * Math.PI) / 180, c = Math.cos(q), sn = Math.sin(q);
  const W = (lx, lz) => [r2(x + lx * c + lz * sn), r2(z - lx * sn + lz * c)];
  const wall = (lx, lz, sx, sz) => { const [wx, wz] = W(lx, lz); B.kitPiece('wall', [wx, r2(ground + hy), wz], [sx, hy, sz], r); };
  wall(0, -hd + t, hw, t); // back
  wall(-hw + t, 0, t, hd); wall(hw - t, 0, t, hd); // sides
  const door = 0.9, seg = (hw - door) / 2;
  wall(-(door + seg), hd - t, seg, t); wall(door + seg, hd - t, seg, t); // front, either side of the door
  // the roof: four slabs round a 1.8 m hole
  const hole = 0.9, rs = (hw - hole) / 2, rd = (hd - hole) / 2;
  for (const [lx, lz, sx, sz] of [[0, -(hole + rd), hw, rd], [0, hole + rd, hw, rd], [-(hole + rs), 0, rs, hole], [hole + rs, 0, rs, hole]]) {
    const [wx, wz] = W(lx, lz);
    B.kitPiece('solid', [wx, roof, wz], [r2(sx * 2), 0.3, r2(sz * 2)], r, { vo: true });
    B.kitPiece('wall', [wx, r2(roof - 0.15), wz], [sx, 0.15, sz], r);
  }
  const [dx, dz] = W(0, hd + 1.0);
  return { x, z, top: roof, hx: Math.abs(c) * hw + Math.abs(sn) * hd, hz: Math.abs(sn) * hw + Math.abs(c) * hd, door: [dx, ground, dz], roof };
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
const crumble = (id, x, z, top, o = {}) => boxDev('crumble', id, 'toy_brick', x, z, top, o.w ?? 2.8, { delay: o.delay ?? 0.7, respawn: 3 }, o);
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
/** the jack-in-the-box: a toy box whose spring platform rides up from `top` to `topB` once stood on */
function jackBox(id, x, z, top, topB, o = {}) {
  const W = o.w ?? 3.2, S = W / SZ.jack_box[0];
  B.prefab('jack_box', r2(x), r2(top - 0.54 * S), r2(z), o.r ?? 0, r2(S), { name: 'jack-in-the-box' }).noStand = true;
  const w = r2(W * 0.66);
  const d = { t: 'elevator', id, p: [r2(x), r2(top), r2(z)], r: o.r ?? 0, s: [w, 0.4, w], b: [r2(x), r2(topB), r2(z)], speed: o.speed ?? 3.0, wait: o.wait ?? 2.5, color: PURPLE };
  devices.push(d);
  surf('spring platform', d.p, d.s);
  B.node([x, topB, z]);
  return { id, x, z, top: r2(top), topB: r2(topB), hx: w / 2, hz: w / 2 };
}
/** a big red toy button (pressure plate) at p driving device `target` (held `hold` s after you step off) */
function button(id, p, target, hold = 3.5) {
  devices.push({ t: 'plate', id, p: p.map(r2), s: [1.6, 0.15, 1.6], target, hold, color: BTN });
  return { id, x: p[0], z: p[2], top: p[1], r: 0.8 };
}
/** a brick sliding `stroke` along yaw r out of its slot while the button is held */
function slideBrick(id, x, z, top, r, stroke, o = {}) {
  const w = o.w ?? 4.2, s = w / SZ.toy_brick[0];
  devices.push({ t: 'piston', id, p: [r2(x), r2(top), r2(z)], r, s: [r2(SZ.toy_brick[2] * s), r2(s * 0.85), r2(w)], stroke, target: 'plate', model: look('toy_brick', s, { yaw: 90 }) });
  return { id, x, z, top: r2(top) };
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

// ---------------------------------------------------------------- movers (moving platforms) wearing the toys
const movers = [];
const sweeps = [];
/** a curved rail piece (90 degrees): arc centre (cx, cz), centre-line radius R, rail top y; the arc runs from angle
 *  a = -90 (west of the centre) to a = 0 (south of it, +z) – turn it with `rot` (degrees) */
function rail(cx, cz, y, R, rot = 0) {
  const s = R / 2.0; // the model's centre line is 2.0 (normalised) from its corner
  const q = ((180 + rot) * Math.PI) / 180, c = Math.cos(q), sn = Math.sin(q);
  const mx = 1.11 * s, mz = -1.12 * s; // model centre relative to the arc centre (before the turn)
  B.prefab('rail_track', r2(cx + mx * c + mz * sn), r2(y - FT.rail_track * s), r2(cz - mx * sn + mz * c), r2(180 + rot), r2(s), { name: 'toy railway' });
  return { cx, cz, y, R, rot };
}
/** the toy train rides round a curved rail (rotor): you stand on its flat wagon; a0 -> a1 (degrees) */
function train(id, RL, a0, a1, o = {}) {
  const S = o.s ?? 4.0, n = (v) => r2(v / S);
  const deckY = r2(RL.y + 0.38 * S);
  const center = [RL.cx, deckY, RL.cz];
  const tip = (a) => { const r = (a * Math.PI) / 180; return [r2(RL.cx + RL.R * Math.sin(r)), deckY, r2(RL.cz + RL.R * Math.cos(r))]; };
  const t = 0.4;
  movers.push({ id, kind: 'rotor', pts: [tip(a0), tip(a1)], center, arm: RL.R, off: 0, s: S, a0, a1, speed: o.speed ?? 16, wait: o.wait ?? 2.8, phase: o.phase ?? 0,
    model: { file: `${A}/toy_train`, s: S, off: [-0.68, -0.38, n(RL.R)], boxes: [[0, n(-t / 2), n(RL.R), 0.36, n(t / 2), 0.25], [-1.18, 0.11, n(RL.R), 0.58, 0.49, 0.24]] } });
  B.node(tip(a0)); B.node(tip(a1));
  sweeps.push({ id, y0: r2(RL.y + 0.1), y1: r2(deckY + 2.0), circle: { x: RL.cx, z: RL.cz, r: r2(RL.R + 1.7), r0: r2(RL.R - 1.7), a0, a1 } });
  return { A: tip(a0), B: tip(a1), center, deckY };
}
/** the toy race car drives a -> b (its nose first) along a straight road at road height; you ride on its flat rear
 *  deck (canopy + spoiler, 0.91 of its height) - the route points A/B are on that deck */
function raceCar(id, a, b, o = {}) {
  const S = o.s ?? 1.9, n = (v) => r2(v / S), DY = r2(0.91 * S);
  const yaw = r2((Math.atan2(b[0] - a[0], b[2] - a[2]) * 180) / Math.PI + 90); // model -x (the nose) along the drive
  const t = 0.3, A2 = [a[0], r2(a[1] + DY), a[2]], B2 = [b[0], r2(b[1] + DY), b[2]];
  movers.push({ id, kind: 'hover', pts: [A2.map(r2), B2.map(r2)], speed: o.speed ?? 4.0, wait: o.wait ?? 2.6, phase: o.phase ?? 0, r: yaw, s: S,
    model: { file: `${A}/race_car`, s: S, off: [-0.53, -0.91, 0], boxes: [[0, n(-t / 2), 0, 0.58, n(t / 2), 0.5], [-1.0, -0.55, 0, 0.55, 0.35, 0.6]] } });
  B.node(A2); B.node(B2);
  // swept volume: the car is 2.2 S long (from 1.1 S behind the deck point to 3.1 S... in metres below) and 1.35 S wide
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]), ux = (b[0] - a[0]) / L, uz = (b[2] - a[2]) / L;
  const back = 0.58 * S + 0.3, front = 1.64 * S + 0.3, side = 0.68 * S + 0.3;
  const boxes = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12, cx = a[0] + (b[0] - a[0]) * u, cz = a[2] + (b[2] - a[2]) * u;
    const ex = Math.abs(ux) * (back + front) / 2 + Math.abs(uz) * side, ez = Math.abs(uz) * (back + front) / 2 + Math.abs(ux) * side;
    const mx = cx + ux * (front - back) / 2, mz = cz + uz * (front - back) / 2;
    boxes.push({ x0: mx - ex, x1: mx + ex, z0: mz - ez, z1: mz + ez });
  }
  sweeps.push({ id, y0: r2(a[1] + 0.15), y1: r2(a[1] + DY + 0.4), boxes, each: true, skip: o.skip ?? [] });
  return { A: A2, B: B2, deck: DY };
}
/** an elevated race-track road (model x = its length): from a to b (same height = the road top), w wide */
function road(a, b, w = 2.6, o = {}) {
  const s = w / SZ.race_track[2], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const n = Math.max(1, Math.round(L / (SZ.race_track[0] * s)));
  const s2 = L / (n * SZ.race_track[0]);
  const yaw = r2((Math.atan2(b[0] - a[0], b[2] - a[2]) * 180) / Math.PI - 90);
  for (let i = 0; i < n; i++) { const u = (i + 0.5) / n; B.prefab('race_track', r2(a[0] + (b[0] - a[0]) * u), r2(a[1] - FT.race_track * s2), r2(a[2] + (b[2] - a[2]) * u), yaw, r2(s2), { name: o.name ?? 'race track' }); }
  const xs = [a[0], b[0]], zs = [a[2], b[2]], hw = (SZ.race_track[2] * s2) / 2;
  const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[2] - a[2]);
  return { x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, top: a[1], hx: alongX ? Math.abs(xs[1] - xs[0]) / 2 : hw, hz: alongX ? hw : Math.abs(zs[1] - zs[0]) / 2, w: r2(hw * 2) };
}
/** trampoline with the toy drum's look */
function drumM(id, x, z, top, w, o = {}) { return boxDev('trampoline', id, 'toy_drum', x, z, top, w, { bounce: o.bounce ?? 0.9, min: o.min ?? 11, max: o.max ?? 24 }, { k: 0.8, name: 'toy drum', ...o }); }
/** the spinning top (turntable wearing the toy's model; its handle sticks up in the middle) */
function spinTopM(id, x, z, top, R, speed, o = {}) {
  const S = (2 * R) / (SZ.spinning_top[0] * 0.96);
  const d = { t: 'turntable', id, p: [r2(x), r2(top), r2(z)], s: [r2(2 * R), 0.5, r2(2 * R)], radius: r2(R), speed, ...(o.phase ? { phase: o.phase } : {}), model: look('spinning_top', S, { ft: 0.61 }) };
  devices.push(d);
  surf('spinning top', [x, top, z + R * 0.6], [r2(R * 1.0), 0.5, r2(R * 0.6)]);
  surf('spinning top', [x, top, z - R * 0.6], [r2(R * 1.0), 0.5, r2(R * 0.6)]);
  const hs = r2((0.39 * S) / 2); // the handle: round, so a still post is enough
  B.kitPiece('wall', [r2(x), r2(top + hs), r2(z)], [0.28, hs, 0.28], 0);
  return { id, x, z, top: r2(top), r: r2(R) };
}

/** a robot arm turning round its shoulder (rotor): stand at `stand` m from the axis and ride from angle a0 to a1 */
function robotArm(id, center, stand, a0, a1, o = {}) {
  const S = (o.len ?? 10) / SZ.robot_arm[0]; // model height (m)
  const tip = (a) => { const r = (a * Math.PI) / 180; return [r2(center[0] + stand * Math.sin(r)), r2(center[1]), r2(center[2] + stand * Math.cos(r))]; };
  const t = 0.4 / S;
  movers.push({ id, kind: 'rotor', pts: [tip(a0), tip(a1)], center: center.map(r2), arm: stand, off: 0, s: r2(S), a0, a1, speed: o.speed ?? 26, wait: o.wait ?? 2.4, phase: o.phase ?? 0,
    model: { file: `${A}/robot_arm`, s: r2(S), off: [0, -0.68, 2.35], yaw: -90, boxes: [[0, r2(-t / 2), 2.5, 0.3, r2(t / 2), 2.15]] } });
  B.node(tip(a0)); B.node(tip(a1));
  sweeps.push({ id, y0: r2(center[1] - 1.2), y1: r2(center[1] + 2.0), circle: { x: center[0], z: center[2], r: r2((o.len ?? 10) - 0.2), a0, a1 } });
  return { A: tip(a0), B: tip(a1), center };
}


/** a tower of alphabet blocks from `base` up to `top` (cubes about W on a side); only the top cube is stood on */
function stack(x, z, base, top, W, o = {}) {
  const n = Math.max(1, Math.round((top - base) / W)), w = r2((top - base) / n);
  let rec;
  for (let i = 0; i < n; i++) rec = abc(x, z, r2(base + w * (i + 1)), { w, r: (o.r ?? 0) + 90 * (i % 4), noStand: i < n - 1 || o.noStand, name: o.name ?? 'block tower' });
  return rec;
}
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
  if (kind === 'brick') return brick(x, z, top, o);
  if (kind === 'abc') return abc(x, z, top, o);
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
// ENTRY (720): Candy Kingdom's rainbow gate (-68.6, 720, -4.4) opens north onto a red brick; a toy arch bridge leads
// east onto the first play-mat deck
// =====================================================================================
const ENT = brick(-68.6, -1.4, Y1, { r: 90, name: 'entry brick' });
const SPAWN = [-68.6, Y1, -1.8];
mark(SPAWN, 'Toy Gate');
const ARC0 = piece('arch_bridge', -63.6, -1.4, Y1, 7.4, { name: 'entry arch' });
hop(ENT, ARC0, 'entry brick > arch');
mark([-63.6, Y1, -1.4], 'entry arch');
void ARC0;

// =====================================================================================
// ZONE 1 – TOY GATE (720–750, east): a giant teddy sits by the entry. Alphabet blocks and bricks climb the west side,
// a toy arch bridge and the first seesaw cross the north, bricks come back south high above the teddy's head and
// round the west to the bridge to deck 2.
//   easy: low brick stairs in the middle · hard: climb the teddy (bricks on its foot, knee and chest, then its head)
//   secret: follow the little letters A-B-C behind the teddy's back to an updraft and a gem hidden behind its head
// =====================================================================================
deck('deck 1', HALF.E, Y1);
mark([-58.2, Y1, -1.4], 'deck 1');
checkpoint('cp1', [-58.6, Y1, 2.6], 90);
SIGN([-44.3, Y1 + 3.4, -14.0], -90, 'TOY UNIVERSE', 'Thế giới đồ chơi · 720 → 935 m');
const TD = teddy(-50.4, 0.0, Y1, 14, 180);
const S1 = at([-58.2, Y1, -1.4], 0.4);
const M1 = chain(S1, [
  ['abc', -57.8, -5.4, Y1 + 1.4, { label: 'block A' }],
  ['abc', -55.0, -8.2, Y1 + 2.8, { r: 90, label: 'block B' }],
  ['abc', -57.6, -11.2, Y1 + 4.2, { r: 180, label: 'block C' }],
  ['brick', -57.8, -15.8, Y1 + 5.6, { r: 90 }],
], 'Z1 step');
const ARC1 = piece('arch_bridge', -52.2, -20.4, Y1 + 7.0, 8.0, { name: 'arch bridge' });
hop(M1[3], ARC1, 'Z1 brick > arch'); mark(P(ARC1, -2.5), 'arch bridge (west)'); mark(P(ARC1, 2.6), 'arch bridge (east)');
const SS1 = seesaw('ss1', -45.8, -17.6, Y1 + 7.4, 8.0);
hop(ARC1, SS1, 'arch > seesaw'); mark(P(SS1, 0, -2.4), 'seesaw (north end)'); mark(P(SS1, 0, 2.6), 'seesaw (south end)');
const M2 = chain(SS1, [
  ['brick', -45.9, -10.2, Y1 + 8.6, { r: 90 }],
  ['brick', -50.6, -9.6, Y1 + 10.0],
  ['abc', -54.4, -12.4, Y1 + 11.4],
  ['abc', -51.8, -15.0, Y1 + 12.8, { r: 90 }],
  ['brick', -47.8, -15.8, Y1 + 14.2, { r: 90 }],
  ['brick', -45.6, -10.8, Y1 + 15.6, { r: 90 }],
  ['abc', -46.0, -6.0, Y1 + 17.0],
  ['brick', -48.2, -2.4, Y1 + 18.4, { label: 'brick over the teddy' }],
  ['abc', -52.0, 1.2, Y1 + 19.8],
  ['brick', -55.6, 0.6, Y1 + 21.2, { r: 90 }],
  ['abc', -57.6, -3.8, Y1 + 22.6],
  ['brick', -57.8, -8.4, Y1 + 24.0, { r: 90 }],
  ['abc', -57.6, -12.8, Y1 + 25.4],
  ['brick', -55.0, -16.4, Y1 + 26.8],
  ['brick', -50.2, -16.4, Y1 + 28.4],
], 'Z1 float');
walkway('toy_brick', [-49.2, Y2, -12.2], [-61.8, Y2, -12.2], 2.1, { name: 'bricks to deck 2' });
hop(M2[14], at([-50.0, Y2, -12.2], 1.1), 'Z1 last > exit bricks');
mark([-50.6, Y2, -12.2], 'bricks to deck 2');
// easy: low brick stairs in the middle to the brick before the arch bridge (no alphabet-block grabs)
alt('z1easy', { p: [-51.0, Y1, -7.6], label: 'deck (middle)' }, [
  ['brick', -52.4, -10.6, Y1 + 1.0], ['brick', -50.0, -13.8, Y1 + 2.0, { r: 90 }],
  ['brick', -53.2, -15.2, Y1 + 3.0], ['brick', -55.4, -13.4, Y1 + 4.2, { r: 90 }],
], { p: P(M1[3]), rec: M1[3], label: 'brick before the arch (joins)' });
// hard: up the teddy – a block at its foot, bricks on its foot and knee, one floating in front, one on its chest,
// one on its head, a leap to the main way
const HB = alt('z1hard', { p: [-52.6, Y1, -8.6], label: 'deck in front of the teddy' }, [
  ['abc', -54.4, -7.4, Y1 + 2.2, { w: 2.2, label: 'block at the foot' }],
  ['brick', -56.4, -5.4, Y1 + 4.1, { r: 90, w: 2.8, label: 'brick beside the foot' }],
  ['brick', TD.footL[0], TD.footL[2], r2(TD.footL[1] + 0.98), { w: 2.8, label: 'teddy foot' }],
  ['brick', TD.kneeL[0], TD.kneeL[2], r2(TD.kneeL[1] + 0.98), { w: 2.8, label: 'teddy knee' }],
  ['brick', -51.4, -3.8, Y1 + 9.6, { w: 2.8, label: 'brick in front of the teddy' }],
  ['brick', -47.8, -2.4, Y1 + 11.4, { r: 90, w: 2.8, label: 'brick on its other knee' }],
  ['brick', TD.chest[0], r2(TD.chest[2] - 0.4), r2(TD.chest[1] + 1.4), { w: 2.8, label: 'teddy chest' }],
  ['brick', TD.head[0], TD.head[2], r2(TD.head[1] + 0.98), { r: 90, w: 2.8, label: 'teddy head (gem)' }],
], null);
gem('gem1b', P(HB[7]));
// from the teddy's head back to the main way: three bricks round the west of its head
const DOWN = alt('z1head', { p: P(HB[7]), rec: HB[7], label: 'teddy head' }, [
  ['brick', -53.8, 5.0, r2(HB[7].top + 1.9), { w: 2.8 }], ['brick', -57.0, 4.4, r2(HB[7].top + 3.8), { r: 90, w: 2.8 }],
  ['brick', -58.4, 1.0, r2(HB[7].top + 5.6), { r: 90, w: 2.8 }],
], { p: P(M2[9]), rec: M2[9], label: 'main bricks (joins)' });
void DOWN;
// secret: three small letter blocks behind the teddy's back, an updraft lifts you to a brick hidden behind its head
alt('z1secret', { p: [-57.0, Y1, 4.6], label: 'behind the teddy' }, [
  ['abc', -55.4, 7.0, Y1 + 1.2, { w: 1.6, label: 'little A' }], ['abc', -53.0, 8.2, Y1 + 2.4, { w: 1.6, r: 90, label: 'little B' }],
  ['abc', -50.6, 8.6, Y1 + 3.6, { w: 1.6, r: 180, label: 'little C' }],
], null);
fan('f1', -47.8, Y1 + 3.6, 8.4, 1.6, 9.0, { force: 50 });
const F1B = abc(-47.8, 8.4, Y1 + 3.6, { w: 1.6, name: 'little 1' });
B.mark('z1secret', P(F1B), 'little 1 (the updraft)');
const SEC1 = brick(-50.4, 7.4, r2(TD.head[1] - 1.0), { r: 90, w: 2.8, name: 'hidden brick' });
B.mark('z1secret', P(SEC1), 'hidden brick behind the head (gem)', 'fan:f1');
gem('gem1', P(SEC1));
hop(SEC1, HB[7], 'secret > head');
B.mark('z1secret', P(HB[7]), 'teddy head');
divider(Y1, Y2 - 0.6, [[-3.0, 0.2, Y1 - 1, Y1 + 3.5]]);
EXIT = [-58.6, Y2, -12.2];
console.log('zone 1 placed');

if (upTo(2)) {
  // =====================================================================================
  // ZONE 2 – ROBOT WORKSHOP (750–780, west): a giant tin robot facing east. A jack-in-the-box springs you up beside
  // its turning arm, the arm carries you across, bricks climb onto the robot's head, a big red button slides a brick
  // across a gap you cannot jump, a robot arm sweeps the long walkway, crumbling bricks lead to the bridge to deck 3.
  //   easy: a ring of low bricks round the button gap · hard: big steps up the east edge instead of the spring + arm
  //   secret: an updraft hidden behind the robot's back lifts you to a ledge by its head (gem) – a shortcut
  // =====================================================================================
  deck('deck 2', HALF.W, Y2);
  mark([-62.8, Y2, -12.2], 'deck 2');
  checkpoint('cp2', [-63.0, Y2, -9.4], -90);
  const RS = 16, RX = -72.0, RZ = -20.0;
  B.prefab('robot_body', RX, Y2, RZ, 90, RS, { name: 'giant robot' }).noStand = true;
  const HEADY = r2(Y2 + 0.88 * RS); // flat head top (x -73.3 .. -70.7, z -21.6 .. -18.4)
  const SH = [RX, r2(Y2 + 0.62 * RS + 0.35), r2(RZ + 0.218 * RS + 0.9)]; // just off the south shoulder (the arm's axis, walkway height)
  const R2a = chain(at([-62.8, Y2, -12.2], 0.4), [['brick', -64.8, -8.6, Y2 + 1.4, { r: 90 }]], 'Z2 step');
  const JB2 = jackBox('jb2', -66.4, -4.4, Y2 + 3.0, r2(SH[1] + 0.4), { r: 180 });
  B.link(P(JB2), [JB2.x, JB2.topB, JB2.z], 'elevator');
  hop(R2a[0], JB2, 'Z2 brick > jack box');
  mark(P(JB2), 'jack-in-the-box (spring)');
  mark([JB2.x, JB2.topB, JB2.z], 'spring at the top', 'elev:jb2');
  const B21 = brick(-69.6, -1.8, r2(SH[1] + 0.4), { name: 'brick by the arm' });
  hop({ ...JB2, top: JB2.topB }, B21, 'spring > brick');
  mark(P(B21), 'brick by the arm');
  const ARM2 = robotArm('arm2', SH, 7.8, 0, 90, { speed: 26, wait: 2.6, len: 9.6 });
  mark(ARM2.A, 'robot arm (board)', 'rotor:arm2:A'); mark(ARM2.B, 'robot arm (ride)', 'rotor:arm2:B');
  B.link(P(B21), ARM2.A, 'board'); B.link(ARM2.A, ARM2.B, 'rotor');
  const B22 = brick(-61.2, SH[2], SH[1], { r: 90, name: 'brick after the arm' });
  B.link(ARM2.B, P(B22), 'alight');
  mark(P(B22), 'brick after the arm');
  const R2b = chain(B22, [
    ['brick', -62.4, -19.4, r2(SH[1] + 1.4)],
    ['abc', -65.6, -22.8, r2(SH[1] + 2.8)],
    ['brick', -68.8, -20.0, r2(HEADY - 0.4), { r: 90, label: 'brick against the head' }],
    ['brick', -72.0, -18.9, r2(HEADY + 0.98), { w: 2.8, label: 'robot head (beside the antenna)' }],
    ['brick', -74.2, -14.4, r2(HEADY + 2.4), { r: 90 }],
    ['brick', -74.4, -9.4, r2(HEADY + 3.8), { r: 90 }],
  ], 'Z2 float');
  // the big red button: stand on it and a brick slides out across the gap (it stays out 3.5 s after you step off)
  const BL = brick(-74.0, -3.4, r2(HEADY + 5.6), { r: 90, w: 5.6, name: 'button ledge' });
  hop(R2b[5], BL, 'Z2 float 6 > button ledge');
  button('bt2', [-74.0, r2(BL.top + 0.02), -1.6], 'sb2');
  mark([-74.0, BL.top, -2.4], 'red button', 'plate:bt2');
  const BR = brick(-64.6, -3.4, BL.top, { r: 90, w: 5.6, name: 'far ledge' });
  slideBrick('sb2', -73.4, -3.4, BL.top, 90, 5.0, { w: 3.6 });
  mark(P(BR, -1.2), 'across the sliding brick', 'piston');
  B.link([-74.0, BL.top, -2.4], P(BR, -1.2), 'piston');
  const R2c = chain(BR, [
    ['brick', -63.6, -8.6, r2(BL.top + 1.4), { r: 90 }],
    ['abc', -66.6, -11.4, r2(BL.top + 2.8)],
  ], 'Z2 high');
  // the sweeping robot arm over the long walkway
  const WY = r2(BL.top + 4.2);
  walkway('toy_brick', [-68.8, WY, -14.0], [-68.8, WY, -23.0], 2.25, { name: 'sweeper walkway' });
  hop(R2c[1], at([-68.8, WY, -14.4], 1.1), 'block > walkway');
  sweepArm('sw2', -68.8, WY, -18.4, 3.4, 60);
  mark([-68.8, WY, -14.6], 'walkway (south)'); mark([-68.8, WY, -22.2], 'walkway (north)', 'sweep:sw2');
  const CR2 = [crumble('cr2a', -65.4, -23.6, r2(WY + 1.4)), crumble('cr2b', -62.6, -21.2, r2(WY + 2.8))];
  hop(at([-68.8, WY, -22.6], 1.1), CR2[0], 'walkway > crumble a'); hop(CR2[0], CR2[1], 'crumble a > b');
  mark(P(CR2[0]), 'crumbling brick a'); mark(P(CR2[1]), 'crumbling brick b');
  const L2 = brick(-63.2, -17.2, r2(WY + 4.4), { r: 90 });
  hop(CR2[1], L2, 'crumble b > last'); mark(P(L2), 'last brick');
  walkway('toy_brick', [-63.4, Y3, -12.8], [-57.4, Y3, -12.8], 2.1, { name: 'bricks to deck 3' });
  hop(L2, at([-63.0, Y3, -12.8], 1.1), 'last > bricks to deck 3');
  mark([-61.8, Y3, -12.8], 'bricks to deck 3');
  // easy: a ring of low bricks round the south edge instead of the button bridge
  alt('z2easy', { p: P(BL, 0, 1.6), label: 'button ledge (south)' }, [
    ['brick', -72.6, 2.2, r2(BL.top + 0.4)], ['brick', -68.4, 3.6, r2(BL.top + 0.8)], ['brick', -64.2, 2.2, r2(BL.top + 1.2)],
  ], { p: P(BR, 0, 1.6), rec: BR, label: 'far ledge (joins)' });
  // hard: big steps up the east edge instead of the spring and the arm
  alt('z2hard', { p: P(R2a[0]), rec: R2a[0], label: 'first brick' }, [
    ['abc', -61.6, -5.0, Y2 + 3.4, { w: 2.0 }], ['brick', -61.4, -9.4, Y2 + 5.8, { r: 90, w: 2.8 }], ['abc', -61.6, -12.8, Y2 + 8.2, { w: 2.0 }],
  ], { p: P(B22, 0, 1.2), rec: B22, label: 'brick after the arm (joins)' });
  // secret: behind the robot's back an updraft lifts you to a ledge beside its head (gem); the head is one hop away
  fan('f2', -75.2, Y2, -19.6, 1.2, 14.6, { force: 50 });
  const SEC2 = brick(-75.0, -22.6, r2(HEADY - 0.2), { r: 90, w: 2.8, name: 'ledge behind the robot' });
  gem('gem2', P(SEC2));
  B.mark('z2secret', [-74.6, Y2, -16.8], 'behind the robot');
  B.mark('z2secret', P(SEC2), 'ledge behind the head (gem)', 'fan:f2');
  B.mark('z2secret', P(R2b[3]), 'robot head (joins)');
  divider(Y2, Y3 - 0.6, [[-14.4, -10.0, Y2 - 1, Y2 + 3.5]]);
  EXIT = [-58.8, Y3, -12.8];
  console.log('zone 2 placed');
}

if (upTo(3)) {
  // =====================================================================================
  // ZONE 3 – CLOUD RAILWAY (780–810, east): a toy railway curves round the north-east; ride the train's flat wagon
  // from the west station to the east one, climb a toy house floating on its own island, then a spiral of bricks,
  // an arch bridge and crumbling bricks to the bridge to deck 4.
  //   easy: low bricks round the house instead of up its wall · hard: leaps straight across the curve (no train)
  //   secret: the house door is open – an updraft inside blows you out through the roof to a hidden brick (gem)
  // =====================================================================================
  deck('deck 3', HALF.E, Y3);
  mark([-56.6, Y3, -12.8], 'deck 3');
  checkpoint('cp3', [-56.0, Y3, -9.6], 90);
  const RL3 = rail(-45.0, -24.0, Y3 + 5.0, 10.0);
  const TR3 = train('tr3', RL3, -90, 0, { speed: 16, wait: 3.0 });
  const R3a = chain(at([-56.6, Y3, -12.8], 0.4), [
    ['brick', -58.4, -14.6, Y3 + 1.6, { r: 90 }],
    ['abc', -55.6, -17.0, Y3 + 3.2],
    ['brick', -58.4, -19.8, Y3 + 4.8, { r: 90 }],
    ['brick', -58.4, -23.9, TR3.deckY, { r: 90, label: 'west station' }],
  ], 'Z3 step');
  mark(TR3.A, 'toy train (board)', 'rotor:tr3:A'); mark(TR3.B, 'toy train (ride)', 'rotor:tr3:B');
  B.link(P(R3a[3]), TR3.A, 'board'); B.link(TR3.A, TR3.B, 'rotor');
  const ST3 = brick(-45.4, -10.6, TR3.deckY, { name: 'east station' });
  B.link(TR3.B, P(ST3), 'alight'); mark(P(ST3), 'east station');
  // the floating toy house (door to the west)
  const ISL3 = piece('playmat_island', -51.2, 1.4, r2(TR3.deckY + 3.2), 9.4, { r: 0, name: 'house island' });
  const HS3 = house(-51.4, 1.4, ISL3.top, 5.6, -90);
  const R3b = chain(ST3, [
    ['brick', -45.6, -6.0, r2(ST3.top + 1.5), { r: 90 }],
    ['abc', -47.6, -2.2, r2(ST3.top + 3.0), { w: 2.0 }],
  ], 'Z3 house step');
  hop(R3b[1], ISL3, 'block > house island'); mark([-47.4, ISL3.top, -1.0], 'house island (east)');
  const R3c = chain(at([-47.4, ISL3.top, -1.0], 0.5), [
    ['brick', -46.6, 4.2, r2(ISL3.top + 1.6), { w: 2.8 }],
    ['brick', -46.8, 1.0, r2(ISL3.top + 3.3), { r: 90, w: 2.8, label: 'brick against the house' }],
    ['brick', -49.8, -1.4, r2(HS3.roof - 0.2), { w: 2.8 }],
  ], 'Z3 wall');
  hop(R3c[2], HS3, 'brick > house roof'); mark([-51.4, HS3.roof, -0.6], 'house roof');
  const R3d = chain(at([-51.4, HS3.roof, -0.6], 0.8), [
    ['brick', -55.6, -1.0, r2(HS3.roof + 1.4), { r: 90 }],
    ['abc', -57.6, -5.2, r2(HS3.roof + 2.8)],
    ['brick', -57.6, -9.6, r2(HS3.roof + 4.2), { r: 90 }],
  ], 'Z3 spiral');
  const AB3 = piece('arch_bridge', -52.4, -12.6, r2(HS3.roof + 5.6), 8.0, { name: 'arch bridge' });
  hop(R3d[2], AB3, 'Z3 brick > arch'); mark(P(AB3, -2.4), 'arch bridge (west)'); mark(P(AB3, 2.6), 'arch bridge (east)');
  const CR3 = [crumble('cr3a', -46.2, -15.2, r2(AB3.top + 1.4)), crumble('cr3b', -46.6, -18.2, r2(AB3.top + 2.9))];
  hop(AB3, CR3[0], 'arch > crumble a'); hop(CR3[0], CR3[1], 'crumble a > b');
  mark(P(CR3[0]), 'crumbling brick a'); mark(P(CR3[1]), 'crumbling brick b');
  const R3e = chain(CR3[1], [
    ['brick', -50.4, -21.0, r2(AB3.top + 4.4)],
    ['abc', -54.6, -20.4, r2(AB3.top + 6.0)],
    ['brick', -57.6, -16.2, r2(AB3.top + 7.6), { r: 90 }],
  ], 'Z3 top');
  walkway('toy_brick', [-56.6, Y4, -12.6], [-62.6, Y4, -12.6], 2.1, { name: 'bricks to deck 4' });
  hop(R3e[2], at([-57.4, Y4, -12.6], 1.1), 'Z3 last > bricks to deck 4');
  mark([-58.0, Y4, -12.6], 'bricks to deck 4');
  // easy: low bricks round the house's south side instead of the bricks up its wall
  alt('z3easy', { p: [-47.4, ISL3.top, -1.0], label: 'house island (east)' }, [
    ['brick', -48.8, 5.2, r2(ISL3.top + 1.4)], ['brick', -53.2, 5.8, r2(ISL3.top + 2.8)], ['brick', -57.0, 4.2, r2(ISL3.top + 4.2), { r: 90 }],
    ['brick', -58.6, 0.0, r2(ISL3.top + 5.6), { r: 90, w: 2.8 }],
  ], { p: P(R3d[0]), rec: R3d[0], label: 'brick west of the roof (joins)' });
  // hard: big steps up the east edge straight to the east station (no train)
  alt('z3hard', { p: [-49.6, Y3, -2.0], label: 'deck (east)' }, [
    ['abc', -48.0, -4.6, Y3 + 2.2, { w: 2.2 }], ['brick', -45.4, -6.8, Y3 + 4.4, { r: 90, w: 2.8 }],
  ], { p: P(ST3), rec: ST3, label: 'east station (joins)' });
  // secret: in through the door – the updraft inside blows you up through the roof hole to a hidden brick (gem)
  fan('f3', -51.4, ISL3.top, 1.4, 1.6, r2(HS3.roof - ISL3.top + 6.0), { force: 50 });
  const SEC3 = brick(-51.6, 4.8, r2(HS3.roof + 5.0), { w: 2.8, name: 'hidden brick over the house' });
  gem('gem3', P(SEC3));
  B.mark('z3secret', [-55.4, ISL3.top, 1.4], 'house door (west)');
  B.mark('z3secret', P(SEC3), 'hidden brick over the house (gem)', 'fan:f3');
  B.mark('z3secret', P(R3d[1]), 'block on the spiral (joins)');
  divider(Y3, Y4 - 0.6, [[-14.0, -11.2, Y3 - 1, Y3 + 3.5]]);
  EXIT = [-58.6, Y4, -12.6];
  console.log('zone 3 placed');
}

if (upTo(4)) {
  // =====================================================================================
  // ZONE 4 – SKY SPEEDWAY (810–840, west): an elevated race-track road runs down the west side with a 4 m gap in
  // the middle – ride the race car across (it drives over the gap), bricks up to a spinning top, three springy toy
  // drums (each throws you ~5 m: +3 m a drum), a high road with a belt pushing you back, blinking and crumbling
  // bricks, steps to the bridge onto deck 5.
  //   easy: low blocks round the gap · hard: jump the 4.2 m gap (mind the car)
  //   secret: steer the last drum's throw west onto a ledge tucked beside the high road (gem)
  // =====================================================================================
  deck('deck 4', HALF.W, Y4);
  mark([-62.8, Y4, -12.6], 'deck 4');
  checkpoint('cp4', [-63.0, Y4, -9.6], -90);
  const RT4 = r2(Y4 + 5.6), RW = 3.0;
  const R4a = chain(at([-62.8, Y4, -12.6], 0.4), [
    ['brick', -63.4, -16.8, Y4 + 1.4, { r: 90 }],
    ['abc', -66.4, -20.8, Y4 + 2.8],
    ['brick', -69.2, -23.4, Y4 + 4.2],
  ], 'Z4 step');
  const RD1 = road([-73.0, RT4, -24.6], [-73.0, RT4, -12.8], RW, { name: 'race road (north)' });
  road([-73.0, RT4, -8.6], [-73.0, RT4, 3.2], RW, { name: 'race road (south)' });
  hop(R4a[2], RD1, 'Z4 brick > road');
  mark([-73.0, RT4, -23.4], 'race road (north end)');
  SIGN([-73.0, r2(RT4 + 3.4), -25.4], 0, 'XE ĐUA', 'Cưỡi xe đua qua khe hở');
  const CAR4 = raceCar('car4', [-73.0, RT4, -18.4], [-73.0, RT4, -2.6], { speed: 4.2, wait: 2.6, skip: ['race road (north)', 'race road (south)'] });
  mark(CAR4.A, 'race car (board)', 'hover:car4:A'); mark(CAR4.B, 'race car (ride)', 'hover:car4:B');
  B.link([-73.0, RT4, -23.4], CAR4.A, 'board'); B.link(CAR4.A, CAR4.B, 'hover');
  const DK = CAR4.A[1];
  const R4b = chain(at(CAR4.B, 0.9), [
    ['brick', -69.2, -1.0, r2(DK + 1.0), { r: 90, w: 3.6 }],
    ['abc', -66.2, 2.6, r2(DK + 2.4)],
  ], 'Z4 south');
  B.link(CAR4.B, P(R4b[0]), 'alight');
  const ST4 = spinTopM('st4', -62.6, -0.6, r2(DK + 3.8), 2.2, 34);
  hop(R4b[1], ST4, 'block > spinning top'); mark([-62.6, ST4.top, 1.0], 'spinning top (board)'); mark([-61.2, ST4.top, -1.8], 'spinning top (ride)', 'turn:st4');
  const T = ST4.top, DR = (id, x, z, top) => drumM(id, x, z, top, 2.8, { min: 18, k: 0.9 });
  const D4 = [DR('dr4a', -64.6, -4.8, r2(T - 0.4)), DR('dr4b', -68.4, -6.6, r2(T + 2.6)), DR('dr4c', -69.4, -10.6, r2(T + 5.6))];
  hop(ST4, D4[0], 'top > drum a');
  D4.forEach((d, i) => { if (i) B.link(P(D4[i - 1]), P(d), 'bounce'); });
  const HR4 = r2(T + 8.4);
  const RD3 = road([-71.6, HR4, -14.0], [-71.6, HR4, -24.2], RW, { name: 'high road' });
  belt('bl4', -71.6, -19.4, r2(HR4 + 0.02), 2.0, 6.4, 0, 2.2, { surf: false });
  B.link(P(D4[2]), [-71.6, HR4, -15.0], 'bounce');
  mark([-71.6, HR4, -15.0], 'high road (thrown up by three drums)', 'via:dr4a,dr4b,dr4c');
  mark([-71.6, HR4, -23.2], 'high road (north end, against the belt)');
  void RD3;
  const BK4 = [blink('bk4a', -67.6, -23.8, r2(HR4 + 1.2), 2.4, 1.4, 0), blink('bk4b', -64.2, -22.2, r2(HR4 + 2.4), 2.4, 1.4, 2.8)];
  hop(at([-71.6, HR4, -23.2], 1.4), BK4[0], 'high road > blink a'); hop(BK4[0], BK4[1], 'blink a > b');
  mark(P(BK4[0]), 'blinking brick a', 'blink:bk4a'); mark(P(BK4[1]), 'blinking brick b', 'blink:bk4b');
  const CR4 = [crumble('cr4a', -61.6, -19.4, r2(HR4 + 3.6)), crumble('cr4b', -63.6, -16.4, r2(HR4 + 4.8), { r: 90 })];
  hop(BK4[1], CR4[0], 'blink b > crumble a'); hop(CR4[0], CR4[1], 'crumble a > b');
  mark(P(CR4[0]), 'crumbling brick a'); mark(P(CR4[1]), 'crumbling brick b');
  const R4c = chain(CR4[1], [
    ['brick', -66.8, -14.4, r2(HR4 + 6.2), { r: 90 }],
    ['abc', -64.2, -10.8, r2(HR4 + 7.6)],
    ['brick', -61.6, -9.6, r2(HR4 + 9.0), { r: 90 }],
  ], 'Z4 top');
  walkway('toy_brick', [-61.2, Y5, -12.4], [-55.6, Y5, -12.4], 2.1, { name: 'bricks to deck 5' });
  hop(R4c[2], at([-61.0, Y5, -12.4], 1.1), 'Z4 last > bricks to deck 5');
  mark([-60.6, Y5, -12.4], 'bricks to deck 5');
  // easy: low blocks round the gap in the road (east of it, clear of the car)
  alt('z4easy', { p: [-73.0, RT4, -13.6], label: 'race road (by the gap)' }, [
    ['abc', -69.6, -12.6, r2(RT4 - 0.2), { w: 2.0 }], ['abc', -69.4, -9.0, r2(RT4 - 0.2), { w: 2.0 }],
  ], { p: [-73.0, RT4, -7.4], label: 'race road (south, joins)' });
  const SR4 = abc(-69.8, 3.4, r2(RT4 + 1.3), { w: 2.0 });
  hop(at([-73.0, RT4, 2.4], 1.2), SR4, 'south road > step'); hop(SR4, R4b[0], 'step > brick by the car');
  B.mark('z4easy', [-73.0, RT4, 2.2], 'race road (south end)'); B.mark('z4easy', P(SR4), 'step off the road');
  B.mark('z4easy', P(R4b[0]), 'brick by the car (joins)');
  // hard: jump the 4.2 m gap in the road (mind the car)
  alt('z4hard', { p: [-73.0, RT4, -13.4], label: 'road edge (north)' }, [], { p: [-73.0, RT4, -7.8], label: 'road edge (south)' });
  B.mark('z4hard', [-73.0, RT4, 2.2], 'race road (south end)'); B.mark('z4hard', P(SR4), 'step off the road');
  B.mark('z4hard', P(R4b[0]), 'brick by the car (joins)');
  // secret: steer the last drum's throw west onto a ledge beside the high road (gem), then onto the road
  const SEC4 = brick(-74.4, -12.2, r2(HR4 - 0.8), { w: 2.8, name: 'ledge beside the high road' });
  gem('gem4', P(SEC4));
  B.link(P(D4[2]), P(SEC4), 'bounce');
  B.mark('z4secret', [-61.2, ST4.top, -1.8], 'spinning top');
  B.mark('z4secret', P(SEC4), 'ledge beside the high road (gem)', 'via:dr4a,dr4b,dr4c');
  B.mark('z4secret', [-72.2, HR4, -14.8], 'high road (joins)');
  hop(SEC4, at([-72.2, HR4, -14.8], 1.4), 'secret ledge > high road');
  divider(Y4, Y5 - 0.6, [[-13.8, -11.0, Y4 - 1, Y4 + 3.5]]);
  EXIT = [-58.6, Y5, -12.4];
  console.log('zone 4 placed');
}
if (upTo(5)) {
  // =====================================================================================
  // ZONE 5 – SEESAW PLAYGROUND (840–870, east): two seesaws over to a giant rocking horse; bricks stuck to its side,
  // on its saddle and beside its neck lead up to its head, which sits in a low-gravity bubble: long floaty jumps
  // over a third seesaw to the bridge onto deck 6.
  //   easy: alphabet blocks up the horse's west side (no seesaws) · hard: from the saddle straight up to the head
  //   (the bubble catches you) · secret: a toy drum hidden behind the horse's chest throws you to a ledge (gem)
  // =====================================================================================
  deck('deck 5', HALF.E, Y5);
  mark([-56.8, Y5, -12.4], 'deck 5');
  checkpoint('cp5', [-56.6, Y5, -9.2], 90);
  const HS5 = 13, HX = -50.4, HZ = -8.0;
  B.prefab('rocking_horse', HX, Y5, HZ, 0, HS5, { name: 'giant rocking horse' }).noStand = true;
  const R5a = chain(at([-56.8, Y5, -12.4], 0.4), [
    ['abc', -56.2, -16.6, Y5 + 1.4, { w: 2.0 }],
    ['brick', -56.4, -19.8, Y5 + 2.8, { w: 4.2 }],
  ], 'Z5 step');
  const SS5a = seesaw('ss5a', -50.6, -22.0, r2(Y5 + 4.0), 7, { r: 90 });
  const SS5b = seesaw('ss5b', -45.6, -17.4, r2(Y5 + 5.2), 7);
  hop(R5a[1], SS5a, 'step > seesaw 1'); mark([-53.2, SS5a.top, -22.0], 'seesaw 1 (west end)'); mark([-48.0, SS5a.top, -22.0], 'seesaw 1 (east end)');
  hop(SS5a, SS5b, 'seesaw 1 > seesaw 2'); mark([-45.6, SS5b.top, -19.8], 'seesaw 2 (north end)'); mark([-45.6, SS5b.top, -14.8], 'seesaw 2 (south end)');
  const HB1 = brick(-46.4, -12.0, r2(Y5 + 6.6), { w: 3.0, name: 'brick on the horse' });
  const HB2 = abc(-46.6, -8.8, r2(Y5 + 8.0), { w: 2.0, name: 'block on the horse' });
  hop(at([-45.6, SS5b.top, -14.4], 1.0), HB1, 'seesaw 2 > horse brick'); mark(P(HB1), 'brick on the horse');
  hop(HB1, HB2, 'horse brick > block'); mark(P(HB2), 'block on the horse');
  const SDL = brick(HX, -9.0, r2(Y5 + 9.7), { w: 2.6, r: 90, name: 'brick on the saddle' });
  hop(HB2, SDL, 'block > saddle'); mark(P(SDL), 'brick on the saddle');
  const NK = brick(-48.2, -6.4, r2(Y5 + 11.1), { w: 3.0, r: 90, name: 'brick by the neck' });
  hop(SDL, NK, 'saddle > neck'); mark(P(NK), 'brick by the neck');
  // the low-gravity bubble round the horse's head and above it
  const LG0 = r2(Y5 + 10.4);
  lowgrav('lg5', -51.0, LG0, -3.4, 13.0, r2(Y6 + 0.6 - LG0), 13.0, 0.45);
  const HD = brick(HX, -5.0, r2(Y5 + 13.5), { w: 2.4, name: 'brick on the head' });
  B.link(P(NK), P(HD), 'low gravity jump'); mark(P(HD), 'brick on the head (low gravity)');
  const L1 = brick(-55.0, -2.6, r2(Y5 + 17.4), { w: 3.0, r: 90, name: 'floating brick' });
  const SS5c = seesaw('ss5c', -51.2, 1.6, r2(Y5 + 21.2), 6, { r: 90 });
  const L3 = brick(-46.6, -1.6, r2(Y5 + 25.0), { w: 3.0, name: 'floating brick' });
  const L4 = abc(-51.4, -7.2, r2(Y5 + 28.6), { w: 2.2, name: 'top block' });
  B.link(P(HD), P(L1), 'low gravity jump'); mark(P(L1), 'floating brick 1');
  B.link(P(L1), [-53.0, SS5c.top, 1.6], 'low gravity jump'); mark([-53.0, SS5c.top, 1.6], 'seesaw 3 (west end)'); mark([-49.4, SS5c.top, 1.6], 'seesaw 3 (east end)');
  B.link([-49.4, SS5c.top, 1.6], P(L3), 'low gravity jump'); mark(P(L3), 'floating brick 2');
  B.link(P(L3), P(L4), 'low gravity jump'); mark(P(L4), 'top block');
  walkway('toy_brick', [-53.4, Y6, -8.6], [-62.8, Y6, -8.6], 2.1, { name: 'bricks to deck 6' });
  hop(L4, at([-53.8, Y6, -8.6], 1.1), 'top block > bricks to deck 6');
  mark([-54.4, Y6, -8.6], 'bricks to deck 6');
  // easy: alphabet blocks up the horse's west side, no seesaws
  alt('z5easy', { p: P(R5a[1]), rec: R5a[1], label: 'Z5 step 2' }, [
    ['abc', -53.4, -16.6, r2(Y5 + 4.2), { w: 2.0 }],
    ['brick', -54.4, -12.0, r2(Y5 + 5.6), { w: 3.0, r: 90 }],
    ['abc', -53.4, -9.0, r2(Y5 + 7.0), { w: 2.0 }],
    ['abc', -53.6, -6.0, r2(Y5 + 8.4), { w: 2.0 }],
  ], { p: P(SDL), rec: SDL, label: 'brick on the saddle (joins)' });
  B.mark('z5easy', P(NK), 'brick by the neck');
  // hard: from the saddle straight up to the head - the bubble catches you
  B.mark('z5hard', P(SDL), 'brick on the saddle');
  B.mark('z5hard', P(HD), 'brick on the head (no neck brick)');
  B.link(P(SDL), P(HD), 'low gravity jump');
  B.mark('z5hard', P(L1), 'floating brick 1');
  // secret: a toy drum behind the horse's chest throws you to a ledge on its side (gem), then on to the block
  const DR5 = drumM('dr5', -46.4, 0.4, r2(Y5 + FT.toy_drum * (2.8 / SZ.toy_drum[0])), 2.8, { min: 19, k: 0.9 });
  const SEC5 = brick(-46.8, -4.6, r2(Y5 + 6.4), { w: 3.6, r: 90, name: 'ledge on the horse (gem)' });
  gem('gem5', P(SEC5));
  B.link(P(DR5), P(SEC5), 'bounce');
  hop(SEC5, HB2, 'secret ledge > block');
  B.mark('z5secret', [-52.0, Y5, 3.4], 'deck 5 (south)');
  B.mark('z5secret', P(SEC5), 'ledge on the horse (gem)', 'via:dr5');
  B.mark('z5secret', P(HB2), 'block on the horse (joins)');
  divider(Y5, Y6 - 0.6, [[-13.8, -11.0, Y5 - 1, Y5 + 3.5]]);
  EXIT = [-63.4, Y6, -8.6];
  console.log('zone 5 placed');
}
if (upTo(6)) {
  // =====================================================================================
  // ZONE 6 – BLOCK CANYON (870–900, west): alphabet-block towers across a canyon. Steps to a robot arm that swings
  // you over the canyon to tower 1, an arch bridge to tower 2, a toy cannon on its top shoots you up onto tower 3,
  // crumbling bricks to a jack-in-the-box, steps to the bridge onto deck 7.
  //   easy: blocks up to the middle of the arch bridge (no arm) · hard: four small blocks with big gaps instead of
  //   the jack-in-the-box · secret: a drum hidden behind tower 2 throws you to a ledge (gem), then onto tower 2
  // =====================================================================================
  deck('deck 6', HALF.W, Y6);
  mark([-63.4, Y6, -8.6], 'deck 6');
  checkpoint('cp6', [-62.4, Y6, -11.6], -90);
  const R6a = chain(at([-63.4, Y6, -8.6], 0.4), [
    ['abc', -64.0, -12.6, Y6 + 1.4, { w: 2.0 }],
    ['brick', -63.2, -16.4, Y6 + 2.8, { w: 3.6, r: 90 }],
    ['abc', -63.4, -19.6, Y6 + 4.2, { w: 2.0 }],
    ['brick', -63.2, -22.4, Y6 + 5.6, { w: 3.0 }],
  ], 'Z6 step');
  const BA = R6a[3];
  const C6 = [-66.6, r2(BA.top - 0.4), -15.0];
  stack(C6[0], C6[2], Y6, r2(C6[1] - 1.3), 1.6, { name: 'arm post', noStand: true });
  const ARM6 = robotArm('arm6', C6, 7.0, 180, 270, { speed: 26, wait: 2.6, len: 8.6 });
  mark(ARM6.A, 'robot arm (board)', 'rotor:arm6:A'); mark(ARM6.B, 'robot arm (ride)', 'rotor:arm6:B');
  B.link(P(BA), ARM6.A, 'board'); B.link(ARM6.A, ARM6.B, 'rotor');
  const T1 = brick(-73.4, -11.8, r2(BA.top), { w: 3.0, name: 'tower 1 top' });
  stack(-73.4, -11.8, Y6, r2(T1.top - 1.05), 2.4, { noStand: true });
  B.link(ARM6.B, P(T1), 'alight'); mark(P(T1), 'tower 1');
  const T2 = stack(-73.4, 0.4, Y6, T1.top, 2.8, { name: 'tower 2' });
  const AB6 = piece('arch_bridge', -73.4, -5.3, T1.top, 11.2, { r: 90, name: 'arch bridge' });
  hop(T1, AB6, 'tower 1 > arch'); hop(AB6, T2, 'arch > tower 2');
  mark([-73.4, T1.top, -6.0], 'arch bridge'); mark([-73.4, T2.top, -1.2], 'tower 2 (north edge)');
  const T3 = stack(-66.4, -3.4, Y6, r2(Y6 + 13.6), 3.4, { name: 'tower 3' });
  const AIM = aim(P(T2), P(T3), 72);
  cannon('cn6', P(T2), AIM.yaw, 72, AIM.v);
  SIGN([-75.8, r2(T2.top + 2.4), -1.6], 90, 'ĐẠI BÁC', 'Bước vào để bay lên tháp 3');
  B.link(P(T2), P(T3), 'cannon'); mark(P(T3), 'tower 3 (shot up by the cannon)', 'cannon:cn6');
  const CR6 = [crumble('cr6a', -67.0, -7.6, r2(T3.top + 1.4)), crumble('cr6b', -70.0, -10.4, r2(T3.top + 2.8), { r: 90 })];
  hop(T3, CR6[0], 'tower 3 > crumble a'); hop(CR6[0], CR6[1], 'crumble a > b');
  mark(P(CR6[0]), 'crumbling brick a'); mark(P(CR6[1]), 'crumbling brick b');
  const JB6 = jackBox('jb6', -72.6, -14.0, r2(CR6[1].top + 1.2), r2(CR6[1].top + 7.2), { w: 3.2 });
  hop(CR6[1], JB6, 'crumble b > jack box');
  mark(P(JB6), 'jack-in-the-box'); B.link(P(JB6), [JB6.x, JB6.topB, JB6.z], 'elevator');
  const N1 = brick(-72.6, -17.4, r2(JB6.topB + 1.4), { w: 3.0, name: 'brick after the box' });
  hop({ ...JB6, top: JB6.topB }, N1, 'box top > brick'); mark([JB6.x, JB6.topB, JB6.z], 'jack-in-the-box (top)', 'elev:jb6'); mark(P(N1), 'brick after the box');
  const R6b = chain(N1, [
    ['abc', -69.8, -20.0, r2(N1.top + 1.4), { w: 2.0 }],
    ['brick', -66.4, -22.0, r2(N1.top + 2.8), { w: 3.0 }],
    ['abc', -63.0, -19.6, r2(N1.top + 4.2), { w: 2.0 }],
  ], 'Z6 top');
  walkway('toy_brick', [-62.4, Y7, -16.6], [-54.6, Y7, -16.6], 2.1, { name: 'bricks to deck 7' });
  hop(R6b[2], at([-62.2, Y7, -16.6], 1.0), 'Z6 last > bricks to deck 7');
  mark([-60.4, Y7, -16.6], 'bricks to deck 7');
  // easy: blocks from the deck up to the middle of the arch bridge (no robot arm)
  alt('z6easy', { p: [-63.4, Y6, -8.6], label: 'deck 6' }, [
    ['abc', -66.8, -9.6, r2(Y6 + 1.4), { w: 2.0 }],
    ['brick', -69.6, -8.4, r2(Y6 + 2.8), { w: 3.0, r: 90 }],
    ['abc', -70.2, -5.0, r2(Y6 + 4.2), { w: 2.0 }],
  ], { p: [-73.4, T1.top, -5.4], label: 'arch bridge (joins)' });
  B.mark('z6easy', [-73.4, T2.top, -1.2], 'tower 2');
  // hard: four small blocks with big gaps instead of waiting for the jack-in-the-box
  alt('z6hard', { p: P(CR6[1]), rec: CR6[1], label: 'crumbling brick b' }, [
    ['abc', -73.4, -8.0, r2(CR6[1].top + 1.8), { w: 1.2 }],
    ['abc', -75.2, -10.6, r2(CR6[1].top + 3.6), { w: 1.2 }],
    ['abc', -75.2, -13.8, r2(CR6[1].top + 5.4), { w: 1.2 }],
    ['abc', -75.0, -17.0, r2(CR6[1].top + 7.2), { w: 1.2 }],
  ], { p: P(N1), rec: N1, label: 'brick after the box (joins)' });
  // secret: a drum behind tower 2 throws you to a ledge (gem), then onto tower 2 (skips the arm and the arch)
  const DR6 = drumM('dr6', -72.4, 4.4, r2(Y6 + FT.toy_drum * (2.8 / SZ.toy_drum[0])), 2.8, { min: 19, k: 0.9 });
  const SEC6 = abc(-75.0, 3.8, r2(T2.top - 0.6), { w: 2.0, name: 'ledge behind tower 2 (gem)' });
  gem('gem6', P(SEC6));
  B.link(P(DR6), P(SEC6), 'bounce'); hop(SEC6, T2, 'secret ledge > tower 2');
  B.mark('z6secret', [-69.0, Y6, 3.6], 'deck 6 (south)');
  B.mark('z6secret', P(SEC6), 'ledge behind tower 2 (gem)', 'via:dr6');
  B.mark('z6secret', [-73.4, T2.top, 1.2], 'tower 2 (joins)');
  divider(Y6, Y7 - 0.6, [[-9.8, -7.4, Y6 - 1, Y6 + 3.5]]);
  EXIT = [-53.4, Y7, -16.6];
  console.log('zone 6 placed', AIM);
}
if (upTo(7)) {
  // =====================================================================================
  // ZONE 7 – TOY SUMMIT (900–935, east): a tower of giant alphabet blocks with the summit island on top. Round it:
  // a seesaw, blinking bricks, a jack-in-the-box, a spinning top, three springy drums, crumbling bricks, steps up to
  // the summit and the gate to Map 006 (Mushroom Forest).
  //   easy: blocks up the west side to the jack-in-the-box (no seesaw, no blinking bricks)
  //   hard: two big steps (2 m) by the tower instead of the last three blocks
  //   portal: on deck 7, opens with 5 of the 7 gems; throws you up to the brick after the drums
  // =====================================================================================
  deck('deck 7', HALF.E, Y7);
  mark([-55.0, Y7, -16.6], 'deck 7');
  checkpoint('cp7', [-56.0, Y7, -19.8], 90);
  const SUMW = 7.5, SUMS = SUMW / SZ.playmat_island[0];
  stack(-52.0, -8.0, Y7, r2(TOP - FT.playmat_island * SUMS), 5.2, { noStand: true, name: 'summit tower' });
  const SUM = piece('playmat_island', -52.0, -8.0, TOP, SUMW, { name: 'summit island' });
  const R7a = chain(at([-55.0, Y7, -16.6], 0.4), [
    ['abc', -50.8, -15.6, Y7 + 1.4, { w: 2.0 }],
    ['brick', -47.6, -12.8, Y7 + 2.8, { w: 3.6, r: 90 }],
  ], 'Z7 step');
  const SS7 = seesaw('ss7', -46.2, -7.0, r2(Y7 + 4.0), 6);
  hop(R7a[1], SS7, 'step > seesaw'); mark([-46.2, SS7.top, -9.0], 'seesaw (north end)'); mark([-46.2, SS7.top, -5.0], 'seesaw (south end)');
  const BK7 = [blink('bk7a', -46.4, -1.6, r2(Y7 + 5.2), 2.4, 1.4, 0), blink('bk7b', -49.8, 1.0, r2(Y7 + 6.4), 2.4, 1.4, 2.8)];
  hop(at([-46.2, SS7.top, -4.6], 0.9), BK7[0], 'seesaw > blink a'); hop(BK7[0], BK7[1], 'blink a > b');
  mark(P(BK7[0]), 'blinking brick a', 'blink:bk7a'); mark(P(BK7[1]), 'blinking brick b', 'blink:bk7b');
  const JB7 = jackBox('jb7', -53.4, 0.8, r2(Y7 + 7.6), r2(Y7 + 13.6), { w: 3.2 });
  hop(BK7[1], JB7, 'blink b > jack box'); mark(P(JB7), 'jack-in-the-box');
  B.link(P(JB7), [JB7.x, JB7.topB, JB7.z], 'elevator'); mark([JB7.x, JB7.topB, JB7.z], 'jack-in-the-box (top)', 'elev:jb7');
  const R7b = chain({ ...JB7, top: JB7.topB }, [
    ['brick', -56.4, -2.2, r2(JB7.topB + 1.4), { w: 3.6, r: 90 }],
    ['abc', -57.6, -6.4, r2(JB7.topB + 2.8), { w: 2.0 }],
  ], 'Z7 west');
  const ST7 = spinTopM('st7', -57.4, -10.4, r2(JB7.topB + 4.2), 2.0, -30);
  hop(R7b[1], ST7, 'block > spinning top'); mark([-57.4, ST7.top, -8.8], 'spinning top (board)'); mark([-56.0, ST7.top, -12.0], 'spinning top (ride)', 'turn:st7');
  const T7 = ST7.top, DR = (id, x, z, top) => drumM(id, x, z, top, 2.8, { min: 18, k: 0.9 });
  const D7 = [DR('dr7a', -55.2, -15.2, r2(T7 - 0.4)), DR('dr7b', -51.2, -16.6, r2(T7 + 2.6)), DR('dr7c', -47.6, -14.6, r2(T7 + 5.6))];
  hop(ST7, D7[0], 'top > drum a');
  D7.forEach((d, i) => { if (i) B.link(P(D7[i - 1]), P(d), 'bounce'); });
  const W1 = brick(-45.8, -10.4, r2(T7 + 8.8), { r: 90, name: 'brick after the drums' });
  B.link(P(D7[2]), P(W1), 'bounce'); mark(P(W1, 0, -1.0), 'brick after the drums', 'via:dr7a,dr7b,dr7c');
  const CR7 = [crumble('cr7a', -46.2, -6.2, r2(W1.top + 1.4), { r: 90 }), crumble('cr7b', -47.6, -2.6, r2(W1.top + 2.8))];
  hop(W1, CR7[0], 'brick > crumble a'); hop(CR7[0], CR7[1], 'crumble a > b');
  mark(P(CR7[0]), 'crumbling brick a'); mark(P(CR7[1]), 'crumbling brick b');
  const R7c = chain(CR7[1], [
    ['abc', -50.8, -0.4, r2(W1.top + 4.2), { w: 2.0 }],
    ['brick', -54.4, -1.6, r2(W1.top + 5.6), { w: 3.0 }],
    ['abc', -51.4, -3.8, r2(W1.top + 7.0), { w: 2.0 }],
  ], 'Z7 top');
  hop(R7c[2], SUM, 'Z7 last > summit');
  mark([-52.0, TOP, -6.6], 'SUMMIT');
  // easy: blocks up the west side straight to the jack-in-the-box
  alt('z7easy', { p: [-55.0, Y7, -16.6], label: 'deck 7' }, [
    ['abc', -57.6, -14.4, r2(Y7 + 1.4), { w: 2.0 }],
    ['brick', -58.2, -10.6, r2(Y7 + 2.8), { w: 3.0, r: 90 }],
    ['abc', -57.8, -7.0, r2(Y7 + 4.2), { w: 2.0 }],
    ['brick', -57.4, -3.4, r2(Y7 + 5.6), { w: 3.0, r: 90 }],
    ['abc', -56.8, 0.4, r2(Y7 + 7.0), { w: 2.0 }],
  ], { p: P(JB7), rec: JB7, label: 'jack-in-the-box (joins)' });
  B.mark('z7easy', [JB7.x, JB7.topB, JB7.z], 'jack-in-the-box (top)', 'elev:jb7');
  // hard: two 2 m steps by the tower instead of the last three blocks
  alt('z7hard', { p: P(CR7[1]), rec: CR7[1], label: 'crumbling brick b' }, [
    ['abc', -48.8, -4.2, r2(CR7[1].top + 2.0), { w: 1.2 }],
  ], { p: P(R7c[2]), rec: R7c[2], label: 'last block (joins)' });
  B.mark('z7hard', [-52.0, TOP, -6.6], 'SUMMIT');
  // the gem portal (5 of the 7 gems): from deck 7 up to the brick after the drums
  const PT = [-57.4, Y7, -20.6], PE = P(W1, 0, -1.0), PL = Math.hypot(PE[0] - PT[0], PE[2] - PT[2]);
  const PU = [(PE[0] - PT[0]) / PL, (PE[2] - PT[2]) / PL];
  portal('pt7', PT, r2((Math.atan2(PU[0], PU[1]) * 180) / Math.PI), PE, 0, 5);
  SIGN([-57.4, r2(Y7 + 3.4), -23.6], 0, 'CỔNG ĐÁ QUÝ', 'Cần 5 viên đá quý · bay thẳng lên gần đỉnh');
  B.mark('portal', [r2(PT[0] - 2.0 * PU[0]), Y7, r2(PT[2] - 2.0 * PU[1])], 'in front of the portal (needs 5 gems)');
  B.mark('portal', P(W1, 0, -1.0), 'portal exit (after the drums)');
  divider(Y7, TOP - 0.6, [[-17.8, -15.4, Y7 - 1, Y7 + 3.5]]);
  EXIT = [-52.0, TOP, -8.6];
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
await plotMap(B, val, new URL('./out/map005_plan.png', import.meta.url).pathname, { cx: C5.x, cz: C5.z, r: 26, y0: Y1 - 5, y1: TOP + 5 });
if (process.env.ZPLOT) {
  const bands = [[HALF.E, Y1, Y2], [HALF.W, Y2, Y3], [HALF.E, Y3, Y4], [HALF.W, Y4, Y5], [HALF.E, Y5, Y6], [HALF.W, Y6, Y7], [HALF.E, Y7, TOP]];
  for (const [i, [H, a, b]] of bands.entries()) if (upTo(i + 1)) await zonePlot(B, `/tmp/z5_${i + 1}.png`, { x0: H.x0 - 1, x1: H.x1 + 1, z0: Z0 - 1, z1: Z1 + 2, y0: a, y1: b + 1, routes: B.routes, title: `zone ${i + 1}: ${a}–${b}` });
}
console.log('route points', JSON.stringify(Object.fromEntries(Object.entries(B.routes).map(([k, v]) => [k, v.length]))));
if (process.env.NOWRITE) process.exit(0);
const zones = [
  { id: 'A', name: 'Cổng Đồ Chơi', y0: 718, y1: 750, color: '#ffc928' },
  { id: 'B', name: 'Xưởng Robot', y0: 750, y1: 780, color: '#2f7fe0' },
  { id: 'C', name: 'Đường Ray Trên Mây', y0: 780, y1: 810, color: '#e3262e' },
  { id: 'D', name: 'Đường Đua Trên Cao', y0: 810, y1: 840, color: '#ff8a1f' },
  { id: 'E', name: 'Sân Bập Bênh', y0: 840, y1: 870, color: '#3cc45a' },
  { id: 'F', name: 'Hẻm Núi Xếp Hình', y0: 870, y1: 900, color: '#b9a2f0' },
  { id: 'G', name: 'Đỉnh Đồ Chơi', y0: 900, y1: 940, color: '#ffffff' },
];
const data = B.toJSON({
  id: 'map005', name: 'Toy Universe', version: 1, height: TOP - Y1, origin: [0, Y1, 0],
  spawn: { p: SPAWN, yaw: 0 },
  exit: { p: EXIT, r: 2.6, next: 'map006', label: 'Map 006', gate: { p: [EXIT[0], EXIT[1], r2(EXIT[2] - 1.8)], yaw: 0, w: 4.4, h: 4.2 } },
  finishHint: 'Gợi ý: Toy Universe giấu 7 viên đá quý sau gấu bông, robot, ngôi nhà, đường đua, ngựa gỗ và tháp khối – gom đủ 5 viên là cổng tắt ở Đỉnh Đồ Chơi mở ra…',
  challengeTime: 1700,
  zones, milestones: [740, 760, 780, 800, 820, 840, 860, 880, 900, 920, 935],
  region: { c: [C5.x, C5.z], r: RING },
  terrain: { style: 'none', radius: RING, center: [C5.x, Y1 + 20, C5.z], wallTop: 0, plazas: [], paths: [] },
  movers, pads: [], rings: [], ladders: [], devices,
  prefabFiles: Object.fromEntries([...new Set(B.prefabs.map((p) => p.id))].map((id) => [id, `${A}/${id}`])),
  waypoints: makeWaypoints(B.routes, zones),
});
fs.mkdirSync(`${ROOT}packs/map005/maps`, { recursive: true });
// ---------------------------------------------------------------- ambient scenery (the artist's 15 PNGs)
// far toy city / viaduct / ferris wheel / ring stacker (still), bobbing toy islands, clouds and blimps drifting,
// balloons and kites, toy and paper planes circling, birds; Map 006's mushroom island hangs high above the summit
{
  let seed = 5005;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const R = (a, b) => a + (b - a) * rnd();
  const at = (r, a, y) => [r2(C5.x + Math.cos(a) * r), r2(y), r2(C5.z + Math.sin(a) * r)];
  const S = [];
  for (const [n, a, r, y, h] of [['toy_city_far', 0.4, 185, 760, 75], ['toy_city_far', 3.3, 195, 840, 80], ['train_viaduct_far', 1.6, 175, 800, 60], ['train_viaduct_far', 4.9, 170, 880, 55],
    ['ferris_wheel_far', 2.4, 165, 860, 70], ['ferris_wheel_far', 5.7, 180, 760, 65], ['ring_stacker_far', 1.0, 150, 900, 45], ['ring_stacker_far', 4.1, 155, 790, 40]]) S.push({ n, p: at(r, a, y), h });
  const isl = ['toy_island_far', 'teddy_island_far', 'blocks_pile'];
  for (let i = 0; i < 12; i++) S.push({ n: isl[i % 3], p: at(R(75, 125), i * 0.52 + R(0, 0.3), R(705, 945)), h: r2(R(20, 32)), mv: { k: 'bob', a: r2(R(1.0, 2.2)), s: r2(R(0.18, 0.3)), ph: r2(R(0, 6.28)) } });
  // the next map: mushroom islands high over the summit
  S.push({ n: 'mushroom_island_far', p: at(68, 2.2, TOP + 55), h: 48, mv: { k: 'bob', a: 1.6, s: 0.15, ph: 0.4 } });
  S.push({ n: 'mushroom_island_far', p: at(118, 5.0, TOP + 80), h: 40, mv: { k: 'bob', a: 1.2, s: 0.12, ph: 2.1 } });
  const cl = ['cloud_white_a', 'cloud_white_b'];
  for (let i = 0; i < 32; i++) { const a = R(0, 6.28), r = R(42, 140); S.push({ n: cl[i % 2], p: at(r, a, R(690, 990)), h: r2(R(9, 22)), mv: { k: 'drift', span: r2(R(90, 150)), s: r2(R(0.7, 1.5)), d: r2(a + Math.PI / 2), a: 0.8, ph: r2(rnd()) } }); }
  for (let i = 0; i < 3; i++) { const a = R(0, 6.28); S.push({ n: 'toy_blimp', p: at(R(95, 125), a, R(780, 960)), h: r2(R(14, 18)), mv: { k: 'drift', span: r2(R(120, 170)), s: r2(R(0.5, 0.8)), d: r2(a + Math.PI / 2), a: 1.2, ph: r2(rnd()) } }); }
  for (let i = 0; i < 10; i++) { const a = R(0, 6.28); S.push({ n: 'balloon_bunch', p: at(R(30, 62), a, Y1 + 10 + i * 21 + R(-4, 4)), h: r2(R(5, 8)), mv: { k: 'drift', span: r2(R(50, 70)), s: r2(R(0.4, 0.8)), d: r2(a + Math.PI / 2 * (i % 2 ? 1 : -1)), a: 1.6, ph: r2(rnd()) } }); }
  for (let i = 0; i < 5; i++) S.push({ n: 'kite', p: at(R(34, 50), i * 1.26 + R(0, 0.4), Y1 + 25 + i * 42), h: r2(R(5, 7)), mv: { k: 'bob', a: r2(R(1.4, 2.4)), s: r2(R(0.3, 0.5)), ph: r2(R(0, 6.28)) } });
  for (let i = 0; i < 10; i++) S.push({ n: i % 3 === 0 ? 'toy_plane' : 'paper_plane', p: [C5.x, r2(Y1 + 14 + i * 22), C5.z], h: r2(i % 3 === 0 ? R(5, 7) : R(2.5, 3.5)), mv: { k: 'orbit', r: r2(R(26, 42)), s: r2(R(0.05, 0.09) * (i % 2 ? -1 : 1)), a: 1.0, ph: r2(R(0, 6.28)) } });
  data.atlas = `${A}/map005_atlas`;
  data.sprites = S;
  data.fx = [...(data.fx ?? []), { t: 'birds', p: [C5.x, 770, C5.z], r: 52, n: 6, c: '#4a5a7a' }, { t: 'birds', p: [C5.x, 850, C5.z], r: 60, n: 7, c: '#4a5a7a' }, { t: 'birds', p: [C5.x, 925, C5.z], r: 48, n: 5, c: '#4a5a7a' }];
  console.log(`scenery: ${S.length} sprites, ${data.fx.length} fx`);
}
applyI18n(data);
fs.writeFileSync(`${ROOT}packs/map005/maps/map005.json`, JSON.stringify(data));
fs.writeFileSync(new URL('./out/routes005.json', import.meta.url), JSON.stringify(B.routes));
{
  const { referencedFiles } = await import('./content.mjs');
  const dir = `${ROOT}packs/map005/`;
  const include = ['maps/map005.json', ...[...referencedFiles(data)].filter((f) => fs.existsSync(dir + f))].sort();
  const pf = dir + 'pack.json';
  const old = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  const meta = {
    id: 'map005', name: 'Toy Universe', order: 5, yMin: Y1 - 2, yMax: TOP + 40, entry: 'maps/map005.json', minApp: 3, requires: [],
    summary: 'Thế giới đồ chơi khổng lồ · 720 → 935 m · 7 khu · gấu bông, robot, tàu hoả, xe đua, con quay, bập bênh, ngựa gỗ, đại bác đồ chơi và lối bí mật',
    include, ...(old.version ? { version: old.version, contentHash: old.contentHash } : {}),
  };
  applyPackI18n('map005', meta);
  fs.writeFileSync(pf, JSON.stringify(meta, null, 1) + '\n');
  console.log(`pack.json: ${include.length} files`);
}
console.log(`prefabs ${B.prefabs.length}, kit ${B.kit.length}, devices ${devices.length}, movers ${movers.length}`);
