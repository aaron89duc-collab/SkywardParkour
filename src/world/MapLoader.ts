import * as THREE from 'three';
import { PhysicsWorld } from '../core/PhysicsWorld';
import type { MapDefinition, MapManifest, PlatformDefinition, Vec3JSON } from './MapTypes';

const PALETTE: Record<PlatformDefinition['color'], string> = {
  coral: '#ff9781', sun: '#f6c66d', mint: '#66c9ad',
  sky: '#7cbbf1', violet: '#a99be7', stone: '#819cad',
};

interface MeshWithCollision { mesh: THREE.Mesh; }

/**
 * Geometry is deliberately primitive for the first playable. Each object has
 * a matching fixed Rapier cuboid. Later: replace visual mesh with Meshy GLB,
 * keep the (simple, authored) collider described by JSON.
 */
export class MapLoader {
  readonly group = new THREE.Group();
  readonly cameraObstacles: THREE.Object3D[] = [];
  spawn = new THREE.Vector3(0, 1.08, 8);
  finish = new THREE.Vector3(0, 44, 0);
  maxMapHeight = 44;

  constructor(private readonly scene: THREE.Scene, private readonly physics: PhysicsWorld) {
    this.scene.add(this.group);
  }

  async loadManifest(path = '/maps/manifest.json'): Promise<void> {
    const manifest = await this.requestJSON<MapManifest>(path);
    if (!Array.isArray(manifest.maps) || manifest.maps.length === 0) {
      throw new Error('Manifest chưa có map.');
    }
    for (let i = 0; i < manifest.maps.length; i++) {
      const entry = manifest.maps[i];
      const def = await this.requestJSON<MapDefinition>(entry.src);
      this.loadMap(def, entry.offset);
      if (i === 0) this.spawn.set(def.spawn.x + entry.offset.x, def.spawn.y + entry.offset.y, def.spawn.z + entry.offset.z);
      if (i === manifest.maps.length - 1) this.finish.set(def.finish.x + entry.offset.x, def.finish.y + entry.offset.y, def.finish.z + entry.offset.z);
    }
    this.addGround();
    this.addSkyDecor();
  }

  private async requestJSON<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Không tải được ${url} (${response.status}).`);
    return await response.json() as T;
  }

  private loadMap(def: MapDefinition, offset: Vec3JSON): void {
    for (const item of [...def.platforms, ...def.recoveryDecks]) {
      const p = { ...item, x: item.x + offset.x, z: item.z + offset.z, topY: item.topY + offset.y };
      const result = this.addPlatform(p);
      this.cameraObstacles.push(result.mesh);
      this.maxMapHeight = Math.max(this.maxMapHeight, p.topY);
    }
    // Decor objects are independent from physics and do not change platform hitboxes.
    this.addLevelDecor(def, offset);
  }

  private addPlatform(p: PlatformDefinition): MeshWithCollision {
    const color = PALETTE[p.color] ?? PALETTE.stone;
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02 });
    const main = new THREE.Mesh(new THREE.BoxGeometry(p.width, p.thickness, p.depth), material);
    main.position.set(p.x, p.topY - p.thickness / 2, p.z);
    main.receiveShadow = true;
    main.castShadow = true;
    this.group.add(main);
    this.physics.addBoxCollider(p.x, p.topY, p.z, p.width, p.depth, p.thickness);

    // A thin stripe within the main collider's top 1 cm: visually informative
    // without creating an invisible step above the collision surface.
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(p.width * .82, .02, .075),
      new THREE.MeshStandardMaterial({ color: '#e7fbff', roughness: .65, emissive: '#d5edff', emissiveIntensity: .08 }),
    );
    stripe.position.set(p.x, p.topY + .005, p.z + p.depth * .40);
    this.group.add(stripe);

    const support = new THREE.Mesh(
      new THREE.CylinderGeometry(.23, .34, Math.min(4.8, Math.max(1.0, p.topY * .11)), 6),
      new THREE.MeshStandardMaterial({ color: '#486a84', roughness: .87 }),
    );
    support.position.set(p.x, p.topY - p.thickness - Math.min(4.8, Math.max(1.0, p.topY * .11)) / 2, p.z);
    support.castShadow = true;
    // Visual only: walking into its decorative underside won't snag the collider.
    if (p.color !== 'stone') this.group.add(support);

    if (p.marker) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(.055, .055, 1.8, 7),
        new THREE.MeshStandardMaterial({ color: '#f2f8fe' }),
      );
      pole.position.set(p.x - p.width / 2 + .3, p.topY + .9, p.z - p.depth / 2 + .3);
      pole.castShadow = true;
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(.75, .42, .04),
        new THREE.MeshStandardMaterial({ color: '#ffdd8a', side: THREE.DoubleSide }),
      );
      flag.position.set(pole.position.x + .40, p.topY + 1.47, pole.position.z);
      this.group.add(pole, flag);
    }
    return { mesh: main };
  }

  private addGround(): void {
    this.physics.addBoxCollider(0, 0, 0, 600, 600, 1);
    const earth = new THREE.Mesh(
      new THREE.BoxGeometry(600, 1, 600),
      new THREE.MeshStandardMaterial({ color: '#83be95', roughness: 1 }),
    );
    earth.position.set(0, -.5, 0);
    earth.receiveShadow = true;
    this.group.add(earth);
    this.cameraObstacles.push(earth);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(6.3, .13, 8, 64),
      new THREE.MeshStandardMaterial({ color: '#fff2b4', emissive: '#ffce74', emissiveIntensity: .4 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, .07, 6.2);
    this.group.add(ring);

    // Repeated geometric props, not new physics obstacles: scenery only.
    for (let i = 0; i < 34; i++) {
      const a = i * 2.3999632;
      const r = 29 + (i % 5) * 5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.22, .28, 1.5, 6), new THREE.MeshStandardMaterial({ color: '#9c7d6b' }));
      trunk.position.set(x, .75, z);
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.45, 3.4, 7), new THREE.MeshStandardMaterial({ color: i % 2 ? '#419e83' : '#63ad8b', flatShading: true }));
      leaves.position.set(x, 2.65, z);
      leaves.castShadow = true;
      this.group.add(trunk, leaves);
    }
  }

  private addLevelDecor(def: MapDefinition, offset: Vec3JSON): void {
    // Small colored dots indicate the intended ascent route, without drawing
    // a large beam that blocks the view or adding invisible collisions.
    for (let i = 0; i < def.platforms.length; i++) {
      const p = def.platforms[i];
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(.38, .38, .026, 16),
        new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e1f3fa', emissiveIntensity: .15 }),
      );
      disc.position.set(p.x + offset.x, p.topY + offset.y + .016, p.z + offset.z);
      this.group.add(disc);
    }
  }

  private addSkyDecor(): void {
    const cloudMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: .76, depthWrite: false });
    for (let i = 0; i < 18; i++) {
      const cluster = new THREE.Group();
      const angle = i * 2.3999632;
      const radius = 43 + (i % 4) * 13;
      const height = 6 + (i % 8) * 6.5;
      for (let j = 0; j < 4; j++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 7), cloudMaterial);
        puff.scale.set(4 + j * .55, 1.2 + (j % 2) * .5, 2.2);
        puff.position.set(j * 2.8, Math.sin(j * 2) * .5, (j % 2) * 1.1);
        cluster.add(puff);
      }
      cluster.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      this.group.add(cluster);
    }
  }
}
