import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export type CollisionMesh = { positions: Float32Array; indices: Uint32Array };

const BASE = import.meta.env.BASE_URL;
export const assetUrl = (p: string) => (p.startsWith('http') ? p : BASE + p.replace(/^\//, ''));

/**
 * Geometry of a glTF mesh with its node transform baked in (model space -> the normalised prefab space).
 * Our GLBs are quantized (positions int16, normalised to -1..1) and keep the real size in the node's
 * scale/offset: using `mesh.geometry` alone shrinks and sinks the model, and baking the matrix into int16
 * positions overflows when the result leaves -1..1 (vertices wrap to the other side). Such positions are
 * converted to float first; models that still fit stay quantized (less memory).
 */
export function bakedGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const g = mesh.geometry.clone();
  mesh.updateWorldMatrix(true, false);
  const pos = g.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  const quantized = pos.normalized || !(pos.array instanceof Float32Array);
  if (quantized) {
    g.computeBoundingBox();
    const bb = g.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    const reach = Math.max(-bb.min.x, -bb.min.y, -bb.min.z, bb.max.x, bb.max.y, bb.max.z);
    if (reach > 0.999) {
      const n = pos.count, out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { out[i * 3] = pos.getX(i); out[i * 3 + 1] = pos.getY(i); out[i * 3 + 2] = pos.getZ(i); }
      g.setAttribute('position', new THREE.BufferAttribute(out, 3));
    }
  }
  // normals / tangents stay unit length under the transform: their quantized form is fine
  g.applyMatrix4(mesh.matrixWorld);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** First non-LOD1 mesh of a loaded glTF scene. */
export function lod0Mesh(scene: THREE.Object3D): THREE.Mesh | null {
  let mesh: THREE.Mesh | null = null;
  scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh && !/lod1/i.test(o.name) && !/lod1/i.test(o.parent?.name ?? '')) mesh = o as THREE.Mesh; });
  return mesh;
}

/** Cached loader for GLB models, collision meshes, textures and JSON. Reports progress. */
export class Assets {
  private gltfCache = new Map<string, Promise<GLTF>>();
  private colCache = new Map<string, Promise<CollisionMesh>>();
  private texCache = new Map<string, Promise<THREE.Texture>>();
  private loader: GLTFLoader;
  private texLoader = new THREE.TextureLoader();
  private pending = 0;
  private done = 0;
  onProgress: ((done: number, total: number) => void) | null = null;
  /** downloaded content: maps a logical path to a blob: URL (null = file inside the app) */
  resolver: ((path: string) => Promise<string | null>) | null = null;

  private async url(path: string) {
    const r = this.resolver ? await this.resolver(path) : null;
    return r ?? assetUrl(path);
  }

  constructor() {
    this.loader = new GLTFLoader();
    // decode compressed meshes in background threads: a map streaming in mid-climb does not stall the game
    const dec = MeshoptDecoder as typeof MeshoptDecoder & { useWorkers?: (n: number) => void };
    try { dec.useWorkers?.(Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))); } catch { /* main thread then */ }
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending++;
    this.emit();
    return p.finally(() => { this.done++; this.emit(); });
  }
  private emit() { this.onProgress?.(this.done, this.pending); }

  gltf(path: string): Promise<GLTF> {
    let p = this.gltfCache.get(path);
    if (!p) {
      p = this.track(this.url(path).then((u) => this.loader.loadAsync(u)));
      this.gltfCache.set(path, p);
    }
    return p;
  }

  collision(path: string): Promise<CollisionMesh> {
    let p = this.colCache.get(path);
    if (!p) {
      p = this.track(
        this.url(path).then((u) => fetch(u)).then(async (r) => {
          if (!r.ok) throw new Error(`Cannot load ${path}`);
          const buf = await r.arrayBuffer();
          const dv = new DataView(buf);
          const nv = dv.getUint32(0, true);
          const ni = dv.getUint32(4, true);
          const positions = new Float32Array(buf.slice(8, 8 + nv * 12));
          const indices = new Uint32Array(buf.slice(8 + nv * 12, 8 + nv * 12 + ni * 4));
          return { positions, indices };
        }),
      );
      this.colCache.set(path, p);
    }
    return p;
  }

  texture(path: string, srgb = true): Promise<THREE.Texture> {
    let p = this.texCache.get(path);
    if (!p) {
      p = this.track(this.url(path).then((u) => this.texLoader.loadAsync(u)).then((t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      }));
      this.texCache.set(path, p);
    }
    return p;
  }

  json<T = unknown>(path: string): Promise<T> {
    return this.track(this.url(path).then((u) => fetch(u)).then((r) => {
      if (!r.ok) throw new Error(`Cannot load ${path}`);
      return r.json() as Promise<T>;
    }));
  }
}
