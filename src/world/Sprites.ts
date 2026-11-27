import * as THREE from 'three';
import type { SpriteData } from './MapTypes';

/** how many of a map's PNG props are drawn (quality setting; world/Detail.ts) */
export type SpriteDetail = { spriteK: number; spriteDensity: number };

export type AtlasRect = { u0: number; v0: number; u1: number; v1: number; aspect: number; cat: string };

const VERT = /* glsl */ `
uniform float uTime;
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iUv;
attribute float iSway;
attribute vec4 iMv;  // motion: kind (0 still, 1 bob, 2 orbit, 3 rise, 4 drift), then its parameters
attribute vec4 iMv2;
varying vec2 vUv;
varying float vShade;
varying float vFade;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 right = normalize(vec3(camRight.x, 0.0, camRight.z) + vec3(1e-5, 0.0, 0.0));
  float h = position.y;
  float sway = iSway * h * h * (sin(uTime * 1.6 + iPos.x * 0.37 + iPos.z * 0.23) + 0.35 * sin(uTime * 3.1 + iPos.z));
  vec3 base = iPos;
  float grow = 1.0;
  vFade = 1.0;
  float k = iMv.x;
  if (k > 0.5 && k < 1.5) { // bob
    base.y += iMv.y * sin(uTime * iMv.z + iMv.w);
    base.x += iMv.y * 0.35 * sin(uTime * iMv.z * 0.63 + iMv.w * 1.7);
  } else if (k > 1.5 && k < 2.5) { // orbit round iPos
    float th = iMv.w + uTime * iMv.z;
    base = iPos + vec3(cos(th) * iMv.y, iMv2.x * sin(uTime * 0.9 + iMv.w), sin(th) * iMv.y);
  } else if (k > 2.5 && k < 3.5) { // rise and pop
    float u = fract(uTime * iMv.z / iMv.y + iMv.w);
    base.y += u * iMv.y;
    base.x += iMv2.x * sin(uTime * 1.3 + iMv.w * 6.28);
    base.z += iMv2.x * cos(uTime * 1.1 + iMv.w * 4.0);
    grow = smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.9, 1.0, u));
  } else if (k > 3.5) { // drift along a line, dissolving in and out at the ends
    float u = fract(uTime * iMv.z / iMv.y + iMv.w) - 0.5;
    base += vec3(cos(iMv2.x), 0.0, sin(iMv2.x)) * u * iMv.y;
    base.y += iMv2.y * sin(uTime * 0.6 + iMv.w * 6.28);
    vFade = 1.0 - smoothstep(0.38, 0.5, abs(u));
  }
  // seen steeply from above (or below) a billboard is a thin card: dissolve it before that
  vec3 mid = base + vec3(0.0, iSize.y * 0.5, 0.0);
  float elev = (cameraPosition.y - mid.y) / max(1.0, length(cameraPosition.xz - mid.xz));
  vFade *= elev > 0.0 ? 1.0 - smoothstep(0.42, 0.75, elev) : 1.0 - smoothstep(0.9, 1.4, -elev);
  vec3 world = base + right * (position.x * iSize.x * grow + sway * iSize.y * 0.06) + vec3(0.0, h * iSize.y * grow, 0.0);
  vUv = vec2(mix(iUv.x, iUv.z, uv.x), mix(iUv.y, iUv.w, uv.y));
  vShade = 0.78 + 0.22 * h;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
varying vec2 vUv;
varying float vShade;
varying float vFade;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.5) discard;
  if (vFade < 0.01) discard;
  if (vFade < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > vFade) discard; // dissolve
  gl_FragColor = vec4(c.rgb * uTint * vShade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** All 2D source-art props from the Map 001 PNG pack, drawn as one instanced billboard batch. */
export class SpriteSystem {
  mesh: THREE.Mesh | null = null;
  material: THREE.ShaderMaterial;
  rects: Record<string, AtlasRect> = {};

  constructor(texture: THREE.Texture, rects: Record<string, AtlasRect>) {
    this.rects = rects;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uMap: { value: null }, uTint: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
      side: THREE.DoubleSide,
    });
    this.material.uniforms.uMap.value = texture;
  }

  // all props of the map; only the ones worth drawing are copied to the front of the instance buffers
  private all: { pos: Float32Array; size: Float32Array; uv: Float32Array; sway: Float32Array; mv: Float32Array; mv2: Float32Array } | null = null;
  private meta: { x: number; y: number; z: number; h: number; reach: number; keep: number }[] = [];
  private attrs: THREE.InstancedBufferAttribute[] = [];
  private shown: number[] = [];
  private lastT = -1e9;
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  detail: SpriteDetail = { spriteK: 12, spriteDensity: 0.5 };

  build(items: SpriteData[]) {
    const valid = items.filter((s) => this.rects[s.n]);
    const n = valid.length;
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const pos = new Float32Array(n * 3), size = new Float32Array(n * 2), uv = new Float32Array(n * 4), sway = new Float32Array(n);
    const mv = new Float32Array(n * 4), mv2 = new Float32Array(n * 4);
    const KIND = { bob: 1, orbit: 2, rise: 3, drift: 4 } as const;
    this.meta = [];
    valid.forEach((s, i) => {
      const r = this.rects[s.n];
      pos.set(s.p, i * 3);
      size[i * 2] = s.h * r.aspect * (s.flip ? -1 : 1);
      size[i * 2 + 1] = s.h;
      uv.set([r.u0, r.v0, r.u1, r.v1], i * 4);
      sway[i] = s.sway ?? 0;
      const m = s.mv;
      let reach = s.h * r.aspect * 0.5;
      if (m && KIND[m.k]) {
        const ph = m.ph ?? 0;
        if (m.k === 'bob') { mv.set([1, m.a ?? 1, m.s ?? 0.8, ph], i * 4); reach += m.a ?? 1; }
        else if (m.k === 'orbit') { mv.set([2, m.r ?? 30, m.s ?? 0.06, ph], i * 4); mv2[i * 4] = m.a ?? 0; reach += m.r ?? 30; }
        else if (m.k === 'rise') { mv.set([3, Math.max(1, m.span ?? 40), m.s ?? 1.2, ph], i * 4); mv2[i * 4] = m.a ?? 0.6; reach += (m.span ?? 40) * 0.5; }
        else { mv.set([4, Math.max(1, m.span ?? 80), m.s ?? 1, ph], i * 4); mv2[i * 4] = m.d ?? 0; mv2[i * 4 + 1] = m.a ?? 0; reach += (m.span ?? 80) * 0.5; }
      }
      // a stable pseudo-random number per prop decides which ones go when fewer are drawn
      const keep = Math.abs(Math.sin(i * 12.9898 + s.p[0] * 78.233 + s.p[2] * 37.719) * 43758.5453) % 1;
      this.meta.push({ x: s.p[0], y: s.p[1] + (m?.k === 'rise' ? (m.span ?? 40) * 0.5 : 0) + s.h * 0.5, z: s.p[2], h: s.h, reach, keep });
    });
    this.all = { pos, size, uv, sway, mv, mv2 };
    const mk = (src: Float32Array, k: number) => new THREE.InstancedBufferAttribute(new Float32Array(src.length), k);
    this.attrs = [mk(pos, 3), mk(size, 2), mk(uv, 4), mk(sway, 1), mk(mv, 4), mk(mv2, 4)];
    ['iPos', 'iSize', 'iUv', 'iSway', 'iMv', 'iMv2'].forEach((name, k) => geo.setAttribute(name, this.attrs[k]));
    geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.noCull = true; // positions live in the shader: the generic culler must not judge it
    this.mesh.name = 'sprites';
    this.select(new THREE.Vector3(0, -1e6, 0), true);
    return this.mesh;
  }

  /**
   * Which props to draw (every 250 ms, or when the camera jumped). Drawn:
   *  - near ones (30 m), all of them; further out only a share (`spriteDensity`) of them;
   *  - while distance < size x `spriteK`;
   *  - not when far below the camera (> 60 m) or seen steeply from above (the shader dissolves them before):
   *    from high up the props of the maps below were a cluttered carpet of cards.
   */
  select(cam: THREE.Vector3, force = false) {
    const now = performance.now();
    if (!force && now - this.lastT < 250 && cam.distanceToSquared(this.lastCam) < 36) return;
    this.lastT = now;
    this.lastCam.copy(cam);
    const D = this.detail, out: number[] = [];
    for (let i = 0; i < this.meta.length; i++) {
      const m = this.meta[i];
      const dx = m.x - cam.x, dz = m.z - cam.z, hor = Math.hypot(dx, dz);
      const dy = cam.y - m.y; // > 0: the prop is below the camera
      const d = Math.max(0, Math.hypot(hor, dy) - m.reach);
      if (dy > 60 + m.reach * 0.25) continue;
      if (dy > 18 && dy / Math.max(1, hor - m.reach) > 0.8) continue;
      if (d > Math.max(30, m.h * D.spriteK)) continue;
      if (d > 30 && m.keep > D.spriteDensity) continue;
      out.push(i);
    }
    if (!force && out.length === this.shown.length && out.every((v, k) => v === this.shown[k])) return;
    this.shown = out;
    const a = this.all!;
    const src = [a.pos, a.size, a.uv, a.sway, a.mv, a.mv2];
    this.attrs.forEach((attr, k) => {
      const w = attr.itemSize, dst = attr.array as Float32Array, s = src[k];
      out.forEach((i, j) => { for (let c = 0; c < w; c++) dst[j * w + c] = s[i * w + c]; });
      attr.clearUpdateRanges();
      if (out.length) attr.addUpdateRange(0, out.length * w);
      attr.needsUpdate = true;
    });
    (this.mesh!.geometry as THREE.InstancedBufferGeometry).instanceCount = out.length;
  }

  update(time: number, sunTint: THREE.Color, cam?: THREE.Vector3) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uTint.value.copy(sunTint);
    if (cam && this.mesh) this.select(cam);
  }

  get drawn() { return this.shown.length; }
  get total() { return this.meta.length; }
}
