import * as THREE from 'three';
import { PhysicsWorld, RAPIER } from '../core/PhysicsWorld';
import { InputController } from '../input/InputController';

const CAPSULE_HALF_HEIGHT = .53;
const CAPSULE_RADIUS = .37;
const FOOT_OFFSET = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;
const MOVE_SPEED = 7.15;
const GROUND_ACCEL = 14.5;
const AIR_ACCEL = 5.5;
const JUMP_SPEED = 10.9;
const GRAVITY = -23;
const MAX_FALL_SPEED = -37;
const COYOTE_TIME = .11;
const JUMP_BUFFER = .12;

/**
 * A kinematic capsule: Rapier resolves every motion against platforms/walls.
 * Falling is NEVER a game over. A lower platform or the ground catches the
 * capsule, then the next normal movement input continues from that location.
 */
export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly visual = new THREE.Group();
  readonly horizontalVelocity = new THREE.Vector3();
  readonly worldPosition = new THREE.Vector3();
  grounded = false;
  verticalVelocity = 0;
  private coyoteRemaining = 0;
  private jumpBufferRemaining = 0;
  private visualYaw = 0;
  private elapsed = 0;
  private legs: [THREE.Group, THREE.Group];
  private arms: [THREE.Group, THREE.Group];
  private readonly scene: THREE.Scene;

  constructor(physics: PhysicsWorld, scene: THREE.Scene, spawn: THREE.Vector3) {
    this.scene = scene;
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS), this.body);
    this.controller = physics.world.createCharacterController(.025);
    this.controller.enableAutostep(.28, .24, false);
    this.controller.enableSnapToGround(.23);
    this.controller.setMaxSlopeClimbAngle(Math.PI * .28);
    this.controller.setMinSlopeSlideAngle(Math.PI * .33);
    this.controller.setSlideEnabled(true);
    this.worldPosition.copy(spawn);
    const built = this.createAvatar();
    this.legs = built.legs;
    this.arms = built.arms;
    this.scene.add(this.visual);
    this.syncVisual(0);
  }

  get footY(): number { return this.worldPosition.y - FOOT_OFFSET; }

  reset(spawn: THREE.Vector3): void {
    this.body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
    this.body.setNextKinematicTranslation({ x: spawn.x, y: spawn.y, z: spawn.z });
    this.worldPosition.copy(spawn);
    this.horizontalVelocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.coyoteRemaining = 0;
    this.jumpBufferRemaining = 0;
    this.grounded = false;
    this.syncVisual(0);
  }

  /** Call once per fixed physics tick, before world.step(). */
  fixedUpdate(input: InputController, dt: number): void {
    input.update();
    const localRight = input.moveRight;
    const localForward = input.moveForward;
    const yaw = input.yaw;
    const targetX = (localRight * Math.cos(yaw) - localForward * Math.sin(yaw)) * MOVE_SPEED;
    const targetZ = (-localRight * Math.sin(yaw) - localForward * Math.cos(yaw)) * MOVE_SPEED;
    const alpha = 1 - Math.exp(-(this.grounded ? GROUND_ACCEL : AIR_ACCEL) * dt);
    this.horizontalVelocity.x += (targetX - this.horizontalVelocity.x) * alpha;
    this.horizontalVelocity.z += (targetZ - this.horizontalVelocity.z) * alpha;

    if (this.grounded) this.coyoteRemaining = COYOTE_TIME;
    else this.coyoteRemaining = Math.max(0, this.coyoteRemaining - dt);

    if (input.consumeJump()) this.jumpBufferRemaining = JUMP_BUFFER;
    else this.jumpBufferRemaining = Math.max(0, this.jumpBufferRemaining - dt);

    if (this.jumpBufferRemaining > 0 && this.coyoteRemaining > 0) {
      this.verticalVelocity = JUMP_SPEED;
      this.coyoteRemaining = 0;
      this.jumpBufferRemaining = 0;
      this.grounded = false;
    } else {
      this.verticalVelocity = Math.max(MAX_FALL_SPEED, this.verticalVelocity + GRAVITY * dt);
    }

    const desired = {
      x: this.horizontalVelocity.x * dt,
      y: this.verticalVelocity * dt,
      z: this.horizontalVelocity.z * dt,
    };
    this.controller.computeColliderMovement(this.collider, desired);
    const actual = this.controller.computedMovement();
    const position = this.body.translation();

    // Downward collision means landing, never death or automatic restart.
    if (this.verticalVelocity <= 0 && this.controller.computedGrounded()) {
      this.grounded = true;
      this.verticalVelocity = -.08;
    } else {
      this.grounded = false;
      // Hit head against underside of a floating platform.
      if (this.verticalVelocity > 0 && actual.y < desired.y - .002) this.verticalVelocity = 0;
    }
    this.body.setNextKinematicTranslation({
      x: position.x + actual.x,
      y: position.y + actual.y,
      z: position.z + actual.z,
    });
  }

  /** Call after physicsWorld.step(). */
  syncVisual(dt: number): void {
    const p = this.body.translation();
    this.worldPosition.set(p.x, p.y, p.z);
    this.visual.position.set(p.x, p.y - FOOT_OFFSET, p.z);
    const speed = Math.hypot(this.horizontalVelocity.x, this.horizontalVelocity.z);
    if (speed > .24) {
      const target = Math.atan2(-this.horizontalVelocity.x, -this.horizontalVelocity.z);
      const angularDifference = Math.atan2(Math.sin(target - this.visualYaw), Math.cos(target - this.visualYaw));
      this.visualYaw += angularDifference * Math.min(1, dt * 12);
    }
    this.visual.rotation.y = this.visualYaw;
    this.elapsed += dt;
    const walk = speed > .35 && this.grounded ? Math.sin(this.elapsed * (7 + speed)) * Math.min(.6, speed * .08) : 0;
    this.legs[0].rotation.x = walk;
    this.legs[1].rotation.x = -walk;
    this.arms[0].rotation.x = -walk * .65;
    this.arms[1].rotation.x = walk * .65;
    this.visual.children[0].position.y = this.grounded && speed > .5 ? Math.abs(Math.sin(this.elapsed * 12)) * .025 : 0;
  }

  private createAvatar(): { legs: [THREE.Group, THREE.Group]; arms: [THREE.Group, THREE.Group] } {
    const body = new THREE.Group();
    this.visual.add(body);
    const add = (parent: THREE.Group, shape: THREE.BufferGeometry, color: string, px: number, py: number, pz: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(shape, new THREE.MeshStandardMaterial({ color, roughness: .8, flatShading: true }));
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    add(body, new THREE.BoxGeometry(.60, .72, .36), '#ef896f', 0, 1.10, 0);
    add(body, new THREE.BoxGeometry(.52, .16, .40), '#3d6689', 0, .71, 0);
    add(body, new THREE.SphereGeometry(.28, 12, 10), '#f5c29a', 0, 1.68, -.02);
    add(body, new THREE.BoxGeometry(.57, .12, .43), '#47465f', 0, 1.86, -.01);
    add(body, new THREE.BoxGeometry(.41, .48, .24), '#f2bb6a', 0, 1.13, .26);
    // Tiny front-facing eyes: local -Z is forward.
    add(body, new THREE.BoxGeometry(.055,.05,.025), '#37445b', -.09,1.69,-.288);
    add(body, new THREE.BoxGeometry(.055,.05,.025), '#37445b', .09,1.69,-.288);

    const leftLeg = new THREE.Group(), rightLeg = new THREE.Group();
    leftLeg.position.set(-.17,.65,0); rightLeg.position.set(.17,.65,0);
    for (const leg of [leftLeg,rightLeg]) {
      add(leg, new THREE.BoxGeometry(.21,.48,.24), '#415c89', 0,-.24,0);
      add(leg, new THREE.BoxGeometry(.25,.15,.34), '#f7f0de', 0,-.53,-.06);
      body.add(leg);
    }
    const leftArm = new THREE.Group(), rightArm = new THREE.Group();
    leftArm.position.set(-.43,1.39,0); rightArm.position.set(.43,1.39,0);
    for (const arm of [leftArm,rightArm]) {
      add(arm, new THREE.BoxGeometry(.22,.49,.23), '#e88a70', 0,-.25,0);
      add(arm, new THREE.BoxGeometry(.19,.15,.20), '#f5c29a', 0,-.53,0);
      body.add(arm);
    }
    return { legs:[leftLeg,rightLeg], arms:[leftArm,rightArm] };
  }
}
