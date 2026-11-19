import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

export type AnimName = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'fallLong' | 'land' | 'hang' | 'climb';

type ClipSpec = { src: string; t0?: number; t1?: number; strip: 'xz' | 'xyz' | 'none'; loop: 'repeat' | 'once' | 'pingpong'; timeScale?: number; lockYaw?: boolean };

// Mapping of gameplay animation states onto the Meshy/Mixamo clips shipped in hero-*.glb
const SPECS: Record<AnimName, ClipSpec> = {
  idle: { src: 'Fall4', t0: 3.3, t1: 3.75, strip: 'xz', loop: 'pingpong', timeScale: 0.35, lockYaw: true },
  walk: { src: 'Walking', strip: 'xz', loop: 'repeat' },
  run: { src: 'Running', strip: 'xz', loop: 'repeat' },
  jump: { src: 'Jump_Over_Obstacle_2', t0: 0.04, t1: 0.42, strip: 'xyz', loop: 'once', timeScale: 1.1 },
  fall: { src: 'Fall2', strip: 'xz', loop: 'repeat' },
  fallLong: { src: 'Fall4', t0: 0.42, t1: 1.12, strip: 'xyz', loop: 'pingpong', timeScale: 0.8, lockYaw: true },
  land: { src: 'Fall4', t0: 1.42, t1: 2.5, strip: 'xz', loop: 'once', timeScale: 1.35, lockYaw: true },
  hang: { src: 'Hang_and_Climb_Left', t0: 0.0, t1: 0.26, strip: 'xz', loop: 'pingpong', timeScale: 0.35 },
  climb: { src: 'climbing_up_wall', t0: 0.0, t1: 1.86, strip: 'xyz', loop: 'once' },
};

/** Resample [t0,t1] of a clip at fixed fps (robust even for sparse/optimised keyframes). */
function sampleSubclip(clip: THREE.AnimationClip, name: string, t0: number, t1: number, fps = 30): THREE.AnimationClip {
  const n = Math.max(2, Math.round((t1 - t0) * fps) + 1);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const tr of clip.tracks) {
    const size = tr.getValueSize();
    const interp = tr.createInterpolant();
    const times = new Float32Array(n);
    const values = new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      const t = t0 + ((t1 - t0) * i) / (n - 1);
      times[i] = t - t0;
      const v = interp.evaluate(Math.min(t, clip.duration));
      values.set(v.subarray(0, size), i * size);
    }
    const Ctor = tr.constructor as unknown as new (n: string, t: Float32Array, v: Float32Array) => THREE.KeyframeTrack;
    tracks.push(new Ctor(tr.name, times, values));
  }
  return new THREE.AnimationClip(name, t1 - t0, tracks);
}

function hipsTrack(clip: THREE.AnimationClip) {
  return clip.tracks.find((t) => /Hips\.position$/.test(t.name));
}

