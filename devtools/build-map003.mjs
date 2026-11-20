// Map 003 – Container Port (318.7 -> 520 m). An industrial container port built as a tower in the sky, entered
// through Map 002's summit gate. Seven zones climb two interleaved halves (W / E) of one footprint:
// every zone is built ABOVE its own start deck, and the next zone's deck sits in the other half – so a fall
// lands on the deck where the current zone started (never back down through several maps).
// Run: node devtools/build-map003.mjs -> packs/map003/maps/map003.json (+ devtools/out/map003_plan.png, routes003.json)
import fs from 'fs';
import { MapBuilder, r2, makeWaypoints } from './mapgen/lib.mjs';
import { plotMap } from './mapgen/plot.mjs';

const C3 = { x: -60, z: -10 }; // centre of the footprint
const RING = 24; // invisible boundary ring (above 334 m) around C3
const Y1 = 318.74, Y2 = 345, Y3 = 370, Y4 = 400, Y5 = 430, Y6 = 460, Y7 = 495, TOP = 520;
const HALF = { W: { x0: -77, x1: -60, xc: -68.5 }, E: { x0: -60, x1: -43, xc: -51.5 } };
const Z0 = -24, Z1 = 4;
const B = new MapBuilder({ ground: { x: C3.x, y: -999, z: C3.z, r: 0 } });
B.seed = 11;

// ---------------------------------------------------------------- pieces (records carry their footprint)
const CONT = { s: 2.6, hx: 1.13, hz: 2.68, roof: 0.94 * 2.6, pitch: 2.6 };
const COLORS = ['shipping_container', 'container_red', 'container_yellow', 'container_green'];
let colorI = 0;
const nextColor = () => COLORS[(colorI++ * 7 + 3) % 4];
const ext = (hx, hz, yaw) => (Math.abs(Math.round(yaw / 90)) % 2 === 1 ? [hz, hx] : [hx, hz]);
/** stack of n containers on `base`; yaw 0 = long axis along z. Returns the roof record. */
function stack(x, z, base, n, yaw = 0, o = {}) {
  for (let i = 0; i < n; i++) B.prefab(o.color ?? nextColor(), x, base + i * CONT.pitch, z, yaw, CONT.s, { name: o.name ?? 'container' });
  const [hx, hz] = ext(CONT.hx, CONT.hz, yaw);
  return { x, z, hx, hz, top: r2(base + (n - 1) * CONT.pitch + CONT.roof), kind: 'container' };
}
/** steel crate (jump block): 3.3 x 1.56 x 1.2 at s=1.3 */
function crate(x, z, base, yaw = 0, s = 1.3) {
  B.prefab('steel_crate', x, base, z, yaw, s, { name: 'steel crate' });
  const [hx, hz] = ext(1.24 * s, 0.6 * s, yaw);
  return { x, z, hx, hz, top: r2(base + 0.92 * s), kind: 'crate' };
}
/** wooden pallet on a steel stand: 2.8 x 2.9 x 1.5 at s=1.5 */
function pallet(x, z, base, yaw = 0, s = 1.5) {
  B.prefab('cargo_pallet_stand', x, base, z, yaw, s, { name: 'pallet stand' });
  return { x, z, hx: 0.9 * s, hz: 0.9 * s, top: r2(base + 0.99 * s), kind: 'pallet' };
}
/** grate platform on steel posts down to whatever is below */
function plat(x, z, top, w, d, o = {}) {
  B.kitPiece('slab', [x, top, z], [w, 0.3, d], 0, { m: o.m ?? 'grate' });
  const below = B.surfaceBelow(x, z, top - 0.35);
  if (o.posts !== false && top - below < 40) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = x + sx * (w / 2 - 0.2), pz = z + sz * (d / 2 - 0.2);
      const b = B.surfaceBelow(px, pz, top - 0.35);
      if (top - 0.3 - b > 0.3 && top - b < 40) B.kitPiece('slab', [px, top - 0.3, pz], [0.22, r2(top - 0.3 - b), 0.22], 0, { m: 'yellow', nc: true });
    }
  } else if (o.hang !== false) {
    // hangs from the deck above on two rods (visual)
    for (const sx of [-1, 1]) B.kitPiece('slab', [x + sx * (w / 2 - 0.3), top + 6, z], [0.08, 6, 0.08], 0, { m: 'dark', nc: true });
  }
  return { x, z, hx: w / 2, hz: d / 2, top, kind: 'plat' };
}
/** big deck (zone start): grate floor on girders, rails on the given edges */
function deck(name, x0, x1, z0, z1, y, rails = 'NSEW', o = {}) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  B.kitPiece('slab', [cx, y, cz], [w, 0.5, d], 0, { m: o.m ?? 'metal', name });
  // girders underneath (visual)
  for (let i = 0; i <= Math.floor(w / 4); i++) B.kitPiece('girder', [x0 + 0.4 + (i * (w - 0.8)) / Math.max(1, Math.floor(w / 4)), y - 0.5, cz], [0.5, 1.2, d - 0.4], 0, { nc: true });
  B.kitPiece('girder', [cx, y - 0.5, z0 + 0.3], [0.5, 1.2, w], 90, { nc: true });
  B.kitPiece('girder', [cx, y - 0.5, z1 - 0.3], [0.5, 1.2, w], 90, { nc: true });
  const gaps = o.gaps ?? [];
  const railRun = (a0, a1, fixed, edge) => {
    // split around gaps (entries / exits) given as [edge, from, to]
    let segs = [[a0, a1]];
    for (const [e, g0, g1] of gaps) if (e === edge) segs = segs.flatMap(([s0, s1]) => [[s0, Math.min(s1, g0)], [Math.max(s0, g1), s1]]).filter(([s0, s1]) => s1 - s0 > 0.6);
    for (const [s0, s1] of segs) {
      const L = s1 - s0, m = (s0 + s1) / 2;
      if (edge === 'N' || edge === 'S') B.kitPiece('rail', [m, y + 1.1, fixed], [L, 1.1], 0, { m: 'dark' });
      else B.kitPiece('rail', [fixed, y + 1.1, m], [L, 1.1], 90, { m: 'dark' });
    }
  };
  if (rails.includes('N')) railRun(x0 + 0.1, x1 - 0.1, z0 + 0.12, 'N');
  if (rails.includes('S')) railRun(x0 + 0.1, x1 - 0.1, z1 - 0.12, 'S');
  if (rails.includes('W')) railRun(z0 + 0.1, z1 - 0.1, x0 + 0.12, 'W');
  if (rails.includes('E')) railRun(z0 + 0.1, z1 - 0.1, x1 - 0.12, 'E');
  return { x: cx, z: cz, hx: w / 2, hz: d / 2, top: y, x0, x1, z0, z1, kind: 'deck' };
}
/** I-beam walkway from a to b (same height = walking surface), about w wide. The beam model (6.875 x 0.972, top 0.93)
 * is laid in whole segments: the scale is fitted so they end exactly at b (the width varies a little). */
