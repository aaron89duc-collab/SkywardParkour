import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Physics } from '../core/Physics';
import { Assets, bakedGeometry, lod0Mesh } from '../core/Assets';
import { COLLISION } from '../config';
import * as CT from './CityTextures';
import type { V3 } from './MapTypes';

/**
 * Gameplay devices: objects in the world that move and react to the player. The controls never change (run,
 * steer, jump); every device is a JSON entry in the map (`devices`), with an optional GLB look (`model`), so a
 * new map combines them with no app update. Everything that moves is a function of the simulation time (or of a
 * small state machine stepped at the fixed tick), so the player, the physics bot and replays see the same world.
 *
 * Device ids (also the `mechanics` ids of the content catalog):
 *   crumble, blink, conveyor, turntable, tilt, piston, sweeper, fan, slippery, trampoline, zipline, plate,
 *   elevator, cannon, drop, portal, lowgrav, oneway, checkpoint, collectible
 *   app 5+: slide (a playground chute you ride down), pit (soft ball pit), reveal (appears / lowers when a plate
 *   or a plate puzzle drives it); older apps skip the types they do not know (a map using them sets minApp 5)
 */
export type DeviceType =
  | 'crumble' | 'blink' | 'conveyor' | 'turntable' | 'tilt' | 'piston' | 'sweeper' | 'fan' | 'slippery' | 'trampoline'
  | 'zipline' | 'plate' | 'elevator' | 'cannon' | 'drop' | 'portal' | 'lowgrav' | 'oneway' | 'checkpoint' | 'collectible'
  | 'slide' | 'pit' | 'reveal';
export const DEVICE_TYPES: DeviceType[] = ['crumble', 'blink', 'conveyor', 'turntable', 'tilt', 'piston', 'sweeper', 'fan', 'slippery', 'trampoline', 'zipline', 'plate', 'elevator', 'cannon', 'drop', 'portal', 'lowgrav', 'oneway', 'checkpoint', 'collectible', 'slide', 'pit', 'reveal'];

/** A device entry in the map JSON. `p` is the top centre of a platform (or the base of a volume), `s` its size
 *  [w, h, d] (local x, y, z), `r` its yaw in degrees. Every other field is a parameter of that type. */
export interface DeviceData {
  t: DeviceType;
  id?: string;
  p: V3;
  r?: number;
  s?: V3;
  phase?: number;
  /** optional look: GLB (logical path, no .glb) scaled by `s`, offset in model units; replaces the built-in look */
  model?: { file: string; s?: number; off?: V3; yaw?: number };
  /** optional colour of the built-in look (a map's palette: candy pink belts, mint fans ...); older apps ignore it */
  color?: string;
  // per type
  delay?: number; respawn?: number; // crumble
  on?: number; off?: number; // blink, fan
  speed?: number; // conveyor (m/s), turntable / sweeper (deg/s), elevator / zipline (m/s), drop (m/s)
  radius?: number; // turntable, sweeper arm length
  maxAngle?: number; // tilt
  /** tilt (app 4+): a folding leaf - after the player has stood on it this many seconds it bends its local +z end
   *  down to maxAngle, slowly, and springs back once empty; older apps: a plain tilt */
  fold?: number;
  /** tilt (app 4+): sways by itself (wind), +-maxAngle over this period in seconds; standing on it adds a lean */
  sway?: number;
  stroke?: number; period?: number; wait?: number; // piston, elevator wait
  arms?: number; // sweeper
  force?: number; dir?: 'up' | 'forward'; // fan
  grip?: number; // slippery (0..1)
  bounce?: number; min?: number; max?: number; // trampoline
  /** trampoline (app 4+): also throws you sideways at this speed (m/s) along the device's yaw (local +z): a tilted
   *  mushroom cap. Older apps: straight up */
  push?: number;
  b?: V3; // zipline end, elevator top, portal exit
  rb?: number; // portal exit yaw
  target?: string; hold?: number; // plate -> device id (or `grp`) it drives (piston / elevator / reveal), seconds it stays on
  /** plate (app 5+): stays on for good once pressed, and the game remembers it (a shortcut opened once stays open) */
  latch?: boolean;
  /** plate (app 5+): plates sharing a puzzle id must be pressed in `order` (1, 2, 3 ...); a wrong one resets them.
   *  Solved = latched (saved) and the puzzle's `target` (on any of its plates) turns on */
  puzzle?: string; order?: number;
  /** any device (app 5+): a group name a plate's `target` can name (several pieces of stairs, a bridge's planks) */
  grp?: string;
  /** slide (app 5+): centre line of the chute's surface from the top to the bottom (world points; p = pts[0]),
   *  chute width `w`, friction (m/s^2) and top speed. A last segment pointing up throws you off like a ramp */
  pts?: V3[]; w?: number; fric?: number; vmax?: number;
  /** any device (app 5+): no built-in look at all (the map places the model as a prefab, e.g. a slide's chute) */
  bare?: boolean;
  /** pit (app 5+): p = the ball surface (top centre), s = [w, -, d]; you sink `sink` m into it, run at `slow` of
   *  the speed and jump `jump` of the height; `rim` = soft walls that high above the balls (0 = none), n loose balls */
  sink?: number; slow?: number; jump?: number; rim?: number; n?: number;
  /** reveal (app 5+): hidden (no collider) until driven, then rises from `rise` (offset, default 3 m below) over
   *  `dur` s after `delay`; with `tip` it is always there, raised `tip` degrees (its +z end up, a drawbridge),
   *  and lowers flat when driven */
  rise?: V3; dur?: number; tip?: number;
  pitch?: number; v?: number; // cannon
  need?: number; // portal: opens only once this many pickups (collectible) of the map are collected; older apps: always open
  fall?: number; interval?: number; // drop
  g?: number; // lowgrav gravity scale
}

