import * as THREE from 'three';
import type { FxData } from '../world/MapTypes';
import * as T from '../world/Textures';

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}`;

const WATER_VERT = /* glsl */ `
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = /* glsl */ `
uniform float uTime, uLen, uSpeed, uOpacity, uFadeStart;
uniform vec3 uDeep, uLight;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
${NOISE}
void main() {
  float v = vUv.y * uLen;
  float t = uTime * uSpeed;
  float n1 = vnoise(vec2(vUv.x * 7.0, v * 1.4 - t));
  float n2 = vnoise(vec2(vUv.x * 23.0 + 4.0, v * 0.55 - t * 1.6));
  float n3 = vnoise(vec2(vUv.x * 41.0, v * 2.5 - t * 2.3));
  float streak = smoothstep(0.55, 0.92, n2 * 0.7 + n3 * 0.45);
  vec3 col = mix(uDeep, uLight, 0.3 + 0.55 * n1) + vec3(0.9) * streak * 0.55;
  float foam = smoothstep(0.06 * uLen, 0.0, v) * 0.8;
  col = mix(col, vec3(1.0), foam);
  float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
  float fade = 1.0 - smoothstep(uFadeStart, 1.0, vUv.y);
  float a = uOpacity * edge * fade * (0.72 + 0.28 * n1 + streak * 0.3);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const POOL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep, uLight;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
${NOISE}
void main() {
  vec2 p = vUv * 9.0;
  float n = vnoise(p + vec2(uTime * 0.35, uTime * 0.6)) * 0.6 + vnoise(p * 2.3 - vec2(0.0, uTime * 1.1)) * 0.4;
  float spec = smoothstep(0.68, 0.9, n);
  vec3 col = mix(uDeep, uLight, n) + spec * 0.45;
  gl_FragColor = vec4(col, 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float side = pow(sin(vUv.x * 3.14159), 2.0);
  float up = smoothstep(0.0, 0.08, vUv.y) * (1.0 - vUv.y);
  float pulse = 0.75 + 0.25 * sin(uTime * 2.0 - vUv.y * 18.0);
  float a = side * up * pulse * 0.55;
  gl_FragColor = vec4(uColor * a, a);
}`;

type Particle = { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; size: number; grow: number; color: THREE.Color; drag: number; gravity: number };

/** Pooled soft particles (dust, spray, sparkles). */
export class Particles {
  points: THREE.Points;
  private parts: Particle[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  constructor(scene: THREE.Scene, private max = 600, additive = false) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: T.softPuff(64) }, uScale: { value: 400 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec4 vC; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); float a = t.a * vC.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  setViewport(h: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.5;
  }

