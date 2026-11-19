import * as THREE from 'three';
import * as T from './Textures';

const PUFF_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uWind;
uniform float uWrap;
uniform vec3 uCenter;
attribute vec3 iPos;
attribute vec2 iSize;
attribute float iCell;
attribute float iOpacity;
attribute float iSpeed;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 p = iPos + uWind * (uTime * iSpeed);
  // wrap horizontally around the world centre so clouds drift forever
  vec2 rel = p.xz - uCenter.xz;
  rel = mod(rel + uWrap, 2.0 * uWrap) - uWrap;
  p.xz = uCenter.xz + rel;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mv;
  float col = mod(iCell, 2.0), row = floor(iCell / 2.0);
  vUv = vec2((uv.x + col) * 0.5, (uv.y + row) * 0.5);
  float d = length(mv.xyz);
  float nearFade = smoothstep(6.0, 34.0, d - iSize.x * 0.25);
  vAlpha = iOpacity * nearFade;
  vShade = 0.86 + 0.14 * uv.y;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;
const PUFF_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(uMap, vUv);
  float a = c.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(c.rgb * uTint * vShade, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const SEA_VERT = /* glsl */ `
varying vec2 vXZ;
varying float vDist;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  vec4 mvPosition = viewMatrix * w;
  vDist = length(w.xz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SEA_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uLight, uShadow;
varying vec2 vXZ;
varying float vDist;
#include <common>
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 p = vXZ * 0.012 + vec2(uTime * 0.012, uTime * 0.004);
  float n = fbm(p) * 0.65 + fbm(p * 2.7 - uTime * 0.01) * 0.35;
  float puff = smoothstep(0.32, 0.75, n);
  vec3 col = mix(uShadow, uLight, puff);
  float alpha = mix(0.82, 1.0, puff) * smoothstep(2500.0, 900.0, vDist);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Sea of clouds below the floating village + soft drifting cumulus puffs + sun motes. */
export class Clouds {
  group = new THREE.Group();
  private puffMat: THREE.ShaderMaterial;
  private seaMat: THREE.ShaderMaterial;
  private motes: THREE.Points;
  private moteMat: THREE.PointsMaterial;
  private motePos: Float32Array;
  private moteVel: Float32Array;

  constructor(scene: THREE.Scene, count: number, cloudSeaY = -42) {
    // --- cloud atlas: 4 procedural cumulus variants (2x2)
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 4; i++) {
      const tex = T.cloudTex(20 + i * 7);
      const img = tex.image as HTMLCanvasElement;
      g.drawImage(img, (i % 2) * 512, (1 - Math.floor(i / 2)) * 256, 512, 256);
    }
    const atlas = new THREE.CanvasTexture(c);
    atlas.colorSpace = THREE.SRGBColorSpace;

    this.puffMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uWind: { value: new THREE.Vector3(1.6, 0, 0.5) }, uWrap: { value: 520 }, uCenter: { value: new THREE.Vector3() },
        uMap: { value: null }, uTint: { value: new THREE.Color(1, 1, 1) },
      }]),
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.puffMat.uniforms.uMap.value = atlas;

    const base = new THREE.PlaneGeometry(1, 0.5);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const pos = new Float32Array(count * 3), size = new Float32Array(count * 2), cell = new Float32Array(count), op = new Float32Array(count), spd = new Float32Array(count);
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) {
      const k = i / count;
      let r: number, y: number, w: number, o: number;
      if (k < 0.38) { r = 92 + rnd() * 200; y = cloudSeaY + 6 + rnd() * 34; w = 45 + rnd() * 70; o = 0.85; } // around the plateau, near the cloud sea
      else if (k < 0.8) { r = 45 + rnd() * 260; y = 15 + rnd() * 170; w = 22 + rnd() * 40; o = 0.55 + rnd() * 0.3; } // drifting through the climb
      else { r = 420 + rnd() * 500; y = -10 + rnd() * 160; w = 120 + rnd() * 180; o = 0.9; } // horizon
      const a = rnd() * Math.PI * 2;
      pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      size[i * 2] = w; size[i * 2 + 1] = w;
      cell[i] = Math.floor(rnd() * 4);
      op[i] = o;
      spd[i] = 0.6 + rnd() * 0.8;
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(size, 2));
    geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cell, 1));
    geo.setAttribute('iOpacity', new THREE.InstancedBufferAttribute(op, 1));
    geo.setAttribute('iSpeed', new THREE.InstancedBufferAttribute(spd, 1));
    geo.instanceCount = count;
    const puffs = new THREE.Mesh(geo, this.puffMat);
    puffs.frustumCulled = false;
    puffs.renderOrder = 2;
    this.group.add(puffs);

    // --- sea of clouds
    this.seaMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: new THREE.Color('#ffffff') }, uShadow: { value: new THREE.Color('#c9dcf2') } }]),
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      transparent: true,
      fog: true,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200, 1, 1), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = cloudSeaY;
    sea.renderOrder = 1;
    this.group.add(sea);

    // --- golden motes floating in the sunlight around the camera
    const N = 160;
    this.motePos = new Float32Array(N * 3);
    this.moteVel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.motePos.set([(rnd() - 0.5) * 40, (rnd() - 0.5) * 20, (rnd() - 0.5) * 40], i * 3);
      this.moteVel.set([(rnd() - 0.5) * 0.4, (rnd() - 0.3) * 0.2, (rnd() - 0.5) * 0.4], i * 3);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    this.moteMat = new THREE.PointsMaterial({ size: 0.14, map: T.glowTex('255,236,180'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85, color: '#fff3cf' });
    this.motes = new THREE.Points(mg, this.moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    scene.add(this.group);
  }

  update(dt: number, time: number, camPos: THREE.Vector3, tint: THREE.Color) {
    this.puffMat.uniforms.uTime.value = time;
    this.puffMat.uniforms.uTint.value.copy(tint);
    this.seaMat.uniforms.uTime.value = time;
    // motes live in world space, recycled inside a box around the camera
    const p = this.motePos, v = this.moteVel;
    const c = [camPos.x, camPos.y, camPos.z];
    for (let i = 0; i < p.length; i += 3) {
      p[i] += v[i] * dt; p[i + 1] += v[i + 1] * dt + Math.sin(time * 0.7 + i) * 0.002; p[i + 2] += v[i + 2] * dt;
      for (let k = 0; k < 3; k++) {
        const half = k === 1 ? 10 : 20;
        const rel = p[i + k] - c[k];
        if (rel > half) p[i + k] -= half * 2;
        else if (rel < -half) p[i + k] += half * 2;
      }
    }
    (this.motes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
