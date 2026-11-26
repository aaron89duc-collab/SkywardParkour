// Map 007 – Giant Playground (1150 -> 1390 m). A playground for giants floating above the clouds, entered from the
// crown of Map 006's ancient tree. Same frame as Maps 003-006 (two interleaved halves, W / E, 16 m wide); the last
// zone is the Master Tower in the middle. The map is about PLAYING: soft blocks to hop, towers of play decks joined by
// stairs and climbing nets, trampolines, swings that throw you far if you jump at the bottom, seesaws, rope bridges
// that sway, a roundabout, ball pits that catch any fall, crawl tubes, slides (straight with a kicker, curved, a
// spiral round a pole), a drawbridge you open once and a three-button puzzle. Every zone has its main way, an easier
// way, a harder way and a secret.
// Run: node devtools/build-map007.mjs -> packs/map007/maps/map007.json (+ devtools/out/map007_plan.png, routes007.json)
//   STAGE=n  build zones 1..n only     SHOWPATH=1  print the validator's paths     NOWRITE=1  validate only
//   ZPLOT=1  one top view per zone in /tmp/z7_<n>.png
import fs from 'fs';
import { applyI18n, applyPackI18n } from './i18n-content.mjs';
import { MapBuilder, r2, makeWaypoints } from './mapgen/lib.mjs';
import { plotMap } from './mapgen/plot.mjs';
import { zonePlot } from './mapgen/zoneplot.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const A = 'assets/map007';
const C7 = { x: -60, z: -9 };
const RING = 26;
const Y1 = 1150, Y2 = 1182, Y3 = 1214, Y4 = 1246, Y5 = 1280, Y6 = 1314, Y7 = 1350, TOP = 1390;
const HALF = { W: { x0: -76, x1: -60, xc: -68 }, E: { x0: -60, x1: -44, xc: -52 } };
const Z0 = -25, Z1 = 6;
const B = new MapBuilder({ ground: { x: C7.x, y: -999, z: C7.z, r: 0 } });
B.seed = 7;
B.supportR = 0.22;
const STAGE = process.env.STAGE ?? 'all';
const upTo = (n) => STAGE === 'all' || +STAGE >= n;

// ---------------------------------------------------------------- the models: normalised size + flat top height
const info = (id) => JSON.parse(fs.readFileSync(`${ROOT}packs/map007/assets/map007/${id}.info.json`, 'utf8'));
const SZ = {};
for (const f of fs.readdirSync(`${ROOT}packs/map007/assets/map007`).filter((f) => f.endsWith('.info.json'))) SZ[f.replace('.info.json', '')] = info(f.replace('.info.json', '')).size;
// flat tops (fraction of the model height): measured on the collision meshes (devtools/out/raw7real, /tmp/an)
const FT = { playground_island: 0.93, play_deck: 0.71, play_stairs: 0.65, seesaw_large: 0.65, rope_bridge: 0.165, ball_pit: 0.75, roundabout: 0.16, soft_block: 1.0, swing_seat: 0.08 };
const ext = (rec, ux, uz) => rec.r ?? Math.abs(ux) * rec.hx + Math.abs(uz) * rec.hz;
const odd = (r) => Math.abs(Math.round((r ?? 0) / 90)) % 2 === 1;

/** a prefab whose flat top is at `top`, w wide (model x) */
function piece(id, x, z, top, w, o = {}) {
  const s = w / SZ[id][0];
  const base = top - (o.ft ?? FT[id]) * s;
  const ob = B.prefab(id, r2(x), r2(base), r2(z), o.r ?? 0, r2(s), { name: o.name ?? id, col: o.col });
  if (o.noStand) ob.noStand = true;
  const [hx, hz] = odd(o.r) ? [SZ[id][2] * s / 2, w / 2] : [w / 2, SZ[id][2] * s / 2];
  return { id, x, z, top: r2(top), base: r2(base), s, hx, hz };
}
/** a floating playground island (rubber mat on top), w wide along x */
const island = (x, z, top, w, o = {}) => piece('playground_island', x, z, top, w, { name: 'playground island', ...o });
/** a soft foam block, `size` m cube, top at `top` */
const COLS = ['red', 'yellow', 'blue', 'green', 'purple'];
let blockN = 0;
function block(x, z, top, size = 2, o = {}) {
  const c = o.color ?? COLS[blockN++ % COLS.length];
  B.prefab(`soft_block_${c}`, r2(x), r2(top - size), r2(z), o.r ?? 0, r2(size), { name: `${c} soft block` });
  return { id: 'block', x, z, top: r2(top), hx: size / 2, hz: size / 2 };
}
/** a column of `n` play decks (4 m square by default) standing on `base`; railings: yaw r = 0 -> on -z and +x
 *  (open +z, -x), 90 -> -z, -x (open +z, +x), 180 -> +z, -x (open -z, +x), -90 -> +z, +x (open -z, -x) */
const DECK_W = 4.0, DECK_S = DECK_W / 1.204, STORY = r2(FT.play_deck * DECK_S);
function column(x, z, base, n, r = 0, o = {}) {
  let y = base;
  for (let i = 0; i < n; i++) {
    const ob = B.prefab('play_deck', r2(x), r2(y), r2(z), i === n - 1 || o.fixed ? r : (r + 90 * i) % 360, r2(DECK_S), { name: o.name ?? 'play deck' });
    if (i < n - 1) ob.noStand = true;
    y += STORY;
  }
  return { id: 'deck', x, z, top: r2(y), hx: DECK_W / 2, hz: DECK_W / 2 };
}
/** a flight of play stairs: bottom edge at (x, z), its first step on the level y, going up towards dir (degrees,
 *  0 = +z, 90 = +x) by `rise`; invisible steps for the controller (the model's rails are not solid) */
function stairs(x, z, y, dir, rise, o = {}) {
  const s = rise / FT.play_stairs, q = (dir * Math.PI) / 180, ux = Math.sin(q), uz = Math.cos(q);
  const cx = x + ux * 0.486 * s, cz = z + uz * 0.486 * s;
  B.prefab('play_stairs', r2(cx), r2(y), r2(cz), r2(dir + 180), r2(s), { name: 'play stairs', col: false });
  const w = 0.34 * s, n = 12, run = 0.69 / n; // 12 low steps (0.2 m): the controller steps up them smoothly
  for (let i = 0; i < n; i++) {
    const lz = 0.47 - (i + 0.5) * run; // local z of the step centre (the model goes up towards local -z)
    const px = cx - ux * lz * s, pz = cz - uz * lz * s;
    B.kitPiece('solid', [px, y + ((i + 1) / n) * rise, pz], [w, ((i + 1) / n) * rise, run * s], dir, { name: 'stair step' });
  }
  const lz = (-0.22 - 0.486) / 2, ld = (0.486 - 0.22) * s;
  B.kitPiece('solid', [cx - ux * lz * s, y + rise, cz - uz * lz * s], [w, rise, ld], dir, { name: 'stair landing' });
  return { bottom: [r2(x), r2(y), r2(z)], top: [r2(cx - ux * -0.42 * s), r2(y + rise), r2(cz - uz * -0.42 * s)], mid: [r2(cx), r2(y + rise / 2), r2(cz)], len: r2(0.972 * s) };
}
/** a climbing net (or rope ladder) on a face: foot p (standable), facing yaw r (the side you climb from), up to top */
const ladders = [];
function net(p, top, r, o = {}) {
  const h = r2(top - p[1]), q = (r * Math.PI) / 180;
  ladders.push({ p: p.map(r2), h, r, nv: true, ...(o.w ? { w: o.w } : {}) });
  const id = o.rope ? 'rope_ladder' : 'climbing_net', s = r2(o.rope ? h + 0.6 : Math.min(h + 0.4, o.maxW ?? 4.2));
  const off = o.rope ? 0.06 : 0.05;
  B.prefab(id, r2(p[0] + Math.sin(q) * off), r2(o.rope ? p[1] - 0.3 : top + 0.4 - s), r2(p[2] + Math.cos(q) * off), r, s, { name: o.rope ? 'rope ladder' : 'climbing net', col: false });
  B.link([p[0] + Math.sin(q) * 0.5, p[1], p[2] + Math.cos(q) * 0.5], [p[0] - Math.sin(q) * 1.0, top, p[2] - Math.cos(q) * 1.0], 'ladder');
}
/** decoration (no collider) */
const deco = (id, x, z, base, s, r = 0) => B.prefab(id, r2(x), r2(base), r2(z), r, r2(s), { name: id, col: false });

