// Map building + validation toolkit for Skyward Parkour (Node, offline).
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const deg = (d) => (d * Math.PI) / 180;
export const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- physics model (mirrors src/config.ts)
export const PHYS = { run: 7.0, gUp: 30, gDown: 42, v0: 12.4, capsuleR: 0.3, apex: (12.4 * 12.4) / (2 * 30), grabMax: 2.05, grabMin: 0.95, hand: 1.9 };
/** Max horizontal distance (centre to centre of the capsule) for a running jump that lands dh higher. */
export function reach(dh) {
  if (dh > PHYS.apex - 0.05) return 0;
  const tUp = PHYS.v0 / PHYS.gUp;
  const tDown = Math.sqrt((2 * (PHYS.apex - dh)) / PHYS.gDown);
  return PHYS.run * (tUp + tDown);
}

// ---------------------------------------------------------------- prefab height grids from collision meshes
const G = 48;
function loadPrefabGrid(id) {
  // bundled assets (public/assets/<map>) or a downloadable pack (packs/<map>/assets/<map>)
  const roots = [path.join(ROOT, 'public/assets')];
  if (fs.existsSync(path.join(ROOT, 'packs'))) for (const p of fs.readdirSync(path.join(ROOT, 'packs'))) roots.push(path.join(ROOT, 'packs', p, 'assets'));
  let file = null;
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r)) { const f = path.join(r, d, `${id}.col.bin`); if (fs.existsSync(f)) { file = f; break; } }
    if (file) break;
  }
  if (!file) throw new Error(`prefab ${id}: no .col.bin under public/assets or packs/*/assets`);
  const buf = fs.readFileSync(file);
  const nv = buf.readUInt32LE(0), ni = buf.readUInt32LE(4);
  const pos = new Float32Array(buf.buffer.slice(buf.byteOffset + 8, buf.byteOffset + 8 + nv * 12));
  const idx = new Uint32Array(buf.buffer.slice(buf.byteOffset + 8 + nv * 12, buf.byteOffset + 8 + nv * 12 + ni * 4));
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < nv; i++) { minx = Math.min(minx, pos[i * 3]); maxx = Math.max(maxx, pos[i * 3]); minz = Math.min(minz, pos[i * 3 + 2]); maxz = Math.max(maxz, pos[i * 3 + 2]); }
  const top = new Float32Array(G * G).fill(-1), bot = new Float32Array(G * G).fill(9), slope = new Float32Array(G * G).fill(0);
  for (let t = 0; t < ni; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    // triangle normal y component (for walkability)
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nyN = Math.abs(ny) / Math.hypot(nx, ny, nz);
    const gx0 = Math.max(0, Math.floor(((Math.min(ax, bx, cx) - minx) / (maxx - minx)) * G)), gx1 = Math.min(G - 1, Math.ceil(((Math.max(ax, bx, cx) - minx) / (maxx - minx)) * G));
    const gz0 = Math.max(0, Math.floor(((Math.min(az, bz, cz) - minz) / (maxz - minz)) * G)), gz1 = Math.min(G - 1, Math.ceil(((Math.max(az, bz, cz) - minz) / (maxz - minz)) * G));
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const px = minx + ((gx + 0.5) / G) * (maxx - minx), pz = minz + ((gz + 0.5) / G) * (maxz - minz);
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * ay + l2 * by + l3 * cy;
      const k = gz * G + gx;
      if (y > top[k]) { top[k] = y; slope[k] = nyN; }
      if (y < bot[k]) bot[k] = y;
    }
  }
  return { minx, maxx, minz, maxz, top, bot, slope };
}
const gridCache = new Map();
export function prefabGrid(id) {
  if (!gridCache.has(id)) gridCache.set(id, loadPrefabGrid(id));
  return gridCache.get(id);
}

// ---------------------------------------------------------------- builder
export class MapBuilder {
  constructor(meta) {
    this.meta = meta;
    this.prefabs = [];
    this.kit = [];
    this.sprites = [];
    this.fx = [];
    this.scenery = [];
    this.objects = []; // geometric records for validation
    this.routes = {}; // name -> list of stand points
    this.seed = 1;
  }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  pick(a) { return a[Math.floor(this.rnd() * a.length)]; }

