import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYS, COLLISION } from '../config';
import { Physics } from '../core/Physics';
import { Input } from '../input/Input';
import { CharacterModel, type AnimName } from './CharacterModel';

export type PlayerState = 'ground' | 'air' | 'hang' | 'climb' | 'land';
export type PlayerEvent =
  | { type: 'jump' }
  | { type: 'land'; drop: number; speed: number }
  | { type: 'grab' }
  | { type: 'climb' }
  | { type: 'drop' }
  | { type: 'step'; run: boolean }
  | { type: 'rescue' };

const FEET = PHYS.capsuleHalfHeight + PHYS.capsuleRadius; // capsule center -> feet
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function angleLerp(a: number, b: number, t: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function approachAngle(a: number, b: number, maxStep: number) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + THREE.MathUtils.clamp(d, -maxStep, maxStep);
}

type Ledge = { edge: THREE.Vector3; normal: THREE.Vector3; y: number };

/**
 * Kinematic character controller: run, variable jump, coyote time, jump buffer,
 * air control, gravity, landing, ledge grab / hang / climb / drop. Falling never kills.
 */
export class Player {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = Math.PI;
  prevYaw = Math.PI;
  state: PlayerState = 'ground';
  grounded = true;
  model: CharacterModel | null = null;
  readonly renderPos = new THREE.Vector3(); // interpolated feet position
  spawnPoint = new THREE.Vector3();
  spawnYaw = Math.PI;
  events: PlayerEvent[] = [];
  frozen = false;

  private coyote = 0;
  private jumpBuffer = 0;
  private jumping = false;
  private airTime = 0;
  private fallPeakY = 0;
  private regrab = 0;
  private landTimer = 0;
  private ledge: Ledge | null = null;
  private climbT = 0;
  private climbFrom = new THREE.Vector3(); // feet positions
  private climbTo = new THREE.Vector3();
  private hangRoot = new THREE.Vector3();
  private ikWeight = 0;
  private stepDist = 0;
  private jumpAnimTimer = 0;
  private lastSpeed = 0;
  private wish = new THREE.Vector3();

