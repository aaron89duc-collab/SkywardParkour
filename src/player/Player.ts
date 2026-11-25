import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYS, COLLISION } from '../config';
import { Physics } from '../core/Physics';
import { Input } from '../input/Input';
import { CharacterModel, type AnimName } from './CharacterModel';
import type { Carrier, Surface, DeviceAction } from '../world/Devices';
import type { Pad, Ring, Ladder } from '../world/Boosters';

/** Queries into dynamic world features (moving platforms, pads, rings, ladders) across all loaded maps. */
export interface WorldHooks {
  moverOf(c: RAPIER.Collider | null | undefined): Carrier | null;
  /** gameplay devices (optional): surface grip / bounce, "stood on" notices, force fields, pushes, triggers */
  surfaceOf?(c: RAPIER.Collider | null | undefined): Surface | null;
  stood?(c: RAPIER.Collider | null | undefined, feet: THREE.Vector3): void;
  field?(feet: THREE.Vector3, out: { g: number; acc: THREE.Vector3 }): void;
  push?(feet: THREE.Vector3, out: { d: THREE.Vector3; v: THREE.Vector3 }): boolean;
  touch?(feet: THREE.Vector3, vel: THREE.Vector3, airborne: boolean): DeviceAction | null;
  padOf(c: RAPIER.Collider | null | undefined): Pad | null;
  ringCrossed(a: THREE.Vector3, b: THREE.Vector3): Ring | null;
  ladders(): Ladder[];
}

export type PlayerState = 'ground' | 'air' | 'hang' | 'move' | 'land' | 'roll' | 'ladder' | 'zip';
export type PlayerEvent =
  | { type: 'jump' }
  | { type: 'bounce'; speed: number }
  | { type: 'knock' }
  | { type: 'portal' }
  | { type: 'zip' }
  | { type: 'checkpoint'; p: THREE.Vector3; yaw: number; id: string }
  | { type: 'collect'; id: string }
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
  /** went over an edge without jumping (misstep or on purpose) */
  | { type: 'slip' }
  | { type: 'drop' }
  | { type: 'step'; run: boolean }
  | { type: 'rescue' }
  | { type: 'unstuck' }
  | { type: 'pad'; kind: 'jump' | 'speed' }
  | { type: 'launch' }
  | { type: 'ring' }
  | { type: 'ladder' };

