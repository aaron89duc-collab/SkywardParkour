// Map 002 – Rooftop City (140 -> 320 m). A city on a floating deck beside the village, reached by a sky bridge.
// Hand-authored: real buildings, rooftops, fire escapes, balconies, a working crane, billboards, a glass tower crown.
// Run: node devtools/build-map002.mjs -> packs/map002/maps/map002.json (downloadable pack) (+ devtools/out/map002_plan.png, routes002.json)
import fs from 'fs';
import { MapBuilder, r2, makeWaypoints } from './mapgen/lib.mjs';
import { plotMap } from './mapgen/plot.mjs';

const DECK = 140;
const CZ = -153; // design frame: local "Z" (south = +) -> world z
const Z = (lz) => lz + CZ;
// the deck itself (a circle that must stay clear of the village's ring, r 85 around the origin)
const DX = 0, DZ = -159, R = 72;
const EDGE = r2(DZ + Math.sqrt(R * R - 81)); // south edge of the deck at x = -9 (bridge landing)
const B = new MapBuilder({ ground: { x: DX, y: DECK, z: DZ, r: R } });
B.seed = 7;

// ---------------------------------------------------------------- helpers
const blds = [];
/** building with its base on the deck (or o.base); faces: x0/x1 west/east, z0/z1 north/south (world z) */
function bld(name, cx, lz, w, d, top, m, o = {}) {
  const base = o.base ?? DECK;
  const par = o.par ?? 0.8;
  B.kitPiece('building', [cx, top, Z(lz)], [w, top - base, d], 0, { m, par, roof: o.roof, blank: o.blank, name });
  const b = { name, cx, cz: Z(lz), w, d, top, par, ptop: top + par, x0: cx - w / 2, x1: cx + w / 2, z0: Z(lz) - d / 2, z1: Z(lz) + d / 2, minFeat: Infinity, kit: B.kit[B.kit.length - 1], base: o.base };
  blds.push(b);
  return b;
}
/** stand point on a roof: fractions -1..1 across the roof (kept 0.8 m inside the parapet) */
const roof = (b, fx, fz) => [r2(b.cx + fx * (b.w / 2 - 0.8)), b.top, r2(b.cz + fz * (b.d / 2 - 0.8))];
const yawOf = { S: 0, E: 90, N: 180, W: -90 };
/** point on a face (outside surface), `along` = world x (N/S faces) or world z (E/W faces) */
function facePt(b, face, along, y) {
  if (face === 'S') return [along, y, b.z1];
  if (face === 'N') return [along, y, b.z0];
  if (face === 'E') return [b.x1, y, along];
  return [b.x0, y, along];
}
const outward = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] };
/** balcony / ledge slab sticking out of a face; returns its stand point (middle of the slab) */
function ledge(b, face, along, top, w = 2.6, depth = 1.4, m = 'concrete', o = {}) {
  b.minFeat = Math.min(b.minFeat, top);
  const [fx, , fz] = facePt(b, face, along, top);
  const [ox, oz] = outward[face];
  const c = [fx + ox * depth / 2, top, fz + oz * depth / 2];
  const ns = face === 'N' || face === 'S';
  B.kitPiece('slab', c, ns ? [w, 0.3, depth] : [depth, 0.3, w], 0, { m });
  if (o.rail) B.kitPiece('rail', [c[0] + ox * (depth / 2 - 0.08), top + 1.0, c[2] + oz * (depth / 2 - 0.08)], [w - 0.2, 1.0], ns ? 0 : 90, { nc: true, m: 'dark' });
  if (o.plant) B.sprite(B.pick(['pink_flower_bush', 'green_bush', 'yellow_wildflowers']), c[0] - (ns ? w * 0.3 : 0), top, c[2] - (ns ? 0 : w * 0.3), 0.7, 0.8);
  return [r2(c[0]), top, r2(c[2])];
}
const ladders = [];
/** ladder on a face from y0 to y1 (visual included unless nv) */
function ladder(b, face, along, y0, y1, nv = false) {
  b.minFeat = Math.min(b.minFeat, y0);
  const [fx, , fz] = facePt(b, face, along, y0);
  const d = { p: [r2(fx), r2(y0), r2(fz)], h: r2(y1 - y0), r: yawOf[face] };
  if (nv) d.nv = true;
  ladders.push(d);
  return d;
}
const pads = [];
/** jump/speed pad (top surface at y); r = arrow direction yaw; tg = landing spot a jump pad aims at.
 * Jump pads are drawn by the game itself (they squash), speed pads come from the prefab system. */