// ---------------------------------------------------------------- devices (data-driven mechanics)
const devices = [];
const movers = [];
const sweeps = [];
/** a solid box the validator can stand on (device platforms are not prefabs) */
function surf(name, p, s, r = 0) { B.objects.push({ type: 'kit', k: 'slab', boxes: [{ c: [p[0], p[1] - s[1] / 2, p[2]], h: [s[0] / 2, s[1] / 2, s[2] / 2], top: true, narrow: s[0] < 0.9 || s[2] < 0.9 }], r, name }); }
/** a model as the look of a device box whose top is at the device's p */
const look = (id, s, o = {}) => ({ file: `${A}/${id}`, s: r2(s), off: [r2(o.ox ?? 0), r2(-(o.ft ?? FT[id])), r2(o.oz ?? 0)], ...(o.yaw ? { yaw: o.yaw } : {}) });
/** a built-in coloured box device (no model) */
function colDev(t, id, x, z, top, w, d, extra = {}, o = {}) {
  const dv = { t, id, p: [r2(x), r2(top), r2(z)], r: o.r ?? 0, s: [r2(w), o.h ?? 0.5, r2(d)], color: o.color ?? '#b9a2f0', ...extra };
  devices.push(dv);
  if (o.surf !== false) surf(o.name ?? t, dv.p, dv.s, o.r ?? 0);
  return { id, x, z, top: r2(top), hx: (odd(o.r) ? d : w) / 2, hz: (odd(o.r) ? w : d) / 2, dev: dv };
}
/** a playground trampoline (built-in look: a bouncy mat on legs); power = a high one */
function tramp(id, x, z, top, w = 2.4, o = {}) {
  return colDev('trampoline', id, x, z, top, w, w, { bounce: 0.9, min: o.min ?? 15, max: o.max ?? 26 }, { color: o.color ?? (o.min > 17 ? '#ff7a2f' : '#3cb4ff'), h: 0.5, name: 'trampoline', ...o });
}
/** a swing set: the A-frame (5 m tall, beam along x for r = 0) on `base`, one or two seats hung from the beam that
 *  swing across it (along z for r = 0); a seat rides like a pendulum and throws you far when you jump at the bottom
 *  (kick). Returns per seat its rest point, its two extremes (A = the -dir side) */
const FRAME_S = 5.0, SEAT_S = 4.07, PIV = r2(0.85 * FRAME_S), SEAT_L = r2(0.92 * SEAT_S);
function swingSet(id, x, z, base, o = {}) {
  const r = o.r ?? 0, q = (r * Math.PI) / 180, bx = Math.cos(q), bz = -Math.sin(q); // the beam direction (local x)
  B.prefab('swing_frame', r2(x), r2(base), r2(z), r, FRAME_S, { name: 'swing frame' }).noStand = true;
  const out = [];
  for (const [k, side] of (o.seats ?? [[id, 1]])) {
    const sx = x + bx * 1.65 * side, sz = z + bz * 1.65 * side;
    const amp = o.amp ?? 45, th = (amp * Math.PI) / 180, piv = [r2(sx), r2(base + PIV), r2(sz)];
    const dir = [Math.sin(q), Math.cos(q)]; // swing direction (local z)
    const ex = (sg) => [r2(sx + dir[0] * Math.sin(th) * sg * SEAT_L), r2(piv[1] - Math.cos(th) * SEAT_L), r2(sz + dir[1] * Math.sin(th) * sg * SEAT_L)];
    const Ap = ex(-1), Bp = ex(1), rest = [r2(sx), r2(piv[1] - SEAT_L), r2(sz)];
    movers.push({ id: k, kind: 'swing', pts: [Ap, Bp], pivot: piv, len: SEAT_L, amp, period: o.period ?? 2.6, r, s: SEAT_S, speed: 0, wait: 0, phase: o.phase ?? 0,
      rope: false, kick: o.kick ?? 1.3, vmax: o.vmax ?? 11.5, tilt: 1,
      model: { file: `${A}/swing_seat`, s: SEAT_S, off: [0, -FT.swing_seat, 0], boxes: [[0, -0.03, 0, 0.27, 0.03, 0.19]] } });
    B.node(Ap); B.node(Bp); B.node(rest);
    out.push({ id: k, A: Ap, B: Bp, rest, dir });
  }
  return out;
}
/** a seesaw: the plank (10 m) along z for r = 0, top at `top` when level; it tips towards whoever stands on it. Its
 *  stand sits on a soft block (returned: the plank's two ends) */
function seesaw(id, x, z, top, L = 10, o = {}) {
  const s = L / SZ.seesaw_large[0], w = r2(0.47 * s), r = o.r ?? 0, q = (r * Math.PI) / 180;
  devices.push({ t: 'tilt', id, p: [r2(x), r2(top), r2(z)], r, s: [w, 0.4, r2(L * 0.96)], maxAngle: o.maxAngle ?? 8, model: look('seesaw_large', s, { yaw: 90 }) });
  surf('seesaw', [x, top, z], [w, 0.4, L * 0.96], r);
  block(x, z, r2(top - FT.seesaw_large * s), 2.2, { color: o.color ?? 'purple' });
  const e = (k) => [r2(x + Math.sin(q) * k * (L / 2 - 0.8)), r2(top), r2(z + Math.cos(q) * k * (L / 2 - 0.8))];
  return { id, x, z, top: r2(top), hx: odd(r) ? L / 2 : w / 2, hz: odd(r) ? w / 2 : L / 2, a: e(-1), b: e(1) };
}
/** a rope bridge from a to b (level, top a[1]): swaying plank segments (tilt + sway) wearing the rope bridge model */
const RB_S = 2.54, RB_SEG = r2(1.22 * RB_S);
function ropeBridge(id, a, b, o = {}) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), n = Math.max(1, Math.round(L / RB_SEG));
  const r = r2((Math.atan2(dx, dz) * 180) / Math.PI), seg = L / n, out = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, p = [r2(a[0] + dx * t), a[1], r2(a[2] + dz * t)];
    devices.push({ t: 'tilt', id: `${id}${i + 1}`, p, r, s: [1.5, 0.3, r2(seg - 0.05)], maxAngle: o.maxAngle ?? 5, sway: o.period ?? 3.2, phase: r2(i * 0.9),
      model: look('rope_bridge', RB_S * seg / RB_SEG, { yaw: 90 }) });
    surf('rope bridge', p, [1.5, 0.3, seg - 0.05], r);
    out.push(p);
  }
  return out;
}
/** the roundabout (a turntable wearing the merry-go-round), radius R, top at `top` */
function roundabout(id, x, z, top, R = 2.4, speed = 35, o = {}) {
  const s = (2 * R) / SZ.roundabout[0];
  devices.push({ t: 'turntable', id, p: [r2(x), r2(top), r2(z)], s: [r2(2 * R), 0.5, r2(2 * R)], radius: R, speed, model: look('roundabout', s), ...(o.phase ? { phase: o.phase } : {}) });
  surf('roundabout', [x, top, z], [R * 1.4, 0.5, R * 1.4]);
  return { id, x, z, top: r2(top), r: R };
}
/** a latched plate (a big round button): drives `target`; stays on once pressed (saved) */
function button(id, p, target, o = {}) {
  devices.push({ t: 'plate', id, p: p.map(r2), s: [1.6, 0.15, 1.6], target, latch: o.latch ?? true, ...(o.puzzle ? { puzzle: o.puzzle, order: o.order } : {}), color: o.color ?? '#ff4d6d' });
  return { id, x: p[0], z: p[2], top: p[1], r: 0.8 };
}
/** a drawbridge: hinged at p, its deck (d long) along yaw r, raised `tip` degrees until its plate is pressed */
function drawbridge(id, p, r, d = 5.2, o = {}) {
  const s = d / 1.738;
  devices.push({ t: 'reveal', id, p: p.map(r2), r, s: [1.9, 0.3, r2(d)], tip: o.tip ?? 80, dur: 1.6, model: look('rope_bridge', s, { yaw: 90, oz: r2(d / 2 / s) }) });
  const q = (r * Math.PI) / 180;
  return { mid: [r2(p[0] + Math.sin(q) * d / 2), p[1], r2(p[2] + Math.cos(q) * d / 2)], end: [r2(p[0] + Math.sin(q) * (d - 0.4)), p[1], r2(p[2] + Math.cos(q) * (d - 0.4))] };
}
/** a ball pit standing on `base`, w wide (the model's padded walls; the balls 0.75 up): you sink 0.7 m into the balls,
 *  wade at half speed and jump lower; any fall into it is soft */
function ballPit(id, x, z, base, w = 6, o = {}) {
  const s = w / SZ.ball_pit[0], top = r2(base + FT.ball_pit * s), inner = r2(0.8 * w);
  devices.push({ t: 'pit', id, p: [r2(x), top, r2(z)], s: [inner, 1, inner], sink: 0.7, rim: r2((1 - FT.ball_pit) * s), n: o.n ?? 14, model: look('ball_pit', s) });
  surf('ball pit floor', [x, top - 0.7, z], [inner, 0.5, inner]);
  for (const [dx, dz, ww, dd] of [[-1, 0, 0.3, inner], [1, 0, 0.3, inner], [0, -1, inner, 0.3], [0, 1, inner, 0.3]])
    surf('ball pit wall', [x + dx * (inner / 2 + 0.15), r2(top + (1 - FT.ball_pit) * s), z + dz * (inner / 2 + 0.15)], [ww, 1.2, dd]);
  return { id, x, z, top, floor: r2(top - 0.7), hx: w / 2, hz: w / 2 };
}
/** a crawl tube from a to b at floor height a[1] (the open ends on the column / island edges): the model's hollow plus
 *  an invisible flat floor inside */
