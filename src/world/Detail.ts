import * as THREE from 'three';

/**
 * Automatic level of detail for everything a map puts in the world – current maps and any map added later, with
 * nothing to set up per map:
 *  - far copies of heavy meshes, simplified in a worker (meshoptimizer) the first time they are needed;
 *  - small things far away are not drawn at all (their screen size would be a few pixels);
 *  - transparent double-sided materials drawn in one pass instead of two (three.js otherwise draws them twice
 *    and re-checks their shader every frame).
 * Hidden objects are taken out with `layers` (not `visible`), so the game's own show/hide logic is untouched.
 */
export type Detail = {
  // Distances grow with the object's size (bounding radius r): the simplification error is relative to the size,
  // so this keeps the error on screen about the same for a crate and a tower.
  /** full model while distance < max(lod0Min, r * lod0K) - models whose lod1 is the file's own (often broken) */
  lod0K: number;
  lod0Min: number;
  /** the same for models with a good lod1 (simplified here with the texture seams kept): they switch earlier */
  lod0KGood: number;
  lod0MinGood: number;
  /** prefabs: lod1 while distance < max(lod1Min, r * lod1K), the very simple lod2 beyond */
  lod1K: number;
  lod1Min: number;
  /** prefabs within this distance cast shadows (with their lod1 model when they are past lod0) */
  shadowDist: number;
  /** an object is drawn while distance < max(cullMin, r * cullK) */
  cullK: number;
  cullMin: number;
  /** PNG props (world/Sprites.ts): drawn while distance < height x spriteK; beyond 30 m only this share of them */
  spriteK: number;
  spriteDensity: number;
};

// -------------------------------------------------------------------------- materials
const tuned = new WeakSet<THREE.Material>();
const instCopy = new WeakMap<THREE.Material, THREE.Material>();
/**
 * Call after adding things to the scene (cheap). Per material:
 *  - transparent + double-sided: one pass instead of two;
 *  - shared by instanced and plain meshes, or by meshes that do / do not receive shadows: three.js would switch
 *    shader programs back and forth on every draw (and look the program up again each time, every frame).
 *    Instanced users get their own copy; every user then receives shadows if one of them does.
 */
export function tuneMaterials(root: THREE.Object3D, full = true) {
  const users = new Map<THREE.Material, THREE.Mesh[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!m || !mesh.isMesh) return;
    for (const x of Array.isArray(m) ? m : [m]) {
      if (!tuned.has(x)) {
        tuned.add(x);
        if (x.transparent && x.side === THREE.DoubleSide) x.forceSinglePass = true;
      }
      if (!full) continue;
      let l = users.get(x);
      if (!l) { l = []; users.set(x, l); }
      l.push(mesh);
    }
  });
  if (!full) return;
  for (const [mat, list] of users) {
    if (list.length < 2) continue;
    const inst = list.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh);
    if (inst.length && inst.length < list.length && !Array.isArray(inst[0].material)) {
      let c = instCopy.get(mat);
      if (!c) { c = mat.clone(); tuned.add(c); instCopy.set(mat, c); }
      for (const o of inst) o.material = c;
    }
    if (list.some((o) => o.receiveShadow) && list.some((o) => !o.receiveShadow)) for (const o of list) o.receiveShadow = true;
  }
}

// -------------------------------------------------------------------------- simplifier
/** Simplified copies of geometries (shared attributes, new index), made in a worker and cached per geometry. */
export class Simplifier {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, (idx: Uint32Array | null) => void>();
  private cache = new WeakMap<THREE.BufferGeometry, Map<number, Promise<THREE.BufferGeometry | null>>>();
  private broken = false;

  private start() {
    if (this.worker || this.broken) return this.worker;
    try {
      this.worker = new Worker(new URL('./simplify.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; idx: Uint32Array | null }>) => {
        const f = this.waiting.get(e.data.id);
        this.waiting.delete(e.data.id);
        f?.(e.data.idx);
      };
      this.worker.onerror = () => { this.broken = true; for (const f of this.waiting.values()) f(null); this.waiting.clear(); };
    } catch { this.broken = true; }
    return this.worker;
  }

  /** a copy with about `ratio` of the triangles (null when it cannot be made or would not be much simpler) */
  get(src: THREE.BufferGeometry, ratio: number, permissive = false): Promise<THREE.BufferGeometry | null> {
    let per = this.cache.get(src);
    if (!per) { per = new Map(); this.cache.set(src, per); }
    const key = permissive ? -ratio : ratio;
    let p = per.get(key);
    if (!p) { p = this.make(src, ratio, permissive); per.set(key, p); }
    return p;
  }

  private async make(src: THREE.BufferGeometry, ratio: number, permissive: boolean): Promise<THREE.BufferGeometry | null> {
    const w = this.start();
    if (!w || src.groups.length > 1) return null;
    const pa = src.getAttribute('position');
    if (!pa) return null;
    const n = pa.count;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = pa.getX(i); pos[i * 3 + 1] = pa.getY(i); pos[i * 3 + 2] = pa.getZ(i); }
    const ix = src.getIndex();
    const idx = ix ? Uint32Array.from(ix.array as ArrayLike<number>) : null;
    const before = ix ? ix.count : n;
    const id = ++this.seq;
    const out = await new Promise<Uint32Array | null>((res) => { this.waiting.set(id, res); w.postMessage({ id, pos, idx, ratio, err: 0.04, permissive }, [pos.buffer, ...(idx ? [idx.buffer] : [])]); });
    if (!out || out.length < 3 || out.length > before * 0.7) return null;
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
    g.setIndex(new THREE.BufferAttribute(out, 1));
    if (!src.boundingSphere) src.computeBoundingSphere();
    if (!src.boundingBox) src.computeBoundingBox();
    g.boundingSphere = src.boundingSphere!.clone();
    g.boundingBox = src.boundingBox!.clone();
    g.userData.lodOf = src;
    return g;
  }
}