const IBEAM = { len: 6.875, w: 0.972, top: 0.93 };
function ibeam(a, b, w = 0.6, o = {}) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(L / (IBEAM.len * (w / IBEAM.w))));
  const s = L / (n * IBEAM.len);
  const yaw = (Math.atan2(dx, dz) * 180) / Math.PI + 90; // model long axis = local x
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    B.prefab('steel_ibeam', a[0] + dx * t, a[1] - IBEAM.top * s, a[2] + dz * t, r2(yaw), r2(s), { name: o.name ?? 'i-beam' });
  }
  return { len: L, n, w: r2(IBEAM.w * s) };
}
/** legged balance beam standing on a surface (the easy, wide one) */
function legBeam(x, z, base, yaw, s = 2.4) {
  B.prefab('balance_beam', x, base, z, yaw, s, { name: 'balance beam' });
  return { x, z, top: r2(base + 0.92 * s), len: 2.6 * s, w: 0.4 * s };
}
/** steel column (visual + collider) from y0 up to y1 */
const column = (x, z, y0, y1, w = 0.9) => B.kitPiece('slab', [x, y1, z], [w, r2(y1 - y0), w], 0, { m: 'girder', name: 'column' });

const P = (rec, dx = 0, dz = 0) => [r2(rec.x + dx), rec.top, r2(rec.z + dz)];
const ladders = [];
function ladder(x, y0, z, h, r, nv = false) { const d = { p: [r2(x), r2(y0), r2(z)], h: r2(h), r }; if (nv) d.nv = true; ladders.push(d); return d; }
const pads = [];
const PADM = { file: 'assets/map003/bounce_pad', w: 1.54, d: 1.54, top: 0.35 };
/** bounce pad (top surface at y) aimed at tg */
function pad(x, y, z, r, v, s, tg) {
  B.kitPiece('solid', [x, r2(y - 0.02), z], [PADM.w * s, r2(PADM.top * s - 0.05), PADM.d * s], r, { vo: true });
  const d = { t: 'jump', p: [r2(x), r2(y), r2(z)], r, v, s };
  if (tg) d.tg = tg.map(r2);
  pads.push(d);
  return [r2(x), r2(y), r2(z)];
}
const movers = [];
const TROLLEY = { deck: 0.12, hx: 0.62, z0: -0.35, z1: 0.33, railTop: 0.93 };
const OPEN_YAW = { N: 0, S: 180, E: -90, W: 90 }; // trolley yaw that puts its open (-z) side towards that compass side
/** Platform hanging from a trolley on an overhead rail, from a to b (deck-top centres, same y). The path must run along
 * x for an open side N/S and along z for E/W. Returns its footprint at both ends. */
function trolley(id, a, b, open, o = {}) {
  const s = o.s ?? 5, r = OPEN_YAW[open];
  const alongX = open === 'N' || open === 'S';
  if (alongX ? Math.abs(a[2] - b[2]) > 1e-6 : Math.abs(a[0] - b[0]) > 1e-6) throw new Error(`trolley ${id}: path must run along ${alongX ? 'x' : 'z'}`);
  movers.push({ id, kind: 'hover', look: 'trolley', pts: [a, b], speed: o.speed ?? 2.4, wait: o.wait ?? 2.4, s, r, phase: o.phase ?? 0 });
  // static rail (kit girder; the car's own short rail section hides it where the car is) + end posts
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]), ext = TROLLEY.hx * s + 0.6;
  const railTop = r2(a[1] + (TROLLEY.railTop - TROLLEY.deck) * s);
  const cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2;
  B.kitPiece('girder', [r2(cx), railTop, r2(cz)], [r2(0.1 * s), r2(0.25 * s), r2(L + 2 * ext)], alongX ? 90 : 0, { m: 'yellow', name: 'trolley rail' });
  const ux = alongX ? Math.sign(b[0] - a[0]) : 0, uz = alongX ? 0 : Math.sign(b[2] - a[2]);
  for (const [px, pz] of [[a[0] - ux * ext, a[2] - uz * ext], [b[0] + ux * ext, b[2] + uz * ext]]) {
    const bot = B.surfaceBelow(px, pz, railTop - 0.4);
    B.kitPiece('slab', [r2(px), railTop, r2(pz)], [0.45, r2(railTop - bot), 0.45], 0, { m: 'yellow', nc: true });
    B.kitPiece('slab', [r2(px - (alongX ? 0 : 0.6)), r2(railTop + 0.25), r2(pz - (alongX ? 0.6 : 0))], [alongX ? 0.45 : 1.6, 0.25, alongX ? 1.6 : 0.45], 0, { m: 'yellow', nc: true });
  }
  B.node(a); B.node(b);
  const fp = (p) => {
    const hx = TROLLEY.hx * s, z0 = TROLLEY.z0 * s, z1 = TROLLEY.z1 * s;
    // open side is the model's -z side; world box of the car at p
    if (open === 'N') return { x0: p[0] - hx, x1: p[0] + hx, z0: p[2] + z0, z1: p[2] + z1 };
    if (open === 'S') return { x0: p[0] - hx, x1: p[0] + hx, z0: p[2] - z1, z1: p[2] - z0 };
    if (open === 'E') return { x0: p[0] - z1, x1: p[0] - z0, z0: p[2] - hx, z1: p[2] + hx };
    return { x0: p[0] + z0, x1: p[0] + z1, z0: p[2] - hx, z1: p[2] + hx };
  };
  sweeps.push({ id, kind: 'trolley', y0: a[1] - 0.6, y1: railTop + 0.4, boxes: [fp(a), fp(b)] });
  return { A: fp(a), B: fp(b), railTop };
}
/** Lift tower (static frame, s m tall) at base with yaw; its car runs from 0.12 s to 0.83 s up the tower's front (+z). */
const LIFT = { lo: 0.12, hi: 0.83, deck: 0.43, cx: -0.005, cz: 0.12, hx: 0.18, hz: 0.13, fx: 0.23, fz: 0.256 };
function liftTower(id, base, yaw, s = 13, o = {}) {
  B.prefab('lift_frame', base[0], base[1], base[2], yaw, s, { name: 'lift tower' });
  const c = Math.cos((yaw * Math.PI) / 180), sn = Math.sin((yaw * Math.PI) / 180);
  const W = (lx, lz) => [r2(base[0] + (lx * c + lz * sn) * s), r2(base[2] + (-lx * sn + lz * c) * s)];
  const [cx, cz] = W(LIFT.cx, LIFT.cz);
  const A = [cx, r2(base[1] + LIFT.lo * s), cz], Bp = [cx, r2(base[1] + LIFT.hi * s), cz];
  movers.push({ id, kind: 'hover', look: 'lift', pts: [A, Bp], speed: o.speed ?? 2.0, wait: o.wait ?? 2.4, s, r: yaw, phase: o.phase ?? 0 });
  B.node(A); B.node(Bp);
  const quarter = Math.abs(Math.round(yaw / 90)) % 2 === 1;
  const hx = (quarter ? LIFT.hz : LIFT.hx) * s, hz = (quarter ? LIFT.hx : LIFT.hz) * s;
  const car = { x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz };
  sweeps.push({ id, kind: 'lift', y0: A[1] - 0.5, y1: Bp[1] + 0.2, boxes: [car] });
  const front = W(LIFT.cx, LIFT.cz + LIFT.hz + 0.12 * (5 / s) + 0.05); // a point just in front of the car (for boarding marks)
  return { A, B: Bp, car, front, top: r2(base[1] + 0.83 * s), W };
}
/** Container swinging on a cable: pivot, cable length, amplitude (deg), period, swing direction yaw. A = the -amp end. */
const HANGC = { roof: 0.37, hx: 0.354, hz: 0.195 };
function swing(id, pivot, len, amp, period, r, o = {}) {
  const s = o.s ?? 6.5, rad = (r * Math.PI) / 180, th = (amp * Math.PI) / 180;
  const at = (sg) => [r2(pivot[0] + Math.sin(rad) * Math.sin(th * sg) * len), r2(pivot[1] - Math.cos(th) * len), r2(pivot[2] + Math.cos(rad) * Math.sin(th * sg) * len)];
  const A = at(-1), Bp = at(1);
  movers.push({ id, kind: 'swing', pts: [A, Bp], pivot, len, amp, period, r, s, speed: 0, wait: 0, phase: o.phase ?? 0 });
  // the gantry it hangs from: arm across the swing, legs on columns down to whatever is below
  const sg = o.armS ?? 7;
  const armBase = r2(pivot[1] - 0.785 * sg);
  B.prefab('gantry_arm', pivot[0], armBase, pivot[2], r, sg, { name: 'gantry arm', col: false });
  const ax = Math.cos(rad), az = -Math.sin(rad); // the arm's long axis (model x) in the world
  for (const sd of [-1, 1]) {
    const lx = pivot[0] + ax * sd * 0.6 * sg, lz = pivot[2] + az * sd * 0.6 * sg;
    const bot = B.surfaceBelow(lx, lz, armBase - 0.2);
    if (armBase - bot < 60) B.kitPiece('slab', [r2(lx), armBase, r2(lz)], [0.7, r2(armBase - bot), 0.7], 0, { m: 'yellow', name: 'gantry leg' });
  }
  B.node(A); B.node(Bp);
  const hl = HANGC.hx * s, hw = HANGC.hz * s; // half length along the swing, half width across
  const fp = (p) => (Math.abs(Math.sin(rad)) > 0.5 ? { x0: p[0] - hl, x1: p[0] + hl, z0: p[2] - hw, z1: p[2] + hw } : { x0: p[0] - hw, x1: p[0] + hw, z0: p[2] - hl, z1: p[2] + hl });
  const lo = fp([pivot[0], 0, pivot[2]]), fa = fp(A), fb = fp(Bp);
  sweeps.push({ id, kind: 'swing', y0: r2(pivot[1] - len - HANGC.roof * s - 0.3), y1: r2(Math.max(A[1], Bp[1]) + 0.63 * s + 0.3), boxes: [fa, fb, lo] });
  return { A, B: Bp, fa, fb, roofHalf: [hl, hw] };
}
/** Crane jib turning between yaw a0 and a1 about its slewing ring at `center` (walkway top at center.y). The stand points
 * (route marks) sit `arm` from the axis along the jib, on the walkway (offset `off` sideways). */
