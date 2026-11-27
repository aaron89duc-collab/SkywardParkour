import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import * as T from './Textures';

export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir, uTop, uHorizon, uBottom, uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.6));
  col = mix(col, uBottom, smoothstep(0.0, -0.3, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 1400.0) * 9.0 + pow(s, 90.0) * 0.55 + pow(s, 8.0) * 0.22);
  col += vec3(1.0, 0.86, 0.62) * pow(s, 3.0) * 0.10 * (1.0 - abs(h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Sky dome, sun (light + flare + god rays), fog, shadows and image-based lighting. */
export class Environment {
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  flare: Lensflare | null = null;
  private flareAnchor = new THREE.Object3D();
  shafts: LightShafts;
  sunTint = new THREE.Color(1, 1, 1);
  readonly horizon = new THREE.Color('#bfe2ff');

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, opts: { shadows: boolean; shadowMap: number; flare: boolean }) {
    const uniforms = {
      uSunDir: { value: SUN_DIR.clone() },
      uTop: { value: new THREE.Color('#2f7fe0') },
      uHorizon: { value: this.horizon.clone() },
      uBottom: { value: new THREE.Color('#e6f4ff') },
      uSunColor: { value: new THREE.Color('#fff1cf') },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 32, 16),
      new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    scene.fog = new THREE.Fog(this.horizon.clone(), 170, 1300);
    scene.background = this.horizon.clone();

    // image based lighting from the same sky
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = this.sky.clone();
    envSky.material = (this.sky.material as THREE.ShaderMaterial).clone();
    envScene.add(envSky);
    const g = new THREE.Mesh(new THREE.SphereGeometry(100, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#7f9a64', side: THREE.BackSide }));
    envScene.add(g);
    scene.environment = pm.fromScene(envScene, 0.02, 1, 3000).texture;
    pm.dispose();

    this.hemi = new THREE.HemisphereLight('#dceeff', '#88a368', 1.15);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fff0d6', 2.7);
    this.sun.position.copy(SUN_DIR).multiplyScalar(120);
    this.sun.castShadow = opts.shadows;
    if (opts.shadows) {
      this.sun.shadow.mapSize.set(opts.shadowMap, opts.shadowMap);
      const c = this.sun.shadow.camera;
      c.left = -34; c.right = 34; c.top = 34; c.bottom = -34; c.near = 1; c.far = 320;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.045;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);

    if (opts.flare) {
      const glow = T.glowTex('255,244,214');
      const ring = T.flareRing();
      const lf = new Lensflare();
      lf.addElement(new LensflareElement(glow, 420, 0, new THREE.Color(1, 0.95, 0.85)));
      lf.addElement(new LensflareElement(ring, 70, 0.55, new THREE.Color(0.7, 0.85, 1)));
      lf.addElement(new LensflareElement(glow, 50, 0.7, new THREE.Color(1, 0.8, 0.5)));
      lf.addElement(new LensflareElement(ring, 120, 0.9, new THREE.Color(0.8, 1, 0.85)));
      lf.addElement(new LensflareElement(glow, 30, 1.0, new THREE.Color(0.7, 0.8, 1)));
      this.flareAnchor.add(lf);
      scene.add(this.flareAnchor);
      this.flare = lf;
    }

    this.shafts = new LightShafts(scene);
  }

  setShadows(on: boolean, size: number) {
    this.sun.castShadow = on;
    if (on && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }

  update(dt: number, time: number, camera: THREE.Camera, focus: THREE.Vector3) {
    this.sky.position.copy(camera.position);
    // shadow frustum follows the player, snapped to texels to avoid shimmering
    const texel = 68 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fy = Math.round(focus.y / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx, fy, fz).addScaledVector(SUN_DIR, 150);
    this.flareAnchor.position.copy(camera.position).addScaledVector(SUN_DIR, 1800);
    this.shafts.update(dt, time, camera, focus);
  }
}

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SHAFT_FRAG = /* glsl */ `
uniform float uTime, uAlpha, uSeed;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float side = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
  float along = smoothstep(0.0, 0.18, vUv.y) * pow(vUv.y, 0.6);
  float stripes = 0.65 + 0.35 * sin(vUv.x * 18.0 + uSeed * 7.0 + uTime * 0.35) * sin(vUv.x * 7.0 - uTime * 0.21 + uSeed);
  float a = side * side * along * stripes * uAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

const SH = { axis: new THREE.Vector3(), view: new THREE.Vector3(), top: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4() };

/** Soft volumetric-looking sun beams ("ánh nắng") drifting around the player. */
export class LightShafts {
  group = new THREE.Group();
  private beams: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; offset: THREE.Vector3; life: number; speed: number; base: number }[] = [];
  enabled = true;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, -0.5, 0); // top edge at origin, extends "down" along -Y
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 10 }, uColor: { value: new THREE.Color('#fff1c4') } },
        vertexShader: SHAFT_VERT,
        fragmentShader: SHAFT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
      this.beams.push({ mesh, mat, offset: new THREE.Vector3(), life: Math.random(), speed: 0.03 + Math.random() * 0.04, base: 0.05 + Math.random() * 0.06 });
    }
    scene.add(this.group);
    this.beams.forEach((b) => this.respawn(b, true));
  }

  private respawn(b: (typeof this.beams)[number], initial = false) {
    const ang = Math.random() * Math.PI * 2;
    const rad = 10 + Math.random() * 38;
    b.offset.set(Math.cos(ang) * rad, 14 + Math.random() * 26, Math.sin(ang) * rad);
    b.life = initial ? Math.random() : 0;
    const w = 2.5 + Math.random() * 6;
    const len = 35 + Math.random() * 45;
    b.mesh.scale.set(w, len, 1);
  }

  update(dt: number, time: number, camera: THREE.Camera, focus: THREE.Vector3) {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    const axis = SH.axis.copy(SUN_DIR).negate(); // light travel direction
    const viewDir = camera.getWorldDirection(SH.view);
    const facing = THREE.MathUtils.clamp(viewDir.dot(SUN_DIR) * 0.5 + 0.55, 0.25, 1);
    const yAxis = SH.y.copy(axis).negate();
    for (const b of this.beams) {
      b.life += dt * b.speed;
      if (b.life >= 1) this.respawn(b);
      const env = Math.sin(b.life * Math.PI);
      b.mat.uniforms.uTime.value = time;
      b.mat.uniforms.uAlpha.value = env * b.base * facing;
      const top = SH.top.copy(focus).add(b.offset).addScaledVector(SUN_DIR, 20);
      b.mesh.position.copy(top);
      // orient: local -Y along the light direction, face the camera around that axis
      const toCam = SH.z.copy(camera.position).sub(top);
      const zAxis = toCam.addScaledVector(axis, -toCam.dot(axis)).normalize();
      const xAxis = SH.x.crossVectors(yAxis, zAxis).normalize();
      const m = SH.m.makeBasis(xAxis, yAxis, zAxis);
      b.mesh.quaternion.setFromRotationMatrix(m);
    }
  }
}
