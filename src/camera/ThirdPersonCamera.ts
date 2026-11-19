import * as THREE from 'three';
import { CAMERA } from '../config';
import { Physics } from '../core/Physics';

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
  autoFollow = false; // gentle auto-rotation behind the player (touch)
  private idleLook = 0;

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

  snapTo(feet: THREE.Vector3, yaw: number) {
    this.yaw = yaw;
    this.target.set(feet.x, feet.y + CAMERA.targetHeight, feet.z);
    this.initialized = true;
  }

  update(dt: number, feet: THREE.Vector3, playerYaw: number, moving: boolean, falling: boolean) {
    const goal = new THREE.Vector3(feet.x, feet.y + CAMERA.targetHeight, feet.z);
    if (!this.initialized) { this.target.copy(goal); this.initialized = true; }
    const kh = 1 - Math.exp(-CAMERA.followSharpness * dt);
    const kv = 1 - Math.exp(-(falling ? 22 : CAMERA.verticalFollowSharpness) * dt);
    this.target.x += (goal.x - this.target.x) * kh;
    this.target.z += (goal.z - this.target.z) * kh;
    this.target.y += (goal.y - this.target.y) * kv;
    // keep the player inside the frame even at high fall speeds
    const maxLag = 1.2;
    const dy = goal.y - this.target.y;
    if (Math.abs(dy) > maxLag) this.target.y = goal.y - Math.sign(dy) * maxLag;

    // optional auto-follow behind the character (mobile comfort)
    this.idleLook += dt;
    if (this.autoFollow && moving && this.idleLook > 1.2) {
      const behind = playerYaw + Math.PI;
      let d = ((behind - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 0.9);
    }

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp).normalize();
    // collision: sphere sweep from the target toward the desired camera position
    let allowed = this.distance;
    const hit = this.physics.sphereCast(this.target, this.dir, this.distance, CAMERA.collisionRadius);
    if (hit !== null) allowed = Math.max(0.5, hit - 0.05);
    if (allowed < this.currentDist) this.currentDist = allowed; // snap in
    else this.currentDist = Math.min(allowed, this.currentDist + dt * 7); // ease out
    this.desired.copy(this.target).addScaledVector(this.dir, this.currentDist);
    this.camera.position.copy(this.desired);
    this.camera.lookAt(this.target);
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
  }

  /** Cinematic orbit used behind the main menu. */
  orbit(dt: number, center: THREE.Vector3, radius: number, height: number) {
    this.yaw += dt * 0.06;
    this.camera.position.set(center.x + Math.sin(this.yaw) * radius, center.y + height, center.z + Math.cos(this.yaw) * radius);
    this.camera.lookAt(center.x, center.y + height * 0.35, center.z);
  }
}
