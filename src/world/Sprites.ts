import * as THREE from 'three';
import type { SpriteData } from './MapTypes';

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
    valid.forEach((s, i) => {
      const r = this.rects[s.n];
      pos.set(s.p, i * 3);
      size[i * 2] = s.h * r.aspect * (s.flip ? -1 : 1);
      size[i * 2 + 1] = s.h;
      uv.set([r.u0, r.v0, r.u1, r.v1], i * 4);
      sway[i] = s.sway ?? 0;
      const m = s.mv;
      if (m && KIND[m.k]) {
        const ph = m.ph ?? 0;
        if (m.k === 'bob') mv.set([1, m.a ?? 1, m.s ?? 0.8, ph], i * 4);
        else if (m.k === 'orbit') { mv.set([2, m.r ?? 30, m.s ?? 0.06, ph], i * 4); mv2[i * 4] = m.a ?? 0; }
        else if (m.k === 'rise') { mv.set([3, Math.max(1, m.span ?? 40), m.s ?? 1.2, ph], i * 4); mv2[i * 4] = m.a ?? 0.6; }
        else { mv.set([4, Math.max(1, m.span ?? 80), m.s ?? 1, ph], i * 4); mv2[i * 4] = m.d ?? 0; mv2[i * 4 + 1] = m.a ?? 0; }
      }
    });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 2));
    geo.setAttribute('iUv', new THREE.InstancedBufferAttribute(uv, 4));
    geo.setAttribute('iSway', new THREE.InstancedBufferAttribute(sway, 1));
    geo.setAttribute('iMv', new THREE.InstancedBufferAttribute(mv, 4));
    geo.setAttribute('iMv2', new THREE.InstancedBufferAttribute(mv2, 4));
    geo.instanceCount = n;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sprites';
    return this.mesh;
  }

  update(time: number, sunTint: THREE.Color) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uTint.value.copy(sunTint);
  }
}
