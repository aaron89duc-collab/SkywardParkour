import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export type CollisionMesh = { positions: Float32Array; indices: Uint32Array };

const BASE = import.meta.env.BASE_URL;
export const assetUrl = (p: string) => (p.startsWith('http') ? p : BASE + p.replace(/^\//, ''));

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