  // ---------------- prefabs
  prefab(id, x, y, z, r, s, opts = {}) {
    const d = { id, p: [r2(x), r2(y), r2(z)], r, s };
    if (opts.tag) d.tag = opts.tag;
    if (opts.col === false) d.col = false;
    this.prefabs.push(d);
    const g = prefabGrid(id);
    const obj = { type: 'prefab', id, x, y, z, r, s, g, solid: opts.col !== false, name: opts.name ?? id };
    obj.toLocal = (wx, wz) => {
      const dx = (wx - x) / s, dz = (wz - z) / s;
      const c = Math.cos(deg(r)), sn = Math.sin(deg(r));
      // inverse of three.js Y rotation
      return [dx * c - dz * sn, dx * sn + dz * c];
    };
    obj.toWorld = (lx, lz) => {
      const c = Math.cos(deg(r)), sn = Math.sin(deg(r));
      return [x + (lx * c + lz * sn) * s, z + (-lx * sn + lz * c) * s];
    };
    obj.cell = (wx, wz) => {
      const [lx, lz] = obj.toLocal(wx, wz);
      const gx = Math.floor(((lx - g.minx) / (g.maxx - g.minx)) * G), gz = Math.floor(((lz - g.minz) / (g.maxz - g.minz)) * G);
      if (gx < 0 || gz < 0 || gx >= G || gz >= G) return -1;
      return gz * G + gx;
    };
    obj.topAt = (wx, wz) => { const k = obj.cell(wx, wz); if (k < 0 || g.top[k] < 0) return null; return y + g.top[k] * s; };
    obj.botAt = (wx, wz) => { const k = obj.cell(wx, wz); if (k < 0 || g.top[k] < 0) return null; return y + g.bot[k] * s; };
    obj.radius = Math.hypot(g.maxx - g.minx, g.maxz - g.minz) * 0.5 * s;
    this.objects.push(obj);
    return obj;
  }
  /** decorative far-away prefab without collider */
  scenic(id, x, y, z, r, s) { this.scenery.push({ id, p: [r2(x), r2(y), r2(z)], r, s }); }