const JIB = { walk: 0.54, arm: 1.85, off: 0.1725, tip: 2.07 };
function rotor(id, center, s, a0, a1, o = {}) {
  const arm = r2(JIB.arm * s), off = r2(JIB.off * s);
  const tip = (a) => { const r = (a * Math.PI) / 180; return [r2(center[0] + off * Math.cos(r) + arm * Math.sin(r)), center[1], r2(center[2] - off * Math.sin(r) + arm * Math.cos(r))]; };
  movers.push({ id, kind: 'rotor', pts: [tip(a0), tip(a1)], center, arm, off, s, a0, a1, speed: o.speed ?? 24, wait: o.wait ?? 2.6, phase: o.phase ?? 0 });
  // mast: yellow lattice column from the floor below to the slewing ring
  const ringY = r2(center[1] - JIB.walk * s);
  const bot = B.surfaceBelow(center[0], center[2], ringY - 0.2);
  B.kitPiece('slab', [center[0], ringY, center[2]], [1.9, r2(ringY - bot), 1.9], 0, { m: 'yellow', name: 'jib mast' });
  B.kitPiece('slab', [center[0], r2(ringY - 0.6), center[2]], [3.2, 0.5, 3.2], 0, { m: 'dark', nc: true });
  B.node(tip(a0)); B.node(tip(a1));
  sweeps.push({ id, kind: 'rotor', y0: r2(ringY - 0.3), y1: r2(center[1] + 0.5 * s), circle: { x: center[0], z: center[2], r: r2(JIB.tip * s + 0.3), a0, a1 } });
  return { A: tip(a0), B: tip(a1) };
}
/** jump pad hint arrow etc. are drawn by the game */
const sweeps = [];
/** central divider (grate wall) between the halves for one zone band, with openings [z0, z1, y0, y1] */
function divider(y0, y1, holes = []) {
  // split the z range around the holes; a hole only spans its own y range
  const cuts = [...new Set([Z0, Z1, ...holes.flatMap(([a, b]) => [a, b])])].sort((p, q) => p - q);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const za = cuts[i], zb = cuts[i + 1];
    if (zb - za < 0.05) continue;
    const zc = (za + zb) / 2;
    let segs = [[y0, y1]];
    for (const [hz0, hz1, hy0, hy1] of holes) if (zc > hz0 && zc < hz1) segs = segs.flatMap(([a, b]) => [[a, Math.min(b, hy0)], [Math.max(a, hy1), b]]).filter(([a, b]) => b - a > 0.2);
    for (const [a, b] of segs) B.kitPiece('slab', [-60, r2(b), r2(zc)], [0.3, r2(b - a), r2(zb - za)], 0, { m: 'grate', name: 'divider' });
  }
}
/** invisible boundary around the whole footprint (from 334 m up) */
function boundary() {
  const y0 = 334, y1 = TOP + 45, yc = (y0 + y1) / 2, hy = (y1 - y0) / 2;
  B.kitPiece('wall', [-60, r2(yc), Z0 - 0.9], [18.5, r2(hy), 0.5]);
  B.kitPiece('wall', [-60, r2(yc), Z1 + 0.9], [18.5, r2(hy), 0.5]);
  B.kitPiece('wall', [HALF.W.x0 - 0.9, r2(yc), -10], [0.5, r2(hy), 15.5]);
  B.kitPiece('wall', [HALF.E.x1 + 0.9, r2(yc), -10], [0.5, r2(hy), 15.5]);
}

// =====================================================================================
// THE PORT DECK (318.7): Map 002's summit gate opens onto it. It spans the whole footprint and is the floor
// everything else stands on (a fall from zones 1–2 ends here at worst).
// =====================================================================================
const BASE = deck('port deck', -83, -39.3, -33, 13, Y1, 'NSW', { m: 'metal' });
B.kitPiece('rock', [-61, Y1 - 0.5, -10], [44, 46, 30], 0);
const GATE_IN = [-40.6, Y1, -9.2];
B.mark('main', GATE_IN, 'Map 002 gate');
// columns of the tower frame (corners + middle of the long sides), up to the summit
for (const [x, z] of [[-77.6, -24.6], [-77.6, 4.6], [-42.4, -24.6], [-42.4, 4.6], [-60, -24.6], [-60, 4.6]]) column(x, z, Y1, TOP - 4, 1.0);
B.kitPiece('sign', [-43.0, Y1 + 5.2, -24.0], [5.6, 1.4], 90, { m: 'CONTAINER PORT|Cảng container trên mây · 320 → 520 m' });