function pad(t, x, y, z, r, v, s = 1, tg = null) {
  const top = t === 'jump' ? 0.96 : 0.93;
  if (t === 'speed') B.prefab('speed_pad', x, y - top * s, z, r, s, { col: false, name: t + 'pad' });
  else B.kitPiece('solid', [x, r2(y - 0.02), z], [2.4 * s, r2(top * s - 0.05), 1.85 * s], r, { vo: true }); // validator/plot only: the game builds the real collider
  const d = { t, p: [r2(x), r2(y), r2(z)], r, v, s };
  if (tg) d.tg = tg.map(r2);
  pads.push(d);
  return [r2(x), r2(y), r2(z)];
}
const rings = [];
function ring(x, y, z, r, s, v = 16) {
  B.prefab('speed_ring', x, y - 0.6 * s, z, r, s, { col: false, name: 'ring' });
  rings.push({ p: [r2(x), r2(y), r2(z)], r, s, v });
}
const movers = [];
/** rooftop AC unit (vent_unit): stepped – pad 0.23, cabinet 0.69, fan housing 0.99 (x height). Returns the top block centre. */
const ac = (x, y, z, s, r = 0, name = 'ac') => {
  B.prefab('vent_unit', x, y, z, r, s, { name });
  const a = (r * Math.PI) / 180, lx = -0.05 * s, lz = -0.36 * s;
  return [r2(x + lx * Math.cos(a) + lz * Math.sin(a)), r2(y + 0.99 * s), r2(z - lx * Math.sin(a) + lz * Math.cos(a))];
};
/** the AC's middle cabinet (a step up to the top) */
const acMid = (x, y, z, s, r = 0) => {
  const a = (r * Math.PI) / 180, lx = -0.03 * s, lz = 0.06 * s;
  return [r2(x + lx * Math.cos(a) + lz * Math.sin(a)), r2(y + 0.69 * s), r2(z - lx * Math.sin(a) + lz * Math.cos(a))];
};
const crate = (x, y, z, s, r = 0) => { B.prefab('wooden_crate', x, y, z, r, s, { name: 'crate' }); return [r2(x), r2(y + s), r2(z)]; };
const barrier = (x, y, z, r, s = 1.1) => B.prefab('railing_barrier', x, y, z, r, s, { name: 'barrier' });
/** street light (Meshy model): the arm points toward yaw r; a soft glow sits under the lamp head */
const lamp = (x, y, z, r = 0, h = 4.6) => {
  B.prefab('street_light_post', x, y, z, r + 90, h, { name: 'street light' });
  const a = (r * Math.PI) / 180;
  B.fx.push({ t: 'glow', p: [r2(x + Math.sin(a) * 0.17 * h), r2(y + 0.86 * h), r2(z + Math.cos(a) * 0.17 * h)], s: 1.7 });
};
/** water tower on a roof; returns ladder + top info. The model's own ladder sits on its local +Z face. */
function waterTower(x, y, z, s, r = 0) {
  B.prefab('water_tower', x, y, z, r, s, { name: 'water tower' });
  const a = (r * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const lx = 0.055 * s, lz = 0.285 * s;
  const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
  const d = { p: [r2(wx), r2(y + 0.15 * s), r2(wz)], h: r2(0.69 * s), r, nv: true };
  ladders.push(d);
  return { ladder: d, rim: y + 0.84 * s, peak: y + 0.99 * s, base: y + 0.15 * s, foot: [r2(x + 0.055 * s * c + 0.33 * s * sn), r2(y + 0.15 * s), r2(z - 0.055 * s * sn + 0.33 * s * c)] };
}
/** laundry line between two points with little cloth sprites */
function laundry(a, b) {
  B.kitPiece('rope', a, [0.025, 0.5], 0, { q: b });
  const n = Math.max(2, Math.floor(Math.hypot(b[0] - a[0], b[2] - a[2]) / 1.4));
  void n;
}
/** zig-zag fire escape on a face: two lanes of metal flights between grate landings (headroom for both) */
function fireEscape(b, face, a0, a1, y0, y1, route = null, floorH = 3.3) {
  b.minFeat = Math.min(b.minFeat, y0);
  const ns = face === 'N' || face === 'S';
  const [ox, oz] = outward[face];
  const LW = 1.25, land = 1.6;
  const n = Math.ceil((y1 - y0) / floorH), fh = (y1 - y0) / n;
  const sg = Math.sign(a1 - a0);
  const run = Math.abs(a1 - a0) - 2 * land;
  const steps = Math.ceil(fh / 0.27);
  const at = (along, y, depth) => { const [fx, , fz] = facePt(b, face, along, y); return [r2(fx + ox * depth), r2(y), r2(fz + oz * depth)]; };
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const y = y0 + fh * i;
    const atA0 = i % 2 === 0;
    const la = atA0 ? a0 + sg * land / 2 : a1 - sg * land / 2;
    const c = at(la, y, LW);
    B.kitPiece('slab', c, ns ? [land, 0.2, 2 * LW] : [2 * LW, 0.2, land], 0, { m: 'grate' });
    const rc = at(la, y + 1.0, 2 * LW - 0.06);
    B.kitPiece('rail', rc, [land, 1.0], ns ? 0 : 90, { m: 'dark' });
    if (i < n) {
      const lane = i % 2;
      const off = lane === 0 ? LW * 0.5 : LW * 1.5;
      const dir = atA0 ? sg : -sg;
      const topAlong = (atA0 ? a1 - sg * land : a0 + sg * land) - dir * (run / steps / 2);
      const tp = at(topAlong, y + fh, off);
      const yaw = ns ? (dir > 0 ? 90 : -90) : (dir > 0 ? 0 : 180);
      B.kitPiece('stairs', tp, [LW - 0.06, fh, run, steps], yaw, { m: 'metal' });
      if (route) {
        B.mark(route, i === 0 ? c : at(la, y, off), 'fire escape landing');
        B.mark(route, at(la + dir * (land / 2 + 0.6), y + fh / steps, off), 'flight foot');
        B.mark(route, at((atA0 ? a1 - sg * land : a0 + sg * land) - dir * 0.5, y + fh, off), 'flight top');
      }
    } else if (route) B.mark(route, c, 'fire escape top');
    pts.push(c);
  }
  return pts;
}

// =====================================================================================
// THE CITY FLOATS ABOVE THE VILLAGE. Generator frame -> world: rotate 180 deg about the old deck centre and move
// the centre to (CX2, CZ2). The village summit podium (world -9, 140, -37) lands right beside the Sky Station.
// Falling off any rooftop drops you onto lower rooftops or all the way down into Starter Village.
// =====================================================================================
const CX2 = -18, CZ2 = 4;
const toWorld = (x, z) => [r2(CX2 - (x - DX)), r2(CZ2 - (z - DZ))];
const fromWorld = (x, z) => [r2(DX + CX2 - x), r2(DZ + CZ2 - z)];
const [PODX, PODZ] = fromWorld(-9, -40.2); // the podium's north edge (where the village gate stands)
// Sky Station: a floating paved platform at 140 m holding the plaza, the first pad and the shops
const STATION = { x0: -27, x1: 14, z0: -112, z1: -96 };
B.kitPiece('slab', [(STATION.x0 + STATION.x1) / 2, DECK, (STATION.z0 + STATION.z1) / 2], [STATION.x1 - STATION.x0, 0.6, STATION.z1 - STATION.z0], 0, { m: 'tile' });
B.kitPiece('rock', [(STATION.x0 + STATION.x1) / 2, DECK - 0.6, (STATION.z0 + STATION.z1) / 2], [STATION.x1 - STATION.x0, STATION.z1 - STATION.z0, 16], 0);
// short footbridge from the summit podium to the station
{
  const zA = PODZ, zB = STATION.z0;
  const L = Math.abs(zB - zA);
  B.kitPiece('slab', [PODX, DECK, (zA + zB) / 2], [4.2, 0.5, L + 0.4], 0, { m: 'tile' });
  for (const sx of [-1, 1]) B.kitPiece('rail', [PODX + sx * 2.0, DECK + 1.1, (zA + zB) / 2], [L, 1.1], 90, { m: 'dark', nc: true });
  for (const sx of [-1, 1]) B.kitPiece('wall', [PODX + sx * 2.5, DECK + 4, (zA + zB) / 2], [0.3, 4.5, L / 2 + 0.3]);
  B.kitPiece('sign', [PODX, DECK + 5.4, zB - 1.5], [5.2, 1.3], 0, { m: 'ROOFTOP CITY|Thành phố trên mái nhà · 140 → 320 m' });
  for (const sx of [-1, 1]) B.kitPiece('slab', [PODX + sx * 2.7, DECK + 4.2, zB - 1.5], [0.25, 4.2, 0.25], 0, { m: 'dark', nc: true });
}
const onStation = (x, z) => x > STATION.x0 + 0.5 && x < STATION.x1 - 0.5 && z > STATION.z0 + 0.5 && z < STATION.z1 - 0.5;

// =====================================================================================
// ZONE A – SKY STATION (140–157): plaza, first jump pad, shop roofs, the first water tower
// =====================================================================================
const SPAWN = [-9, DECK, r2(STATION.z0 + 4)];
const PLAZA = [-9, DECK, Z(49)];
B.mark('main', SPAWN, 'spawn');
B.mark('main', PLAZA, 'plaza');
// station canopy over the bridge end
for (const [dx, dz] of [[-3, -1.5], [3, -1.5], [-3, 3], [3, 3]]) B.kitPiece('slab', [-9 + dx, DECK + 4.2, r2(STATION.z0 + 4 + dz)], [0.3, 4.2, 0.3], 0, { m: 'dark' });
B.kitPiece('slab', [-9, DECK + 4.5, r2(STATION.z0 + 4.75)], [7.2, 0.3, 6.6], 0, { m: 'metal' });
lamp(-14.5, DECK, Z(46), 90); lamp(-3.5, DECK, Z(46), -90);
barrier(-16, DECK, Z(52), 90); barrier(-2, DECK, Z(52.5), -90);

