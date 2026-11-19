import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { KitData } from './MapTypes';
import * as T from './Textures';

export type ColliderSpec =
  | { type: 'box'; center: THREE.Vector3; half: THREE.Vector3; quat: THREE.Quaternion }
  | { type: 'cylinder'; center: THREE.Vector3; halfHeight: number; radius: number; quat: THREE.Quaternion }
  | { type: 'capsule'; center: THREE.Vector3; halfHeight: number; radius: number; quat: THREE.Quaternion };

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Box with UVs scaled to world units (tile = metres per texture repeat). tile=0 -> 0..1 per face. */
function boxGeo(w: number, h: number, d: number, tile: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tile > 0) {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) {
      const [a, b] = dims[Math.floor(i / 4)];
      uv.setXY(i, (uv.getX(i) * a) / tile, (uv.getY(i) * b) / tile);
    }
  }
  return g;
}

function cylSide(r: number, h: number, seg: number, uRepeat: number, vRepeat: number) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uRepeat, uv.getY(i) * vRepeat);
  return g;
}

function cylCap(r: number, seg: number, top: boolean) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(top ? -Math.PI / 2 : Math.PI / 2);
  return g;
}

export class KitBuilder {
  materials: Record<string, THREE.MeshStandardMaterial>;
  private parts = new Map<string, THREE.BufferGeometry[]>();
  colliders: ColliderSpec[] = [];
  count = 0;

