import * as THREE from 'three';
import { CAMERA } from '../config';
import { Physics } from '../core/Physics';

/** Camera behaviour per player phase. None of them ever turns the camera sideways on its own while airborne. */
export type CamMode = 'run' | 'jump' | 'fall' | 'hang' | 'pad';
export interface CamInfo {
  /** feet height where the airborne phase began (jump framing) */
  airBaseY: number;
  /** grounded, running fast and straight with the stick: the only case where auto-align may act */
  alignOK: boolean;
}

/** Orbit camera behind the player, smooth follow, mouse/touch rotation, zoom, wall collision. */
export class ThirdPersonCamera {
  camera: THREE.PerspectiveCamera;
  yaw = 0; // 0: camera sits on +Z of the target looking toward -Z
  pitch = CAMERA.startPitch;
  distance = CAMERA.distance;
  private currentDist = CAMERA.distance;
  private target = new THREE.Vector3();
  private initialized = false;
  private shake = 0;
  private dir = new THREE.Vector3();
  private desired = new THREE.Vector3();
  autoFollow = false; // very gentle auto-align behind the player while running straight on the ground (setting)
  private idleLook = 0;
  mode: CamMode = 'run';
  private lift = 0;
  /** base field of view (set on resize); effects add to it */
  baseFov: number = CAMERA.fov;
  private fxDist = 0;
  private fxFov = 0;
  private fxPitch = 0;
  private fxGoal = { dist: 0, fov: 0, pitch: 0, sharp: 4 };

  /** Dynamic framing: pull back / widen / tilt down (pad launches, long falls). Smoothed. */
  setEffects(dist: number, fov: number, pitch: number, sharpness = 4) {
    this.fxGoal.dist = dist;
    this.fxGoal.fov = fov;
    this.fxGoal.pitch = pitch;
    this.fxGoal.sharp = sharpness;
  }

  constructor(private physics: Physics, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.1, 2600);
  }

  addLook(dx: number, dy: number, zoom: number) {
    this.yaw -= dx * CAMERA.mouseSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * CAMERA.mouseSensitivity, CAMERA.pitchMin, CAMERA.pitchMax);
    if (zoom) this.distance = THREE.MathUtils.clamp(this.distance * (zoom > 0 ? 1.12 : 1 / 1.12), CAMERA.minDistance, CAMERA.maxDistance);
    if (Math.abs(dx) + Math.abs(dy) > 0.5) this.idleLook = 0;
  }

  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount);
  }

  private holdOut = 0;
  private shakeT = 0;
  private goalV = new THREE.Vector3();

  snapTo(feet: THREE.Vector3, yaw: number) {
    this.yaw = yaw;
    this.target.set(feet.x, feet.y + CAMERA.targetHeight, feet.z);
    this.initialized = true;
  }

  update(dt: number, feet: THREE.Vector3, playerYaw: number, mode: CamMode, info: CamInfo) {
    this.mode = mode;
    // vertical framing per phase:
    //  jump - follow only part of the rise so the horizon stays steady over a gap (no bobbing every hop)
    //  fall - below the take-off height: follow fast, the landing surface below must stay visible
    //  hang - a little higher, so the lip and the spot you will climb onto are in view
    const th = CAMERA.targetHeight;
    let gy = feet.y + th, sharp = CAMERA.verticalFollowSharpness, maxLag = 1.2;
    if (mode === 'jump') {
      const rise = feet.y - info.airBaseY;
      if (rise > 0) { gy = info.airBaseY + rise * 0.45 + th; sharp = 8; maxLag = 1.9; }
    } else if (mode === 'fall') sharp = 22;
    const liftGoal = mode === 'hang' ? 0.35 : 0;
    this.lift += (liftGoal - this.lift) * (1 - Math.exp(-6 * dt));
    gy += this.lift;
    const goal = this.goalV.set(feet.x, gy, feet.z);
    if (!this.initialized) { this.target.copy(goal); this.initialized = true; }
    const kh = 1 - Math.exp(-CAMERA.followSharpness * dt);
    const kv = 1 - Math.exp(-sharp * dt);
    this.target.x += (goal.x - this.target.x) * kh;
    this.target.z += (goal.z - this.target.z) * kh;
    this.target.y += (goal.y - this.target.y) * kv;
    // keep the player inside the frame even at high fall speeds
    const dy = feet.y + th + this.lift - this.target.y;
    if (Math.abs(dy) > maxLag) this.target.y = feet.y + th + this.lift - Math.sign(dy) * maxLag;

    // optional auto-align behind the character: only when running straight on the ground, never in the air,
    // and only after the player has left the camera alone for a while
    this.idleLook += dt;
    if (this.autoFollow && mode === 'run' && info.alignOK && this.idleLook > 1.5) {
      const behind = playerYaw + Math.PI;
      let d = ((behind - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 0.45);
    }

    const ke = 1 - Math.exp(-this.fxGoal.sharp * dt);
    this.fxDist += (this.fxGoal.dist - this.fxDist) * ke;
    this.fxFov += (this.fxGoal.fov - this.fxFov) * ke;
    this.fxPitch += (this.fxGoal.pitch - this.fxPitch) * ke;
    const fov = this.baseFov + this.fxFov;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const pitch = THREE.MathUtils.clamp(this.pitch + this.fxPitch, CAMERA.pitchMin, CAMERA.pitchMax);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.dir.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).normalize();
    // collision: sphere sweep from the target toward the desired camera position
    const want = this.distance + this.fxDist;
    let allowed = want;
    const hit = this.physics.sphereCast(this.target, this.dir, want, CAMERA.collisionRadius);
    if (hit !== null) allowed = Math.max(0.5, hit - 0.05);
    // snap in (never look through a wall); ease back out only once nothing has been hit for a moment, so a
    // railing or an edge that the sweep touches every other frame does not make the camera pump in and out
    if (allowed < this.currentDist - 0.01) { this.currentDist = allowed; this.holdOut = 0.18; }
    else if ((this.holdOut -= dt) <= 0) this.currentDist = Math.min(allowed, this.currentDist + dt * 7 * Math.min(1, (allowed - this.currentDist) * 2 + 0.25));
    this.desired.copy(this.target).addScaledVector(this.dir, this.currentDist);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.target);
    if (this.shake > 0) {
      // a short, smooth thump (not random jitter every frame, which reads as stutter)
      this.shakeT += dt;
      const s = this.shake * this.shake * 0.12;
      this.camera.position.y += Math.sin(this.shakeT * 38) * s;
      this.camera.position.x += Math.sin(this.shakeT * 27 + 1.3) * s * 0.5;
      this.shake = Math.max(0, this.shake - dt * 3.2);
    } else this.shakeT = 0;
  }

  /** Cinematic orbit used behind the main menu. */
  orbit(dt: number, center: THREE.Vector3, radius: number, height: number) {
    this.yaw += dt * 0.06;
    this.camera.position.set(center.x + Math.sin(this.yaw) * radius, center.y + height, center.z + Math.cos(this.yaw) * radius);
    this.camera.lookAt(center.x, center.y + height * 0.35, center.z);
  }
}