// S1 / S3 – decorative shops around the plaza; S2 – the first roof (reached by the jump pad)
B.prefab('brick_building', -22, DECK, Z(47), 90, 9, { name: 'S1 shop' });
const S2 = B.prefab('brick_building', 9, DECK, Z(47), -90, 8.5, { name: 'S2 shop' }); // roof 146.97, railings east+south
const S2roof = [8.6, r2(DECK + 0.82 * 8.5), Z(47)];
const J1 = pad('jump', 1.4, DECK + 0.36, Z(47), 90, 22, 1, S2roof);
B.mark('main', J1, 'J1 jump pad', 'topad');
B.mark('main', S2roof, 'S2 roof', 'pad');
B.link(J1, S2roof, 'pad');
crate(-2.2, DECK, Z(50.8), 1.1, 20); crate(-2.0, DECK + 1.1, Z(50.9), 0.9, -10);

// B1 with water tower W1
const B1 = bld('B1', 9, 36.65, 11, 8, 150.6, 'mint', { par: 0 });
const AC1 = ac(9.5, S2roof[1], Z(44.5), 2.2, 0, 'AC1');
B.mark('main', AC1, 'AC1');
B.mark('main', [9.0, B1.top, Z(39.9)], 'B1 roof');
const W1 = waterTower(10.9, B1.top, Z(35.9), 9, 0);
B.mark('main', W1.foot, 'W1 base');
const W1top = [W1.ladder.p[0], r2(W1.rim + 0.25), r2(W1.ladder.p[2] - 0.9)];
B.mark('main', W1top, 'W1 top', 'ladder');
B.link(W1.foot, W1top, 'ladder');
B.node(W1top);

// =====================================================================================
// ZONE B – ROOFTOP ROW (157–190): balconies, AC steps, laundry lines, the Impossible Jump
// =====================================================================================
const B2 = bld('B2', 20, 27.5, 9, 11, 156.8, 'tan', { par: 0.6 });
B.mark('main', roof(B2, -0.75, 0.75), 'B2 roof');
const AC2 = ac(19.5, B2.top, Z(23.9), 2.4, 0, 'AC2');
B.mark('main', AC2, 'AC2');
const B3 = bld('B3', 25, 14, 12, 11, 162.4, 'brick');
const BAL1 = ledge(B3, 'S', 20.4, 160.4, 2.6, 1.4, 'concrete', { plant: true });
B.mark('main', BAL1, 'B3 balcony');
B.mark('main', roof(B3, -0.75, 0.8), 'B3 roof');
const AC3 = ac(29.4, B3.top, Z(10.5), 2.6, 0, 'AC3');
B.mark('main', acMid(29.4, B3.top, Z(10.5), 2.6), 'AC3 cabinet');
B.mark('main', AC3, 'AC3');
laundry([20, B3.ptop + 0.4, Z(8.6)], [12, 158, Z(-2)]);
const B4 = bld('B4', 37, 4, 10, 12, 167.0, 'stucco', { par: 0 });
B.kitPiece('rail', [B4.x1 - 0.1, B4.top + 1.0, B4.cz], [B4.d - 0.4, 1.0], 90, { m: 'dark' });
B.mark('main', roof(B4, -0.85, 0.65), 'B4 roof');
const B5 = bld('B5', 39.5, -10, 11, 10, 171.4, 'blue');
B.mark('main', [36.5, B4.top, B4.z0 + 0.5], 'B4 north edge');
const SL1 = ledge(B5, 'S', 36.5, 168.8, 2.4, 1.3);
B.mark('main', SL1, 'B5 ledge 1');
const SL2 = ledge(B5, 'S', 39.6, 170.4, 2.4, 1.3);
B.mark('main', SL2, 'B5 ledge 2');
B.mark('main', roof(B5, 0, 0.75), 'B5 roof');
const AC4 = ac(40, B5.top, Z(-13.1), 2.8, 0, 'AC4');
B.mark('main', acMid(40, B5.top, Z(-13.1), 2.8), 'AC4 cabinet');
B.mark('main', AC4, 'AC4');
const B6 = bld('B6', 38, -24, 15, 12, 177.0, 'concrete');
const SL3 = ledge(B6, 'S', 42.2, 175.4, 2.4, 1.2);
B.mark('main', SL3, 'B6 ledge');
B.mark('main', roof(B6, 0.5, 0.8), 'B6 roof');
laundry([B5.x0 + 0.3, B5.ptop + 0.2, B5.z0 + 0.3], [B6.x0 + 1, B6.ptop + 0.3, B6.z1 - 0.3]);

// ---------------- FEATURED A: THE IMPOSSIBLE JUMP – B7 is right there, but 7.4 m higher
const B7 = bld('B7', 36, -38.5, 12, 12, 184.4, 'brick');
// solution 1 (main): climb the water tower W2 to gain height, then jump across
const W2 = waterTower(38.5, B6.top, Z(-25.9), 10, 0);
B.mark('main', W2.foot, 'W2 base');
const W2top = [W2.ladder.p[0], r2(W2.rim + 0.25), r2(W2.ladder.p[2] - 0.9)];
B.mark('main', W2top, 'W2 top', 'ladder');
B.link(W2.foot, W2top, 'ladder');
B.node(W2top);
const W2north = [38.5, r2(W2.rim + 0.15), r2(Z(-25.9) - 0.235 * 10)];
B.mark('main', W2north, 'W2 north rim');
B.node(W2north);
B.mark('main', roof(B7, -0.2, 0.75), 'B7 roof (impossible jump)');
// solution 2: hidden balconies round the corner on B7's west face (flowers and a lantern hint at them)
const hcr = crate(31.6, B6.top, Z(-28.9), 1.4, 15); crate(31.65, B6.top + 1.4, Z(-28.95), 0.8, -20);
const HB1 = ledge(B7, 'W', Z(-33.6), 180.4, 2.4, 1.4, 'concrete', { plant: true });
const HB2 = ledge(B7, 'W', Z(-36.8), 182.6, 2.4, 1.4, 'concrete', { plant: true });
B.lantern(HB1[0] - 0.4, HB1[1], HB1[2] + 0.6);
B.sprite('hanging_vines', B7.x0 - 0.05, 181.6, Z(-35.2), 2.2, 0.4);
B.mark('hidden', roof(B6, -0.75, -0.6), 'B6 NW');
B.mark('hidden', [31.6, r2(hcr[1] + 0.8), Z(-28.9)], 'crates');
B.mark('hidden', HB1, 'HB1');
B.mark('hidden', HB2, 'HB2');
B.mark('hidden', roof(B7, -0.75, 0), 'B7 roof');