  constructor(private physics: Physics, scene: THREE.Scene) {
    const world = physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, FEET, 0));
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(PHYS.capsuleHalfHeight, PHYS.capsuleRadius).setCollisionGroups(COLLISION.PLAYER),
      this.body,
    );
    this.controller = world.createCharacterController(PHYS.skin);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.enableAutostep(PHYS.stepHeight, PHYS.stepMinWidth, false);
    this.controller.enableSnapToGround(PHYS.snapDistance);
    this.controller.setMaxSlopeClimbAngle((PHYS.maxSlopeDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((PHYS.minSlideDeg * Math.PI) / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    void scene;
  }

  get feetY() { return this.pos.y - FEET; }
  get isHanging() { return this.state === 'hang'; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  setModel(m: CharacterModel) {
    this.model = m;
    this.syncVisual(1, 0);
  }

  teleport(feet: THREE.Vector3, yaw: number) {
    this.pos.set(feet.x, feet.y + FEET, feet.z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = this.prevYaw = yaw;
    this.state = 'air';
    this.ledge = null;
    this.airTime = 0;
    this.fallPeakY = feet.y;
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.renderPos.copy(feet);
  }

  /** Fixed-step simulation. camYaw: camera azimuth (0 = camera on +Z looking toward -Z). */
  fixedUpdate(dt: number, input: Input, camYaw: number) {
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    const jumpPressed = input.consumeJump();
    const dropPressed = input.consumeDrop();
    if (this.frozen) return;

    // camera-relative wish direction
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    this.wish.set(rx * input.moveX + fx * input.moveY, 0, rz * input.moveX + fz * input.moveY);
    const wishLen = Math.min(1, this.wish.length());
    if (wishLen > 1e-3) this.wish.normalize();

    this.regrab = Math.max(0, this.regrab - dt);
    this.jumpAnimTimer = Math.max(0, this.jumpAnimTimer - dt);
    if (jumpPressed) this.jumpBuffer = PHYS.jumpBuffer; else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    switch (this.state) {
      case 'hang': this.updateHang(dt, jumpPressed, dropPressed, wishLen); break;
      case 'climb': this.updateClimb(dt); break;
      default: this.updateMove(dt, input, wishLen); break;
    }

    if (this.pos.y < PHYS.safetyFloorY) {
      this.teleport(this.spawnPoint, this.spawnYaw);
      this.events.push({ type: 'rescue' });
    }
  }

  private updateMove(dt: number, input: Input, wishLen: number) {
    const landing = this.state === 'land';
    if (landing) {
      this.landTimer -= dt;
      if (this.landTimer <= 0 || (this.landTimer < 0.3 && (wishLen > 0.2 || this.jumpBuffer > 0))) this.state = this.grounded ? 'ground' : 'air';
    }
    const control = this.state === 'land' ? 0.15 : 1;

    // --- horizontal velocity
    const target = _v.copy(this.wish).multiplyScalar(wishLen * PHYS.runSpeed * control);
    const hv = _w.set(this.vel.x, 0, this.vel.z);
    let accel: number;
    if (this.grounded) accel = wishLen > 0.05 ? PHYS.groundAccel : PHYS.groundDecel;
    else accel = wishLen > 0.05 ? PHYS.airAccel : PHYS.airDecel;
    const diff = target.sub(hv);
    const dl = diff.length();
    const maxStep = accel * dt;
    if (dl > maxStep) diff.multiplyScalar(maxStep / dl);
    this.vel.x += diff.x;
    this.vel.z += diff.z;

    // --- facing
    if (wishLen > 0.1 && this.state !== 'land') {
      const targetYaw = Math.atan2(this.wish.x, this.wish.z);
      const turn = (this.grounded ? PHYS.turnSpeedGround : PHYS.turnSpeedAir) * dt;
      this.yaw = approachAngle(this.yaw, targetYaw, turn);
    }

    // --- jump (coyote + buffer)
    if (this.grounded) this.coyote = PHYS.coyoteTime; else this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.state !== 'land') {
      this.vel.y = PHYS.jumpVelocity;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.jumping = true;
      this.grounded = false;
      this.state = 'air';
      this.airTime = 0;
      this.fallPeakY = this.feetY;
      this.jumpAnimTimer = 0.45;
      this.events.push({ type: 'jump' });
    }
    // variable jump height
    if (this.jumping && !input.jumpHeld && this.vel.y > 0) {
      this.vel.y *= PHYS.jumpCutMultiplier;
      this.jumping = false;
    }
    if (this.vel.y <= 0) this.jumping = false;

    // --- gravity
    if (!this.grounded || this.vel.y > 0) {
      const g = this.vel.y > 0 ? PHYS.gravityUp : PHYS.gravityDown;
      this.vel.y = Math.max(-PHYS.terminalVelocity, this.vel.y - g * dt);
    } else {
      this.vel.y = -1.5;
    }

    // --- move with the character controller
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COLLISION.QUERY_PLAYER_MOVE);
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    this.grounded = this.controller.computedGrounded();
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;
    if (desired.y > 0 && mv.y < desired.y * 0.5 - 1e-4) this.vel.y = Math.min(this.vel.y, 0); // head bump
    // wall contact: bleed horizontal velocity into the wall so air control stays predictable
    if (!this.grounded && dt > 0) {
      const ax = Math.abs(desired.x) > 1e-5 ? mv.x / desired.x : 1;
      const az = Math.abs(desired.z) > 1e-5 ? mv.z / desired.z : 1;
      if (ax < 0.5) this.vel.x *= Math.max(0, ax);
      if (az < 0.5) this.vel.z *= Math.max(0, az);
    }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });

    if (this.grounded) {
      if (!wasGrounded && this.state === 'air') {
        const drop = this.fallPeakY - this.feetY;
        this.events.push({ type: 'land', drop, speed: fallSpeed });
        if (drop > PHYS.hardLandingDrop) {
          this.state = 'land';
          this.landTimer = 0.75;
          this.vel.x *= 0.2;
          this.vel.z *= 0.2;
          this.model?.play('land', 0.08, true);
        } else this.state = 'ground';
      } else if (this.state === 'air') this.state = 'ground';
      this.airTime = 0;
      this.fallPeakY = this.feetY;
      // footsteps
      const sp = this.speed;
      this.stepDist += sp * dt;
      const stride = sp > 4.5 ? 1.7 : 1.1;
      if (this.stepDist > stride && sp > 0.8) { this.stepDist = 0; this.events.push({ type: 'step', run: sp > 4.5 }); }
    } else {
      if (this.state === 'ground') this.state = 'air';
      this.airTime += dt;
      this.fallPeakY = Math.max(this.fallPeakY, this.feetY);
      if (this.state === 'air' && this.regrab <= 0 && this.vel.y < PHYS.ledge.maxUpVelocity) this.tryGrab();
    }
    this.lastSpeed = this.speed;
  }

  private tryGrab() {
    const physics = this.physics;
    const feet = this.feetY;
    const f = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // prefer the input direction if it points roughly the same way
    if (this.wish.lengthSq() > 0.01 && this.wish.dot(f) > 0.2) f.copy(this.wish).setY(0).normalize();
    const reach = PHYS.capsuleRadius + PHYS.ledge.reach;
    let wall = null as ReturnType<Physics['raycast']>;
    for (const h of [1.4, 1.8, 1.05]) {
      const o = new THREE.Vector3(this.pos.x, feet + h, this.pos.z);
      const hit = physics.raycast(o, f, reach);
      if (hit && Math.abs(hit.normal.y) < 0.55) { wall = hit; break; }
    }
    if (!wall) return;
    const n = wall.normal.clone().setY(0);
    if (n.lengthSq() < 1e-4) return;
    n.normalize();
    if (n.dot(f) > -0.25) return;
    const top = feet + PHYS.ledge.maxRel + 0.4;
    const o2 = wall.point.clone().addScaledVector(n, -0.22);
    o2.y = top;
    const down = physics.raycast(o2, DOWN, top - (feet + PHYS.ledge.minRel) + 0.25);
    if (!down || down.distance < 0.04 || down.normal.y < 0.72) return;
    const ledgeY = down.point.y;
    const rel = ledgeY - feet;
    if (rel < PHYS.ledge.minRel || rel > PHYS.ledge.maxRel) return;
    // exact lip position
    const o3 = new THREE.Vector3(this.pos.x, ledgeY - 0.07, this.pos.z);
    const lip = physics.raycast(o3, n.clone().negate(), reach + 0.5);
    let edge: THREE.Vector3;
    if (lip && Math.abs(lip.normal.y) < 0.6) {
      edge = lip.point.clone();
      const ln = lip.normal.clone().setY(0);
      if (ln.lengthSq() > 1e-4) n.copy(ln.normalize());
    } else edge = wall.point.clone();
    edge.y = ledgeY;
    // room to stand on top?
    const stand = edge.clone().addScaledVector(n, -0.5);
    stand.y = ledgeY + FEET + 0.06;
    if (physics.capsuleOverlaps(stand, PHYS.capsuleHalfHeight, PHYS.capsuleRadius * 0.9)) return;
    // room to hang?
    const hand = this.model?.handHangHeight ?? 1.9;
    const hangCenter = edge.clone().addScaledVector(n, PHYS.capsuleRadius + 0.1);
    hangCenter.y = ledgeY - hand + FEET;
    if (physics.capsuleOverlaps(hangCenter, PHYS.capsuleHalfHeight * 0.8, PHYS.capsuleRadius * 0.8)) return;

    this.ledge = { edge, normal: n, y: ledgeY };
    this.state = 'hang';
    this.vel.set(0, 0, 0);
    this.jumping = false;
    this.pos.copy(hangCenter);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.yaw = Math.atan2(-n.x, -n.z);
    this.hangRoot.copy(edge).addScaledVector(n, 0.2);
    this.hangRoot.y = ledgeY - hand;
    this.fallPeakY = this.feetY;
    this.events.push({ type: 'grab' });
  }

  private updateHang(dt: number, jump: boolean, drop: boolean, wishLen: number) {
    const L = this.ledge!;
    const away = wishLen > 0.5 && this.wish.dot(L.normal) > 0.75;
    if (drop || away) {
      this.state = 'air';
      this.vel.copy(L.normal).multiplyScalar(1.8);
      this.vel.y = -1;
      this.regrab = PHYS.ledge.regrabCooldown;
      this.ledge = null;
      this.airTime = 0;
      this.events.push({ type: 'drop' });
      return;
    }
    if (jump || this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.state = 'climb';
      this.climbT = 0;
      this.climbFrom.copy(this.hangRoot);
      this.climbTo.copy(L.edge).addScaledVector(L.normal, -0.5);
      this.climbTo.y = L.y;
      this.events.push({ type: 'climb' });
      return;
    }
    void dt;
  }

  private updateClimb(dt: number) {
    const dur = PHYS.ledge.climbTime;
    this.climbT += dt;
    const tn = Math.min(1, this.climbT / dur);
    const m = this.model;
    const p = m ? m.climbProgress(tn * m.climbDuration) : tn;
    const h = THREE.MathUtils.smoothstep(tn, 0.55, 1);
    const feet = _v.lerpVectors(this.climbFrom, this.climbTo, h);
    feet.y = THREE.MathUtils.lerp(this.climbFrom.y, this.climbTo.y, Math.max(p, THREE.MathUtils.smoothstep(tn, 0.85, 1)));
    this.pos.set(feet.x, feet.y + FEET, feet.z);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    if (tn >= 1) {
      this.pos.set(this.climbTo.x, this.climbTo.y + FEET + 0.02, this.climbTo.z);
      this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
      this.state = 'ground';
      this.grounded = true;
      this.vel.set(0, 0, 0);
      this.ledge = null;
      this.fallPeakY = this.climbTo.y;
    }
  }

  /** Per-render-frame: interpolate, animate, IK. */
  syncVisual(alpha: number, dt: number) {
    const m = this.model;
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    this.renderPos.y -= FEET;
    const yaw = angleLerp(this.prevYaw, this.yaw, alpha);
    if (!m) return;

    // choose animation
    let anim: AnimName = 'idle';
    switch (this.state) {
      case 'ground': {
        const sp = this.speed;
        if (sp < 0.35) anim = 'idle';
        else if (sp < 4.3) { anim = 'walk'; m.setTimeScale('walk', THREE.MathUtils.clamp(sp / 2.7, 0.6, 1.5)); }
        else { anim = 'run'; m.setTimeScale('run', THREE.MathUtils.clamp(sp / 6.6, 0.75, 1.2)); }
        break;
      }
      case 'air':
        if (this.jumpAnimTimer > 0 && this.vel.y > -2) anim = 'jump';
        else if (this.airTime < 0.16 && this.vel.y > -6) anim = m.current === 'run' || m.current === 'walk' || m.current === 'idle' ? m.current : 'fall';
        else if (this.airTime > 0.85 && this.vel.y < -15) anim = 'fallLong';
        else anim = 'fall';
        break;
      case 'land': anim = 'land'; break;
      case 'hang': anim = 'hang'; break;
      case 'climb': anim = 'climb'; break;
    }
    const fades: Partial<Record<AnimName, number>> = { jump: 0.08, climb: 0.12, hang: 0.12, land: 0.08, fallLong: 0.35 };
    m.play(anim, fades[anim] ?? 0.18);
    if (anim === 'climb') m.setTimeScale('climb', m.climbDuration / PHYS.ledge.climbTime);

    // place the visual root
    if (this.state === 'hang') {
      m.root.position.copy(this.hangRoot);
    } else if (this.state === 'climb') {
      m.root.position.copy(this.renderPos);
      // during the first part of the climb, keep the body against the wall
      const tn = Math.min(1, this.climbT / PHYS.ledge.climbTime);
      const h = THREE.MathUtils.smoothstep(tn, 0.55, 1);
      const x = THREE.MathUtils.lerp(this.climbFrom.x, this.climbTo.x, h);
      const z = THREE.MathUtils.lerp(this.climbFrom.z, this.climbTo.z, h);
      m.root.position.x = x;
      m.root.position.z = z;
    } else {
      m.root.position.copy(this.renderPos);
    }
    m.root.rotation.set(0, yaw, 0);
    m.update(dt);

    // arm IK onto the ledge lip
    const wantIK = this.state === 'hang' ? 1 : this.state === 'climb' ? 1 - THREE.MathUtils.smoothstep(this.climbT / PHYS.ledge.climbTime, 0.05, 0.4) : 0;
    this.ikWeight = THREE.MathUtils.damp(this.ikWeight, wantIK, 18, dt);
    const L = this.ledge;
    if (L && this.ikWeight > 0.01) {
      const left = _v.set(-L.normal.z, 0, L.normal.x); // character's left when facing the wall
      const base = _w.copy(L.edge).addScaledVector(L.normal, 0.02);
      base.y = L.y + 0.05;
      const lt = base.clone().addScaledVector(left, 0.2);
      const rt = base.clone().addScaledVector(left, -0.2);
      m.applyArmIK(lt, rt, this.ikWeight);
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
