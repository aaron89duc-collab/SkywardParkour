import * as THREE from 'three';
import { breathe } from '../core/Budget';
import { Assets, bakedGeometry } from '../core/Assets';
import { Physics } from '../core/Physics';
import type { PrefabData } from './MapTypes';
import { simplifier, disposeLod, type Detail } from './Detail';

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
  /** from the model file, or a simplified copy of lod0 made in the background */
  lod1: THREE.InstancedMesh | null;
  /** the same lod1 model for instances near the player: these cast shadows (cheaper than lod0 shadows) */
  lod1s: THREE.InstancedMesh | null;
  /** very simple copy (of lod1) for far away */
  lod2: THREE.InstancedMesh | null;
  matrices: THREE.Matrix4[];
  /** world bounding-sphere centre / radius of each instance */
  positions: THREE.Vector3[];
  radius: number[];
  /** lod1 simplified here (texture right): may be used closer than the file's lod1 */
  good?: boolean;
  /** what each instance is drawn as: 0 lod0, 1 lod1 + shadow, 2 lod1, 3 lod2, 4 not drawn (255 = not decided yet) */
  state: Uint8Array;
};

const tmpM = new THREE.Matrix4();
/** level-of-detail hysteresis: back to the finer level only this much closer than the threshold */
const HYST = 0.88;

/** Instanced rendering of all prefab placements with distance-based LOD and trimesh colliders. */
export class PrefabSystem {
  group = new THREE.Group();
  batches: Batch[] = [];
  private frame = 0;
  detail: Detail = { lod0K: 6, lod0Min: 26, lod0KGood: 4.5, lod0MinGood: 10, lod1K: 13, lod1Min: 45, shadowDist: 28, cullK: 170, cullMin: 100, spriteK: 12, spriteDensity: 0.5 };
  private dead = false;
  extraMaterials: THREE.Material[] = [];

  constructor(private assets: Assets, private physics: Physics) {
    this.group.name = 'prefabs';
  }

  /** extraFiles / extraEmissive: models a (downloaded) map brings itself, so new maps need no app update */
  async build(items: (PrefabData & { scenery?: boolean })[], extraFiles: Record<string, string> = {}, extraEmissive: Record<string, number> = {}) {
    const FILES = { ...PREFAB_FILES, ...extraFiles };
    const EMIT = { ...EMISSIVE, ...extraEmissive };
    const byId = new Map<string, (PrefabData & { scenery?: boolean })[]>();
    for (const it of items) {
      if (!FILES[it.id]) { console.warn('Unknown prefab', it.id); continue; }
      let l = byId.get(it.id);
      if (!l) { l = []; byId.set(it.id, l); }
      l.push(it);
    }
    await Promise.all([...byId.entries()].map(async ([id, list]) => {
      const base = FILES[id];
      const needCol = list.some((x) => x.col !== false && !x.scenery);
      const [gltf, col] = await Promise.all([this.assets.gltf(`${base}.glb`), needCol ? this.assets.collision(`${base}.col.bin`) : Promise.resolve(null)]);
      const meshes: THREE.Mesh[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const lod0Mesh = meshes.find((m) => !/lod1/i.test(m.name) && !/lod1/i.test(m.parent?.name ?? '')) ?? meshes[0];
      const lod1Mesh = meshes.find((m) => m !== lod0Mesh && (/lod1/i.test(m.name) || /lod1/i.test(m.parent?.name ?? ''))) ?? null;
      const prepare = (m: THREE.Mesh) => {
        const g = bakedGeometry(m);
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.envMapIntensity = 0.55;
        mat.roughness = 0.92;
        mat.metalness = 0;
        const em = EMIT[id];
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
      this.group.add(lod0);
      const batch: Batch = { id, lod0, lod1: null, lod1s: null, lod2: null, matrices: [], positions: [], radius: [], state: new Uint8Array(n).fill(255) };
      // the lod1 inside the model files often has a broken texture (seams welded by the asset pipeline): a copy
      // simplified here (texture seams kept) is used when it can be made, the file's lod1 only as a fallback
      const fileLod1 = lod1Mesh ? prepare(lod1Mesh) : null;
      (batch as Batch & { fileLod1?: { g: THREE.BufferGeometry; mat: THREE.Material } | null }).fileLod1 = fileLod1;
      if (!a.g.boundingSphere) a.g.computeBoundingSphere();
      const bs = a.g.boundingSphere!;
      for (const [i, it] of list.entries()) {
        await breathe();
        const pos = new THREE.Vector3(...it.p);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(it.r));
        const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(it.s, it.s, it.s));
        batch.matrices.push(m);
        batch.positions.push(bs.center.clone().applyMatrix4(m));
        batch.radius.push(bs.radius * it.s);
        lod0.setMatrixAt(i, m);
        if (col && it.col !== false && !it.scenery) this.addCollider(col.positions, col.indices, m);
      }
      lod0.instanceMatrix.needsUpdate = true;
      lod0.computeBoundingSphere();
      this.batches.push(batch);
      this.farCopies(batch);
    }));
  }