// =====================================================================================
// SHORTCUT S1 – THE DUCT LINE: big air ducts climb along the east faces of B5–B7 (hard balance jumps)
// =====================================================================================
{
  const d = [
    [[43.6, 168.7, Z(-3.0)], [46.8, 168.7, Z(-3.0)]],
    [[46.6, 170.1, Z(-6.3)], [46.6, 170.1, Z(-9.8)]],
    [[46.6, 171.5, Z(-13.0)], [46.6, 171.5, Z(-16.4)]],
    [[46.6, 173.0, Z(-19.6)], [46.6, 173.0, Z(-23.0)]],
    [[46.6, 174.5, Z(-26.2)], [46.6, 174.5, Z(-29.6)]],
    [[44.8, 176.0, Z(-32.0)], [44.8, 176.0, Z(-35.4)]],
    [[43.6, 177.5, Z(-38.4)], [43.6, 177.5, Z(-41.6)]],
  ];
  const rD = 0.42;
  B.mark('S1', roof(B4, 0.8, -0.8), 'B4 NE');
  for (const [a, b] of d) {
    B.kitPiece('pipe', [a[0], a[1] - rD, a[2]], [rD], 0, { q: [b[0], b[1] - rD, b[2]], m: 'metal' });
    // brackets into the wall
    for (const t of [0.2, 0.8]) {
      const px = a[0] + (b[0] - a[0]) * t, pz = a[2] + (b[2] - a[2]) * t;
      B.kitPiece('slab', [px - 0.6, a[1] - rD * 2 - 0.05, pz], [1.3, 0.15, 0.15], 0, { m: 'dark', nc: true });
    }
    B.mark('S1', [r2((a[0] + b[0]) / 2), a[1], r2((a[2] + b[2]) / 2)]);
  }
  // two small ledges on B7's east face, then a grab onto its parapet
  const e1 = ledge(B7, 'E', -190.0, 179.3, 2.2, 1.0, 'dark');
  const e2 = ledge(B7, 'E', -186.8, 181.6, 2.2, 1.0, 'dark');
  B.mark('S1', e1, 'B7 east ledge 1');
  B.mark('S1', e2, 'B7 east ledge 2');
  B.mark('S1', roof(B7, 0.75, 0.6), 'B7 roof (ducts)');
}

// =====================================================================================
// ZONE C – CONSTRUCTION YARD (190–225): ladder, crates, THE MOVING CRANE, steel frame, hover platform
// =====================================================================================
const B8 = bld('B8', 18, -53, 24, 22, 189.6, 'tan', { par: 0.6 });
// ladder up B8's east face from B7's roof
ladder(B8, 'E', Z(-43.4), B7.top, B8.ptop);
const L1foot = [r2(B8.x1 + 0.7), B7.top, Z(-43.4)];
const L1top = [r2(B8.x1 - 0.9), B8.top, Z(-43.4)];
B.mark('main', L1foot, 'ladder L1 foot');
B.mark('main', L1top, 'B8 roof', 'ladder');
B.link(L1foot, L1top, 'ladder');
B.node(L1top);
// the crane (Meshy model, hanging crate removed: the cargo pallet is a real moving platform)
const CS = 24;
const crane = { x: 16.5, y: B8.top, z: Z(-54.5) };
B.prefab('crane_tower', crane.x, crane.y, crane.z, 0, CS, { name: 'crane' });
const deckTop = r2(crane.y + 0.21 * CS);
// climb onto the crane deck: crates against its east side, then over the railing
const cr1 = crate(27.8, B8.top, Z(-46.6), 1.6, 10);
crate(27.6, B8.top, Z(-49.2), 1.6, -5); const cr2 = crate(27.65, B8.top + 1.6, Z(-49.2), 1.5, 25);
B.mark('main', [27.8, cr1[1], Z(-46.6)], 'crate 1');
B.mark('main', [27.65, cr2[1], Z(-49.2)], 'crate 2');
B.mark('main', [24.6, deckTop, Z(-49.2)], 'crane deck east');
const CRANE_A = [r2(crane.x - 0.12 * CS), r2(deckTop + 0.42), r2(crane.z + 0.02 * CS)];
const CRANE_B = [r2(crane.x - 0.5 * CS), r2(crane.y + 0.6 * CS), r2(crane.z + 0.02 * CS)];
const deckPt = [r2(crane.x + 0.3 * CS - 9.2), deckTop, r2(crane.z + 0.15 * CS)];
B.mark('main', deckPt, 'crane deck');
B.node(deckPt);
B.mark('main', [CRANE_A[0] + 1.0, CRANE_A[1], CRANE_A[2]], 'board the crane', 'crane:crane1:A');
B.mark('main', [CRANE_B[0] - 1.0, CRANE_B[1], CRANE_B[2]], 'ride up', 'crane:crane1:B');
movers.push({ id: 'crane1', kind: 'crane', pts: [CRANE_A, [r2(CRANE_A[0] - 1.5), r2(CRANE_A[1] + 4), CRANE_A[2]], CRANE_B], speed: 3.0, wait: 3.5, s: 3.6, jib: r2(crane.y + 0.79 * CS), r: 0 });
B.node(CRANE_A); B.node(CRANE_B);
B.link(deckPt, CRANE_A, 'board');
B.link(CRANE_A, CRANE_B, 'crane');

// B9 – a concrete block with a steel frame under construction on top
const B9 = bld('B9', -5.5, -55, 13, 16, 200.4, 'concrete', { par: 0 });
const fz = (lz) => Z(lz);
const frame = [
  // centre x, top, centre z, w, d, material
  [-2.4, r2(CRANE_B[1] + 0.3), fz(-55.0), 6.0, 9.0, 'grate'],
  [-8.5, 206.4, fz(-59.5), 4.5, 5.0, 'grate'],
  [-8.5, 208.6, fz(-54.0), 4.5, 4.0, 'girder'],
  [-3.0, 210.8, fz(-51.0), 3.0, 3.0, 'grate'],
  [-3.0, 213.0, fz(-55.8), 3.0, 3.0, 'girder'],
  [-6.0, 215.2, fz(-60.5), 12.5, 5.0, 'grate'],
];
for (const [x, y, z, w, d, m] of frame) B.kitPiece('slab', [x, y, z], [w, 0.3, d], 0, { m });
for (const [x, lz] of [[-11.6, -62.6], [0.6, -62.6], [-11.6, -47.4], [0.6, -47.4], [-5.5, -62.6]]) B.kitPiece('slab', [x, 216.8, Z(lz)], [0.45, 216.8 - B9.top, 0.45], 0, { m: 'girder' });
for (const y of [204.0, 208.0, 212.0, 216.4]) {
  B.kitPiece('girder', [-11.6, y, Z(-55)], [0.45, 0.45, 15.2], 0, { nc: true });
  B.kitPiece('girder', [0.6, y, Z(-55)], [0.45, 0.45, 15.2], 0, { nc: true });
}
B.kitPiece('rail', [-6.0, 216.2, Z(-63.0) + 0.1], [12.4, 1.0], 0, { m: 'yellow' });
B.mark('main', [frame[0][0] + 1.6, frame[0][1], frame[0][2]], 'frame floor 1');
for (let i = 1; i < frame.length - 1; i++) B.mark('main', [frame[i][0], frame[i][1], frame[i][2]], `frame ${i + 1}`);
const F6 = frame[frame.length - 1];
B.mark('main', [F6[0] + 3.5, F6[1], F6[2]], 'frame top');
// hover platform H1 across the street to B10
const B10 = bld('B10', -28, -55, 12, 14, 224.8, 'stucco');
const H1A = [-14.4, r2(F6[1] + 0.05), F6[2]], H1B = [-20.4, r2(B10.top - 0.35), F6[2]];
movers.push({ id: 'hover1', kind: 'hover', pts: [H1A, H1B], speed: 2.2, wait: 2.5, s: 2, r: 90 });
B.mark('main', [F6[0] - 5.4, F6[1], F6[2]], 'frame west edge');
B.mark('main', H1A, 'hover 1', 'hover:hover1:A');
B.mark('main', H1B, 'hover 1 ride', 'hover:hover1:B');
B.mark('main', roof(B10, 0.6, -0.5), 'B10 roof');
B.node(H1A); B.node(H1B);
B.link([F6[0] - 5.4, F6[1], F6[2]], H1A, 'board');
B.link(H1A, H1B, 'hover');
B.link(H1B, roof(B10, 0.6, -0.5), 'alight');