const TUBE_S = 3.2;
function tube(a, b, o = {}) {
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz), s = o.s ?? TUBE_S;
  const yaw = r2((Math.atan2(dx, dz) * 180) / Math.PI - 90), c = [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2];
  const ss = L / SZ.tube_tunnel[0];
  B.prefab('tube_tunnel', r2(c[0]), r2(a[1] - 0.6), r2(c[2]), yaw, r2(Math.max(s, ss * 0.92)), { name: 'crawl tube' }).noStand = true;
  B.kitPiece('solid', [c[0], a[1], c[2]], [1.9, 0.3, r2(L + 0.1)], yaw + 90, { name: 'tube floor' });
  // (the validator sees the tube as solid over its floor: walk links through it)
  const u = [dx / L, dz / L], ea = [a[0] - u[0] * 0.8, a[1], a[2] - u[1] * 0.8], eb = [b[0] + u[0] * 0.8, a[1], b[2] + u[1] * 0.8];
  B.link(ea, eb, 'tube'); B.link(eb, ea, 'tube');
  return { mid: [r2(c[0]), a[1], r2(c[2])], L };
}
/** a soft block that rises into place when its group is driven (a puzzle's reward) */
function revealBlock(id, grp, x, z, top, size, color, delay) {
  devices.push({ t: 'reveal', id, grp, p: [r2(x), r2(top), r2(z)], s: [size, size, size], delay: r2(delay), dur: 0.6, model: look(`soft_block_${color}`, size, { ft: 1.0 }) });
  surf('puzzle step', [x, top, z], [size, size, size]);
  return { id, x, z, top: r2(top), hx: size / 2, hz: size / 2 };
}
/** a slide wearing one of the slide models: the model at (x, base, z) turned `yaw`, scale s; the chute's centre line
 *  given in model units [lx, lz, ly] (measured on the collision mesh); the device makes the smooth sliding surface */
function slide(id, model, x, z, base, s, yaw, line, o = {}) {
  const q = (yaw * Math.PI) / 180, c = Math.cos(q), sn = Math.sin(q);
  B.prefab(model, r2(x), r2(base), r2(z), yaw, r2(s), { name: model.replace('_', ' '), col: false });
  const pts = line.map(([lx, lz, ly]) => [r2(x + (lx * c + lz * sn) * s), r2(base + ly * s + 0.02), r2(z + (-lx * sn + lz * c) * s)]);
  devices.push({ t: 'slide', id, p: pts[0], pts, w: r2(o.w ?? 1.4), vmax: o.vmax ?? 11, fric: o.fric ?? 1.5, bare: true });
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; surf('slide', [(a[0] + b[0]) / 2, Math.max(a[1], b[1]), (a[2] + b[2]) / 2], [0.8, 0.3, 0.8]); }
  return { start: pts[0], end: pts[pts.length - 1], pts };
}
// chute centre lines (model units: x, z, height) of the two slide models
const STRAIGHT = [[0, -0.86, 0.73], [0, -0.5, 0.72], [0, -0.42, 0.70], [0, 0.46, 0.19], [0, 0.6, 0.14], [0, 0.82, 0.10], [0, 0.95, 0.17]];
const CURVED = [[0.88, -0.05, 0.67], [0.72, -0.05, 0.67], [0.45, -0.13, 0.63], [0.25, -0.18, 0.60], [0.05, -0.21, 0.565], [-0.15, -0.22, 0.505], [-0.35, -0.19, 0.445],
  [-0.52, -0.12, 0.385], [-0.64, -0.02, 0.32], [-0.70, 0.10, 0.26], [-0.71, 0.22, 0.20], [-0.71, 0.33, 0.155], [-0.71, 0.45, 0.10], [-0.71, 0.58, 0.17]];