  emit(at: THREE.Vector3, n: number, o: { speed?: number; up?: number; life?: number; size?: number; grow?: number; color?: THREE.ColorRepresentation; spread?: number; drag?: number; gravity?: number }) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= this.max) this.parts.shift();
      const a = Math.random() * Math.PI * 2;
      const sp = (o.speed ?? 2) * (0.4 + Math.random() * 0.6);
      const spread = o.spread ?? 0.3;
      this.parts.push({
        p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * 0.1, (Math.random() - 0.5) * spread)),
        v: new THREE.Vector3(Math.cos(a) * sp, (o.up ?? 0.5) * (0.5 + Math.random()), Math.sin(a) * sp),
        life: 0,
        max: (o.life ?? 0.7) * (0.7 + Math.random() * 0.6),
        size: (o.size ?? 0.5) * (0.7 + Math.random() * 0.6),
        grow: o.grow ?? 1.2,
        color: new THREE.Color(o.color ?? '#e8dcc4'),
        drag: o.drag ?? 3,
        gravity: o.gravity ?? 0,
      });
    }
  }

  update(dt: number) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.life += dt;
      if (q.life >= q.max) { this.parts.splice(i, 1); continue; }
    }
    for (const q of this.parts) {
      q.v.multiplyScalar(Math.exp(-q.drag * dt));
      q.v.y -= q.gravity * dt;
      q.p.addScaledVector(q.v, dt);
      const k = q.life / q.max;
      this.pos.set([q.p.x, q.p.y, q.p.z], n * 3);
      this.col.set([q.color.r, q.color.g, q.color.b, (1 - k) * Math.min(1, k * 6) * 0.85], n * 4);
      this.size[n] = q.size * (1 + k * q.grow);
      n++;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Waterfalls (flowing water shader), shrine glows, exit beacon, milestones, lantern glows. */
export class Effects {
  group = new THREE.Group();
  dust: Particles;
  sparkles: Particles;
  private waterMats: THREE.ShaderMaterial[] = [];
  private beamMats: THREE.ShaderMaterial[] = [];
  private glows: { s: THREE.Sprite; base: number; phase: number }[] = [];
  private spawners: { p: THREE.Vector3; rate: number; acc: number; kind: 'mist' | 'sparkle'; r: number }[] = [];
  private spinners: { o: THREE.Object3D; speed: number }[] = [];
  milestones: { y: number; sprite: THREE.Sprite; base: THREE.Vector3; reached: boolean }[] = [];
  /** what each map added (so it can be taken away when the map is unloaded) */
  private scopes = new Map<string, { objs: THREE.Object3D[]; items: Map<unknown[], unknown[]> }>();
  private scopeMark: { id: string; children: number; lens: Map<unknown[], number> } | null = null;
  private lists(): unknown[][] { return [this.waterMats, this.beamMats, this.glows, this.spawners, this.spinners, this.milestones, this.flocks]; }
  /** Start recording what is added for map `id` (call endScope() right after, synchronously). */
  beginScope(id: string) {
    this.scopeMark = { id, children: this.group.children.length, lens: new Map(this.lists().map((l) => [l, l.length])) };
  }
  endScope() {
    const m = this.scopeMark;
    if (!m) return;
    this.scopeMark = null;
    const rec: { objs: THREE.Object3D[]; items: Map<unknown[], unknown[]> } = this.scopes.get(m.id) ?? { objs: [], items: new Map() };
    rec.objs.push(...this.group.children.slice(m.children));
    for (const [l, n] of m.lens) { const add = l.slice(n); if (add.length) rec.items.set(l, [...(rec.items.get(l) ?? []), ...add]); }
    this.scopes.set(m.id, rec);
  }
  /** Remove (and free) everything map `id` added. */
  removeScope(id: string) {
    const rec = this.scopes.get(id);
    if (!rec) return;
    this.scopes.delete(id);
    for (const o of rec.objs) {
      this.group.remove(o);
      o.traverse((c) => { const m = c as THREE.Mesh; m.geometry?.dispose?.(); });
    }
    for (const [l, items] of rec.items) {
      const gone = new Set(items);
      for (let i = l.length - 1; i >= 0; i--) if (gone.has(l[i])) l.splice(i, 1);
    }
  }
  private flocks: { center: THREE.Vector3; r: number; speed: number; phase: number; birds: { s: THREE.Sprite; off: THREE.Vector3; flap: number }[] }[] = [];
  exitPos = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
    this.dust = new Particles(scene, 500, false);
    this.sparkles = new Particles(scene, 500, true);
  }

  private waterMaterial(len: number, opacity = 0.9, fadeStart = 0.82) {
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uLen: { value: len }, uSpeed: { value: 2.4 }, uOpacity: { value: opacity }, uFadeStart: { value: fadeStart },
        uDeep: { value: new THREE.Color('#2b8de8') }, uLight: { value: new THREE.Color('#9fe6ff') },
      }]),
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.waterMats.push(m);
    return m;
  }

  /** Ribbon following a profile in the local (z, y) plane, width along x. */
  private ribbon(profile: [number, number][], width: number, xCenter: number) {
    const segs = profile.length - 1;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let total = 0;
    const acc = [0];
    for (let i = 1; i < profile.length; i++) { total += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]); acc.push(total); }
    for (let i = 0; i <= segs; i++) {
      const [z, y] = profile[i];
      const v = acc[i] / total;
      const narrow = 1 - 0.12 * v;
      pos.push(xCenter - (width / 2) * narrow, y, z, xCenter + (width / 2) * narrow, y, z);
      uv.push(0, v, 1, v);
      if (i < segs) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return { g, total };
  }

  /** Overlay a flowing waterfall + rippling pool on a waterfall_island instance (matrix = instance transform). */
  addWaterfallIsland(m: THREE.Matrix4, fallMeters = 60): THREE.Vector3 {
    const s = new THREE.Vector3().setFromMatrixScale(m).x;
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(m);
    this.group.add(holder);
    // sheet over the modelled waterfall, then a free-falling stream below the island
    const fall = fallMeters / s;
    const profile: [number, number][] = [[0.43, 0.962], [0.5, 0.952], [0.54, 0.91], [0.548, 0.6], [0.548, 0.2], [0.55, 0.0]];
    for (let i = 1; i <= 8; i++) profile.push([0.55 + (i / 8) * 0.06, -(i / 8) * fall]);
    const { g, total } = this.ribbon(profile, 0.4, 0.19);
    const sheet = new THREE.Mesh(g, this.waterMaterial((total * s) / (0.4 * s) * 0.6, 0.92, 0.55));
    sheet.renderOrder = 3;
    holder.add(sheet);
    // pool surface
    const pg = new THREE.PlaneGeometry(0.78, 0.9, 1, 1);
    pg.rotateX(-Math.PI / 2);
    pg.translate(0.02, 0.957, 0.08);
    const poolMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uDeep: { value: new THREE.Color('#1f7fd8') }, uLight: { value: new THREE.Color('#7fd8ff') } }]),
      vertexShader: WATER_VERT,
      fragmentShader: POOL_FRAG,
      transparent: true,
      fog: true,
    });
    this.waterMats.push(poolMat);
    const pool = new THREE.Mesh(pg, poolMat);
    holder.add(pool);
    // spray where the water leaves the lip and leaves the island
    const lip = new THREE.Vector3(0.19, 0.95, 0.52).applyMatrix4(m);
    const bottom = new THREE.Vector3(0.19, 0.02, 0.56).applyMatrix4(m);
    this.spawners.push({ p: lip, rate: 6, acc: 0, kind: 'mist', r: 0.2 * s });
    this.spawners.push({ p: bottom, rate: 5, acc: 0, kind: 'mist', r: 0.25 * s });
    return new THREE.Vector3(0.19, -fall, 0.61).applyMatrix4(m);
  }

  /** Splash pond where a sky waterfall reaches the ground. */
  addPond(p: THREE.Vector3, r: number) {
    const g = new THREE.CircleGeometry(r, 40);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uDeep: { value: new THREE.Color('#1f7fd8') }, uLight: { value: new THREE.Color('#8fe0ff') } }]),
      vertexShader: WATER_VERT,
      fragmentShader: POOL_FRAG,
      transparent: true,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.waterMats.push(mat);
    const pond = new THREE.Mesh(g, mat);
    pond.position.set(p.x, 0.035, p.z);
    pond.receiveShadow = true;
    this.group.add(pond);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.28, 6, 40), new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 1 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(p.x, 0.08, p.z);
    rim.scale.z = 0.5;
    this.group.add(rim);
    this.spawners.push({ p: new THREE.Vector3(p.x, 0.4, p.z), rate: 9, acc: 0, kind: 'mist', r: 0.8 });
  }

  /** Free waterfall (e.g. from the plateau cliff). p = top centre, facing yaw r (deg). */
  addWaterfall(d: Extract<FxData, { t: 'waterfall' }>) {
    const holder = new THREE.Group();
    holder.position.set(...d.p);
    holder.rotation.y = THREE.MathUtils.degToRad(d.r);
    this.group.add(holder);
    const h = d.h + (d.fall ?? 0);
    const profile: [number, number][] = [[-0.6, 0.05], [0.0, 0], [0.5, -0.6], [0.7, -2]];
    for (let i = 1; i <= 10; i++) profile.push([0.7 + i * 0.25, -2 - (i / 10) * (h - 2)]);
    const { g, total } = this.ribbon(profile, d.w, 0);
    const mesh = new THREE.Mesh(g, this.waterMaterial(total / d.w * 0.6, 0.9, 0.6));
    mesh.renderOrder = 3;
    holder.add(mesh);
    this.spawners.push({ p: new THREE.Vector3(...d.p).add(new THREE.Vector3(0, -0.5, 0)), rate: 5, acc: 0, kind: 'mist', r: d.w * 0.4 });
  }

  addShrine(base: THREE.Vector3, scale: number, rotDeg: number, exit: boolean) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(rotDeg));
    const crystal = new THREE.Vector3(-0.03, 0.6, 0).applyQuaternion(q).multiplyScalar(scale).add(base);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTex('120,200,255'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.position.copy(crystal);
    glow.scale.setScalar(scale * 1.6);
    this.group.add(glow);
    this.glows.push({ s: glow, base: scale * 1.6, phase: Math.random() * 6 });
    // orbiting rune ring
    const ringGeo = new THREE.TorusGeometry(scale * 0.42, scale * 0.012, 6, 48);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.copy(crystal).add(new THREE.Vector3(0, -scale * 0.12, 0));
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);
    this.spinners.push({ o: ring, speed: 0.8 });
    this.spawners.push({ p: crystal.clone(), rate: exit ? 14 : 5, acc: 0, kind: 'sparkle', r: scale * 0.35 });
    if (exit) {
      this.exitPos.copy(crystal);
      const beamH = 90;
      const bg = new THREE.CylinderGeometry(scale * 0.5, scale * 0.9, beamH, 24, 1, true);
      bg.translate(0, beamH / 2, 0);
      const bm = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#9fe8ff') } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.beamMats.push(bm);
      const beam = new THREE.Mesh(bg, bm);
      beam.position.copy(crystal);
      beam.renderOrder = 7;
      this.group.add(beam);
    }
  }

  /** Swirling sky portal (map exit gate) of radius s, facing yaw r (normal = local +Z). */
  addPortal(c: THREE.Vector3, s: number, rotDeg: number) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#9fe8ff') } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
          float a = atan(p.y, p.x);
          float sw = sin(a * 5.0 + r * 9.0 - uTime * 3.0) * 0.5 + 0.5;
          float core = smoothstep(1.0, 0.0, r);
          vec3 col = mix(uColor, vec3(1.0, 0.85, 0.55), sw * 0.45) * (0.45 + core * 0.9);
          float alpha = (0.35 + 0.45 * sw) * smoothstep(1.0, 0.82, r) + core * 0.25;
          gl_FragColor = vec4(col, alpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beamMats.push(mat);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(s, 48), mat);
    disc.position.copy(c);
    disc.rotation.y = THREE.MathUtils.degToRad(rotDeg);
    disc.renderOrder = 6;
    this.group.add(disc);
    this.addGlow(c.clone(), s * 3.2, '150,220,255');
    this.spawners.push({ p: c.clone(), rate: 16, acc: 0, kind: 'sparkle', r: s * 0.8 });
    const beamH = 120;
    const bg = new THREE.CylinderGeometry(s * 0.35, s * 0.7, beamH, 24, 1, true);
    bg.translate(0, beamH / 2, 0);
    const bm = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffd9a0') } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beamMats.push(bm);
    const beam = new THREE.Mesh(bg, bm);
    beam.position.copy(c).add(new THREE.Vector3(0, s, 0));
    beam.renderOrder = 7;
    this.group.add(beam);
  }

  addGlow(p: THREE.Vector3, s: number, color = '255,214,140') {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glowTex(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    glow.position.copy(p);
    glow.scale.setScalar(s);
    this.group.add(glow);
    this.glows.push({ s: glow, base: s, phase: Math.random() * 6 });
  }

  addMilestone(p: THREE.Vector3, y: number, atlas: THREE.Texture, rect: { u0: number; v0: number; u1: number; v1: number; aspect: number }) {
    const tex = atlas.clone();
    tex.needsUpdate = true;
    tex.repeat.set(rect.u1 - rect.u0, rect.v1 - rect.v0);
    tex.offset.set(rect.u0, rect.v0);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.4 }));
    s.position.copy(p);
    s.scale.set(1.3 * rect.aspect, 1.3, 1);
    this.group.add(s);
    this.milestones.push({ y, sprite: s, base: p.clone(), reached: false });
    this.addGlow(p, 2.0, '255,220,120');
  }

  update(dt: number, time: number) {
    for (const m of this.waterMats) m.uniforms.uTime.value = time;
    for (const m of this.beamMats) m.uniforms.uTime.value = time;
    for (const g of this.glows) g.s.scale.setScalar(g.base * (0.9 + 0.1 * Math.sin(time * 2.2 + g.phase)));
    for (const s of this.spinners) s.o.rotation.z += dt * s.speed;
    for (const f of this.flocks) {
      const a = f.phase + time * f.speed;
      const cx = f.center.x + Math.cos(a) * f.r, cz = f.center.z + Math.sin(a) * f.r;
      const cy = f.center.y + Math.sin(time * 0.3 + f.phase) * 4;
      for (const b of f.birds) {
        b.s.position.set(cx + b.off.x, cy + b.off.y + Math.sin(time * 2 + b.flap) * 0.3, cz + b.off.z);
        b.s.scale.y = 0.65 * (0.35 + 0.65 * Math.abs(Math.sin(time * 7 + b.flap)));
      }
    }
    for (const m of this.milestones) {
      m.sprite.position.y = m.base.y + Math.sin(time * 1.8 + m.base.x) * 0.25;
      const sx = Math.cos(time * 1.5 + m.base.z);
      m.sprite.scale.x = Math.abs(m.sprite.scale.y * 0.82 * sx) + 0.05;
      m.sprite.material.opacity = m.reached ? 0.35 : 1;
    }
    for (const sp of this.spawners) {
      sp.acc += dt * sp.rate;
      while (sp.acc >= 1) {
        sp.acc -= 1;
        const at = sp.p.clone().add(new THREE.Vector3((Math.random() - 0.5) * sp.r * 2, (Math.random() - 0.5) * sp.r, (Math.random() - 0.5) * sp.r * 2));
        if (sp.kind === 'mist') this.dust.emit(at, 1, { speed: 0.6, up: 0.6, life: 2.2, size: 1.6 + sp.r * 0.5, grow: 1.8, color: '#f4fbff', drag: 0.6 });
        else this.sparkles.emit(at, 1, { speed: 0.25, up: 0.9, life: 1.8, size: 0.25, grow: -0.5, color: '#9fe8ff', drag: 0.3 });
      }
    }
    this.dust.update(dt);
    this.sparkles.update(dt);
  }

  private birdTex = new Map<string, THREE.Texture>();
  private birdTexture(color: string) {
    let tex = this.birdTex.get(color);
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d')!;
    g.strokeStyle = color; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(6, 22); g.quadraticCurveTo(34, 2, 64, 34); g.quadraticCurveTo(94, 2, 122, 22); g.stroke();
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.birdTex.set(color, tex);
    return tex;
  }
  /** a few flocks of cartoon birds circling the village */
  addBirds(count = 3) {
    for (let f = 0; f < count; f++) {
      this.addFlock(new THREE.Vector3((Math.random() - 0.5) * 60, 25 + f * 35 + Math.random() * 15, (Math.random() - 0.5) * 60), 45 + Math.random() * 40, 6, f % 2 ? 1 : -1, undefined, 0.08 + Math.random() * 0.05);
    }
  }
  /** one flock of n birds circling `center` at radius r (dir: 1 / -1) */
  addFlock(center: THREE.Vector3, r: number, n = 6, dir = 1, color = '#3b4a5c', speed?: number) {
    const tex = this.birdTexture(color);
    const flock = { center: center.clone(), r, speed: (speed ?? (0.08 + Math.random() * 0.05) * (40 / Math.max(20, r)) ** 0.5) * dir, phase: Math.random() * 6, birds: [] as { s: THREE.Sprite; off: THREE.Vector3; flap: number }[] };
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true }));
      s.scale.set(1.3, 0.65, 1);
      this.group.add(s);
      flock.birds.push({ s, off: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 6), flap: Math.random() * 6 });
    }
    this.flocks.push(flock);
  }

  burst(at: THREE.Vector3, color = '#ffe08a') {
    this.sparkles.emit(at, 40, { speed: 4, up: 3, life: 1.1, size: 0.35, grow: -0.6, color, spread: 0.5, drag: 1.5, gravity: 2 });
  }
}