  private inst(b: Batch, g: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], name: string, shadow: boolean) {
    const m = new THREE.InstancedMesh(g, mat, b.matrices.length || b.state.length);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.count = 0;
    m.name = `${b.lod0.name}_${name}`;
    this.group.add(m);
    return m;
  }

  private setLod1(b: Batch, g: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[]) {
    b.lod1 = this.inst(b, g, mat, 'lod1', false);
    b.lod1s = this.inst(b, g, mat, 'lod1s', true);
    b.state.fill(255);
  }

  /** simplified copies, made in a worker: lod1 (from lod0; the file's lod1 when that fails), lod2 for far away */
  private farCopies(b: Batch) {
    const file = (b as Batch & { fileLod1?: { g: THREE.BufferGeometry; mat: THREE.Material } | null }).fileLod1 ?? null;
    const two = () => {
      if (!b.lod1) return;
      void simplifier.get(b.lod1.geometry, 0.3, false, this.owner).then((g) => {
        if (!g) return;
        if (this.dead) { disposeLod(g); return; } // the map went away while the worker was busy
        b.lod2 = this.inst(b, g, b.lod1!.material, 'lod2', false); b.state.fill(255);
      });
    };
    void simplifier.get(b.lod0.geometry, 0.25, false, this.owner).then((g) => {
      if (this.dead) { if (g) disposeLod(g); return; }
      if (g) { this.setLod1(b, g, b.lod0.material); b.good = true; }
      else if (file) this.setLod1(b, file.g, file.mat);
      else return;
      if (g && file) file.g.dispose(); // not needed
      two();
    });
  }

  /** handed to the simplifier: jobs of an unloaded map are skipped */
  private owner = { dead: false };
  dispose() { this.dead = true; this.owner.dead = true; }

  private addCollider(src: Float32Array, idx: Uint32Array, m: THREE.Matrix4) {
    const out = new Float32Array(src.length);
    const v = new THREE.Vector3();
    for (let i = 0; i < src.length; i += 3) {
      v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(m);
      out[i] = v.x; out[i + 1] = v.y; out[i + 2] = v.z;
    }
    this.physics.addTrimesh(out, idx);
  }

  /**
   * Re-assign instances between lod0 / lod1 / lod2 / not drawn by camera distance and size. The instance buffers are
   * uploaded again only when something changed (they used to be re-sent five times a second: a steady hitch).
   */
  private lastUpdate = -1;
  private lastCam = new THREE.Vector3(1e9, 0, 0);

  update(camPos: THREE.Vector3, force = false) {
    const now = performance.now();
    const jumped = camPos.distanceToSquared(this.lastCam) > 8 * 8;
    if (!force && !jumped && now - this.lastUpdate < 200) return;
    this.lastUpdate = now;
    this.lastCam.copy(camPos);
    this.frame++;
    const D = this.detail;
    for (const b of this.batches) {
      let changed = force;
      const n = b.matrices.length;
      for (let i = 0; i < n; i++) {
        const r = b.radius[i];
        const d = Math.max(0, camPos.distanceTo(b.positions[i]) - r);
        // hysteresis: a level is left at its threshold but only taken back 12 % closer, so an instance standing
        // right at a threshold does not flip back and forth (popping)
        const cur = b.state[i] === 255 ? -1 : b.state[i];
        const H = (beyond: boolean) => (beyond ? HYST : 1);
        let st: number;
        if (d > Math.max(D.cullMin, r * D.cullK) * H(cur === 4)) st = 4;
        else if (d < (b.good ? Math.max(D.lod0MinGood, r * D.lod0KGood) : Math.max(D.lod0Min, r * D.lod0K)) * H(cur >= 1) || !b.lod1) st = 0;
        else if (d < Math.max(D.lod1Min, r * D.lod1K) * H(cur >= 3) || !b.lod2) st = d < D.shadowDist * H(cur === 2 || cur === 3) ? 1 : 2;
        else st = 3;
        if (b.state[i] !== st) { b.state[i] = st; changed = true; }
      }
      if (!changed) continue;
      const meshes = [b.lod0, b.lod1s, b.lod1, b.lod2];
      const cnt = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const st = b.state[i];
        if (st < 4) meshes[st]!.setMatrixAt(cnt[st]++, b.matrices[i]);
      }
      for (let k = 0; k < 4; k++) {
        const m = meshes[k];
        if (!m) continue;
        m.count = cnt[k];
        if (cnt[k] > 0) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
      }
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
