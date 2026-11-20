import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { PadData, RingData, LadderData } from './MapTypes';
import { Physics } from '../core/Physics';
import { COLLISION } from '../config';
import * as CT from './CityTextures';
import { Assets, bakedGeometry, lod0Mesh } from '../core/Assets';

const Y = new THREE.Vector3(0, 1, 0);

/** Model proportions of the Meshy pads / ring (normalised to height 1). */
export const PAD_MODEL = {
  jump: { w: 2.67, d: 2.07, top: 0.96 },
  speed: { w: 3.3, d: 2.19, top: 0.93 },
};
export const RING_MODEL = { centre: 0.6, inner: 0.27, w: 0.956, d: 0.54 };

export type Pad = PadData & {
  dir: THREE.Vector3; collider: RAPIER.Collider; glow: THREE.Mesh; pulse: number;
  model: THREE.Object3D | null; squash: number; arrow: THREE.Object3D | null; marker: THREE.Mesh | null; baseY: number;
};
export type Ring = RingData & { centre: THREE.Vector3; n: THREE.Vector3; radius: number; cool: number; glow: THREE.Mesh; pulse: number };
export type Ladder = LadderData & { base: THREE.Vector3; n: THREE.Vector3; t: THREE.Vector3; top: number; width: number };

/** Jump pads, speed pads, speed rings and ladders: colliders, trigger geometry and glow FX. Visual models come from the prefab system. */
export class BoosterSystem {
  pads: Pad[] = [];
  rings: Ring[] = [];
  ladders: Ladder[] = [];
  group = new THREE.Group();
  private byHandle = new Map<number, Pad>();

  constructor(private physics: Physics) {
    this.group.name = 'boosters';
  }

