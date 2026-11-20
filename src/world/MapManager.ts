import * as THREE from 'three';
import { Assets } from '../core/Assets';
import { Physics } from '../core/Physics';
import type { MapData, MapRegistryEntry, ZoneData } from './MapTypes';
import { KitBuilder } from './Kit';
import { PrefabSystem } from './Prefabs';
import { SpriteSystem, type AtlasRect } from './Sprites';
import { buildTerrain, type Footprint } from './Terrain';
import { Effects } from '../fx/Effects';
import { MoverSystem } from './Movers';
import { BoosterSystem, type Ladder } from './Boosters';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GateSystem } from './Gates';

type LoadedMap = {
  entry: MapRegistryEntry;
  data: MapData;
  group: THREE.Group;
  prefabs: PrefabSystem;
  sprites: SpriteSystem | null;
  movers: MoverSystem;
  boosters: BoosterSystem;
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
  private ladderList: Ladder[] = [];
  private loading = new Map<string, Promise<MapData>>();

  gates: GateSystem;

  constructor(private assets: Assets, private physics: Physics, private scene: THREE.Scene, private fx: Effects) {
    this.root.name = 'maps';
    scene.add(this.root);
    this.gates = new GateSystem(physics);
    scene.add(this.gates.group);
  }

  /** close / open the end-of-map gates (next map missing / loaded); returns ids of maps whose way just opened */
  syncGates(text: (nextId: string, fallback: string) => { title: string; sub: string }) {
    return this.gates.sync([...this.loaded.values()].map((m) => m.data), (id) => this.loaded.has(id), text);
  }

  /** maps playable on this device, bottom to top (from the content manager: app + downloads) */
  setRegistry(entries: MapRegistryEntry[]) {
    this.registry = [...entries].sort((a, b) => (a.order ?? a.yMin) - (b.order ?? b.yMin));
  }
  /** called when a map starts loading (the content manager pins its files for this session) */
  onLoadStart: ((id: string) => void) | null = null;
  /** called when a map has been added to the world */
  onLoaded: ((id: string) => void) | null = null;

  /** Load every map whose vertical range is within `margin` of the given height. */
  async ensureAround(y: number, margin = 80) {
    for (const e of this.registry) {
      if (y + margin >= e.yMin && y - margin <= e.yMax && !this.loaded.has(e.id)) await this.load(e);
    }
  }

  /** Load a map once (concurrent callers share the same promise). */
  load(entry: MapRegistryEntry): Promise<MapData> {
    const done = this.loaded.get(entry.id);
    if (done) return Promise.resolve(done.data);
    let p = this.loading.get(entry.id);
    if (!p) {
      this.onLoadStart?.(entry.id);
      p = this.loadNow(entry).then((d) => { this.onLoaded?.(entry.id); return d; });
      p.catch(() => this.loading.delete(entry.id));
      this.loading.set(entry.id, p);
    }
    return p;
  }

  entry(id: string) { return this.registry.find((e) => e.id === id) ?? null; }
  map(id: string) { return this.loaded.get(id)?.data ?? null; }

  private loadNow(entry: MapRegistryEntry) {
    return this.physics.ownedBy(entry.id, () => this.build(entry));
  }

  /**
   * Take a map out of the world: its scene graph (GPU buffers freed), every collider it made, its effects and
   * its gate. Its files stay on the device (and in the asset cache), so loading it again is quick and offline.
   */
  unload(id: string) {
    const m = this.loaded.get(id);
    if (!m) return false;
    this.loaded.delete(id);
    this.loading.delete(id);
    this.root.remove(m.group);
    m.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) {
        mesh.geometry?.dispose();
        (o as THREE.InstancedMesh).dispose?.();
      }
    });
    this.physics.removeOwned(id);
    this.fx.removeScope(id);
    this.ladderList = [...this.loaded.values()].flatMap((x) => x.boosters.ladders);
    this.onUnloaded?.(id);
    return true;
  }
  /** called when a map has been taken out of the world */
  onUnloaded: ((id: string) => void) | null = null;

  /**
   * Streaming: keep only the maps whose registry index is in [lo, hi] (the map being played and its
   * neighbours). Returns the ids that were unloaded. Loading the ones that are missing is the caller's job.
   */
  retain(lo: number, hi: number) {
    const out: string[] = [];
    this.registry.forEach((e, i) => { if ((i < lo || i > hi) && this.loaded.has(e.id) && this.unload(e.id)) out.push(e.id); });
    return out;
  }

  private async build(entry: MapRegistryEntry) {
    const data = await this.assets.json<MapData>(entry.file);
    const group = new THREE.Group();
    group.name = entry.id;

    if (!this.atlasTex) {
      const atlas = data.atlas ?? 'assets/sprites/map001_atlas';
      const [tex, rects] = await Promise.all([this.assets.texture(`${atlas}.webp`), this.assets.json<Record<string, AtlasRect>>(`${atlas}.json`)]);
      this.atlasTex = tex;
      this.atlasRects = rects;
    }

    // building footprints (for the painted city streets)
    const footprints: Footprint[] = [];
    for (const k of data.kit) if (k.k === 'building') footprints.push({ x: k.p[0], z: k.p[2], w: k.s[0], d: k.s[2], r: THREE.MathUtils.degToRad(k.r ?? 0) });
    for (const p of data.prefabs) if (p.id === 'brick_building' && Math.abs(p.p[1] - (data.terrain.center?.[1] ?? 0)) < 0.5) footprints.push({ x: p.p[0], z: p.p[2], w: 1.05 * p.s, d: 1.0 * p.s, r: THREE.MathUtils.degToRad(p.r) });
    group.add(buildTerrain(data.terrain, this.physics, footprints));

    const kit = new KitBuilder();
    for (const k of data.kit) kit.add(k);
    for (const m of kit.build()) group.add(m);
    for (const c of kit.colliders) {
      if (c.type === 'box') this.physics.addBox(c.center, c.half, c.quat, c.groups);
      else if (c.type === 'cylinder') this.physics.addCylinder(c.center, c.halfHeight, c.radius, c.quat);
      else this.physics.addCapsule(c.center, c.halfHeight, c.radius, c.quat);
    }

    const prefabs = new PrefabSystem(this.assets, this.physics);
    await prefabs.build([...data.prefabs, ...(data.scenery ?? []).map((s) => ({ ...s, col: false, scenery: true }))], data.prefabFiles, data.emissive);
    group.add(prefabs.group);

    let sprites: SpriteSystem | null = null;
    if (this.atlasTex) {
      sprites = new SpriteSystem(this.atlasTex, this.atlasRects);
      group.add(sprites.build(data.sprites));
    }

    // effects bound to prefabs (recorded per map: they go when the map is unloaded)
    this.fx.beginScope(entry.id);
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

    for (const f of data.fx) if (f.t === 'portal') this.fx.addPortal(new THREE.Vector3(...f.p), f.s, f.r);
    this.fx.endScope();

    const movers = new MoverSystem(this.physics);
    await movers.build(data.movers ?? [], this.assets, data.moverModels);
    group.add(movers.group);
    const boosters = new BoosterSystem(this.physics);
    await boosters.build(data.pads, data.rings, data.ladders, this.assets, data.padModel);
    group.add(boosters.group);

    this.root.add(group);
    this.loaded.set(entry.id, { entry, data, group, prefabs, sprites, movers, boosters });
    this.ladderList = [...this.loaded.values()].flatMap((m) => m.boosters.ladders);
    this.physics.world.updateSceneQueries();
    return data;
  }

  // ---- dynamic world features across all loaded maps (Player.hooks)
  moverOf(c: RAPIER.Collider | null | undefined) {
    if (!c) return null;
    for (const m of this.loaded.values()) { const r = m.movers.moverOf(c); if (r) return r; }
    return null;
  }
  padOf(c: RAPIER.Collider | null | undefined) {
    if (!c) return null;
    for (const m of this.loaded.values()) { const r = m.boosters.padOf(c); if (r) return r; }
    return null;
  }
  ringCrossed(a: THREE.Vector3, b: THREE.Vector3) {
    for (const m of this.loaded.values()) { const r = m.boosters.ringCrossed(a, b); if (r) return r; }
    return null;
  }
  ladders() { return this.ladderList; }

  stepMovers(t: number, dt: number) { for (const m of this.loaded.values()) m.movers.step(t, dt); }
  resetMovers(t: number) { for (const m of this.loaded.values()) m.movers.reset(t); }
  syncMovers(alpha: number) { for (const m of this.loaded.values()) m.movers.syncVisual(alpha); }

  get primary(): MapData | null {
    const first = this.loaded.values().next();
    return first.done ? null : first.value.data;
  }

  /** The map the player is in: maps are stacked by height (registry yMin..yMax bands; the highest band wins). */
  /** Which map's HUD applies at this height. `current` is kept within 2 m of its band (hysteresis), so standing
   *  on the city's station (140 m, same level as the village summit) never flickers between the two maps. */
  mapAt(x: number, y: number, z: number, current?: MapData | null): MapData | null {
    void x; void z;
    if (current) {
      const c = this.loaded.get(current.id);
      if (c && y >= c.entry.yMin - 2 && y < c.entry.yMax + 2) return current;
    }
    let best: MapData | null = null;
    for (const m of this.loaded.values()) if (y >= m.entry.yMin && y < m.entry.yMax) best = m.data;
    return best;
  }

  zoneAt(y: number, map?: MapData | null): { map: MapData; zone: ZoneData } | null {
    for (const m of this.loaded.values()) {
      if (map && m.data !== map) continue;
      for (const z of m.data.zones) if (y >= z.y0 && y < z.y1) return { map: m.data, zone: z };
    }
    return null;
  }

  update(time: number, camPos: THREE.Vector3, tint: THREE.Color, dt = 1 / 60) {
    for (const m of this.loaded.values()) {
      m.prefabs.update(camPos);
      m.sprites?.update(time, tint);
      m.boosters.update(dt, time);
    }
    this.gates.update(time);
  }

  setLodDistance(d: number) {
    for (const m of this.loaded.values()) { m.prefabs.lodDistance = d; m.prefabs.update(new THREE.Vector3(1e9, 0, 0), true); }
  }
}