  // ---------------- kit
  kitPiece(k, p, s, r = 0, extra = {}) {
    const d = { k, p: p.map(r2), s: s.map(r2) };
    if (r) d.r = r2(r);
    const { name: _nm, vo: _vo, ...rest } = extra;
    Object.assign(d, rest);
    if (d.q) d.q = d.q.map(r2);
    if (!extra.vo) this.kit.push(d);
    if (extra.nc || k === 'rope' || k === 'rock') return d;
    // geometric record: oriented boxes (centre, half extents, yaw) + standable top
    const boxes = [];
    const [px, py, pz] = p;
    if (k === 'crate') boxes.push({ c: [px, py - s[0] / 2, pz], h: [s[0] / 2, s[0] / 2, s[0] / 2], top: true });
    else if (k === 'barrel') boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] * 0.8, s[1] / 2, s[0] * 0.8], top: true });
    else if (k === 'plank' || k === 'beam') boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] / 2, s[1] / 2, s[2] / 2], top: true });
    else if (k === 'stone') boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] / 2, s[1] / 2, s[2] / 2], top: true });
    else if (k === 'pillar') boxes.push({ c: [px, py - s[1] / 2, pz], h: [(s[0] * 1.18) / 2, s[1] / 2, (s[0] * 1.18) / 2], top: true });
    else if (k === 'post') boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] * 0.8, s[1] / 2, s[0] * 0.8], top: s[0] > 0.25 });
    else if (k === 'log') boxes.push({ c: [px, py - s[0], pz], h: [s[1] / 2, s[0], s[0] * 0.55], top: true, narrow: true });
    else if (k === 'fence') boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] / 2, s[1] / 2, 0.1], top: false });
    else if (k === 'building') {
      boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] / 2, s[1] / 2, s[2] / 2], top: true, roof: true });
      const par = extra.par ?? 0.8;
      if (par > 0.01) {
        const t = 0.35, c = Math.cos(deg(r)), sn = Math.sin(deg(r));
        for (const [w, d, lx, lz] of [[s[0], t, 0, s[2] / 2 - t / 2], [s[0], t, 0, -s[2] / 2 + t / 2], [t, s[2] - 2 * t, s[0] / 2 - t / 2, 0], [t, s[2] - 2 * t, -s[0] / 2 + t / 2, 0]])
          boxes.push({ c: [px + lx * c + lz * sn, py + par / 2, pz - lx * sn + lz * c], h: [w / 2, par / 2, d / 2], top: true, narrow: true, parapet: true });
      }
    }
    else if (k === 'slab') boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] / 2, s[1] / 2, s[2] / 2], top: true, narrow: s[2] < 0.9 || s[0] < 0.9 });
    else if (k === 'girder') boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] / 2, s[1] / 2, s[2] / 2], top: true, narrow: s[0] < 0.9 });
    else if (k === 'billboard') {
      const c = Math.cos(deg(r)), sn = Math.sin(deg(r));
      boxes.push({ c: [px, py - s[1] / 2, pz], h: [(s[0] + 0.3) / 2, (s[1] + 0.3) / 2, 0.175], top: true, narrow: true });
      const oz = 0.175 + 0.55;
      boxes.push({ c: [px + oz * sn, py - s[1] - 0.22, pz + oz * c], h: [(s[0] + 0.3) / 2, 0.07, 0.55], top: true });
    }
    else if (k === 'rail') boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] / 2, s[1] / 2, 0.07], top: false });
    else if (k === 'awning') boxes.push({ c: [px, py - s[2] / 2, pz], h: [s[0] / 2, s[2] / 2 + 0.05, s[1] / 2], top: false });
    else if (k === 'sign') boxes.push({ c: [px, py - s[1] / 2, pz], h: [(s[0] + 0.2) / 2, (s[1] + 0.2) / 2, 0.09], top: false });
    else if (k === 'lamp') boxes.push({ c: [px, py - s[0] / 2, pz], h: [0.09, s[0] / 2, 0.09], top: false });
    else if (k === 'antenna') boxes.push({ c: [px, py - s[0] / 2, pz], h: [s[1] * 0.33, s[0] / 2, s[1] * 0.33], top: false });
    else if (k === 'wall') return d;
    else if (k === 'solid') boxes.push({ c: [px, py - s[1] / 2, pz], h: [s[0] / 2, s[1] / 2, s[2] / 2], top: true });
    else if (k === 'pipe') {
      const q = extra.q; const rad = s[0];
      const dx = q[0] - px, dz = q[2] - pz, len = Math.hypot(dx, dz);
      if (Math.abs(q[1] - py) < 0.3 && len > 0.1) {
        const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
        this.objects.push({ type: 'kit', k, boxes: [{ c: [(px + q[0]) / 2, (py + q[1]) / 2, (pz + q[2]) / 2], h: [rad * 0.7, rad, len / 2 + rad], top: rad >= 0.3, narrow: true }], r: yaw, name: 'pipe' });
      } else {
        // vertical-ish pipe: solid column, not standable
        this.objects.push({ type: 'kit', k, boxes: [{ c: [(px + q[0]) / 2, (py + q[1]) / 2, (pz + q[2]) / 2], h: [rad, Math.abs(q[1] - py) / 2 + rad, rad], top: false }], r: 0, name: 'pipe' });
      }
      return d;
    }
    else if (k === 'stairs') {
      const [w, h, dd, n] = s;
      for (let i = 0; i < n; i++) {
        const sh = (h * (n - i)) / n;
        const lz = -(i * dd) / n;
        const c = Math.cos(deg(r)), sn = Math.sin(deg(r));
        boxes.push({ c: [px + lz * sn, py - h + sh / 2, pz + lz * c], h: [w / 2, sh / 2, dd / n / 2], top: true });
      }
    }
    this.objects.push({ type: 'kit', k, boxes, r, name: extra.name ?? k });
    return d;
  }

  sprite(n, x, y, z, h, sway = 0, flip = false) {
    const d = { n, p: [r2(x), r2(y), r2(z)], h: r2(h) };
    if (sway) d.sway = sway;
    if (flip) d.flip = true;
    this.sprites.push(d);
  }

  get ground() { return this.meta.ground ?? { x: 0, y: 0, z: 0, r: this.meta.radius }; }

  /** highest walkable surface below `maxY` at (x,z) (ground = plateau top inside the plateau) */
  surfaceBelow(x, z, maxY, ignore = null) {
    const G0 = this.ground;
    let best = Math.hypot(x - G0.x, z - G0.z) < G0.r && G0.y < maxY ? G0.y : -999;
    for (const o of this.objects) {
      if (o === ignore) continue;
      if (o.type === 'prefab') {
        if (!o.solid) continue;
        if (Math.hypot(x - o.x, z - o.z) > o.radius + 0.5) continue;
        const t = o.topAt(x, z);
        if (t !== null && t < maxY - 0.05 && t > best) best = t;
      } else for (const b of o.boxes) {
        if (!inBox(b, o.r, x, z)) continue;
        const t = b.c[1] + b.h[1];
        if (t < maxY - 0.05 && t > best) best = t;
      }
    }
    return best;
  }

  /** explicit traversal the jump model cannot see (ladder, moving platform, pad launch, ring) */
  link(a, b, kind) { (this.links ??= []).push({ a: a.slice(), b: b.slice(), kind }); }
  node(p, o = null) { (this.extraNodes ??= []).push({ x: p[0], y: p[1], z: p[2], o }); }

  // ---------------- route helpers
  route(name) { if (!this.routes[name]) this.routes[name] = []; return this.routes[name]; }
  mark(routeName, p, label = '', act = null) { const e = { p: p.slice(), label }; if (act) e.act = act; this.route(routeName).push(e); }

  /** place a scaffold plank with posts down to whatever is below */
  scaffold(x, y, z, w, d, r = 0, opts = {}) {
    const below = this.surfaceBelow(x, z, y - 0.2);
    this.kitPiece('plank', [x, y, z], [w, 0.28, d], r, opts.dark ? { m: 'dark' } : {});
    const drop = y - 0.28 - below;
    if (opts.posts !== false && drop > 0.4 && drop < (opts.maxPost ?? 34)) {
      const c = Math.cos(deg(r)), sn = Math.sin(deg(r));
      const corners = opts.twoPosts ? [[-w / 2 + 0.2, 0], [w / 2 - 0.2, 0]] : [[-w / 2 + 0.18, -d / 2 + 0.18], [w / 2 - 0.18, -d / 2 + 0.18], [-w / 2 + 0.18, d / 2 - 0.18], [w / 2 - 0.18, d / 2 - 0.18]];
      for (const [lx, lz] of corners) {
        const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
        const b = this.surfaceBelow(wx, wz, y - 0.3);
        const hh = y - 0.28 - b;
        if (hh > 0.3 && hh < (opts.maxPost ?? 34)) this.kitPiece('post', [wx, y - 0.28, wz], [0.13, hh], 0, { nc: true });
      }
    }
  }

  /**
   * Fill the gap between two stand points with stepping pieces.
   * style: crates | scaffold | stones | logs | beams | pillars | rocks
   * diff: easy | medium | hard
   */
  steps(routeName, from, to, opts = {}) {
    const style = opts.style ?? 'scaffold';
    const diff = opts.diff ?? 'easy';
    const P = { easy: { rise: 1.05, gapMin: 0.7, gapMax: 1.7 }, medium: { rise: 1.35, gapMin: 1.3, gapMax: 2.35 }, hard: { rise: 1.55, gapMin: 2.0, gapMax: 2.9 }, grab: { rise: 3.0, gapMin: 0.25, gapMax: 0.6 } }[diff];
    const size = opts.size ?? { crates: 1.3, scaffold: 2.0, stones: 2.0, logs: 3.2, beams: 3.6, pillars: 1.3, rocks: 3.0 }[style];
    const via = opts.via ?? [(from[0] + to[0]) / 2, (from[2] + to[2]) / 2];
    // sample curve
    const curve = (t) => [
      (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * via[0] + t * t * to[0],
      (1 - t) * (1 - t) * from[2] + 2 * (1 - t) * t * via[1] + t * t * to[2],
    ];
    const samples = [];
    let L = 0, prev = curve(0);
    for (let i = 0; i <= 200; i++) { const c = curve(i / 200); L += Math.hypot(c[0] - prev[0], c[1] - prev[1]); samples.push({ t: i / 200, s: L, c }); prev = c; }
    const at = (s) => { for (const q of samples) if (q.s >= s) return q.c; return samples[samples.length - 1].c; };
    const dy = to[1] - from[1];
    const startHalf = opts.startHalf ?? 1.0, endHalf = opts.endHalf ?? 1.0;
    const usable = L - startHalf - endHalf;
    let n;
    if (opts.n) n = opts.n;
    else if (diff === 'grab') {
      // a column of ledge-grabs: rises of ~2.5-2.9 m, short run-ups
      n = Math.max(1, Math.ceil(Math.abs(dy) / 2.9) - 1);
      while ((usable - n * size) / (n + 1) > 1.6 && n < 40) n++;
    } else {
      n = Math.max(1, Math.ceil(Math.abs(dy) / P.rise) - 1, Math.ceil((usable + P.gapMin) / (size + P.gapMax)) - 0);
      // ensure gaps are not too small
      while (n > 1 && (usable - n * size) / (n + 1) < P.gapMin * 0.6) n--;
    }
    const gap = (usable - n * size) / (n + 1);
    const rise = dy / (n + 1);
    const placed = [];
    for (let i = 1; i <= n; i++) {
      const s = startHalf + gap * i + size * (i - 0.5);
      const [x, z] = at(s);
      const [x2, z2] = at(Math.min(L, s + 0.5));
      const yaw = (Math.atan2(x2 - x, z2 - z) * 180) / Math.PI;
      let y = from[1] + rise * i;
      if (opts.jitter) y += (this.rnd() - 0.5) * opts.jitter;
      this.placeStep(style, x, y, z, yaw, size, opts);
      this.mark(routeName, [x, y, z]);
      placed.push([x, y, z]);
    }
    this.lastSteps = { n, gap: r2(gap), rise: r2(rise), L: r2(L) };
    if (opts.log !== false) console.log(`  steps ${routeName} ${style}/${diff}: n=${n} gap=${gap.toFixed(2)} rise=${rise.toFixed(2)} len=${L.toFixed(1)}`);
    return placed;
  }

  placeStep(style, x, y, z, yaw, size, opts = {}) {
    switch (style) {
      case 'crates': {
        // stack crates down to the surface below so they look supported
        const below = this.surfaceBelow(x, z, y - 0.1);
        let top = y, k = 0;
        while (top - below > 0.2 && k < 12) {
          const s = Math.min(size, top - below);
          this.kitPiece('crate', [x + (k % 2 ? 0.08 : 0), top, z], [s], yaw + (k % 2 ? 12 : -6));
          top -= s; k++;
        }
        break;
      }
      case 'scaffold': this.scaffold(x, y, z, size, size, yaw, opts); if (opts.lanterns && this.rnd() < 0.35) this.lantern(x + 0.6, y, z + 0.6); break;
      case 'stones': {
        const h = opts.stoneH ?? 1.6 + this.rnd() * 1.4;
        this.kitPiece('stone', [x, y, z], [size, h, size * (0.9 + this.rnd() * 0.2)], yaw, { m: 'grass' });
        if (this.rnd() < 0.5) this.sprite('hanging_vines', x + size * 0.45, y - h + 0.1, z, Math.min(h * 0.9, 2.2), 0.3);
        if (this.rnd() < 0.45) this.sprite(this.pick(['tall_grass', 'daisy_patch', 'yellow_wildflowers', 'purple_wildflowers', 'red_mushrooms']), x - size * 0.25, y, z - size * 0.25, 0.6, 1);
        break;
      }
      case 'logs': this.kitPiece('log', [x, y, z], [opts.logR ?? 0.42, size], yaw - 90 + (opts.across ? 90 : 0)); break;
      case 'beams': this.kitPiece('beam', [x, y, z], [opts.beamW ?? 0.5, 0.35, size], yaw); break;
      case 'pillars': {
        const below = this.surfaceBelow(x, z, y - 0.1);
        const h = Math.min(y - below, opts.maxPillar ?? 9);
        this.kitPiece('pillar', [x, y, z], [size, Math.max(1.2, h)], yaw);
        break;
      }
      case 'ac': {
        // rooftop air-conditioning unit standing on the surface below (top at y)
        const below = this.surfaceBelow(x, z, y - 0.1);
        const sc = y - below;
        if (sc >= 1.0 && sc <= 3.2) { this.prefab('vent_unit', x, below, z, Math.round(yaw / 90) * 90, sc / 0.99, { name: 'ac' }); break; }
        this.kitPiece('slab', [x, y, z], [size, 0.35, size], yaw, { m: 'metal' });
        break;
      }
      case 'boxes': {
        // wooden crates stacked down to the surface below
        const below = this.surfaceBelow(x, z, y - 0.1);
        let top = y, k = 0;
        while (top - below > 0.25 && k < 8) {
          const s = Math.min(size, top - below);
          this.prefab('wooden_crate', x + (k % 2 ? 0.06 : 0), top - s, z, Math.round(yaw + (k % 2 ? 10 : -6)), s, { name: 'crate' });
          top -= s; k++;
        }
        break;
      }
      case 'girders': this.kitPiece('girder', [x, y, z], [opts.girderW ?? 0.9, 0.55, size], yaw); break;
      case 'metal': this.kitPiece('slab', [x, y, z], [size, 0.3, size], yaw, { m: opts.slabM ?? 'grate' }); break;
      case 'rocks': {
        const H = size / 0.95 * 0.9;
        this.prefab('floating_island', x, y - 0.95 * H, z, Math.round(this.rnd() * 360), H, { name: 'rock' });
        break;
      }
    }
  }

  /** chain rope-bridge segments (H=2.2, deck at 0.34H) along a straight line between two deck stand points */
  bridge(routeName, from, to, H = 2.2) {
    const segLen = 2.068 * H * 0.97;
    const dx = to[0] - from[0], dz = to[2] - from[2];
    const L = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(L / segLen));
    const yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
    // bridge long axis is local X -> rotate so local X follows the direction
    const r = yaw - 90;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = from[0] + dx * t, z = from[2] + dz * t;
      const deck = from[1] + (to[1] - from[1]) * t;
      this.prefab('rope_bridge', x, deck - 0.345 * H, z, r, H, { name: 'bridge' });
      this.mark(routeName, [x, deck, z]);
    }
    console.log(`  bridge ${routeName}: ${n} segments, len ${L.toFixed(1)}, slope/seg ${((to[1] - from[1]) / n).toFixed(2)}`);
  }

  lantern(x, y, z) {
    this.sprite('street_lantern', x, y, z, 1.6);
    this.fx.push({ t: 'glow', p: [r2(x), r2(y + 1.38), r2(z)], s: 1.0 });
  }
  banner(x, y, z, h = 2.3) { this.sprite('blue_skyward_banner', x, y, z, h, 0.25); }

  // ---------------------------------------------------------------- validation
  standNodes() {
    const nodes = [];
    for (const o of this.objects) {
      if (o.type === 'prefab') {
        if (!o.solid || o.noStand) continue; // noStand: solid, but its top is covered (lower pieces of a stack)
        const g = o.g;
        const cellW = ((g.maxx - g.minx) / G) * o.s;
        const st = Math.max(1, Math.round(0.6 / cellW));
        for (let gz = 1; gz < G; gz += st) for (let gx = 1; gx < G; gx += st) {
          const k = gz * G + gx;
          if (g.top[k] < 0.01) continue;
          if (g.slope[k] < 0.5) continue; // steeper than ~60 deg
          const lx = g.minx + ((gx + 0.5) / G) * (g.maxx - g.minx), lz = g.minz + ((gz + 0.5) / G) * (g.maxz - g.minz);
          // need some walkable neighbourhood (not a thin spike)
          let ok = 0;
          for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = gx + ax, nz = gz + az;
            if (nx < 0 || nz < 0 || nx >= G || nz >= G) continue;
            if (Math.abs(g.top[nz * G + nx] - g.top[k]) * o.s < 0.35) ok++;
          }
          if (ok < 2) continue;
          const [wx, wz] = o.toWorld(lx, lz);
          // opt-in (map builder sets supportR): the capsule needs a flat patch around the node, not a thin lip
          if (this.supportR) {
            const y0 = o.y + g.top[k] * o.s, R = this.supportR;
            if ([[R, 0], [-R, 0], [0, R], [0, -R]].some(([ax, az]) => { const t = o.topAt(wx + ax, wz + az); return t === null || Math.abs(t - y0) > 0.15; })) continue;
          }
          nodes.push({ x: wx, y: o.y + g.top[k] * o.s, z: wz, o });
        }
      } else {
        for (const b of o.boxes) {
          if (!b.top) continue;
          const hx = b.h[0], hz = b.h[2];
          const nx = Math.max(1, Math.round((hx * 2) / 0.6)), nz = Math.max(1, Math.round((hz * 2) / 0.6));
          const c = Math.cos(deg(o.r)), sn = Math.sin(deg(o.r));
          for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
            const lx = nx === 1 ? 0 : -hx + 0.15 + ((hx * 2 - 0.3) * i) / (nx - 1);
            const lz = nz === 1 ? 0 : -hz + 0.15 + ((hz * 2 - 0.3) * j) / (nz - 1);
            nodes.push({ x: b.c[0] + lx * c + lz * sn, y: b.c[1] + b.h[1], z: b.c[2] - lx * sn + lz * c, o, narrow: !!b.narrow });
          }
        }
      }
    }
    // plateau ground
    const G0 = this.ground;
    const R = G0.r - 3;
    for (let x = -R; x <= R; x += 3) for (let z = -R; z <= R; z += 3) if (Math.hypot(x, z) < R) nodes.push({ x: G0.x + x, y: G0.y, z: G0.z + z, o: null, ground: true });
    // explicit nodes (ladder tops/bottoms, pads, mover stops)
    for (const n of this.extraNodes ?? []) nodes.push({ ...n, o: n.o ?? null });
    return nodes;
  }

  /** is something solid in the column (x,z) between y0 and y1 (excluding `self`)? */
  blocked(x, z, y0, y1, self) {
    for (const o of this.objects) {
      if (o === self) continue;
      if (o.type === 'prefab') {
        if (!o.solid || Math.hypot(x - o.x, z - o.z) > o.radius + 0.3) continue;
        const t = o.topAt(x, z), b = o.botAt(x, z);
        if (t === null) continue;
        if (t > y0 && b < y1) return o;
      } else for (const bx of o.boxes) {
        if (!inBox(bx, o.r, x, z, 0.15)) continue;
        const t = bx.c[1] + bx.h[1], b = bx.c[1] - bx.h[1];
        if (t > y0 && b < y1) return o;
      }
    }
    return null;
  }

  validate(spawn, exit, opts = {}) {
    let nodes = this.standNodes();
    // headroom: need ~1.75 m free above a node
    const before = nodes.length;
    nodes = nodes.filter((n) => !this.blocked(n.x, n.z, n.y + 0.08, n.y + 1.75, n.o));
    console.log(`validate: ${nodes.length} standable nodes (${before - nodes.length} without headroom)`);
    // spatial hash
    const C = 5, hash = new Map();
    const key = (x, z) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
    nodes.forEach((n, i) => { n.i = i; const k = key(n.x, n.z); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(i); });
    const neigh = (n, rad) => {
      const out = [];
      const r = Math.ceil(rad / C);
      const cx = Math.floor(n.x / C), cz = Math.floor(n.z / C);
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { const l = hash.get(`${cx + a},${cz + b}`); if (l) for (const j of l) out.push(j); }
      return out;
    };
    const SL = PHYS.capsuleR + 0.15;
    // edge cost classes: 0 walk, 1 easy jump, 2 medium, 3 hard, 4 grab
    const edgeClass = (a, b) => {
      const d = Math.hypot(a.x - b.x, a.z - b.z), dh = b.y - a.y;
      if (d < 1e-3 && Math.abs(dh) < 1e-3) return -1;
      if (a.o === b.o && a.o && d < 0.95 && Math.abs(dh) < 0.45) return 0;
      if (d < 0.75 && dh < 0.43 && dh > -1.5) return 0;
      if (a.ground && b.ground) return d < 3.1 ? 0 : -1;
      if (dh <= PHYS.apex - 0.1) {
        const R = reach(dh) + SL;
        if (dh < -0.5 && d < 0.9) return 0; // step / drop off an edge
        const ratio = d / R;
        if (ratio <= 0.62) return 1;
        if (ratio <= 0.8) return 2;
        if (ratio <= 0.93) return 3;
        return -1;
      }
      // ledge grab: feet must pass through [dh-2.05, dh-0.95] while the wall is within reach (running jump)
      if (dh <= PHYS.apex + PHYS.grabMax - 0.1) {
        const yLow = dh - PHYS.grabMax;
        const tApex = PHYS.v0 / PHYS.gUp;
        const tEnd = yLow < PHYS.apex ? tApex + Math.sqrt((PHYS.apex - yLow) / (PHYS.gDown / 2)) : tApex;
        const maxD = 0.72 * PHYS.run * tEnd + 0.45;
        if (d <= maxD) return 4;
      }
      return -1;
    };
    const maxRad = 7.5;
    // explicit links (ladders, movers, pads, rings): from the node nearest `a` to the node nearest `b`
    const linkMap = new Map();
    const nearestTo = (p) => { let best = -1, bd = 1e9; for (const n of nodes) { const d = Math.hypot(n.x - p[0], (n.y - p[1]) * 3, n.z - p[2]); if (d < bd) { bd = d; best = n.i; } } return bd < 2.5 ? best : -1; };
    for (const L of this.links ?? []) {
      const ia = nearestTo(L.a), ib = nearestTo(L.b);
      if (ia < 0 || ib < 0) { console.log(`  link ${L.kind} unresolved: ${ia < 0 ? 'a ' + L.a.map(r2) : ''} ${ib < 0 ? 'b ' + L.b.map(r2) : ''}`); continue; }
      if (!linkMap.has(ia)) linkMap.set(ia, []);
      linkMap.get(ia).push([ib, 1]);
    }
    const adj = (i, maxClass) => {
      const a = nodes[i];
      const out = [...(linkMap.get(i) ?? [])];
      for (const j of neigh(a, maxRad)) {
        const b = nodes[j];
        const dh = b.y - a.y;
        if (dh > 4.2) continue;
        const cl = edgeClass(a, b);
        if (cl < 0 || cl > maxClass) continue;
        out.push([j, cl]);
      }
      // falling: anything below within a fall cone is reachable (ignore class)
      return out;
    };
    const nearest = (p) => { let best = -1, bd = 1e9; for (const n of nodes) { const d = Math.hypot(n.x - p[0], (n.y - p[1]) * 2, n.z - p[2]); if (d < bd) { bd = d; best = n.i; } } return best; };
    const s0 = nearest(spawn), e0 = nearest(exit);
    const bfs = (maxClass) => {
      const prev = new Int32Array(nodes.length).fill(-2);
      const q = [s0]; prev[s0] = -1;
      for (let h = 0; h < q.length; h++) {
        const i = q[h];
        if (i === e0) break;
        for (const [j] of adj(i, maxClass)) if (prev[j] === -2) { prev[j] = i; q.push(j); }
      }
      if (prev[e0] === -2) return null;
      const pathIdx = [];
      for (let i = e0; i !== -1; i = prev[i]) pathIdx.push(i);
      return pathIdx.reverse();
    };
    const res = {};
    for (const [name, cls] of [['walk+easy+grab', 1], ['medium', 2], ['hard', 3]]) {
      const p = bfs(cls === 1 ? 1 : cls);
      // allow grabs in every class
      res[name] = p;
    }
    // re-run allowing grabs explicitly
    const bfsG = (maxJump) => {
      const prev = new Int32Array(nodes.length).fill(-2);
      const q = [s0]; prev[s0] = -1;
      for (let h = 0; h < q.length; h++) {
        const i = q[h];
        if (i === e0) break;
        for (const [j, cl] of adj(i, 4)) { if (cl !== 4 && cl > maxJump) continue; if (prev[j] === -2) { prev[j] = i; q.push(j); } }
      }
      if (prev[e0] === -2) return { path: null, reached: prev };
      const pathIdx = [];
      for (let i = e0; i !== -1; i = prev[i]) pathIdx.push(i);
      return { path: pathIdx.reverse(), reached: prev };
    };
    const easy = bfsG(1), med = bfsG(2), hard = bfsG(3);
    const summary = (r) => r.path ? `${r.path.length} hops, top ${Math.max(...r.path.map((i) => nodes[i].y)).toFixed(1)}m` : 'NO PATH';
    console.log(`  path easy-only: ${summary(easy)}\n  path <=medium: ${summary(med)}\n  path <=hard: ${summary(hard)}`);
    // highest node reachable with easy/medium jumps (diagnostics)
    for (const [nm, r] of [['easy', easy], ['medium', med], ['hard', hard]]) {
      let hi = -1, hy = -1;
      r.reached.forEach((v, i) => { if (v !== -2 && nodes[i].y > hy) { hy = nodes[i].y; hi = i; } });
      const n = nodes[hi];
      console.log(`  highest reachable (${nm}): ${hy.toFixed(1)} m at [${n.x.toFixed(1)}, ${n.z.toFixed(1)}] on ${n.o?.name ?? 'ground'}`);
    }
    // soft-lock check: every node reachable from spawn (hard) must be able to reach the exit
    const rev = new Map();
    const reachable = [];
    hard.reached.forEach((v, i) => { if (v !== -2) reachable.push(i); });
    const canExit = new Uint8Array(nodes.length);
    // reverse BFS from exit on the hard graph (with drops always allowed)
    const radj = new Map();
    for (const i of reachable) for (const [j] of adj(i, 4)) { if (!radj.has(j)) radj.set(j, []); radj.get(j).push(i); }
    const q = [e0]; canExit[e0] = 1;
    for (let h = 0; h < q.length; h++) for (const i of radj.get(q[h]) ?? []) if (!canExit[i]) { canExit[i] = 1; q.push(i); }
    const stuck = reachable.filter((i) => !canExit[i]);
    const stuckObjs = new Map();
    for (const i of stuck) { const n = nodes[i]; const k = n.o?.name ?? 'ground'; const key2 = `${k}@${n.x.toFixed(0)},${n.y.toFixed(0)},${n.z.toFixed(0)}`; stuckObjs.set(key2, (stuckObjs.get(key2) ?? 0) + 1); }
    console.log(`  soft-lock candidates: ${stuck.length} nodes${stuck.length ? ' e.g. ' + [...stuckObjs.keys()].slice(0, 12).join(' | ') : ''}`);
    void rev;
    return { nodes, easy, med, hard, stuck };
  }

  /** warn when solid kit pieces intersect solid prefab volumes or other kit pieces */
  checkOverlaps() {
    const warns = [];
    const kits = this.objects.filter((o) => o.type === 'kit');
    for (const o of kits) for (const b of o.boxes) {
      const c = Math.cos(deg(o.r)), sn = Math.sin(deg(o.r));
      const pts = [[0, 0], [b.h[0] * 0.8, b.h[2] * 0.8], [-b.h[0] * 0.8, b.h[2] * 0.8], [b.h[0] * 0.8, -b.h[2] * 0.8], [-b.h[0] * 0.8, -b.h[2] * 0.8]];
      for (const [lx, lz] of pts) {
        const x = b.c[0] + lx * c + lz * sn, z = b.c[2] - lx * sn + lz * c;
        for (const q of this.objects) {
          if (q === o || q.type !== 'prefab' || !q.solid) continue;
          if (Math.hypot(x - q.x, z - q.z) > q.radius) continue;
          const t = q.topAt(x, z), bt = q.botAt(x, z);
          if (t === null) continue;
          const y0 = b.c[1] - b.h[1], y1 = b.c[1] + b.h[1];
          if (y1 > bt + 0.25 && y0 < t - 0.25) { warns.push(`${o.k}@${x.toFixed(1)},${y1.toFixed(1)},${z.toFixed(1)} inside ${q.name}`); break; }
        }
      }
    }
    const uniq = [...new Set(warns)];
    console.log(`  overlaps: ${uniq.length}${uniq.length ? '\n    ' + uniq.slice(0, 25).join('\n    ') : ''}`);
    return uniq;
  }

  toJSON(extra) {
    return { ...extra, prefabs: this.prefabs, kit: this.kit, sprites: this.sprites, fx: this.fx, scenery: this.scenery };
  }
}

