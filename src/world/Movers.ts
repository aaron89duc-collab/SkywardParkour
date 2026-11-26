import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { MoverData } from './MapTypes';
import type { Kick } from './Devices';
import { Physics } from '../core/Physics';
import { Assets, bakedGeometry, lod0Mesh } from '../core/Assets';
import { COLLISION } from '../config';
import * as CT from './CityTextures';

const Y = new THREE.Vector3(0, 1, 0);
const _ax = new THREE.Vector3();
const smooth = (t: number) => t * t * (3 - 2 * t);
const D2R = Math.PI / 180;

/** reference points of the models movers are drawn with (normalised model units, see devtools/out/measure.mjs) */
const HANG = { roof: 0.37, hook: 1.0, hx: 0.354, hz: 0.195 }; // hanging_container (Map 003): body + slings + hook
const PALLET = { top: 0.99, hx: 0.878, hz: 0.855 }; // cargo_pallet_stand
/** lift_car (cut out of lift_tower): deck top and its centre in the tower's frame */
const LIFTCAR = { deck: 0.43, cx: -0.005, cz: 0.12, hx: 0.18, hz: 0.13 };
/** trolley_car (rail_trolley without the rail ends): grate deck, railing on +z and the ends, carriage overhead */
const TROLLEY = { deck: 0.12, hx: 0.62, z0: -0.35, z1: 0.33, rail: 0.36, ov0: 0.62, ov1: 0.98, ovz0: -0.1, ovz1: 0.08 };
/** crane_jib: slewing-ring axis, walkway (top, sideways band, length band) and the cab block (normalised units) */
const JIB = { px: 0.785, pz: 0.04, walk: 0.54, wz0: 0.09, wz1: 0.335, wx0: -1.28, wx1: 0.4, cab: [0.4, 1.32, -0.49, 0.49, 0, 1.0] };

/**
 * A moving platform: parentless colliders moved every fixed tick (deterministic: position = f(simTime)),
 * so the player controller and the physics bot see exactly the same motion.
 */
export class Mover {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly delta = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly group = new THREE.Group();
  colliders: { c: RAPIER.Collider; off: THREE.Vector3; q: THREE.Quaternion }[] = [];
  private pts: THREE.Vector3[];
  private cum: number[] = [0];
  private len = 0;
  private moveDur = 1;
  readonly cycle: number;
  // crane extras
  trolley: THREE.Object3D | null = null;
  cable: THREE.Mesh | null = null;
  private hookY = 2.6;
  // swing
  private pivot = new THREE.Vector3();
  private swingDir = new THREE.Vector3(0, 0, 1);
  /** hoist cable from a fixed point to the load (swing, lift) */
  private ropeTop: THREE.Vector3 | null = null;
  // rotor: jib angle (radians, yaw) and its change during the last tick
  readonly rotates: boolean;
  ang = 0;
  private prevAng = 0;
  dAng = 0;
  private center = new THREE.Vector3();
  /** swing angle now and one tick ago (the tilted look interpolates it) */
  private th = 0;
  private prevTh = 0;
  /** app 5: a swing seat throws you off with its momentum */
  readonly kick: Kick | null;

  constructor(public data: MoverData) {
    this.kick = data.kind === 'swing' && data.kick ? { k: data.kick, max: data.vmax ?? 14 } : null;
    this.rotates = data.kind === 'rotor';
    this.pts = data.pts.map((p) => new THREE.Vector3(...p));
    if (data.kind === 'swing') {
      this.pivot.set(...(data.pivot ?? data.pts[0]));
      const r = (data.r ?? 0) * D2R;
      this.swingDir.set(Math.sin(r), 0, Math.cos(r));
      this.cycle = data.period ?? 6;
    } else if (data.kind === 'rotor') {
      this.center.set(...(data.center ?? data.pts[0]));
      const sweep = Math.abs((data.a1 ?? 90) - (data.a0 ?? 0));
      this.moveDur = Math.max(0.5, (sweep / Math.max(1, data.speed)) * 1.5);
      this.cycle = 2 * (this.moveDur + data.wait);
    } else {
      for (let i = 1; i < this.pts.length; i++) { this.len += this.pts[i].distanceTo(this.pts[i - 1]); this.cum.push(this.len); }
      // smoothstep easing peaks at 1.5x the average speed -> stretch the duration so the peak equals `speed`
      this.moveDur = Math.max(0.5, (this.len / Math.max(0.1, data.speed)) * 1.5);
      this.cycle = 2 * (this.moveDur + data.wait);
    }
    this.sample(0, this.pos);
    this.prev.copy(this.pos);
    this.ang = this.prevAng = this.angleAt(0);
  }