/** What a device can carry (same interface as a moving platform). */
export interface Carrier {
  delta: THREE.Vector3;
  rotates: boolean;
  dAng: number;
  data: { id: string };
  carryAt(p: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3;
  velAt(p: THREE.Vector3, dt: number, out?: THREE.Vector3): THREE.Vector3;
  /** app 5: jumping off keeps k x its velocity, the horizontal speed capped at max, and the flight keeps it */
  kick?: Kick | null;
}

/** The centre line of a slide: arc length s along it, sideways offset lat (+ = right of the way down). */
export class SlidePath {
  readonly pts: THREE.Vector3[];
  readonly cum: number[] = [0];
  readonly L: number;
  constructor(pts: V3[], public w: number, public fric: number, public vmax: number, public id: string) {
    this.pts = pts.map((p) => new THREE.Vector3(...p));
    let L = 0;
    for (let i = 1; i < this.pts.length; i++) { L += this.pts[i].distanceTo(this.pts[i - 1]); this.cum.push(L); }
    this.L = L;
  }
  private seg(s: number) {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    return i;
  }
  private segDir(i: number, out: THREE.Vector3) {
    i = THREE.MathUtils.clamp(i, 1, this.pts.length - 1);
    return out.subVectors(this.pts[i], this.pts[i - 1]).normalize();
  }
  /** unit tangent at s (blended over 0.6 m around each bend, so the yaw never snaps) */
  tangent(s: number, out = new THREE.Vector3()) {
    const i = this.seg(s);
    this.segDir(i, out);
    const B = 0.6;
    const toEnd = this.cum[i] - s, fromStart = s - this.cum[i - 1];
    if (toEnd < B && i < this.pts.length - 1) out.lerp(this.segDir(i + 1, _sv), 0.5 * (1 - toEnd / B)).normalize();
    else if (fromStart < B && i > 1) out.lerp(this.segDir(i - 1, _sv), 0.5 * (1 - fromStart / B)).normalize();
    return out;
  }
  /** horizontal unit normal to the right of the way down at s */
  side(s: number, out = new THREE.Vector3()) {
    const t = this.tangent(s, out);
    const h = Math.hypot(t.x, t.z) || 1;
    return out.set(-t.z / h, 0, t.x / h);
  }
  /** surface point at (s, lat) */
  at(s: number, lat: number, out = new THREE.Vector3()) {
    s = THREE.MathUtils.clamp(s, 0, this.L);
    const i = this.seg(s), a = this.pts[i - 1], b = this.pts[i];
    const sl = this.cum[i] - this.cum[i - 1];
    out.lerpVectors(a, b, sl > 1e-6 ? (s - this.cum[i - 1]) / sl : 0);
    return out.addScaledVector(this.side(s, _sv2), lat);
  }
  /** nearest centre-line point to p: arc length, sideways offset, height of p above the surface */
  project(p: THREE.Vector3) {
    let best = Infinity, bs = 0, bl = 0, bh = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      const ab = _sv.subVectors(b, a), L2 = ab.lengthSq();
      const u = THREE.MathUtils.clamp(_sv2.subVectors(p, a).dot(ab) / Math.max(1e-9, L2), 0, 1);
      const c = _sv2.copy(a).addScaledVector(ab, u);
      const d = c.distanceTo(p);
      if (d < best) {
        best = d; bs = this.cum[i - 1] + u * Math.sqrt(L2);
        const hl = Math.hypot(ab.x, ab.z) || 1;
        bl = ((p.x - c.x) * -ab.z + (p.z - c.z) * ab.x) / hl;
        bh = p.y - c.y;
      }
    }
    return { s: bs, lat: bl, h: bh };
  }
}
const _sv = new THREE.Vector3(), _sv2 = new THREE.Vector3();
export type Surface = {
  grip?: number; bounce?: number; min?: number; max?: number; pushX?: number; pushZ?: number;
  /** app 5: a chute to ride down */
  slide?: SlidePath;
  /** app 5: soft floor (ball pit): run speed and jump height factors */
  soft?: { speed: number; jump: number };
};
/** something carrying the player that changes the jump off it (app 5: a swing gives its momentum) */
export type Kick = { k: number; max: number };
export type DeviceAction =
  | { kind: 'portal'; p: THREE.Vector3; yaw: number; dYaw: number }
  | { kind: 'launch'; v: THREE.Vector3 }
  | { kind: 'zip'; a: THREE.Vector3; b: THREE.Vector3; speed: number; id: string }
  | { kind: 'checkpoint'; p: THREE.Vector3; yaw: number; id: string }
  | { kind: 'collect'; id: string };

/** app 5: what happened to plates this tick (sounds, and the game saves a latch) */
export type DeviceEvent = { k: 'press' | 'bad' | 'latch' | 'crack'; id: string; p: THREE.Vector3 };

const Y = new THREE.Vector3(0, 1, 0);
const D2R = Math.PI / 180;
const smooth = (t: number) => t * t * (3 - 2 * t);
const mod = (a: number, b: number) => ((a % b) + b) % b;

type Body = { c: RAPIER.Collider; off: THREE.Vector3; half: THREE.Vector3 };

/** One device instance: colliders it owns, its visual, and its per-tick behaviour. */
class Device implements Carrier {
  readonly delta = new THREE.Vector3();
  rotates = false;
  dAng = 0;
  ang = 0;
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly base = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  readonly group = new THREE.Group();
  bodies: Body[] = [];
  /** seconds the player has stood on it (crumble, plate, elevator) */
  stoodT = 0;
  stoodNow = false;
  /** internal state machine */
  st = 0; stT = 0;
  /** the look (squashed when a trampoline throws you) */
  inner: THREE.Group | null = null;
  squash = -1;
  wasStood = false;
  active = true;
  /** app 5: driven on by a plate (reveal), latched for good (plate), lit in its puzzle (plate) */
  want = false;
  latched = false;
  lit = false;
  /** reveal: progress 0 (hidden / raised) .. 1 (there / lowered) */
  u = 0;
  lamp: THREE.MeshStandardMaterial | null = null;
  slide: SlidePath | null = null;
  balls: { m: THREE.InstancedMesh; b: { x: number; z: number; y: number; vy: number; vx: number; vz: number }[]; feet: THREE.Vector3 | null; w: number; d: number } | null = null;
  constructor(public d: DeviceData, public data: { id: string }) {
    this.base.set(...d.p);
    this.pos.copy(this.base);
    this.prev.copy(this.base);
    this.q.setFromAxisAngle(Y, (d.r ?? 0) * D2R);
  }
  carryAt(p: THREE.Vector3, out = new THREE.Vector3()) {
    if (!this.rotates) return out.copy(this.delta);
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const c = Math.cos(this.dAng), s = Math.sin(this.dAng);
    return out.set(dx * c + dz * s - dx, this.delta.y, -dx * s + dz * c - dz);
  }
  velAt(p: THREE.Vector3, dt: number, out = new THREE.Vector3()) { return this.carryAt(p, out).divideScalar(Math.max(1e-4, dt)); }
}

/** Builds and steps every device of one map. */
export class DeviceSystem {
  group = new THREE.Group();
  list: Device[] = [];
  private byHandle = new Map<number, Device>();
  private byId = new Map<string, Device>();
  /** checkpoints / pickups already used this session (ids) */
  used = new Set<string>();

  constructor(private physics: Physics) { this.group.name = 'devices'; }