/** Remove the hips' turning (yaw) frame by frame so a clip always faces +Z (pelvis X axis stays horizontal). */
function lockHipsYaw(clip: THREE.AnimationClip) {
  const tr = clip.tracks.find((t) => /Hips\.quaternion$/.test(t.name));
  if (!tr) return;
  const v = tr.values;
  const q = new THREE.Quaternion(), fix = new THREE.Quaternion(), x = new THREE.Vector3();
  for (let i = 0; i < v.length; i += 4) {
    q.set(v[i], v[i + 1], v[i + 2], v[i + 3]);
    x.set(1, 0, 0).applyQuaternion(q);
    const yaw = Math.atan2(-x.z, x.x);
    fix.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    q.premultiply(fix);
    v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; v[i + 3] = q.w;
  }
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qParent = new THREE.Quaternion();

/** Animated character: clip setup, state blending, and 2-bone arm IK for ledge hanging. */
export class CharacterModel {
  root = new THREE.Group();
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions = {} as Record<AnimName, THREE.AnimationAction>;
  current: AnimName = 'idle';
  handHangHeight = 1.9; // hand height above feet in the hang pose
  height = 1.6;
  climbProgress: (t: number) => number = (t) => t;
  climbDuration = 1.86;
  private bones: Record<string, THREE.Bone> = {};
  private ikSaved = new Map<THREE.Bone, THREE.Quaternion>();

  constructor(gltf: GLTF, public id: string) {
    this.model = gltf.scene;
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat && mat.isMeshStandardMaterial) { mat.metalness = 0; mat.roughness = 0.85; mat.envMapIntensity = 0.6; }
      }
      if ((o as THREE.Bone).isBone) this.bones[o.name.replace('mixamorig', '')] = o as THREE.Bone;
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);

    const byName = new Map(gltf.animations.map((c) => [c.name, c]));
    const runClip = byName.get('Running')!;
    const runHips = hipsTrack(runClip)!;
    const refX = runHips.values[0], refZ = runHips.values[2];

    for (const [name, spec] of Object.entries(SPECS) as [AnimName, ClipSpec][]) {
      const src = byName.get(spec.src);
      if (!src) { console.warn('Missing clip', spec.src); continue; }
      const clip = sampleSubclip(src, name, spec.t0 ?? 0, spec.t1 ?? src.duration);
      if (spec.lockYaw) lockHipsYaw(clip);
      const ht = hipsTrack(clip);
      if (ht && spec.strip !== 'none') {
        const v = ht.values;
        const y0 = v[1];
        if (name === 'climb') {
          // remember vertical progress of the original clip to drive the root procedurally
          const ys: number[] = [];
          for (let i = 0; i < v.length; i += 3) ys.push(v[i + 1]);
          const ymin = ys[0], ymax = Math.max(...ys);
          const dur = clip.duration;
          this.climbDuration = dur;
          this.climbProgress = (t: number) => {
            const f = THREE.MathUtils.clamp(t / dur, 0, 1) * (ys.length - 1);
            const i = Math.floor(f), fr = f - i;
            const y = ys[i] + (ys[Math.min(i + 1, ys.length - 1)] - ys[i]) * fr;
            return THREE.MathUtils.clamp((y - ymin) / (ymax - ymin), 0, 1);
          };
        }
        for (let i = 0; i < v.length; i += 3) {
          v[i] = refX;
          v[i + 2] = refZ;
          if (spec.strip === 'xyz') v[i + 1] = y0;
        }
      }
      const a = this.mixer.clipAction(clip);
      if (spec.loop === 'once') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      else if (spec.loop === 'pingpong') a.setLoop(THREE.LoopPingPong, Infinity);
      else a.setLoop(THREE.LoopRepeat, Infinity);
      a.timeScale = spec.timeScale ?? 1;
      this.actions[name] = a;
    }

    // measure the character: standing height and hand height while hanging
    this.measure();
    this.actions.idle.play();
  }

  private measure() {
    const head = this.bones['HeadTop_End'];
    const lh = this.bones['LeftHand'], rh = this.bones['RightHand'];
    const sample = (name: AnimName, t: number) => {
      this.mixer.stopAllAction();
      const a = this.actions[name];
      a.reset().play();
      this.mixer.setTime(t);
      this.root.updateMatrixWorld(true);
    };
    sample('idle', 0.1);
    if (head) this.height = head.getWorldPosition(tmpA).y - this.root.position.y;
    sample('hang', 0.0);
    if (lh && rh) this.handHangHeight = (lh.getWorldPosition(tmpA).y + rh.getWorldPosition(tmpB).y) / 2 - this.root.position.y;
    this.mixer.stopAllAction();
    for (const a of Object.values(this.actions)) { a.reset(); a.weight = 1; }
  }

  play(name: AnimName, fade = 0.18, restart = false) {
    if (name === this.current && !restart) return;
    const next = this.actions[name];
    const prev = this.actions[this.current];
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) prev.crossFadeTo(next, fade, false);
    this.current = name;
  }

  setTimeScale(name: AnimName, ts: number) {
    this.actions[name].timeScale = ts;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }

  /** Pull both wrists onto ledge points (call after update + updateMatrixWorld). */
  applyArmIK(left: THREE.Vector3, right: THREE.Vector3, weight: number) {
    if (weight <= 0.001) return;
    this.root.updateMatrixWorld(true);
    this.solveArm('Left', left, weight);
    this.solveArm('Right', right, weight);
  }

  private solveArm(side: 'Left' | 'Right', target: THREE.Vector3, weight: number) {
    const a = this.bones[`${side}Arm`], b = this.bones[`${side}ForeArm`], c = this.bones[`${side}Hand`];
    if (!a || !b || !c) return;
    const saveA = a.quaternion.clone(), saveB = b.quaternion.clone();
    const pa = a.getWorldPosition(tmpA), pb = b.getWorldPosition(tmpB), pc = c.getWorldPosition(tmpC);
    const lab = pa.distanceTo(pb), lcb = pb.distanceTo(pc);
    const lat = THREE.MathUtils.clamp(pa.distanceTo(target), 0.05, lab + lcb - 0.002);
    // 1) bend elbow so |a->c| equals |a->target|
    const ba = v1.subVectors(pa, pb).normalize();
    const bc = v2.subVectors(pc, pb).normalize();
    const theta0 = Math.acos(THREE.MathUtils.clamp(ba.dot(bc), -1, 1));
    const theta1 = Math.acos(THREE.MathUtils.clamp((lab * lab + lcb * lcb - lat * lat) / (2 * lab * lcb), -1, 1));
    let axis = v3.crossVectors(bc, ba);
    if (axis.lengthSq() < 1e-8) axis.set(side === 'Left' ? 1 : -1, 0, 0).applyQuaternion(this.root.quaternion);
    axis.normalize();
    q1.setFromAxisAngle(axis, theta0 - theta1);
    this.rotateBoneWorld(b, q1);
    // 2) swing shoulder so that a->c points at target
    const pc2 = c.getWorldPosition(tmpC);
    const pa2 = a.getWorldPosition(tmpA);
    const from = v1.subVectors(pc2, pa2).normalize();
    const to = v2.subVectors(target, pa2).normalize();
    q2.setFromUnitVectors(from, to);
    this.rotateBoneWorld(a, q2);
    // blend
    if (weight < 1) {
      a.quaternion.copy(saveA.slerp(a.quaternion, weight));
      b.quaternion.copy(saveB.slerp(b.quaternion, weight));
      a.updateMatrixWorld(true);
    }
  }

  private rotateBoneWorld(bone: THREE.Bone, worldRot: THREE.Quaternion) {
    const parent = bone.parent!;
    parent.getWorldQuaternion(qParent);
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const newWorld = worldRot.clone().multiply(world);
    bone.quaternion.copy(qParent.invert().multiply(newWorld));
    bone.updateMatrixWorld(true);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
