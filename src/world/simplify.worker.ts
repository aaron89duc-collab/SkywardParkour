/// <reference lib="webworker" />
// Mesh simplification off the main thread (no hitch while a map loads in the background during play).
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

type Req = {
  id: number;
  /** the position buffer as stored (float, or quantized int16/int8/uint16/uint8; maybe interleaved) */
  arr: Float32Array | Int16Array | Int8Array | Uint16Array | Uint8Array;
  stride: number; offset: number; count: number; normalized: boolean;
  idx: Uint16Array | Uint32Array | null; ratio: number; err: number; permissive?: boolean;
};

const NORM: Record<string, number> = { Int8Array: 127, Uint8Array: 255, Int16Array: 32767, Uint16Array: 65535 };

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, arr, stride, offset, count, normalized, ratio, err } = e.data;
  try {
    await MeshoptSimplifier.ready;
    // positions to floats here (not on the main thread)
    const pos = new Float32Array(count * 3);
    const k = normalized ? 1 / (NORM[arr.constructor.name] ?? 1) : 1;
    for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) pos[i * 3 + c] = Math.max(-1e9, arr[i * stride + offset + c] * k);
    if (normalized && (arr instanceof Int8Array || arr instanceof Int16Array)) for (let i = 0; i < pos.length; i++) pos[i] = Math.max(pos[i], -1);
    const nv = count;
    let idx: Uint32Array;
    if (!e.data.idx) { idx = new Uint32Array(nv); for (let i = 0; i < nv; i++) idx[i] = i; }
    else idx = e.data.idx instanceof Uint32Array ? e.data.idx : Uint32Array.from(e.data.idx);
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
