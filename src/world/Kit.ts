import * as THREE from 'three';
import { loc } from '../i18n';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { KitData } from './MapTypes';
import * as T from './Textures';
import * as CT from './CityTextures';
import { COLLISION } from '../config';

export type ColliderSpec =
  | { type: 'box'; center: THREE.Vector3; half: THREE.Vector3; quat: THREE.Quaternion; groups?: number }
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

  /** City materials are created on first use (a village map never pays for them). */
  private mat(key: string): string {
    if (this.materials[key]) return key;
    const std = (map: THREE.Texture | null, rough = 0.9, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0, envMapIntensity: 0.5, ...extra });
    let m: THREE.MeshStandardMaterial;
    if (key.startsWith('facade_')) {
      const [, style, blank] = key.split('_');
      m = std(CT.facadeTex(style as CT.FacadeStyle, 3, blank === 'blank'), style === 'glass' ? 0.35 : 0.88, style === 'glass' ? { metalness: 0.25, envMapIntensity: 1.0 } : {});
    } else if (key.startsWith('ad_')) m = std(CT.adTex(parseInt(key.slice(3))), 0.6, { emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.18, emissiveMap: CT.adTex(parseInt(key.slice(3))) });
    else if (key.startsWith('sign_')) { const [t, sub] = key.slice(5).split('|'); m = std(CT.signTex(t, sub ?? ''), 0.6); }
    else if (key.startsWith('awning_')) m = std(CT.awningTex(parseInt(key.slice(7))), 0.95, { side: THREE.DoubleSide });
    else switch (key) {
      case 'roof': m = std(CT.roofTex()); break;
      case 'rock': m = std(T.rockTex(41), 1); break;
      case 'cap': m = std(CT.concreteTex(5, 78)); break;
      case 'concrete': m = std(CT.concreteTex(9, 64)); break;
      case 'metal': m = std(CT.metalTex(), 0.55, { metalness: 0.35 }); break;
      case 'metalY': m = std(CT.metalTex(12, 45, 80, 52), 0.5, { metalness: 0.2 }); break;
      case 'copper': m = std(CT.metalTex(14, 20, 55, 45), 0.45, { metalness: 0.4 }); break;
      case 'hazard': m = std(CT.hazardTex(), 0.7); break;
      case 'girder': m = std(CT.girderTex(), 0.7, { metalness: 0.15 }); break;
      case 'grate': m = std(CT.grateTex(), 0.6, { metalness: 0.3 }); break;
      case 'paver': m = std(CT.paverTex(), 0.95); break;
      case 'lampHead': m = new THREE.MeshStandardMaterial({ color: '#fff3cf', emissive: new THREE.Color('#ffd98a'), emissiveIntensity: 1.6, roughness: 0.4 }); break;
      case 'redLight': m = new THREE.MeshStandardMaterial({ color: '#ff5a4a', emissive: new THREE.Color('#ff2a1a'), emissiveIntensity: 2.2, roughness: 0.4 }); break;
      default: m = std(null, 0.9, { color: '#888888' });
    }
    this.materials[key] = m;
    return key;
  }

  private static slabMat: Record<string, string> = { concrete: 'cap', metal: 'metal', grate: 'grate', tile: 'paver', wood: 'planks', yellow: 'metalY', hazard: 'hazard', girder: 'girder', dark: 'concrete' };

  private boxPart(mat: string, w: number, h: number, d: number, center: THREE.Vector3, yawDeg: number, tile: number, collide = true, extra?: THREE.Quaternion) {
    const { m, q } = this.mtx(center, yawDeg, extra);
    this.push(this.mat(mat), boxGeo(w, h, d, tile), m);
    if (collide) this.colliders.push({ type: 'box', center: center.clone(), half: new THREE.Vector3(w / 2, h / 2, d / 2), quat: q });
  }

  private cylPart(mat: string, a: THREE.Vector3, b: THREE.Vector3, r: number, seg: number, collide: boolean, caps = true) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-3) return;
    const q = new THREE.Quaternion().setFromUnitVectors(Y, dir.clone().normalize());
    const c = a.clone().lerp(b, 0.5);
    const g = cylSide(r, len, seg, Math.max(1, Math.round((r * 6.28) / 1.0)), Math.max(1, len / 2));
    this.push(this.mat(mat), g, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)));
    if (caps) {
      const ca = cylCap(r, seg, true); ca.translate(0, len / 2, 0);
      const cb = cylCap(r, seg, false); cb.translate(0, -len / 2, 0);
      this.push(this.mat(mat), ca, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)));
      this.push(this.mat(mat), cb, new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1)));
    }
    if (collide) this.colliders.push({ type: 'capsule', center: c, halfHeight: Math.max(0.01, len / 2), radius: r, quat: q });
  }

  /** Wall plane with facade UVs (bays & floors aligned to the building base). */
  private facadePlane(mat: string, width: number, height: number, center: THREE.Vector3, yawDeg: number, uOff: number) {
    const g = new THREE.PlaneGeometry(width, height);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uOff + (uv.getX(i) * width) / CT.FACADE_TILE.u, (uv.getY(i) * height) / CT.FACADE_TILE.v);
    this.push(this.mat(mat), g, this.mtx(center, yawDeg).m);
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
          this.push(d.m === 'metal' ? this.mat('metal') : 'stone', boxGeo(w, sh, dd / n, 2.2), this.mtx(c, r).m);
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
      case 'building': {
        const [w, h, dd] = s;
        const style = (d.m ?? 'brick') as CT.FacadeStyle;
        const base = py - h;
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        const blank = d.blank ?? 0;
        const hash = Math.abs(Math.round(px * 7 + pz * 13)) % 4;
        // walls: +Z, -Z, +X, -X (plane normals face outward)
        const walls: [number, number, number, number, number][] = [
          // width, local x, local z, yaw offset, blank bit
          [w, 0, dd / 2, 0, 4], [w, 0, -dd / 2, 180, 8], [dd, w / 2, 0, 90, 1], [dd, -w / 2, 0, -90, 2],
        ];
        for (const [width, lx, lz, yo, bit] of walls) {
          const local = new THREE.Vector3(lx, 0, lz).applyQuaternion(q);
          const c = new THREE.Vector3(px + local.x, base + h / 2, pz + local.z);
          const key = `facade_${style}_${blank & bit ? 'blank' : 'win'}`;
          this.facadePlane(key, width, h, c, r + yo, hash * 0.25);
        }
        const roof = new THREE.PlaneGeometry(w, dd);
        roof.rotateX(-Math.PI / 2);
        const ruv = roof.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < ruv.count; i++) ruv.setXY(i, (ruv.getX(i) * w) / 4, (ruv.getY(i) * dd) / 4);
        this.push(this.mat(d.roof === 'tile' ? 'paver' : 'roof'), roof, this.mtx(new THREE.Vector3(px, py, pz), r).m);
        if (solid) this.colliders.push({ type: 'box', center: new THREE.Vector3(px, base + h / 2, pz), half: new THREE.Vector3(w / 2, h / 2, dd / 2), quat: q });
        const par = d.par ?? 0.8;
        if (par > 0.01) {
          const t = 0.35;
          const parts: [number, number, number, number][] = [[w, t, 0, dd / 2 - t / 2], [w, t, 0, -dd / 2 + t / 2], [t, dd - 2 * t, w / 2 - t / 2, 0], [t, dd - 2 * t, -w / 2 + t / 2, 0]];
          for (const [pw, pd, lx, lz] of parts) {
            const local = new THREE.Vector3(lx, 0, lz).applyQuaternion(q);
            this.boxPart('cap', pw, par, pd, new THREE.Vector3(px + local.x, py + par / 2, pz + local.z), r, 1.5, solid);
          }
        }
        break;
      }
      case 'slab': {
        const [w, t, dd] = s;
        this.boxPart(KitBuilder.slabMat[d.m ?? 'concrete'] ?? 'cap', w, t, dd, new THREE.Vector3(px, py - t / 2, pz), r, 1.5, solid);
        break;
      }
      case 'pipe': {
        if (!d.q) break;
        const mat = d.m === 'yellow' ? 'metalY' : d.m === 'copper' ? 'copper' : 'metal';
        this.cylPart(mat, new THREE.Vector3(...d.p), new THREE.Vector3(...d.q), s[0], 12, solid);
        break;
      }
      case 'girder': {
        const [w, h, len] = s;
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        const fl = Math.max(0.08, h * 0.16);
        const top = new THREE.Vector3(px, py - fl / 2, pz), bot = new THREE.Vector3(px, py - h + fl / 2, pz), web = new THREE.Vector3(px, py - h / 2, pz);
        this.boxPart('girder', w, fl, len, top, r, 1.2, false);
        this.boxPart('girder', w, fl, len, bot, r, 1.2, false);
        this.boxPart('girder', Math.max(0.08, w * 0.22), h - 2 * fl, len, web, r, 1.2, false);
        if (solid) this.colliders.push({ type: 'box', center: web, half: new THREE.Vector3(w / 2, h / 2, len / 2), quat: q });
        break;
      }
      case 'billboard': {
        const [w, h, legs] = s;
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        const T = 0.35;
        const pc = new THREE.Vector3(px, py - h / 2, pz);
        this.boxPart('metal', w + 0.3, h + 0.3, T, pc, r, 2, solid);
        const front = new THREE.PlaneGeometry(w, h);
        const fl = new THREE.Vector3(0, 0, T / 2 + 0.01).applyQuaternion(q);
        this.push(this.mat(`ad_${d.m ?? 0}`), front, this.mtx(pc.clone().add(fl), r).m);
        // catwalk in front of the poster bottom
        const cw = new THREE.Vector3(0, 0, T / 2 + 0.55).applyQuaternion(q);
        this.boxPart('grate', w + 0.3, 0.14, 1.1, new THREE.Vector3(px + cw.x, py - h - 0.15 - 0.07, pz + cw.z), r, 1, solid);
        if (legs > 0.2) for (const lx of [-w * 0.33, w * 0.33]) {
          const lo = new THREE.Vector3(lx, 0, 0).applyQuaternion(q);
          this.boxPart('metal', 0.32, legs, 0.32, new THREE.Vector3(px + lo.x, py - h - 0.15 - legs / 2, pz + lo.z), r, 2, solid);
        }
        // lamps on the top edge
        for (const lx of [-w * 0.3, 0, w * 0.3]) {
          const lo = new THREE.Vector3(lx, 0, T / 2 + 0.35).applyQuaternion(q);
          this.boxPart('lampHead', 0.5, 0.16, 0.3, new THREE.Vector3(px + lo.x, py + 0.22, pz + lo.z), r, 0, false);
        }
        break;
      }
      case 'rail': {
        const [len, h] = s;
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        const mat = d.m === 'dark' ? 'metal' : 'metalY';
        const n = Math.max(2, Math.round(len / 1.6) + 1);
        for (let i = 0; i < n; i++) {
          const lx = -len / 2 + (len * i) / (n - 1);
          const o = new THREE.Vector3(lx, 0, 0).applyQuaternion(q);
          this.cylPart(mat, new THREE.Vector3(px + o.x, py - h, pz + o.z), new THREE.Vector3(px + o.x, py, pz + o.z), 0.045, 6, false, false);
        }
        for (const ry of [0, -h * 0.5]) {
          const a = new THREE.Vector3(-len / 2, 0, 0).applyQuaternion(q), b = new THREE.Vector3(len / 2, 0, 0).applyQuaternion(q);
          this.cylPart(mat, new THREE.Vector3(px + a.x, py + ry, pz + a.z), new THREE.Vector3(px + b.x, py + ry, pz + b.z), 0.05, 6, false, false);
        }
        if (solid) this.colliders.push({ type: 'box', center: new THREE.Vector3(px, py - h / 2, pz), half: new THREE.Vector3(len / 2, h / 2, 0.07), quat: q });
        break;
      }
      case 'lamp': {
        const h = s[0];
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        this.cylPart('metal', new THREE.Vector3(px, py - h, pz), new THREE.Vector3(px, py, pz), 0.09, 8, solid);
        const arm = new THREE.Vector3(0, 0, 0.9).applyQuaternion(q);
        this.cylPart('metal', new THREE.Vector3(px, py - 0.05, pz), new THREE.Vector3(px + arm.x, py + 0.1, pz + arm.z), 0.05, 6, false);
        this.boxPart('lampHead', 0.5, 0.18, 0.32, new THREE.Vector3(px + arm.x, py + 0.02, pz + arm.z), r, 0, false);
        break;
      }
      case 'antenna': {
        const [h, w] = s;
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        const base = py - h;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3((a * w) / 2, 0, (b * w) / 2).applyQuaternion(q));
        for (const c of corners) this.cylPart('metal', new THREE.Vector3(px + c.x, base, pz + c.z), new THREE.Vector3(px + c.x * 0.35, py, pz + c.z * 0.35), 0.06, 6, false, false);
        const seg = Math.max(2, Math.round(h / Math.max(1.2, w)));
        for (let i = 0; i < seg; i++) {
          const y0 = base + (h * i) / seg, y1 = base + (h * (i + 1)) / seg;
          const k0 = 1 - 0.65 * (i / seg), k1 = 1 - 0.65 * ((i + 1) / seg);
          for (let j = 0; j < 4; j++) {
            const a = corners[j], b = corners[(j + 1) % 4];
            this.cylPart('metal', new THREE.Vector3(px + a.x * k0, y0, pz + a.z * k0), new THREE.Vector3(px + b.x * k1, y1, pz + b.z * k1), 0.035, 5, false, false);
          }
        }
        this.boxPart('redLight', 0.3, 0.3, 0.3, new THREE.Vector3(px, py + 0.15, pz), r, 0, false);
        if (solid) this.colliders.push({ type: 'box', center: new THREE.Vector3(px, base + h / 2, pz), half: new THREE.Vector3(w * 0.33, h / 2, w * 0.33), quat: q });
        break;
      }
      case 'awning': {
        const [w, dd, drop] = s;
        const len = Math.hypot(dd, drop);
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.atan2(drop, dd));
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        const off = new THREE.Vector3(0, -drop / 2, dd / 2).applyQuaternion(q);
        const c = new THREE.Vector3(px + off.x, py + off.y, pz + off.z);
        const g = new THREE.PlaneGeometry(w, len);
        g.rotateX(-Math.PI / 2);
        const key = `awning_${d.m ?? 355}`;
        this.push(this.mat(key), g, this.mtx(c, r, tilt).m);
        const val = new THREE.PlaneGeometry(w, 0.35);
        const vo = new THREE.Vector3(0, -drop - 0.17, dd).applyQuaternion(q);
        this.push(this.mat(key), val, this.mtx(new THREE.Vector3(px + vo.x, py + vo.y, pz + vo.z), r).m);
        if (solid) {
          const qq = q.clone().multiply(tilt);
          const cc = c.clone().add(new THREE.Vector3(0, -0.06, 0));
          this.colliders.push({ type: 'box', center: cc, half: new THREE.Vector3(w / 2, 0.06, len / 2), quat: qq });
        }
        break;
      }
      case 'sign': {
        const [w, h] = s;
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        const c = new THREE.Vector3(px, py - h / 2, pz);
        this.boxPart('metal', w + 0.2, h + 0.2, 0.18, c, r, 2, solid);
        const fo = new THREE.Vector3(0, 0, 0.1).applyQuaternion(q);
        this.push(this.mat(`sign_${loc(d, 'm') ?? 'ROOFTOP CITY|'}`), new THREE.PlaneGeometry(w, h), this.mtx(c.clone().add(fo), r).m);
        const back = new THREE.Vector3(0, 0, -0.1).applyQuaternion(q);
        this.push(this.mat(`sign_${loc(d, 'm') ?? 'ROOFTOP CITY|'}`), new THREE.PlaneGeometry(w, h), this.mtx(c.clone().add(back), r + 180).m);
        break;
      }
      case 'rock': {
        // inverted rocky cone under a floating chunk (visual only)
        const [w, dd, depth] = s;
        const g = new THREE.CylinderGeometry(1, 0.1, 1, 10, 5, false);
        g.translate(0, -0.5, 0);
        const pos = g.attributes.position as THREE.BufferAttribute;
        const seed = px * 0.37 + pz * 0.61;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          const a = Math.atan2(z, x);
          const n = y < -0.02 ? 1 + 0.16 * Math.sin(a * 3 + seed + y * 4) + 0.09 * Math.sin(a * 7 - y * 9 + seed * 2) : 1;
          pos.setXYZ(i, x * n * (w / 2) * 1.12, y * depth + (y < -0.02 ? Math.sin(a * 5 + seed) * 0.6 : 0), z * n * (dd / 2) * 1.12);
        }
        g.computeVertexNormals();
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(2, (w + dd) / 6), uv.getY(i) * Math.max(1, depth / 6));
        this.push(this.mat('rock'), g, this.mtx(new THREE.Vector3(px, py + 0.05, pz), r).m);
        break;
      }
      case 'solid': {
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        this.colliders.push({ type: 'box', center: new THREE.Vector3(px, py - s[1] / 2, pz), half: new THREE.Vector3(s[0] / 2, s[1] / 2, s[2] / 2), quat: q });
        break;
      }
      case 'wall': {
        const q = new THREE.Quaternion().setFromAxisAngle(Y, THREE.MathUtils.degToRad(r));
        this.colliders.push({ type: 'box', center: new THREE.Vector3(px, py, pz), half: new THREE.Vector3(s[0], s[1], s[2]), quat: q, groups: COLLISION.BOUNDARY });
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
      mesh.castShadow = mat !== 'rope' && mat !== 'lampHead' && mat !== 'redLight' && !mat.startsWith('awning');
      mesh.receiveShadow = true;
      mesh.name = `kit_${mat}`;
      meshes.push(mesh);
      for (const g of geos) g.dispose();
    }
    this.parts.clear();
    return meshes;
  }
}
