import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYS, COLLISION } from '../config';
import { Physics } from '../core/Physics';
import { Input } from '../input/Input';
import { CharacterModel, type AnimName } from './CharacterModel';

export type PlayerState = 'ground' | 'air' | 'hang' | 'move' | 'land' | 'roll';
export type PlayerEvent =
  | { type: 'jump' }
  | { type: 'land'; drop: number; speed: number }
  | { type: 'grab' }
  | { type: 'catch'; speed: number }
  | { type: 'climb' }
  | { type: 'mantle' }
  | { type: 'vault' }
  | { type: 'roll'; drop: number }
  | { type: 'shimmy' }
  | { type: 'push' }
  | { type: 'lower' }
  | { type: 'drop' }
  | { type: 'step'; run: boolean }
  | { type: 'rescue' };

type Ledge = { edge: THREE.Vector3; normal: THREE.Vector3; y: number; rel: number; canClimb: boolean; standY: number; hangCenter: THREE.Vector3 | null };
type MoveKind = 'climb' | 'mantle' | 'lower' | 'vault' | 'push' | 'shimmy';
type Move = {
  kind: MoveKind;
  t: number;
  dur: number;
  from: THREE.Vector3; // feet
  to: THREE.Vector3; // feet
  apex: number;
  anim: AnimName;
  ledge: Ledge | null;
  next: Ledge | null;
  dir: THREE.Vector3;
  speed: number;
};

const FEET = PHYS.capsuleHalfHeight + PHYS.capsuleRadius; // capsule center -> feet
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

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
const smooth = THREE.MathUtils.smoothstep;

