/// <reference lib="webworker" />
// Mesh simplification off the main thread (no hitch while a map loads in the background during play).
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

type Req = { id: number; pos: Float32Array; idx: Uint32Array | null; ratio: number; err: number; permissive?: boolean };

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, pos, ratio, err } = e.data;
  try {
    await MeshoptSimplifier.ready;
    const nv = pos.length / 3;
    let idx = e.data.idx;
    if (!idx) { idx = new Uint32Array(nv); for (let i = 0; i < nv; i++) idx[i] = i; }
    // vertices are NOT welded across texture seams: that smeared the texture into big wrong-coloured triangles.
    // Models with many seams simplify less (the caller drops a copy that is not much simpler).
    const target = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
    // permissive: may collapse across texture seams (old models with seams everywhere cannot simplify otherwise)
    const [out] = MeshoptSimplifier.simplify(idx, pos, 3, target, err, e.data.permissive ? ['Prune', 'Permissive'] : ['Prune']);
    (self as unknown as Worker).postMessage({ id, idx: out }, [out.buffer]);
  } catch (x) {
    (self as unknown as Worker).postMessage({ id, idx: null, error: String(x) });
  }
};