// =====================================================================================
// ZONE 1 – CARGO ENTRY (319–345, east half): crates, pallet stands, container stacks, a steel bridge
// =====================================================================================
const z1 = [];
const c1 = crate(-44.2, -4.5, Y1, 90); z1.push(c1);
const k1 = stack(-46.9, 0.2, Y1, 1, 90); z1.push(k1);
const c2 = crate(-48.6, 0.2, k1.top, 0); z1.push(c2);
const k2 = stack(-53.4, -0.6, Y1, 2, 0); z1.push(k2);
const p1 = pallet(-53.4, -2.3, k2.top, 0); z1.push(p1);
const k3 = stack(-53.4, -7.2, Y1, 3, 90); z1.push(k3);
const c3 = crate(-50.2, -7.2, k3.top, 90); z1.push(c3);
const k4 = stack(-46.4, -9.7, Y1, 4, 0); z1.push(k4);
const p2 = pallet(-46.4, -11.4, k4.top, 0); z1.push(p2);
const k5 = stack(-46.0, -16.8, Y1, 5, 90); z1.push(k5);
// steel bridge (catwalk) from k5 west to k6, both 5 high: its legs stand on the two roofs
const k6 = stack(-56.0, -16.8, Y1, 5, 90);
B.prefab('steel_catwalk', -51.0, k5.top, -16.8, 0, 3.0, { name: 'catwalk' });
const bridge = { x: -51.0, z: -16.8, hx: 3.3, hz: 1.2, top: r2(k5.top + 0.67 * 3.0) };
const c4 = crate(-56.0, -15.6, k6.top, 0);
const k7 = stack(-56.2, -21.0, Y1, 7, 90);
const p3 = pallet(-53.6, -21.0, k7.top, 0);
const k8 = stack(-51.8, -14.4, Y1, 8, 0, { color: 'container_red' });
const c5 = crate(-51.8, -12.6, k8.top, 0);
const k9 = stack(-57.6, -10.6, Y1, 9, 0, { color: 'container_yellow' });
for (const [rec, lab] of [[c1, 'crate'], [k1, 'K1'], [c2, 'crate on K1'], [k2, 'K2'], [p1, 'pallet'], [k3, 'K3'], [c3, 'crate on K3'], [k4, 'K4'], [p2, 'pallet on K4'], [k5, 'K5']]) B.mark('main', P(rec), lab);
B.mark('main', P(bridge, 2.4), 'bridge east');
B.mark('main', P(bridge, -2.4), 'bridge west');
B.mark('main', P(c4), 'crate on K6');
B.mark('main', P(k7, 1.4), 'K7');
B.mark('main', P(p3), 'pallet on K7');
B.mark('main', P(k8, 0, -1.4), 'K8');
B.mark('main', P(c5), 'crate on K8');
B.mark('main', P(k9, 0, 1.4), 'K9 (ledge up to deck 2)');

// =====================================================================================
// ZONE 2 – STEEL BALANCE (345–370, west half): wide beam, long narrow beams, narrow beams with jumps
// =====================================================================================
const D2 = deck('deck 2', HALF.W.x0, HALF.W.x1, Z0, Z1, Y2, 'NSW', { gaps: [['E', -16, -4]] });
const D2in = [r2(HALF.W.x1 - 1.0), Y2, -10.6];
B.mark('main', D2in, 'deck 2');
// level 1: the wide, short beam on legs (on the deck)
const lb = legBeam(-66.0, -10.6, Y2, 90, 2.6);
B.mark('main', [-63.6, lb.top, -10.6], 'wide beam east');
B.mark('main', [-68.4, lb.top, -10.6], 'wide beam west');
const k21 = stack(-72.6, -10.6, Y2, 1, 0);
B.mark('main', P(k21), 'K21');
// level 2: long narrow beam K22 -> K23 (0.55 wide, 11 m)
const k22 = stack(-72.6, -3.0, Y2, 2, 0, { color: 'container_red' });
B.mark('main', P(k22, 0, 1.6), 'K22');
const k23 = stack(-62.4, 0.0, Y2, 2, 90, { color: 'container_green' });
ibeam([-71.4, k22.top, 0.6], [-65.2, k22.top, 0.6], 0.55);
ibeam([-65.2, k22.top, 0.6], [-65.2, k22.top, -6.0], 0.55);
B.mark('main', [-69.0, k22.top, 0.6], 'narrow beam');
B.mark('main', [-65.2, k22.top, 0.6], 'beam corner');
B.mark('main', [-65.2, k22.top, -3.0], 'narrow beam 2');
// level 3: narrow beams with jumps, cantilevered from a container column out into the air
const k24 = stack(-65.2, -9.0, Y2, 3, 90, { color: 'container_yellow' });
B.mark('main', P(k24, 1.2), 'K24');
const b3y = r2(k24.top + 1.3);
ibeam([-67.8, b3y, -9.0], [-71.6, b3y, -9.0], 0.5); // sticks out west over the deck
B.kitPiece('slab', [-68.0, r2(b3y - 0.12), -9.0], [0.3, 0.9, 0.3], 0, { m: 'dark', nc: true });
const c21 = crate(-66.6, -9.0, k24.top, 90);
B.mark('main', P(c21), 'crate on K24');
B.mark('main', [-70.8, b3y, -9.0], 'cantilever beam');
const b4y = r2(b3y + 1.1);
ibeam([-73.4, b4y, -12.0], [-73.4, b4y, -17.0], 0.5);
B.mark('main', [-73.4, b4y, -12.8], 'beam hop 1');
B.mark('main', [-73.4, b4y, -16.2], 'beam hop 1 end');
const b5y = r2(b4y + 1.1);
ibeam([-70.6, b5y, -19.0], [-66.0, b5y, -19.0], 0.5);
B.mark('main', [-70.0, b5y, -19.0], 'beam hop 2');
B.mark('main', [-66.6, b5y, -19.0], 'beam hop 2 end');
const b6y = r2(b5y + 1.1);
ibeam([-63.4, b6y, -17.0], [-63.4, b6y, -12.0], 0.5);
B.mark('main', [-63.4, b6y, -16.4], 'beam hop 3');
B.mark('main', [-63.4, b6y, -12.6], 'beam hop 3 end');
// supports for the floating beams: thin hangers from girders above (visual)
for (const [x, y, z] of [[-73.4, b4y, -14.5], [-68.3, b5y, -19.0], [-63.4, b6y, -14.5]]) B.kitPiece('slab', [x, r2(y + 9), z], [0.1, 9, 0.1], 0, { m: 'dark', nc: true });
const k25 = stack(-61.3, -9.0, Y2, 5, 0, { color: 'container_red' });
B.mark('main', P(k25, 0, -1.6), 'K25');
// up the divider to deck 3 (the divider of this band carries the ladder)
ladder(-60.15, k25.top, -10.0, r2(Y3 - k25.top), -90);
B.mark('main', [-60.5, k25.top, -10.0], 'ladder foot (to deck 3)', 'ladder');
B.link([-60.5, k25.top, -10.0], [-59.2, Y3, -10.0], 'ladder');
divider(Y2, Y3 - 0.5, [[-14, -7, Y2 - 1, Y2 + 3]]);
console.log('zones 1-2 placed');