const checkpoint = (id, p, r = 0) => devices.push({ t: 'checkpoint', id, p: p.map(r2), r, color: '#ffc928' });
const gem = (id, p) => devices.push({ t: 'collectible', id, p: p.map(r2), color: '#ffe14d' });
function portal(id, p, r, b, rb, need = 0) { devices.push({ t: 'portal', id, p: p.map(r2), r, b: b.map(r2), rb, color: '#ff7ad9', ...(need ? { need } : {}) }); }

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
function make([kind, x, z, top, o = {}]) {
  if (kind === 'island') return island(x, z, top, o.w ?? 4, o);
  if (kind === 'block') return block(x, z, top, o.size ?? 2, o);
  if (kind === 'tramp') return tramp(o.id, x, z, top, o.w ?? 2.4, o);
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
/** the floor of a zone: one or two playground islands (16 m wide) over the half */
function deck(name, H, y, zc = [-19.0]) {
  for (const z of zc) island(H.xc, z, y, 16, { name });
  return { top: y };
}

// =====================================================================================
// ENTRY (1150): Map 006's crown (-60, 1150, -9; 14 m across) opens north through the rainbow gate onto the first
// playground island.
// =====================================================================================
const SPAWN = [-59.5, Y1, -12.6];
mark(SPAWN, 'Crown of the ancient tree');
const I0 = island(-62.5, -19.2, Y1, 10.0, { name: 'gate island' });
piece('rainbow_gate', -59.6, -17.4, Y1 + 5.0 * 0.86, 6.4, { ft: 0.86, noStand: true, name: 'rainbow gate' });
SIGN([-56.8, r2(Y1 + 3.2), -21.6], -90, 'SÂN CHƠI KHỔNG LỒ', '1150 → 1390 m · nhảy, đu, trượt và leo');
mark([-59.6, Y1, -20.4], 'through the rainbow gate');

// =====================================================================================
// ZONE 1 – RAINBOW GATE (1150–1182, west): soft blocks west and south, a climbing net up a column of play decks,
// two flights of stairs between columns, a high trampoline onto an island, a rope ladder, a high trampoline into
// zone 2.   easy: one more flight of stairs instead of the high trampoline · hard: small blocks instead of the stairs
//   secret: a crawl tube on the gate island (gem inside)
// =====================================================================================
const BL1 = [block(-69.2, -20.8, Y1 + 1.2), block(-72.0, -18.4, Y1 + 2.4), block(-73.4, -15.0, Y1 + 3.6), block(-73.4, -11.6, Y1 + 4.8)];
hop(I0, BL1[0], 'gate island > block 1');
BL1.forEach((b, i) => { if (i) hop(BL1[i - 1], b, `block ${i} > ${i + 1}`); mark(P(b), `soft block ${i + 1}`); });
const I1 = island(-69.0, -4.5, r2(Y1 + 5.6), 17.0, { name: 'tower island' });
hop(BL1[3], { ...I1, z: -10.45 + 0.5, hz: 0.5 }, 'block 4 > tower island');
mark([-73.0, I1.top, -8.6], 'tower island');
// the little tower: columns C1 (2 decks), C2 (3), C3 (4)
const C1 = column(-72.0, -0.5, I1.top, 2, 180), C2 = column(-64.5, -0.5, I1.top, 3, -90), C3 = column(-64.5, -8.0, I1.top, 4, 90);
net([-72.0, I1.top, -2.55], C1.top, 180);
mark([-72.0, I1.top, -3.1], 'net (foot)', 'ladder');
mark(P(C1, 0, 0.6), 'deck column 1');
const ST11 = stairs(-69.95, -0.5, C1.top, 90, STORY);
mark([-69.4, C1.top, -0.5], 'stairs 1 (bottom)'); mark(P(C2, -1.0), 'deck column 2');
const ST12 = stairs(-64.5, -2.55, C2.top, 180, STORY);
mark(P(C3, 0, 1.0), 'deck column 3');
void ST11; void ST12;
const PT1 = tramp('t11', -64.5, -8.0, r2(C3.top + 0.5), 2.2, { min: 21 });
hop(C3, PT1, 'column 3 > high trampoline');
const I3 = island(-68.0, -14.0, r2(Y1 + 21.5), 7.0, { name: 'high island' });
B.link(P(PT1), P(I3), 'bounce'); mark(P(I3, 0.6), 'high island', 'via:t11');
const I4 = island(-65.5, -18.0, r2(Y1 + 25.0), 6.0, { name: 'high island' });
net([-65.5, I3.top, r2(I4.z + I4.hz)], I4.top, 0, { rope: true });
mark([-65.5, I3.top, -15.4], 'rope ladder (foot)', 'ladder');
mark(P(I4, -0.6, -0.4), 'high island 2');
var PT2 = tramp('t12', -63.6, -18.4, r2(I4.top + 0.5), 2.2, { min: 20 });
hop(I4, PT2, 'island > trampoline to zone 2');
console.log('zone 1 placed');
EXIT = P(I4);
divider(Y1, Y2 - 0.6, [[-25.0, -12.0, Y1 - 2, Y1 + 7], [-20.0, -16.6, I4.top - 1, Y2 + 4]]);

if (upTo(2)) {
  // =====================================================================================
  // ZONE 2 – SWING GARDEN (1182–1214, east): ride a swing and jump off at the bottom of its swing to fly over a gap,
  // a climbing net up a deck column, stairs to a taller column, a high trampoline to the second swing island, a
  // second swing over the next gap north, a high trampoline, a climbing net and a hop west into zone 3.
  //   easy: the other seat of the first swing set swings slower (and a block bridge helps) · hard: tiny blocks
  //   instead of the second net · secret: under the second swing island, a ledge with a gem
  // =====================================================================================
  const D2 = deck('deck 2', HALF.E, Y2, [-19.0]);
  B.link(P(PT2), [-57.4, Y2, -18.6], 'bounce'); mark([-57.4, Y2, -18.6], 'deck 2 (bounced over)', 'via:t12');
  checkpoint('cp2', [-56.0, Y2, -22.0], 90);
  // the first swing set stands at the south edge of the deck: the seat flies out over the gap
  const SW1 = swingSet('sw21', -52.0, -15.6, Y2, { seats: [['sw21', 1], ['sw22', -1]], period: 2.6 });
  const BB2 = block(SW1[0].A[0], r2(SW1[0].A[2] - 2.05), r2(SW1[0].A[1]), 2, { color: 'blue' });
  hop(at([-57.4, Y2, -18.6]), BB2, 'deck > boarding block');
  mark(P(BB2), 'boarding block');
  mark(SW1[0].A, 'swing seat', 'swing:sw21:A');
  const I21 = island(-50.0, -3.7, Y2, 12.0, { name: 'swing landing island' });
  B.link(SW1[0].A, P(I21, 0, -3.2), 'kick'); mark(P(I21, 0, -3.2), 'over the gap (jump at the bottom)', 'kick:sw21');
  // two deck columns joined by stairs, a climbing net up the first
  const C21 = column(-47.0, -2.6, Y2, 2, 0), C22 = column(-54.5, -2.6, Y2, 3, 90);
  net([-47.0, Y2, -0.55], C21.top, 0);
  mark([-47.0, Y2, -0.1], 'net (foot)', 'ladder');
  mark(P(C21, 0, 0.4), 'deck column');
  stairs(-48.95, -2.6, C21.top, -90, STORY);
  mark(P(C22, 0.8), 'deck column 2');
  const T21 = tramp('t21', -54.5, -3.8, r2(C22.top + 0.3), 2.2, { min: 20 });
  hop(C22, T21, 'column > trampoline');
  // the second swing island: the swing throws you north
  const I23 = island(-54.0, -11.5, r2(C22.top + 6.4), 12.0, { name: 'second swing island' });
  const SW2 = swingSet('sw23', -54.0, -12.9, I23.top, { seats: [['sw23', 1], ['sw24', -1]], r: 180, period: 2.7, phase: 0.7 });
  const BB3 = block(SW2[0].A[0], r2(SW2[0].A[2] + 2.05), r2(SW2[0].A[1]), 2, { color: 'yellow' });
  B.link(P(T21), P(BB3), 'bounce'); mark(P(BB3), 'boarding block 2 (bounced onto)', 'via:t21');
  mark(SW2[0].A, 'swing seat 2', 'swing:sw23:A');
  const I24 = island(-55.0, -23.0, I23.top, 7.0, { name: 'north island' });
  B.link(SW2[0].A, P(I24), 'kick'); mark(P(I24, 0.6, 1.0), 'north island (jump at the bottom)', 'kick:sw23');
  const T22 = tramp('t22', -56.0, -23.2, r2(I24.top + 0.3), 2.2, { min: 21 });
  hop(I24, T22, 'north island > trampoline');
  const I25 = island(-57.0, -18.0, r2(I24.top + 8.0), 7.0, { name: 'high island' });
  B.link(P(T22), P(I25, 1.0, 1.0), 'bounce'); mark(P(I25, 1.0, 1.4), 'high island', 'via:t22');
  const C25 = column(-58.0, -18.6, I25.top, 4, 0);
  net([-58.0, I25.top, -16.6], C25.top, 0);
  mark([-58.0, I25.top, -16.0], 'net 2 (foot)', 'ladder');
  mark(P(C25, -0.6, 0.6), 'deck column 3');
  // easy: a few floating blocks round the east side instead of the first swing
  alt('z2easy', { p: [-46.6, Y2, -15.2], label: 'deck 2 (east end)' }, [
    ['block', -46.0, -13.2, r2(Y2 + 1.2)], ['block', -45.6, -10.2, r2(Y2 + 1.2)],
  ], { p: P(I21, 2.0, -3.0), label: 'swing landing island (joins)' });
  // hard: small blocks straight up to the first column instead of the net
  alt('z2hard', { p: P(I21, 0, -3.2), label: 'swing landing island' }, [
    ['block', -48.6, -6.4, r2(Y2 + 1.2), { size: 1.2 }], ['block', -46.8, -6.0, r2(Y2 + 2.4), { size: 1.2 }],
    ['block', -45.0, -5.4, r2(Y2 + 3.6), { size: 1.2 }],
  ], { p: P(C21, 0.6, -0.4), label: 'deck column (joins)' });
  // secret: from the north island, a long jump east to a hidden block with a gem beyond the edge
  const SEC2 = block(-47.6, -24.0, r2(I24.top - 0.6), 2.4, { color: 'purple' });
  gem('gem2', P(SEC2));
  B.mark('z2secret', P(I24, 2.0, 0), 'north island (east end)');
  B.mark('z2secret', P(SEC2), 'hidden block (gem)');
  B.mark('z2secret', P(I24, 1.0, 0), 'back on the north island');
  hop(I24, SEC2, 'north island > hidden block');
  void D2;
  divider(Y2, Y3 - 0.6, [[-20.6, -16.6, C25.top - 1, Y3 + 4]]);
  EXIT = P(C25);
  console.log('zone 2 placed');
}


if (upTo(3)) {
  // =====================================================================================
  // ZONE 3 – ROPE BRIDGES & SEESAW (1214–1246, west): a seesaw over the gap south, the roundabout, a climbing net,
  // a swaying rope bridge back north, a trampoline onto the tall tower in the north-west - its top has a red button
  // that lowers the drawbridge at the start of the zone for good (a shortcut: next time straight across and up the
  // rope ladder) - a high trampoline, a net up the last column, a hop east into zone 4.
  //   easy: blocks beside the seesaw · hard: small blocks instead of the trampoline to the tower
  //   secret: thrown off the roundabout's far side, a hidden block with a gem
  // =====================================================================================
  const D3 = island(-63.0, -19.0, Y3, 6.0, { name: 'deck 3' });
  mark(P(D3, 1.4), 'deck 3');
  checkpoint('cp3', [-62.0, Y3, -20.6], -90);
  const SS3 = seesaw('ss3', -63.0, -11.0, r2(Y3 + 0.6), 10.0);
  hop(D3, { ...SS3, z: -15.4, hz: 0.5 }, 'deck > seesaw');
  mark(SS3.a, 'seesaw (north end)'); mark([SS3.x, SS3.top, -11.0], 'seesaw (middle)'); mark(SS3.b, 'seesaw (south end)');
  const S31 = island(-62.6, -3.4, Y3, 5.0, { name: 'roundabout island' });
  hop({ ...at(SS3.b, 0.75), top: r2(SS3.top - 0.7) }, S31, 'seesaw > island');
  mark(P(S31, 0, -1.0), 'roundabout island');
  const RB3 = roundabout('rb3', -67.6, -3.0, r2(Y3 + 0.35), 2.4, 35);
  hop(S31, RB3, 'island > roundabout');
  mark(P(RB3, 1.2), 'roundabout', 'turn:rb3');
  const S32 = island(-74.0, 0.6, Y3, 6.0, { name: 'west island' });
  hop(RB3, S32, 'roundabout > west island');
  mark(P(S32, 1.6, 1.0), 'west island');
  const C33 = column(-74.5, 0.6, Y3, 3, 180);
  net([-72.45, Y3, 0.6], C33.top, 90);
  mark([-71.9, Y3, 0.6], 'net (foot)', 'ladder');
  mark(P(C33, 0, -0.8), 'deck column');
  const RBR = ropeBridge('rb3b', [-74.5, C33.top, -1.5], [-74.5, C33.top, -11.9]);
  RBR.forEach((p, i) => mark(p, `rope bridge ${i + 1}`));
  const N2 = island(-74.0, -13.8, C33.top, 5.0, { name: 'bridge island' });
  mark(P(N2, 0, 0.8), 'bridge island');
  const T31 = tramp('t31', -74.0, -14.6, r2(N2.top + 0.3), 2.2, { min: 20 });
  // the tall tower in the north-west: 6 decks on a small island; its top has the drawbridge button
  const N3 = island(-74.0, -19.4, Y3, 6.0, { name: 'tower island' });
  const C36 = column(-74.0, -19.4, Y3, 6, 180);
  B.link(P(T31), P(C36, 0.6, 1.2), 'bounce'); mark(P(C36, 0.6, 1.2), 'tall tower (top)', 'via:t31');
  const DB = drawbridge('db3', [-66.05, Y3, -18.6], -90, 5.6);
  B.node(DB.mid); B.node(DB.end);
  button('bt3', [-73.6, r2(C36.top + 0.12), -18.0], 'db3'); // right where the trampoline drops you: nobody misses it
  mark([-73.6, C36.top, -18.0], 'red button (lowers the drawbridge)');
  // the shortcut once the drawbridge is down: across it, up the rope ladder on the tower
  net([-71.95, Y3, -18.4], C36.top, 90, { rope: true });
  B.link(P(D3, 1.4), DB.mid, 'walk'); B.link(DB.end, [-71.6, Y3, -18.4], 'walk');
  B.mark('z3short', P(D3, 1.4), 'deck 3');
  B.mark('z3short', DB.mid, 'drawbridge (down)');
  B.mark('z3short', [-71.6, Y3, -18.4], 'rope ladder (foot)', 'ladder');
  B.mark('z3short', P(C36, -0.8, 1.2), 'tall tower (top)');
  // up: a high trampoline on the tower to an island, a net up the last column, a hop east into zone 4
  const T32 = tramp('t32', -74.4, -20.2, r2(C36.top + 0.3), 2.0, { min: 22 });
  hop(C36, T32, 'tower > high trampoline');
  const I37 = island(-67.5, -21.0, r2(C36.top + 7.4), 7.0, { name: 'high island' });
  B.link(P(T32), P(I37, -2.0), 'bounce'); mark(P(I37, -2.0), 'high island', 'via:t32');
  const C37 = column(-65.0, -21.8, I37.top, 4, 90);
  net([-65.0, I37.top, -19.75], C37.top, 0);
  mark([-65.0, I37.top, -19.2], 'net (foot)', 'ladder');
  mark(P(C37, 0.6), 'last column');
  // easy: blocks beside the seesaw
  alt('z3easy', { p: P(D3, -1.4, 1.2), label: 'deck 3' }, [
    ['block', -65.0, -15.6, r2(Y3 + 0.6)], ['block', -65.4, -12.4, r2(Y3 + 1.2)], ['block', -65.0, -9.2, r2(Y3 + 0.6)], ['block', -64.4, -6.4, Y3],
  ], { p: P(S31, -0.6, -0.4), label: 'roundabout island (joins)' });
  // hard: small blocks up to the tower instead of the trampoline
  alt('z3hard', { p: P(N2, 0, 0.8), rec: N2, label: 'bridge island' }, [
    ['block', -71.4, -13.4, r2(N2.top + 1.2), { size: 1.2 }], ['block', -70.6, -15.4, r2(N2.top + 2.4), { size: 1.2 }],
    ['block', -70.4, -17.6, r2(N2.top + 3.6), { size: 1.2 }], ['block', -70.4, -19.8, r2(N2.top + 4.8), { size: 1.2 }],
    ['block', -70.6, -22.0, r2(N2.top + 6.0), { size: 1.2 }],
  ], { p: [-72.8, C36.top, -20.8], label: 'tall tower (joins)' });
  // secret: off the roundabout's south side, a long jump to a hidden block with a gem
  const SEC3 = block(-67.6, 3.2, r2(Y3 - 0.4), 2.0, { color: 'green' });
  gem('gem3', P(SEC3));
  B.mark('z3secret', P(RB3, 0, 1.4), 'roundabout (south side)', 'turn:rb3');
  B.mark('z3secret', P(SEC3), 'hidden block (gem)');
  hop(RB3, SEC3, 'roundabout > hidden block');
  void N3; void S32;
  divider(Y3, Y4 - 0.6, [[-20.6, -16.6, Y3 - 2, Y3 + 4], [-24.0, -19.6, C37.top - 1, Y4 + 4]]);
  EXIT = P(C37);
  console.log('zone 3 placed');
}

if (upTo(4)) {
  // =====================================================================================
  // ZONE 4 – SEA OF BALLS (1246–1280, east): a climbing net up a deck column, small blocks over a big ball pit (fall
  // in and you just wade out and try again), a trampoline to the upper island, a climbing net, a high trampoline into
  // zone 5.   easy: stairs to a second column instead of the blocks · hard: small blocks instead of the trampoline
  //   secret: off the upper island's east edge, down into a hidden ball pit (gem), a rope ladder back up
  // =====================================================================================
  const D4 = island(-53.5, -19.5, Y4, 16.0, { name: 'deck 4' });
  mark([-58.8, Y4, -21.8], 'deck 4');
  checkpoint('cp4', [-58.0, Y4, -24.0], 90);
  const C41 = column(-57.0, -16.0, Y4, 3, 180);
  net([-57.0, Y4, -18.05], C41.top, 180);
  mark([-57.0, Y4, -18.6], 'net (foot)', 'ladder');
  mark(P(C41, 0.6, 0.4), 'deck column');
  const PIT1 = ballPit('pit4', -50.6, -16.0, Y4, 6.6);
  const BL4 = [block(-53.4, -15.0, r2(C41.top + 1.2), 1.2), block(-50.8, -16.2, r2(C41.top + 2.4), 1.2), block(-48.2, -15.0, r2(C41.top + 3.6), 1.2)];
  hop(C41, BL4[0], 'column > block 1'); BL4.forEach((b, i) => { if (i) hop(BL4[i - 1], b, `block ${i} > ${i + 1}`); });
  const I42 = island(-48.0, -10.4, r2(BL4[2].top + 0.6), 7.0, { name: 'island over the balls' });
  hop(BL4[2], I42, 'block 3 > island');
  const T41 = tramp('t41', -48.4, -9.6, r2(I42.top + 0.3), 2.2, { min: 20 });
  const I43 = island(-52.0, -3.6, r2(I42.top + 6.2), 9.0, { name: 'upper island' });
  const C43 = column(-54.4, -3.0, I43.top, 4, 90);
  net([-52.35, I43.top, -3.0], C43.top, 90);
  var T43 = tramp('t43', -55.6, -3.0, r2(C43.top + 0.3), 2.0, { min: 22 });
  // the main route marks (the pit is a detour for those who fall)
  const M4 = mark;
  M4(P(BL4[0]), 'block 1'); M4(P(BL4[1]), 'block 2'); M4(P(BL4[2]), 'block 3');
  M4(P(I42, 0.4, -1.4), 'island over the balls');
  B.link(P(T41), P(I43, 1.6, -1.6), 'bounce'); M4(P(I43, 1.6, -1.6), 'upper island', 'via:t41');
  M4([-51.8, I43.top, -3.0], 'net (foot)', 'ladder');
  M4(P(C43, 0.6, 1.0), 'deck column 2');
  hop(C43, T43, 'column > high trampoline');
  // easy: stairs from the first column to a second one, then a hop to the island over the balls
  const C42 = column(-55.5, -8.5, Y4, 4, -90);
  stairs(-57.0, -13.95, C41.top, 0, STORY);
  const EB4 = block(-52.4, -9.0, r2(C42.top + 1.1), 1.6, { color: 'green' });
  alt('z4easy', { p: P(C41, -0.4, 0.8), label: 'deck column' }, [
    { p: [-57.0, r2(C41.top + STORY / 2), -12.2], label: 'stairs' },
    { p: P(C42, -0.6, 0.4), rec: C42, label: 'second column' },
    { p: P(EB4), rec: EB4, label: 'block' },
  ], { p: P(I42, -1.4, 0.2), rec: I42, label: 'island over the balls (joins)' });
  // the pit: whoever falls in wades to its edge and climbs out
  B.mark('z4pit', [-50.6, PIT1.floor, -16.0], 'in the ball pit');
  B.mark('z4pit', [-50.6, Y4, -21.2], 'out of the pit');
  B.mark('z4pit', [-57.0, Y4, -18.6], 'back at the net');
  // hard: small blocks up to the upper island instead of the trampoline
  alt('z4hard', { p: P(I42, 0.4, -1.4), rec: I42, label: 'island over the balls' }, [
    ['block', -45.6, -8.0, r2(I42.top + 1.2), { size: 1.2 }], ['block', -45.4, -5.6, r2(I42.top + 2.4), { size: 1.2 }],
    ['block', -45.6, -3.2, r2(I42.top + 3.6), { size: 1.2 }], ['block', -46.0, -0.8, r2(I42.top + 4.8), { size: 1.2 }],
  ], { p: P(I43, 2.6, 1.2), label: 'upper island (joins)' });
  // secret: a hidden ball pit below the upper island's south-east corner (gem), a rope ladder back up
  const SECI = island(-45.6, 1.0, r2(I42.top - 3.0), 7.0, { name: 'hidden island' });
  const PIT2 = ballPit('pit4b', -44.6, 1.5, SECI.top, 4.0, { n: 10 });
  gem('gem4', [-44.6, PIT2.top, 1.5]);
  net([-48.3, SECI.top, r2(I43.z + I43.hz)], I43.top, 0, { rope: true });
  B.mark('z4secret', P(I43, 3.4, 2.2), 'upper island (south-east corner)');
  B.mark('z4secret', [-44.6, PIT2.floor, 1.5], 'hidden ball pit (gem)');
  B.mark('z4secret', [-48.3, SECI.top, 0.0], 'rope ladder (foot)', 'ladder');
  B.mark('z4secret', P(I43, 3.0, 0.6), 'back on the upper island');
  void D4;
  divider(Y4, Y5 - 0.6, [[-24.0, -19.6, Y4 - 2, Y4 + 4], [-5.0, -1.0, C43.top - 1, Y5 + 4]]);
  EXIT = P(C43);
  console.log('zone 4 placed');
}

if (upTo(5)) {
  // =====================================================================================
  // ZONE 5 – TUBE MAZE (1280–1314, west): a climbing net up a column, through a crawl tube to the next column, a high
  // trampoline to the north island, a rope ladder up a tall column, through a second tube east over the halves' line,
  // a trampoline up into zone 6. On the deck, three buttons: pressed in the order of the coloured blocks stacked by the
  // net (bottom to top) they raise a staircase of soft blocks to the north island for good (a shortcut).
  //   easy: blocks to the second column and its own net · hard: small blocks instead of the rope ladder
  //   secret: a crawl tube sticking out of the deck's west edge (gem inside)
  // =====================================================================================
  const D5 = island(-66.5, -3.0, Y5, 16.0, { name: 'deck 5' });
  B.link(P(T43), [-60.2, Y5, -3.0], 'bounce'); mark([-60.2, Y5, -3.0], 'deck 5 (bounced over)', 'via:t43');
  checkpoint('cp5', [-61.0, Y5, 0.6], -90);
  const C51 = column(-70.5, -5.5, Y5, 3, 180);
  net([-68.45, Y5, -5.5], C51.top, 90);
  mark([-67.9, Y5, -5.5], 'net (foot)', 'ladder');
  mark(P(C51, 0, -1.0), 'deck column');
  const I52 = island(-70.5, -16.0, Y5, 7.0, { name: 'tube island' });
  const C52 = column(-70.5, -15.6, Y5, 3, 0);
  const TB1 = tube([-70.5, C51.top, -7.5], [-70.5, C51.top, -13.6]);
  mark(TB1.mid, 'crawl tube');
  mark(P(C52, 0, 1.0), 'deck column 2');
  const T51 = tramp('t51', -69.4, -16.8, r2(C52.top + 0.3), 2.0, { min: 22 });
  const I53 = island(-65.0, -20.4, r2(C52.top + 8.0), 8.0, { name: 'north island' });
  B.link(P(T51), P(I53, -1.4, 2.0), 'bounce'); mark(P(I53, -1.4, 2.0), 'north island', 'via:t51');
  const C53 = column(-65.0, -21.6, I53.top, 5, 90);
  net([-65.0, I53.top, -19.55], C53.top, 0, { rope: true });
  mark([-65.0, I53.top, -19.1], 'rope ladder (foot)', 'ladder');
  mark(P(C53, -0.6, 0.4), 'tall column');
  const I54 = island(-55.0, -21.4, I53.top, 6.0, { name: 'east island' });
  const C54 = column(-55.4, -21.6, I53.top, 5, 0);
  const TB2 = tube([-63.0, C53.top, -21.6], [-57.4, C53.top, -21.6]);
  mark(TB2.mid, 'crawl tube 2');
  mark(P(C54, 0.4, 0.8), 'tall column 2');
  var T52 = tramp('t52', -54.4, -20.6, r2(C54.top + 0.3), 2.0, { min: 21 });
  hop(C54, T52, 'column > trampoline');
  // the three-button puzzle: the order = the colours of the blocks stacked by the net, bottom to top
  ['red', 'yellow', 'blue'].forEach((c, i) => block(-68.0, -1.6, r2(Y5 + 0.9 * (i + 1)), 0.9, { color: c }));
  SIGN([-68.0, r2(Y5 + 4.4), -1.4], 0, 'DƯỚI → TRÊN', 'Bấm ba nút theo thứ tự màu');
  const PZ = [['red', -73.2, 1.4], ['yellow', -61.4, 1.6], ['blue', -62.6, -8.0]];
  const PZC = { red: '#ff4d6d', yellow: '#ffc928', blue: '#3c9bff' };
  PZ.forEach(([c, x, z], i) => button(`pz5${i + 1}`, [x, Y5 + 0.15, z], i === 0 ? 'steps5' : undefined, { puzzle: 'pz5', order: i + 1, color: PZC[c] }));
  const STEPS = [];
  for (let i = 0; i < 12; i++) {
    const x = i % 2 ? -63.6 : -61.4, z = -9.9 - i * 0.72;
    STEPS.push(revealBlock(`st5${i + 1}`, 'steps5', x, z, r2(Y5 + 1.2 * (i + 1)), 1.6, COLS[i % 5], i * 0.12));
  }
  B.mark('z5puzzle', [-73.2, Y5 + 0.15, 1.4], 'red button');
  B.mark('z5puzzle', [-61.4, Y5 + 0.15, 1.6], 'yellow button');
  B.mark('z5puzzle', [-62.6, Y5 + 0.15, -8.0], 'blue button');
  B.mark('z5puzzle', P(STEPS[0]), 'puzzle step 1 (up)');
  B.mark('z5short', [-61.4, Y5 + 0.15, 1.6], 'yellow button');
  B.mark('z5short', P(STEPS[0]), 'puzzle steps');
  STEPS.forEach((st, i) => { if (i) B.mark('z5short', P(st), `puzzle step ${i + 1}`); });
  B.mark('z5short', P(I53, 1.6, 2.4), 'north island (joins)');
  hop(STEPS[11], I53, 'steps > north island');
  // easy: blocks to the second column's island and its own net
  net([-72.55, Y5, -15.6], C52.top, -90);
  alt('z5easy', { p: [-73.4, Y5, -7.2], label: 'deck 5 (north-west)' }, [
    ['block', -73.0, -10.0, r2(Y5 + 0.6)], ['block', -73.0, -12.4, r2(Y5 + 0.6)],
  ], { p: [-73.2, Y5, -15.6], label: 'net (foot)', act: 'ladder' });
  B.mark('z5easy', P(C52, -0.6, 0.6), 'deck column 2 (joins)');
  // hard: small blocks up beside the tall column instead of the rope ladder
  alt('z5hard', { p: P(I53, -1.4, 2.0), rec: I53, label: 'north island' }, [
    ['block', -67.4, -23.8, r2(I53.top + 1.2), { size: 1.2 }], ['block', -66.0, -25.6, r2(I53.top + 2.4), { size: 1.2 }],
    ['block', -63.8, -25.8, r2(I53.top + 3.6), { size: 1.2 }], ['block', -61.8, -24.6, r2(I53.top + 4.8), { size: 1.2 }],
    ['block', -61.6, -22.4, r2(I53.top + 6.0), { size: 1.2 }], ['block', -61.6, -20.0, r2(I53.top + 7.2), { size: 1.2 }],
    ['block', -61.4, -17.8, r2(I53.top + 8.4), { size: 1.2 }], ['block', -63.0, -16.6, r2(I53.top + 9.6), { size: 1.2 }],
    ['block', -64.6, -17.6, r2(I53.top + 10.8), { size: 1.2 }],
  ], { p: P(C53, -0.4, 1.0), label: 'tall column (joins)' });
  // secret: a crawl tube out of the deck's west edge, a gem at its far end
  const TB3 = tube([-74.4, Y5, -2.0], [-79.9, Y5, -2.0]);
  gem('gem5', [-79.0, Y5, -2.0]);
  B.mark('z5secret', [-73.4, Y5, -2.0], 'deck 5 (west edge)');
  B.mark('z5secret', [-79.0, Y5, -2.0], 'end of the tube (gem)');
  B.mark('z5secret', [-73.0, Y5, -2.0], 'back on the deck');
  void D5; void TB3; void I52; void I54;
  divider(Y5, Y6 - 0.6, [[-5.0, -1.0, Y5 - 2, Y5 + 4], [-23.6, -19.6, C53.top - 1, C53.top + 3.2]]);
  EXIT = P(C54);
  console.log('zone 5 placed');
}

if (upTo(6)) {
  // =====================================================================================
  // ZONE 6 – SLIDE HILL (1314–1350, east): a climbing net up a deck column, down the straight slide and jump off its
  // end to fly over the gap (miss and you land in the ball pit below, a rope ladder takes you back up), a high
  // trampoline, a rope ladder up a tall column, down the curved slide and jump off its end north, a trampoline, a net,
  // a hop west onto the Master Tower.   easy: blocks round the gap instead of the straight slide · hard: small blocks
  // instead of the tall column's rope ladder · secret: the ball pit under the first slide hides a gem
  // =====================================================================================
  const D6 = island(-48.4, -19.5, Y6, 8.0, { name: 'deck 6' });
  B.link(P(T52), [-51.4, Y6, -18.0], 'bounce'); mark([-51.4, Y6, -17.6], 'deck 6 (bounced over)', 'via:t52');
  checkpoint('cp6', [-45.2, Y6, -17.4], 90);
  const C61 = column(-48.4, -20.3, Y6, 3, 0);
  net([-50.45, Y6, -20.3], C61.top, -90);
  mark([-51.0, Y6, -20.3], 'net (foot)', 'ladder');
  mark(P(C61, 0, 0.6), 'deck column');
  const SS = 3.6, SL1 = slide('sl61', 'straight_slide', -48.4, r2(-18.3 + 0.843 * SS), r2(C61.top - 0.73 * SS), SS, 0, STRAIGHT);
  const I62 = island(-47.0, -2.8, r2(SL1.end[1] - 0.1), 8.0, { name: 'slide landing island' });
  B.link(SL1.start, P(I62, -1.0, -1.6), 'slide'); mark(P(I62, -1.0, -1.6), 'over the gap (jump off the slide)', 'slidej:sl61');
  // below the gap: a ball pit catches whoever misses; a rope ladder up to the landing island
  const PI6 = island(-47.0, -6.0, r2(Y6 - 8.0), 8.0, { name: 'ball pit island' });
  const PIT6 = ballPit('pit6', -46.8, -6.0, PI6.top, 5.0, { n: 12 });
  net([-50.4, PI6.top, r2(I62.z - I62.hz)], I62.top, 180, { rope: true });
  const T62 = tramp('t62', -45.0, -2.4, r2(I62.top + 0.3), 2.2, { min: 22 });
  const I63 = island(-49.0, 2.8, r2(I62.top + 8.0), 8.0, { name: 'upper island' });
  B.link(P(T62), P(I63, 2.0, -1.6), 'bounce'); mark(P(I63, 2.0, -1.4), 'upper island', 'via:t62');
  const C63 = column(-49.5, 3.4, I63.top, 4, 180);
  net([-49.5, I63.top, 1.35], C63.top, 180, { rope: true });
  mark([-49.5, I63.top, 0.9], 'rope ladder (foot)', 'ladder');
  mark(P(C63, -0.6, 0.6), 'tall column');
  const CS = 3.6, SL2 = slide('sl62', 'curved_slide', r2(-47.5 + 0.85 * CS), r2(3.4 + 0.05 * CS), r2(C63.top - 0.67 * CS), CS, 180, CURVED);
  const I64 = island(-42.6, -7.4, r2(SL2.end[1] - 0.6), 7.0, { name: 'slide landing island 2' });
  B.link(SL2.start, P(I64, 0, 1.2), 'slide'); mark(P(I64, 0, 1.2), 'north island (jump off the slide)', 'slidej:sl62');
  const T64 = tramp('t64', -44.2, -9.4, r2(I64.top + 0.3), 2.0, { min: 23 });
  const I65 = island(-48.6, -13.4, r2(I64.top + 9.0), 7.0, { name: 'last island' });
  B.link(P(T64), P(I65, 2.0, 1.4), 'bounce'); mark(P(I65, 2.0, 1.4), 'last island', 'via:t64');
  // easy: floating blocks along the east side of the gap instead of the straight slide
  alt('z6easy', { p: P(C61, 0.6, 0.6), label: 'deck column' }, [
    ['block', -45.0, -16.4, r2(C61.top - 0.4)], ['block', -44.4, -13.2, r2(C61.top - 0.8)], ['block', -44.4, -10.0, r2(C61.top - 1.2)],
    ['block', -44.6, -6.8, r2(C61.top - 1.6)],
  ], { p: P(I62, 1.6, -1.2), label: 'slide landing island (joins)' });
  // the ball pit (missed the jump): wade out, up the rope ladder
  B.mark('z6pit', [-46.8, PIT6.floor, -6.0], 'in the ball pit');
  B.mark('z6pit', [-50.4, PI6.top, -7.6], 'out of the pit');
  B.mark('z6pit', [-50.4, PI6.top, -6.1], 'rope ladder (foot)', 'ladder');
  B.mark('z6pit', P(I62, -2.0, -1.0), 'slide landing island');
  gem('gem6', [-46.8, PIT6.top, -6.0]);
  // hard: small blocks up the tall column's east side instead of the rope ladder
  alt('z6hard', { p: P(I63, 2.0, -1.4), rec: I63, label: 'upper island' }, [
    ['block', -45.6, 2.2, r2(I63.top + 1.2), { size: 1.2 }], ['block', -45.2, 4.6, r2(I63.top + 2.4), { size: 1.2 }],
    ['block', -46.4, 6.6, r2(I63.top + 3.6), { size: 1.2 }], ['block', -48.8, 7.2, r2(I63.top + 4.8), { size: 1.2 }],
    ['block', -51.2, 6.8, r2(I63.top + 6.0), { size: 1.2 }], ['block', -52.6, 4.8, r2(I63.top + 7.2), { size: 1.2 }],
    ['block', -52.8, 2.4, r2(I63.top + 8.4), { size: 1.2 }],
  ], { p: P(C63, -1.0, -0.6), label: 'tall column (joins)' });
  void D6; void PIT6;
  divider(Y6, Y7 - 2.5, []);
  // a deck column on the last island; from its top a hop west onto the Master Tower's island
  var C66 = column(-49.6, -13.6, I65.top, 2, 90);
  net([-47.55, I65.top, -13.6], C66.top, 90);
  mark([-47.0, I65.top, -13.6], 'net (foot)', 'ladder');
  mark(P(C66, -0.6, 0.6), 'deck column');
  EXIT = P(C66);
  console.log('zone 6 placed');
}

if (upTo(7)) {
  // =====================================================================================
  // ZONE 7 – THE MASTER TOWER (1349–1390, middle): four columns of play decks round the middle, each taller than the
  // last, joined by flights of stairs that wind round them three times (inside the railings), a high trampoline from
  // the tallest column up to the crown island, two flights of stairs to the summit under its striped roof.
  //   easy: a rope ladder down from the crown instead of the trampoline · hard: small blocks from the first lap's top
  //   straight up · secret: the spiral slide off the crown's edge down to a hidden ball pit (gem), a rope ladder back
  //   · the gem portal (5 of 6 gems) on the island: straight up to the crown
  // =====================================================================================
  const D7 = island(-60.0, -9.0, Y7 - 1.0, 18.0, { name: 'master tower island' });
  hop(C66 ?? at([-51.5, D7.top, -13.6]), { ...D7, x: -52.5, hx: 0.5 }, 'column > tower island');
  mark([-53.4, D7.top, -12.4], 'master tower island');
  checkpoint('cp7', [-53.2, D7.top, -5.0], 90);
  SIGN([-52.0, r2(D7.top + 3.2), -9.0], 90, 'THÁP CHỦ', 'Cầu thang vòng quanh · lên tới 1390 m');
  // the four corner columns: NE / SE / SW / NW, railings outside, open where the stairs arrive and leave
  const CX = -60.0, CZ = -9.0, Q = 3.75;
  const COL = { NE: [CX + Q, CZ - Q, 0, 8], SE: [CX + Q, CZ + Q, -90, 9], SW: [CX - Q, CZ + Q, 180, 10], NW: [CX - Q, CZ - Q, 90, 11] };
  const TW = {};
  for (const [k, [x, z, r, n]] of Object.entries(COL)) TW[k] = column(x, z, D7.top, n, r, { fixed: true, name: 'master tower deck' });
  // the stairs wind NE -> SE -> SW -> NW -> NE ..., one storey each, three laps
  const order = ['NE', 'SE', 'SW', 'NW'];
  const flight = { NE: [CX + Q, CZ - Q + 2.05, 0], SE: [CX + Q - 2.05, CZ + Q, -90], SW: [CX - Q, CZ + Q - 2.05, 180], NW: [CX - Q + 2.05, CZ - Q, 90] };
  mark([CX + Q - 0.6, D7.top, CZ - Q - 0.4], 'tower (NE, ground)');
  const lv = (k) => r2(D7.top + STORY * k);
  for (let k = 0; k < 11; k++) {
    const from = order[k % 4], to = order[(k + 1) % 4], [fx, fz, dir] = flight[from];
    stairs(fx, fz, lv(k), dir, STORY);
    const [tx, tz] = COL[to];
    mark([tx, lv(k + 1), tz], `${to} level ${k + 1} (up the stairs)`);
  }
  // from the tallest column (NW, level 11) a high trampoline up to the crown island (it floats over the tower's south half)
  const T71 = tramp('t71', CX - Q, r2(CZ - Q - 0.8), r2(lv(11) + 0.3), 2.0, { min: 25 });
  const CR = island(CX, -7.0, r2(lv(11) + 10.2), 9.0, { name: 'crown island' });
  B.link(P(T71), [CX - 2.0, CR.top, -9.2], 'bounce'); mark([CX - 2.0, CR.top, -9.2], 'crown island', 'via:t71');
  // the summit: a column of 2 decks with the striped roof, up a climbing net
  const SUM = column(CX - 1.5, -6.0, CR.top, 2, 180, { fixed: true, name: 'summit deck' });
  B.prefab('tower_roof', r2(CX - 1.5), SUM.top, -6.0, 0, 6.0, { name: 'summit roof', col: false }); // (decor: its trim hangs at head height)
  net([CX - 1.5, CR.top, -8.05], SUM.top, 180);
  mark([CX - 1.5, CR.top, -8.6], 'net (foot)', 'ladder');
  EXIT = [r2(CX - 1.5), SUM.top, -6.0];
  mark(EXIT, 'EXIT');
  SIGN([CX - 1.5, r2(SUM.top + 2.4), -8.2], 180, 'ĐỈNH SÂN CHƠI', '1390 m · trượt xuống cho vui!');
  // the victory slide: the spiral slide from the summit round its pole down to the crown island
  {
    const ss = r2((SUM.top - CR.top) / 0.85), yaw = -150, px = r2(CX + 0.5 + 0.33 * ss - 0.25), pz = -6.0;
    B.prefab('spiral_slide', px, CR.top, pz, yaw, ss, { name: 'spiral slide', col: false });
    const H = [[100, 0.85], [150, 0.83], [180, 0.8], [210, 0.77], [240, 0.71], [264, 0.65], [296, 0.57], [319, 0.52], [349, 0.47], [382, 0.42], [410, 0.395],
      [430, 0.35], [450, 0.32], [470, 0.265], [490, 0.215], [510, 0.185], [530, 0.165], [560, 0.15], [600, 0.13], [630, 0.1], [650, 0.07]];
    const pts = [[r2(CX + 0.2), SUM.top, -6.0]];
    for (const [th, h] of H) {
      const a = ((th + yaw) * Math.PI) / 180, rr = th < 130 ? 0.16 : 0.3;
      pts.push([r2(px + Math.sin(a) * rr * ss), r2(CR.top + h * ss + 0.02), r2(pz + Math.cos(a) * rr * ss)]);
    }
    const a1 = ((650 + yaw) * Math.PI) / 180, tx = Math.cos(a1), tz = -Math.sin(a1); // tangent of the descent (angle increasing)
    const last = pts[pts.length - 1];
    pts.push([r2(last[0] + tx * 1.2), r2(CR.top + 0.25), r2(last[2] + tz * 1.2)]);
    devices.push({ t: 'slide', id: 'sl71', p: pts[0], pts, w: 1.3, vmax: 8, fric: 2.0, bare: true });
    B.mark('z7fun', [CX - 1.0, SUM.top, -5.2], 'summit');
    B.mark('z7fun', [r2(last[0] + tx * 3.0), CR.top, r2(last[2] + tz * 3.0)], 'down the spiral slide', 'slide:sl71');
  }
  // secret: in the tower's courtyard, between the four columns at the bottom, a gem
  gem('gem7', [CX, D7.top, CZ]);
  B.mark('z7secret', [CX + Q - 0.6, D7.top, CZ - Q - 0.4], 'tower (NE, ground)');
  B.mark('z7secret', [CX, D7.top, CZ], 'the courtyard (gem)');
  // easy: a rope ladder hanging down the crown island's north side to the NW column's top
  net([CX - 2.6, lv(11), r2(CR.z - CR.hz)], CR.top, 180, { rope: true });
  B.mark('z7easy', [CX - 2.6, lv(11), r2(CR.z - CR.hz - 1.2)], 'NW column top');
  B.mark('z7easy', [CX - 2.6, lv(11), r2(CR.z - CR.hz - 0.5)], 'rope ladder (foot)', 'ladder');
  B.mark('z7easy', [CX - 2.6, CR.top, r2(CR.z - CR.hz + 1.2)], 'crown island');
  // hard: from the NE column's top (level 8), small blocks up round the outside to the crown
  // (a helix of small blocks east of the tower: 14 blocks, 1.2 m each, from the NE column's top round to the crown's east edge)
  const HX = -51.8, HZ = -7.0, HR = 3.0;
  alt('z7hard', { p: [CX + Q + 1.0, lv(8), CZ - Q - 1.2], label: 'NE column top' }, Array.from({ length: 14 }, (_, i) => {
    const a = ((210 + (i * 420) / 13) * Math.PI) / 180;
    return ['block', r2(HX + HR * Math.sin(a)), r2(HZ + HR * Math.cos(a)), r2(lv(8) + 1.2 * (i + 1)), { size: 1.2 }];
  }), { p: [CX + 3.2, CR.top, -7.0], label: 'crown island (joins)' });
  // the gem portal: 5 of the 6 gems, from the tower island straight up to the crown
  const PT = [CX - 6.8, D7.top, CZ];
  portal('pt7', PT, 90, [CX + 3.0, CR.top, -8.6], 90, 5);
  SIGN([CX - 8.4, r2(D7.top + 3.4), CZ - 2.6], -90, 'CỔNG ĐÁ QUÝ', 'Cần 5 viên đá quý · bay lên đảo vương miện');
  B.mark('portal', [CX - 8.4, D7.top, CZ], 'in front of the portal (needs 5 gems)');
  B.mark('portal', [CX + 3.0, CR.top, -8.6], 'portal exit (crown island)');
  void D7; void TW;
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
await plotMap(B, val, new URL('./out/map007_plan.png', import.meta.url).pathname, { cx: C7.x, cz: C7.z, r: 28, y0: Y1 - 5, y1: TOP + 5 });
if (process.env.ZPLOT) {
  const bands = [[HALF.W, Y1, Y2], [HALF.E, Y2, Y3], [HALF.W, Y3, Y4], [HALF.E, Y4, Y5], [HALF.W, Y5, Y6], [HALF.E, Y6, Y7], [{ x0: -72, x1: -48 }, Y7, TOP]];
  for (const [i, [H, a, b]] of bands.entries()) if (upTo(i + 1)) await zonePlot(B, `/tmp/z7_${i + 1}.png`, { x0: H.x0 - 3, x1: H.x1 + 3, z0: Z0 - 2, z1: Z1 + 2, y0: a, y1: b + 1, routes: B.routes, title: `zone ${i + 1}: ${a}–${b}` });
}
console.log('route points', JSON.stringify(Object.fromEntries(Object.entries(B.routes).map(([k, v]) => [k, v.length]))));
if (process.env.NOWRITE) process.exit(0);
const zones = [
  { id: 'A', name: 'Cổng Cầu Vồng', y0: 1148, y1: Y2, color: '#ff6fa8' },
  { id: 'B', name: 'Vườn Xích Đu', y0: Y2, y1: Y3, color: '#3cb4ff' },
  { id: 'C', name: 'Cầu Dây Bập Bênh', y0: Y3, y1: Y4, color: '#ffc928' },
  { id: 'D', name: 'Biển Bóng', y0: Y4, y1: Y5, color: '#ff5f5f' },
  { id: 'E', name: 'Mê Cung Ống', y0: Y5, y1: Y6, color: '#5fd37a' },
  { id: 'F', name: 'Đồi Cầu Trượt', y0: Y6, y1: Y7, color: '#ff9a3c' },
  { id: 'G', name: 'Tháp Chủ', y0: Y7, y1: TOP + 5, color: '#b07cff' },
];
const data = B.toJSON({
  id: 'map007', name: 'Giant Playground', version: 1, height: TOP - Y1, origin: [0, Y1, 0],
  spawn: { p: SPAWN, yaw: Math.PI },
  exit: { p: EXIT, r: 2.6, next: 'map008', label: 'Map 008' },
  finishHint: 'Gợi ý: ở Sân Chơi Khổng Lồ, nhảy khỏi xích đu đúng lúc nó ở điểm thấp nhất sẽ bay xa nhất; bóng trong nhà bóng đỡ mọi cú rơi, và nhớ thứ tự ba hình màu trên tường…',
  challengeTime: 1900,
  zones, milestones: [1170, 1190, 1210, 1230, 1250, 1270, 1290, 1310, 1330, 1350, 1370, 1390],
  region: { c: [C7.x, C7.z], r: RING },
  terrain: { style: 'none', radius: RING, center: [C7.x, Y1 + 20, C7.z], wallTop: 0, plazas: [], paths: [] },
  movers, pads: [], rings: [], ladders, devices,
  audio: { music: 'playground', amb: ['playground', 'birds', 'chimes'], steps: 'soft', wind: 0.9 },
  prefabFiles: Object.fromEntries([...new Set(B.prefabs.map((p) => p.id))].map((id) => [id, `${A}/${id}`])),
  waypoints: makeWaypoints(B.routes, zones),
});
fs.mkdirSync(`${ROOT}packs/map007/maps`, { recursive: true });
// ---------------------------------------------------------------- ambient scenery (the artist's 9 PNGs + Map 005's wheel)
// far: a playground city on the clouds, slide / swing islands, a ball castle, a playground tower, the Ferris wheel
// (bobbing gently); near: rainbow clouds, balloon bunches rising past the tower, white clouds below, pastel above
{
  let seed = 7007;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const R = (a, b) => a + (b - a) * rnd();
  const at2 = (r, a, y) => [r2(C7.x + Math.cos(a) * r), r2(y), r2(C7.z + Math.sin(a) * r)];
  const S = [];
  for (const [n, a, r, y, h] of [['playground_city_far', 0.5, 200, 1150, 90], ['playground_city_far', 3.7, 210, 1230, 100], ['playground_tower_far', 2.2, 180, 1200, 120],
    ['playground_tower_far', 5.3, 185, 1290, 110], ['ferris_wheel_far', 1.4, 170, 1260, 70], ['ball_castle_far', 4.4, 165, 1320, 60]]) S.push({ n, p: at2(r, a, y), h });
  const isl = ['slide_island_far', 'swing_island_far', 'ball_castle_far'];
  for (let i = 0; i < 12; i++) S.push({ n: isl[i % 3], p: at2(R(75, 130), i * 0.53 + R(0, 0.3), R(1140, 1390)), h: r2(R(20, 32)), mv: { k: 'bob', a: r2(R(1.0, 2.2)), s: r2(R(0.18, 0.3)), ph: r2(R(0, 6.28)) } });
  for (let i = 0; i < 6; i++) { const a = R(0, 6.28); S.push({ n: 'rainbow_cloud_far', p: at2(R(70, 120), a, R(1160, 1400)), h: r2(R(18, 28)), mv: { k: 'drift', span: r2(R(80, 120)), s: r2(R(0.3, 0.5)), d: r2(a + Math.PI / 2), a: 1.0, ph: r2(rnd()) } }); }
  for (let i = 0; i < 34; i++) { const a = R(0, 6.28), r = R(42, 140), y = R(1130, 1420); S.push({ n: y > 1280 ? 'cloud_pastel' : 'cloud_white', p: at2(r, a, y), h: r2(R(9, 22)), mv: { k: 'drift', span: r2(R(90, 150)), s: r2(R(0.7, 1.5)), d: r2(a + Math.PI / 2), a: 0.8, ph: r2(rnd()) } }); }
  // balloon bunches rising past the playground (and float away above it)
  for (let i = 0; i < 14; i++) S.push({ n: 'balloon_cluster_far', p: at2(R(18, 40), R(0, 6.28), Y1 + (i % 7) * 34), h: r2(R(2.0, 3.4)), mv: { k: 'rise', span: r2(R(40, 70)), s: r2(R(0.6, 1.1)), a: 0.6, ph: r2(rnd()) } });
  data.sprites = S;
  data.fx = [...(data.fx ?? []), { t: 'birds', p: [C7.x, 1200, C7.z], r: 50, n: 6, c: '#5a4a7a' }, { t: 'birds', p: [C7.x, 1300, C7.z], r: 58, n: 7, c: '#5a4a7a' }];
  console.log(`scenery: ${S.length} sprites, ${data.fx.length} fx`);
}
data.atlas = `${A}/map007_atlas`;
applyI18n(data);
fs.writeFileSync(`${ROOT}packs/map007/maps/map007.json`, JSON.stringify(data));
fs.writeFileSync(new URL('./out/routes007.json', import.meta.url), JSON.stringify(B.routes));
{
  const { referencedFiles } = await import('./content.mjs');
  const dir = `${ROOT}packs/map007/`;
  const include = ['maps/map007.json', ...[...referencedFiles(data)].filter((f) => fs.existsSync(dir + f))].sort();
  const pf = dir + 'pack.json';
  const old = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')) : {};
  const meta = {
    id: 'map007', name: 'Giant Playground', order: 7, yMin: Y1 - 2, yMax: TOP + 40, entry: 'maps/map007.json', minApp: 5, requires: [],
    summary: 'Sân chơi khổng lồ trên mây · 1150 → 1390 m · 7 khu · khối xốp, tháp sân chơi, xích đu, bập bênh, cầu dây, nhà bóng, ống chui, cầu trượt, cầu kéo và câu đố ba nút',
    include, ...(old.version ? { version: old.version, contentHash: old.contentHash } : {}),
  };
  applyPackI18n('map007', meta);
  fs.writeFileSync(pf, JSON.stringify(meta, null, 1) + '\n');
  console.log(`pack.json: ${include.length} files`);
}
console.log(`prefabs ${B.prefabs.length}, kit ${B.kit.length}, devices ${devices.length}, movers ${movers.length}`);