  /** u in [0,1] along the path (arc length) */
  private along(u: number, out: THREE.Vector3) {
    const d = u * this.len;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i];
    const segLen = this.cum[i] - this.cum[i - 1];
    return out.lerpVectors(a, b, segLen > 1e-6 ? (d - this.cum[i - 1]) / segLen : 0);
  }

  /** Ping-pong progress 0..1 with waits at both ends, smoothstep in between. */
  private pingPong(t: number) {
    const w = this.data.wait, m = this.moveDur;
    let tau = (t + (this.data.phase ?? 0)) % this.cycle;
    if (tau < 0) tau += this.cycle;
    if (tau < w) return 0;
    if (tau < w + m) return smooth((tau - w) / m);
    if (tau < 2 * w + m) return 1;
    return 1 - smooth((tau - 2 * w - m) / m);
  }

  /** swing angle (radians) at time t */
  private theta(t: number) {
    const T = this.cycle;
    return (this.data.amp ?? 15) * D2R * Math.sin((2 * Math.PI * (t + (this.data.phase ?? 0))) / T);
  }

  /** rotor jib yaw (radians) at time t */
  angleAt(t: number) {
    if (!this.rotates) return 0;
    const a0 = (this.data.a0 ?? 0) * D2R, a1 = (this.data.a1 ?? 90) * D2R;
    return a0 + (a1 - a0) * this.pingPong(t);
  }

  /** Reference position at simulation time t: platform top-centre (rotor: the jib tip, walkway top). */
  sample(t: number, out: THREE.Vector3) {
    if (this.data.kind === 'swing') {
      const th = this.theta(t), L = this.data.len ?? 10;
      return out.copy(this.pivot).addScaledVector(this.swingDir, Math.sin(th) * L).setY(this.pivot.y - Math.cos(th) * L);
    }
    if (this.rotates) {
      const a = this.angleAt(t), L = this.data.arm ?? 8, o = this.data.off ?? 0;
      const c = Math.cos(a), sn = Math.sin(a);
      return out.set(this.center.x + o * c + L * sn, this.center.y, this.center.z - o * sn + L * c);
    }
    return this.along(this.pingPong(t), out);
  }

  /**
   * Seconds until the platform next stops at end k (0 = first point, 1 = last point) and how long it stays.
   * A swing never stops: its "stops" are the moments around each extreme (|swing| > 95 % of the amplitude).
   */
  nextPark(t: number, k: 0 | 1) {
    if (this.data.kind === 'swing') {
      const T = this.cycle;
      const u = ((((t + (this.data.phase ?? 0)) / T) % 1) + 1) % 1;
      const c = k === 1 ? 0.25 : 0.75, w = Math.acos(0.95) / (2 * Math.PI);
      if (Math.abs(u - c) <= w) return { in: 0, stay: (c + w - u) * T };
      return { in: ((((c - w - u) % 1) + 1) % 1) * T, stay: 2 * w * T };
    }
    const w = this.data.wait, m = this.moveDur;
    const tau = (((t + (this.data.phase ?? 0)) % this.cycle) + this.cycle) % this.cycle;
    const start = k === 0 ? 0 : w + m;
    let dt = start - tau;
    if (dt < -w) dt += this.cycle;
    return { in: Math.max(0, dt), stay: w + Math.min(0, dt) };
  }

  private placeColliders() {
    const q = new THREE.Quaternion(), o = new THREE.Vector3();
    if (this.rotates) q.setFromAxisAngle(Y, this.ang);
    for (const { c, off, q: lq } of this.colliders) {
      if (this.rotates) {
        o.copy(off).applyQuaternion(q).add(this.center);
        const r = q.clone().multiply(lq);
        c.setTranslation({ x: o.x, y: o.y, z: o.z });
        c.setRotation({ x: r.x, y: r.y, z: r.z, w: r.w });
      } else c.setTranslation({ x: this.pos.x + off.x, y: this.pos.y + off.y, z: this.pos.z + off.z });
    }
  }

  step(t: number, dt: number) {
    this.prev.copy(this.pos);
    this.sample(t, this.pos);
    this.delta.subVectors(this.pos, this.prev);
    this.vel.copy(this.delta).divideScalar(Math.max(1e-4, dt));
    if (this.data.kind === 'swing') { this.prevTh = this.th; this.th = this.theta(t); }
    if (this.rotates) { this.prevAng = this.ang; this.ang = this.angleAt(t); this.dAng = this.ang - this.prevAng; }
    this.placeColliders();
  }

  /** Teleport without producing a carry delta (start / restart). */
  reset(t: number) {
    this.sample(t, this.pos);
    this.prev.copy(this.pos);
    this.delta.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    if (this.data.kind === 'swing') this.th = this.prevTh = this.theta(t);
    if (this.rotates) { this.ang = this.prevAng = this.angleAt(t); this.dAng = 0; }
    this.placeColliders();
  }

  /** How far something standing at p was carried during the last tick (rotor: turned about its axis). */
  carryAt(p: THREE.Vector3, out = new THREE.Vector3()) {
    if (!this.rotates) return out.copy(this.delta);
    const dx = p.x - this.center.x, dz = p.z - this.center.z;
    const c = Math.cos(this.dAng), s = Math.sin(this.dAng);
    return out.set(dx * c + dz * s - dx, 0, -dx * s + dz * c - dz);
  }

  /** Velocity of the platform surface at p (given to the player when jumping off). */
  velAt(p: THREE.Vector3, dt: number, out = new THREE.Vector3()) {
    if (!this.rotates) return out.copy(this.vel);
    return this.carryAt(p, out).divideScalar(Math.max(1e-4, dt));
  }

  syncVisual(alpha: number) {
    this.group.position.lerpVectors(this.prev, this.pos, alpha);
    if (this.rotates) {
      this.group.position.copy(this.center);
      this.group.rotation.y = this.prevAng + (this.ang - this.prevAng) * alpha;
    }
    if (this.data.kind === 'swing' && this.data.tilt) {
      // the seat turns with its chains about the pivot axis (horizontal, across the swing plane)
      const th = (this.prevTh + (this.th - this.prevTh) * alpha) * this.data.tilt;
      this.group.quaternion.setFromAxisAngle(_ax.set(this.swingDir.z, 0, -this.swingDir.x), -th);
    }
    const p = this.group.position;
    if (this.trolley && this.cable) {
      const jib = this.data.jib ?? p.y + 10;
      this.trolley.position.set(p.x, jib - 0.35, p.z);
      const top = jib - 0.6, bottom = p.y + this.hookY + 0.45;
      const L = Math.max(0.1, top - bottom);
      this.cable.position.set(p.x, bottom + L / 2, p.z);
      this.cable.scale.set(1, L, 1);
      this.cable.quaternion.identity();
    } else if (this.cable && this.ropeTop) {
      // hoist rope from a fixed point to the load's hook (follows the swing)
      const a = this.ropeTop, b = new THREE.Vector3(p.x, p.y + this.hookY, p.z);
      const L = Math.max(0.05, a.distanceTo(b));
      this.cable.position.copy(a).add(b).multiplyScalar(0.5);
      this.cable.scale.set(1, L, 1);
      this.cable.quaternion.setFromUnitVectors(Y, a.clone().sub(b).normalize());
    }
  }

  setHookHeight(h: number) { this.hookY = h; }
  setRopeTop(p: THREE.Vector3) { this.ropeTop = p.clone(); }
}