// =====================================================================================
// SHORTCUT S2 / FEATURED C – THE HIDDEN ROOFTOP ROUTE: a strong pad hides behind the crane base,
// throws you onto B9's roof; crates lead into the frame and a hard girder line skips the hover wait
// =====================================================================================
const S2land = [-1.0, B9.top, r2(B9.z1 - 2.0)];
const J2 = pad('jump', 8.2, B8.top + 0.3, r2(B8.z1 - 1.9), -90, 26.5, 0.75, S2land);
B.kitPiece('slab', [8.2, B8.top + 0.02, r2(B8.z1 - 0.75)], [1.8, 0.04, 0.5], 0, { m: 'hazard', nc: true });
B.mark('S2', L1top, 'B8 roof');
B.mark('S2', [12.0, B8.top, r2(B8.z1 - 1.9)], 'south strip, behind the crane');
B.mark('S2', J2, 'J2 (behind the crane)', 'topad');
B.mark('S2', S2land, 'B9 roof', 'pad');
B.link(J2, S2land, 'pad');
const c9a = crate(-1.0, B9.top, Z(-63.0) + 0.6, 1.4, 12); crate(-1.05, B9.top + 1.4, Z(-63.0) + 0.65, 1.4, -8);
void c9a;
B.mark('S2', [-1.0, r2(B9.top + 2.8), r2(Z(-63.0) + 0.6)], 'crates');
B.mark('S2', [frame[1][0] + 1.6, frame[1][1], frame[1][2]], 'frame 2');
B.mark('S2', [frame[2][0], frame[2][1], frame[2][2]], 'frame 3');
B.mark('S2', [frame[3][0], frame[3][1], frame[3][2]], 'frame 4');
B.mark('S2', [frame[4][0], frame[4][1], frame[4][2]], 'frame 5');
B.mark('S2', [F6[0] - 5.4, F6[1], F6[2]], 'frame west');
for (const [x, y, z] of [[-13.8, 216.9, -217.6], [-16.6, 218.7, -218.6], [-19.6, 220.5, -218.8], [-22.4, 222.4, -217.8]]) {
  B.kitPiece('girder', [x, y, z], [0.9, 0.55, 2.0], 90);
  B.mark('S2', [x, y, z], 'girder');
}
B.mark('S2', roof(B10, 0.7, -0.75), 'B10 roof (S2)');


// =====================================================================================
// ZONE D – BILLBOARD CANYON (225–255): catwalks, the speed-pad + ring gap, the canyon detour
// =====================================================================================
const B11 = bld('B11', -41.5, -46, 11, 12, 229.0, 'peach');
// an industrial billboard platform on B10's SW corner: grab its deck from the front, then leap the alley to B11
const BBs = 7;
const bbC = [-30.4, B10.top, r2(B10.z1 - 0.35 - 0.249 * BBs - 0.05)];
B.prefab('industrial_billboard_platform', bbC[0], bbC[1], bbC[2], 180, BBs, { name: 'billboard platform', col: false });
// simplified solid collider: the platform is a block up to its deck, the sign a wall behind it
B.kitPiece('solid', [bbC[0], r2(B10.top + 0.52 * BBs), r2(bbC[2] + 0.1)], [6.2, r2(0.52 * BBs), 2.3], 0);
B.kitPiece('solid', [bbC[0], r2(B10.top + 0.97 * BBs), r2(bbC[2] + 0.7)], [6.4, r2(0.45 * BBs), 0.6], 0);
const bbDeck = [-32.6, r2(B10.top + 0.52 * BBs), r2(bbC[2] - 0.05)];
B.mark('main', roof(B10, 0.2, -0.1), 'B10 mid');
const AC6 = ac(-32.0, B10.top, r2(bbC[2] - 3.05), 2.4, 180, 'AC6');
B.mark('main', acMid(-32.0, B10.top, r2(bbC[2] - 3.05), 2.4, 180), 'AC6 cabinet');
B.mark('main', AC6, 'AC6');
B.mark('main', bbDeck, 'billboard deck');
B.mark('main', roof(B11, 0.75, 0.45), 'B11 roof');
const AC5 = ac(-41.5, B11.top, Z(-42.0), 2.6, 0, 'AC5');
B.mark('main', acMid(-41.5, B11.top, Z(-42.0), 2.6), 'AC5 cabinet');
B.mark('main', AC5, 'AC5');
const B12 = bld('B12', -44, -28, 12, 20, 233.5, 'concrete', { par: 0 });
B.kitPiece('rail', [B12.x0 + 0.1, B12.top + 1.0, B12.cz], [B12.d - 0.6, 1.0], 90, { m: 'yellow' });
B.kitPiece('rail', [B12.x1 - 0.1, B12.top + 1.0, B12.cz + 3], [B12.d - 6.6, 1.0], 90, { m: 'yellow' });
B.mark('main', roof(B12, 0.3, -0.85), 'B12 roof');
// decorative billboards along the canyon
B.kitPiece('billboard', [-44.5, B11.top + 4.4 + 2.6, B11.z1 - 1.5], [6, 2.6, 4.4 - 0.15], 0, { m: 0 });
B.kitPiece('billboard', [-31.5, 244.0, Z(-12)], [6, 3, 0], 90, { m: 2, nc: true });
// FEATURED D – THE SPEED GAP: speed pad runway -> leap through the ring across the canyon to B13
const B13 = bld('B13', -44, -1.5, 12, 15, 232.5, 'brick', { par: 0.5 });
const SP1 = pad('speed', -44, B12.top + 0.25, Z(-27.0), 0, 15, 0.75);
ring(-44, B12.top + 2.0, r2(B12.z1 + 1.2), 0, 5, 16);
B.mark('main', [-44, B12.top, Z(-33)], 'runway');
B.mark('main', SP1, 'speed pad', 'topad');
const B13n = roof(B13, 0, -0.6);
B.mark('main', B13n, 'B13 roof (speed gap)', 'ring');
B.link(SP1, B13n, 'ring');
// the canyon detour: a lower roof, a ladder back up, a hover platform across
const B12b = bld('B12b', -45, -14.5, 10, 6, 221.0, 'mint', { par: 0.5 });
ladder(B12, 'S', -48.5, B12b.top, B12.top);
const L2foot = [-48.5, B12b.top, r2(B12.z1 + 0.8)], L2top = [-48.5, B12.top, r2(B12.z1 - 0.9)];
B.mark('detour', roof(B12b, 0.4, 0), 'canyon roof');
B.mark('detour', L2foot, 'ladder L2 foot');
B.mark('detour', L2top, 'back on B12', 'ladder');
B.link(L2foot, L2top, 'ladder');
B.node(L2top);
const H2A = [-35.6, r2(B12.top - 0.0), Z(-19.6)], H2B = [-35.6, r2(B13.top - 0.0), Z(-8.6)];
movers.push({ id: 'hover2', kind: 'hover', pts: [H2A, H2B], speed: 2.0, wait: 2.0, s: 2, r: 0 });
B.node(H2A); B.node(H2B);
B.mark('detour', roof(B12, 0.9, 0.85), 'B12 SE');
B.mark('detour', H2A, 'hover 2', 'hover:hover2:A');
B.mark('detour', H2B, 'hover 2 ride', 'hover:hover2:B');
B.mark('detour', roof(B13, 0.85, -0.6), 'B13 roof');
B.link(roof(B12, 0.9, 0.85), H2A, 'board');
B.link(H2A, H2B, 'hover');
B.link(H2B, roof(B13, 0.85, -0.6), 'alight');
B.mark('main', roof(B13, 0.5, 0.85), 'B13 south');

