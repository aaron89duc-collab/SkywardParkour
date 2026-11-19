import * as THREE from 'three';
import { Assets } from '../core/Assets';
import { Physics } from '../core/Physics';
import type { MapData, MapRegistryEntry, ZoneData } from './MapTypes';
import { KitBuilder } from './Kit';
import { PrefabSystem } from './Prefabs';
import { SpriteSystem, type AtlasRect } from './Sprites';
import { buildTerrain } from './Terrain';
import { Effects } from '../fx/Effects';

type LoadedMap = {
  entry: MapRegistryEntry;
  data: MapData;
  group: THREE.Group;
  prefabs: PrefabSystem;
  sprites: SpriteSystem | null;
};

/**
 * Loads fixed, hand-designed maps that stack vertically (Map 001 at the bottom, later maps above).
 * Maps are activated by vertical proximity so falling back down always finds geometry loaded.
 */
export class MapManager {
  registry: MapRegistryEntry[] = [];
  loaded = new Map<string, LoadedMap>();
  root = new THREE.Group();
  atlasTex: THREE.Texture | null = null;
  atlasRects: Record<string, AtlasRect> = {};

  constructor(private assets: Assets, private physics: Physics, private scene: THREE.Scene, private fx: Effects) {
    this.root.name = 'maps';
    scene.add(this.root);
  }

  async loadRegistry() {
    this.registry = await this.assets.json<MapRegistryEntry[]>('maps/index.json');
  }

  /** Load every map whose vertical range is within `margin` of the given height. */
  async ensureAround(y: number, margin = 80) {
    for (const e of this.registry) {
      if (y + margin >= e.yMin && y - margin <= e.yMax && !this.loaded.has(e.id)) await this.load(e);
    }
  }

  async load(entry: MapRegistryEntry) {
    const data = await this.assets.json<MapData>(entry.file);
    const group = new THREE.Group();
    group.name = entry.id;

    if (!this.atlasTex) {
      const [tex, rects] = await Promise.all([this.assets.texture('assets/sprites/map001_atlas.webp'), this.assets.json<Record<string, AtlasRect>>('assets/sprites/map001_atlas.json')]);
      this.atlasTex = tex;
      this.atlasRects = rects;
    }

    group.add(buildTerrain(data.terrain, this.physics));

    const kit = new KitBuilder();
    for (const k of data.kit) kit.add(k);
    for (const m of kit.build()) group.add(m);
    for (const c of kit.colliders) {
      if (c.type === 'box') this.physics.addBox(c.center, c.half, c.quat);
      else if (c.type === 'cylinder') this.physics.addCylinder(c.center, c.halfHeight, c.radius, c.quat);
      else this.physics.addCapsule(c.center, c.halfHeight, c.radius, c.quat);
    }

    const prefabs = new PrefabSystem(this.assets, this.physics);
    await prefabs.build([...data.prefabs, ...(data.scenery ?? []).map((s) => ({ ...s, col: false, scenery: true }))]);
    group.add(prefabs.group);

    let sprites: SpriteSystem | null = null;
    if (this.atlasTex) {
      sprites = new SpriteSystem(this.atlasTex, this.atlasRects);
      group.add(sprites.build(data.sprites));
    }

    // effects bound to prefabs
    // sky waterfalls fall all the way down to the village and feed a pond (or fade into the cloud sea)
    prefabs.instancesOf('waterfall_island').forEach((m) => {
      const base = new THREE.Vector3().setFromMatrixPosition(m);
      const scenic = (data.scenery ?? []).some((sc) => Math.abs(sc.p[0] - base.x) < 0.01 && Math.abs(sc.p[2] - base.z) < 0.01);
      const R = data.terrain.radius;
      const fall = scenic ? 90 : base.y;
      const end = this.fx.addWaterfallIsland(m, Math.max(10, fall));
      if (!scenic && Math.hypot(end.x, end.z) < R - 4) this.fx.addPond(end, 3.4);
    });
    data.prefabs.forEach((p) => {
      if (p.id === 'crystal_blue_shrine') this.fx.addShrine(new THREE.Vector3(...p.p), p.s, p.r, p.tag === 'exit');
    });
    for (const f of data.fx) {
      if (f.t === 'waterfall') this.fx.addWaterfall(f);
      else if (f.t === 'glow') this.fx.addGlow(new THREE.Vector3(...f.p), f.s, f.c);
      else if (f.t === 'milestone' && this.atlasTex && this.atlasRects['gold_diamond_collectible']) this.fx.addMilestone(new THREE.Vector3(...f.p), f.h, this.atlasTex, this.atlasRects['gold_diamond_collectible']);
    }

    this.root.add(group);
    this.loaded.set(entry.id, { entry, data, group, prefabs, sprites });
    return data;
  }

  get primary(): MapData | null {
    const first = this.loaded.values().next();
    return first.done ? null : first.value.data;
  }

  zoneAt(y: number): { map: MapData; zone: ZoneData } | null {
    for (const m of this.loaded.values()) {
      for (const z of m.data.zones) if (y >= z.y0 && y < z.y1) return { map: m.data, zone: z };
    }
    return null;
  }

  update(time: number, camPos: THREE.Vector3, tint: THREE.Color) {
    for (const m of this.loaded.values()) {
      m.prefabs.update(camPos);
      m.sprites?.update(time, tint);
    }
  }

  setLodDistance(d: number) {
    for (const m of this.loaded.values()) { m.prefabs.lodDistance = d; m.prefabs.update(new THREE.Vector3(1e9, 0, 0), true); }
  }
}