  async build(list: DeviceData[], assets: Assets) {
    if (!list.length) return;
    const tex = {
      metal: new THREE.MeshStandardMaterial({ map: CT.metalTex(23, 210, 10, 40), roughness: 0.55, metalness: 0.35 }),
      hazard: new THREE.MeshStandardMaterial({ map: CT.hazardTex(), roughness: 0.7 }),
      grate: new THREE.MeshStandardMaterial({ map: CT.grateTex(), roughness: 0.6, metalness: 0.3 }),
      yellow: new THREE.MeshStandardMaterial({ map: CT.metalTex(12, 45, 80, 52), roughness: 0.5, metalness: 0.2 }),
    };
    const glow = (color: string, k = 1.4) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
    const ice = new THREE.MeshStandardMaterial({ color: '#bfe8ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 });
    const belt = CT.grateTex().clone(); belt.wrapS = belt.wrapT = THREE.RepeatWrapping; belt.needsUpdate = true;
    const beltMat = new THREE.MeshStandardMaterial({ map: belt, color: '#5a5f66', roughness: 0.8 });
    this.beltTex = belt;
    const cable = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.6, metalness: 0.5 });
    const candy = (color: string, rough = 0.4) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    const models = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material } | null>();
    const model = async (file: string) => {
      if (!models.has(file)) {
        const g = await assets.gltf(`${file}.glb`).catch(() => null);
        const src = g ? lod0Mesh(g.scene) : null;
        models.set(file, src ? { geo: bakedGeometry(src), mat: src.material as THREE.Material } : null);
      }
      return models.get(file)!;
    };
    const box = (w: number, h: number, d: number, mat: THREE.Material | THREE.Material[], y = -h / 2) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.y = y; m.castShadow = m.receiveShadow = true;
      return m;
    };
    let n = 0;
    for (const d of list) {
      const id = d.id ?? `${d.t}${++n}`;
      const dv = new Device(d, { id });
      this.byId.set(id, dv);
      const [w, h, dd] = d.s ?? [3, 0.5, 3];
      const inner = new THREE.Group();
      dv.group.add(inner);
      dv.inner = inner;
      const solid = (half: THREE.Vector3, off = new THREE.Vector3(), sensor = false) => {
        const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(COLLISION.WORLD).setFriction(0);
        if (sensor) desc.setSensor(true);
        const c = this.physics.world.createCollider(desc);
        this.physics.colliderCount++;
        dv.bodies.push({ c, off, half });
        this.byHandle.set(c.handle, dv);
        return c;
      };
      // ---- look (a GLB if the map gives one, else a built-in procedural one)
      if (d.model) {
        const M = d.model, s = M.s ?? 1, src = await model(M.file);
        if (src) {
          const o = new THREE.Mesh(src.geo, src.mat);
          o.scale.setScalar(s);
          o.position.set((M.off?.[0] ?? 0) * s, (M.off?.[1] ?? 0) * s, (M.off?.[2] ?? 0) * s);
          o.rotation.y = (M.yaw ?? 0) * D2R;
          o.castShadow = o.receiveShadow = true;
          inner.add(o);
        }
      }
      const look = !d.model && !d.bare;
      switch (d.t) {
        case 'crumble':
        case 'blink':
        case 'oneway':
        case 'slippery':
        case 'trampoline':
        case 'conveyor':
        case 'plate': {
          const th = d.t === 'plate' ? 0.15 : h;
          if (look) {
            const mat = d.color ? (d.t === 'conveyor' ? new THREE.MeshStandardMaterial({ map: belt, color: d.color, roughness: 0.35 }) : d.t === 'blink' || d.t === 'trampoline' || d.t === 'plate' ? glow(d.color, 0.35) : candy(d.color, d.t === 'slippery' ? 0.06 : 0.4))
              : d.t === 'crumble' ? [tex.metal, tex.metal, tex.hazard, tex.grate, tex.metal, tex.metal]
              : d.t === 'blink' ? glow('#58d6ff', 0.6) : d.t === 'oneway' ? tex.grate : d.t === 'slippery' ? ice
                : d.t === 'trampoline' ? glow('#ff4fa3', 0.35) : d.t === 'conveyor' ? beltMat : glow('#ffd166', 0.5);
            inner.add(box(w, th, dd, mat));
            if (d.t === 'trampoline') for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = box(0.18, 0.8, 0.18, tex.metal, -th - 0.4); leg.position.x = sx * (w / 2 - 0.2); leg.position.z = sz * (dd / 2 - 0.2); inner.add(leg); }
            if (d.t === 'conveyor') for (const sx of [-1, 1]) { const rim = box(0.2, th + 0.1, dd, tex.yellow, -th / 2 + 0.05); rim.position.x = sx * (w / 2 + 0.1); inner.add(rim); }
          }
          solid(new THREE.Vector3(w / 2, th / 2, dd / 2), new THREE.Vector3(0, -th / 2, 0));
          if (d.t === 'plate' && (d.latch || d.puzzle)) {
            // a lamp in the middle: lit once pressed (in the right order)
            dv.lamp = new THREE.MeshStandardMaterial({ color: d.color ?? '#ffd166', emissive: d.color ?? '#ffd166', emissiveIntensity: 0.15, roughness: 0.3 });
            const lamp = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, dd) * 0.22, Math.min(w, dd) * 0.22, 0.06, 20), dv.lamp);
            lamp.position.y = 0.03; inner.add(lamp);
          }
          break;
        }
        case 'slide': {
          const pts = d.pts && d.pts.length >= 2 ? d.pts : [d.p, [d.p[0], d.p[1] - 1, d.p[2] + 3] as V3];
          const W = d.w ?? 1.6;
          const path = new SlidePath(pts, W, d.fric ?? 1.5, d.vmax ?? 11, id);
          dv.slide = path;
          dv.q.identity();
          // one thin box per segment, its top on the centre line (placed once: a slide never moves)
          for (let i = 1; i < path.pts.length; i++) {
            const a = path.pts[i - 1], b = path.pts[i];
            const dir = _v.subVectors(b, a); const len = dir.length(); dir.divideScalar(len);
            const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.asin(dir.y), Math.atan2(dir.x, dir.z), 0, 'YXZ'));
            const half = new THREE.Vector3(W / 2, 0.15, len / 2 + 0.04);
            const o = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.15, 0).applyQuaternion(qq));
            const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(COLLISION.WORLD).setFriction(0)
              .setTranslation(o.x, o.y, o.z).setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w });
            const c = this.physics.world.createCollider(desc); this.physics.colliderCount++;
            dv.bodies.push({ c, off: new THREE.Vector3(), half });
            this.byHandle.set(c.handle, dv);
          }
          if (look) {
            // an open trough along the centre line
            const prof = [[-W / 2 - 0.12, 0.42], [-W / 2, 0.03], [W / 2, 0.03], [W / 2 + 0.12, 0.42]];
            const n = Math.max(2, Math.ceil(path.L / 0.4) + 1), pos: number[] = [], idx: number[] = [];
            const c0 = path.pts[0], sd = new THREE.Vector3(), pt = new THREE.Vector3();
            for (let j = 0; j < n; j++) {
              const sj = (path.L * j) / (n - 1);
              path.at(sj, 0, pt); path.side(sj, sd);
              for (const [x, y] of prof) pos.push(pt.x + sd.x * x - c0.x, pt.y + y - c0.y, pt.z + sd.z * x - c0.z);
              if (j) for (let k = 0; k < 3; k++) { const a0 = (j - 1) * 4 + k, b0 = j * 4 + k; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
            const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: d.color ?? '#ff8ac6', roughness: 0.3, side: THREE.DoubleSide }));
            m.castShadow = m.receiveShadow = true; inner.add(m);
          }
          break;
        }
        case 'pit': {
          const sink = d.sink ?? 0.7, rim = d.rim ?? 0;
          solid(new THREE.Vector3(w / 2, 0.25, dd / 2), new THREE.Vector3(0, -sink - 0.25, 0));
          if (rim > 0) {
            const hy = (sink + rim) / 2, oy = (rim - sink) / 2;
            for (const sx of [-1, 1]) solid(new THREE.Vector3(0.15, hy, dd / 2 + 0.3), new THREE.Vector3(sx * (w / 2 + 0.15), oy, 0));
            for (const sz of [-1, 1]) solid(new THREE.Vector3(w / 2, hy, 0.15), new THREE.Vector3(0, oy, sz * (dd / 2 + 0.15)));
          }
          const pal = ['#ff5d73', '#ffd23f', '#3ec1ff', '#5be37d', '#b07cff', '#ff9a3c'];
          if (look) {
            const top = new THREE.Mesh(new THREE.PlaneGeometry(w, dd), new THREE.MeshStandardMaterial({ map: ballTex(pal, w / 1.8, dd / 1.8), roughness: 0.45 }));
            top.rotation.x = -Math.PI / 2; top.position.y = -0.04; top.receiveShadow = true; inner.add(top);
            if (rim > 0) for (const [bw, bd, x, z] of [[0.3, dd + 0.6, -w / 2 - 0.15, 0], [0.3, dd + 0.6, w / 2 + 0.15, 0], [w, 0.3, 0, -dd / 2 - 0.15], [w, 0.3, 0, dd / 2 + 0.15]]) {
              const b = box(bw, sink + rim, bd, candy(d.color ?? '#7fd3ff', 0.6), (rim - sink) / 2); b.position.x = x; b.position.z = z; inner.add(b);
            }
          }
          // loose balls that hop out of the way (look only)
          const nb = d.n ?? (look ? 36 : 14);
          if (nb > 0) {
            const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.3 }), nb);
            let seed = 0; for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
            const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
            const bl = [];
            for (let i = 0; i < nb; i++) { bl.push({ x: (rnd() - 0.5) * (w - 0.5), z: (rnd() - 0.5) * (dd - 0.5), y: 0, vy: 0, vx: 0, vz: 0 }); im.setColorAt(i, new THREE.Color(pal[i % pal.length])); }
            im.castShadow = true; inner.add(im);
            dv.balls = { m: im, b: bl, feet: null, w, d: dd };
            this.ballPose(dv);
          }
          break;
        }
        case 'reveal': {
          const zc = d.tip ? dd / 2 : 0;
          if (look) { const b = box(w, h, dd, d.color ? candy(d.color) : [tex.metal, tex.metal, tex.grate, tex.metal, tex.yellow, tex.yellow]); b.position.z = zc; inner.add(b); }
          solid(new THREE.Vector3(w / 2, h / 2, dd / 2), new THREE.Vector3(0, -h / 2, zc));
          break;
        }
        case 'tilt': {
          if (look) { inner.add(box(w, h, dd, d.color ? candy(d.color) : [tex.metal, tex.metal, tex.grate, tex.metal, tex.hazard, tex.hazard])); const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, w * 0.6, 12), tex.yellow); pivot.rotation.z = Math.PI / 2; pivot.position.y = -h - 0.2; inner.add(pivot); }
          solid(new THREE.Vector3(w / 2, h / 2, dd / 2), new THREE.Vector3(0, -h / 2, 0));
          break;
        }
        case 'turntable': {
          const R = d.radius ?? 3;
          dv.rotates = true;
          if (look) {
            const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, h, 32), [tex.metal, tex.grate, tex.metal]);
            disc.position.y = -h / 2; disc.castShadow = disc.receiveShadow = true; inner.add(disc);
            const stripe = box(R * 1.9, 0.02, 0.35, tex.hazard, 0.01); inner.add(stripe);
          }
          // a disc as a ring of boxes is enough for the controller: one cylinder collider (round top)
          const desc = RAPIER.ColliderDesc.cylinder(h / 2, R).setCollisionGroups(COLLISION.WORLD).setFriction(0);
          const c = this.physics.world.createCollider(desc); this.physics.colliderCount++;
          dv.bodies.push({ c, off: new THREE.Vector3(0, -h / 2, 0), half: new THREE.Vector3(R, h / 2, R) });
          this.byHandle.set(c.handle, dv);
          break;
        }
        case 'piston':
        case 'elevator': {
          if (look) inner.add(box(w, h, dd, d.color ? candy(d.color) : d.t === 'piston' ? [tex.hazard, tex.hazard, tex.metal, tex.metal, tex.hazard, tex.hazard] : [tex.metal, tex.metal, tex.grate, tex.metal, tex.yellow, tex.yellow]));
          solid(new THREE.Vector3(w / 2, h / 2, dd / 2), new THREE.Vector3(0, -h / 2, 0));
          if (d.t === 'piston' && look) { const rod = box(0.35, 0.35, d.stroke ?? 3, tex.metal, -h / 2); rod.position.z = -(d.stroke ?? 3) / 2 - dd / 2; inner.add(rod); }
          break;
        }
        case 'sweeper': {
          const L = d.radius ?? 4, arms = d.arms ?? 1;
          dv.rotates = true;
          if (look) {
            const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.9, 14), d.color ? candy('#ffffff', 0.3) : tex.yellow); hub.position.y = 0.45; inner.add(hub);
            for (let i = 0; i < arms; i++) {
              const arm = box(0.32, 0.32, L, d.color ? candy(d.color, 0.3) : [tex.hazard, tex.hazard, tex.hazard, tex.hazard, tex.metal, tex.metal], 0.7);
              arm.position.z = L / 2; const pivot = new THREE.Group(); pivot.rotation.y = (i / arms) * Math.PI * 2; pivot.add(arm); inner.add(pivot);
            }
          }
          break; // hits are computed geometrically (knock-back), no collider: you jump over the bar
        }
        case 'fan': {
          if (look) {
            const frame = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, dd) / 2, Math.min(w, dd) / 2, 0.4, 24, 1, true), d.color ? candy(d.color) : tex.yellow);
            frame.position.y = 0.2; inner.add(frame);
            const blades = new THREE.Group();
            for (let i = 0; i < 3; i++) { const bl = box(Math.min(w, dd) * 0.45, 0.05, 0.4, d.color ? candy(i % 2 ? '#ffffff' : d.color, 0.3) : tex.metal, 0.25); bl.position.x = Math.min(w, dd) * 0.22; const g = new THREE.Group(); g.rotation.y = (i * Math.PI * 2) / 3; g.add(bl); blades.add(g); }
            inner.add(blades);
            (dv as unknown as { blades: THREE.Group }).blades = blades;
            const air = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, dd) / 2, Math.min(w, dd) / 2, h, 20, 1, true), new THREE.MeshBasicMaterial({ color: '#cfefff', transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
            air.position.y = h / 2; inner.add(air);
          }
          if (d.dir === 'forward') { inner.rotation.x = Math.PI / 2; }
          break;
        }
        case 'lowgrav': {
          if (look) { const air = box(w, h, dd, new THREE.MeshBasicMaterial({ color: '#b48cff', transparent: true, opacity: 0.07, depthWrite: false }), h / 2); air.castShadow = false; inner.add(air); }
          break;
        }
        case 'zipline': {
          const a = new THREE.Vector3(...d.p), b = new THREE.Vector3(...(d.b ?? d.p));
          const L = a.distanceTo(b);
          const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, L, 6), cable);
          c.position.copy(a).add(b).multiplyScalar(0.5).sub(a);
          c.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize());
          inner.add(c);
          for (const e of [new THREE.Vector3(), b.clone().sub(a)]) { const post = box(0.3, 3, 0.3, d.color ? candy(d.color, 0.3) : tex.yellow, e.y - 1.5 + 0.3); post.position.x = e.x; post.position.z = e.z; inner.add(post); }
          dv.q.identity();
          break;
        }
        case 'cannon': {
          if (look) {
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 2.4, 18, 1, true), d.color ? new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.35, side: THREE.DoubleSide }) : new THREE.MeshStandardMaterial({ map: CT.metalTex(9, 0, 0, 22), roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide }));
            barrel.rotation.x = Math.PI / 2 - (d.pitch ?? 45) * D2R; barrel.position.y = 0.9; inner.add(barrel);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.12, 8, 24), glow('#ff9a1f', 1.2)); ring.position.y = 0.1; ring.rotation.x = Math.PI / 2; inner.add(ring);
          }
          break;
        }
        case 'drop': {
          // a few crates on a loop: spawn at p, fall `fall` metres, vanish, respawn (staggered)
          const k = 3;
          for (let i = 0; i < k; i++) {
            const g = new THREE.Group();
            if (look) g.add(box(w, h, dd, d.color ? candy(d.color, 0.3) : [tex.yellow, tex.yellow, tex.hazard, tex.metal, tex.yellow, tex.yellow]));
            inner.add(g);
            solid(new THREE.Vector3(w / 2, h / 2, dd / 2), new THREE.Vector3(0, -h / 2, 0));
          }
          break;
        }
        case 'portal': {
          const discs: THREE.Mesh[] = [];
          for (const [p, r] of [[d.p, d.r ?? 0], [d.b ?? d.p, d.rb ?? 0]] as [V3, number][]) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.14, 10, 32), glow(d.color ?? '#7d5cff', 1.8));
            ring.position.set(p[0] - d.p[0], p[1] - d.p[1] + 1.3, p[2] - d.p[2]); ring.rotation.y = r * D2R; inner.add(ring);
            const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 28), new THREE.MeshBasicMaterial({ color: '#a891ff', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
            disc.position.copy(ring.position); disc.rotation.y = r * D2R; inner.add(disc);
            discs.push(disc);
          }
          (dv as unknown as { discs: THREE.Mesh[] }).discs = discs;
          dv.q.identity();
          break;
        }
        case 'checkpoint': {
          const pole = box(0.12, 2.6, 0.12, tex.metal, 1.3); inner.add(pole);
          const flag = box(0.04, 0.7, 1.1, glow(d.color ?? '#3ddc84', 0.6), 2.25); flag.position.z = 0.55; inner.add(flag);
          (dv as unknown as { flag: THREE.Mesh }).flag = flag;
          break;
        }
        case 'collectible': {
          const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), glow(d.color ?? '#ffd23f', 1.6));
          gem.position.y = 1.0; inner.add(gem);
          (dv as unknown as { gem: THREE.Mesh }).gem = gem;
          break;
        }
      }
      dv.group.position.copy(dv.base);
      dv.group.quaternion.copy(dv.q);
      this.group.add(dv.group);
      this.list.push(dv);
      this.place(dv);
      if (d.t === 'reveal' && !d.tip) { this.enable(dv, false); dv.group.visible = false; }
    }
  }
  private beltTex: THREE.Texture | null = null;

  /** move a device's colliders to its current pose */
  private place(dv: Device) {
    if (dv.d.t === 'drop' || dv.d.t === 'slide') return; // placed per crate in step() / placed once when built
    const q = dv.rotates ? _pq.setFromAxisAngle(Y, dv.ang).premultiply(dv.q) : dv.q;
    const tilt = (dv as unknown as { tiltQ?: THREE.Quaternion }).tiltQ;
    const qq = tilt ? _pq2.copy(dv.q).multiply(tilt) : q;
    _R.x = qq.x; _R.y = qq.y; _R.z = qq.z; _R.w = qq.w;
    for (const b of dv.bodies) {
      const o = _po.copy(b.off).applyQuaternion(qq).add(dv.pos);
      _T.x = o.x; _T.y = o.y; _T.z = o.z;
      b.c.setTranslation(_T);
      b.c.setRotation(_R);
    }
  }

  carrierOf(c: RAPIER.Collider | null | undefined): Carrier | null {
    const dv = c ? this.byHandle.get(c.handle) : undefined;
    if (!dv) return null;
    return ['turntable', 'piston', 'elevator', 'conveyor', 'drop', 'tilt'].includes(dv.d.t) ? dv : null;
  }

  surfaceOf(c: RAPIER.Collider | null | undefined): Surface | null {
    const dv = c ? this.byHandle.get(c.handle) : undefined;
    if (!dv) return null;
    if (dv.d.t === 'slippery') return { grip: dv.d.grip ?? 0.12 };
    if (dv.d.t === 'slide' && dv.slide) return { slide: dv.slide };
    if (dv.d.t === 'trampoline') {
      const pu = dv.d.push ?? 0, r = (dv.d.r ?? 0) * D2R;
      return { bounce: dv.d.bounce ?? 0.9, min: dv.d.min ?? 11, max: dv.d.max ?? 24, ...(pu ? { pushX: Math.sin(r) * pu, pushZ: Math.cos(r) * pu } : {}) };
    }
    return null;
  }

  /** the player (feet at p) stands on collider c this tick */
  stood(c: RAPIER.Collider | null | undefined, p?: THREE.Vector3) {
    const dv = c ? this.byHandle.get(c.handle) : undefined;
    if (!dv) return;
    dv.stoodNow = true;
    if (p && dv.balls) (dv.balls.feet ??= new THREE.Vector3()).copy(p);
    if (p && dv.d.t === 'tilt') (dv as unknown as { side: number }).side = Math.sign(_v.copy(p).sub(dv.base).applyQuaternion(_q.copy(dv.q).invert()).z) || 1;
  }

  /** gravity scale and wind acceleration at p (feet); app 5: wading in a ball pit (a volume, whatever floor is under it) */
  field(p: THREE.Vector3, out: { g: number; acc: THREE.Vector3; soft?: { speed: number; jump: number } | null }) {
    for (const dv of this.list) {
      if (dv.d.t === 'pit') {
        const [w, , dd] = dv.d.s ?? [3, 1, 3], sink = dv.d.sink ?? 0.7;
        const l = _v.copy(p).sub(dv.base).applyQuaternion(_q.copy(dv.q).invert());
        if (Math.abs(l.x) > w / 2 || Math.abs(l.z) > dd / 2 || l.y < -sink - 0.3 || l.y > 0.25) continue;
        out.soft = { speed: dv.d.slow ?? 0.5, jump: dv.d.jump ?? 0.75 };
        dv.stoodNow = true;
        if (dv.balls) (dv.balls.feet ??= new THREE.Vector3()).copy(p);
        continue;
      }
      if (dv.d.t !== 'fan' && dv.d.t !== 'lowgrav') continue;
      if (dv.d.t === 'fan' && !dv.active) continue;
      const S = dv.d.s ?? FAN_DEF, w = S[0], h = S[1], dd = S[2];
      const l = _v.copy(p).sub(dv.base).applyQuaternion(_q.copy(dv.q).invert());
      if (dv.d.t === 'fan' && dv.d.dir === 'forward') {
        // horizontal fan: the stream runs along local +z, h long, w x dd wide
        if (Math.abs(l.x) > w / 2 || l.y < -0.2 || l.y > dd || l.z < 0 || l.z > h) continue;
        const k = 1 - l.z / h * 0.6;
        out.acc.add(_w.set(0, 0, 1).applyQuaternion(dv.q).multiplyScalar((dv.d.force ?? 22) * k));
        continue;
      }
      if (Math.abs(l.x) > w / 2 || Math.abs(l.z) > dd / 2 || l.y < -0.3 || l.y > h) continue;
      if (dv.d.t === 'lowgrav') { out.g = Math.min(out.g, dv.d.g ?? 0.45); continue; }
      out.acc.y += (dv.d.force ?? 52) * (1 - (l.y / h) * 0.7); // fades towards the top of the stream
    }
  }

  /** moving hazards pushing the player (capsule at feet p): displacement + knock-back velocity */
  push(p: THREE.Vector3, out: { d: THREE.Vector3; v: THREE.Vector3 }) {
    let hit = false;
    for (const dv of this.list) {
      if (dv.d.t === 'sweeper') {
        const L = dv.d.radius ?? 4, arms = dv.d.arms ?? 1, barY = dv.base.y + 0.7;
        if (p.y > barY + 0.2 || p.y + 1.8 < barY - 0.2) continue; // jumped over / under it
        const rx = p.x - dv.base.x, rz = p.z - dv.base.z, r = Math.hypot(rx, rz);
        if (r > L + 0.35 || r < 0.5) continue;
        const pa = Math.atan2(rx, rz);
        for (let i = 0; i < arms; i++) {
          const a = dv.ang + (dv.d.r ?? 0) * D2R + (i / arms) * Math.PI * 2;
          let da = mod(pa - a + Math.PI, Math.PI * 2) - Math.PI;
          const side = Math.abs(da) * r;
          if (side > 0.45) continue;
          // the bar sweeps through the player: knock them along its motion
          const sgn = Math.sign(dv.d.speed ?? 90) || 1;
          if (da * sgn > 0.25) continue; // the bar already passed
          const tx = Math.cos(pa) * sgn, tz = -Math.sin(pa) * sgn;
          out.d.x += tx * (0.5 - side); out.d.z += tz * (0.5 - side);
          out.v.set(tx * 9, 7, tz * 9);
          hit = true;
          void da;
        }
      } else if (dv.d.t === 'piston') {
        // a moving block shoves whoever stands in front of it (along its motion); behind it the gap just opens
        if (dv.delta.lengthSq() < 1e-8) continue;
        const md = _w.copy(dv.delta).normalize();
        for (const b of dv.bodies) {
          const t = b.c.translation();
          const l = _v.set(p.x - t.x, p.y + 0.9 - t.y, p.z - t.z).applyQuaternion(_q.copy(dv.q).invert());
          if (Math.abs(l.y) > b.half.y + 0.9 || l.y > b.half.y + 0.5) continue; // above it: carried, not pushed
          const lm = _p.copy(md).applyQuaternion(_q); // motion in the block's frame (unit, along one axis)
          const along = l.x * lm.x + l.z * lm.z, halfAlong = Math.abs(lm.x) * b.half.x + Math.abs(lm.z) * b.half.z;
          const side = Math.abs(lm.x) > 0.5 ? Math.abs(l.z) - b.half.z : Math.abs(l.x) - b.half.x;
          if (along < 0 || side > 0.3) continue;
          const need = halfAlong + 0.32 - along;
          if (need <= 0) continue;
          out.d.addScaledVector(md, need);
          hit = true;
        }
      } else if (dv.d.t === 'drop') {
        for (const b of dv.bodies) {
          const t = b.c.translation();
          const l = _v.set(p.x - t.x, p.y + 0.9 - t.y, p.z - t.z).applyQuaternion(_q.copy(dv.q).invert());
          const ex = b.half.x + 0.3 - Math.abs(l.x), ey = b.half.y + 0.9 - Math.abs(l.y), ez = b.half.z + 0.3 - Math.abs(l.z);
          if (ex <= 0 || ey <= 0 || ez <= 0) continue;
          if (l.y > b.half.y + 0.5) continue; // standing on top: that is carrying, not pushing
          const m = Math.min(ex, ez);
          const dir = m === ex ? _w.set(Math.sign(l.x) || 1, 0, 0) : _w.set(0, 0, Math.sign(l.z) || 1);
          dir.applyQuaternion(dv.q).multiplyScalar(m + 0.02);
          out.d.add(dir);
          if (l.y < 0) out.v.set(dir.x * 6, -4, dir.z * 6); // hit from above: knocked aside
          hit = true;
        }
      }
    }
    return hit;
  }

  /** triggers at p (feet): portals, cannons, ziplines, checkpoints, pickups */
  touch(p: THREE.Vector3, vel: THREE.Vector3, airborne: boolean): DeviceAction | null {
    for (const dv of this.list) {
      const d = dv.d, id = dv.data.id;
      if (d.t === 'portal') {
        if (d.need && this.collectedCount() < d.need) continue; // locked: not enough pickups yet
        const a = dv.base;
        if (Math.hypot(p.x - a.x, p.z - a.z) < 1.0 && p.y > a.y - 0.3 && p.y < a.y + 2.4) {
          const b = new THREE.Vector3(...(d.b ?? d.p));
          return { kind: 'portal', p: b, yaw: (d.rb ?? 0) * D2R, dYaw: ((d.rb ?? 0) - (d.r ?? 0)) * D2R };
        }
      } else if (d.t === 'cannon') {
        if (Math.hypot(p.x - dv.base.x, p.z - dv.base.z) < 0.9 && Math.abs(p.y - dv.base.y) < 1.2) {
          if (dv.stT > 0) continue; // reloading
          dv.stT = 1.2;
          const yaw = (d.r ?? 0) * D2R, pitch = (d.pitch ?? 45) * D2R, v = d.v ?? 20;
          return { kind: 'launch', v: new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * v, Math.sin(pitch) * v, Math.cos(yaw) * Math.cos(pitch) * v) };
        }
      } else if (d.t === 'zipline' && airborne) {
        // run / jump into the cable: grab it if the hands are near it
        const a = dv.base, b = setA(_w, d.b ?? d.p);
        const ab = _v.copy(b).sub(a), L2 = ab.lengthSq();
        const hand = _p.set(p.x, p.y + 2.0, p.z);
        const t = THREE.MathUtils.clamp(_p2.copy(hand).sub(a).dot(ab) / L2, 0, 0.92);
        const c = _p2.copy(a).addScaledVector(ab, t);
        if (c.distanceTo(hand) < 0.6 && vel.y < 4) return { kind: 'zip', a: a.clone(), b: b.clone(), speed: d.speed ?? 10, id };
      } else if (d.t === 'checkpoint') {
        if (!this.used.has(id) && Math.hypot(p.x - dv.base.x, p.z - dv.base.z) < 1.2 && Math.abs(p.y - dv.base.y) < 2) {
          this.used.add(id);
          return { kind: 'checkpoint', p: dv.base.clone(), yaw: (d.r ?? 0) * D2R, id };
        }
      } else if (d.t === 'collectible') {
        if (dv.active && Math.hypot(p.x - dv.base.x, p.z - dv.base.z) < 0.9 && p.y + 1.0 > dv.base.y && p.y < dv.base.y + 1.6) {
          dv.active = false;
          dv.group.visible = false;
          this.used.add(id);
          return { kind: 'collect', id };
        }
      }
    }
    return null;
  }

  /** distance from p to the nearest blowing fan's stream (sound) */
  fanDistance(p: THREE.Vector3) {
    let best = Infinity;
    for (const dv of this.list) {
      if (dv.d.t !== 'fan' || !dv.active) continue;
      const S = dv.d.s ?? FAN_DEF, w = S[0], h = S[1], dd = S[2];
      const l = _v.copy(p).sub(dv.base).applyQuaternion(_q.copy(dv.q).invert());
      const fw = dv.d.dir === 'forward';
      const ex = Math.max(0, Math.abs(l.x) - w / 2), ey = fw ? Math.max(0, -l.y, l.y - dd) : Math.max(0, -l.y, l.y - h), ez = fw ? Math.max(0, -l.z, l.z - h) : Math.max(0, Math.abs(l.z) - dd / 2);
      best = Math.min(best, Math.hypot(ex, ey, ez));
    }
    return best;
  }

  /** pickups (collectible) of this map collected so far */
  collectedCount() { let n = 0; for (const id of this.used) if (this.byId.get(id)?.d.t === 'collectible') n++; return n; }

  /** a pickup collected in an earlier session stays collected */
  markCollected(ids: Iterable<string>) {
    for (const id of ids) { const dv = this.byId.get(id); if (dv && dv.d.t === 'collectible') { dv.active = false; dv.group.visible = false; this.used.add(id); } }
  }

  /** Advance every device to simulation time t (fixed tick dt). `feetY`: the player's feet (one-way platforms). */
  step(t: number, dt: number, feetY = -1e9, rising = false) {
    for (const dv of this.list) {
      const d = dv.d;
      dv.prev.copy(dv.pos);
      const prevAng = dv.ang;
      const stood = dv.stoodNow;
      dv.stoodNow = false;
      if (d.t === 'trampoline' && dv.inner) {
        // the cap squashes when it throws you, then wobbles back (look only, the collider stays put)
        if (stood && !dv.wasStood) dv.squash = 0;
        dv.wasStood = stood;
        if (dv.squash >= 0) {
          dv.squash += dt;
          const u = dv.squash, H = d.s?.[1] ?? 0.5;
          const k = u < 0.07 ? 1 - 0.28 * (u / 0.07) : u < 0.7 ? 1 + 0.16 * Math.exp(-(u - 0.07) * 6) * Math.sin((u - 0.07) * 24) - 0.28 * Math.max(0, 1 - (u - 0.07) / 0.06) : 1;
          const wk = 1 / Math.sqrt(Math.max(0.5, k));
          dv.inner.scale.set(wk, k, wk);
          dv.inner.position.y = -H * (1 - k);
          if (u >= 0.7) { dv.squash = -1; dv.inner.scale.set(1, 1, 1); dv.inner.position.y = 0; }
        }
      }
      dv.stoodT = stood ? dv.stoodT + dt : 0;
      switch (d.t) {
        case 'crumble': {
          // 0 solid, 1 shaking (stood on), 2 fallen, back to 0 after respawn
          if (dv.st === 0 && stood) { dv.st = 1; dv.stT = 0; this.events.push({ k: 'crack', id: dv.data.id, p: dv.base.clone() }); }
          dv.stT += dt;
          if (dv.st === 1) {
            const k = dv.stT / (d.delay ?? 0.8);
            dv.group.position.set(dv.base.x + Math.sin(dv.stT * 60) * 0.04 * k, dv.base.y, dv.base.z);
            if (k >= 1) { dv.st = 2; dv.stT = 0; this.enable(dv, false); }
          } else if (dv.st === 2) {
            dv.group.position.y = dv.base.y - Math.min(30, 0.5 * 30 * dv.stT * dv.stT);
            if (dv.stT > (d.respawn ?? 3)) { dv.st = 0; dv.stT = 0; dv.group.position.copy(dv.base); this.enable(dv, true); }
          }
          dv.group.visible = dv.st !== 2 || dv.stT < 1.2 || dv.stT > (d.respawn ?? 3) - 0.01;
          continue;
        }
        case 'blink': {
          const on = d.on ?? 2, off = d.off ?? 1.5, u = mod(t + (d.phase ?? 0), on + off);
          const solid = u < on;
          if (solid !== dv.active) this.enable(dv, solid);
          // warning: flicker during the last 0.5 s before vanishing
          dv.group.visible = solid && !(u > on - 0.5 && Math.floor(u * 12) % 2 === 0) || (!solid && false);
          continue;
        }
        case 'conveyor': {
          // a surface that carries: the "delta" is the belt speed along local +z, the box itself stays put
          dv.delta.set(0, 0, (d.speed ?? 3) * dt).applyQuaternion(dv.q);
          if (this.beltTex) this.beltTex.offset.y = mod(t * (d.speed ?? 3) * 0.25, 1);
          continue;
        }
        case 'turntable': {
          dv.ang = (t + (d.phase ?? 0)) * (d.speed ?? 30) * D2R;
          dv.dAng = dv.ang - prevAng;
          dv.group.quaternion.copy(dv.q).multiply(_q.setFromAxisAngle(Y, dv.ang));
          dv.delta.set(0, 0, 0);
          this.place(dv);
          continue;
        }
        case 'tilt': {
          // leans towards the side the player stands on, springs back when empty
          const max = (d.maxAngle ?? 14) * D2R;
          const st = dv as unknown as { tilt: number; side: number; tiltQ: THREE.Quaternion };
          st.tilt ??= 0;
          let target = stood ? Math.sign(st.side || 1) * max : 0, rate = 1.2;
          if (d.sway) { target = max * Math.sin((2 * Math.PI * (t + (d.phase ?? 0))) / d.sway) + (stood ? Math.sign(st.side || 1) * max * 0.4 : 0); rate = 2.5; }
          else if (d.fold) { target = stood && dv.stoodT > d.fold ? max : 0; rate = stood ? 0.6 : 1.0; }
          st.tilt += THREE.MathUtils.clamp(target - st.tilt, -rate * dt, rate * dt);
          (st.tiltQ ??= new THREE.Quaternion()).setFromAxisAngle(_x, st.tilt);
          dv.group.quaternion.copy(dv.q).multiply(st.tiltQ);
          this.place(dv);
          dv.delta.set(0, 0, 0);
          continue;
        }
        case 'piston': {
          // ping-pong along local +z (or driven by a plate: out while the plate is held)
          const stroke = d.stroke ?? 3, per = d.period ?? 4, w8 = d.wait ?? 0.8;
          let u: number;
          if (d.target === 'plate') { dv.stT = THREE.MathUtils.clamp(dv.stT + (dv.active ? dt : -dt) / 0.8, 0, 1); u = smooth(dv.stT); }
          else {
            const tau = mod(t + (d.phase ?? 0), per), m = (per - 2 * w8) / 2;
            u = tau < w8 ? 0 : tau < w8 + m ? smooth((tau - w8) / m) : tau < 2 * w8 + m ? 1 : 1 - smooth((tau - 2 * w8 - m) / m);
          }
          dv.pos.copy(dv.base).add(_v.set(0, 0, stroke * u).applyQuaternion(dv.q));
          break;
        }
        case 'elevator': {
          // waits at the bottom until stood on, rides up, waits, comes back down
          const a = dv.base, b = setA(_w, d.b ?? d.p), L = a.distanceTo(b), sp = d.speed ?? 2.5, wt = d.wait ?? 2;
          if (dv.st === 0 && (stood && dv.stoodT > 0.4 || dv.active === false)) { dv.st = 1; dv.stT = 0; dv.active = true; }
          dv.stT += dt;
          const dur = Math.max(0.5, (L / sp) * 1.5);
          let u = 0;
          if (dv.st === 1) { u = smooth(Math.min(1, dv.stT / dur)); if (dv.stT >= dur) { dv.st = 2; dv.stT = 0; } }
          else if (dv.st === 2) { u = 1; if (dv.stT >= wt && !stood) { dv.st = 3; dv.stT = 0; } }
          else if (dv.st === 3) { u = 1 - smooth(Math.min(1, dv.stT / dur)); if (dv.stT >= dur) { dv.st = 0; dv.stT = 0; } }
          dv.pos.copy(a).lerp(b, u);
          break;
        }
        case 'drop': {
          // staggered crates falling `fall` m at `speed`, one every `interval` s (deterministic in t)
          const per = d.interval ?? 2.5, sp = d.speed ?? 6, fall = d.fall ?? 12, k = dv.bodies.length, cyc = fall / sp + 0.6;
          const g = dv.group.children[0] as THREE.Group;
          dv.delta.set(0, -sp * dt, 0);
          dv.bodies.forEach((b, i) => {
            const u = mod(t + (d.phase ?? 0) - i * per, Math.max(per * k, cyc));
            const y = u < 0.6 ? 0 : -(u - 0.6) * sp; // a short hold at the top (the warning), then the fall
            const live = u < cyc;
            const o = _v.set(0, y, 0).add(dv.base);
            const c = live ? o : _v.set(0, -10000, 0);
            _T.x = c.x; _T.y = c.y - (dv.d.s?.[1] ?? 1) / 2; _T.z = c.z;
            b.c.setTranslation(_T);
            const crate = g.children[i];
            if (crate) { crate.position.set(0, y, 0); crate.visible = live; }
          });
          continue;
        }
        case 'sweeper': {
          dv.ang = (t + (d.phase ?? 0)) * (d.speed ?? 90) * D2R;
          dv.group.quaternion.copy(dv.q).multiply(_q.setFromAxisAngle(Y, dv.ang));
          continue;
        }
        case 'fan': {
          const on = d.on ?? 0, off = d.off ?? 0;
          dv.active = on <= 0 || mod(t + (d.phase ?? 0), on + off) < on;
          const bl = (dv as unknown as { blades?: THREE.Group }).blades;
          if (bl) bl.rotation.y += (dv.active ? 18 : 2) * dt;
          continue;
        }
        case 'oneway': {
          // solid only for someone above its top: jump up through it from below
          const top = dv.base.y;
          const want = feetY > top - 0.25 && !rising;
          if (want !== dv.active) this.enable(dv, want);
          continue;
        }
        case 'reveal': {
          // driven on: after `delay` it rises into place (or lowers flat, a drawbridge); driven off: back again
          const dur = d.dur ?? 0.7;
          dv.stT = dv.want ? dv.stT + dt : 0;
          dv.u = THREE.MathUtils.clamp(dv.u + ((dv.want && dv.stT >= (d.delay ?? 0)) ? dt : -dt) / dur, 0, 1);
          const k = smooth(dv.u);
          if (d.tip) {
            const tq = dv as unknown as { tiltQ?: THREE.Quaternion };
            (tq.tiltQ ??= new THREE.Quaternion()).setFromAxisAngle(_x, -(d.tip * D2R) * (1 - k));
            dv.group.quaternion.copy(dv.q).multiply((dv as unknown as { tiltQ: THREE.Quaternion }).tiltQ);
          } else {
            const r = d.rise ?? RISE_DEF;
            dv.pos.copy(dv.base).add(_v.set(r[0], r[1], r[2]).applyQuaternion(dv.q).multiplyScalar(1 - k));
            if (dv.inner) dv.inner.scale.setScalar(0.35 + 0.65 * k);
            dv.group.visible = dv.u > 0.001;
            const on = dv.u > 0.55;
            if (on !== dv.active) this.enable(dv, on);
          }
          break;
        }
        case 'pit': {
          const B = dv.balls;
          if (!B) continue;
          let fx = 1e9, fz = 1e9;
          if (stood && B.feet) { const l = _v.copy(B.feet).sub(dv.base).applyQuaternion(_q.copy(dv.q).invert()); fx = l.x; fz = l.z; }
          const mx = B.w / 2 - 0.2, mz = B.d / 2 - 0.2;
          for (const b of B.b) {
            const dx = b.x - fx, dz = b.z - fz, r = Math.hypot(dx, dz);
            if (r < 0.75 && b.y <= 0.001 && b.vy <= 0) { b.vy = 2 + Math.random() * 1.6; b.vx = (dx / (r || 1)) * 1.6; b.vz = (dz / (r || 1)) * 1.6; }
            if (b.y > 0 || b.vy > 0) {
              b.vy -= 14 * dt; b.y += b.vy * dt; b.x += b.vx * dt; b.z += b.vz * dt;
              if (b.y <= 0) { b.y = 0; b.vy = b.vy < -1.5 ? -b.vy * 0.35 : 0; b.vx *= 0.5; b.vz *= 0.5; }
            }
            b.x = THREE.MathUtils.clamp(b.x, -mx, mx); b.z = THREE.MathUtils.clamp(b.z, -mz, mz);
          }
          this.ballPose(dv);
          continue;
        }
        case 'cannon': dv.stT = Math.max(0, dv.stT - dt); continue;
        case 'portal': { const ds = (dv as unknown as { discs?: THREE.Mesh[] }).discs; if (ds && d.need) { const open = this.collectedCount() >= d.need; for (const m of ds) m.visible = open; } continue; }
        case 'collectible': { const gem = (dv as unknown as { gem?: THREE.Mesh }).gem; if (gem) { gem.rotation.y = t * 2.2; gem.position.y = 1.0 + Math.sin(t * 2.4) * 0.12; } continue; }
        default: continue;
      }
      dv.delta.subVectors(dv.pos, dv.prev);
      dv.group.position.copy(dv.pos);
      this.place(dv);
    }
    // plates drive their targets (app 5: a latched plate stays on for good, a puzzle's plates go in order)
    const drive = new Map<string, boolean>();
    for (const dv of this.list) {
      const d = dv.d;
      if (d.t !== 'plate') continue;
      const pressed = dv.stoodT > 0, edge = pressed && dv.stoodT <= dt * 1.5;
      let on: boolean;
      if (d.puzzle) {
        if (edge) this.puzzlePress(dv);
        on = dv.latched;
      } else if (d.latch) {
        if (edge && !dv.latched) { dv.latched = true; this.events.push({ k: 'latch', id: dv.data.id, p: dv.base.clone() }); }
        dv.lit = dv.latched;
        on = dv.latched;
      } else {
        if (pressed) dv.stT = d.hold ?? 3;
        dv.stT = Math.max(0, dv.stT - dt);
        on = dv.stT > 0;
      }
      dv.group.position.y = dv.base.y - (on || pressed || dv.lit ? 0.08 : 0);
      if (dv.lamp) dv.lamp.emissiveIntensity = dv.lit ? 2.2 : 0.15;
      if (d.target) drive.set(d.target, (drive.get(d.target) ?? false) || on);
    }
    for (const [key, on] of drive) for (const tg of this.targets(key)) {
      if (tg.d.t === 'piston') { tg.d.target = 'plate'; tg.active = on; }
      else if (tg.d.t === 'elevator') { if (on && tg.st === 0) tg.active = false; } // calls it
      else if (tg.d.t === 'reveal') tg.want = on;
    }
  }

  /** plate puzzle: the next plate in order lights up, a wrong one puts them all out (the first one starts again) */
  private puzzlePress(dv: Device) {
    const P = dv.d.puzzle!;
    const all = this.list.filter((x) => x.d.t === 'plate' && x.d.puzzle === P);
    if (dv.lit || all.some((x) => x.latched)) return;
    const next = all.filter((x) => x.lit).length + 1, k = dv.d.order ?? 1;
    if (k === next) {
      dv.lit = true;
      if (next >= all.length) { for (const x of all) { x.latched = true; x.lit = true; } this.events.push({ k: 'latch', id: P, p: dv.base.clone() }); }
      else this.events.push({ k: 'press', id: dv.data.id, p: dv.base.clone() });
    } else {
      for (const x of all) x.lit = false;
      if (k === 1) dv.lit = true;
      this.events.push({ k: 'bad', id: dv.data.id, p: dv.base.clone() });
    }
  }

  /** devices a plate's target names (an id, or a group) */
  private targets(key: string) { const one = this.byId.get(key); return one ? [one] : this.list.filter((x) => x.d.grp === key); }

  /** plate events since the last call (the game plays sounds and saves latches) */
  events: DeviceEvent[] = [];
  drainEvents() { const e = this.events; this.events = []; return e; }

  /** plates / puzzles latched in an earlier session (plate or puzzle ids): on, and what they open is already there */
  markLatched(ids: Iterable<string>) {
    const set = new Set(ids);
    for (const dv of this.list) {
      if (dv.d.t !== 'plate' || !(set.has(dv.data.id) || (dv.d.puzzle && set.has(dv.d.puzzle)))) continue;
      dv.latched = dv.lit = true;
      if (dv.d.target) for (const tg of this.targets(dv.d.target)) if (tg.d.t === 'reveal') { tg.want = true; tg.u = 1; tg.stT = 1e3; }
    }
  }

  private ballPose(dv: Device) {
    const B = dv.balls!;
    B.b.forEach((b, i) => { _m.makeTranslation(b.x, b.y + 0.02, b.z); B.m.setMatrixAt(i, _m); });
    B.m.instanceMatrix.needsUpdate = true;
  }

  private enable(dv: Device, on: boolean) {
    dv.active = on;
    for (const b of dv.bodies) b.c.setEnabled(on);
  }

  reset(t: number) { for (const dv of this.list) { dv.st = 0; dv.stT = 0; dv.stoodT = 0; if (dv.d.t !== 'collectible') this.enable(dv, true); dv.group.visible = dv.d.t !== 'collectible' || dv.active; } this.step(t, 1 / 60); }
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _p = new THREE.Vector3(), _p2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _x = new THREE.Vector3(1, 0, 0);
// scratch objects for the per-frame code (no garbage: see docs/PERFORMANCE.md)
const _pq = new THREE.Quaternion(), _pq2 = new THREE.Quaternion(), _po = new THREE.Vector3();
const _T = { x: 0, y: 0, z: 0 }, _R = { x: 0, y: 0, z: 0, w: 1 };
const RISE_DEF: [number, number, number] = [0, -3, 0];
const FAN_DEF: [number, number, number] = [3, 8, 3];
const setA = (v: THREE.Vector3, a: ArrayLike<number>) => v.set(a[0], a[1], a[2]);
const _m = new THREE.Matrix4();

/** a layer of plastic balls seen from above (ball pit surface) */
function ballTex(pal: string[], rx: number, rz: number) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e4f5'; g.fillRect(0, 0, 256, 256);
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 420; i++) {
    const x = rnd() * 256, y = rnd() * 256, r = 9 + rnd() * 3, col = pal[i % pal.length];
    for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
      const gr = g.createRadialGradient(x + ox - r * 0.35, y + oy - r * 0.35, r * 0.1, x + ox, y + oy, r);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, col); gr.addColorStop(1, col);
      g.fillStyle = gr; g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, rz);
  return t;
}