// =====================================================================================
// ZONE E – THE GLASS TOWER T3 (232–290): fire escape, a column of balconies, a pad, the sill column (S3)
// =====================================================================================
const T3 = bld('T3', -38, 17, 16, 16, 289.6, 'glass', { par: 1.0 });
fireEscape(T3, 'N', -40.0, -31.2, B13.top, 255.3, 'main');
const EB = [];
{
  const zs = [Z(10.6), Z(13.8), Z(17.0), Z(20.2), Z(23.4)];
  let y = 256.6, k = 0, dirUp = 1;
  while (y < 288.2) {
    EB.push(ledge(T3, 'E', zs[k], r2(y), 2.6, 1.6, 'concrete', { plant: EB.length % 3 === 1 }));
    y += 1.7;
    k += dirUp;
    if (k === zs.length - 1 || k === 0) dirUp = -dirUp;
  }
}
EB.forEach((p, i) => {
  if (i === EB.length - 1 && p[1] > 287.5) return; // the last one is just a step toward the parapet
  B.mark('main', p, `balcony ${i + 1}`);
});
B.mark('main', roof(T3, 0.8, -0.6), 'T3 roof');
// S3 – narrow window sills straight up T3's west face: every one a hang and a climb
{
  B.mark('S3', roof(B13, -0.8, 0.8), 'B13 SW');
  let y = B13.top + 2.4;
  let i = 0;
  while (y < T3.top - 0.6) {
    const p = ledge(T3, 'W', r2(T3.z0 + 1.6 + (i % 2) * 1.4), r2(y), 1.6, 0.75, 'concrete');
    B.mark('S3', p, 'sill');
    y += 2.75;
    i++;
  }
  B.mark('S3', roof(T3, -0.8, -0.8), 'T3 roof (S3)');
}

// =====================================================================================
// ZONE F – THE CROWN (290–320): sky girders to the central glass tower, spiral round the antenna, the gate
// =====================================================================================
const CT = bld('CT', 0, 4, 18, 18, 291.0, 'glass', { par: 1.0 });
{
  const gz = Z(11.0);
  const x0 = T3.x1 + 0.1, x1 = CT.x0 - 0.1;
  const n = 4;
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n;
    const y = r2(T3.ptop + 0.15 + i * 0.25);
    B.kitPiece('girder', [r2((xa + xb) / 2), y, gz], [1.0, 0.6, r2(xb - xa - 1.0)], 90);
    B.mark('main', [r2((xa + xb) / 2), y, gz], 'sky girder');
  }
}
// the clock tower (Meshy model) crowns the city; its spire is the highest point, 319 m
const CLK = { x: 0, z: Z(4), s: 29 };
B.prefab('clock_energy_tower', CLK.x, CT.top, CLK.z, 0, CLK.s, { name: 'Clock Tower' });
B.fx.push({ t: 'glow', p: [CLK.x, r2(CT.top + 0.95 * CLK.s), CLK.z], s: 3.2, c: '255,90,70' });
// a helix of steel platforms around the tower, held on arms from the tower body
const crown = [];
{
  const N = 14, rad = 12.2, a0 = 2.36, da = 0.27;
  let y = CT.top;
  for (let i = 0; i < N; i++) {
    const a = a0 + i * da;
    y += i === 0 ? 1.9 : 2.0;
    const x = CLK.x + Math.cos(a) * rad, z = CLK.z + Math.sin(a) * rad;
    B.kitPiece('slab', [r2(x), r2(y), r2(z)], [2.4, 0.3, 2.4], (-a * 180) / Math.PI, { m: i % 3 === 2 ? 'girder' : 'grate' });
    // arm back toward the tower (visual)
    B.kitPiece('slab', [r2(CLK.x + Math.cos(a) * (rad - 2.2)), r2(y - 0.16), r2(CLK.z + Math.sin(a) * (rad - 2.2))], [2.4, 0.16, 0.22], (-a * 180) / Math.PI + 90, { m: 'dark', nc: true });
    if (i % 4 === 1) B.kitPiece('rope', [r2(x), r2(y + 0.05), r2(z)], [0.03, 0.05], 0, { q: [r2(CLK.x + Math.cos(a) * 6), r2(y + 7), r2(CLK.z + Math.sin(a) * 6)] });
    crown.push([r2(x), r2(y), r2(z), a]);
    B.mark('main', [r2(x), r2(y), r2(z)], `crown ${i + 1}`);
  }
}
// final sky platform + the portal shrine to Map 003 (Meshy model) at 320 m, reached with the last Sky Jump Pad
const TOP = 320;
const last = crown[crown.length - 1];
const fa = last[3] + 0.62;
const PS = 9;
const plat = [r2(CLK.x + Math.cos(fa) * 15.5), r2(TOP - 0.14 * PS), r2(CLK.z + Math.sin(fa) * 15.5)];
B.kitPiece('slab', plat, [12, 0.6, 12], 0, { m: 'tile' });
B.kitPiece('slab', [plat[0], r2(plat[1] - 0.6), plat[2]], [10, 2.2, 10], 0, { m: 'dark' });
// the shrine faces the clock tower (its steps toward the arrival)
const shrineYaw = r2((Math.atan2(CLK.x - plat[0], CLK.z - plat[2]) * 180) / Math.PI);
B.prefab('portal_gateway_shrine', plat[0], plat[1], plat[2], shrineYaw, PS, { name: 'Portal to Map 003' });
const sy = (shrineYaw * Math.PI) / 180, fwd = [Math.sin(sy), Math.cos(sy)];
// arch opening sits on the back part of the shrine (local z ~ -0.13 s), centre ~0.45 s up
const archC = [r2(plat[0] - fwd[0] * 0.13 * PS), r2(plat[1] + 0.45 * PS), r2(plat[2] - fwd[1] * 0.13 * PS)];
B.fx.push({ t: 'portal', p: archC, s: 1.9, r: shrineYaw });
const landPt = [r2(plat[0] + fwd[0] * 3.3), r2(plat[1] + 0.3), r2(plat[2] + fwd[1] * 3.3)];
const J4 = pad('jump', last[0], r2(last[1] + 0.3), last[2], 0, 16.5, 0.55, [landPt[0], r2(plat[1]), landPt[2]]);
B.mark('main', J4, 'Sky Jump Pad 3', 'topad');
B.mark('main', [landPt[0], plat[1], landPt[2]], 'sky platform', 'pad');
B.link(J4, [landPt[0], plat[1], landPt[2]], 'pad');
const EXIT = [r2(plat[0] - fwd[0] * 0.13 * PS), r2(TOP + 0.6), r2(plat[2] - fwd[1] * 0.13 * PS)];
B.mark('main', [r2(plat[0] + fwd[0] * 1.2), r2(TOP), r2(plat[2] + fwd[1] * 1.2)], 'shrine steps');
B.mark('main', EXIT, 'EXIT');