type Ledge = { edge: THREE.Vector3; normal: THREE.Vector3; y: number; rel: number; canClimb: boolean; standY: number; standOff: number; hangCenter: THREE.Vector3 | null; mover: Carrier | null };
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
const _feet = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
/** footing probes inside the capsule (radius 0.3): a support has to reach under these, not just the rim */
const INNER_PROBES = [[0, 0], [0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14]];
const WALL_DIRS = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.sin((i * Math.PI) / 4), 0, Math.cos((i * Math.PI) / 4)));
const _lp = new THREE.Vector3(), _lpN = new THREE.Vector3();
const EDGE_PROBES = [[0.27, 0], [-0.27, 0], [0, 0.27], [0, -0.27], [0.19, 0.19], [-0.19, 0.19], [0.19, -0.19], [-0.19, -0.19]];
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _dir = new THREE.Vector3();

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
const _carry = new THREE.Vector3();
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
  hooks: WorldHooks | null = null;
  /** moving platform under the feet (carried along every tick) */
  riding: Carrier | null = null;
  /** devices: grip of the surface stood on (ice < 1), force field at the feet, pushes, zipline ride */
  private grip = 1;
  private fieldOut = { g: 1, acc: new THREE.Vector3() };
  private pushOut = { d: new THREE.Vector3(), v: new THREE.Vector3() };
  zip: { a: THREE.Vector3; dir: THREE.Vector3; L: number; s: number; v: number; max: number; id: string } | null = null;
  /** horizontal speed actually achieved last tick (walls included) */
  actualSpeed = 0;
  ladder: Ladder | null = null;

  private coyote = 0;
  private jumpBuffer = 0;
  private jumping = false;
  /** how long the jump button has been held since its last press (fixed-step time) */
  private pressHold = 0;
  private pressHeld = false;
  /** hold time credited to the current jump (decides its height within PHYS.jumpHoldWindow) */
  private jumpHoldT = 0;
  private jumpBaseY = 0;
  private snapOn = true;
  /** feet height where the current airborne phase began (camera framing) */
  airBaseY = 0;
  private lastState = '';
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
  /** just went over an edge without jumping: a pull back toward it within this time still grabs it */
  private reflexT = 0;
  private reflexDir = new THREE.Vector3();
  /** walked (not ran) off an edge: the body tips over the edge first (lighter gravity for a moment) */
  private slipT = 0;
  /** sliding off a lip of a wall: pushed away from the wall for a moment, the stick cannot hold the body on it */
  private lipPushT = 0;
  private lipN = new THREE.Vector3();
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
  // boosts (speed pad / ring)
  private boostT = 0;
  private boostDur = 1;
  private boostSpeed = 0;
  private boostDir = new THREE.Vector3();
  private padCool = 0;
  /** a jump pad being pressed down (launch after 0.1 s) */
  private padCharge: { pad: Pad; t: number } | null = null;
  /** flying after a pad launch: momentum is kept, steering is partial */
  padFlight: { maxSpeed: number; t: number } | null = null;
  /** how long the stick has been held away from the wall while hanging (let go at PHYS.ledge.letGoTime) */
  private letGoT = 0;
  private ladderCool = 0;
  private ladderV = 0;

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
  get isHanging() { return this.state === 'hang' || this.state === 'ladder' || (this.state === 'move' && this.move?.kind === 'shimmy'); }
  get boosting() { return this.boostT > 0; }
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
    this.zip = null;
    this.airTime = 0;
    this.fallPeakY = feet.y;
    this.regrab = 0.3;
    this.takeoffSlow = true;
    this.reflexT = 0;
    this.slipT = 0;
    this.takeoffPos.set(1e6, -1e6, 1e6);
    this.riding = null;
    this.ladder = null;
    this.boostT = 0;
    this.padFlight = null;
    this.padCharge = null;
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    this.renderPos.copy(feet);
  }

  /** Admin fly mode: move without collisions, keeping render interpolation smooth (frozen must be true). */
  flyTo(p: THREE.Vector3, yaw?: number) {
    this.pos.copy(p);
    if (yaw !== undefined) this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this.state = 'air';
    this.ledge = null; this.move = null; this.ladder = null; this.riding = null; this.padFlight = null; this.padCharge = null;
    this.setBody();
  }

  /** standing only on a thin lip of a wall (no ground under the capsule's inner footprint, a wall right beside it):
   *  the wall's normal (pointing away from it), else null */
  private lipWallNormal(): THREE.Vector3 | null {
    const f = this.pos.y - FEET;
    for (const [ox, oz] of INNER_PROBES) {
      const g = this.physics.raycast(_lp.set(this.pos.x + ox, f + 0.15, this.pos.z + oz), DOWN, 0.45);
      if (g && g.normal.y > 0.6) return null; // real footing
    }
    for (const d of WALL_DIRS) {
      const w = this.physics.raycast(_lp.set(this.pos.x, f + 0.55, this.pos.z), d, PHYS.capsuleRadius + 0.14);
      if (w && Math.abs(w.normal.y) < 0.35) return _lpN.set(w.normal.x, 0, w.normal.z).normalize();
    }
    return null;
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
    this.padCool = Math.max(0, this.padCool - dt);
    this.ladderCool = Math.max(0, this.ladderCool - dt);
    this.boostT = Math.max(0, this.boostT - dt);
    this.jumpAnimTimer = Math.max(0, this.jumpAnimTimer - dt);
    if (jumpPressed) this.jumpBuffer = PHYS.jumpBuffer + 1e-4; else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const heldFor = input.consumeHeldFor();
    if (jumpPressed) {
      this.pressHold = 0; this.pressHeld = true;
      if (heldFor !== null && !input.jumpHeld) { this.pressHold = heldFor; this.pressHeld = false; } // tapped within one frame
    } else if (this.pressHeld) {
      if (input.jumpHeld) this.pressHold += dt;
      else {
        this.pressHeld = false;
        // the event timestamps know the real hold time (the frame rate only decides when we notice)
        if (heldFor !== null) { const add = heldFor - this.pressHold; this.pressHold = heldFor; if (this.jumping) this.jumpHoldT += add; }
      }
    }
    this.jumpedThisTick = false;
    // snap-to-ground only while walking on the ground: never pull the character down during a jump
    const wantSnap = (this.state === 'ground' || this.state === 'roll' || this.state === 'land') && this.vel.y <= 0;
    if (wantSnap !== this.snapOn) {
      this.snapOn = wantSnap;
      if (wantSnap) this.controller.enableSnapToGround(PHYS.snapDistance); else this.controller.disableSnapToGround();
    }

    this.applyCarry();
    const free = this.state === 'ground' || this.state === 'air' || this.state === 'land' || this.state === 'roll';
    if (free && this.hooks?.push) this.devicePush();
    switch (this.state) {
      case 'zip': this.updateZip(dt); break;
      case 'hang': this.updateHang(dt, dropPressed); break;
      case 'move': this.updateMove(dt); break;
      case 'ladder': this.updateLadder(dt, input, dropPressed); break;
      default: this.updateLocomotion(dt, input, dropPressed); break;
    }
    if (this.hooks && (this.state === 'air' || this.state === 'ground' || this.state === 'roll')) {
      const ring = this.hooks.ringCrossed(this.prevPos, this.pos);
      if (ring) this.hitRing(ring);
      const act = this.hooks.touch?.(_feet.set(this.pos.x, this.pos.y - FEET, this.pos.z), this.vel, this.state === 'air');
      if (act) this.deviceAction(act);
    }

    if (this.state === 'air' && this.lastState !== 'air') this.airBaseY = this.jumpedThisTick ? this.jumpBaseY : this.prevPos.y - FEET;
    this.lastState = this.state;
    this.checkStuck(dt);
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

    void dropPressed; // no drop button: controls are run, steer and jump

    // jump pad pressed down: hold still for the squash, then launch
    if (this.padCharge) {
      this.padCharge.t -= dt;
      this.vel.x *= 0.6; this.vel.z *= 0.6;
      if (this.padCharge.t <= 0) { const pc = this.padCharge.pad; this.padCharge = null; this.launchPad(pc); }
    }
    if (this.padFlight) this.padFlight.t += dt;

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
      const boost = this.boostT > 0 ? this.boostT / this.boostDur : 0;
      let maxSp = PHYS.runSpeed + Math.max(0, this.boostSpeed - PHYS.runSpeed) * boost;
      const hv = _w.set(this.vel.x, 0, this.vel.z);
      const pf = !this.grounded ? this.padFlight : null;
      if (pf) maxSp = pf.maxSpeed;
      let target: THREE.Vector3;
      if (pf) target = wishLen > 0.05 ? _v.copy(this.wish).multiplyScalar(wishLen * maxSp) : _v.copy(hv); // momentum is kept
      else if (boost > 0 && wishLen < 0.2) target = _v.copy(this.boostDir).multiplyScalar(maxSp);
      else if (!this.grounded && wishLen > 0.05) {
        // air: steer, but keep the speed already carried along the stick direction (a half-pushed stick
        // never brakes a running jump; pulling back does)
        const along = hv.x * this.wish.x + hv.z * this.wish.z;
        const mag = Math.max(wishLen * maxSp, Math.min(along, Math.max(maxSp, hv.length())));
        target = _v.copy(this.wish).multiplyScalar(mag);
      } else target = _v.copy(this.wish).multiplyScalar(wishLen * maxSp * control);
      let accel: number;
      if (pf) accel = 12; // steer the flight, never snap it
      else if (this.grounded) accel = (wishLen > 0.05 ? PHYS.groundAccel : PHYS.groundDecel) * this.grip; // ice: little grip
      else accel = wishLen > 0.05 ? PHYS.airAccel : PHYS.airDecel;
      const diff = target.sub(hv);
      const dl = diff.length();
      const maxStep = accel * dt;
      if (dl > maxStep) diff.multiplyScalar(maxStep / dl);
      this.vel.x += diff.x;
      this.vel.z += diff.z;
      if (this.lipPushT > 0) { this.lipPushT -= dt; this.vel.x = this.lipN.x * 2.2; this.vel.z = this.lipN.z * 2.2; }
      if (wishLen > 0.1 && this.state !== 'land') {
        const targetYaw = Math.atan2(this.wish.x, this.wish.z);
        const turn = (this.grounded ? PHYS.turnSpeedGround : PHYS.turnSpeedAir) * dt;
        this.yaw = approachAngle(this.yaw, targetYaw, turn);
      }
    }

    // --- jump (coyote + buffer)
    // coyote: a press up to PHYS.coyoteTime after the last grounded tick still jumps (inclusive, tick-exact)
    if (this.grounded) this.coyote = PHYS.coyoteTime + 1e-4; else this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && this.state !== 'land') {
      this.vel.y = PHYS.jumpVelocity;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.jumping = true;
      this.jumpHoldT = this.pressHold;
      this.jumpBaseY = this.feetY;
      this.jumpedThisTick = true;
      this.grounded = false;
      this.state = 'air';
      this.airTime = 0;
      this.reflexT = 0;
      this.slipT = 0;
      this.fallPeakY = this.feetY;
      this.jumpAnimTimer = 0.45;
      this.takeoffPos.set(this.pos.x, this.feetY, this.pos.z);
      this.takeoffSlow = false;
      if (this.riding) { const rv = this.riding.velAt(this.pos, dt); this.vel.x += rv.x; this.vel.z += rv.z; this.vel.y += Math.max(0, rv.y); }
      this.riding = null;
      this.events.push({ type: 'jump' });
    }
    if (this.jumping && this.vel.y > 0) {
      if (this.pressHeld && input.jumpHeld) {
        if (!this.jumpedThisTick) this.jumpHoldT += dt;
        if (this.jumpHoldT >= PHYS.jumpHoldWindow) this.jumping = false; // committed: full jump
      } else {
        // released early: the apex depends only on the hold time (same tap -> same arc at any frame rate)
        const full = (PHYS.jumpVelocity * PHYS.jumpVelocity) / (2 * PHYS.gravityUp);
        const k = Math.min(1, this.jumpHoldT / PHYS.jumpHoldWindow);
        const apex = PHYS.jumpMinApex + (full - PHYS.jumpMinApex) * k;
        const left = Math.max(0, apex - (this.feetY - this.jumpBaseY));
        this.vel.y = Math.min(this.vel.y, Math.sqrt(2 * PHYS.gravityUp * left));
        this.jumping = false;
      }
    }
    if (this.vel.y <= 0) this.jumping = false;

    // --- force fields (fans, low gravity)
    this.fieldOut.g = 1; this.fieldOut.acc.set(0, 0, 0);
    this.hooks?.field?.(_feet.set(this.pos.x, this.pos.y - FEET, this.pos.z), this.fieldOut);
    const facc = this.fieldOut.acc;
    if (facc.lengthSq() > 0) {
      this.vel.x += facc.x * dt; this.vel.z += facc.z * dt;
      if (facc.y > 0) { this.vel.y = Math.max(this.vel.y, this.grounded ? 0 : this.vel.y) + facc.y * dt; if (this.vel.y > 0.5) { this.grounded = false; if (this.state === 'ground') this.state = 'air'; } }
    }
    // --- gravity
    if (!this.grounded || this.vel.y > 0) {
      let g = (this.vel.y > 0 ? PHYS.gravityUp : PHYS.gravityDown) * this.fieldOut.g;
      if (this.slipT > 0) { g *= PHYS.ledge.slipGravity; this.slipT = Math.max(0, this.slipT - dt); }
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
    // a lip on a wall (the seam of stacked containers, a sill) only touches the rim of the capsule: that is no
    // footing. Without this, pressing jump again and again walked the player up a wall one lip at a time.
    if (!this.jumpedThisTick) {
      // resting on a lip without real footing (grounded by the controller, or held up in the air by it):
      // no jump from it, slide off away from the wall, and no fall speed builds up while held
      const heldUp = !this.grounded && desired.y < -1e-3 && mv.y > desired.y * 0.3;
      if (this.grounded || heldUp) {
        const n = this.lipWallNormal();
        if (n) {
          this.grounded = false;
          this.vel.y = Math.max(Math.min(this.vel.y, 0), -2);
          this.lipN.copy(n);
          this.lipPushT = 0.2;
        }
      }
    }
    const blockedX = Math.abs(desired.x) > 1e-5 ? mv.x / desired.x : 1;
    const blockedZ = Math.abs(desired.z) > 1e-5 ? mv.z / desired.z : 1;
    if (!this.grounded) {
      if (blockedX < 0.5) this.vel.x *= Math.max(0, blockedX);
      if (blockedZ < 0.5) this.vel.z *= Math.max(0, blockedZ);
    }
    // keep the ground velocity when blocked (autostep needs it on stairs); report the real speed separately
    this.actualSpeed = Math.hypot(mv.x, mv.z) / dt;
    this.setBody();

    if (this.grounded && this.padFlight && this.padFlight.t > 0.15) this.padFlight = null;
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
      this.reflexT = 0;
      this.slipT = 0;
      this.fallPeakY = this.feetY;
      const sp = this.speed;
      this.stepDist += sp * dt;
      const stride = sp > 4.5 ? 1.7 : 1.1;
      if (this.stepDist > stride && sp > 0.8 && this.state === 'ground') { this.stepDist = 0; this.events.push({ type: 'step', run: sp > 4.5 }); }
      // what are we standing on? (moving platform / pad)
      if (this.hooks) {
        let g = this.physics.raycast(new THREE.Vector3(this.pos.x, this.feetY + 0.15, this.pos.z), DOWN, 0.5);
        // standing on an edge (the body's centre already past it): look under the rim of the capsule too
        for (const [ox, oz] of EDGE_PROBES) { if (g) break; g = this.physics.raycast(new THREE.Vector3(this.pos.x + ox, this.feetY + 0.15, this.pos.z + oz), DOWN, 0.5); }
        this.riding = this.hooks.moverOf(g?.collider);
        const surf = this.hooks.surfaceOf?.(g?.collider) ?? null;
        this.grip = surf?.grip ?? 1;
        this.hooks.stood?.(g?.collider, _feet.set(this.pos.x, this.pos.y - FEET, this.pos.z));
        if (surf?.bounce && !wasGrounded && fallSpeed > 3) { this.bounceOff(surf, fallSpeed); return; }
        const pad = this.hooks.padOf(g?.collider);
        if (pad && this.state !== 'land' && this.usePad(pad)) return;
        if (this.state === 'ground' && this.tryLadder()) return;
      }
      // running into a low obstacle -> vault over / mantle onto it
      if (this.state === 'ground' && this.tryObstacle(dt, blockedX < 0.6 || blockedZ < 0.6)) return;
    } else {
      if (this.riding && wasGrounded && !this.jumpedThisTick) { const rv = this.riding.velAt(this.pos, dt); this.vel.x += rv.x; this.vel.z += rv.z; }
      this.riding = null;
      this.grip = 1;
      if (wasGrounded && !this.jumpedThisTick && (this.state === 'ground' || this.state === 'roll')) {
        // stepped / ran off an edge
        this.takeoffPos.set(this.prevPos.x, this.prevPos.y - FEET, this.prevPos.z);
        this.takeoffSlow = wishLen < 0.55 && hSpeedBefore < 3.8;
        this.state = 'air';
        // a misstep is a fall: no automatic turn-and-hang any more. Climbing down on purpose = the drop button;
        // a quick pull back toward the edge still grabs it (reflex save, see tryAirLedge)
        this.reflexT = PHYS.ledge.reflexWindow;
        this.reflexDir.set(this.vel.x, 0, this.vel.z);
        if (this.reflexDir.lengthSq() > 1e-4) this.reflexDir.normalize(); else this.reflexT = 0;
        // walking (not running) over the edge: the body tips over first instead of dropping like a stone
        if (hSpeedBefore < PHYS.ledge.slipMaxSpeed) { this.slipT = PHYS.ledge.slipTime; this.vel.y = Math.max(this.vel.y, 0); }
        this.events.push({ type: 'slip' });
      }
      if (this.state === 'ground') this.state = 'air';
      this.airTime += dt;
      this.reflexT = Math.max(0, this.reflexT - dt);
      this.fallPeakY = Math.max(this.fallPeakY, this.feetY);
      if (this.state === 'air' && this.hooks && this.tryLadder()) return;
      if (this.state === 'air' && this.regrab <= 0) this.tryAirLedge(dt);
    }
  }

  /** Is there walkable ground about `dist` metres ahead (within +-0.6 m of the feet)? */
  private groundAhead(dir: THREE.Vector3, dist: number) {
    const p = new THREE.Vector3(this.pos.x + dir.x * dist, this.feetY + 0.6, this.pos.z + dir.z * dist);
    const h = this.physics.raycast(p, DOWN, 1.2);
    return !!h && h.normal.y > 0.6;
  }

  /** Is the straight segment a->b free of solid geometry? (guards scripted moves against passing through walls) */
  private clearPath(a: THREE.Vector3, b: THREE.Vector3) {
    const d = _dir.subVectors(b, a);
    const len = d.length();
    if (len < 1e-3) return true;
    return !this.physics.raycast(a, d.divideScalar(len), len);
  }

  /** Probe for a ledge in direction dir. sweep extends the accepted range (fast falls). */
  private findLedge(dir: THREE.Vector3, sweep: number, maxReach = PHYS.capsuleRadius + PHYS.ledge.reach, heights = [1.9, 1.6, 1.3, 1.0, 0.7, 0.45], side = 0, extraRel = 0): Ledge | null {
    const physics = this.physics;
    const feet = this.feetY;
    let wall = null as ReturnType<Physics['raycast']>;
    // smart grab: when the chest probe just misses (pillar corner, narrow beam), look a hand's width to each side
    const offs = side > 0 ? [0, side, -side] : [0];
    for (const o of offs) {
      for (const h of heights) {
        const hit = physics.raycast(new THREE.Vector3(this.pos.x - dir.z * o, feet + h, this.pos.z + dir.x * o), dir, maxReach);
        if (hit && Math.abs(hit.normal.y) < 0.55) { wall = hit; break; }
      }
      if (wall) break;
    }
    if (!wall) return null;
    const n = wall.normal.clone().setY(0);
    if (n.lengthSq() < 1e-4) return null;
    n.normalize();
    if (n.dot(dir) > -0.25) return null;
    const L = PHYS.ledge;
    const top = feet + L.maxRel + 0.45 + sweep + extraRel;
    const o2 = wall.point.clone().addScaledVector(n, -0.24);
    o2.y = top;
    const down = physics.raycast(o2, DOWN, top - (feet + L.mantleMinRel) + 0.1);
    if (!down || down.distance < 0.04 || down.normal.y < 0.72) return null;
    if (this.hooks?.surfaceOf?.(down.collider)?.bounce) return null; // a trampoline throws you off: no edge to hang from
    const ledgeY = down.point.y;
    const rel = ledgeY - feet;
    if (rel < L.mantleMinRel || rel > L.maxRel + sweep + extraRel) return null;
    const ledge = this.buildLedge(wall.point, n, ledgeY, rel, true);
    ledge.mover = this.hooks?.moverOf(down.collider) ?? null;
    if (ledge.mover?.rotates) return null; // a turning jib has no edge to hang from (stand on it or nothing)
    return ledge;
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
    // room to stand on top (follow the real surface: Meshy rims are bumpy). Parapets and railings sit right on the
    // edge, so look a little further in when the first spot is taken.
    let canClimb = false, standY = ledgeY, standOff = 0.5;
    for (const off of [0.5, 0.78, 1.05]) {
      const stand = edge.clone().addScaledVector(n, -off);
      const sp = physics.raycast(new THREE.Vector3(stand.x, ledgeY + 1.0, stand.z), DOWN, 1.4);
      const sy = sp && sp.normal.y > 0.6 && sp.point.y < ledgeY + 0.45 ? sp.point.y : ledgeY;
      stand.y = sy + FEET + 0.08;
      // the top must be reachable from outside: a wall continuing above a sill / window means "inside a building"
      const ay = Math.max(sy, ledgeY) + 0.3;
      const outside = edge.clone().addScaledVector(n, 0.45);
      outside.y = ay;
      const access = this.clearPath(outside, new THREE.Vector3(stand.x, ay, stand.z)) &&
        this.clearPath(outside.setY(ay + 0.7), new THREE.Vector3(stand.x, ay + 0.7, stand.z));
      if (off === 0.5) { standY = sy; }
      if (access && !physics.capsuleOverlaps(stand, PHYS.capsuleHalfHeight, PHYS.capsuleRadius * 0.85)) { canClimb = true; standY = sy; standOff = off; break; }
      if (!access) break;
    }
    const hand = this.model?.handHangHeight ?? 1.9;
    let hangCenter: THREE.Vector3 | null = null;
    for (const d of [0.36, 0.46, 0.58]) {
      const c = edge.clone().addScaledVector(n, d);
      c.y = ledgeY - hand + FEET;
      if (!physics.capsuleOverlaps(c, PHYS.capsuleHalfHeight * 0.8, PHYS.capsuleRadius * 0.75)) { hangCenter = c; break; }
    }
    return { edge, normal: n.clone(), y: ledgeY, rel, canClimb, standY, standOff, hangCenter, mover: null };
  }

  /** Airborne: grab ledges you move or push toward (jumping or falling), pull up when just short. */
  private tryAirLedge(dt: number) {
    const L = PHYS.ledge;
    const fallSpeed = Math.max(0, -this.vel.y);
    if (this.vel.y > L.maxUpVelocity) return;
    const falling = this.vel.y < 0;
    // reflex save: went over an edge without jumping and pulls the stick back toward it within reflexWindow
    // -> back up onto it while still high, otherwise hang from it. The edge is the one just left (found from
    // the take-off point), so the save does not depend on where the falling body happens to be.
    if (this.reflexT > 0 && this.wishLen > 0.3 && this.wish.dot(this.reflexDir) < -0.5) {
      const below = this.takeoffPos.y - this.feetY;
      let lg: Ledge | null = null;
      if (below <= L.reflexMaxDrop) {
        lg = this.findLowerLedge(this.reflexDir, true);
        // odd shapes (slabs, sloped undersides): reach for it from where the body is, a hand further than usual
        if (!lg) {
          const p = this.findLedge(this.wish, fallSpeed * dt + 0.05, PHYS.capsuleRadius + L.reach + 0.45);
          if (p && p.canClimb && -this.wish.dot(p.normal) > 0.5 && Math.abs(p.y - this.takeoffPos.y) < 0.6 && p.rel >= L.mantleMinRel && p.rel <= L.maxRel && (p.rel < L.minRel || p.hangCenter)) lg = p;
        }
      }
      if (lg) {
        this.reflexT = 0;
        this.slipT = 0;
        if (below < L.reflexMantleBelow && lg.canClimb) this.startMantle(lg);
        else this.enterHang(lg, fallSpeed);
        return;
      }
    }
    if (falling && fallSpeed > L.catchMaxFallSpeed) return;
    const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    const dirs: THREE.Vector3[] = [];
    if (this.wishLen > 0.2) dirs.push(this.wish.clone());
    dirs.push(f);
    if (hv.lengthSq() > 0.36) dirs.push(hv.clone().normalize());
    if (falling) for (const a of [0.8, -0.8, 1.57, -1.57, 2.36, -2.36, Math.PI]) dirs.push(f.clone().applyAxisAngle(UP, a));
    const sweep = fallSpeed * dt + 0.05;
    // about to touch down on a floor anyway: land, do not snatch a wall beside the landing spot
    let nearFloor = false;
    if (falling) {
      const h = this.physics.raycast(new THREE.Vector3(this.pos.x, this.feetY + 0.1, this.pos.z), DOWN, 0.55 + fallSpeed * dt);
      nearFloor = !!h && h.normal.y > 0.6;
    }
    // near the apex a ledge a few cm above the hands still counts (snapped up into the hang)
    const extra = Math.abs(this.vel.y) < 2.5 ? L.assist : 0;
    // side assist only where there is intent: the stick direction, while rising / near the apex
    // (falling safety catches keep the plain centre probes, so walls beside a landing spot are left alone)
    const sideOK = this.wishLen > 0.2 && this.vel.y > -4;
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      const ledge = this.findLedge(d, sweep, undefined, undefined, i === 0 && sideOK ? L.assist : 0, extra);
      if (!ledge) continue;
      const n = ledge.normal;
      // intent: never grab when the player pushes away from the wall
      if (this.wishLen > 0.3 && this.wish.dot(n) > 0.55) continue;
      // the edge just stepped / ran / jumped off: only a quick pull back toward it grabs it again (reflex save)
      const pullBack = this.wishLen > 0.3 && -this.wish.dot(n) > 0.5;
      if (this.airTime < 0.6 && !pullBack && Math.hypot(ledge.edge.x - this.takeoffPos.x, ledge.edge.z - this.takeoffPos.z) < 1.3 && Math.abs(ledge.y - this.takeoffPos.y) < 0.6) continue;
      const toward = Math.max(hv.dot(n.clone().negate()) / Math.max(hv.length(), 0.001), this.wishLen > 0.2 ? -this.wish.dot(n) : -1);
      // just short of the top: pull up (mantle)
      if (ledge.canClimb && ledge.rel < L.mantleMaxRel && toward > 0.3 && fallSpeed < 8) { this.startMantle(ledge); return; }
      if (ledge.rel < L.minRel || !ledge.hangCenter || !ledge.canClimb || nearFloor) continue;
      // travelling away from this wall (e.g. jumped off it toward something else): let the player fly
      if (hv.dot(n) > 1.0) continue;
      // grabs need intent: moving or pushing toward the wall (rising: travel direction; falling: no more
      // automatic catches of walls you merely slide past)
      if (!falling && toward < 0.2) continue;
      if (falling && toward < 0.3) continue;
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
        const over = ledge.y + 0.4;
        if (land && land.normal.y > 0.7 && land.point.y < ledge.y - 0.3 &&
          this.clearPath(new THREE.Vector3(this.pos.x, over, this.pos.z), new THREE.Vector3(land.point.x, over, land.point.z)) &&
          this.clearPath(new THREE.Vector3(land.point.x, over, land.point.z), new THREE.Vector3(land.point.x, land.point.y + 0.2, land.point.z))) {
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
  /** The edge in direction d below which the player can hang (from standing on top, or just after leaving it). */
  private findLowerLedge(d: THREE.Vector3, alreadyOff: boolean): Ledge | null {
    const physics = this.physics;
    const feet = alreadyOff ? this.takeoffPos.y : this.feetY;
    const base = alreadyOff ? this.takeoffPos : new THREE.Vector3(this.pos.x, feet, this.pos.z);
    if (!alreadyOff) {
      const ahead = new THREE.Vector3(base.x + d.x * 0.55, feet + 0.3, base.z + d.z * 0.55);
      if (physics.raycast(ahead, DOWN, 0.8)) return null; // ground continues
    }
    const out = alreadyOff ? 1.0 : 1.15;
    const o = new THREE.Vector3(base.x + d.x * out, feet - 0.25, base.z + d.z * out);
    const face = physics.raycast(o, d.clone().negate(), alreadyOff ? 2.4 : 1.3);
    if (!face || Math.abs(face.normal.y) > 0.55) return null;
    const n = face.normal.clone().setY(0).normalize();
    if (n.dot(d) < 0.4) return null;
    const tp = face.point.clone().addScaledVector(n, -0.2);
    tp.y = feet + 0.4;
    const top = physics.raycast(tp, DOWN, 0.9);
    if (!top || top.normal.y < 0.72 || Math.abs(top.point.y - feet) > 0.35) return null;
    const ledgeY = top.point.y;
    // must be a real drop (not a small step)
    const below = physics.raycast(new THREE.Vector3(face.point.x + n.x * 0.7, ledgeY - 0.3, face.point.z + n.z * 0.7), DOWN, 1.5);
    if (below) return null;
    const ledge = this.buildLedge(face.point, n, ledgeY, 0);
    ledge.mover = this.hooks?.moverOf(top.collider) ?? null;
    if (ledge.mover) return null; // never climb down off a moving platform
    if (!ledge.hangCenter) return null;
    // the body goes over the edge and down the outside: both legs of that path must be open
    const overEdge = ledge.edge.clone().addScaledVector(ledge.normal, 0.5);
    overEdge.y = ledgeY + 0.5;
    if (!this.clearPath(new THREE.Vector3(base.x, ledgeY + 0.5, base.z), overEdge)) return null;
    if (!this.clearPath(overEdge, ledge.hangCenter)) return null;
    return ledge;
  }

  private tryLowerAt(d: THREE.Vector3, alreadyOff: boolean) {
    const ledge = this.findLowerLedge(d, alreadyOff);
    if (!ledge) return false;
    const n = ledge.normal;
    const feet = alreadyOff ? this.takeoffPos.y : this.feetY;
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

  // ------------------------------------------------------------------ moving platforms, pads, rings
  private static shiftLedge(l: Ledge, d: THREE.Vector3) {
    l.edge.add(d);
    l.y += d.y;
    l.standY += d.y;
    l.hangCenter?.add(d);
  }

  /** Moving platforms carry whoever stands on / hangs from / climbs onto them. */
  private applyCarry() {
    let d: THREE.Vector3 | null = null;
    if (this.state === 'hang' && this.ledge?.mover) {
      d = this.ledge.mover.delta;
      Player.shiftLedge(this.ledge, d);
      this.hangRoot.add(d);
      this.catchFrom.add(d);
    } else if (this.state === 'move' && this.move?.ledge?.mover) {
      const m = this.move;
      d = m.ledge!.mover!.delta;
      m.from.add(d);
      m.to.add(d);
      Player.shiftLedge(m.ledge!, d);
      if (m.next && m.next !== m.ledge) Player.shiftLedge(m.next, d);
      this.hangRoot.add(d);
      if (this.ledge && this.ledge !== m.ledge) Player.shiftLedge(this.ledge, d);
    } else if (this.riding && (this.state === 'ground' || this.state === 'land' || this.state === 'roll')) {
      d = this.riding.carryAt(this.pos, _carry);
      // a turning jib turns whoever stands on it (and their facing)
      if (this.riding.rotates && this.riding.dAng) { this.yaw += this.riding.dAng; this.prevYaw += this.riding.dAng; this.visualYaw += this.riding.dAng; }
    }
    if (!d || d.lengthSq() < 1e-12) return;
    this.pos.add(d);
    this.fallPeakY += d.y;
    // the controller starts from the collider's current pose: move it now, not at the next physics step
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.physics.world.propagateModifiedBodyPositionsToColliders();
  }

  /** trampoline: the landing speed comes back up (scaled), the horizontal speed is kept */
  private bounceOff(surf: Surface, fallSpeed: number) {
    const v = THREE.MathUtils.clamp(fallSpeed * (surf.bounce ?? 0.9), surf.min ?? 11, surf.max ?? 24);
    this.vel.y = v;
    this.state = 'air';
    this.grounded = false;
    this.jumping = false;
    this.airTime = 0;
    this.coyote = 0;
    this.fallPeakY = this.feetY;
    this.riding = null;
    this.regrab = 0.2;
    this.model?.play('jump', 0.05, true);
    this.events.push({ type: 'bounce', speed: v });
  }

  /** moving hazards (pistons, sweeping bars, falling crates) shove the player out of their way */
  private devicePush() {
    const o = this.pushOut;
    o.d.set(0, 0, 0); o.v.set(0, 0, 0);
    if (!this.hooks!.push!(_feet.set(this.pos.x, this.pos.y - FEET, this.pos.z), o)) return;
    this.pos.add(o.d);
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    if (o.v.lengthSq() > 0.01) {
      this.vel.copy(o.v);
      this.state = 'air';
      this.grounded = false;
      this.jumping = false;
      this.riding = null;
      this.takeoffSlow = true;
      this.events.push({ type: 'knock' });
    }
  }

  /** a device trigger touched this tick */
  private deviceAction(a: DeviceAction) {
    if (a.kind === 'portal') {
      // through the gate: same speed, turned to the exit's facing
      const c = Math.cos(a.dYaw), s = Math.sin(a.dYaw);
      const vx = this.vel.x * c + this.vel.z * s, vz = -this.vel.x * s + this.vel.z * c;
      const vy = this.vel.y, yaw = this.yaw + a.dYaw;
      this.teleport(a.p, yaw);
      this.vel.set(vx, vy, vz);
      this.regrab = 0.1;
      this.events.push({ type: 'portal' });
    } else if (a.kind === 'launch') {
      this.vel.copy(a.v);
      this.yaw = Math.atan2(a.v.x, a.v.z);
      this.padFlight = { maxSpeed: Math.max(PHYS.runSpeed, Math.hypot(a.v.x, a.v.z) * 1.1), t: 0 };
      this.state = 'air'; this.grounded = false; this.jumping = false; this.airTime = 0; this.coyote = 0;
      this.fallPeakY = this.feetY; this.riding = null; this.regrab = 0.3;
      this.model?.play('jump', 0.05, true);
      this.events.push({ type: 'launch' });
    } else if (a.kind === 'zip') {
      const dir = a.b.clone().sub(a.a), L = dir.length();
      dir.divideScalar(L);
      const hand = _feet.set(this.pos.x, this.pos.y - FEET + 2.0, this.pos.z);
      const s0 = THREE.MathUtils.clamp(hand.sub(a.a).dot(dir), 0, L);
      const along = Math.max(2, this.vel.x * dir.x + this.vel.z * dir.z + this.vel.y * dir.y);
      this.zip = { a: a.a, dir, L, s: s0, v: along, max: a.speed, id: a.id };
      this.state = 'zip';
      this.vel.set(0, 0, 0);
      this.riding = null;
      this.yaw = Math.atan2(dir.x, dir.z);
      this.model?.play('hang', 0.1, true);
      this.events.push({ type: 'zip' });
    } else if (a.kind === 'checkpoint') this.events.push({ type: 'checkpoint', p: a.p, yaw: a.yaw, id: a.id });
    else this.events.push({ type: 'collect', id: a.id });
  }

  /** sliding down a zipline: hands on the cable, speed builds up with the slope; jump to let go, off at the end */
  private updateZip(dt: number) {
    const z = this.zip!;
    const slope = -z.dir.y; // > 0 going down
    z.v = THREE.MathUtils.clamp(z.v + (PHYS.gravityDown * 0.6 * slope - 0.8) * dt, 2.5, z.max);
    z.s += z.v * dt;
    const end = z.s >= z.L - 0.4;
    const hand = _feet.copy(z.a).addScaledVector(z.dir, Math.min(z.s, z.L));
    this.pos.set(hand.x, hand.y - 2.0 + FEET, hand.z);
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, true);
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    if (this.jumpBuffer > 0 || end) {
      const jumped = this.jumpBuffer > 0;
      this.jumpBuffer = 0;
      this.vel.copy(z.dir).multiplyScalar(z.v);
      if (jumped) this.vel.y = Math.max(this.vel.y, 0) + 7;
      this.zip = null;
      this.state = 'air';
      this.airTime = 0;
      this.fallPeakY = this.feetY;
      this.regrab = 0.35;
      this.jumping = jumped;
      if (jumped) this.events.push({ type: 'jump' });
    }
  }

  private usePad(pad: Pad) {
    if (pad.t === 'jump') {
      if (this.padCool > 0 || this.jumpedThisTick || this.padCharge) return false;
      // feet on the pad: it squashes for 0.1 s, then throws the player
      this.padCharge = { pad, t: 0.1 };
      this.padCool = 0.45;
      pad.squash = 0.1;
      pad.pulse = 1;
      this.events.push({ type: 'pad', kind: 'jump' });
      return false;
    }
    // speed pad: dash along the arrows
    const sp = pad.v ?? 15;
    const fresh = this.boostT < 0.2;
    this.boostDir.copy(pad.dir);
    this.boostSpeed = sp;
    this.boostDur = 1.35;
    this.boostT = this.boostDur;
    this.vel.x = pad.dir.x * sp;
    this.vel.z = pad.dir.z * sp;
    this.yaw = Math.atan2(pad.dir.x, pad.dir.z);
    pad.pulse = 1;
    if (fresh) this.events.push({ type: 'pad', kind: 'speed' });
    return false;
  }

  /** Pad launch: straight up plus ~3/4 of the horizontal speed needed to reach the marked landing spot. */
  private launchPad(pad: Pad) {
    const v = pad.v ?? 20;
    const feet = this.feetY;
    let base = 0, need = PHYS.runSpeed;
    if (pad.tg) {
      const dist = Math.hypot(pad.tg[0] - this.pos.x, pad.tg[2] - this.pos.z);
      const apex = (v * v) / (2 * PHYS.gravityUp);
      const dh = pad.tg[1] - feet;
      const T = v / PHYS.gravityUp + Math.sqrt((2 * Math.max(0.3, apex - dh)) / PHYS.gravityDown);
      need = dist / T;
      base = need * 0.74;
    }
    this.vel.x = pad.dir.x * base + this.vel.x * 0.2;
    this.vel.z = pad.dir.z * base + this.vel.z * 0.2;
    this.vel.y = v;
    this.yaw = Math.atan2(pad.dir.x, pad.dir.z);
    this.padFlight = { maxSpeed: Math.max(PHYS.runSpeed, need * 1.22), t: 0 };
    this.grounded = false;
    this.state = 'air';
    this.jumping = false; // no jump-cut: the pad decides the height
    this.airTime = 0;
    this.coyote = 0;
    this.fallPeakY = feet;
    this.jumpAnimTimer = 0.5;
    this.takeoffPos.set(this.pos.x, feet, this.pos.z);
    this.takeoffSlow = false;
    this.regrab = 0.25;
    this.riding = null;
    pad.pulse = 1;
    this.model?.play('jump', 0.05, true);
    this.events.push({ type: 'launch' });
  }

  private hitRing(r: Ring) {
    const dir = r.n.clone();
    if (new THREE.Vector3(this.vel.x, 0, this.vel.z).dot(dir) < 0) dir.negate();
    const sp = r.v ?? 16;
    this.vel.x = dir.x * sp;
    this.vel.z = dir.z * sp;
    this.vel.y = Math.max(this.vel.y, 5.5);
    this.boostDir.copy(dir).setY(0).normalize();
    this.boostSpeed = sp;
    this.boostDur = 1.1;
    this.boostT = this.boostDur;
    this.yaw = Math.atan2(dir.x, dir.z);
    this.state = 'air';
    this.grounded = false;
    this.airTime = 0;
    this.fallPeakY = this.feetY;
    this.takeoffSlow = false;
    this.takeoffPos.set(this.pos.x, this.feetY, this.pos.z);
    r.cool = 0.6;
    r.pulse = 1;
    this.events.push({ type: 'ring' });
  }

  // ------------------------------------------------------------------ ladders
  private static LADDER_OFF = 0.4; // capsule centre distance from the ladder plane

  private tryLadder() {
    if (!this.hooks || this.ladderCool > 0) return false;
    const feet = this.feetY;
    for (const l of this.hooks.ladders()) {
      const rx = this.pos.x - l.base.x, rz = this.pos.z - l.base.z;
      const lat = rx * l.t.x + rz * l.t.z;
      const out = rx * l.n.x + rz * l.n.z;
      if (Math.abs(lat) > l.width / 2 + 0.3 || out < 0.05 || out > 0.95) continue;
      if (feet < l.base.y - 0.45 || feet > l.top - 0.7) continue;
      const toward = this.wishLen > 0.3 ? -(this.wish.x * l.n.x + this.wish.z * l.n.z) : 0;
      if (this.state === 'ground' && toward < 0.6) continue;
      if (this.state === 'air' && toward < 0.4 && -(this.vel.x * l.n.x + this.vel.z * l.n.z) < 1.5) continue;
      this.enterLadder(l, feet);
      return true;
    }
    return false;
  }

  private enterLadder(l: Ladder, feet: number) {
    this.padFlight = null;
    this.ladder = l;
    this.state = 'ladder';
    this.vel.set(0, 0, 0);
    this.jumping = false;
    this.riding = null;
    this.ledge = null;
    this.ladderV = 0;
    const y = THREE.MathUtils.clamp(feet, l.base.y, l.top - 1.0);
    this.pos.set(l.base.x + l.n.x * Player.LADDER_OFF, y + FEET, l.base.z + l.n.z * Player.LADDER_OFF);
    this.yaw = Math.atan2(-l.n.x, -l.n.z);
    this.fallPeakY = y;
    this.setBody();
    this.model?.play('ladder', 0.15, true, { timeScale: 0 });
    this.events.push({ type: 'ladder' });
  }

  private leaveLadder(vel: THREE.Vector3, cool: number) {
    const l = this.ladder!;
    this.ladder = null;
    this.state = 'air';
    this.vel.copy(vel);
    this.ladderCool = cool;
    this.regrab = 0.3;
    this.airTime = 0;
    this.fallPeakY = this.feetY;
    this.takeoffSlow = true;
    this.takeoffPos.set(this.pos.x, this.feetY, this.pos.z);
    void l;
  }

  private updateLadder(dt: number, input: Input, drop: boolean) {
    const l = this.ladder!;
    void drop; // leave a ladder by climbing off either end or jumping off
    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      // jump off backwards (steer sideways with the stick)
      const v = l.n.clone().multiplyScalar(4.2).addScaledVector(l.t, THREE.MathUtils.clamp(input.moveX, -1, 1) * 2.5);
      v.y = 8.5;
      this.leaveLadder(v, 0.45);
      this.yaw = Math.atan2(l.n.x, l.n.z);
      this.jumpAnimTimer = 0.45;
      this.model?.play('jump', 0.08, true);
      this.events.push({ type: 'jump' });
      return;
    }
    const my = Math.abs(input.moveY) > 0.2 ? input.moveY : 0;
    const want = my > 0 ? 3.0 * my : my * 3.6;
    this.ladderV = THREE.MathUtils.damp(this.ladderV, want, 14, dt);
    let feet = this.feetY + this.ladderV * dt;
    const hand = this.model?.handHangHeight ?? 1.9;
    // hands reach the top: climb off onto the surface above
    if (this.ladderV > 0.2 && feet + hand >= l.top + 0.05) {
      const wallPt = new THREE.Vector3(l.base.x, l.top, l.base.z);
      // the lip right behind the ladder (a parapet top, a roof edge, a tank rim)
      const sp = this.physics.raycast(new THREE.Vector3(l.base.x - l.n.x * 0.15, l.top + 1.2, l.base.z - l.n.z * 0.15), DOWN, 1.8);
      const topY = sp && sp.normal.y > 0.6 ? Math.min(sp.point.y, l.top + 0.6) : l.top;
      const ledge = this.buildLedge(wallPt, l.n.clone(), topY, topY - feet);
      if (ledge.canClimb) {
        this.ladder = null;
        this.ledge = ledge;
        this.hangRoot.set(this.pos.x, feet, this.pos.z);
        this.startClimb();
        return;
      }
      feet = l.top - hand;
      this.ladderV = 0;
    }
    if (feet <= l.base.y) {
      feet = l.base.y;
      if (this.ladderV < -0.2) {
        const g = this.physics.raycast(new THREE.Vector3(this.pos.x, feet + 0.3, this.pos.z), DOWN, 0.6);
        if (g) {
          this.ladder = null;
          this.state = 'ground';
          this.grounded = true;
          this.vel.set(0, -1.5, 0);
          this.ladderCool = 0.5;
          this.pos.y = g.point.y + FEET + 0.02;
          this.setBody();
          return;
        }
      }
      this.ladderV = Math.max(0, this.ladderV);
    }
    this.pos.set(l.base.x + l.n.x * Player.LADDER_OFF, feet + FEET, l.base.z + l.n.z * Player.LADDER_OFF);
    this.yaw = Math.atan2(-l.n.x, -l.n.z);
    this.fallPeakY = feet;
    this.setBody();
  }

  // ------------------------------------------------------------------ hanging
  private hangFeet(l: Ledge) {
    const hand = this.model?.handHangHeight ?? 1.9;
    const p = l.edge.clone().addScaledVector(l.normal, 0.2);
    p.y = l.y - hand;
    return p;
  }

  private enterHang(ledge: Ledge, fallSpeed: number) {
    this.padFlight = null;
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
    // let go: hold the stick away from the wall for a moment (away + jump is still the wall push-off)
    const awayNow = this.wishLen > 0.35 ? this.wish.dot(L.normal) : 0;
    this.letGoT = awayNow > 0.7 && this.jumpBuffer <= 0 ? this.letGoT + dt : 0;
    if (drop || this.letGoT >= PHYS.ledge.letGoTime) {
      this.letGoT = 0;
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
    const to = L.edge.clone().addScaledVector(L.normal, -L.standOff);
    to.y = L.standY;
    this.beginMove({ kind: 'climb', dur: PHYS.ledge.climbTime, from: this.hangRoot.clone(), to, anim: 'climb', ledge: L, apex: 0 });
    this.model?.play('climb', 0.12, true, { timeScale: (this.model.durations.climb ?? 1.86) / PHYS.ledge.climbTime });
    this.events.push({ type: 'climb' });
  }

  private startMantle(L: Ledge) {
    const to = L.edge.clone().addScaledVector(L.normal, -Math.max(0.45, L.standOff));
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
    next.mover = this.hooks?.moverOf(top.collider) ?? null;
    if (next.mover !== L.mover) return;
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
        case 'ladder': anim = 'ladder'; break;
      }
      const fades: Partial<Record<AnimName, number>> = { jump: 0.08, hang: 0.1, land: 0.08, roll: 0.06, fallLong: 0.35 };
      m.play(anim, fades[anim] ?? 0.18);
      if (anim === 'ladder') m.setTimeScale('ladder', this.ladderV / m.ladderRate);
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

  // ------------------------------------------------------------------ stuck-inside safety net
  private stuckTimer = 0;
  private stuckHits = 0;
  private stuckRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });

  /** Returns the collider whose closed shell contains point c, or null. */
  insideCollider(c: THREE.Vector3): RAPIER.Collider | null {
    const ph = this.physics;
    const up = ph.raycast(c, UP, 40);
    if (!up) return null;
    const col = up.collider;
    if (up.distance < 1e-4) return col; // inside a solid primitive
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      const h = ph.raycast(c, _dir.set(Math.sin(a), 0, Math.cos(a)), 30);
      if (!h || h.collider.handle !== col.handle) return null;
    }
    // parity vote: an odd number of shell crossings toward the outside means we are inside
    let votes = 0;
    const r = this.stuckRay;
    for (const d of [[0.97, 0.05, 0.23], [-0.2, 0.08, 0.976], [0.05, 0.998, 0.03]]) {
      let o = { x: c.x, y: c.y, z: c.z };
      let n = 0;
      r.dir = { x: d[0], y: d[1], z: d[2] };
      for (let i = 0; i < 32; i++) {
        r.origin = o;
        const t = col.castRay(r, 80, false);
        if (t < 0) break;
        n++;
        o = { x: o.x + d[0] * (t + 0.003), y: o.y + d[1] * (t + 0.003), z: o.z + d[2] * (t + 0.003) };
      }
      if (n % 2 === 1) votes++;
    }
    return votes >= 2 ? col : null;
  }

  private checkStuck(dt: number) {
    if (this.state === 'move') return;
    this.stuckTimer += dt;
    if (this.stuckTimer < 0.2) return;
    this.stuckTimer = 0;
    const col = this.insideCollider(new THREE.Vector3(this.pos.x, this.pos.y + 0.2, this.pos.z));
    if (!col) { this.stuckHits = 0; return; }
    if (++this.stuckHits < 3) return;
    this.stuckHits = 0;
    this.escapeFrom(col);
  }

  /** Put the player back outside the shell they are trapped in: nearest outer wall, else on top. */
  private escapeFrom(col: RAPIER.Collider) {
    const ph = this.physics;
    const feet = this.feetY;
    const r = this.stuckRay;
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      // cast from far outside back toward us: the first boundary is the outer face of the shell
      r.origin = { x: this.pos.x + dx * 40, y: this.pos.y, z: this.pos.z + dz * 40 };
      r.dir = { x: -dx, y: 0, z: -dz };
      const t = col.castRay(r, 40, false);
      if (t < 0) continue;
      const out = new THREE.Vector3(r.origin.x - dx * t + dx * (PHYS.capsuleRadius + 0.3), feet + 1.2, r.origin.z - dz * t + dz * (PHYS.capsuleRadius + 0.3));
      const g = ph.raycast(out, DOWN, 90);
      if (!g || g.normal.y < 0.6) continue;
      const c = new THREE.Vector3(out.x, g.point.y + FEET + 0.05, out.z);
      if (ph.capsuleOverlaps(c, PHYS.capsuleHalfHeight, PHYS.capsuleRadius * 0.9)) continue;
      if (this.insideCollider(c)) continue;
      const score = 40 - t + Math.max(0, feet - g.point.y) * 0.5 + Math.max(0, g.point.y - feet) * 3;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    if (!best) {
      // fallback: the top of whatever we are stuck in
      const top = ph.raycast(new THREE.Vector3(this.pos.x, this.pos.y + 80, this.pos.z), DOWN, 80);
      best = top ? new THREE.Vector3(top.point.x, top.point.y + FEET + 0.05, top.point.z) : this.pos.clone().setY(this.pos.y + 3);
    }
    this.pos.copy(best);
    this.prevPos.copy(best);
    this.vel.set(0, 0, 0);
    this.state = 'air';
    this.ledge = null;
    this.move = null;
    this.fallPeakY = this.feetY;
    this.body.setTranslation({ x: best.x, y: best.y, z: best.z }, true);
    this.setBody();
    this.events.push({ type: 'unstuck' });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