/** Builds and steps every moving platform of a map. */
export class MoverSystem {
  movers: Mover[] = [];
  private byHandle = new Map<number, Mover>();
  group = new THREE.Group();

  constructor(private physics: Physics) {
    this.group.name = 'movers';
  }

  /** default model of each look (the map can override any of them: MapData.moverModels) */
  static MODELS = {
    hover: 'assets/map002/hover_platform', pallet: 'assets/map003/cargo_pallet_stand', lift: 'assets/map003/lift_car',
    trolley: 'assets/map003/trolley_car', swing: 'assets/map003/hanging_container', rotor: 'assets/map003/crane_jib',
  } as const;

  async build(list: MoverData[], assets: Assets, models: Partial<Record<keyof typeof MoverSystem.MODELS, string>> = {}) {
    const file = (k: keyof typeof MoverSystem.MODELS) => `${models[k] ?? MoverSystem.MODELS[k]}.glb`;
    const metal = new THREE.MeshStandardMaterial({ map: CT.metalTex(21, 210, 12, 38), roughness: 0.55, metalness: 0.35 });
    const hazard = new THREE.MeshStandardMaterial({ map: CT.hazardTex(), roughness: 0.7 });
    const yellow = new THREE.MeshStandardMaterial({ map: CT.metalTex(12, 45, 80, 52), roughness: 0.5, metalness: 0.2 });
    const cableMat = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.6, metalness: 0.5 });
    // models (node transform baked in: they span their normalised size, base at y = 0)
    const model = async (file: string) => {
      const g = await assets.gltf(file);
      const src = lod0Mesh(g.scene);
      return src ? { geo: bakedGeometry(src), mat: src.material as THREE.Material } : null;
    };
    const need = (pred: (d: MoverData) => boolean) => list.some((d) => !d.model && pred(d)); // a mover with its own model needs no default
    const hover = need((d) => d.kind === 'hover' && (d.look ?? 'hover') === 'hover') ? await model(file('hover')) : null;
    const pallet = need((d) => d.kind === 'hover' && d.look === 'pallet') ? await model(file('pallet')) : null;
    const lift = need((d) => d.kind === 'hover' && d.look === 'lift') ? await model(file('lift')) : null;
    const trolleyM = need((d) => d.kind === 'hover' && d.look === 'trolley') ? await model(file('trolley')) : null;
    const hang = need((d) => d.kind === 'swing') ? await model(file('swing')) : null;
    const jib = need((d) => d.kind === 'rotor') ? await model(file('rotor')) : null;
    const mesh = (m: { geo: THREE.BufferGeometry; mat: THREE.Material } | null, s: number, y: number, yaw = 0) => {
      if (!m) return null;
      const o = new THREE.Mesh(m.geo, m.mat);
      o.scale.setScalar(s);
      o.position.y = y;
      o.rotation.y = yaw;
      o.castShadow = o.receiveShadow = true;
      return o;
    };
    const cable = (mv: Mover, r = 0.045) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 6), cableMat);
      c.castShadow = true;
      this.group.add(c);
      mv.cable = c;
    };
    for (const d of list) {
      const m = new Mover(d);
      const yaw = THREE.MathUtils.degToRad(d.r ?? 0);
      const q = new THREE.Quaternion().setFromAxisAngle(Y, d.kind === 'rotor' ? 0 : yaw);
      /** box collider: half extents and offset in the platform's own frame (rotor: in the jib frame) */
      const addBox = (half: THREE.Vector3, off: THREE.Vector3, localYaw = 0) => {
        const lq = new THREE.Quaternion().setFromAxisAngle(Y, localYaw);
        const o = off.clone().applyQuaternion(q);
        const wq = q.clone().multiply(lq);
        const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w }).setCollisionGroups(COLLISION.WORLD).setFriction(0);
        const c = this.physics.world.createCollider(desc);
        this.physics.colliderCount++;
        m.colliders.push({ c, off: o, q: wq });
        this.byHandle.set(c.handle, m);
      };
      const inner = new THREE.Group();
      inner.quaternion.copy(q);
      m.group.add(inner);
      if (d.model) {
        // data-driven look: GLB + collider boxes from the map file
        const M = d.model, s = M.s ?? d.s ?? 1;
        const src = await model(`${M.file}.glb`).catch(() => null);
        const o = mesh(src, s, (M.off?.[1] ?? 0) * s, ((M.yaw ?? 0) * Math.PI) / 180);
        if (o) { o.position.x = (M.off?.[0] ?? 0) * s; o.position.z = (M.off?.[2] ?? 0) * s; inner.add(o); }
        for (const [cx, cy, cz, hx, hy, hz] of M.boxes) addBox(new THREE.Vector3(hx * s, hy * s, hz * s), new THREE.Vector3(cx * s, cy * s, cz * s));
        if (d.kind === 'swing') { m.setRopeTop(new THREE.Vector3(...(d.pivot ?? d.pts[0]))); if (d.rope !== false) cable(m, 0.06); }
      } else if (d.kind === 'crane') {
        const S = d.s ?? 3.6, T = 0.4;
        const pal = new THREE.Mesh(new THREE.BoxGeometry(S, T, S), [metal, metal, hazard, metal, metal, metal]);
        pal.position.y = -T / 2;
        pal.castShadow = pal.receiveShadow = true;
        inner.add(pal);
        for (const sx of [-1, 1]) {
          const lip = new THREE.Mesh(new THREE.BoxGeometry(S, 0.12, 0.14), hazard);
          lip.position.set(0, 0.06, sx * (S / 2 - 0.07));
          inner.add(lip);
        }
        addBox(new THREE.Vector3(S / 2, T / 2, S / 2), new THREE.Vector3(0, -T / 2, 0));
        // slings to a hook block
        const hookY = 2.6;
        m.setHookHeight(hookY);
        const hook = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.4), yellow);
        hook.position.y = hookY + 0.4;
        hook.castShadow = true;
        inner.add(hook);
        for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const a = new THREE.Vector3((cx * S) / 2 - cx * 0.15, 0.05, (cz * S) / 2 - cz * 0.15), b = new THREE.Vector3(0, hookY, 0);
          const L = a.distanceTo(b);
          const sling = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, L, 5), cableMat);
          sling.position.copy(a).lerp(b, 0.5);
          sling.quaternion.setFromUnitVectors(Y, b.clone().sub(a).normalize());
          inner.add(sling);
        }
        // trolley + hoist cable live in world space (they stay on the jib)
        const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 1.2), yellow);
        trolley.castShadow = true;
        this.group.add(trolley);
        m.trolley = trolley;
        cable(m);
      } else if (d.kind === 'swing') {
        // a level container on its slings; the rope runs up to the pivot (the gantry arm is a static prefab)
        const s = d.s ?? 8;
        const o = mesh(hang, s, -HANG.roof * s, -Math.PI / 2);
        if (o) inner.add(o);
        addBox(new THREE.Vector3(HANG.hz * s, (HANG.roof * s) / 2, HANG.hx * s), new THREE.Vector3(0, -(HANG.roof * s) / 2, 0));
        m.setHookHeight((HANG.hook - HANG.roof) * s);
        m.setRopeTop(new THREE.Vector3(...(d.pivot ?? d.pts[0])));
        cable(m, 0.06);
      } else if (d.kind === 'rotor') {
        // a slewing crane jib turning about its ring: the walkway runs along local +z, offset sideways by `off`
        const s = d.s ?? 5;
        const o = mesh(jib, s, -JIB.walk * s, Math.PI / 2);
        if (o) { o.position.x = -JIB.pz * s; o.position.z = JIB.px * s; inner.add(o); }
        // model (px, py, pz) -> jib frame ((pz - JIB.pz) s, (py - JIB.walk) s, (JIB.px - px) s)
        const lx0 = (JIB.wz0 - JIB.pz) * s, lx1 = (JIB.wz1 - JIB.pz) * s, lz0 = (JIB.px - JIB.wx1) * s, lz1 = (JIB.px - JIB.wx0) * s;
        addBox(new THREE.Vector3((lx1 - lx0) / 2, 0.04 * s, (lz1 - lz0) / 2), new THREE.Vector3((lx0 + lx1) / 2, -0.04 * s, (lz0 + lz1) / 2));
        const [cx0, cx1, cz0, cz1, cy0, cy1] = JIB.cab;
        const bx0 = (cz0 - JIB.pz) * s, bx1 = (cz1 - JIB.pz) * s, bz0 = (JIB.px - cx1) * s, bz1 = (JIB.px - cx0) * s, by0 = (cy0 - JIB.walk) * s, by1 = (cy1 - JIB.walk) * s;
        addBox(new THREE.Vector3((bx1 - bx0) / 2, (by1 - by0) / 2, (bz1 - bz0) / 2), new THREE.Vector3((bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2));
      } else if ((d.look ?? 'hover') === 'pallet') {
        // cargo pallet stand gliding along a rail
        const s = d.s ?? 2;
        const o = mesh(pallet, s, -PALLET.top * s);
        if (o) inner.add(o);
        addBox(new THREE.Vector3(PALLET.hx * s, 0.15 * s, PALLET.hz * s), new THREE.Vector3(0, -0.15 * s, 0));
      } else if (d.look === 'lift') {
        // lift car running up and down the front of a lift tower (the tower is a static prefab)
        const s = d.s ?? 12;
        const o = mesh(lift, s, -LIFTCAR.deck * s);
        if (o) { o.position.x = -LIFTCAR.cx * s; o.position.z = -LIFTCAR.cz * s; inner.add(o); }
        addBox(new THREE.Vector3(LIFTCAR.hx * s, 0.03 * s, LIFTCAR.hz * s), new THREE.Vector3(0, -0.03 * s, 0));
      } else if (d.look === 'trolley') {
        // platform hanging from a trolley on an overhead rail (the rail is static kit): open on its -z side
        const s = d.s ?? 5, T = TROLLEY;
        const o = mesh(trolleyM, s, -T.deck * s);
        if (o) inner.add(o);
        const zc = ((T.z0 + T.z1) / 2) * s, hz = ((T.z1 - T.z0) / 2) * s, rh = (T.rail - T.deck) * s;
        addBox(new THREE.Vector3(T.hx * s, 0.05 * s, hz), new THREE.Vector3(0, -0.05 * s, zc));
        addBox(new THREE.Vector3(T.hx * s, rh / 2, 0.03 * s), new THREE.Vector3(0, rh / 2, (T.z1 - 0.03) * s));
        for (const sx of [-1, 1]) addBox(new THREE.Vector3(0.03 * s, rh / 2, hz), new THREE.Vector3(sx * (T.hx - 0.03) * s, rh / 2, zc));
        addBox(new THREE.Vector3(T.hx * s, ((T.ov1 - T.ov0) / 2) * s, ((T.ovz1 - T.ovz0) / 2) * s), new THREE.Vector3(0, ((T.ov0 + T.ov1) / 2 - T.deck) * s, ((T.ovz0 + T.ovz1) / 2) * s));
      } else {
        const s = d.s ?? 2;
        const o = mesh(hover, s, -0.955 * s);
        if (o) inner.add(o);
        // glowing thrusters
        const glow = new THREE.Mesh(new THREE.CircleGeometry(0.42 * s, 20), new THREE.MeshBasicMaterial({ color: '#7fe7ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.rotation.x = Math.PI / 2;
        glow.position.y = -0.98 * s;
        inner.add(glow);
        addBox(new THREE.Vector3(1.09 * s, 0.17 * s, 0.6 * s), new THREE.Vector3(0, -0.17 * s, 0));
      }
      m.reset(0);
      m.syncVisual(1);
      this.group.add(m.group);
      this.movers.push(m);
    }
  }

  moverOf(c: RAPIER.Collider | null | undefined): Mover | null {
    return c ? this.byHandle.get(c.handle) ?? null : null;
  }

  /** Advance all platforms to simulation time t and refresh the query pipeline. */
  step(t: number, dt: number) {
    if (!this.movers.length) return;
    for (const m of this.movers) m.step(t, dt);
    this.physics.world.updateSceneQueries();
  }

  reset(t: number) {
    for (const m of this.movers) m.reset(t);
    if (this.movers.length) this.physics.world.updateSceneQueries();
  }

  syncVisual(alpha: number) {
    for (const m of this.movers) m.syncVisual(alpha);
  }
}