// =====================================================================================
// FILLER CITY: more buildings so the skyline reads as a real city (kept clear of the routes)
// =====================================================================================
const fill = [
  // name, x, lz, w, d, top, style  (kit buildings)
  ['F2', -36, 34, 9, 11, 163, 'brick'], ['F5', 51, 5, 7, 9, 165, 'mint'],
  ['F8', 42, -52, 8, 10, 196, 'concrete'], ['F15', -46, 32, 8, 9, 245, 'concrete'],
  ['F17', -14, 22, 9, 9, 238, 'blue'], ['F18', 14, 14, 9, 9, 182, 'peach'],
  ['F19', -20, -24, 9, 12, 248, 'concrete'], ['F20', 10, -27, 9, 9, 214, 'brick'],
];
const fillers = {};
for (const [name, x, lz, w, d, top, m] of fill) {
  const b = bld(name, x, lz, w, d, top, m, { par: 0.6 });
  fillers[name] = b;
  if (B.rnd() < 0.6) ac(b.cx + (B.rnd() - 0.5) * (w - 4), b.top, b.cz + (B.rnd() - 0.5) * (d - 4), 1.8 + B.rnd() * 0.8, Math.round(B.rnd() * 4) * 90);
}
// Meshy apartment blocks and an office tower round out the skyline (low-rise near the station, a tower on the east rim)
const apt = (id, x, lz, s, r = 0) => B.prefab(id, x, DECK, Z(lz), r, s, { name: id });
apt('brick_apartment_building', -34, 47, 14, 90);
apt('yellow_apartment_building', 26, 45, 13, 180);
apt('brick_apartment_building', 50, 19, 16, -90);
apt('yellow_apartment_building', 24, -12, 16, 90);
apt('brick_apartment_building', 20, -27, 14, 0);
apt('tall_office_tower', 54, -20, 28, -90);
apt('tall_office_tower', -58, -6, 30, 90);
// a second (smaller) crane working on F8's roof
B.prefab('cargo_crane_tower', 42, fillers.F8.top, Z(-52), 180, 9, { name: 'cargo crane' });
// fire-escape stair modules bolted to filler walls
B.prefab('wall_industrial_stairs', fillers.F2.x1 + 4.0, DECK, fillers.F2.cz, -90, 9, { name: 'wall stairs' });
B.prefab('wall_industrial_stairs', fillers.F19.cx, DECK, fillers.F19.z1 + 4.2, 180, 9, { name: 'wall stairs' });
// billboards on fillers
B.kitPiece('billboard', [50, 165 + 3.6, Z(5) + 3.0], [6, 2.8, 0.6], 90, { m: 5 });
B.prefab('industrial_billboard_platform', -48.2, B12.top, r2(B12.z0 + 4.0), 90, 5.5, { name: 'canyon billboard' });
B.prefab('industrial_billboard_platform', fillers.F17.cx, fillers.F17.top, fillers.F17.cz, 90, 6, { name: 'billboard' });
// rooftop life: chimneys, satellite dishes, greenhouses, clothes lines, ducts (kept off the climbing lines)
const prop = (id, x, y, z, r, s, col = true) => B.prefab(id, x, y, z, r, s, { name: id, col });
prop('rooftop_clothesline_platform', 22.3, B2.top, B2.z1 - 1.6, 0, 2.4);
prop('rooftop_greenhouse', 21.6, B3.top, B3.z0 + 1.7, 0, 3.0);
prop('brick_vent_tower', 29.5, B3.top, B3.z1 - 1.4, 0, 2.6);
prop('horizontal_ventilation_duct', 40.2, B4.top, Z(4.5), 90, 1.15);
prop('satellite_dish_tower', 40.8, B4.top, B4.z1 - 1.3, 200, 3.2);
prop('curved_industrial_vent', 43.4, B5.top, Z(-10.5), -90, 1.5);
prop('horizontal_ventilation_duct', 32.4, B6.top, r2(B6.z1 - 1.0), 0, 1.0);
prop('brick_vent_tower', 32.0, B7.top, B7.z0 + 1.6, 0, 3.0);
prop('rooftop_greenhouse', -31.6, B10.top, B10.z0 + 1.9, 90, 3.0);
prop('brick_vent_tower', -45.4, B11.top, B11.z0 + 1.5, 0, 2.8);
prop('satellite_dish_tower', -48.4, B12b.top, B12b.cz, 90, 2.6);
prop('rooftop_clothesline_platform', -40.2, B13.top, B13.z1 - 1.0, 0, 2.2);
prop('satellite_dish_tower', T3.x0 + 1.8, T3.top, T3.z1 - 1.8, 135, 3.4);
prop('brick_vent_tower', fillers.F18.cx, fillers.F18.top, fillers.F18.cz, 0, 3.5);
prop('satellite_dish_tower', fillers.F20.cx, fillers.F20.top, fillers.F20.cz, 30, 3.0);
// neon signs on walls facing streets and the canyon (decor, no collider)
const neon = (b, face, along, y, s = 2.4) => {
  const [fx, , fz] = facePt(b, face, along, y);
  const [ox, oz] = outward[face];
  B.prefab('wall_neon_signboard', r2(fx + ox * 0.32 * s), r2(y), r2(fz + oz * 0.32 * s), yawOf[face], s, { name: 'neon', col: false });
};
neon(B4, 'S', 39.5, 159.0);
neon(B11, 'E', Z(-48), 221.0, 2.8);
neon(B12, 'E', Z(-30), 226.0, 3.0);
neon(B13, 'N', -40.0, 228.0, 3.0);
neon(B7, 'E', Z(-41.5), 172.0);
neon(B9, 'N', -5.5, 194.0, 3.0);
neon(B3, 'W', Z(12), 151.0);
// street furniture
// station furniture (the city has no streets: everything else floats)
for (const [x, z, r] of [[-24, -98, 0], [10, -98, 180], [-24, -110.5, 0], [3, -110.5, 0]]) lamp(x, DECK, z, r);
for (const [x, z, r] of [[-14, -97.5, 0], [-4, -97.5, 0]]) barrier(x, DECK, z, r);
// floating chunks: apartments / towers that stood on the old deck get a rocky underside
for (const pf of B.prefabs) {
  if (!/apartment|office_tower/.test(pf.id) || Math.abs(pf.p[1] - DECK) > 0.1 || onStation(pf.p[0], pf.p[2])) continue;
  const fw = { brick_apartment_building: [0.584, 0.603], yellow_apartment_building: [0.595, 0.59], tall_office_tower: [0.37, 0.321] }[pf.id];
  const sw = fw[0] * pf.s, sd = fw[1] * pf.s;
  const rr = Math.abs(Math.round(pf.r / 90)) % 2 === 1;
  B.kitPiece('rock', [pf.p[0], DECK, pf.p[2]], [rr ? sd : sw, rr ? sw : sd, Math.max(8, Math.max(sw, sd) * 0.9)], 0);
}
// greenery & lanterns from the village atlas on a few roofs
for (const b of [B1, B3, B5, B10, B13]) B.sprite(B.pick(['pink_flower_bush', 'green_bush', 'yellow_wildflowers']), b.x0 + 1.2, b.top, b.z1 - 1.2, 0.9, 0.8);