export function inBox(b, yawDeg, x, z, pad = 0) {
  const c = Math.cos(deg(yawDeg)), sn = Math.sin(deg(yawDeg));
  const dx = x - b.c[0], dz = z - b.c[2];
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  return Math.abs(lx) <= b.h[0] + pad && Math.abs(lz) <= b.h[2] + pad;
}

/**
 * Admin / test teleport targets: spawn, where the main route enters each zone, the start of every
 * shortcut / secondary route, and the exit. Positions are feet positions on real route points (standable).
 */
export function makeWaypoints(routes, zones, names = {}) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const out = [];
  const main = routes.main ?? [];
  if (main.length) out.push({ label: 'Điểm xuất phát', p: main[0].p.map(r2) });
  for (const z of zones) {
    const pt = main.find((q) => q.p[1] >= z.y0 + 0.5 && q.p[1] < z.y1);
    if (pt && pt !== main[0]) out.push({ label: `Khu ${z.id} – ${z.name}`, p: pt.p.map(r2) });
  }
  for (const [k, pts] of Object.entries(routes)) {
    if (k === 'main' || k === 'dead' || !pts.length) continue;
    out.push({ label: names[k] ?? `Tuyến ${k}`, p: pts[0].p.map(r2) });
  }
  if (main.length > 1) out.push({ label: 'Gần đích', p: main[main.length - 2].p.map(r2) });
  return out;
}