  /** padModel: a map's own jump-pad model (file without .glb, normalised size w x d, pad surface at `top`) */
  async build(pads: PadData[] = [], rings: RingData[] = [], ladders: LadderData[] = [], assets?: Assets, padModel?: { file: string; w: number; d: number; top: number }) {
    const glowTex = makeGlow();
    // jump pads are individual meshes (they squash when used); speed pads / rings come from the prefab system
    let padMesh: THREE.Mesh | null = null;
    if (assets && pads.some((p) => p.t === 'jump')) {
      const g = await assets.gltf(padModel ? `${padModel.file}.glb` : 'assets/map002/jump_pad.glb');
      const src = lod0Mesh(g.scene);
      // node transform baked in: model spans the normalised PAD_MODEL size, base at y = 0
      if (src) padMesh = new THREE.Mesh(bakedGeometry(src), src.material);
    }
    const arrowMat = new THREE.MeshBasicMaterial({ color: '#ffb340', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const arrowGeo = makeArrow();
    const markerMat = new THREE.MeshBasicMaterial({ color: '#7ff0ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const p of pads) {
      const s = p.s ?? 1;
      const M = p.t === 'jump' && padModel ? padModel : PAD_MODEL[p.t];
      const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(p.r));
      const h = M.top * s;
      const desc = RAPIER.ColliderDesc.cuboid((M.w * s) / 2 * 0.92, h / 2, (M.d * s) / 2 * 0.92)
        .setTranslation(p.p[0], p.p[1] - h / 2, p.p[2]).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(COLLISION.WORLD);
      const collider = this.physics.world.createCollider(desc);
      this.physics.colliderCount++;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(M.w * s * 0.9, M.d * s * 0.9), new THREE.MeshBasicMaterial({
        map: glowTex, color: p.t === 'jump' ? '#ff5fa2' : '#ffd23f', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.rotation.x = -Math.PI / 2;
      glow.rotation.z = THREE.MathUtils.degToRad(p.r);
      glow.position.set(p.p[0], p.p[1] + 0.04, p.p[2]);
      this.group.add(glow);
      let dir = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      if (p.tg) { const d = new THREE.Vector3(p.tg[0] - p.p[0], 0, p.tg[2] - p.p[2]); if (d.lengthSq() > 0.01) dir = d.normalize(); }
      let model: THREE.Object3D | null = null, arrow: THREE.Object3D | null = null, marker: THREE.Mesh | null = null;
      if (p.t === 'jump') {
        (glow.material as THREE.MeshBasicMaterial).color.set('#4fd8ff');
        const src = padMesh as THREE.Mesh | null;
        if (src) {
          const m = new THREE.Mesh(src.geometry, src.material);
          m.scale.setScalar(s);
          m.position.set(p.p[0], p.p[1] - h, p.p[2]);
          m.quaternion.copy(q);
          m.castShadow = m.receiveShadow = true;
          this.group.add(m);
          model = m;
        }
        // hologram arrow pointing at the destination (tilted up), bobbing above the pad
        const a = new THREE.Mesh(arrowGeo, arrowMat);
        a.scale.setScalar(Math.max(0.8, s * 1.1));
        const holder = new THREE.Group();
        holder.add(a);
        holder.position.set(p.p[0], p.p[1] + 1.7, p.p[2]);
        holder.rotation.y = Math.atan2(dir.x, dir.z);
        a.rotation.x = -0.5;
        this.group.add(holder);
        arrow = holder;
        if (p.tg) {
          marker = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.35, 40), markerMat.clone());
          marker.rotation.x = -Math.PI / 2;
          marker.position.set(p.tg[0], p.tg[1] + 0.05, p.tg[2]);
          marker.renderOrder = 4;
          this.group.add(marker);
        }
      }
      const pad: Pad = { ...p, dir, collider, glow, pulse: 0, model, squash: 0, arrow, marker, baseY: p.p[1] - h };
      this.pads.push(pad);
      this.byHandle.set(collider.handle, pad);
    }
    for (const r of rings) {
      const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r.r));
      const base = new THREE.Vector3(r.p[0], r.p[1] - RING_MODEL.centre * r.s, r.p[2]);
      // solid feet of the ring stand; the hoop itself is open
      for (const sx of [-1, 1]) {
        const o = new THREE.Vector3(sx * RING_MODEL.w * r.s * 0.4, 0, 0).applyQuaternion(q);
        const desc = RAPIER.ColliderDesc.cuboid(0.09 * r.s, 0.12 * r.s, RING_MODEL.d * r.s * 0.45)
          .setTranslation(base.x + o.x, base.y + 0.12 * r.s, base.z + o.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(COLLISION.WORLD);
        this.physics.world.createCollider(desc);
        this.physics.colliderCount++;
      }
      const glow = new THREE.Mesh(new THREE.CircleGeometry(RING_MODEL.inner * r.s, 32), new THREE.MeshBasicMaterial({ map: glowTex, color: '#ff7a3d', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      glow.position.set(...r.p);
      glow.quaternion.copy(q);
      this.group.add(glow);
      this.rings.push({ ...r, centre: new THREE.Vector3(...r.p), n: new THREE.Vector3(0, 0, 1).applyQuaternion(q), radius: RING_MODEL.inner * r.s, cool: 0, glow, pulse: 0 });
    }
    const ladderMat = new THREE.MeshStandardMaterial({ map: CT.metalTex(12, 45, 80, 52), roughness: 0.5, metalness: 0.2 });
    for (const l of ladders) {
      const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(l.r));
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const t = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const w = l.w ?? 0.8;
      const lad: Ladder = { ...l, base: new THREE.Vector3(...l.p), n, t, top: l.p[1] + l.h, width: w };
      this.ladders.push(lad);
      if (l.nv) continue;
      const g = new THREE.Group();
      const rail = new THREE.CylinderGeometry(0.045, 0.045, l.h + 0.9, 6);
      for (const sx of [-1, 1]) {
        const m = new THREE.Mesh(rail, ladderMat);
        m.position.set((sx * w) / 2, (l.h + 0.9) / 2, 0.16);
        m.castShadow = true;
        g.add(m);
      }
      const rung = new THREE.CylinderGeometry(0.03, 0.03, w, 5);
      rung.rotateZ(Math.PI / 2);
      const nR = Math.floor(l.h / 0.32);
      const rungs = new THREE.InstancedMesh(rung, ladderMat, nR);
      const mm = new THREE.Matrix4();
      for (let i = 0; i < nR; i++) rungs.setMatrixAt(i, mm.makeTranslation(0, 0.25 + i * 0.32, 0.16));
      g.add(rungs);
      for (const yy of [0.4, l.h * 0.5, l.h - 0.2]) {
        for (const sx of [-1, 1]) {
          const br = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), ladderMat);
          br.position.set((sx * w) / 2, yy, 0.07);
          g.add(br);
        }
      }
      g.position.copy(lad.base);
      g.quaternion.copy(q);
      this.group.add(g);
    }
  }

  padOf(c: RAPIER.Collider | null | undefined): Pad | null {
    return c ? this.byHandle.get(c.handle) ?? null : null;
  }

  /** Ring crossing between two capsule-centre positions. */
  ringCrossed(a: THREE.Vector3, b: THREE.Vector3): Ring | null {
    for (const r of this.rings) {
      if (r.cool > 0) continue;
      const da = a.clone().sub(r.centre).dot(r.n), db = b.clone().sub(r.centre).dot(r.n);
      if (Math.sign(da) === Math.sign(db) && Math.abs(db) > 0.35) continue;
      // closest approach of the segment to the hoop centre, measured in the hoop plane
      const t = Math.abs(da - db) > 1e-5 ? THREE.MathUtils.clamp(da / (da - db), 0, 1) : 0.5;
      const p = a.clone().lerp(b, t);
      const off = p.sub(r.centre);
      off.addScaledVector(r.n, -off.dot(r.n));
      if (off.length() < r.radius + 0.25) return r;
    }
    return null;
  }

  update(dt: number, time: number) {
    for (const p of this.pads) {
      p.pulse = Math.max(0, p.pulse - dt * 2.5);
      const m = p.glow.material as THREE.MeshBasicMaterial;
      m.opacity = 0.32 + 0.14 * Math.sin(time * 4 + p.p[0]) + p.pulse * 0.6;
      p.glow.scale.setScalar(1 + p.pulse * 0.6);
      if (p.model) {
        // squash 0.1 s, then spring back with a little overshoot
        p.squash = Math.max(0, p.squash - dt);
        const k = p.squash > 0 ? 1 - 0.28 * Math.sin((1 - p.squash / 0.1) * Math.PI * 0.5) : 1 + 0.15 * Math.sin((1 - p.pulse) * 12) * p.pulse;
        p.model.scale.y = (p.s ?? 1) * k;
      }
      if (p.arrow) {
        p.arrow.position.y = p.p[1] + 1.7 + Math.sin(time * 2.4 + p.p[2]) * 0.18;
        (p.arrow.children[0] as THREE.Mesh).position.z = ((time * 0.8) % 1) * 0.35;
      }
      if (p.marker) (p.marker.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.16 * Math.sin(time * 3 + p.p[0]) + p.pulse * 0.4;
    }
    for (const r of this.rings) {
      r.cool = Math.max(0, r.cool - dt);
      r.pulse = Math.max(0, r.pulse - dt * 2);
      const m = r.glow.material as THREE.MeshBasicMaterial;
      m.opacity = 0.22 + 0.1 * Math.sin(time * 5 + r.p[2]) + r.pulse * 0.6;
      r.glow.rotation.z += dt * 0.6;
    }
  }
}

/** Flat chevron arrow (pointing along +Z) for the jump-pad hologram. */
function makeArrow() {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.9); sh.lineTo(0.7, 0.1); sh.lineTo(0.35, 0.1); sh.lineTo(0.35, -0.7);
  sh.lineTo(-0.35, -0.7); sh.lineTo(-0.35, 0.1); sh.lineTo(-0.7, 0.1); sh.closePath();
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2); // lie flat, tip toward -Z ... then flip so the tip points +Z
  g.rotateY(Math.PI);
  return g;
}

function makeGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