// =====================================================================================
// MILESTONES, VALIDATION, OUTPUT
// =====================================================================================
const MILESTONES = [160, 180, 200, 220, 240, 260, 280, 300, 320];
const mainPts = B.routes.main.map((q) => q.p);
for (const m of MILESTONES) {
  let best = null;
  for (const p of mainPts) if (p[1] >= m - 0.5 && (!best || p[1] < best[1])) best = p;
  if (best) B.fx.push({ t: 'milestone', p: [r2(best[0] + 1.0), r2(m + 1.6), r2(best[2] + 1.0)], h: m });
}

// building chunks: a facade 14 m deep (or down past the lowest ledge / ladder / fire escape on it), rock below
for (const b of blds) {
  if (b.base !== undefined) continue;
  const base = r2(Math.min(b.top - 14, b.minFeat - 3));
  b.kit.s[1] = r2(b.top - base);
  B.kitPiece('rock', [b.cx, base, b.cz], [b.w, b.d, r2(Math.max(7, Math.max(b.w, b.d) * 0.85))], 0);
}

const val = B.validate(SPAWN, EXIT);
B.checkOverlaps();
await plotMap(B, val, new URL('./out/map002_plan.png', import.meta.url).pathname, { cx: DX, cz: DZ, r: R, y0: DECK, y1: 330 });

const zones = [
  { id: 'A', name: 'Ga Trên Mây', y0: 135, y1: 157, color: '#7bd3c8' },
  { id: 'B', name: 'Dãy Mái Nhà', y0: 157, y1: 190, color: '#f6c85f' },
  { id: 'C', name: 'Công Trường Cần Cẩu', y0: 190, y1: 225, color: '#f08a5d' },
  { id: 'D', name: 'Hẻm Biển Quảng Cáo', y0: 225, y1: 255, color: '#e86aa6' },
  { id: 'E', name: 'Tháp Kính', y0: 255, y1: 290, color: '#6aa9f0' },
  { id: 'F', name: 'Vương Miện Ăng-ten', y0: 290, y1: 330, color: '#b48ef0' },
];
// ---- generator frame -> world (rotate 180 about the old deck centre, move onto the village)
const P3 = (p) => { const [x, z] = toWorld(p[0], p[2]); return [x, p[1], z]; };
const Y180 = (r) => r2((((r ?? 0) + 180 + 540) % 360) - 180);
for (const k of B.kit) { k.p = P3(k.p); if (k.q) k.q = P3(k.q); k.r = Y180(k.r); }
for (const pf of B.prefabs) { pf.p = P3(pf.p); pf.r = Y180(pf.r); }
for (const sp of B.sprites) sp.p = P3(sp.p);
for (const sc of B.scenery) { sc.p = P3(sc.p); sc.r = Y180(sc.r); }
for (const f of B.fx) { f.p = P3(f.p); if (f.r !== undefined) f.r = Y180(f.r); }
for (const m of movers) { m.pts = m.pts.map(P3); m.r = Y180(m.r); }
for (const pd of pads) { pd.p = P3(pd.p); pd.r = Y180(pd.r); if (pd.tg) pd.tg = P3(pd.tg); }
for (const rg of rings) { rg.p = P3(rg.p); rg.r = Y180(rg.r); }
for (const ld of ladders) { ld.p = P3(ld.p); ld.r = Y180(ld.r); }
for (const rt of Object.values(B.routes)) for (const q of rt) q.p = P3(q.p);
const SPAWN_W = P3(SPAWN), EXIT_W = P3(EXIT), J1_W = P3(J1);
const spawnYaw = r2(Math.atan2(J1_W[0] - SPAWN_W[0], J1_W[2] - SPAWN_W[2]));

const data = B.toJSON({
  id: 'map002', name: 'Rooftop City', version: 1, height: 180, origin: [0, DECK, 0],
  spawn: { p: SPAWN_W, yaw: spawnYaw },
  // gate: the summit's west edge (opposite the arrival), where Map 003's path will attach. Until Map 003 is on the
  // device it is closed: the 320 m summit is a safe end, finishing still counts.
  exit: { p: EXIT_W.map(r2), r: 2.8, next: 'map003', label: 'Map 003', gate: { p: [-39.05, 318.74, -9.18], yaw: Math.PI / 2, w: 4.4, h: 4.2 } },
  finishHint: 'Gợi ý: có một mái nhà ẩn phía sau cần cẩu…',
  zones, milestones: MILESTONES,
  region: { c: [CX2, CZ2], r: R },
  // no ground of its own: the city floats above Starter Village, whose ring wall (up to 340 m) keeps everyone in
  terrain: { style: 'none', radius: 0, plazas: [], paths: [] },
  movers, pads, rings, ladders,
  waypoints: makeWaypoints(B.routes, zones, { hidden: 'Ban công ẩn (Challenge C)', S1: 'S1 – ống gió (Impossible Jump)', S2: 'S2 – đường tắt cần cẩu', S3: 'S3 – mặt tháp', detour: 'Đường vòng hẻm' }),
});
fs.writeFileSync(new URL('../packs/map002/maps/map002.json', import.meta.url), JSON.stringify(data));
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./out/routes002.json', import.meta.url), JSON.stringify(B.routes));
const hops = Object.fromEntries(Object.entries(B.routes).map(([k, v]) => [k, v.length]));
console.log(`prefabs ${B.prefabs.length}, kit ${B.kit.length}, sprites ${B.sprites.length}, fx ${B.fx.length}, movers ${movers.length}, pads ${pads.length}, rings ${rings.length}, ladders ${ladders.length}`);
console.log('route points', JSON.stringify(hops));