/**
 * Kinematic character controller: run, variable jump, coyote time, jump buffer, air control, gravity,
 * ledge catch while falling, hang / shimmy / climb / drop / wall push-off, mantle, vault, climb-down
 * to hang, landing roll. Falling never kills.
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
  private move: Move | null = null;
  private hangRoot = new THREE.Vector3();
  private ikWeight = 0;
  private stepDist = 0;
  private jumpAnimTimer = 0;
  private wish = new THREE.Vector3();
  private wishLen = 0;
  private takeoffPos = new THREE.Vector3();
  private takeoffSlow = false;
  private jumpedThisTick = false;
  private pushTimer = 0;
  private rollT = 0;
  private rollDir = new THREE.Vector3();
  private rollSpeed = 0;
  // visual polish
  private catchFrom = new THREE.Vector3();
  private catchT = 1;
  private swingAmp = 0;
  private swingT = 0;
  private lean = 0;
  private visualYaw = Math.PI;

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
  get isHanging() { return this.state === 'hang' || (this.state === 'move' && this.move?.kind === 'shimmy'); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get moveKind() { return this.state === 'move' ? this.move?.kind ?? null : null; }

  setModel(m: CharacterModel) {
    this.model = m;
    this.syncVisual(1, 0);
  }

  teleport(feet: THREE.Vector3, yaw: number) {
    this.pos.set(feet.x, feet.y + FEET, feet.z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = this.prevYaw = this.visualYaw = yaw;
    this.state = 'air';
    this.ledge = null;
    this.move = null;
    this.airTime = 0;
    this.fallPeakY = feet.y;
    this.regrab = 0.3;
    this.takeoffSlow = true;
    this.takeoffPos.set(1e6, -1e6, 1e6);
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.renderPos.copy(feet);
  }

  private setBody() {
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
  }

  /** Fixed-step simulation. camYaw: camera azimuth (0 = camera on +Z looking toward -Z). */
  fixedUpdate(dt: number, input: Input, camYaw: number) {
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    const jumpPressed = input.consumeJump();
    const dropPressed = input.consumeDrop();
    if (this.frozen) return;

    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    this.wish.set(rx * input.moveX + fx * input.moveY, 0, rz * input.moveX + fz * input.moveY);
    this.wishLen = Math.min(1, this.wish.length());
    if (this.wishLen > 1e-3) this.wish.normalize();

    this.regrab = Math.max(0, this.regrab - dt);
    this.jumpAnimTimer = Math.max(0, this.jumpAnimTimer - dt);
    if (jumpPressed) this.jumpBuffer = PHYS.jumpBuffer; else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.jumpedThisTick = false;

    switch (this.state) {
      case 'hang': this.updateHang(dt, dropPressed); break;
      case 'move': this.updateMove(dt); break;
      default: this.updateLocomotion(dt, input, dropPressed); break;
    }

    if (this.pos.y < PHYS.safetyFloorY) {
      this.teleport(this.spawnPoint, this.spawnYaw);
      this.events.push({ type: 'rescue' });
    }
  }

  // ------------------------------------------------------------------ locomotion
  private updateLocomotion(dt: number, input: Input, dropPressed: boolean) {
    const wishLen = this.wishLen;
    if (this.state === 'land') {
      this.landTimer -= dt;
      if (this.landTimer <= 0 || (this.landTimer < 0.3 && (wishLen > 0.2 || this.jumpBuffer > 0))) this.state = this.grounded ? 'ground' : 'air';
    }
    if (this.state === 'roll') {
      this.rollT += dt;
      if (this.rollT >= PHYS.roll.time) this.state = this.grounded ? 'ground' : 'air';
    }

    // climb down into a hang (THẢ / E at an edge)
    if (dropPressed && this.state === 'ground' && this.grounded) {
      const f = _v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).clone();
      const dirs = [f];
      if (wishLen > 0.2) dirs.unshift(this.wish.clone());
      dirs.push(f.clone().negate(), new THREE.Vector3(-f.z, 0, f.x), new THREE.Vector3(f.z, 0, -f.x));
      for (const d of dirs) if (this.tryLowerAt(d, false)) return;
    }

    // --- horizontal velocity
    const control = this.state === 'land' ? 0.15 : 1;
    if (this.state === 'roll') {
      const k = this.rollT / PHYS.roll.time;
      // never roll off an edge: brake when the ground ahead ends
      if (this.grounded && !this.groundAhead(this.rollDir, 0.7)) this.rollSpeed *= 0.5;
      const sp = this.rollSpeed * (1 - 0.35 * k);
      const steer = wishLen > 0.2 ? this.wish : this.rollDir;
      this.rollDir.lerp(steer, Math.min(1, dt * 2)).normalize();
      this.vel.x = this.rollDir.x * sp;
      this.vel.z = this.rollDir.z * sp;
      this.yaw = Math.atan2(this.rollDir.x, this.rollDir.z);
    } else {
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
      if (wishLen > 0.1 && this.state !== 'land') {
        const targetYaw = Math.atan2(this.wish.x, this.wish.z);
        const turn = (this.grounded ? PHYS.turnSpeedGround : PHYS.turnSpeedAir) * dt;
        this.yaw = approachAngle(this.yaw, targetYaw, turn);
      }
    }

    // --- jump (coyote + buffer)
    if (this.grounded) this.coyote = PHYS.coyoteTime; else this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.state !== 'land') {
      this.vel.y = PHYS.jumpVelocity;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.jumping = true;
      this.jumpedThisTick = true;
      this.grounded = false;
      this.state = 'air';
      this.airTime = 0;
      this.fallPeakY = this.feetY;
      this.jumpAnimTimer = 0.45;
      this.takeoffPos.set(this.pos.x, this.feetY, this.pos.z);
      this.takeoffSlow = false;
      this.events.push({ type: 'jump' });
    }
    if (this.jumping && !input.jumpHeld && this.vel.y > 0) {
      this.vel.y *= PHYS.jumpCutMultiplier;
      this.jumping = false;
    }
    if (this.vel.y <= 0) this.jumping = false;

    // --- gravity
    if (!this.grounded || this.vel.y > 0) {
      const g = this.vel.y > 0 ? PHYS.gravityUp : PHYS.gravityDown;
      this.vel.y = Math.max(-PHYS.terminalVelocity, this.vel.y - g * dt);
    } else this.vel.y = -1.5;

    // --- move with the character controller
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, COLLISION.QUERY_PLAYER_MOVE);
    const mv = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    const hSpeedBefore = this.speed;
    this.grounded = this.controller.computedGrounded();
    this.pos.x += mv.x;
    this.pos.y += mv.y;
    this.pos.z += mv.z;
    // bumpy surfaces (Meshy roofs/islands): a single tick without contact is not a fall
    if (!this.grounded && wasGrounded && !this.jumpedThisTick && this.vel.y <= 0) {
      const g = this.physics.raycast(new THREE.Vector3(this.pos.x, this.pos.y - FEET + 0.08, this.pos.z), DOWN, 0.32);
      if (g && g.normal.y > 0.6) this.grounded = true;
    }
    if (desired.y > 0 && mv.y < desired.y * 0.5 - 1e-4) this.vel.y = Math.min(this.vel.y, 0);
    const blockedX = Math.abs(desired.x) > 1e-5 ? mv.x / desired.x : 1;
    const blockedZ = Math.abs(desired.z) > 1e-5 ? mv.z / desired.z : 1;
    if (!this.grounded) {
      if (blockedX < 0.5) this.vel.x *= Math.max(0, blockedX);
      if (blockedZ < 0.5) this.vel.z *= Math.max(0, blockedZ);
    }
    this.setBody();

    if (this.grounded) {
      if (!wasGrounded && (this.state === 'air' || this.state === 'roll')) {
        const drop = this.fallPeakY - this.feetY;
        this.events.push({ type: 'land', drop, speed: fallSpeed });
        const r = PHYS.roll;
        const hdir = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize();
        if (this.state === 'air' && drop >= r.minDrop && drop <= r.maxDrop && hSpeedBefore >= r.minSpeed && this.groundAhead(hdir, 1.3) && this.groundAhead(hdir, 2.6)) {
          this.state = 'roll';
          this.rollT = 0;
          this.rollDir.copy(hdir);
          this.rollSpeed = Math.min(7, hSpeedBefore * 0.85);
          this.model?.play('roll', 0.06, true);
          this.events.push({ type: 'roll', drop });
        } else if (this.state === 'air' && drop > PHYS.hardLandingDrop) {
          this.state = 'land';
          this.landTimer = 0.75;
          this.vel.x *= 0.2;
          this.vel.z *= 0.2;
          this.model?.play('land', 0.08, true);
        } else if (this.state === 'air') {
          this.state = 'ground';
          // stick the landing when the player is not pushing on: avoids sliding off small platforms
          if (wishLen < 0.2) { this.vel.x *= 0.35; this.vel.z *= 0.35; }
        }
      } else if (this.state === 'air') this.state = 'ground';
      this.airTime = 0;
      this.fallPeakY = this.feetY;
      const sp = this.speed;
      this.stepDist += sp * dt;
      const stride = sp > 4.5 ? 1.7 : 1.1;
      if (this.stepDist > stride && sp > 0.8 && this.state === 'ground') { this.stepDist = 0; this.events.push({ type: 'step', run: sp > 4.5 }); }
      // running into a low obstacle -> vault over / mantle onto it
      if (this.state === 'ground' && this.tryObstacle(dt, blockedX < 0.6 || blockedZ < 0.6)) return;
    } else {
      if (wasGrounded && !this.jumpedThisTick && (this.state === 'ground' || this.state === 'roll')) {
        // stepped / ran off an edge
        this.takeoffPos.set(this.prevPos.x, this.prevPos.y - FEET, this.prevPos.z);
        this.takeoffSlow = wishLen < 0.55 && hSpeedBefore < 3.8;
        this.state = 'air';
        if (this.takeoffSlow && hSpeedBefore > 0.3) {
          // walking gently off a ledge: turn around and lower into a hang instead of falling
          const d = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize();
          if (this.tryLowerAt(d, true)) return;
        }
      }
      if (this.state === 'ground') this.state = 'air';
      this.airTime += dt;
      this.fallPeakY = Math.max(this.fallPeakY, this.feetY);
      if (this.state === 'air' && this.regrab <= 0) this.tryAirLedge(dt);
    }
  }

  /** Is there walkable ground about `dist` metres ahead (within +-0.6 m of the feet)? */
  private groundAhead(dir: THREE.Vector3, dist: number) {
    const p = new THREE.Vector3(this.pos.x + dir.x * dist, this.feetY + 0.6, this.pos.z + dir.z * dist);
    const h = this.physics.raycast(p, DOWN, 1.2);
    return !!h && h.normal.y > 0.6;
  }

  /** Probe for a ledge in direction dir. sweep extends the accepted range (fast falls). */
  private findLedge(dir: THREE.Vector3, sweep: number, maxReach = PHYS.capsuleRadius + PHYS.ledge.reach, heights = [1.9, 1.6, 1.3, 1.0, 0.7, 0.45]): Ledge | null {
    const physics = this.physics;
    const feet = this.feetY;
    let wall = null as ReturnType<Physics['raycast']>;
    for (const h of heights) {
      const hit = physics.raycast(new THREE.Vector3(this.pos.x, feet + h, this.pos.z), dir, maxReach);
      if (hit && Math.abs(hit.normal.y) < 0.55) { wall = hit; break; }
    }
    if (!wall) return null;
    const n = wall.normal.clone().setY(0);
    if (n.lengthSq() < 1e-4) return null;
    n.normalize();
    if (n.dot(dir) > -0.25) return null;
    const L = PHYS.ledge;
    const top = feet + L.maxRel + 0.45 + sweep;
    const o2 = wall.point.clone().addScaledVector(n, -0.24);
    o2.y = top;
    const down = physics.raycast(o2, DOWN, top - (feet + L.mantleMinRel) + 0.1);
    if (!down || down.distance < 0.04 || down.normal.y < 0.72) return null;
    const ledgeY = down.point.y;
    const rel = ledgeY - feet;
    if (rel < L.mantleMinRel || rel > L.maxRel + sweep) return null;
    return this.buildLedge(wall.point, n, ledgeY, rel, true);
  }

  /** Refine the lip position and check standing room + hang placement. */
  private buildLedge(wallPoint: THREE.Vector3, n: THREE.Vector3, ledgeY: number, rel: number, aimAtPlayer = false): Ledge {
    const physics = this.physics;
    const reach = PHYS.capsuleRadius + PHYS.ledge.reach;
    // aim the lip probe straight in front of the body so the hands land where the player is
    const toPlayer = new THREE.Vector3(this.pos.x - wallPoint.x, 0, this.pos.z - wallPoint.z);
    const tangent = new THREE.Vector3(-n.z, 0, n.x);
    const along = aimAtPlayer ? THREE.MathUtils.clamp(toPlayer.dot(tangent), -0.6, 0.6) : 0;
    const o3 = wallPoint.clone().addScaledVector(tangent, along).addScaledVector(n, reach);
    o3.y = ledgeY - 0.07;
    let lip = physics.raycast(o3, n.clone().negate(), reach + 0.6);
    if (!lip) { o3.copy(wallPoint).addScaledVector(n, reach); o3.y = ledgeY - 0.07; lip = physics.raycast(o3, n.clone().negate(), reach + 0.6); }
    let edge: THREE.Vector3;
    if (lip && Math.abs(lip.normal.y) < 0.6) {
      edge = lip.point.clone();
      const ln = lip.normal.clone().setY(0);
      if (ln.lengthSq() > 1e-4) n = ln.normalize();
    } else edge = wallPoint.clone();
    edge.y = ledgeY;
    // room to stand on top (follow the real surface: Meshy rims are bumpy)
    const stand = edge.clone().addScaledVector(n, -0.5);
    const sp = physics.raycast(new THREE.Vector3(stand.x, ledgeY + 1.0, stand.z), DOWN, 1.4);
    const standY = sp && sp.normal.y > 0.6 && sp.point.y < ledgeY + 0.45 ? sp.point.y : ledgeY;
    stand.y = standY + FEET + 0.08;
    const canClimb = !physics.capsuleOverlaps(stand, PHYS.capsuleHalfHeight, PHYS.capsuleRadius * 0.85);
    const hand = this.model?.handHangHeight ?? 1.9;
    let hangCenter: THREE.Vector3 | null = null;
    for (const d of [0.36, 0.46, 0.58]) {
      const c = edge.clone().addScaledVector(n, d);
      c.y = ledgeY - hand + FEET;
      if (!physics.capsuleOverlaps(c, PHYS.capsuleHalfHeight * 0.8, PHYS.capsuleRadius * 0.75)) { hangCenter = c; break; }
    }
    return { edge, normal: n.clone(), y: ledgeY, rel, canClimb, standY, hangCenter };
  }

  /** Airborne: catch ledges while falling (any side), grab while jumping, pull up when just short. */
  private tryAirLedge(dt: number) {
    const L = PHYS.ledge;
    const fallSpeed = Math.max(0, -this.vel.y);
    if (this.vel.y > L.maxUpVelocity) return;
    const falling = this.vel.y < 0;
    if (falling && fallSpeed > L.catchMaxFallSpeed) return;
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const dirs: THREE.Vector3[] = [];
    if (this.wishLen > 0.2) dirs.push(this.wish.clone());
    dirs.push(f);
    if (hv.lengthSq() > 0.36) dirs.push(hv.clone().normalize());
    if (falling) for (const a of [0.8, -0.8, 1.57, -1.57, 2.36, -2.36, Math.PI]) dirs.push(f.clone().applyAxisAngle(UP, a));
    const sweep = fallSpeed * dt + 0.05;
    for (const d of dirs) {
      const ledge = this.findLedge(d, sweep);
      if (!ledge) continue;
      const n = ledge.normal;
      // intent: never grab when the player pushes away from the wall
      if (this.wishLen > 0.3 && this.wish.dot(n) > 0.55) continue;
      // do not snatch the edge you just ran/jumped off on purpose
      if (!this.takeoffSlow && this.airTime < 0.4 && Math.hypot(ledge.edge.x - this.takeoffPos.x, ledge.edge.z - this.takeoffPos.z) < 1.3 && Math.abs(ledge.y - this.takeoffPos.y) < 0.6) continue;
      const toward = Math.max(hv.dot(n.clone().negate()) / Math.max(hv.length(), 0.001), this.wishLen > 0.2 ? -this.wish.dot(n) : -1);
      // just short of the top: pull up (mantle)
      if (ledge.canClimb && ledge.rel < L.mantleMaxRel && toward > 0.3 && fallSpeed < 8) { this.startMantle(ledge); return; }
      if (ledge.rel < L.minRel || !ledge.hangCenter || !ledge.canClimb) continue;
      // travelling away from this wall (e.g. jumped off it toward something else): let the player fly
      if (hv.dot(n) > 1.0) continue;
      // rising grabs only in the travel direction; falling catches in any direction
      if (!falling && toward < 0.2) continue;
      this.enterHang(ledge, falling ? fallSpeed : 0);
      return;
    }
  }

  /** Running into a hip-high obstacle: vault over thin ones, mantle onto deep ones. */
  private tryObstacle(dt: number, blocked: boolean) {
    const V = PHYS.vault;
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (this.wishLen < 0.35 || this.wish.dot(f) < 0.8) { this.pushTimer = 0; return false; }
    const sp = this.speed;
    const ledge = this.findLedge(f, 0, PHYS.capsuleRadius + (sp > V.minSpeed ? 0.75 : 0.2), [1.0, 0.75, 0.55]);
    if (!ledge || ledge.rel < V.minRel || ledge.rel > V.maxRel) { this.pushTimer = 0; return false; }
    const n = ledge.normal;
    const feet = this.feetY;
    if (sp >= V.minSpeed) {
      // depth of the obstacle
      let depth = -1;
      for (const d of [0.35, 0.6, 0.85, 1.1, 1.35]) {
        const p = ledge.edge.clone().addScaledVector(n, -d);
        p.y = ledge.y + 0.3;
        const h = this.physics.raycast(p, DOWN, 0.7);
        if (!h || h.point.y < ledge.y - 0.35) { depth = d; break; }
      }
      if (depth > 0 && depth <= V.maxDepth) {
        const p = ledge.edge.clone().addScaledVector(n, -(depth + 0.85));
        p.y = ledge.y + 0.3;
        const land = this.physics.raycast(p, DOWN, ledge.y + 0.3 - (feet - 3));
        if (land && land.normal.y > 0.7 && land.point.y < ledge.y - 0.3) {
          const c = land.point.clone();
          c.y += FEET + 0.05;
          if (!this.physics.capsuleOverlaps(c, PHYS.capsuleHalfHeight, PHYS.capsuleRadius * 0.9)) {
            this.startVault(land.point, ledge.y + 0.35, Math.max(sp, 5.2), f);
            return true;
          }
        }
      }
    }
    // deep obstacle: mantle once the player has pushed against it for a moment
    if (ledge.canClimb && ledge.rel >= 0.6 && blocked) {
      this.pushTimer += dt;
      if (this.pushTimer > 0.12) { this.pushTimer = 0; this.startMantle(ledge); return true; }
    }
    return false;
  }

  /** From standing on top, find the edge in direction d and lower into a hang below it. */
  private tryLowerAt(d: THREE.Vector3, alreadyOff: boolean) {
    const physics = this.physics;
    const feet = alreadyOff ? this.takeoffPos.y : this.feetY;
    const base = alreadyOff ? this.takeoffPos : new THREE.Vector3(this.pos.x, feet, this.pos.z);
    if (!alreadyOff) {
      const ahead = new THREE.Vector3(base.x + d.x * 0.55, feet + 0.3, base.z + d.z * 0.55);
      if (physics.raycast(ahead, DOWN, 0.8)) return false; // ground continues
    }
    const out = alreadyOff ? 1.0 : 1.15;
    const o = new THREE.Vector3(base.x + d.x * out, feet - 0.25, base.z + d.z * out);
    const face = physics.raycast(o, d.clone().negate(), alreadyOff ? 2.4 : 1.3);
    if (!face || Math.abs(face.normal.y) > 0.55) return false;
    const n = face.normal.clone().setY(0).normalize();
    if (n.dot(d) < 0.4) return false;
    const tp = face.point.clone().addScaledVector(n, -0.2);
    tp.y = feet + 0.4;
    const top = physics.raycast(tp, DOWN, 0.9);
    if (!top || top.normal.y < 0.72 || Math.abs(top.point.y - feet) > 0.35) return false;
    const ledgeY = top.point.y;
    // must be a real drop (not a small step)
    const below = physics.raycast(new THREE.Vector3(face.point.x + n.x * 0.7, ledgeY - 0.3, face.point.z + n.z * 0.7), DOWN, 1.5);
    if (below) return false;
    const ledge = this.buildLedge(face.point, n, ledgeY, 0);
    if (!ledge.hangCenter) return false;
    const hand = this.model?.handHangHeight ?? 1.9;
    const hangFeet = ledge.edge.clone().addScaledVector(ledge.normal, 0.2);
    hangFeet.y = ledge.y - hand;
    const from = alreadyOff ? new THREE.Vector3(this.pos.x, this.feetY, this.pos.z) : new THREE.Vector3(this.pos.x, feet, this.pos.z);
    this.yaw = Math.atan2(-n.x, -n.z);
    this.prevYaw = this.yaw; // turn around instantly (the reverse climb starts facing the wall)
    this.vel.set(0, 0, 0);
    this.beginMove({ kind: 'lower', dur: PHYS.ledge.lowerTime, from, to: hangFeet, anim: 'climb', ledge, apex: 0 });
    this.model?.play('climb', 0.15, true, { reverse: true, timeScale: (this.model.durations.climb ?? 1.86) / PHYS.ledge.lowerTime });
    this.events.push({ type: 'lower' });
    return true;
  }

  // ------------------------------------------------------------------ hanging
  private hangFeet(l: Ledge) {
    const hand = this.model?.handHangHeight ?? 1.9;
    const p = l.edge.clone().addScaledVector(l.normal, 0.2);
    p.y = l.y - hand;
    return p;
  }

  private enterHang(ledge: Ledge, fallSpeed: number) {
    this.catchFrom.copy(this.renderPos);
    this.catchT = 0;
    this.ledge = ledge;
    this.state = 'hang';
    this.vel.set(0, 0, 0);
    this.jumping = false;
    this.move = null;
    if (ledge.hangCenter) this.pos.copy(ledge.hangCenter);
    this.setBody();
    this.yaw = Math.atan2(-ledge.normal.x, -ledge.normal.z);
    this.hangRoot.copy(this.hangFeet(ledge));
    this.fallPeakY = this.feetY;
    this.swingAmp = fallSpeed > 2 ? Math.min(0.42, fallSpeed / 26) : 0.05;
    this.swingT = 0;
    this.events.push(fallSpeed > 3 ? { type: 'catch', speed: fallSpeed } : { type: 'grab' });
  }

  private updateHang(dt: number, drop: boolean) {
    const L = this.ledge!;
    this.swingT += dt;
    this.catchT += dt;
    if (drop) {
      this.state = 'air';
      this.vel.copy(L.normal).multiplyScalar(1.2);
      this.vel.y = -1;
      this.regrab = PHYS.ledge.regrabCooldown;
      this.ledge = null;
      this.airTime = 0;
      this.takeoffSlow = true;
      this.events.push({ type: 'drop' });
      return;
    }
    const left = new THREE.Vector3(-L.normal.z, 0, L.normal.x);
    const lateral = this.wishLen > 0.35 ? this.wish.dot(left) : 0;
    const away = this.wishLen > 0.35 ? this.wish.dot(L.normal) : 0;
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      if (away > 0.5) { this.startPush(); return; }
      if (L.canClimb) { this.startClimb(); return; }
    }
    if (Math.abs(lateral) > 0.5 && this.catchT > 0.15) this.tryShimmy(Math.sign(lateral));
    void dt;
  }

  private startClimb() {
    const L = this.ledge!;
    const to = L.edge.clone().addScaledVector(L.normal, -0.5);
    to.y = L.standY;
    this.beginMove({ kind: 'climb', dur: PHYS.ledge.climbTime, from: this.hangRoot.clone(), to, anim: 'climb', ledge: L, apex: 0 });
    this.model?.play('climb', 0.12, true, { timeScale: (this.model.durations.climb ?? 1.86) / PHYS.ledge.climbTime });
    this.events.push({ type: 'climb' });
  }

  private startMantle(L: Ledge) {
    const to = L.edge.clone().addScaledVector(L.normal, -0.45);
    to.y = L.standY;
    const dur = 0.3 + 0.32 * THREE.MathUtils.clamp(L.rel, 0.3, 1.3);
    this.yaw = Math.atan2(-L.normal.x, -L.normal.z);
    this.vel.set(0, 0, 0);
    this.beginMove({ kind: 'mantle', dur, from: new THREE.Vector3(this.pos.x, this.feetY, this.pos.z), to, anim: 'mantle', ledge: L, apex: 0 });
    this.model?.play('mantle', 0.08, true, { timeScale: (this.model.durations.mantle ?? 1.1) / dur });
    this.events.push({ type: 'mantle' });
  }

  private startVault(land: THREE.Vector3, apex: number, speed: number, dir: THREE.Vector3) {
    const from = new THREE.Vector3(this.pos.x, this.feetY, this.pos.z);
    const dist = Math.hypot(land.x - from.x, land.z - from.z);
    const dur = THREE.MathUtils.clamp(dist / speed, 0.42, 0.75);
    this.beginMove({ kind: 'vault', dur, from, to: land.clone(), anim: 'vault', ledge: null, apex, dir: dir.clone(), speed });
    this.model?.play('vault', 0.06, true, { timeScale: (this.model.durations.vault ?? 0.95) / (dur * 1.1) });
    this.events.push({ type: 'vault' });
  }

  private startPush() {
    const prep = PHYS.ledge.pushOff.prep;
    this.beginMove({ kind: 'push', dur: prep, from: this.hangRoot.clone(), to: this.hangRoot.clone(), anim: 'push', ledge: this.ledge, apex: 0 });
    this.model?.play('push', 0.06, true, { timeScale: (this.model.durations.push ?? 0.53) / (prep * 1.6) });
  }

  private tryShimmy(sign: number) {
    const L = this.ledge!;
    const physics = this.physics;
    const step = PHYS.ledge.shimmyStep;
    const dir = new THREE.Vector3(-L.normal.z, 0, L.normal.x).multiplyScalar(sign);
    // body path blocked sideways?
    const side = physics.raycast(this.pos.clone(), dir, step + PHYS.capsuleRadius);
    if (side) return;
    const target = L.edge.clone().addScaledVector(dir, step);
    const o = target.clone().addScaledVector(L.normal, 0.9);
    o.y = L.y - 0.08;
    const face = physics.raycast(o, L.normal.clone().negate(), 1.4);
    if (!face || Math.abs(face.normal.y) > 0.55) return;
    const n2 = face.normal.clone().setY(0).normalize();
    if (n2.dot(L.normal) < 0.75) return;
    const tp = face.point.clone().addScaledVector(n2, -0.22);
    tp.y = L.y + 0.6;
    const top = physics.raycast(tp, DOWN, 1.1);
    if (!top || top.normal.y < 0.72 || Math.abs(top.point.y - L.y) > 0.4) return;
    const next = this.buildLedge(face.point, n2, top.point.y, 0);
    if (!next.hangCenter) return;
    const to = this.hangFeet(next);
    const anim: AnimName = sign > 0 ? 'shimmyL' : 'shimmyR';
    this.beginMove({ kind: 'shimmy', dur: PHYS.ledge.shimmyCycle, from: this.hangRoot.clone(), to, anim, ledge: L, next, apex: 0 });
    this.model?.play(anim, 0.12, true, { timeScale: (this.model.durations[anim] ?? 2) / PHYS.ledge.shimmyCycle });
    this.events.push({ type: 'shimmy' });
  }

  // ------------------------------------------------------------------ scripted moves
  private beginMove(m: Partial<Move> & { kind: MoveKind; dur: number; from: THREE.Vector3; to: THREE.Vector3; anim: AnimName; ledge: Ledge | null; apex: number }) {
    this.move = { t: 0, next: null, dir: new THREE.Vector3(), speed: 0, ...m } as Move;
    this.state = 'move';
    this.grounded = false;
  }

  private moveFeet(m: Move, tn: number, out: THREE.Vector3) {
    const model = this.model;
    switch (m.kind) {
      case 'climb': {
        const p = model ? model.progress('climb', tn) : tn;
        const h = smooth(tn, 0.55, 1);
        out.lerpVectors(m.from, m.to, h);
        out.y = THREE.MathUtils.lerp(m.from.y, m.to.y, Math.max(p, smooth(tn, 0.85, 1)));
        break;
      }
      case 'mantle': {
        const p = model ? model.progress('mantle', tn) : tn;
        const h = smooth(tn, 0.35, 1);
        out.lerpVectors(m.from, m.to, h);
        out.y = THREE.MathUtils.lerp(m.from.y, m.to.y, Math.max(p, smooth(tn, 0.15, 0.75)));
        break;
      }
      case 'lower': {
        // the climb, played backwards: from standing on top (m.from) down to hanging (m.to)
        const tr = 1 - tn;
        const p = model ? model.progress('climb', tr) : tr;
        const h = smooth(tr, 0.55, 1);
        out.lerpVectors(m.to, m.from, h);
        out.y = THREE.MathUtils.lerp(m.to.y, m.from.y, Math.max(p, smooth(tr, 0.85, 1)));
        break;
      }
      case 'vault': {
        const e = tn * tn * (3 - 2 * tn) * 0.4 + tn * 0.6;
        out.lerpVectors(m.from, m.to, e);
        const hi = Math.max(m.from.y, m.to.y);
        const c = 2 * m.apex - 0.5 * (m.from.y + m.to.y);
        out.y = (1 - e) * (1 - e) * m.from.y + 2 * e * (1 - e) * Math.max(c, hi) + e * e * m.to.y;
        break;
      }
      case 'shimmy': {
        const p = model ? model.progress(m.anim, tn) : tn;
        out.lerpVectors(m.from, m.to, p);
        break;
      }
      default: out.copy(m.from);
    }
    return out;
  }

  private updateMove(dt: number) {
    const m = this.move!;
    m.t += dt;
    const tn = Math.min(1, m.t / m.dur);
    const feet = this.moveFeet(m, tn, _v);
    this.pos.set(feet.x, feet.y + FEET, feet.z);
    if (m.kind === 'shimmy' && m.next) {
      // keep the hang root/ledge in sync for IK and camera
      this.hangRoot.copy(feet);
    }
    this.setBody();
    if (tn < 1) return;
    this.move = null;
    switch (m.kind) {
      case 'climb':
      case 'mantle':
        this.pos.set(m.to.x, m.to.y + FEET + 0.02, m.to.z);
        this.state = 'ground';
        this.grounded = true;
        this.vel.set(0, 0, 0);
        if (m.kind === 'mantle' && this.wishLen > 0.5) this.vel.copy(this.wish).multiplyScalar(2.5);
        this.ledge = null;
        this.fallPeakY = m.to.y;
        break;
      case 'lower':
        this.enterHang(m.ledge!, 0);
        this.events.pop(); // no extra grab sound
        break;
      case 'vault':
        this.pos.set(m.to.x, m.to.y + FEET + 0.05, m.to.z);
        this.vel.copy(m.dir).multiplyScalar(m.speed);
        this.vel.y = -1;
        this.state = 'air';
        this.airTime = 0.2;
        this.fallPeakY = m.to.y;
        this.takeoffSlow = false;
        break;
      case 'push': {
        const L = m.ledge!;
        const P = PHYS.ledge.pushOff;
        const left = new THREE.Vector3(-L.normal.z, 0, L.normal.x);
        const lat = this.wishLen > 0.3 ? this.wish.dot(left) : 0;
        this.vel.copy(L.normal).multiplyScalar(P.out).addScaledVector(left, lat * 2.2);
        this.vel.y = P.up;
        this.yaw = Math.atan2(L.normal.x, L.normal.z);
        this.state = 'air';
        this.ledge = null;
        this.jumping = false;
        this.jumpAnimTimer = 0.45;
        this.airTime = 0;
        this.fallPeakY = this.feetY;
        this.regrab = 0.3;
        this.takeoffPos.set(L.edge.x, L.y, L.edge.z);
        this.takeoffSlow = false;
        this.model?.play('jump', 0.08, true);
        this.events.push({ type: 'push' });
        break;
      }
      case 'shimmy':
        this.ledge = m.next!;
        this.hangRoot.copy(m.to);
        if (m.next!.hangCenter) this.pos.copy(m.next!.hangCenter);
        this.state = 'hang';
        this.catchT = 1;
        this.model?.play('hang', 0.15);
        break;
    }
    this.setBody();
  }

  // ------------------------------------------------------------------ visuals
  /** Per-render-frame: interpolate, animate, procedural lean/swing, IK. */
  syncVisual(alpha: number, dt: number) {
    const m = this.model;
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    this.renderPos.y -= FEET;
    const yaw = angleLerp(this.prevYaw, this.yaw, alpha);
    if (!m) return;

    // choose animation (scripted moves set their own)
    if (this.state !== 'move') {
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
          else if (this.airTime < 0.16 && this.vel.y > -6) anim = m.current === 'run' || m.current === 'walk' || m.current === 'idle' || m.current === 'vault' ? m.current : 'fall';
          else if (this.airTime > 0.85 && this.vel.y < -15) anim = 'fallLong';
          else anim = 'fall';
          break;
        case 'land': anim = 'land'; break;
        case 'roll': anim = 'roll'; break;
        case 'hang': anim = 'hang'; break;
      }
      const fades: Partial<Record<AnimName, number>> = { jump: 0.08, hang: 0.1, land: 0.08, roll: 0.06, fallLong: 0.35 };
      m.play(anim, fades[anim] ?? 0.18);
    }

    // turn lean while running (procedural)
    const yawRate = dt > 0 ? (((yaw - this.visualYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / dt : 0;
    this.visualYaw = yaw;
    const wantLean = this.state === 'ground' ? THREE.MathUtils.clamp(-yawRate * this.speed * 0.012, -0.22, 0.22) : 0;
    this.lean = THREE.MathUtils.damp(this.lean, wantLean, 10, dt);

    // place the visual root
    const L = this.ledge;
    if (this.state === 'hang' && L) {
      const root = this.hangRoot.clone();
      // blend from where we caught the ledge
      if (this.catchT < 0.16) root.lerp(this.catchFrom, 1 - smooth(this.catchT, 0, 0.16));
      m.root.position.copy(root);
    } else {
      m.root.position.copy(this.renderPos);
    }
    m.root.rotation.set(0, yaw, 0);
    if (Math.abs(this.lean) > 0.002) m.root.rotateZ(this.lean);
    // pendulum swing after catching a ledge while falling
    if (this.state === 'hang' && L && this.swingAmp > 0.004) {
      const ang = this.swingAmp * Math.exp(-2.6 * this.swingT) * Math.cos(this.swingT * 5.6);
      const axis = new THREE.Vector3(-L.normal.z, 0, L.normal.x);
      const pivot = new THREE.Vector3(L.edge.x, L.y, L.edge.z);
      _q.setFromAxisAngle(axis, ang);
      m.root.position.sub(pivot).applyQuaternion(_q).add(pivot);
      m.root.quaternion.premultiply(_q);
    }
    m.update(dt);

    // arm IK onto the ledge lip
    let wantIK = 0;
    const mv = this.move;
    if (this.state === 'hang') wantIK = 1;
    else if (mv) {
      const tn = Math.min(1, mv.t / mv.dur);
      if (mv.kind === 'climb') wantIK = 1 - smooth(tn, 0.05, 0.4);
      else if (mv.kind === 'mantle') wantIK = 1 - smooth(tn, 0.25, 0.6);
      else if (mv.kind === 'lower') wantIK = smooth(tn, 0.6, 0.95);
      else if (mv.kind === 'shimmy') wantIK = 0.85;
      else if (mv.kind === 'push') wantIK = 1 - smooth(tn, 0.4, 0.9);
    }
    this.ikWeight = THREE.MathUtils.damp(this.ikWeight, wantIK, 18, dt);
    const ikLedge = mv?.ledge ?? L;
    if (ikLedge && this.ikWeight > 0.01) {
      const n = ikLedge.normal;
      const left = _v.set(-n.z, 0, n.x);
      let base: THREE.Vector3;
      let lOff = 0.2, rOff = -0.2;
      if (mv && mv.kind === 'shimmy' && mv.next) {
        const tn = Math.min(1, mv.t / mv.dur);
        const p = this.model!.progress(mv.anim, tn);
        base = ikLedge.edge.clone().lerp(mv.next.edge, p);
        base.y = THREE.MathUtils.lerp(ikLedge.y, mv.next.y, p);
        // hand-over-hand: the leading hand reaches first
        const lead = Math.sin(Math.min(1, tn * 1.3) * Math.PI) * 0.22;
        const dirSign = mv.anim === 'shimmyL' ? 1 : -1;
        if (dirSign > 0) lOff += lead; else rOff -= lead;
      } else base = ikLedge.edge.clone();
      base.addScaledVector(n, 0.02);
      base.y += 0.05;
      const lt = base.clone().addScaledVector(left, lOff);
      const rt = base.clone().addScaledVector(left, rOff);
      m.applyArmIK(lt, rt, this.ikWeight);
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