// =====================================================================================
// ZONE 3 – MOVING CARGO (370–400, east half): a lift, a trolley ride, a stack climb, an I-beam, a second trolley that
// hands over to a second lift (both stop there together: wait for it), then over the divider to deck 4
// =====================================================================================
const D3 = deck('deck 3', -60.5, HALF.E.x1, Z0, Z1, Y3, 'NSE', {});
const E3 = [-59.2, Y3, -10.0];
B.mark('main', E3, 'deck 3');
// L1: lift tower in the north-west corner, car facing south
const L1 = liftTower('L1', [-55.8, Y3, -20.4], 0, 13);
B.mark('main', [L1.A[0], Y3, r2(L1.car.z1 + 1.4)], 'L1 board');
B.mark('main', L1.A, 'L1 car (bottom)', 'hover:L1:A');
B.mark('main', L1.B, 'L1 car (top)', 'hover:L1:B');
B.link([L1.A[0], Y3, r2(L1.car.z1 + 1.4)], L1.A, 'board'); B.link(L1.A, L1.B, 'lift');
// T1: trolley south of the car top, open to the north, rides east
const t1z = r2(L1.car.z1 + 1.2 - TROLLEY.z0 * 5);
const T1 = trolley('T1', [L1.A[0], L1.B[1], t1z], [-49.6, L1.B[1], t1z], 'N');
B.mark('main', [L1.A[0], L1.B[1], t1z], 'T1 (west)', 'hover:T1:A');
B.mark('main', [-49.6, L1.B[1], t1z], 'T1 (east)', 'hover:T1:B');
B.link(L1.B, [L1.A[0], L1.B[1], t1z], 'board'); B.link([L1.A[0], L1.B[1], t1z], [-49.6, L1.B[1], t1z], 'trolley');
// north of the trolley's east stop: a grate platform, then the stack climb in the north-east corner
const P31 = plat(-49.6, r2(T1.B.z0 - 1.0 - 1.2), r2(L1.B[1] + 0.8), 3.0, 2.4, { posts: true });
B.mark('main', P(P31), 'P31');
B.link([-49.6, L1.B[1], t1z], P(P31), 'alight');
const k32 = stack(-45.0, -20.6, Y3, 6, 0); B.mark('main', P(k32, 0, 0.6), 'K32');
const pl32 = pallet(-45.0, -18.9, k32.top, 0, 1.3); B.mark('main', P(pl32), 'pallet on K32');
const k33 = stack(-45.0, -12.2, Y3, 7, 0, { color: 'container_yellow' }); B.mark('main', P(k33, 0, -1.4), 'K33');
// I-beam south along the east edge to a grate platform
const P33 = plat(-45.0, -3.0, k33.top, 3.0, 3.0);
ibeam([-45.0, k33.top, k33.z + k33.hz - 0.2], [-45.0, k33.top, -4.4], 0.6);
B.mark('main', [-45.0, k33.top, -8.0], 'I-beam');
B.mark('main', P(P33), 'P33');
// T2: trolley along the south edge, open to the north, rides west; L2's car waits north of its west stop
const t2z = r2(P33.z + P33.hz + 1.0 - TROLLEY.z0 * 5);
const T2 = trolley('T2', [-47.0, k33.top, t2z], [-55.0, k33.top, t2z], 'N', { wait: 2.6 });
B.mark('main', [-47.0, k33.top, t2z], 'T2 (east)', 'hover:T2:A');
B.mark('main', [-55.0, k33.top, t2z], 'T2 (west)', 'hover:T2:B');
B.link(P(P33), [-47.0, k33.top, t2z], 'board'); B.link([-47.0, k33.top, t2z], [-55.0, k33.top, t2z], 'trolley');
// L2: lift tower on a scaffold, car facing south (towards T2)
const l2s = 12, l2base = r2(k33.top - LIFT.lo * l2s);
const l2cz = r2(T2.B.z0 - 1.0 - LIFT.hz * l2s), l2bz = r2(l2cz - LIFT.cz * l2s);
const PL2 = plat(-54.94, l2bz, l2base, 6.0, 6.6);
const L2 = liftTower('L2', [-54.94, l2base, l2bz], 0, l2s);
B.mark('main', L2.A, 'L2 car (bottom)', 'hover:L2:A');
B.mark('main', L2.B, 'L2 car (top)', 'hover:L2:B');
B.link([-55.0, k33.top, t2z], L2.A, 'board'); B.link(L2.A, L2.B, 'lift');
// over the lift tower's roof and across the divider to deck 4
const X34z = r2(l2bz - 1.4);
B.mark('main', [-57.3, L2.top, X34z], 'L2 roof');
B.link(L2.B, [-57.3, L2.top, X34z], 'alight');
divider(Y3, Y4 - 0.5, [[-11.5, -8.5, Y3 - 1, Y3 + 3]]);
void D3; void PL2;
console.log('zone 3 placed');
let EXIT = [-61.0, Y4, X34z];
const STAGE = process.env.STAGE ?? 'all';
if (STAGE === 'all') {
  // =====================================================================================
  // ZONE 4 – CRANE CROSSING (400–430, west half): a swinging container, a turning crane jib, a second swing, up and over
  // =====================================================================================
  const D4 = deck('deck 4', HALF.W.x0, -59.5, Z0, Z1, Y4, 'NSW', {});
  const E4 = [-61.0, Y4, X34z];
  B.mark('main', E4, 'deck 4');
  const k41 = stack(-63.2, -9.8, Y4, 1, 0); B.mark('main', P(k41, 0, 1.2), 'K41');
  const k42 = stack(-63.2, -15.8, Y4, 2, 0); B.mark('main', P(k42, 0, 1.0), 'K42');
  const k43 = stack(-66.8, -21.2, Y4, 2, 90); B.mark('main', P(k43, 1.6), 'K43');
  const c43 = crate(-67.9, -21.2, k43.top, 0); B.mark('main', P(c43), 'crate on K43');
  // S1: swings north <-> south on the west side
  const s1y = r2(c43.top - 0.24);
  const S1 = swing('S1', [-72.6, r2(s1y + 9 * Math.cos((26 * Math.PI) / 180)), -13.4], 9, 26, 6.2, 0, { s: 6.5, armS: 7 });
  const PA = plat(-72.6, r2(S1.fa.z0 - 1.05 - 1.2), s1y, 3.0, 2.4);
  const PB = plat(-72.6, r2(S1.fb.z1 + 1.05 + 1.2), s1y, 3.0, 2.4);
  B.mark('main', P(PA), 'PA (swing 1)');
  B.mark('main', S1.A, 'S1 (north)', 'swing:S1:A');
  B.mark('main', S1.B, 'S1 (south)', 'swing:S1:B');
  B.mark('main', P(PB), 'PB');
  B.link(P(PA), S1.A, 'board'); B.link(S1.A, S1.B, 'swing'); B.link(S1.B, P(PB), 'alight');
  // R1: crane jib from the south-west to the north
  const k44 = stack(-75.6, -0.8, Y4, 3, 0, { color: 'container_red' }); B.mark('main', P(k44, 0, -1.4), 'K44');
  const pl44 = pallet(-75.6, 0.6, k44.top, 0, 1.3); B.mark('main', P(pl44), 'pallet on K44');
  const r1y = r2(pl44.top + 1.07);
  const R1 = rotor('R1', [-64.57, r1y, 0.22], 4.5, -90, -175);
  B.mark('main', R1.A, 'R1 (west)', 'rotor:R1:A');
  B.mark('main', R1.B, 'R1 (north)', 'rotor:R1:B');
  B.link(P(pl44), R1.A, 'board'); B.link(R1.A, R1.B, 'rotor');
  const k45 = stack(-67.2, -11.6, Y4, 4, 90, { color: 'container_green' }); B.mark('main', P(k45, 0.6), 'K45');
  B.link(R1.B, P(k45, 0.6), 'alight');
  const k46 = stack(-67.2, -17.0, Y4, 5, 90); B.mark('main', P(k46, -0.6), 'K46');
  // S2: swings east <-> west along the north edge, boarded from K46's north side
  const s2y = k46.top;
  const S2 = swing('S2', [-70.6, r2(s2y + 8 * Math.cos((28 * Math.PI) / 180)), -20.5], 8, 28, 6.0, -90, { s: 6.0, armS: 5.2, phase: 1.1 });
  B.mark('main', [S2.A[0], s2y, r2(k46.z - k46.hz + 0.6)], 'K46 north edge');
  B.mark('main', S2.A, 'S2 (east)', 'swing:S2:A');
  B.mark('main', S2.B, 'S2 (west)', 'swing:S2:B');
  B.link([S2.A[0], s2y, r2(k46.z - k46.hz + 0.6)], S2.A, 'board'); B.link(S2.A, S2.B, 'swing');
  const PC = plat(S2.B[0], r2(S2.fb.z1 + 1.0 + 1.2), s2y, 3.0, 2.4, { posts: true });
  B.mark('main', P(PC), 'PC');
  B.link(S2.B, P(PC), 'alight');
  // the climb back east and over the divider at 430
  const k47 = stack(-75.2, -7.6, Y4, 7, 0, { color: 'container_yellow' }); B.mark('main', P(k47, 0, -1.6), 'K47');
  const pl47 = pallet(-75.2, -5.4, k47.top, 0, 1.3); B.mark('main', P(pl47), 'pallet on K47');
  const b4y = r2(Y5 - 1.6);
  const P41 = plat(-71.0, -2.2, b4y, 2.6, 2.6, { posts: false });
  B.mark('main', P(P41), 'P41');
  ibeam([-69.7, b4y, -2.2], [-62.6, b4y, -2.2], 0.5);
  B.mark('main', [-66.0, b4y, -2.2], 'beam to the divider');
  const P42 = plat(-61.6, -2.2, b4y, 2.0, 2.6, { posts: false });
  B.mark('main', P(P42), 'P42');
  const X45z = -2.2;
  divider(Y4, Y5 - 0.5, [[-8.2, -3.6, Y4 - 1, Y4 + 3]]);
  void D4;
  console.log('zone 4 placed');

  // =====================================================================================
  // ZONE 5 – VERTICAL CLIMB (430–460, east half): three bounce-pad challenges, a ladder and stairs
  // =====================================================================================
  const D5 = deck('deck 5', -60.5, HALF.E.x1, Z0, Z1, Y5, 'NSE', {});
  const E5 = [-59.2, Y5, X45z];
  B.mark('main', E5, 'deck 5');
  // (1) low -> high container
  const k51 = stack(-45.4, -16.0, Y5, 3, 0, { color: 'container_red' });
  const J51 = pad(-52.6, Y5, -16.0, 90, 23.5, 1.2, P(k51));
  B.mark('main', J51, 'pad J51', 'topad');
  B.mark('main', P(k51), 'K51 (pad landing)', 'pad');
  B.link(J51, P(k51), 'pad');
  // ladder up K52's north face from K51's roof
  const k52 = stack(-45.4, -10.6, Y5, 6, 0, { color: 'container_green' });
  ladder(-45.4, k51.top, r2(k52.z - k52.hz), r2(k52.top - k51.top), 180);
  B.mark('main', [-45.4, k51.top, r2(k52.z - k52.hz - 0.5)], 'ladder foot (K52)', 'ladder');
  B.link([-45.4, k51.top, r2(k52.z - k52.hz - 0.5)], P(k52), 'ladder');
  B.mark('main', P(k52, 0, 0.6), 'K52');
  // (2) pad to a small floating platform
  const F51 = plat(-52.6, -9.0, r2(k52.top + 5.4), 2.4, 2.4, { posts: false });
  const J52 = pad(-45.4, k52.top, -8.6, -90, 20, 1.2, P(F51, 0.8));
  B.mark('main', J52, 'pad J52', 'topad');
  B.mark('main', P(F51, 0.8), 'F51 (floating)', 'pad');
  B.link(J52, P(F51, 0.8), 'pad');
  // (3) two pads in a row, two directions: north, then west
  const F52 = plat(-52.6, -16.6, r2(F51.top + 2.2), 2.4, 2.4, { posts: false });
  const J54 = pad(-52.6, F52.top, -16.6, -90, 20, 1.2, [-57.8, r2(Y6 - 2.0), -16.6]);
  const J53 = pad(-52.6, F51.top, -9.6, 180, 19, 1.2, J54);
  B.mark('main', J53, 'pad J53', 'topad');
  B.mark('main', J54, 'pad J54 (chain)', 'pad');
  B.link(J53, J54, 'pad');
  const P53 = plat(-57.6, -16.6, r2(Y6 - 2.0), 3.2, 3.0, { posts: false });
  B.mark('main', P(P53), 'P53', 'pad');
  B.link(J54, P(P53), 'pad');
  // stairs up to the divider top and deck 6
  B.kitPiece('stairs', [-59.2, Y6, -16.6], [2.4, 2.0, 1.4, 5], -90, { m: 'metal' });
  B.mark('main', [-59.0, Y6 - 0.5, -16.6], 'stairs');
  divider(Y5, Y6 - 0.5, [[-4.5, 0.1, Y5 - 1, Y5 + 3]]);
  void D5;
  console.log('zone 5 placed');

  // =====================================================================================
  // ZONE 6 – HIGH-RISK PARKOUR (460–495, west half): pad onto a beam, narrow beams with gaps, two containers swinging
  // against each other (jump across when they meet), a crane jib, then up to deck 7
  // =====================================================================================
  const D6 = deck('deck 6', HALF.W.x0, -59.5, Z0, Z1, Y6, 'NSW', {});
  const E6 = [-60.8, Y6, -16.6];
  B.mark('main', E6, 'deck 6');
  // band 1: a pad onto a beam, then narrow beams with gaps along the north and west edges
  const c60 = crate(-62.6, -19.6, Y6, 0); B.mark('main', P(c60), 'crate');
  const k61 = stack(-66.4, -21.6, Y6, 2, 90, { color: 'container_yellow' }); B.mark('main', P(k61, 2.0), 'K61');
  const b61y = r2(k61.top + 2.6);
  const J61 = pad(-64.6, k61.top, -21.6, -90, 18, 1.0, [-71.4, b61y, -21.6]);
  B.mark('main', J61, 'pad J61', 'topad');
  ibeam([-71.0, b61y, -21.6], [-75.6, b61y, -21.6], 0.7);
  B.mark('main', [-71.4, b61y, -21.6], 'beam B61', 'pad');
  B.link(J61, [-71.4, b61y, -21.6], 'pad');
  B.mark('main', [-75.2, b61y, -21.6], 'beam B61 end');
  const b62y = r2(b61y + 1.0), b63y = r2(b62y + 1.0);
  ibeam([-75.4, b62y, -18.8], [-75.4, b62y, -12.6], 0.45);
  B.mark('main', [-75.4, b62y, -18.2], 'beam B62');
  B.mark('main', [-75.4, b62y, -13.0], 'beam B62 end');
  ibeam([-72.4, b63y, -10.4], [-72.4, b63y, -2.8], 0.45);
  B.mark('main', [-72.4, b63y, -10.0], 'beam B63');
  B.mark('main', [-72.4, b63y, -3.2], 'beam B63 end');
  for (const [x, y, z] of [[-73.3, b61y, -21.6], [-75.4, b62y, -15.7], [-72.4, b63y, -6.6]]) B.kitPiece('slab', [x, r2(y - 0.45), z], [0.22, r2(y - 0.45 - Y6), 0.22], 0, { m: 'dark', nc: true });
  // band 2: up the south-west stack, then the twin swings (half a period apart): ride one, cross, ride the other
  const k62 = stack(-74.4, 1.0, Y6, 5, 0, { color: 'container_red' }); B.mark('main', P(k62, 0, -1.6), 'K62');
  const pl62 = pallet(-74.4, 2.4, k62.top, 0, 1.3); B.mark('main', P(pl62), 'pallet on K62');
  const sy = pl62.top;
  const SW = { len: 6.5, amp: 24, T: 6.4, s: 5.5 };
  const off = SW.len * Math.sin((SW.amp * Math.PI) / 180), half = HANGC.hx * SW.s, pivY = r2(sy + SW.len * Math.cos((SW.amp * Math.PI) / 180));
  const PD = plat(-69.0, 2.6, sy, 3.0, 2.0);
  const s62A = PD.z - PD.hz - 0.9 - half, s61A = s62A - 2 * off - (2 * half + 1.2);
  const S62 = swing('S62', [-69.0, pivY, r2(s62A - off)], SW.len, SW.amp, SW.T, 180, { s: SW.s, armS: 4.2, phase: 0 });
  const S61 = swing('S61', [-69.0, pivY, r2(s61A - off)], SW.len, SW.amp, SW.T, 180, { s: SW.s, armS: 4.2, phase: SW.T / 2 });
  const PE = plat(-69.55, r2(S61.fb.z0 - 0.9 - 1.0), sy, 4.1, 2.0);
  B.mark('main', P(PD), 'PD (twin swings)');
  B.mark('main', S62.A, 'S62 (south)', 'swing:S62:A');
  B.mark('main', S62.B, 'S62 (north, meets S61)', 'swing:S62:B');
  B.mark('main', S61.A, 'S61 (south)', 'swing:S61:A');
  B.mark('main', S61.B, 'S61 (north)', 'swing:S61:B');
  B.mark('main', P(PE, 0.6), 'PE');
  B.link(P(PD), S62.A, 'board'); B.link(S62.A, S62.B, 'swing'); B.link(S62.B, S61.A, 'board'); B.link(S61.A, S61.B, 'swing'); B.link(S61.B, P(PE, 0.6), 'alight');
  // band 3: a ladder up a steel column to a perch, a crane jib turning over the whole half, then a last column
  const p61y = r2(sy + 10.9);
  column(-72.4, -20.8, Y6, r2(p61y - 0.3), 1.6);
  ladder(-71.6, sy, -20.8, r2(p61y - sy), 90);
  B.mark('main', [-71.1, sy, -20.8], 'ladder foot (column)', 'ladder');
  const P61 = plat(-72.4, -20.8, p61y, 2.4, 2.4, { posts: false });
  B.link([-71.1, sy, -20.8], P(P61), 'ladder');
  B.mark('main', P(P61), 'P61');
  const R2 = rotor('R2', [-68.32, r2(p61y + 1.0), -11.28], 4, 200, 380, { speed: 28 });
  B.mark('main', R2.A, 'R2 (north)', 'rotor:R2:A');
  B.mark('main', R2.B, 'R2 (south-east)', 'rotor:R2:B');
  B.link(P(P61), R2.A, 'board'); B.link(R2.A, R2.B, 'rotor');
  const P62 = plat(-65.1, -1.74, p61y, 2.6, 2.6);
  B.mark('main', P(P62), 'P62');
  B.link(R2.B, P(P62), 'alight');
  const cl7y = r2(Y7 - 1.2);
  column(-62.2, -1.8, Y6, cl7y, 1.6);
  ladder(-63.0, p61y, -1.8, r2(cl7y - p61y), -90);
  B.mark('main', [-63.5, p61y, -1.8], 'ladder foot (last column)', 'ladder');
  B.link([-63.5, p61y, -1.8], [-62.2, cl7y, -1.8], 'ladder');
  B.mark('main', [-62.2, cl7y, -1.8], 'column top');
  const X67z = -1.8;
  divider(Y6, Y7 - 0.5, [[-19.0, -14.2, Y6 - 1, Y6 + 3]]);
  void D6;
  console.log('zone 6 placed');

  // =====================================================================================
  // ZONE 7 – FINAL CONTAINER TOWER (495–520, east half): a spiral of container stacks round a slewing crane,
  // with a catwalk bridge, a last I-beam and the summit gate to Map 004
  // =====================================================================================
  const D7 = deck('deck 7', -60.5, HALF.E.x1, Z0, Z1, Y7, 'NSE', {});
  const E7 = [-59.2, Y7, X67z];
  B.mark('main', E7, 'deck 7');
  const k71 = stack(-55.6, -1.0, Y7, 1, 90, { color: 'container_red' }); B.mark('main', P(k71), 'K71');
  const k72 = stack(-49.8, -1.0, Y7, 2, 90, { color: 'container_yellow' }); B.mark('main', P(k72), 'K72');
  const k73 = stack(-45.2, -6.2, Y7, 3, 0, { color: 'container_green' }); B.mark('main', P(k73), 'K73');
  const k74 = stack(-45.2, -12.4, Y7, 4, 0); B.mark('main', P(k74), 'K74');
  const pl74 = pallet(-45.2, -14.0, k74.top, 0, 1.3); B.mark('main', P(pl74), 'pallet on K74');
  const k75 = stack(-45.2, -20.4, Y7, 6, 0, { color: 'container_red' }); B.mark('main', P(k75, 0, -1.0), 'K75');
  const k76 = stack(-53.2, -20.4, Y7, 6, 90, { color: 'container_yellow' });
  B.prefab('steel_catwalk', -48.6, k75.top, -20.4, 0, 2.8, { name: 'catwalk' });
  B.mark('main', [-48.6, r2(k75.top + 0.67 * 2.8), -20.4], 'catwalk');
  B.mark('main', P(k76, 1.6), 'K76');
  const c76 = crate(-54.6, -20.4, k76.top, 90); B.mark('main', P(c76), 'crate on K76');
  const k77 = stack(-56.2, -13.6, Y7, 8, 0, { color: 'container_green' }); B.mark('main', P(k77, 0, -1.2), 'K77');
  const pl77 = pallet(-56.2, -12.0, k77.top, 0, 1.3); B.mark('main', P(pl77), 'pallet on K77');
  const k78 = stack(-50.6, -11.0, Y7, 9, 90); B.mark('main', P(k78, -1.6), 'K78');
  // summit: a last narrow beam out to the gate platform
  const TOPP = plat(-51.4, -4.6, TOP, 6.0, 4.6, { posts: false });
  ibeam([-50.6, r2(k78.top), -9.6], [-50.6, r2(k78.top), -7.0], 0.5);
  B.mark('main', [-50.6, k78.top, -8.0], 'last beam');
  B.mark('main', P(TOPP, 0, 0.6), 'SUMMIT');
  // landmark: a slewing crane on the deck
  B.prefab('slewing_crane', -53.0, Y7, 1.6, 180, 7.5, { name: 'slewing crane' });
  void D7;
  EXIT = P(TOPP, 0, 0.6);
  console.log('zone 7 placed', JSON.stringify({ k78: k78.top, TOP }));
}
boundary();
function sweepCheck() {
  const skip = new Set(['trolley rail', 'gantry leg', 'jib mast', 'lift tower', 'gantry arm', 'divider']);
  const objBoxes = (o) => {
    if (o.type === 'prefab') {
      const g = o.g, c = Math.cos((o.r * Math.PI) / 180), sn = Math.sin((o.r * Math.PI) / 180);
      const xs = [], zs = [];
      for (const [lx, lz] of [[g.minx, g.minz], [g.maxx, g.minz], [g.minx, g.maxz], [g.maxx, g.maxz]]) { xs.push(o.x + (lx * c + lz * sn) * o.s); zs.push(o.z + (-lx * sn + lz * c) * o.s); }
      return [{ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0: o.y, y1: o.y + o.s }];
    }
    return (o.boxes ?? []).map((b) => {
      const r = ((o.r ?? 0) * Math.PI) / 180, c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
      const hx = b.h[0] * c + b.h[2] * sn, hz = b.h[0] * sn + b.h[2] * c;
      return { x0: b.c[0] - hx, x1: b.c[0] + hx, z0: b.c[2] - hz, z1: b.c[2] + hz, y0: b.c[1] - b.h[1], y1: b.c[1] + b.h[1] };
    });
  };
  const hits = [];
  for (const sw of sweeps) {
    let reg = null;
    if (sw.boxes) reg = { x0: Math.min(...sw.boxes.map((b) => b.x0)), x1: Math.max(...sw.boxes.map((b) => b.x1)), z0: Math.min(...sw.boxes.map((b) => b.z0)), z1: Math.max(...sw.boxes.map((b) => b.z1)) };
    for (const o of B.objects) {
      if (skip.has(o.name)) continue;
      for (const b of objBoxes(o)) {
        if (b.y1 <= sw.y0 + 0.05 || b.y0 >= sw.y1 - 0.05) continue;
        let hit = false;
        if (reg) hit = b.x0 < reg.x1 - 0.05 && b.x1 > reg.x0 + 0.05 && b.z0 < reg.z1 - 0.05 && b.z1 > reg.z0 + 0.05;
        else {
          const { x, z, r, a0, a1 } = sw.circle, lo = Math.min(a0, a1) - 12, hi = Math.max(a0, a1) + 12;
          for (let i = 0; i <= 6 && !hit; i++) for (let j = 0; j <= 6 && !hit; j++) {
            const px = b.x0 + ((b.x1 - b.x0) * i) / 6, pz = b.z0 + ((b.z1 - b.z0) * j) / 6;
            const d = Math.hypot(px - x, pz - z);
            if (d > r || d < 1.6) continue;
            let ang = (Math.atan2(px - x, pz - z) * 180) / Math.PI;
            while (ang < lo) ang += 360;
            while (ang > lo + 360) ang -= 360;
            if (ang <= hi) hit = true;
          }
        }
        if (hit) hits.push(`${sw.id} x ${o.name} [${r2(b.x0)}..${r2(b.x1)}, ${r2(b.y0)}..${r2(b.y1)}, ${r2(b.z0)}..${r2(b.z1)}]`);
      }
    }
  }
  console.log(`  mover clearance: ${hits.length ? hits.length + ' hits\n    ' + [...new Set(hits)].slice(0, 30).join('\n    ') : 'ok'}`);
}
sweepCheck();
if (process.env.NOMOVERS) B.links = (B.links ?? []).filter((l) => l.kind === 'ladder');