export const simplifier = new Simplifier();

export function triangles(g: THREE.BufferGeometry) {
  return Math.floor((g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3);
}

// -------------------------------------------------------------------------- per-object culling + LOD
type Ent = {
  o: THREE.Object3D;
  mesh: THREE.Mesh | null;
  c0: THREE.Vector3; // local bounding-sphere centre
  r0: number; // local radius
  mask: number; // layers when shown
  hidden: boolean;
  hi: THREE.BufferGeometry | null;
  lo: THREE.BufferGeometry | null | undefined; // undefined: not asked yet
  heavy: boolean;
};

const HEAVY = 1500; // meshes with more triangles get a far copy
const tmp = new THREE.Vector3();

export class Culler {
  private ents: Ent[] = [];
  private last = -1e9;
  private lastCam = new THREE.Vector3(1e9, 0, 0);

  constructor(private root: THREE.Object3D) { this.collect(); }

  /** (re)read the objects under the root: keeps the state of the ones already known */
  collect() {
    const old = new Map(this.ents.map((e) => [e.o, e]));
    this.ents = [];
    this.root.traverse((o) => {
      if (o.userData.noCull || o.frustumCulled === false) return; // positions in a shader: bounds are not reliable
      const a = o as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean; isSprite?: boolean; isPoints?: boolean; isLine?: boolean };
      if (a.isInstancedMesh || a.isSkinnedMesh || a.isPoints || a.isLine) return;
      if (!a.isMesh && !a.isSprite) return;
      const was = old.get(o);
      if (was) { this.ents.push(was); return; }
      let c0 = new THREE.Vector3(), r0 = 0.71; // a sprite: unit quad
      if (a.isMesh) {
        const g = a.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (g.boundingSphere) { c0 = g.boundingSphere.center.clone(); r0 = g.boundingSphere.radius; }
      }
      const mesh = a.isMesh ? (a as THREE.Mesh) : null;
      this.ents.push({ o, mesh, c0, r0, mask: o.layers.mask, hidden: false, hi: mesh?.geometry ?? null, lo: undefined, heavy: !!mesh && triangles(mesh.geometry) >= HEAVY });
    });
  }

  /** Every ~150 ms (or right away after a jump of the camera). `force` re-applies everything. */
  update(cam: THREE.Vector3, d: Detail, force = false) {
    const now = performance.now();
    if (!force && now - this.last < 150 && cam.distanceToSquared(this.lastCam) < 16) return;
    this.last = now;
    this.lastCam.copy(cam);
    for (const e of this.ents) {
      const mw = e.o.matrixWorld;
      tmp.copy(e.c0).applyMatrix4(mw);
      const r = e.r0 * mw.getMaxScaleOnAxis();
      const dist = Math.max(0, tmp.distanceTo(cam) - r);
      const hide = dist > Math.max(d.cullMin, r * d.cullK);
      if (hide !== e.hidden) {
        if (!hide && e.o.layers.mask !== 0) e.mask = e.o.layers.mask; // game changed the layers meanwhile
        e.hidden = hide;
        e.o.layers.mask = hide ? 0 : e.mask;
      }
      if (!e.heavy || !e.mesh) continue;
      const m = e.mesh;
      if (m.geometry !== e.hi && m.geometry !== e.lo) { e.hi = m.geometry; e.lo = undefined; e.heavy = triangles(m.geometry) >= HEAVY; if (!e.heavy) continue; }
      const far = !hide && dist > Math.max(2 * d.lod0Min, r * 2 * d.lod0K); // runtime copies: a little later than prefabs
      if (far && e.lo === undefined) {
        e.lo = null;
        const hi = e.hi!;
        void simplifier.get(hi, 0.18).then((g) => { if (e.hi === hi) e.lo = g; });
      }
      const want = far && e.lo ? e.lo : e.hi!;
      if (m.geometry !== want) m.geometry = want;
    }
  }

  /** before the root is thrown away: free the far copies (their attributes belong to the full models) */
  dispose() {
    for (const e of this.ents) {
      if (e.mesh && e.lo && e.mesh.geometry === e.lo && e.hi) e.mesh.geometry = e.hi;
      if (e.lo) disposeLod(e.lo);
    }
    this.ents = [];
  }
}

/** a simplified copy shares its attributes with the full model: free only its own index */
export function disposeLod(g: THREE.BufferGeometry) {
  const keep = { ...g.attributes };
  for (const k of Object.keys(keep)) g.deleteAttribute(k);
  g.dispose();
}
