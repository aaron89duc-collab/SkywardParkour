import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { COLLISION } from '../config';

export type RayHit = { point: THREE.Vector3; normal: THREE.Vector3; distance: number; collider: RAPIER.Collider };

/** Thin wrapper around a Rapier world containing only static geometry + the kinematic player. */
export class Physics {
  static RAPIER = RAPIER;
  world!: RAPIER.World;
  private ray!: RAPIER.Ray;
  private ball!: RAPIER.Ball;
  colliderCount = 0;

  static async init() {
    await RAPIER.init();
  }

  /** colliders created while an owner (a map id) is active: removed together when that map is unloaded */
  private owner: string | null = null;
  private owned = new Map<string, RAPIER.Collider[]>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.ball = new RAPIER.Ball(0.25);
    // every collider made while an owner is set belongs to it (whichever system creates it)
    const create = this.world.createCollider.bind(this.world);
    this.world.createCollider = ((desc: RAPIER.ColliderDesc, parent?: RAPIER.RigidBody) => {
      const c = create(desc, parent);
      if (this.owner) { let l = this.owned.get(this.owner); if (!l) this.owned.set(this.owner, (l = [])); l.push(c); }
      return c;
    }) as typeof this.world.createCollider;
  }

  /** Run `f` with every collider it creates (also after awaits inside it) recorded under `owner`. */
  async ownedBy<T>(owner: string, f: () => Promise<T>): Promise<T> {
    const prev = this.owner;
    this.owner = owner;
    try { return await f(); } finally { this.owner = prev; }
  }

  /** Make colliders that belong to no map (gates, the player) even while a map is loading. */
  unowned<T>(f: () => T): T {
    const prev = this.owner;
    this.owner = null;
    try { return f(); } finally { this.owner = prev; }
  }

  /** Remove every collider an owner made. */
  removeOwned(owner: string) {
    const l = this.owned.get(owner);
    if (!l) return 0;
    for (const c of l) { try { this.world.removeCollider(c, false); this.colliderCount--; } catch { /* already gone */ } }
    this.owned.delete(owner);
    this.world.updateSceneQueries();
    return l.length;
  }

  step() {
    this.world.step();
  }

  addTrimesh(vertices: Float32Array, indices: Uint32Array, groups = COLLISION.WORLD) {
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES | RAPIER.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES)
      .setCollisionGroups(groups)
      .setFriction(0);
    this.colliderCount++;
    return this.world.createCollider(desc);
  }

  addBox(center: THREE.Vector3, half: THREE.Vector3, quat?: THREE.Quaternion, groups = COLLISION.WORLD) {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setCollisionGroups(groups);
    if (quat) desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    this.colliderCount++;
    return this.world.createCollider(desc);
  }

  addCylinder(center: THREE.Vector3, halfHeight: number, radius: number, quat?: THREE.Quaternion, groups = COLLISION.WORLD) {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(center.x, center.y, center.z).setCollisionGroups(groups);
    if (quat) desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    this.colliderCount++;
    return this.world.createCollider(desc);
  }

  addCapsule(center: THREE.Vector3, halfHeight: number, radius: number, quat?: THREE.Quaternion, groups = COLLISION.WORLD) {
    const desc = RAPIER.ColliderDesc.capsule(halfHeight, radius).setTranslation(center.x, center.y, center.z).setCollisionGroups(groups);
    if (quat) desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    this.colliderCount++;
    return this.world.createCollider(desc);
  }

  removeCollider(c: RAPIER.Collider) {
    this.world.removeCollider(c, false);
    this.colliderCount--;
  }

  /** Raycast against solid world geometry (ignores player and invisible boundaries). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, groups = COLLISION.QUERY_SOLID): RayHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, groups);
    if (!hit) return null;
    const d = hit.timeOfImpact;
    return {
      distance: d,
      point: new THREE.Vector3(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
    };
  }

  /** Sweep a sphere; returns travel distance until impact or null. */
  sphereCast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, radius: number, groups = COLLISION.QUERY_SOLID): number | null {
    if (Math.abs(this.ball.radius - radius) > 1e-4) this.ball = new RAPIER.Ball(radius);
    const hit = this.world.castShape(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x, y: dir.y, z: dir.z },
      this.ball,
      0,
      maxDist,
      true,
      undefined,
      groups,
    );
    return hit ? hit.time_of_impact : null;
  }

  /** True if a capsule placed at center overlaps solid geometry. */
  capsuleOverlaps(center: THREE.Vector3, halfHeight: number, radius: number, groups = COLLISION.QUERY_SOLID) {
    const shape = new RAPIER.Capsule(halfHeight, radius);
    let found = false;
    this.world.intersectionsWithShape({ x: center.x, y: center.y, z: center.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, () => {
      found = true;
      return false;
    }, undefined, groups);
    return found;
  }
}
