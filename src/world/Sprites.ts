import * as THREE from 'three';
import type { SpriteData } from './MapTypes';

export type AtlasRect = { u0: number; v0: number; u1: number; v1: number; aspect: number; cat: string };

const VERT = /* glsl */ `
uniform float uTime;
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iUv;
attribute float iSway;
varying vec2 vUv;
varying float vShade;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 right = normalize(vec3(camRight.x, 0.0, camRight.z) + vec3(1e-5, 0.0, 0.0));
  float h = position.y;
  float sway = iSway * h * h * (sin(uTime * 1.6 + iPos.x * 0.37 + iPos.z * 0.23) + 0.35 * sin(uTime * 3.1 + iPos.z));
  vec3 world = iPos + right * (position.x * iSize.x + sway * iSize.y * 0.06) + vec3(0.0, h * iSize.y, 0.0);
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
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.5) discard;
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
    valid.forEach((s, i) => {
      const r = this.rects[s.n];
      pos.set(s.p, i * 3);
      size[i * 2] = s.h * r.aspect * (s.flip ? -1 : 1);
      size[i * 2 + 1] = s.h;
      uv.set([r.u0, r.v0, r.u1, r.v1], i * 4);
      sway[i] = s.sway ?? 0;
    });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 2));
    geo.setAttribute('iUv', new THREE.InstancedBufferAttribute(uv, 4));
    geo.setAttribute('iSway', new THREE.InstancedBufferAttribute(sway, 1));
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