// =====================================================================================
// VALIDATION, OUTPUT
// =====================================================================================
const val = B.validate(GATE_IN, EXIT);
B.checkOverlaps();
await plotMap(B, val, new URL('./out/map003_plan.png', import.meta.url).pathname, { cx: C3.x, cz: C3.z, r: 30, y0: Y1 - 5, y1: TOP + 5 });
console.log('route points', JSON.stringify(Object.fromEntries(Object.entries(B.routes).map(([k, v]) => [k, v.length]))));
if (process.env.NOWRITE) process.exit(0);
const zones = [
  { id: 'A', name: 'Cổng Hàng Hóa', y0: 315, y1: 345, color: '#5fb3ff' },
  { id: 'B', name: 'Dầm Thăng Bằng', y0: 345, y1: 370, color: '#ffcf4a' },
  { id: 'C', name: 'Hàng Hóa Di Động', y0: 370, y1: 400, color: '#ff8a4a' },
  { id: 'D', name: 'Băng Qua Cần Cẩu', y0: 400, y1: 430, color: '#ff5f7a' },
  { id: 'E', name: 'Leo Thẳng Đứng', y0: 430, y1: 460, color: '#9b7bff' },
  { id: 'F', name: 'Parkour Mạo Hiểm', y0: 460, y1: 495, color: '#4ad6b0' },
  { id: 'G', name: 'Tháp Container Cuối', y0: 495, y1: 525, color: '#f0f0f0' },
];
const data = B.toJSON({
  id: 'map003', name: 'Container Port', version: 1, height: TOP - Y1, origin: [0, Y1, 0],
  spawn: { p: GATE_IN, yaw: -Math.PI / 2 },
  exit: { p: EXIT, r: 2.6, next: 'map004', label: 'Map 004', gate: { p: [-60, TOP, -19.6], yaw: 0, w: 4.4, h: 4.2 } },
  finishHint: 'Gợi ý: hai container treo luôn gặp nhau ở cùng một nhịp – đếm nhịp rồi hãy nhảy.',
  challengeTime: 1500,
  zones, milestones: [340, 360, 380, 400, 420, 440, 460, 480, 500, 520],
  region: { c: [C3.x, C3.z], r: RING },
  terrain: { style: 'none', radius: RING, center: [C3.x, 340, C3.z], wallTop: TOP + 40 - 340, plazas: [], paths: [] },
  movers, pads, rings: [], ladders,
  padModel: PADM,
  prefabFiles: Object.fromEntries(['shipping_container', 'container_red', 'container_yellow', 'container_green', 'steel_crate', 'cargo_pallet_stand', 'steel_ibeam', 'balance_beam', 'steel_catwalk', 'gantry_arm', 'hanging_container', 'tower_crane', 'banner_crane_arm', 'suspended_platform', 'container_tower_a', 'container_tower_b', 'bounce_pad'].map((id) => [id, `assets/map003/${id}`])),
  waypoints: makeWaypoints(B.routes, zones),
});
fs.writeFileSync(new URL('../packs/map003/maps/map003.json', import.meta.url), JSON.stringify(data));
fs.writeFileSync(new URL('./out/routes003.json', import.meta.url), JSON.stringify(B.routes));
console.log(`prefabs ${B.prefabs.length}, kit ${B.kit.length}, movers ${movers.length}, pads ${pads.length}, ladders ${ladders.length}`);
