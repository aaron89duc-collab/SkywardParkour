import * as THREE from 'three';
import { Assets } from '../core/Assets';
import { Physics } from '../core/Physics';
import type { PrefabData } from './MapTypes';

/** Meshy AI models (normalised offline: base at y=0, centred, height = 1). */
export const PREFAB_FILES: Record<string, string> = {
  starter_house: 'assets/map001/starter_house',
  windmill: 'assets/map001/windmill',
  windmill_variant: 'assets/map001/windmill_variant',
  floating_island: 'assets/map001/floating_island',
  floating_rock_island: 'assets/map001/floating_rock_island',
  waterfall_island: 'assets/map001/waterfall_island',
  rope_bridge: 'assets/map001/rope_bridge',
  market_stall: 'assets/map001/market_stall',
  blue_tent_stall: 'assets/map001/blue_tent_stall',
  stone_arch_gate: 'assets/map001/stone_arch_gate',
  wooden_village_gate: 'assets/map001/wooden_village_gate',
  crystal_blue_shrine: 'assets/map001/crystal_blue_shrine',
  // Map 002 – Rooftop City
  brick_building: 'assets/map002/brick_building',
  crane_tower: 'assets/map002/crane_tower',
  hover_platform: 'assets/map002/hover_platform',
  railing_barrier: 'assets/map002/railing_barrier',
  wooden_crate: 'assets/map002/wooden_crate',
  jump_pad: 'assets/map002/jump_pad',
  speed_pad: 'assets/map002/speed_pad',
  speed_ring: 'assets/map002/speed_ring',
  vent_unit: 'assets/map002/vent_unit',
  water_tower: 'assets/map002/water_tower',
  brick_apartment_building: 'assets/map002/brick_apartment_building',
  yellow_apartment_building: 'assets/map002/yellow_apartment_building',
  tall_office_tower: 'assets/map002/tall_office_tower',
  clock_energy_tower: 'assets/map002/clock_energy_tower',
  portal_gateway_shrine: 'assets/map002/portal_gateway_shrine',
  cargo_crane_tower: 'assets/map002/cargo_crane_tower',
  curved_industrial_vent: 'assets/map002/curved_industrial_vent',
  horizontal_ventilation_duct: 'assets/map002/horizontal_ventilation_duct',
  industrial_billboard_platform: 'assets/map002/industrial_billboard_platform',
  wall_industrial_stairs: 'assets/map002/wall_industrial_stairs',
  brick_vent_tower: 'assets/map002/brick_vent_tower',
  rooftop_clothesline_platform: 'assets/map002/rooftop_clothesline_platform',
  rooftop_greenhouse: 'assets/map002/rooftop_greenhouse',
  satellite_dish_tower: 'assets/map002/satellite_dish_tower',
  street_light_post: 'assets/map002/street_light_post',
  wall_neon_signboard: 'assets/map002/wall_neon_signboard',
};

/** Self-lit prefabs (neon, lamps, the portal): emissive = their own colour texture. */
const EMISSIVE: Record<string, number> = { wall_neon_signboard: 1.1, street_light_post: 0.35, portal_gateway_shrine: 0.35, clock_energy_tower: 0.12, industrial_billboard_platform: 0.18 };

type Batch = {
  id: string;
  lod0: THREE.InstancedMesh;
  lod1: THREE.InstancedMesh | null;
  matrices: THREE.Matrix4[];
  positions: THREE.Vector3[];
  radius: number[];
};

const tmpM = new THREE.Matrix4();

/** Instanced rendering of all prefab placements with distance-based LOD and trimesh colliders. */
export class PrefabSystem {
  group = new THREE.Group();
  batches: Batch[] = [];
  private frame = 0;
  lodDistance = 80;
  extraMaterials: THREE.Material[] = [];

  constructor(private assets: Assets, private physics: Physics) {
    this.group.name = 'prefabs';
  }

