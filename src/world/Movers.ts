import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { MoverData } from './MapTypes';
import { Physics } from '../core/Physics';
import { Assets } from '../core/Assets';
import { COLLISION } from '../config';
import * as CT from './CityTextures';

const Y = new THREE.Vector3(0, 1, 0);
const smooth = (t: number) => t * t * (3 - 2 * t);

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
  colliders: { c: RAPIER.Collider; off: THREE.Vector3 }[] = [];
  private pts: THREE.Vector3[];
  private cum: number[] = [0];
  private len = 0;
  private moveDur = 1;
  readonly cycle: number;
  // crane extras
  trolley: THREE.Object3D | null = null;
  cable: THREE.Mesh | null = null;
  private hookY = 2.6;

  constructor(public data: MoverData) {
    this.pts = data.pts.map((p) => new THREE.Vector3(...p));
    for (let i = 1; i < this.pts.length; i++) { this.len += this.pts[i].distanceTo(this.pts[i - 1]); this.cum.push(this.len); }
    // smoothstep easing peaks at 1.5x the average speed -> stretch the duration so the peak equals `speed`
    this.moveDur = Math.max(0.5, (this.len / Math.max(0.1, data.speed)) * 1.5);
    this.cycle = 2 * (this.moveDur + data.wait);
    this.sample(0, this.pos);
    this.prev.copy(this.pos);
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

  /** Path position at simulation time t (seconds). Ping-pong with waits at both ends. */
  sample(t: number, out: THREE.Vector3) {
    const w = this.data.wait, m = this.moveDur;
    let tau = (t + (this.data.phase ?? 0)) % this.cycle;
    if (tau < 0) tau += this.cycle;
    let u: number;
    if (tau < w) u = 0;
    else if (tau < w + m) u = smooth((tau - w) / m);
    else if (tau < 2 * w + m) u = 1;
    else u = 1 - smooth((tau - 2 * w - m) / m);
    return this.along(u, out);
  }

  /** Seconds until the platform next parks at end k (0 = first point, 1 = last point) and how long it stays. */
  nextPark(t: number, k: 0 | 1) {
    const w = this.data.wait, m = this.moveDur;
    const tau = (((t + (this.data.phase ?? 0)) % this.cycle) + this.cycle) % this.cycle;
    const start = k === 0 ? 0 : w + m;
    let dt = start - tau;
    if (dt < -w) dt += this.cycle;
    return { in: Math.max(0, dt), stay: w + Math.min(0, dt) };
  }

  step(t: number, dt: number) {
    this.prev.copy(this.pos);
    this.sample(t, this.pos);
    this.delta.subVectors(this.pos, this.prev);
    this.vel.copy(this.delta).divideScalar(Math.max(1e-4, dt));
    for (const { c, off } of this.colliders) c.setTranslation({ x: this.pos.x + off.x, y: this.pos.y + off.y, z: this.pos.z + off.z });
  }

  /** Teleport without producing a carry delta (start / restart). */
  reset(t: number) {
    this.sample(t, this.pos);
    this.prev.copy(this.pos);
    this.delta.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    for (const { c, off } of this.colliders) c.setTranslation({ x: this.pos.x + off.x, y: this.pos.y + off.y, z: this.pos.z + off.z });
  }

  syncVisual(alpha: number) {
    this.group.position.lerpVectors(this.prev, this.pos, alpha);
    if (this.trolley && this.cable) {
      const p = this.group.position;
      const jib = this.data.jib ?? p.y + 10;
      this.trolley.position.set(p.x, jib - 0.35, p.z);
      const top = jib - 0.6, bottom = p.y + this.hookY + 0.45;
      const L = Math.max(0.1, top - bottom);
      this.cable.position.set(p.x, bottom + L / 2, p.z);
      this.cable.scale.set(1, L, 1);
    }
  }

  setHookHeight(h: number) { this.hookY = h; }
}