  constructor() {
    const std = (map: THREE.Texture, rough = 0.9, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, envMapIntensity: 0.5, ...extra });
    this.materials = {
      planks: std(T.woodPlanks(1, 27)),
      planks2: std(T.woodPlanks(11, 20)),
      crate: std(T.crateTex()),
      barrel: std(T.barrelTex()),
      bark: std(T.barkTex()),
      logEnd: std(T.logEndTex()),
      stone: std(T.stoneBrick(5, true)),
      stone2: std(T.stoneBrick(12, false), 0.85, { color: new THREE.Color(1.06, 1.04, 1.0) }),
      grass: std(T.grassTex(6)),
      rope: new THREE.MeshStandardMaterial({ color: '#c8a46c', roughness: 1, metalness: 0 }),
    };
  }

  private push(mat: string, g: THREE.BufferGeometry, m: THREE.Matrix4) {
    g.applyMatrix4(m);
    // drop groups so geometries merge cleanly
    g.clearGroups();
    let list = this.parts.get(mat);
    if (!list) { list = []; this.parts.set(mat, list); }
    list.push(g.index ? g : g);
  }

  private mtx(center: THREE.Vector3, yawDeg: number, extra?: THREE.Quaternion) {
    const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(yawDeg));
    if (extra) q.multiply(extra);
    return { m: new THREE.Matrix4().compose(center, q, new THREE.Vector3(1, 1, 1)), q };
  }

  add(d: KitData) {
    this.count++;
    const [px, py, pz] = d.p;
    const r = d.r ?? 0;
    const s = d.s;
    const solid = !d.nc;
    switch (d.k) {
      case 'crate': {
        const size = s[0];
        const c = new THREE.Vector3(px, py - size / 2, pz);
        const { m, q } = this.mtx(c, r);
        this.push('crate', boxGeo(size, size, size, 0), m);
        if (solid) this.colliders.push({ type: 'box', center: c, half: new THREE.Vector3(size / 2, size / 2, size / 2), quat: q });
        break;
      }
      case 'barrel': {
        const [rad, h] = s;
        const c = new THREE.Vector3(px, py - h / 2, pz);
        const { m, q } = this.mtx(c, r);
        const side = new THREE.CylinderGeometry(rad, rad * 0.9, h, 16, 4, true);
        // bulge the middle ring like a real barrel
        const pos = side.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const yy = pos.getY(i) / (h / 2);
          const k = 1 + 0.1 * (1 - yy * yy);
          pos.setXYZ(i, pos.getX(i) * k, pos.getY(i), pos.getZ(i) * k);
        }
        side.computeVertexNormals();
        this.push('barrel', side, m);
        const top = cylCap(rad, 16, true); top.translate(0, h / 2, 0);
        const bot = cylCap(rad * 0.9, 16, false); bot.translate(0, -h / 2, 0);
        const { m: m2 } = this.mtx(c, r);
        this.push('logEnd', top, m2);
        const { m: m3 } = this.mtx(c, r);
        this.push('logEnd', bot, m3);
        if (solid) this.colliders.push({ type: 'cylinder', center: c, halfHeight: h / 2, radius: rad, quat: q });
        break;
      }
      case 'plank':
      case 'beam': {
        const [w, t, dd] = s;
        const c = new THREE.Vector3(px, py - t / 2, pz);
        const { m, q } = this.mtx(c, r);
        this.push(d.k === 'beam' || d.m === 'dark' ? 'planks2' : 'planks', boxGeo(w, t, dd, 1.6), m);
        if (solid) this.colliders.push({ type: 'box', center: c, half: new THREE.Vector3(w / 2, t / 2, dd / 2), quat: q });
        break;
      }
      case 'log': {
        const [rad, len] = s;
        const c = new THREE.Vector3(px, py - rad, pz);
        const rotZ = new THREE.Quaternion().setFromAxisAngle(Z, Math.PI / 2);
        const { m, q } = this.mtx(c, r, rotZ);
        this.push('bark', cylSide(rad, len, 14, Math.max(1, Math.round((rad * 6.28) / 1.2)), Math.max(1, len / 1.5)), m);
        const capA = cylCap(rad, 14, true); capA.translate(0, len / 2, 0);
        const capB = cylCap(rad, 14, false); capB.translate(0, -len / 2, 0);
        this.push('logEnd', capA, this.mtx(c, r, rotZ).m);
        this.push('logEnd', capB, this.mtx(c, r, rotZ).m);
        if (solid) this.colliders.push({ type: 'capsule', center: c, halfHeight: Math.max(0.01, len / 2 - rad), radius: rad, quat: q });
        break;
      }
      case 'post': {
        const [rad, h] = s;
        const c = new THREE.Vector3(px, py - h / 2, pz);
        const { m, q } = this.mtx(c, r);
        this.push('bark', cylSide(rad, h, 10, 1, Math.max(1, h / 1.5)), m);
        const cap = cylCap(rad, 10, true); cap.translate(0, h / 2, 0);
        this.push('logEnd', cap, this.mtx(c, r).m);
        if (solid) this.colliders.push({ type: 'cylinder', center: c, halfHeight: h / 2, radius: rad, quat: q });
        break;
      }
      case 'stone': {
        const [w, h, dd] = s;
        const c = new THREE.Vector3(px, py - h / 2, pz);
        const { m, q } = this.mtx(c, r);
        this.push(d.m === 'light' ? 'stone2' : 'stone', boxGeo(w, h, dd, 2.2), m);
        if (d.m === 'grass') {
          const gc = new THREE.Vector3(px, py - 0.06 + 0.01, pz);
          this.push('grass', boxGeo(w + 0.12, 0.14, dd + 0.12, 2.5), this.mtx(gc, r).m);
        }
        if (solid) this.colliders.push({ type: 'box', center: c, half: new THREE.Vector3(w / 2, h / 2, dd / 2), quat: q });
        break;
      }
      case 'pillar': {
        const [w, h] = s;
        const capH = Math.min(0.35, h * 0.15);
        const bodyH = h - capH;
        const bc = new THREE.Vector3(px, py - capH - bodyH / 2, pz);
        const { m, q } = this.mtx(bc, r);
        this.push('stone2', boxGeo(w, bodyH, w, 2.0), m);
        const cc = new THREE.Vector3(px, py - capH / 2, pz);
        this.push('stone', boxGeo(w * 1.18, capH, w * 1.18, 2.0), this.mtx(cc, r).m);
        if (h > 1.5) {
          const fc = new THREE.Vector3(px, py - h + 0.2, pz);
          this.push('stone', boxGeo(w * 1.12, 0.4, w * 1.12, 2.0), this.mtx(fc, r).m);
        }
        if (solid) {
          this.colliders.push({ type: 'box', center: new THREE.Vector3(px, py - h / 2, pz), half: new THREE.Vector3(w / 2, h / 2, w / 2), quat: q });
          this.colliders.push({ type: 'box', center: cc, half: new THREE.Vector3((w * 1.18) / 2, capH / 2, (w * 1.18) / 2), quat: q });
        }
        break;
      }
      case 'stairs': {
        const [w, h, dd, n] = s;
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        for (let i = 0; i < n; i++) {
          const sh = (h * (n - i)) / n;
          const local = new THREE.Vector3(0, -h + sh / 2, -(i * dd) / n).applyQuaternion(q);
          const c = new THREE.Vector3(px + local.x, py + local.y, pz + local.z);
          this.push('stone', boxGeo(w, sh, dd / n, 2.2), this.mtx(c, r).m);
          if (solid) this.colliders.push({ type: 'box', center: c, half: new THREE.Vector3(w / 2, sh / 2, dd / n / 2), quat: q });
        }
        break;
      }
      case 'fence': {
        const [len, h] = s;
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        const nPosts = Math.max(2, Math.round(len / 1.6) + 1);
        for (let i = 0; i < nPosts; i++) {
          const lx = -len / 2 + (len * i) / (nPosts - 1);
          const local = new THREE.Vector3(lx, -h / 2, 0).applyQuaternion(q);
          this.push('planks2', boxGeo(0.16, h, 0.16, 1.6), this.mtx(new THREE.Vector3(px + local.x, py + local.y, pz + local.z), r).m);
        }
        for (const ry of [0.25, 0.7]) {
          this.push('planks', boxGeo(len, 0.12, 0.08, 1.6), this.mtx(new THREE.Vector3(px, py - h + h * ry, pz), r).m);
        }
        if (solid) this.colliders.push({ type: 'box', center: new THREE.Vector3(px, py - h / 2, pz), half: new THREE.Vector3(len / 2, h / 2, 0.1), quat: q });
        break;
      }
      case 'rope': {
        if (!d.q) break;
        const a = new THREE.Vector3(...d.p), b = new THREE.Vector3(...d.q);
        const sag = s[1] ?? 0.3;
        const mid = a.clone().lerp(b, 0.5); mid.y -= sag;
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        const g = new THREE.TubeGeometry(curve, 12, s[0] ?? 0.04, 5, false);
        this.push('rope', g, new THREE.Matrix4());
        break;
      }
    }
  }

  /** Merge everything into one mesh per material. */
  build(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [mat, geos] of this.parts) {
      const nonIdx = geos.map((g) => (g.index ? g : g));
      const merged = mergeGeometries(nonIdx, false);
      if (!merged) { console.warn('merge failed for', mat); continue; }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.materials[mat]);
      mesh.castShadow = mat !== 'rope';
      mesh.receiveShadow = true;
      mesh.name = `kit_${mat}`;
      meshes.push(mesh);
      for (const g of geos) g.dispose();
    }
    this.parts.clear();
    return meshes;
  }
}
