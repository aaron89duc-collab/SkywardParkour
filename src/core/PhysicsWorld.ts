import RAPIER from '@dimforge/rapier3d-compat';

export class PhysicsWorld {
  readonly world: RAPIER.World;
  static readonly STEP = 1 / 60;

  private constructor(world: RAPIER.World) { this.world = world; }

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -23, z: 0 });
    world.timestep = PhysicsWorld.STEP;
    return new PhysicsWorld(world);
  }

  addBoxCollider(x: number, topY: number, z: number, width: number, depth: number, thickness: number): void {
    const shape = RAPIER.ColliderDesc.cuboid(width / 2, thickness / 2, depth / 2)
      .setTranslation(x, topY - thickness / 2, z);
    this.world.createCollider(shape);
  }

  step(): void { this.world.step(); }
}

export { RAPIER };
