import * as THREE from 'three';
import { InputController } from '../input/InputController';
import { MapLoader } from '../world/MapLoader';
import { PlayerController } from './PlayerController';

export class ThirdPersonCamera {
  private target = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private initialized = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputController,
    private readonly map: MapLoader,
  ) {}

  update(player: PlayerController, dt: number): void {
    this.target.set(player.worldPosition.x, player.worldPosition.y + .35, player.worldPosition.z);
    const distance = 6.8;
    const h = Math.cos(this.input.pitch) * distance;
    this.offset.set(Math.sin(this.input.yaw) * h, Math.sin(this.input.pitch) * distance, Math.cos(this.input.yaw) * h);
    this.desired.copy(this.target).add(this.offset);
    // Spring arm: keep the camera on the player side of solid platforms.
    const direction = this.offset.clone().normalize();
    this.raycaster.set(this.target, direction);
    this.raycaster.far = distance;
    const hit = this.raycaster.intersectObjects(this.map.cameraObstacles, false)[0];
    if (hit && hit.distance > .5) {
      this.desired.copy(this.target).addScaledVector(direction, Math.max(1.4, hit.distance - .26));
    }
    if (!this.initialized) {
      this.camera.position.copy(this.desired);
      this.initialized = true;
    } else {
      this.camera.position.lerp(this.desired, 1 - Math.exp(-dt * 9));
    }
    this.camera.lookAt(this.target);
  }

  reset(): void { this.initialized = false; }
}