/** Builds and steps every moving platform of a map. */
export class MoverSystem {
  movers: Mover[] = [];
  private byHandle = new Map<number, Mover>();
  group = new THREE.Group();

  constructor(private physics: Physics) {
    this.group.name = 'movers';
  }

  async build(list: MoverData[], assets: Assets) {
    const metal = new THREE.MeshStandardMaterial({ map: CT.metalTex(21, 210, 12, 38), roughness: 0.55, metalness: 0.35 });
    const hazard = new THREE.MeshStandardMaterial({ map: CT.hazardTex(), roughness: 0.7 });
    const yellow = new THREE.MeshStandardMaterial({ map: CT.metalTex(12, 45, 80, 52), roughness: 0.5, metalness: 0.2 });
    const cableMat = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.6, metalness: 0.5 });
    const crate = list.some((m) => m.kind === 'crane') ? await assets.gltf('assets/map002/wooden_crate.glb') : null;
    const hover = list.some((m) => m.kind === 'hover') ? await assets.gltf('assets/map002/hover_platform.glb') : null;
    const lod0 = (g: { scene: THREE.Object3D }) => {
      let mesh: THREE.Mesh | null = null;
      g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && !/lod1/i.test(o.name) && !/lod1/i.test(o.parent?.name ?? '') && !mesh) mesh = o as THREE.Mesh; });
      return mesh as THREE.Mesh | null;
    };
    for (const d of list) {
      const m = new Mover(d);
      const yaw = THREE.MathUtils.degToRad(d.r ?? 0);
      const q = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
      const addBox = (half: THREE.Vector3, off: THREE.Vector3) => {
        const o = off.clone().applyQuaternion(q);
        const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(COLLISION.WORLD).setFriction(0);
        const c = this.physics.world.createCollider(desc);
        this.physics.colliderCount++;
        m.colliders.push({ c, off: o });
        this.byHandle.set(c.handle, m);
      };
      const inner = new THREE.Group();
      inner.quaternion.copy(q);
      m.group.add(inner);
      if (d.kind === 'crane') {
        const S = d.s ?? 3.6, T = 0.4;
        const pallet = new THREE.Mesh(new THREE.BoxGeometry(S, T, S), [metal, metal, hazard, metal, metal, metal]);
        pallet.position.y = -T / 2;
        pallet.castShadow = pallet.receiveShadow = true;
        inner.add(pallet);
        for (const sx of [-1, 1]) {
          const lip = new THREE.Mesh(new THREE.BoxGeometry(S, 0.12, 0.14), hazard);
          lip.position.set(0, 0.06, sx * (S / 2 - 0.07));
          inner.add(lip);
        }
        addBox(new THREE.Vector3(S / 2, T / 2, S / 2), new THREE.Vector3(0, -T / 2, 0));
        // a crate strapped to one corner (also solid: a step up / something to hide behind)
        if (crate) {
          const src = lod0(crate);
          if (src) {
            const cs = 1.25;
            const cm = new THREE.Mesh(src.geometry, src.material);
            cm.scale.setScalar(cs);
            cm.position.set(S / 2 - 0.75, 0, -S / 2 + 0.75);
            cm.rotation.y = 0.3;
            cm.castShadow = cm.receiveShadow = true;
            inner.add(cm);
            addBox(new THREE.Vector3(0.62, 0.62, 0.58), new THREE.Vector3(S / 2 - 0.75, 0.62, -S / 2 + 0.75));
          }
        }
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
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), cableMat);
        this.group.add(cable);
        m.trolley = trolley;
        m.cable = cable;
      } else if (hover) {
        const s = d.s ?? 2;
        const src = lod0(hover);
        if (src) {
          const hm = new THREE.Mesh(src.geometry, src.material);
          hm.scale.setScalar(s);
          hm.position.y = -0.955 * s;
          hm.castShadow = hm.receiveShadow = true;
          inner.add(hm);
        }
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