  async build(items: (PrefabData & { scenery?: boolean })[]) {
    const byId = new Map<string, (PrefabData & { scenery?: boolean })[]>();
    for (const it of items) {
      if (!PREFAB_FILES[it.id]) { console.warn('Unknown prefab', it.id); continue; }
      let l = byId.get(it.id);
      if (!l) { l = []; byId.set(it.id, l); }
      l.push(it);
    }
    await Promise.all([...byId.entries()].map(async ([id, list]) => {
      const base = PREFAB_FILES[id];
      const needCol = list.some((x) => x.col !== false && !x.scenery);
      const [gltf, col] = await Promise.all([this.assets.gltf(`${base}.glb`), needCol ? this.assets.collision(`${base}.col.bin`) : Promise.resolve(null)]);
      const meshes: THREE.Mesh[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const lod0Mesh = meshes.find((m) => !/lod1/i.test(m.name) && !/lod1/i.test(m.parent?.name ?? '')) ?? meshes[0];
      const lod1Mesh = meshes.find((m) => m !== lod0Mesh && (/lod1/i.test(m.name) || /lod1/i.test(m.parent?.name ?? ''))) ?? null;
      const prepare = (m: THREE.Mesh) => {
        const g = m.geometry.clone();
        g.applyMatrix4(m.matrixWorld);
        g.computeBoundingSphere();
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.envMapIntensity = 0.55;
        mat.roughness = 0.92;
        mat.metalness = 0;
        const em = EMISSIVE[id];
        if (em && mat.map) {
          mat.emissive = new THREE.Color('#ffffff');
          mat.emissiveIntensity = em;
          mat.emissiveMap = mat.map;
          mat.needsUpdate = true;
        }
        return { g, mat };
      };
      const a = prepare(lod0Mesh);
      const n = list.length;
      const lod0 = new THREE.InstancedMesh(a.g, a.mat, n);
      lod0.castShadow = true;
      lod0.receiveShadow = true;
      lod0.name = `prefab_${id}`;
      let lod1: THREE.InstancedMesh | null = null;
      if (lod1Mesh) {
        const b = prepare(lod1Mesh);
        lod1 = new THREE.InstancedMesh(b.g, b.mat, n);
        lod1.castShadow = false;
        lod1.receiveShadow = true;
        lod1.count = 0;
        this.group.add(lod1);
      }
      this.group.add(lod0);
      const batch: Batch = { id, lod0, lod1, matrices: [], positions: [], radius: [] };
      list.forEach((it, i) => {
        const pos = new THREE.Vector3(...it.p);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(it.r));
        const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(it.s, it.s, it.s));
        batch.matrices.push(m);
        batch.positions.push(pos.clone().add(new THREE.Vector3(0, it.s * 0.5, 0)));
        batch.radius.push(it.s);
        lod0.setMatrixAt(i, m);
        if (col && it.col !== false && !it.scenery) this.addCollider(col.positions, col.indices, m);
      });
      lod0.instanceMatrix.needsUpdate = true;
      lod0.computeBoundingSphere();
      this.batches.push(batch);
    }));
  }

  private addCollider(src: Float32Array, idx: Uint32Array, m: THREE.Matrix4) {
    const out = new Float32Array(src.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < src.length; i += 3) {
      v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(m);
      out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z;
    }
    this.physics.addTrimesh(out, idx);
  }

  /** Re-assign instances between LOD0/LOD1 based on camera distance. */
  private lastUpdate = -1;
  private lastCam = new THREE.Vector3(1e9, 0, 0);

  update(camPos: THREE.Vector3, force = false) {
    const now = performance.now();
    const jumped = camPos.distanceToSquared(this.lastCam) > 15 * 15;
    if (!force && !jumped && now - this.lastUpdate < 200) return;
    this.lastUpdate = now;
    this.lastCam.copy(camPos);
    this.frame++;
    for (const b of this.batches) {
      if (!b.lod1) continue;
      let n0 = 0, n1 = 0;
      for (let i = 0; i < b.matrices.length; i++) {
        const d = camPos.distanceTo(b.positions[i]) - b.radius[i] * 0.6;
        if (d < this.lodDistance) b.lod0.setMatrixAt(n0++, b.matrices[i]);
        else b.lod1.setMatrixAt(n1++, b.matrices[i]);
      }
      b.lod0.count = n0;
      b.lod1.count = n1;
      b.lod0.instanceMatrix.needsUpdate = true;
      b.lod1.instanceMatrix.needsUpdate = true;
      b.lod0.computeBoundingSphere();
      b.lod1.computeBoundingSphere();
    }
  }

  /** Local-space -> world transform of every instance of a prefab (used by FX placement). */
  instancesOf(id: string): THREE.Matrix4[] {
    return this.batches.find((b) => b.id === id)?.matrices ?? [];
  }

  getMatrix(id: string, i: number) {
    return this.instancesOf(id)[i] ?? tmpM.identity();
  }
}
